# Yuri's independent local setup

You need only this public repository, your own provider credentials, Python 3.10+, Git and running Docker with Compose v2. You do not need the owner's Mac, database, Docker volumes, HR account, n8n account, API keys or Node.js installation. No VPS is used.

## 1. Install prerequisites

- **macOS:** install Git, Python 3.10+ and Docker Desktop; start Docker Desktop. Run commands in Terminal using `python3`.
- **Windows:** install Git for Windows, Python 3.10+ from python.org (include the `py` launcher), and Docker Desktop with Linux containers/WSL2 enabled. Start Docker Desktop. Run commands in PowerShell using `py -3` instead of `python3`.
- **Linux:** install Git, Python 3.10+, Docker Engine and the Compose v2 plugin. Your user must have permission to use Docker. Run commands in a terminal using `python3`.

Confirm `git --version`, `docker version`, `docker compose version` and `python3 --version` (Windows: `py -3 --version`). Allocate about 4 GB Docker memory and 6 GB free disk. Image builds and provider calls need internet access.

Prepare **your own authorized OpenAI API key** with API billing, `gpt-4o-mini` and tool-call access, plus **your own Resend sending API key and an already verified sender address/domain**. A ChatGPT subscription is not API credit. Do not use another project's sender or credentials. This installer does not modify DNS/MX. Keys are entered with hidden terminal prompts; never send them in chat, commits or screenshots.

## 2. Clone and configure

macOS/Linux:

```sh
git clone --branch integration/mvp-v1 https://github.com/klarekipro/wbs-employee-onboarding.git
cd wbs-employee-onboarding
python3 scripts/local.py configure
```

Windows PowerShell:

```powershell
git clone --branch integration/mvp-v1 https://github.com/klarekipro/wbs-employee-onboarding.git
cd wbs-employee-onboarding
py -3 scripts/local.py configure
```

Enter your OpenAI key (hidden), Resend key (hidden), and verified sender email address. The script generates fresh PostgreSQL, webhook, callback, department and n8n encryption secrets. There is no default HR password. Keep this clone in your private user directory; on Windows use private user-folder ACLs.

Private file: `.local-install/wbs-onboarding-local/install.env`. It is excluded from Git and image build contexts. Never share this file, the `.local-install` folder or Docker credential/config exports. Do not regenerate the database/encryption keys while keeping their volumes.

Default ports are 5173 (web), 3009 (API), 5681 (n8n), 8025 (optional Mailpit UI), all loopback-only. If occupied, choose alternatives **on the first configure command**:

```sh
python3 scripts/local.py configure --web-port 15173 --api-port 13009 --n8n-port 15681 --mailpit-port 18025
```

For Windows replace `python3` with `py -3`. If already configured, do not overwrite secrets: stop this install, edit only the port values privately in `install.env`, and run `up`. The application origin and invitation links follow the web port automatically.

## 3. Start the complete application

```sh
python3 scripts/local.py up
python3 scripts/local.py hr
```

Windows:

```powershell
py -3 scripts/local.py up
py -3 scripts/local.py hr
```

First build takes several minutes. Docker builds the TypeScript API and React frontend, starts a new database and local n8n, applies migrations with fictional departments, imports credentials and both onboarding/connectivity workflows, publishes the authenticated webhooks, checks department lookup/callback validation, verifies SMTP authentication/TLS **without sending email**, then enables the automatic worker. You do not edit n8n JSON or database tables.

`hr` prompts for a new lowercase username (3–64 letters/digits/`._-`) and a hidden password (12–128 characters), entered twice. It creates your HR account in this installation only. Existing usernames are never overwritten. Remember the credentials yourself; the installer does not store a plaintext HR password.

Open **http://localhost:5173/login**, using your chosen web port if different, and sign in as HR.

| URL (default ports) | Use |
|---|---|
| http://localhost:5173 | Complete application; `/api` is proxied on the same origin |
| http://localhost:3009/health | Backend health: `data.status` is `ok` |
| http://localhost:5681 | Local n8n editor; create your own editor owner account if requested |
| http://localhost:8025 | Mailpit only for explicit capture mode; real Resend invitations do not appear here |

Use `localhost` consistently, not `127.0.0.1`. Browser authentication is a server session with HttpOnly cookies and CSRF/Origin checks; no secrets belong in browser localStorage.

## 4. Demonstrate the workflow

