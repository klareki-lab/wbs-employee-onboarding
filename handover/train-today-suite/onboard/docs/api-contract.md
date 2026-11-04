# API contract — MVP v1

Base path `/api`; JSON. Success envelope `{ "data": ... }`. Error envelope `{ "error": { "code": "..." } }`; validation errors also include `fields: [{path,message}]`. UUIDs are strings, start dates are `YYYY-MM-DD`, timestamps are ISO 8601. Responses are `Cache-Control: no-store`.

## Browser authentication

Use `fetch(url, {credentials: 'include', ...})`. The browser sets `Origin` to the exact configured `APP_ORIGIN`. All browser POST requests (including login and activation) require this Origin. Command-line requests must supply the same header. CORS permits only that origin with credentials. Prefer serving frontend and `/api` under the same origin in production. If cross-origin in production, keep both hosts on the same site for SameSite=Lax cookies.

Login sets an opaque `wbs_onboarding_session` cookie (`__Host-wbs_onboarding_session` in production): HttpOnly, SameSite=Lax, path `/`, Secure in production. Only the SHA-256 session hash is stored. For authenticated POST requests, include `X-CSRF-Token` returned by login or `/auth/me`. Keep the CSRF value in memory; do not store authentication secrets in localStorage. Login rotates the current profile's session. Activation creates an account but does not log the employee in; its exact returned username is carried to the explicit login page. HR and employee sessions should use separate browser profiles when kept active simultaneously. Generic cookies named `session` are ignored. After the cookie namespace change, perform one fresh login. See [authentication.md](authentication.md).

## Routes

| Method / path | Authorization | Request | Success |
|---|---|---|---|
| `POST /onboarding` | HR + CSRF | EmployeeInput below | 201 new / 200 exact replay: `{employee_id,job_id,processing_status,replayed}` |
| `GET /hr/employees?limit=50&offset=0` | HR | limit 1–200; offset ≥0 | 200 array of EmployeeSummary, plus top-level `pagination:{limit,offset}` |
| `GET /hr/employees/:id` | HR | UUID | 200 EmployeeDetails |
| `POST /hr/employees/:id/approve` | HR + CSRF | No body | 200 `{employee_id,status:"approved",approved_at}` |
| `POST /hr/employees/:id/send-invitation` | HR + CSRF | No body | 200 or 202 `{employee_id,invitation_id,expires_at,delivery_status,reused}` |
| `POST /hr/employees/:id/revoke-invitation` | HR + CSRF | No body | 200 `{employee_id,revoked:true}`; necessary recovery for a lost or uncertain email |
| `GET /invitations/validate?token=...` | Public bearer token in query | 43-character base64url token | 200 `{first_name,last_name,expires_at}` |
| `POST /invitations/activate` | Public + allowed Origin | `{token,username,password}` | 201 `{id,username,employee_id,role:"employee"}` |
| `POST /auth/login` | Public + allowed Origin | `{username,password}` | 200 `{user,csrf_token}` plus session cookie |
| `POST /auth/logout` | Session + CSRF | No body | 200 `{logged_out:true}`; clears this app's session/cookie; already expired/missing sessions also succeed (Origin still required, CSRF required for valid sessions) |
| `GET /auth/me` | Session | None | 200 `{user,employee,csrf_token}` |
| `GET /employee/dashboard` | Employee session | None | 200 `{areas:[{id,title}],placeholder:true}`; four requested navigation placeholders |
| `GET /internal/departments` | Separate read-only bearer secret | None | 200 array `{id,name,team_lead,necessary_accounts,is_demo}` |
| `POST /internal/onboarding/result` | Callback bearer secret | Integration guide | 200 `{processing_status,replayed}` |
| `GET /health` (outside `/api`) | Public | None | 200 `{status:"ok",integrations:{n8n,email}}`; database failure 500 |

`user = {id,username,role:"hr"|"employee",employee_id:string|null}`.
`employee` on `/auth/me` is null for HR, otherwise `{id,first_name,last_name,personal_email,department,role,start_date,status}`. Employee `role` is the job title; user `role` is the authorization role.

### EmployeeInput

```json
{
  "first_name": "Tom",
  "last_name": "Becker",
  "personal_email": "tom.becker@example.com",
  "department": "IT",
  "role": "Backend Developer",
  "start_date": "2026-11-03"
}
```

