# Release-candidate verification — 2026-10-27

Branch: `integration/mvp-v1`. Draft PR: [#4](https://github.com/klarekipro/wbs-employee-onboarding/pull/4). Local installation only; no merge, tag, VPS deployment or production infrastructure change.

## Independent installation

The portable installer was exercised with a **new Compose project**, `wbs-onboarding-verify`, empty PostgreSQL/n8n volumes, independent randomly generated database/bearer/encryption secrets, and alternate loopback ports (web 15173, API 13009, n8n 15681, Mailpit 18025). The existing developer project, accounts, employees, completed AI results and SMTP configuration were left untouched. No host Node.js dependency is needed by the installer; both applications build inside Docker.

```sh
python3 scripts/local.py --project wbs-onboarding-verify configure --mail-mode capture --web-port 15173 --api-port 13009 --n8n-port 15681 --mailpit-port 18025
python3 scripts/local.py --project wbs-onboarding-verify up
```

The verification harness supplied an already authorized OpenAI key through a private environment path rather than exposing it in terminal output. Yuri supplies his own key through the hidden configure prompt. External SMTP was checked separately using the independently authorized private Resend configuration; no additional real email was sent by handover verification.

| Check | Result |
|---|---|
| Frontend Docker build | Passed: clean `npm ci`, TypeScript and Vite production build |
| Backend Docker build | Passed: clean dependencies, TypeScript build, non-root runtime |
| New PostgreSQL schema/migrations | Both `001_initial.sql` and `002_job_attempt_history.sql` applied; only onboarding schema in fresh isolated DB |
| New n8n import | Credentials + onboarding + connectivity workflows imported; both published automatically |
| Webhook security | Missing/wrong credential → 403; authenticated `{}` → 400 |
| Read-only department lookup | Authenticated local n8n → backend returned 3 fictional departments |
| Callback connectivity | Authenticated empty callback → 400 `VALIDATION_ERROR`; no employee mutation |
| Built frontend proxy | Application HTTP 200; unauthenticated same-origin `/api/auth/me` → 401 |
| Real external SMTP | Resend authentication and mandatory TLS/certificate verification passed; no email sent by verification |
| Routine `up` | Repeat startup retains workflow imports/history, database/accounts and generated secrets; no reimport |
| Interactive HR provisioning | Passed through a pseudo-terminal with randomized synthetic credentials; hidden password was not echoed |

## Real AI and synthetic end-to-end test

The fresh stack registered a **synthetic** employee (`Demo Colleague`, fictional IT department and role, reserved `example.invalid` capture address) using a randomized test HR password. No personal employee identities or keys appear in this public report.

- Registration through the built frontend's same-origin proxy returned a new record; repeated identical registration reused the same employee/job. No duplicate employee was created.
- Approval and invitation requests before completion returned 409.
- Automatic worker dispatched the job without an employee filter or manual dispatch command; completion occurred on **attempt 1**.
- Local n8n **execution 3** emitted real OpenAI model-generated events for Coordinator, Info Agent and Welcome Agent, plus finished events for `departments_api`, `onboarding_info`, `welcome_announcement`, strict validation, `Callback: Completed` and `Persist Terminal State`, followed by workflow success. No mock callback or synthetic completion was injected.
- PostgreSQL independently persisted the completed AI result. Department lead matched the fictional IT registry and the accounts array had three entries. No approval or invitation occurred automatically.
- The isolated synthetic test then explicitly performed HR approval and invitation through the protected API. Exactly one invitation was captured in **that stack's Mailpit**, with the configured `http://localhost:15173` activation origin.
- Activation succeeded once; reuse returned 410. Employee login returned the employee role and matching profile, HR API access returned 403, the dashboard exposed four placeholder areas, logout returned success and `/auth/me` then returned 401.
- This proves real AI execution plus a captured invitation/activation flow. It does **not** claim a new real inbox delivery or a new real-inbox activation during this handover. Earlier owner acceptance confirmed real Resend delivery and activation in the original installation; Yuri must repeat that acceptance using his own authorized sender/recipient.

## Automated suites

Backend checks ran in a disposable Linux Node 24 container, using a dedicated `onboarding_test` database inside the new verification project. Mailpit was addressed over that project's private network via `MAILPIT_API_URL`; SMTP remained capture/disabled for test fixtures. No real-provider calls occurred in these automated backend suites.

```text
npm run build                 PASS
npm run format:check          PASS
npx tsx src/migrate.ts         PASS (001 + 002)
npm test                      PASS: 3 tests, 0 failures, 0 skipped (~10.65 s)
```

The three integration tests cover independent HR/employee session jars, activation/login/logout, password rotation and session revocation, role/employee isolation, Origin/CSRF enforcement, automatic second-employee dispatch, simulated failure/retry with stable job IDs, duplicate registration, callback validation/idempotency, concurrent invitation/account creation and token one-time/expiry behavior. Test databases are guarded by the `_test` suffix.

Frontend checks:

```text
npm run build                 PASS (TypeScript + Vite)
npm test                      PASS: 29 tests, 0 failures, 0 skipped
```

They cover auth initialization races, account switching, activation-to-login identity, role routing, logout races, credentials/errors, German status labels, processing/terminal polling eligibility, approval/send gates and form validation. UI polling is read-only; it cannot approve or send. Authenticated visual HR acceptance remains an operator/browser check rather than an assertion based only on unit tests.

## Security and remaining limits

- Local install config, n8n plaintext bootstrap artifacts, encryption keys, provider keys and all `.env*` secrets are Git-ignored and excluded from Docker build contexts. The local frontend proxy disables request/error logging to avoid retaining activation-validation token query strings. No shared HR account/password is shipped. Database passwords and bearer/encryption secrets are generated independently per install.
- Current documentation is sanitized of previous real employee identities, account usernames and installation-specific employee/job IDs. Earlier commits retain previously published documentation; no Git history rewrite was performed. Owner privacy review of that historical documentation is a release consideration before broader redistribution/tagging.
- AI prompt construction excludes personal email, passwords, session credentials and invitation tokens. Local event metadata and backend state prove completion; execution payload retention is disabled in n8n.
- Host verification used macOS with Docker Desktop/Linux containers. Native Windows PowerShell/ACLs and a native Linux host were **not executed** here; their Python/Docker commands are documented but require platform acceptance. Linux application/container builds and tests passed.
- No public hosting/tunnel, remote-device localhost invitation access, corporate account provisioning or non-placeholder employee content is claimed.
- Provider access/billing, verified sender authorization and actual recipient inbox receipt are operator prerequisites/acceptance checks. SMTP auth success does not prove final delivery.
- The release remains a draft candidate. `v1.0.0` is proposed only after owner approval; no tag or merge was created.
