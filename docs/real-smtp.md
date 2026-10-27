# Employee Onboarding — real SMTP acceptance

The primary acceptance path is now an invitation in the employee's actual personal inbox. Mailpit remains only for explicit regression tests; it is not proof of external delivery. The existing employee, completed AI result, HR account, database volume, and n8n setup are preserved. No Messe Hub mail settings, production sender, DNS/MX, production workflow or production deployment is changed.

## Current state

No independently authorized SMTP host, username/password or real sender has been provided. The running local app therefore uses **`SMTP_MODE=disabled`** rather than silently capturing acceptance invitations in Mailpit. The approved-to-send guard is unchanged. For employee `71fac882-8236-4641-98d5-86ffd1b60ab1`, AI processing is completed and HR approval has now been recorded (2026-10-27 17:04 UTC). No invitation exists and no external invitation has been sent. The implementation did not approve the employee; the existing HR approval is preserved.

## Exact owner configuration

A private, ignored file already exists at **`backend/.env.smtp`**, mode 0600, based on `backend/smtp.env.example`. Fill it in using your editor; never paste secrets into chat or terminal arguments:

```ini
SMTP_HOST=<your independently authorized provider's SMTP hostname>
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=<dedicated onboarding SMTP username>
SMTP_PASSWORD='<dedicated onboarding SMTP password or provider SMTP API key>'
SMTP_FROM=<independently authorized onboarding sender email>
```

Use the provider's exact credential format. For implicit TLS on port 465, set `SMTP_PORT=465` and `SMTP_SECURE=true`; for STARTTLS on 587, use `false` (TLS is still mandatory). Quote values appropriately under Compose's .env syntax so dollar signs in passwords are not interpolated. Do not copy any Messe Hub/production sender or credential. Prefer an app-specific credential dedicated to onboarding. Sender verification/permission belongs to the provider account; no DNS/MX record is created or altered by this setup. If a new sender needs domain verification, the owner must authorize and perform that separately.

Check the existing `backend/.env` application origin before sending:

```ini
APP_ORIGIN=http://localhost:5173
```

The backend creates **`${APP_ORIGIN}/activate#token=...`**; the raw token is sent only in the approved email and is never returned to HR or logged. The origin must be exact, without a path/trailing slash, and must match the browser frontend Origin for authentication/activation POSTs.

### Localhost limitation

A real email can be delivered while the application runs locally. Its `localhost:5173` link opens the application only on **the Mac running this frontend/backend**. Opening it on a phone or another computer points to that device, where the app is not running. For the local acceptance demo, read the personal mailbox on this Mac and open the link in its browser while Vite/Docker are running. Do not share or paste the activation token into chat.

Remote employee activation requires a separately approved reachable HTTPS frontend/API origin and matching routing/CORS/cookie configuration. Setting a public URL alone does not expose or deploy the app. This task does not open a tunnel, expose the backend publicly, change DNS, or deploy production resources.

## Verify and switch — no invitation sent

After saving the dedicated credentials, run from the repository root:

```sh
python3 backend/scripts/enable-real-smtp.py
```

The script validates required settings without echoing values, builds the backend, and runs a **one-off SMTP verify command** on the onboarding network before replacing the running API configuration. It checks DNS/TCP, TLS/certificate validation and SMTP authentication with Nodemailer. It sends no message and creates no invitation. If preflight fails, it stops without switching the running API. No raw provider response or credential is logged.

The real adapter requires TLS independently of `NODE_ENV`, certificate verification and TLS 1.2+. STARTTLS cannot silently downgrade; port 465 requires implicit TLS. `verify()` does **not** prove provider permission for the From address, recipient acceptance, inbox placement or final delivery. Confirm the sender is authorized in your provider account before HR sends.

On success the script recreates only the onboarding API using these layers:

```sh
docker compose --env-file backend/.env --env-file backend/.env.smtp \
  -f backend/compose.yaml -f backend/compose.n8n.yaml \
  -f backend/compose.smtp.yaml up -d --no-deps api
```

Always include the SMTP overlay and separate env file when intentionally restarting the real-SMTP API. Restarting with only the base configuration returns to the explicit `SMTP_MODE` in `backend/.env` (currently disabled), avoiding an accidental Mailpit fallback. Never run Compose config/inspect commands that print expanded environment secrets into chat or logs.

Health remains `http://localhost:3009/health`; configured email is not a claim that the remote provider is reachable or a message was delivered. To repeat the no-message verification in the configured API:

```sh
docker exec wbs-employee-onboarding-api-1 node dist/verify-smtp.js
```

This prints only sanitized verification status/error codes, never the password, raw SMTP responses, or invitation tokens. On a failed switch or bad credentials, correct the separate file and rerun the enable script; do not create a new employee or invitation as a connectivity test.

## HR-controlled acceptance

1. Sign in as the existing HR user and open `http://localhost:5173/hr/employees/71fac882-8236-4641-98d5-86ffd1b60ab1`.
2. Review the real AI result and the existing personal recipient address. **HR explicitly approves** using “HR-Freigabe erteilen” if not already approved. This existing employee is already approved; do not repeat or reset that decision. SMTP setup does not approve anyone.
3. Select “Einladung senden” once. The backend independently enforces approval and uses only the personal address from that approved record. AI cannot select recipients.
4. Check the returned/detail `delivery_status`. **`smtp_accepted` means accepted by the configured SMTP server, not final inbox delivery.** Confirm receipt in the employee's personal inbox and, if needed, use the provider's delivery/bounce log. Neither Mailpit contents nor an accepted SMTP response alone satisfies inbox acceptance.
5. If status is `sending` or `unknown`, inspect it before taking another action. Repeated sends reuse the valid pending invitation and never create another email automatically. A lost/uncertain link requires explicit HR revocation and then a new send; the old link becomes invalid. Never repeatedly send to diagnose connectivity.
6. The employee opens the received link on this Mac, chooses their own username/password, activates once and signs in. Verify Company Rules, My Training, My Team and My Tasks. No password is generated by AI; no corporate mailbox/account is created.

HR approval is already recorded for the existing employee. Owner SMTP configuration/verification, HR send, actual inbox receipt and employee activation/login remain **pending** until observed. Do not claim delivered or activated prematurely.

## Verification performed for this change

- TypeScript build passed.
- External SMTP mode refuses the plaintext-only local Mailpit server with `ETLS` before authentication; no message sent.
- Disabled delivery mode refuses verification/sending, even when a capture host exists.
- Full focused HTTP/PostgreSQL/Mailpit regression passed in `onboarding_test` with capture mode explicitly enabled for fictional test fixtures. Authorization, HR approval gating, duplicate prevention and one-time activation still work.
- Real-provider connectivity/TLS/authentication and inbox delivery are **not yet tested** because the independent provider/sender credentials are missing.

Reference: [Nodemailer SMTP transport and TLS](https://nodemailer.com/smtp).
