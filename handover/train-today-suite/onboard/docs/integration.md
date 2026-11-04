# n8n and email integration

## Scope

This implementation prepares a new Employee Onboarding integration. It does not create or modify any live n8n workflow, Trade Fair workflow, DNS record, production email configuration, or production database. No live workflow IDs or credentials have been supplied. `https://n5n.klare-ki.de/` is the prospective n8n host, not an invented webhook URL.

## Backend → n8n

Set a new workflow's exact `N8N_ONBOARDING_WEBHOOK_URL` and an independent random `N8N_ONBOARDING_WEBHOOK_SECRET` (32+ characters). Configure the n8n webhook to validate:

```text
Authorization: Bearer <N8N_ONBOARDING_WEBHOOK_SECRET>
Content-Type: application/json
Idempotency-Key: <onboarding_job UUID>
```

```json
{
  "event": "employee.onboarding.requested",
  "job_id": "<job UUID>",
  "employee_id": "<employee UUID>",
  "first_name": "Tom",
  "last_name": "Becker",
  "department": "IT",
  "role": "Backend Developer",
  "start_date": "2026-11-03",
  "personal_email": "tom.becker@example.com"
}
```

Employee and job are committed in one transaction before any network request. The in-process worker polls PostgreSQL every two seconds. A row lease and `FOR UPDATE SKIP LOCKED` support restart recovery and avoid concurrent claims. Delivery is **at least once**: n8n must persistently deduplicate `job_id` before running agents. The same job ID and key survive retries. POST requests time out after ten seconds; redirects are rejected to avoid leaking credentials. A 2xx response means `awaiting_result`, not completed agent processing. Non-2xx/network failures retry after 30 seconds, up to five dispatch attempts, then `failed` with `WEBHOOK_DISPATCH_FAILED`.

Without configuration jobs are `unavailable`. Once a valid webhook is configured and the API restarted, the worker queues those existing jobs automatically. Interrupted `dispatching` leases become claimable after 30 seconds. No automatic retry occurs after final failure. For a deliberately investigated dispatch failure, an operator with separately authorized database access may reset only the relevant job, retaining its ID:

```sql
UPDATE employee_onboarding.onboarding_jobs
SET processing_status='queued',attempts=0,error_code=NULL,next_attempt_at=now(),lease_until=NULL,updated_at=now()
WHERE id = '<reviewed job UUID>'
  AND processing_status='failed' AND orchestration_result IS NULL;
```

The backend keeps `awaiting_result` until a callback arrives; n8n should retry callback delivery on transient errors. No agent success is inferred from a webhook acceptance. Investigate stalled jobs in the HR detail endpoint rather than approving them manually. Final agent failures/results are immutable through the public API in MVP v1.

## n8n → backend

Configure `INTERNAL_API_SECRET`, separate from the outgoing webhook secret. Store it in n8n credentials, outside agent prompts. POST to the separately deployed backend:

```text
POST /api/internal/onboarding/result
Authorization: Bearer <INTERNAL_API_SECRET>
Content-Type: application/json
```

Success body (all fields required, no extra fields):

```json
{
  "employee_id": "<employee UUID>",
  "status": "completed",
  "team_lead": "Sarah Miller",
  "necessary_accounts": ["GitHub", "Google Workspace"],
  "welcome_message": "Willkommen Tom im IT-Team!"
}
```

Failure body:

```json
{"employee_id":"<employee UUID>","status":"failed","error_code":"AGENT_PROCESSING_FAILED"}
```

Team lead and account labels are 1–200 characters, at most 30 account labels; welcome message is 1–4000 characters. Failure codes are 1–80 uppercase letters, digits or underscores. The backend validates and stores JSON; it never executes AI output, creates accounts, grants permissions or chooses email recipients from this output. The frontend must render these fields as untrusted plain text.

Callbacks are accepted only after an actual dispatch attempt. This permits fast callbacks during the outgoing request and delayed callbacks after a dispatch timeout; it rejects results for unconfigured/unattempted jobs. A row lock serializes callbacks. Exact JSON-equivalent replays return 200 with `replayed:true`; differing terminal results return 409 `CALLBACK_CONFLICT`. Property order is ignored. Completed/failed agent results cannot be overwritten. Approval requires completed processing; only authenticated HR can approve or send an invitation.

## Read-only department information

Configure an independent `DEPARTMENTS_API_SECRET`, expose `GET /api/internal/departments` to the Info Agent's tool through a controlled network route, and send `Authorization: Bearer <DEPARTMENTS_API_SECRET>`. This credential authorizes only department reads; it is not accepted for result callbacks. Missing configuration returns 503. Keep secrets outside model context. This route is SELECT-only and exposes no employee or account records. Demo values are explicitly marked `is_demo:true`:

- IT — Sarah Miller — GitHub, Google Workspace, Jira
- Marketing — Anna Weber — Google Workspace, Canva, Analytics
- Sales — Michael Braun — CRM, Google Workspace

Coordinator Agent manages orchestration, Info Agent obtains department suggestions, Welcome Announcement Agent drafts text. n8n sends the validated consolidated result back. Suggestions never constitute permission grants.

## SMTP and Mailpit

The Nodemailer adapter uses the approved employee's stored personal address and a fixed German subject/body. Only a SHA-256 hash of a 256-bit random invitation token is stored. Default expiry is 24 hours. No raw invitation tokens, passwords or SMTP responses are logged. SMTP TLS is mandatory in production; configure a newly authorized provider rather than existing klare-ki.de production email settings.

Local Compose routes all email to Mailpit (`http://localhost:8025`), allowing a complete manual demo without real email delivery. Capture contents necessarily contain activation links: keep Mailpit local and clear messages when finished. A captured message is accepted by Mailpit, not delivered to an external inbox.

Delivery states, expiry, explicit revocation and recovery from uncertain delivery are described in [api-contract.md](api-contract.md). The adapter intentionally does not retry ambiguous SMTP failures. An outbox containing plaintext tokens is not used. Explicit revocation followed by a new send invalidates the old link before replacement.

## Restricted database role example

For a later separate production database, have its authorized owner run migrations first. Then create a dedicated runtime role using your secret-management procedure and grant only the new schema's application tables (replace the role name as required):

```sql
GRANT USAGE ON SCHEMA employee_onboarding TO onboarding_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON
 employee_onboarding.departments, employee_onboarding.employees,
 employee_onboarding.user_accounts, employee_onboarding.invitations,
 employee_onboarding.onboarding_jobs, employee_onboarding.sessions
TO onboarding_runtime;
GRANT SELECT ON employee_onboarding.schema_migrations TO onboarding_runtime;
```

Use a separate migration job (`node dist/migrate.js`) with the owner credential; override the API image command to `node dist/server.js` for the restricted runtime. Do not grant the runtime role ownership or access to unrelated schemas. No production role is created by this repository.

Reference behavior: [Express async error handling](https://expressjs.com/en/guide/error-handling/), [PostgreSQL row locks](https://www.postgresql.org/docs/17/explicit-locking.html), [Nodemailer SMTP transport](https://nodemailer.com/smtp).
