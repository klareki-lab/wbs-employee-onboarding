# WBS Employee Onboarding Portal — frontend MVP v1

Responsive German-first React + TypeScript frontend with HR, invitation activation and employee portal. Visual language inspired by the Messe Hub palette, with **no shared backend, database, credentials, or code dependency**. No deployment performed and no connection to Messe Hub production.

## Quick start

Requires Node.js **20.19+** or **22.12+** and npm.

```bash
npm install
cp .env.example .env
npm run dev
```

Open `http://127.0.0.1:5173`. The app expects `/api` to be served by Codex's backend; without it, protected pages deliberately show an unavailable session/connection state. **There are no fake employees, fake invitation links, mock login or fake success notifications.** The `/activate` page is accessible without a session but requires a real invitation token from Codex's backend.

For a separately running local backend, put this in `.env`:

```ini
VITE_API_BASE_URL=/api
VITE_DEV_API_PROXY_TARGET=http://127.0.0.1:3001
```

Proxy targets are only a local dev convenience. `VITE_API_BASE_URL` can be an HTTPS API origin if CORS/cookie settings are explicitly managed; **same-origin `/api` is recommended** in production. Never put secrets in `VITE_*`: they are embedded in browser JavaScript.

## Routes

| Route | Authentication | Function |
| --- | --- | --- |
| `/` | auto | Redirect by verified server role |
| `/hr` | `hr` | Employee list, statuses, search |
| `/hr/new` | `hr` | Create onboarding request with validation and idempotency key |
| `/hr/employees/:id` | `hr` | Detail, team lead, accounts, explicit approval, invitation action |
| `/activate#token=...` | public | Backend invitation validation and account activation |
| `/login` | public | Backend authentication with HttpOnly session |
| `/dashboard` | `employee` | Welcome header and four module cards |
| `/dashboard/rules` | `employee` | Real placeholder page |
| `/dashboard/training` | `employee` | Real placeholder page |
| `/dashboard/team` | `employee` | Real placeholder page |
| `/dashboard/tasks` | `employee` | Real placeholder page |

## Developer commands

```bash
npm run dev      # Vite dev server
npm run build    # TypeScript compile + production static build
npm run preview  # Preview output after build
npm run typecheck
npm test         # Pure validation + status policy unit tests (Node 22)
```

For production, serve `dist/` behind an HTTPS host with a **single-page application fallback** (`try_files $uri /index.html`) and proxy `/api/` to Codex backend. All routes are BrowserRouter routes, not distinct HTML files.

## Structure

- `src/api/client.ts`: centralized credentialed API client, timeout, error handling, endpoints.
- `src/api/types.ts`: strict API response/request models.
- `src/auth/AuthContext.tsx`: session verification and login/logout with backend.
- `src/components/`: shared shell, accessible controls, statuses.
- `src/pages/`: HR, new employee, detail/approval, activation, login, employee modules.
- `src/lib/`: pure employee/activation validation and status transition logic.
- `src/i18n/de.ts`: centralized common German strings; expand to `en.ts` with locale provider later.
- `docs/BACKEND_CONTRACT.md`: historical proposal only. Backend source of truth: `klarekipro/wbs-employee-onboarding` `feat/backend:docs/api-contract.md` and `docs/integration.md`.

## Boundaries / security

- No localStorage/sessionStorage tokens, no frontend account service, no invitation generation, no user database.
- Password only held temporarily in React component state for form submission over HTTPS; immediately cleared after verified activation.
- URL invitation token read once, removed from visible URL, sent to backend validation and activation only. Configure referrer/log protection server-side.
- Protected routes are UX, **server must enforce RBAC**. HR approval checked in UI but enforced by backend.
- Signup uses one `Idempotency-Key` per form session, held in memory. The backend owns atomic deduplication. Authenticated POSTs send in-memory `X-CSRF-Token` from login or `/auth/me`. All responses unwrap `{data:...}`; HR list uses backend pagination. Employee state and n8n job processing state are separate.
- Network errors never masquerade as success. Dashboard metrics only derive from real returned records.

## Integration status

Frontend implementation complete; **not end-to-end integrated**. Backend delivery, invitation SMTP/service, real sessions and deployment remain Codex/integration responsibilities. No dependencies installed in the creation environment (npm registry DNS unavailable); build/runtime still need to be verified after npm install in a network-connected environment.
