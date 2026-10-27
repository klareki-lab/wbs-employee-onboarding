# Employee Onboarding backend MVP v1

Node.js 24, TypeScript, Express 5, PostgreSQL 17. All tables live in `employee_onboarding`; migrations never reference `trade_fair`. Departments and their team leads are **fictional demo data**. No external accounts or corporate mailboxes are created.

## Local startup

From the repository root:

```sh
cp backend/.env.example backend/.env
# Edit INTERNAL_API_SECRET to an independently generated value:
openssl rand -hex 32
# Optional: also set a different DEPARTMENTS_API_SECRET for read-only agent access.
docker compose --env-file backend/.env -f backend/compose.yaml up --build -d
```

API: `http://localhost:3001`; health: `/health`; Mailpit capture UI: `http://localhost:8025`. Postgres is bound to localhost port 54329. If port 3001 is occupied, change `API_PORT` in `backend/.env` (this changes the Docker host port only). No real mail is sent by this Compose configuration. The API applies migrations before listening. Persistent local data is in the project-specific Docker volume. Stop with `docker compose --env-file backend/.env -f backend/compose.yaml down`; this preserves data.

The frontend should use `http://localhost:5173`, or set `APP_ORIGIN` to its exact origin and recreate the API container. Origins must not have a path or trailing slash. Do not mix `localhost` and `127.0.0.1` in browser URLs. HTTP cookies are permitted only for local development; production uses Secure cookies.

## Provision an HR user

No default password or HTTP setup endpoint exists. Supply a unique username and a password of at least 12 characters. The command refuses an existing username. Enter secrets interactively, rather than putting them into shell history:

```sh
read -r HR_USERNAME
read -rs HR_PASSWORD
export HR_USERNAME HR_PASSWORD
docker compose --env-file backend/.env -f backend/compose.yaml exec -T \
  -e HR_USERNAME -e HR_PASSWORD api node dist/provision-hr.js
unset HR_USERNAME HR_PASSWORD
```

The password is Argon2id hashed. HR accounts have no employee record. HR users can manage all onboarding records; employees can only retrieve their own profile and the placeholder dashboard. HR approval requires a completed orchestration result.

## Run Node on the host instead

```sh
docker compose --env-file backend/.env -f backend/compose.yaml up -d db mailpit
cd backend
npm ci
npm run migrate
npm run dev
```

`dotenv` loads `backend/.env` when the working directory is `backend`. For host provisioning, run the interactive environment setup above and then `npm run provision-hr`. Build with `npm run build`, then `npm start`. The compiled migration runner also resolves `/database/migrations` correctly.

## Configuration

| Variable | Requirement / default |
|---|---|
| `DATABASE_URL` | Required; dedicated database credentials. Host default example uses localhost:54329. Compose overrides with its internal DB hostname. |
| `INTERNAL_API_SECRET` | Required, at least 32 characters; callback bearer credential. Generate a private random value. |
| `APP_ORIGIN` | Exact frontend origin; default `http://localhost:5173`; HTTPS mandatory in production. Controls CORS, Origin validation and activation link origin. |
| `NODE_ENV` | development, test, production; production enables Secure cookies and SMTP TLS requirement. |
| `PORT` | 3001 for host Node; container internal port remains 3001. |
| `API_PORT` | Compose host binding, default 3001. |
| `DEPARTMENTS_API_SECRET` | Optional independent bearer credential, at least 32 characters. Without it the read-only department API returns 503. Does not grant callback access. |
| `N8N_ONBOARDING_WEBHOOK_URL` | Optional new onboarding workflow URL. HTTPS in production. Unset means unavailable, not completed. |
| `N8N_ONBOARDING_WEBHOOK_SECRET` | Required with webhook URL, at least 32 characters; separate outbound bearer credential. |
| `SMTP_HOST` | Optional; unset means email unavailable. Compose always uses Mailpit. |
| `SMTP_PORT`, `SMTP_SECURE` | 1025, false for Mailpit; typically 587/false (STARTTLS) or 465/true in production. |
| `SMTP_USER`, `SMTP_PASSWORD` | Provider-specific, optional in local capture mode. |
| `SMTP_FROM` | `onboarding@example.invalid` for local use; configure a separately authorized sender for deployment. |
| `SESSION_HOURS` | 8; absolute lifetime, range 1–168 hours. |
| `INVITATION_HOURS` | 24; range 1–168 hours. |
| `TRUST_PROXY_HOPS` | 0; set to the exact number of trusted proxy hops only behind an isolated proxy. |

