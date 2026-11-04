> **SUPERSEDED / HISTORICAL PROPOSAL.** This document describes the original frontend proposal, not the implemented backend. The authoritative integration contract is `klarekipro/wbs-employee-onboarding` branch `feat/backend`, `docs/api-contract.md` and `docs/integration.md`. This frontend now follows the backend contract. Do not use this file to implement the backend.

# Codex ↔ Frontend integration contract — MVP v1

**Status:** Proposed contract; no backend endpoints were verified. JSON objects and exact field names below are authoritative for this frontend. All API responses MUST be JSON except explicit `204` no-content success responses.

## Base and authentication

- `VITE_API_BASE_URL=/api` by default; no production host or key is hardcoded.
- Prefer browser **same-origin** HTTPS reverse proxy `/api/*` to Codex's API. For local Vite use `VITE_DEV_API_PROXY_TARGET` with `/api` retained.
- Browser sends `credentials: include`, `Accept: application/json`, `X-Requested-With: XMLHttpRequest`, `Content-Type: application/json` on payloads.
- Backend owns login/session, **HttpOnly Secure SameSite** cookie, CSRF protection (Origin/Referer validation or synchronizer tokens), rate limiting, password hashing, token hashing/expiry and RBAC checks. `SameSite` alone is not full CSRF protection.
- Do not return session tokens in JSON, nor use localStorage, sessionStorage, service workers or frontend-generated invitation secrets.
- All HR endpoints require valid server-side `hr` role. Employee portal requires `employee` role. The frontend's route guards are UX only; backend must always enforce authorization.
- Suggested statuses: `400` malformed input, `401` no session, `403` unauthorized, `404` unknown record, `409` conflict/duplicate, `410` expired/used invitation, `422` field errors, `429` rate limit, `5xx` backend fault. Avoid leaking whether a personal email address exists in public errors.
- Error payload: `{ "error": { "code": "MACHINE_CODE", "message": "User-safe description", "field_errors": { "personal_email": "..." } } }`. Error codes used by invite page: `INVITATION_EXPIRED`, `INVITATION_USED`, `INVITATION_INVALID`.
- All mutation endpoints must be authenticated/authorized, replay-safe where appropriate and transactional.

## Types

```ts
type OnboardingStatus =
  'request_received' | 'processing' | 'awaiting_hr_approval' |
  'invitation_pending' | 'invitation_sent' | 'activated' | 'failed';

type InvitationStatus = 'not_created' | 'pending' | 'sent' | 'expired' | 'used' | 'failed';

type OnboardingSummary = {
  team_lead?: string | null;
  required_accounts?: string[];
  department_description?: string | null;
  welcome_message?: string | null;
};
```

## HR API

### `POST /api/onboarding` — HR session required

Request (all required):

```json
{
  "first_name": "Anna", "last_name": "Müller",
  "personal_email": "anna@example.org", "department": "Engineering",
  "role": "UX Designerin", "start_date": "2026-11-02"
}
```

Header: `Idempotency-Key: <UUID>` generated once per form instance. **Codex backend must honor this idempotency key** across retries and atomically de-duplicate repeated creates. The same key with differing payloads must return a conflict. Also prevent duplicate employee requests according to business rules. `start_date` is ISO calendar `YYYY-MM-DD`, not an instant.

Response `201` or `202`:

```json
{ "employee_id": "emp_123", "status": "request_received", "onboarding_summary": null }
```

Backend may initially return `processing`; orchestrator may asynchronously update status and summary. Never return a success status if persistence/queueing failed. HR list and detail should return the latest persisted state.

### `GET /api/hr/employees` — HR session required

```json
{ "employees": [{
  "id": "emp_123", "first_name": "Anna", "last_name": "Müller",
  "personal_email": "anna@example.org", "department": "Engineering", "role": "UX Designerin",
  "start_date": "2026-11-02", "status": "awaiting_hr_approval",
  "invitation_status": "not_created", "onboarding_summary": {
    "team_lead": "Max Beispiel", "required_accounts": ["Google Workspace", "Slack"],
    "department_description": "...", "welcome_message": "..."
  }, "created_at": "2026-10-27T12:00:00Z", "approved_at": null, "invitation_sent_at": null
}] }
```

### `GET /api/hr/employees/:id`

Response `200`: `{ "employee": { /* same full Employee as in employees list */ } }`. Return **full** employee data including the `onboarding_summary`. Unknown `id` => `404`.

### `POST /api/hr/employees/:id/approve`