1. In HR, register a **synthetic employee**, for example first name `Demo`, last name `Colleague`, department `IT`, job `Developer`, and a valid start date. For real delivery, use **an inbox you own/control**, not an invented recipient. Obtain authorization before submitting real personal data.
2. Wait on the HR detail page. Status refreshes every three seconds while processing. Registration automatically calls local n8n: **Coordinator → Info Agent (read-only department lookup) → Welcome Announcement Agent → authenticated backend callback**. No employee-specific whitelist or extra dispatch command is needed.
3. Confirm processing is **completed**. Read the department facts and German welcome message. Click **HR-Freigabe erteilen** yourself. AI cannot approve or send.
4. Click **Einladung senden** yourself. Check the reported SMTP status, Resend delivery events, actual inbox and spam folder. SMTP acceptance is not guaranteed final inbox delivery. Do not repeatedly click send or create another registration if mail is delayed.
5. Open the secure invitation on **the computer running this application**. A localhost link opened on a different device points to that device, so it will fail there. This release does not add public exposure, tunnels or hosting.
6. Activate with a unique employee username and employee-chosen password. Invitations expire after 24 hours and can be used once. Keep passwords and invitation links private.
7. Keep HR in its own browser profile. Use a private window or separate profile for the employee, sign in using the **exact username chosen at activation**, and open the Employee Dashboard: Company Rules, My Training, My Team, My Tasks. These four pages are placeholders. Employees cannot access `/hr`; logging out clears their active session.

AI prompts contain only first/last name, department, job title, start date and department reference facts. Personal email is stripped before prompts; passwords, session credentials and invitation tokens are excluded. No corporate mailbox or external access permission is created.

## 5. Check, restart and troubleshoot

```sh
python3 scripts/local.py check
python3 scripts/local.py status
python3 scripts/local.py stop
python3 scripts/local.py up
```

`check` verifies services, webhook authentication, department lookup, callback schema rejection and real SMTP auth/TLS without sending mail or claiming AI completion. `up` preserves accounts, database and n8n history and does not repeat initial imports. `down` removes only this project's containers/network, retaining volumes and configuration; `up` restores them.

- **No Docker / command failed:** start Docker Desktop; verify Compose v2, Docker permission on Linux, free resources/ports and internet. The installer hides raw failure output because it may contain credentials. `status` shows only this project's service state.
- **Queued:** finish `up`, run `check`, then inspect the existing HR record. Do not create duplicates. The normal production webhook is `/webhook/wbs-onboarding`, not `/webhook-test/...`; initial publication is automatic.
- **Failed AI:** inspect your local n8n execution metadata and OpenAI billing/model/tool access. Connectivity checks do not prove API billing. A failed terminal result is not automatically fabricated or replayed; see [local-n8n.md](local-n8n.md) for safe operator constraints.
- **SMTP failure:** verify your Resend sending key and authorized sender, account recipient restrictions, and outbound TLS port 465. No DNS/MX changes are made for you. Check actual delivery in Resend/inbox.
- **Wrong user/CSRF:** use the exact localhost origin, correct activated username, and separate profiles for HR and employee. Sign in again; never paste cookies or passwords into an issue.
- **Change keys:** update SMTP settings privately in `install.env`, then run `up`. For OpenAI, update the existing **Onboarding OpenAI (local only)** credential in the local n8n editor without changing its ID, and update `OPENAI_API_KEY` privately in the installer file for consistency. Do not delete encryption keys or rerun imports over existing history.

To start without real email for a synthetic/captured demonstration, choose `configure --mail-mode capture` on a separate fresh install; invitations then go only to Mailpit. `--mail-mode disabled` prevents sending. Neither mode proves real recipient delivery. OpenAI is still a real external provider; use synthetic facts and your authorized key.

**Delete this installation only if you intend to lose all its employees, accounts, invitations and n8n history:**

```sh
python3 scripts/local.py destroy --confirm-delete-local-data
```

On Windows substitute `py -3`. Ordinary stop/down does not delete data. The explicit destroy command targets only `wbs-onboarding-local`; other applications are not changed. Keep private volume/configuration backups if you need recovery; Git is source code, not a data backup.

## Release and verification

Source: https://github.com/klarekipro/wbs-employee-onboarding/tree/integration/mvp-v1

Final review: https://github.com/klarekipro/wbs-employee-onboarding/pull/4 (Draft; not merged)

Exact tested results/platform limits: [verification.md](verification.md). The four employee areas are placeholders; local single-machine operation, provider access and a reachable invitation origin are intentional MVP limits. No VPS is planned. Version `v1.0.0` is proposed after owner approval, with no automatic merge or tag.