Blank optional environment values are treated as unset. Credentials must be independent between services. No production credentials or live workflow IDs are included.

## Verification

The focused test uses a **dedicated database whose name ends in `_test`** and truncates only onboarding tables there. It runs real HTTP requests, PostgreSQL transactions, and Mailpit delivery with a local mock webhook; it does not contact live n8n.

```sh
docker compose --env-file backend/.env -f backend/compose.yaml exec -T db \
  createdb -U onboarding onboarding_test
cd backend
export DATABASE_URL=postgresql://onboarding:onboarding_local_only@localhost:54329/onboarding_test
export INTERNAL_API_SECRET="$(openssl rand -hex 32)"
export DEPARTMENTS_API_SECRET="$(openssl rand -hex 32)"
export N8N_ONBOARDING_WEBHOOK_SECRET="$(openssl rand -hex 32)"
export SMTP_HOST=localhost SMTP_PORT=1025
npm run migrate
npm run migrate
npm run build
npm test
npm audit
```

Keep Mailpit dedicated to this test/local app. Tests cover concurrent registration, conflicting duplicates, HR authorization, CSRF/Origin rejection, unauthorized callbacks, legal job transitions, callback replay/conflict, approval gating, concurrent invitation delivery, expiry, username conflict rollback, concurrent one-time activation, hashed storage, login, logout and employee role isolation. See [verification.md](verification.md) for actual results.

## Separate Hetzner deployment (prepared, not executed)

Build with `docker build -f backend/Dockerfile -t employee-onboarding:1 .`. Use a new application/container, dedicated PostgreSQL database and role, private network, unique secrets, approved SMTP provider and frontend origin. Do not deploy the development Compose defaults to production. Pin built images by digest in deployment manifests. Run migrations with a migration owner and run the API with a restricted runtime role limited to DML on onboarding tables; provision HR through a separately authorized administrative command. Back up the new database and rehearse restoration. A deployment example for restricted grants is in [integration.md](integration.md).

Set `NODE_ENV=production`, an HTTPS `APP_ORIGIN`, and correct proxy trust. Have the separately authorized deployment owner configure new HTTPS routing; no existing Nginx routes, DNS, MX records, production schemas, Messe Hub resources or Trade Fair workflows are changed here. Restrict internal routes by network in addition to bearer authentication. SMTP requires valid TLS in production. Use a TLS PostgreSQL connection with CA validation when crossing networks.

The MVP uses process-local rate limiting: run one API replica, or add a shared limiter before scaling horizontally. Sessions and queue leases are already database-backed. Send security/access logs only to a restricted destination; never log request bodies, cookies, Authorization headers or query strings on invitation routes. The frontend must remove the activation fragment immediately after reading it, never include third-party analytics on activation, and render AI text as plain text. Application code logs no bodies, URLs, invitation tokens, passwords, or SMTP responses.

The health endpoint checks database connectivity and migration metadata, and reports integration configuration, not remote provider availability. Monitor worker failures, failed jobs, long `awaiting_result` jobs, and invitation `unknown`/stale `sending` states. Sessions are expired absolutely and cleaned on login; schedule periodic `DELETE FROM employee_onboarding.sessions WHERE expires_at <= now()` for a busy deployment. No autonomous job retries occur after five dispatch failures or a final callback; deliberate administrative recovery is documented in the integration guide.