Names, department and position are trimmed, 1–100 characters, no control characters. Department must exist. Email is validated, limited to 254 characters and normalized to lowercase. Dates must be real calendar dates. Unknown body fields are rejected. Username is normalized to lowercase, 3–64 characters, starts with `[a-z0-9]`, remaining characters `[a-z0-9._-]`. Password is 12–128 characters on activation; never normalized or returned. Passwords are chosen by employees and hashed with Argon2id (64 MiB, three iterations, one lane).

Duplicate policy: a personal email identifies one registration for its lifetime, including after activation. Identical normalized EmployeeInput returns the original employee/job with `replayed:true`; different fields for the same email return 409 `EMPLOYEE_ALREADY_REGISTERED`. Concurrent retries cannot create multiple jobs. Changing an existing registration is outside MVP v1.

### Employee responses and state

EmployeeSummary: `{id,first_name,last_name,personal_email,department,role,start_date,status,created_at,processing_status}`.

EmployeeDetails adds `updated_at,approved_at,approved_by,team_lead,necessary_accounts,department_is_demo,job_id,orchestration_result,error_code,invitation`. EmployeeDetails does not expose user accounts, session data, invitation hashes or raw tokens. `invitation` is null or `{id,expires_at,used_at,revoked_at,delivery_status,status}`; status is `pending|used|revoked|expired`. Account provisioning suggestions are informational only.

Employee state: `pending → approved → active`. Approval requires a completed n8n result and records the HR account and timestamp. Repeating approval is idempotent while approved; active employees return `ALREADY_ACTIVE`. Job processing state is separate: `unavailable|queued|dispatching|awaiting_result|completed|failed`. UI must show `unavailable` honestly when n8n is not configured. Result team/accounts are used when available; department demo values are the fallback and remain marked as demo.

### Invitation delivery and activation

Delivery is `sending|smtp_accepted|unknown|failed`. `smtp_accepted` means the configured SMTP server accepted the message, **not final inbox delivery**. Only explicit `SMTP_MODE=capture` sends to Mailpit for regression tests. Real-inbox acceptance uses the separately authorized `SMTP_MODE=external` configuration; default `disabled` mode returns `EMAIL_UNAVAILABLE` before creating an invitation. See [real-smtp.md](real-smtp.md). A parallel or replayed send request reuses the pending invitation and returns its recorded status (202 while sending); it never claims a queued message was delivered. Raw tokens are never returned to HR. Valid pending links are not resent because the backend stores only their hashes.

On SMTP errors, delivery is conservatively `unknown` because a timeout may follow acceptance. If the process terminates mid-send the state can remain `sending`. HR can revoke and request a new link; revocation is blocked for the first 60 seconds of sending to avoid racing the SMTP operation. The old link immediately becomes invalid. Expired links are automatically revoked/replaced on the next send request. SMTP unconfigured returns 503 before creating a new invitation. Sending is always restricted to the personal address in the approved record.

Activation link format is `${APP_ORIGIN}/activate#token=...`. Frontend reads the fragment, removes it with `history.replaceState`, validates using the GET route, then submits the POST body. Do not log tokens or put them in analytics/referrer URLs. Validation exposes only first/last name and expiration. Used, revoked, expired or unknown tokens return the same 410. Successful activation atomically consumes the token, creates the account, and marks the employee active; a username conflict rolls back all three changes.

### Errors

| HTTP | Codes |
|---|---|
| 400 | `VALIDATION_ERROR`, `INVALID_JSON`, `DEPARTMENT_UNKNOWN` |
| 401 | `UNAUTHENTICATED`, `INVALID_CREDENTIALS` |
| 403 | `FORBIDDEN`, `CSRF_INVALID`, `ORIGIN_INVALID` |
| 404 | `EMPLOYEE_NOT_FOUND`, `JOB_NOT_FOUND`, `NOT_FOUND` |
| 409 | `EMPLOYEE_ALREADY_REGISTERED`, `CONFLICT` (e.g. username unavailable), `ONBOARDING_NOT_COMPLETED`, `HR_APPROVAL_REQUIRED`, `ALREADY_ACTIVE`, `INVITATION_SENDING`, `ILLEGAL_JOB_TRANSITION`, `CALLBACK_CONFLICT` |
| 410 | `INVITATION_INVALID` |
| 413 | `PAYLOAD_TOO_LARGE` |
| 429 | `RATE_LIMITED` |
| 500 | `INTERNAL_ERROR` |
| 503 | `EMAIL_UNAVAILABLE`, `DEPARTMENTS_API_UNAVAILABLE` |

All routes share 300 requests/minute/IP; login, invitation validation and activation additionally share 20 attempts/15 minutes/IP. JSON request body limit is 32 KiB. Malformed credentials do not expose whether an account exists.
