# WBS Employee Onboarding Assistant — MVP v1

A local employee onboarding application: HR registers an employee, three real AI agents prepare onboarding information, HR reviews and approves it, and a personal invitation lets the employee activate an independent account and open the employee portal.

**Released: [`v1.0.0`](https://github.com/klarekipro/wbs-employee-onboarding/tree/v1.0.0).** Integration [PR #4](https://github.com/klarekipro/wbs-employee-onboarding/pull/4) was merged into `main` on 2026-10-27. This is a **local-only** application; there is no VPS deployment. For a stable reference use the `v1.0.0` tag. Future documentation or feature changes in `main` do not alter that tag.

## Architecture

```text
Browser → built React frontend + local Nginx → Express/TypeScript API → PostgreSQL
                                                  ↓ authenticated job
                                             isolated local n8n
                                        Coordinator → Info Agent → Welcome Agent
                                              ↕ OpenAI API
                                         authenticated callback → API
HR review/approval → manual invitation send → Resend SMTP → personal inbox
Employee activation → Argon2id account → server session → employee dashboard
```

PostgreSQL uses the `employee_onboarding` schema. The launcher creates its own Compose project, private network, database/n8n volumes and random secrets. Nothing depends on an existing Mac, HR account, database, external n8n instance or production credentials. Departments are explicitly fictional demo data. AI does not create external accounts, grant permissions, approve employees or send invitations.

## Prerequisites

- Git, Python **3.10+** and Docker with Compose v2 (`docker compose version`).
- macOS/Windows: Docker Desktop running, using Linux containers. Windows: Python from python.org with the Python launcher (`py`); PowerShell commands below. Linux: Docker Engine + Compose plugin and permission to use Docker.
- Recommend at least 4 GB available Docker memory and 6 GB disk; internet access for image/npm downloads, OpenAI and Resend. Node.js/npm are **not required on the host**.
- Your own authorized OpenAI API key, API billing and access to `gpt-4o-mini` with tool calling. ChatGPT subscriptions alone do not provide API billing.
- Your own authorized Resend API key with sending permission and a sender on a domain already verified for your account. Do not use another project's sender/key. This installer makes no DNS/MX changes.
- Free localhost ports 5173, 3009, 5681 and 8025. Alternatives are supported at configuration time.

## Which installation should colleagues use?

For **new independent installations**, use the portable `scripts/local.py` launcher below. It creates a separate Docker Compose project, database, n8n instance, credentials and HR account. **Do not reuse someone else's localhost URL, HR login, secrets, or database.** The `backend/compose*.yaml` plus `npm run dev` setup is a **legacy developer setup**, not the portable installation. Never combine commands or credentials from these two setups.

If you already run the legacy developer stack, do **not** run `local.py configure/up` expecting to control its containers. The launcher defaults to a separate project (`wbs-onboarding-local`) and will not find the developer project's configuration. `localhost` URLs refer to each person's own machine, not a shared hosted demonstration.

## Quick Start

macOS / Linux:

```sh
git clone --branch v1.0.0 https://github.com/klarekipro/wbs-employee-onboarding.git
cd wbs-employee-onboarding
python3 scripts/local.py configure
python3 scripts/local.py up
python3 scripts/local.py hr
```

Windows PowerShell:

```powershell
git clone --branch v1.0.0 https://github.com/klarekipro/wbs-employee-onboarding.git
cd wbs-employee-onboarding
py -3 scripts/local.py configure
py -3 scripts/local.py up
py -3 scripts/local.py hr
```

`configure` prompts privately for your OpenAI key and Resend key, asks for your verified sender, and generates independent database, callback, department, webhook and n8n encryption secrets. `up` builds both applications, applies migrations, imports credentials/workflows, publishes local production webhooks, verifies authentication/department/callback connectivity and SMTP TLS without sending email, then enables automatic dispatch for every registration. First startup can take several minutes. `hr` asks for your own username and hidden password; there is no default HR password or public setup endpoint.

Open **http://localhost:5173/login** and sign in with the HR credentials you just chose. Detailed, self-contained instructions: **[YURI-SETUP.md](docs/YURI-SETUP.md)**.

## Local URLs

| Service | Default URL | Purpose |
|---|---|---|
| Application | http://localhost:5173 | HR and employee UI; built frontend, same-origin `/api` proxy |
| Backend | http://localhost:3009/health | Health (`data.status: ok`) |
| n8n | http://localhost:5681 | Optional local editor; create your own editor owner account if prompted |
| Mailpit | http://localhost:8025 | Optional capture mode only; real Resend mail does not appear here |

PostgreSQL and Mailpit SMTP are internal-only; no host database port is required. All published ports bind to loopback. Keep `localhost` consistent; do not mix `127.0.0.1` with it in the browser. HTTP local cookies are HttpOnly/SameSite; deployed HTTPS behavior is not part of this release.

For occupied ports, configure before starting, for example:

```sh
python3 scripts/local.py configure --web-port 15173 --api-port 13009 --n8n-port 15681 --mailpit-port 18025
```

The frontend origin, invitation links and service URLs follow the selected ports automatically. The installer's default project is `wbs-onboarding-local`. To run another independent copy, consistently supply `--project wbs-onboarding-demo` **before** each subcommand and choose different host ports. Never mix the legacy `backend/compose*.yaml` operator scripts with this launcher.

## Environment and credentials

Private settings live in `.local-install/<project>/install.env`, excluded from Git and Docker build contexts. The launcher uses literal single-quoted Compose values, creates files with mode 0600 and directories with mode 0700 where supported. Windows users must keep the clone in their private user directory with restricted ACLs. Do not share the directory, a volume backup, `docker inspect` output or `docker compose config` output.

| Setting | Source / meaning |
|---|---|
| `OPENAI_API_KEY` | Your key, used only for encrypted credential import into local n8n; not passed to the API/frontend |
| `OPENAI_MODEL` | Defaults to `gpt-4o-mini`; requires tool support and funded API access |
| `SMTP_MODE` | `external` by default; `capture` and `disabled` are explicit development options |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER` | Resend defaults: `smtp.resend.com`, `465`, `true`, `resend` |
| `SMTP_PASSWORD`, `SMTP_FROM` | Your Resend API key and independently verified sender address |
| `DATABASE_PASSWORD` | Generated independent PostgreSQL password; keep unchanged while retaining database volume |
| `INTERNAL_API_SECRET`, `DEPARTMENTS_API_SECRET`, `N8N_ONBOARDING_WEBHOOK_SECRET` | Generated independent authentication keys; do not change without coordinated credential rotation |
| `N8N_ENCRYPTION_KEY` | Generated local n8n encryption key; retain with n8n volume/backups |
| `WEB_PORT`, `API_PORT`, `N8N_PORT`, `MAILPIT_PORT` | Chosen loopback host ports |

Derived by Compose: `APP_ORIGIN=http://localhost:<WEB_PORT>`, internal database URL, and local n8n webhook URL. The launcher enables dispatch only after preflight. There is no employee-ID processing restriction. Runtime configuration references are in [API contract](docs/api-contract.md); the legacy `.env.example` belongs to the original developer stack, not this clean installer.

No manual n8n JSON/database editing is needed. Initial imports assign credential IDs automatically and store credentials encrypted in the new n8n volume; the temporary plaintext import file is deleted. Routine restarts preserve workflow/static history and do not reimport. To rotate OpenAI, edit the existing **Onboarding OpenAI (local only)** credential in the local n8n editor, keeping its ID, and update the private installer file too. For SMTP changes edit `install.env` privately and run `up`; SMTP verification must pass before dispatch is enabled. Never regenerate database/encryption keys against retained volumes.

## End-to-end demonstration

1. Provision HR with `local.py hr`, then sign in. In HR register a fictional employee, e.g. **Demo Colleague**, department **IT**, role **Developer**, a valid start date, and a personal inbox you control. Use your own authorized address for real mail; `example.invalid` cannot receive real email.
2. Registration automatically queues Coordinator → Info Agent → Welcome Agent in **local** n8n. Visible HR pages refresh processing states every three seconds. Open the existing record; do not resubmit to retry. A completed plan has department facts and a German welcome message; failures remain explicit.
3. Review the actual result and click **HR-Freigabe erteilen**. Only completed processing permits approval. Approval and invitation are separate actions.
4. Click **Einladung senden** once. SMTP acceptance is reported truthfully and does not prove inbox delivery. Check Resend delivery events and the recipient's inbox/spam folder. Retry only after checking the existing record/provider status.
5. Open the invitation on the **same computer running the application**. The link uses the configured localhost origin. Choose a unique employee username and password; the 24-hour invitation is one-time use. Passwords are employee-selected, never generated by AI.
6. Use a separate browser profile/private window for the employee, keeping HR in its own profile. Sign in with the exact activated username. The employee dashboard has **Company Rules, My Training, My Team, My Tasks**. Logout clears that browser's active session. An employee cannot access `/hr` or another employee's profile.

Submitting an employee to this enabled local demo sends first/last name, department, job title, start date and department reference facts to OpenAI. The email is stripped before AI prompts; passwords, sessions and invitation tokens are excluded. Obtain the necessary authorization before using real employee information. Synthetic demo data is preferred.

## Checks, troubleshooting and lifecycle

```sh
python3 scripts/local.py check
python3 scripts/local.py status
python3 scripts/local.py stop   # retain containers, volumes and private settings
python3 scripts/local.py up     # restart/rebuild; no workflow reimport or account reset
python3 scripts/local.py down   # remove this project's containers/network, keep volumes/settings
```

Use `py -3` instead of `python3` on Windows. `check` probes health, rejects unauthenticated/invalid webhook requests, checks department lookup/authenticated callback validation and verifies external SMTP auth/TLS without sending a message. It does **not** fabricate AI completion or claim real inbox delivery. See [verification evidence](docs/verification.md).

- **Docker command failed / unavailable:** start Docker Desktop, confirm `docker version` and `docker compose version`, Linux Docker access, free disk/memory and outbound network. The launcher suppresses raw provider/import output because it can contain credentials. `status` safely shows container state. Do not paste raw env/config/credential exports into issues.
- **Port occupied:** do not stop another project's services. Choose four alternative ports at `configure` time; for an existing installation stop it, privately change only port settings in `install.env`, then run `up`.
- **Queued:** run `check` and ensure `up` finished enabling dispatch. A registered employee waits automatically when n8n was unavailable; do not create duplicates. A published webhook is `/webhook/wbs-onboarding`, not the test URL. Missing/wrong auth must return 403; authenticated `{}` must return 400.
- **AI failed:** verify local n8n execution status, model/tool access, billing/quota and its existing OpenAI credential. `check` is connectivity-only and cannot prove model billing. Completed/failed jobs are not silently replayed; see [local n8n recovery notes](docs/local-n8n.md) for operator constraints. Do not edit SQL to claim completion.
- **Login / CSRF:** use the configured exact localhost origin, fresh login after a restart if needed, exact activated username and separate HR/employee profiles. Never share passwords/screenshots of credentials. See [authentication](docs/authentication.md) for the legacy operator password rotation procedure; it does not target the new launcher project automatically.
- **SMTP auth/TLS fails:** verify the correct Resend sending key, network access to port 465, verified domain/sender and account restrictions. No email is sent by `up`/`check`. SMTP verification cannot guarantee a sender or recipient is authorized by the provider.
- **Activation link on another computer:** localhost refers to that other computer. Open on Yuri's host; this release does not expose the backend publicly, create a tunnel or deploy anything.

**Destructive cleanup, only when you want to delete this install's employees, accounts, invitations and n8n history:**

```sh
python3 scripts/local.py destroy --confirm-delete-local-data
```

This removes only the selected project's volumes and ignored configuration. It never removes other Docker projects. To retain data, back up both named volumes and the matching private encryption/database configuration securely; ordinary Git clone is not a backup.

## MVP limitations and release status

- Local single-machine demo, not a hosted employee portal. Invitations work only where the configured application origin is reachable; no VPS release is planned.
- Four employee areas are placeholders. No corporate mailbox/account provisioning, SSO, public password-reset email, workflow admin UI or external permission grants.
- Three fictional departments (IT, Marketing, Sales); AI results require human review.
- Dispatch has leases/idempotency and up to five attempts on delivery failure; failed AI callbacks and lost callbacks require operator diagnosis rather than unsafe replay. n8n static dedup history is best-effort; PostgreSQL state/callback validation remains authoritative.
- Local n8n saves no full successful/error execution payloads; event metadata and PostgreSQL show completion. Provider logs/privacy policies still apply. Resend acceptance differs from final delivery.
- Windows/Linux commands are provided; platform-specific verification coverage is listed in `docs/verification.md`.
- Current release candidate: [integration/mvp-v1](https://github.com/klarekipro/wbs-employee-onboarding/tree/integration/mvp-v1). Final review: [Draft PR #4](https://github.com/klarekipro/wbs-employee-onboarding/pull/4). No merge/tag occurs automatically. Proposed tag after owner approval: **v1.0.0**.
