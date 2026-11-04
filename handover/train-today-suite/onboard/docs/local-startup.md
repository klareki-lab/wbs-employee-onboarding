# Integrated MVP v1 — local Mac startup

Branch: `integration/mvp-v1`; Draft PR #4. This configuration uses only the isolated `wbs-employee-onboarding` Docker Compose project. Messe Hub and production resources are untouched.

Real-inbox acceptance uses the separate [SMTP overlay and credentials](real-smtp.md). Local sending stays disabled until that configuration passes verification; Mailpit remains only for explicit tests.

## Current local addresses

- Frontend: **http://localhost:5173/login**
- Backend health: **http://localhost:3009/health**
- Mailpit: **http://localhost:8025**
- PostgreSQL: localhost:54329 (existing onboarding-only Docker volume)

Port 3001 is occupied by a different local service. The backend `.env` therefore sets `API_PORT=3009` and `APP_ORIGIN=http://localhost:5173`. The frontend `.env` sets:

```ini
VITE_API_BASE_URL=/api
VITE_DEV_API_PROXY_TARGET=http://127.0.0.1:3009
```

Both `.env` files are ignored by Git. The backend internal API secret is locally generated and is not included in commits. Do not use the placeholder from `.env.example` as an actual secret.

Always open the frontend as **localhost**, not `127.0.0.1`: the backend enforces the exact Origin on POST requests. The Vite proxy target may use `127.0.0.1` because it is a server-to-server connection. `npm run dev` binds to localhost port 5173 with `--strictPort` so an occupied port cannot silently change the frontend origin or invitation link destination.

## Start/restart with the configured local environment

From the repository root:

```sh
docker compose --env-file backend/.env -f backend/compose.yaml up --build -d
npm ci --prefix frontend
npm run build --prefix frontend
npm run dev --prefix frontend
```

For a new checkout, first copy the environment examples, replace `INTERNAL_API_SECRET` with a newly generated private value of at least 32 characters, and set `API_PORT`, `APP_ORIGIN` and `VITE_DEV_API_PROXY_TARGET` to the values above. Do not overwrite an existing local environment or point the integration at Messe Hub.

The Docker image applies migrations before listening. The three Compose services are PostgreSQL, Mailpit, and the API; no live n8n service is started or modified. Existing local onboarding data is preserved.

## Secure interactive HR provisioning

Run this command yourself in Mac Terminal:

```sh
bash /Users/admin/Projects/wbs-employee-onboarding/backend/scripts/provision-local-hr.sh
```

For a different checkout path, run `bash backend/scripts/provision-local-hr.sh` from its repository root. The script asks for an unused lowercase username (3–64 allowed characters) and a 12–128-character password. Password input is hidden. Credentials are passed through process environment only, not command arguments, files or logs, and cleared when the script exits. Existing accounts are never overwritten.

After provisioning, the script verifies login, the HR session profile and CSRF-protected logout through `localhost:5173/api`. Sign in to the frontend using the credentials you chose. Never send the password through chat. If native Terminal automation is blocked, this manual interaction is required; successful app startup does not imply HR provisioning succeeded.

## Runtime checks performed on 2026-10-27

- Frontend dependency installation and TypeScript/Vite production build passed.
- Docker backend rebuilt and started with isolated PostgreSQL and Mailpit.
- `/health` returned HTTP 200, `status: ok`, email `configured`, n8n `unavailable`.
- Frontend `/login` and Mailpit returned HTTP 200.
- Vite-proxied `/api/auth/me` returned the expected unauthenticated HTTP 401 JSON, confirming API routing rather than an HTML fallback.
- Login POST with the configured localhost Origin reached credential validation (401 for intentionally invalid credentials); substituting the formerly documented 127.0.0.1 Origin was rejected with 403 `ORIGIN_INVALID`.
- Chrome displayed the German login form without a backend-unavailable warning.

## Remaining integration boundary

n8n is deliberately **unavailable** because no new live onboarding webhook and credentials are configured in the local environment. You can sign in as HR, register and inspect employees; their jobs remain unavailable and HR approval stays blocked until real orchestration completes. This is an enforced backend contract, not a frontend failure. Mailpit captures messages locally once an employee has legitimately completed processing and HR has approved the invitation. No fake processing results are injected, and no production workflow is modified to bypass this boundary.