Only allowed when status is `awaiting_hr_approval`. Must record approving HR user and timestamp. Atomic transition to `invitation_pending`. Response: `{ "employee": { ...updatedEmployee } }` or HTTP `204` (frontend always refetches). `409` on wrong state.

### `POST /api/hr/employees/:id/send-invitation`

Only allowed **after recorded HR approval** (ideally status `invitation_pending`). Backend generates a one-time, short-lived secret, stores **only a hash**, queues/sends an email through its own invitation service; frontend never sees the secret. Backend must prevent duplicate invites on repeated calls; return `{ "employee": {...updatedEmployee} }` or HTTP `204`. Actual `invitation_sent` status must mean provider accepted dispatch; otherwise remain `invitation_pending` or set `failed` with retry backend policy. Frontend displays the canonical refetched status rather than inferring email delivery from HTTP `200`.

### State transition

`request_received → processing → awaiting_hr_approval → invitation_pending → invitation_sent → activated`, with `failed` possible on error. `invitation_status` is a separate independently persisted field. UI only enables approval during `awaiting_hr_approval` and invite-request during `invitation_pending`; backend must enforce transition guards as well. The real source of truth is the backend/database.

## Invitation API (no authenticated session required)

### `GET /api/invitations/validate?token=<opaque>`

Return `200` for all recognized states:

```json
{ "state": "valid", "employee": { "first_name": "Anna", "last_name": "Müller" }, "expires_at": "2026-11-03T12:00:00Z" }
```

Alternative body `{ "state": "expired" | "used" | "invalid" }`. Alternatively return `410` with `INVITATION_EXPIRED` or `INVITATION_USED`, or `404`/`INVITATION_INVALID`. Invalid invitations must not expose personal data. Token is URI-encoded in the request, is immediately removed from the browser address bar after loading and never logged by the frontend. **Backend/edge must scrub or avoid query-token access logs**, set `Cache-Control: no-store`, `Referrer-Policy: no-referrer`. Consider changing to one-time code in a POST for stronger log hygiene in v2.

### `POST /api/invitations/activate`

Request:

```json
{ "token": "<email-link-token>", "username": "anna.mueller", "password": "at least 12 characters" }
```

Response `200`/`201`: `{ "activated": true }`. Must atomically validate+consume the one-time token, enforce username uniqueness and password policy and hash the password (Argon2id or equivalent). `409` username taken (field error `username`), invalid/expired/used token state via error codes above. Do not auto-login; on success frontend navigates to `/login?activated=1`.

## Session API

- `POST /api/auth/login`: `{ "username": "anna.mueller", "password": "..." }` → `200`/`204`, **Set-Cookie** for HttpOnly server session. No credentials in JSON response required. Frontend calls `/auth/me` after login and will NOT declare login successful before it returns a valid user.
- `GET /api/auth/me` → `200`: `{ "user": { "id": "emp_123", "first_name": "Anna", "last_name": "Müller", "username": "anna.mueller", "roles": ["employee"] } }`. HR example `roles: ["hr"]` or `["hr","employee"]`. No valid session → `401`.
- `POST /api/auth/logout` → `200`/`204`; invalidate server session and expire cookie. Frontend retains authenticated state if logout fails so no fake logout success is shown.

## Integration acceptance checklist

1. HR login returns server cookie; `/auth/me` confirms role. Employee cannot access `/api/hr/*` even when calling API directly.
2. HR creates employee; exact `role` (job title, not auth role) and ISO `start_date` stored; repeated request with same Idempotency-Key does NOT create a second employee.
3. Status visibly progresses from `request_received/processing` to `awaiting_hr_approval`; summary includes `team_lead`, `required_accounts`.
4. Backend rejects invitation before HR approval even if called without the UI; approval permits invitation.
5. Send request queues an email using backend; status only says sent after provider acceptance. Duplicate clicks/requests don't dispatch two emails.
6. Valid link shows first name; expired/used/invalid states give correct messages without revealing secrets.
7. Activation rejects duplicate usernames and invalid tokens; consumes token exactly once; password never persists in browser storage.
8. Login creates real server session; employee sees exactly four navigation pages; logout terminates session and refresh of `/dashboard` no longer authenticates.
9. Verify CSRF protection, cookie scope/flags, TLS, rate limits, validation, logging redaction, SPA route fallback and no-cache for invite endpoints.

## Known blockers

- Codex endpoints not supplied or smoke-tested. UI defaults to **no mocks**; loading/network errors are intentional until the backend is connected.
- No invitation emails are sent by this frontend.
- Local browsers with cross-origin APIs require explicitly trusted CORS+credentials and correct cookie policy; same-origin reverse proxy is preferred.
