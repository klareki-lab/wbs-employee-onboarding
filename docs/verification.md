# Verification — 2026-10-27

Verified locally; no production deployment or live n8n workflow modification.

| Check | Result |
|---|---|
| TypeScript build (`npm run build`) | Passed |
| Source formatting (`npm run format:check`) | Passed |
| Dependency audit | Zero known vulnerabilities after upgrading Nodemailer to 10.2.1 |
| PostgreSQL 17 migration | Applied successfully in dedicated local development and test databases |
| Migration repeat run | Passed without reapplying existing migration |
| Focused HTTP/PostgreSQL/Mailpit test | Passed; real database transactions and SMTP capture, local mock webhook |
| Docker production artifact | Multi-stage image built; runs as non-root node user |
| Docker startup | Migrations and API startup succeeded |
| Container smoke | HR CLI provisioning, login, employee creation/detail, n8n unavailable and approval gating passed |

Critical test assertions cover unauthenticated HR rejection, separate department read authentication, CSRF and Origin rejection, malformed employee input, concurrent duplicate submission returning one employee/job, conflicting duplicate rejection, approval/send gating, callback transition rejection before dispatch, webhook dispatch acceptance, completed callback, idempotent callback replay, conflicting callback rejection, idempotent HR approval, concurrent sends producing one invitation, Mailpit SMTP acceptance, token hash storage, public validation, expiry rejection, username conflict rollback, concurrent activation with one success, consumed-token rejection, Argon2id password storage, employee login/profile, employee rejection from HR routes, dashboard placeholders, logout and session invalidation.

Local API port 3001 was already occupied, so the packaged container smoke ran on **localhost:3009** through the configurable `API_PORT`; the pre-existing service was left running. PostgreSQL and Mailpit use the isolated `wbs-employee-onboarding` Compose project. Tests use `onboarding_test`, and no unrelated schemas are touched.

Not verified: real n8n agents/workflow, external inbox delivery, production HTTPS/proxy routing, or Hetzner deployment. These require newly provisioned workflows, credentials and separately authorized deployment configuration. SMTP acceptance is never represented as final inbox delivery.

## Owner-authorized real AI test — 2026-10-27

Existing employee `71fac882-8236-4641-98d5-86ffd1b60ab1`, same job `c4007247-e99e-4a31-8eb4-0f4462648996`: completed via authenticated backend callback in local n8n execution **14**. Node-finished event metadata confirms Coordinator, Info Agent, department HTTP tool, Welcome Agent, output validator, completed callback and terminal persistence. Result team lead/accounts exactly match the department registry; German welcome text is persisted.

Initial execution **11** failed before successful model initialization because OpenAI Chat Model v1.2 requires a `model.value` resource locator. Exports/rendering were corrected. The failed callback and failed n8n dedup record were archived, preserving the same employee/job IDs and cumulative attempt count (2). Migration and guarded recovery tests passed in `onboarding_test`; build passed.

Read-only verification: employee status pending, approved_at/approved_by null, no invitations and no employee account. Existing HR account tessa preserved; total employee count remains 2. Chrome shows completed processing and enabled HR approval, with invitation sending disabled. No automatic approval, invitation or external account provisioning was performed for this employee. Production/Messe Hub untouched.

## Real SMTP preparation — owner configuration pending

Added a separate SMTP overlay/private env file and no-message verification command. Real mode requires credentials, an authorized real From address and TLS/certificate validation even under local development. Sending now defaults to disabled; Mailpit is opt-in only for regression fixtures. TypeScript and focused regression checks passed. External mode refused a plaintext Mailpit connection with ETLS before authentication; disabled mode refused delivery. No real-provider connectivity or inbox delivery is claimed because the independent host/sender/credentials are not configured. HR approval for the completed employee has since been recorded at 2026-10-27 17:04 UTC; that approval and the completed AI result are preserved, with zero invitations. See real-smtp.md for exact owner steps and the localhost activation limitation.

## Employee login / role routing correction

Confirmed the activated employee's stored username differs from the shorter username used in the failed login; the real Vite login request returned 401 INVALID_CREDENTIALS without creating a session. Role mapping is employee with correct employee linkage. Fixed the misleading expired-session message, implicit HR redirect on the login page after activation, late auth-response/CSRF races and generic localhost cookie naming. Added an explicit local password-rotation path for the exposed employee credential, with no automatic change to the real password.

28 frontend tests and frontend/backend builds passed. Real HTTP auth-only regression passed in onboarding_auth_test with email disabled, exercising independent HR/employee jars, activation-to-login, role/employee isolation, login rotation, CSRF/Origin, stale-session logout and password-rotation/session-revocation isolation. Normal Chrome protected routes redirect guests to login. Native Incognito automation is unavailable due Computer Use permissions; real password rotation and authenticated Incognito acceptance remain owner actions. See authentication.md. Existing SMTP, employees, AI results, invitations and HR account preserved; no additional invitation send.

## Automatic second-employee dispatch regression

Removed the controlled-test employee filter from worker, configuration, Compose and bootstrap. The independent onboarding_dispatch_test HTTP/PostgreSQL regression passes: first completion, second registration, automatic worker claim, retry on a simulated 503 using the same job/idempotency key, validated callback, unchanged first result, no duplicate registration and no approval/invitation. SMTP is disabled and orchestration is mocked only in this isolated regression. Frontend tests (29) and backend/frontend builds pass. Live automatic rollout is pending explicit external-processing authorization after automatic approval review rejected the API restart; the existing queued job has not been reset or fabricated as completed.
