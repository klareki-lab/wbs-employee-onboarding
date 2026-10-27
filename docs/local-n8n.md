# Local n8n integration — Employee Onboarding MVP v1

The safe connection is a new, isolated n8n 2.41.7 container on the existing **onboarding-only** Docker network. The editor binds only to `127.0.0.1:5681`; the backend stays on localhost:3009. n8n calls `http://api:3001` over Docker; the backend calls `http://n8n:5678/webhook/wbs-onboarding`. No tunnel, public backend exposure, live n8n modification, DNS, production credential reuse or mail changes are involved.

## Current verified state (2026-10-27)

- Local n8n: http://localhost:5681, with a dedicated `onboarding_n8n` volume and encryption key.
- A published **connectivity-only** workflow rejects unsigned requests with 403, reads all three departments using the independent read-only credential, and reaches the authenticated callback endpoint.
- The callback probe sends `{}` and confirms HTTP 400 `VALIDATION_ERROR`, demonstrating authentication and routing without changing any employee or onboarding job.
- Backend health is `ok`; Mailpit HTTP API is reachable and the backend SMTP adapter's `verify()` succeeds. No invitation for the authorized employee has been sent.
- Existing employee **Sergii Tytov**, ID `71fac882-8236-4641-98d5-86ffd1b60ab1`, has job `c4007247-e99e-4a31-8eb4-0f4462648996`. It is now `completed` after the reviewed model-initialization failure was corrected. The same job has two dispatch attempts, with the first failed result retained in `attempt_history`. The employee is still pending HR approval. No duplicate employee has been created.
- The earlier smoke-test employee is preserved separately and excluded by the selected-employee worker scope.
- **Real AI processing verified:** local execution **14** ran the Coordinator, `onboarding_info`, `departments_api`, and `welcome_announcement`, then output validation, `Callback: Completed`, and terminal persistence. The authenticated callback is stored in PostgreSQL. Team lead Sarah Miller and GitHub/Google Workspace/Jira match the department registry. Chrome shows HR approval enabled; sending remains disabled until HR approves. No approval or invitation was performed for this employee.

## Bootstrap/resume command (already executed for the authorized employee)

Add a valid, billing-enabled onboarding project key as `OPENAI_API_KEY=...` to the existing ignored **`backend/.env`** on this Mac, using your editor. Do not paste it into chat or shell history. Optional `OPENAI_MODEL` defaults to the export's existing `gpt-4o-mini`; use a model supported by the installed n8n OpenAI Chat Model node. This setup does not extract credentials from any other app or production instance.

For a new, unprocessed authorized employee, run from the repository root (do not rerun the completed employee):

```sh
python3 workflows/scripts/connect-local.py \
  --employee-id 71fac882-8236-4641-98d5-86ffd1b60ab1
```

This command first makes a tiny OpenAI tool-call readiness request containing **no employee information**. It checks model access and billing before any employee dispatch. It stops without altering jobs if the key is absent or rejected. Model requests go to the official OpenAI API; subsequent real agent prompts contain the existing employee's onboarding facts, excluding personal email.

With readiness confirmed, it verifies the selected employee already exists and is still pending/unprocessed, prepares/imports encrypted local credentials, publishes only the local onboarding workflow, restarts local n8n, tests connectivity and deterministic webhook validation, and sets:

```ini
N8N_ONBOARDING_WEBHOOK_URL=http://n8n:5678/webhook/wbs-onboarding
ONBOARDING_WORKER_EMPLOYEE_ID=71fac882-8236-4641-98d5-86ffd1b60ab1
```

The backend is rebuilt/restarted using the local overlay. The existing unavailable job automatically becomes queued and is dispatched by the normal durable worker. No database status reset, artificial callback, new registration or account creation is used. The optional employee scope limits both recovery of unavailable jobs and queue claims to this employee. Remove that scope from local configuration and recreate the API only when ready to process other registrations normally.

The command observes the job for up to 45 seconds; slow AI processing may continue afterward. Refresh the existing employee detail page. An actual terminal failure must be investigated rather than overwritten or silently retried with a new employee.

## Complete the demonstration

Once the existing employee shows `completed`, sign in as the existing HR user, open that employee's detail page, approve the invitation, and select send. The backend checks real processing completion and explicit HR approval. Confirm `smtp_accepted` and open the captured German invitation at **http://localhost:8025**. SMTP acceptance means Mailpit capture, not external inbox delivery.

The employee must choose their own username/password on the activation page. Do not generate an employee password, reveal the activation token in logs, or create a corporate mailbox. Activate once, sign in as the employee and verify the dashboard. Activation credential entry is an owner/employee interaction, not an AI-generated credential step.

## Bootstrap and checks already performed

For a fresh local n8n volume (preserve all existing onboarding volumes):

```sh
python3 workflows/scripts/prepare-local.py
docker compose --env-file backend/.env \
  -f backend/compose.yaml -f backend/compose.n8n.yaml up -d api n8n
python3 workflows/scripts/import-local.py
docker restart wbs-employee-onboarding-n8n-1
python3 workflows/scripts/check-local.py
```

`prepare-local.py` generates independent webhook/read-only bearer secrets if missing, preserves the backend callback secret and n8n encryption key, and renders local endpoint/model values. `import-local.py` imports only into the explicitly named new local container and publishes only the connectivity probe. Do not rerun imports during an in-flight employee execution.

Secrets are in ignored local files with mode 0600; the `.local` directory is mode 0700. Generated plaintext credential imports are transferred through stdin into a temporary mode-0600 container file and removed after import; the host credential JSON is also removed. n8n stores the imported credentials encrypted in its dedicated volume. No OpenAI key is provided to Code nodes or the backend Compose environment. Workflow execution payload persistence is disabled to avoid retaining webhook bearer headers. Code-node environment access remains blocked. The local n8n editor may request its own owner setup; that account is separate from the HR account and is not required for the CLI imports/probe.

## Integration corrections

- Added missing webhook IDs so routes register as `/webhook/wbs-onboarding` and `/webhook/wbs-onboarding-connectivity`.
- Replaced nonexistent Agent Tool version 1.9 with supported 2.2, aligned Coordinator version and actual `toolDescription`/node-name fields.
- Corrected generic Header Auth configuration for department and callback HTTP nodes and fixed callback retry settings to use n8n's actual node-level options.
- Moved bearer validation into the Webhook Header Auth credential. Code nodes no longer read secrets from environment variables.
- Local rendering resolves API URLs and model values, preserving the default block on Code-node environment access.

References: [n8n server CLI import/publish commands](https://github.com/n8n-io/n8n-docs/blob/main/docs/deploy/host-n8n/configure-n8n/use-the-command-line.md), [OpenAI model access](https://developers.openai.com/api/reference/resources/models/methods/list), [exported model documentation](https://developers.openai.com/api/docs/models/gpt-4o-mini). Installed n8n node schemas were also inspected directly to verify supported versions.

## P0 webhook preflight correction

The employee webhook had `options.ignoreBots: true`, while the connectivity webhook did not. n8n 2.41.7's Webhook implementation runs this User-Agent filter **before Header Auth** and before the workflow Code node. Both Python urllib and the backend's Node/undici client were rejected with 403 even though the same encrypted Header Auth credential succeeded on the connectivity route. The workflow was published and `/webhook/wbs-onboarding` was registered correctly. In-memory comparisons confirmed that the backend `.env`, running backend, and encrypted n8n Header Auth secret matched; no values were displayed.

The employee machine-to-machine webhook now sets `ignoreBots: false`; Header Auth remains required. Code-node environment access stays blocked and the validator does not read `$env`. No production instance was changed. The resume script now delegates its employee-webhook preflight to the shared checker, which verifies all three cases:

```sh
python3 workflows/scripts/check-local.py --employee-webhook
```

Verified locally: missing credential → 403; incorrect credential → 403; correct credential with invalid body `{}` → 400 from deterministic validation. Connectivity, department lookup, callback-schema rejection, backend health and Mailpit checks also pass. These checks do not create or change employees/jobs.

Resuming the real employee job transmits the employee's first/last name, department, role and start date plus department facts to OpenAI via the local agents. Personal email, passwords and invitation tokens are excluded from model prompts. Automatic approval review required explicit owner approval for that specific external transmission; the local fix and non-mutating checks are complete independently of approval.

## Model-schema correction and audited local recovery

The first dispatch (execution **11**) reached the Coordinator but could not initialize its OpenAI Chat Model: node version 1.2 reads `model.value`, while the exports/local renderer supplied a plain string. Both exports and the local renderer now supply an n8n resource locator `{__rl:true,mode:"id",value:...}`. The corrected execution **14** actually ran both subagents and the department tool; event metadata and the persisted callback independently confirm success.

Migration `002_job_attempt_history.sql` adds an append-only-by-application history array to the existing job. A local-only operator command, `node dist/retry-local-job.js <employee-id> <expected-attempts> "<reviewed technical reason>"`, can archive a reviewed terminal `AGENT_PROCESSING_FAILED` result and return that same job to unavailable. It requires dispatch to be disabled, a pending employee, development/test mode, and an exact attempt count. It does not change employee status, HR accounts, approval, invitations, IDs or the existing attempt counter. It is not exposed over HTTP or to agents. The regression test verifies those guards, exact failure preservation and rejection of repeated recovery.

After an explicit recovery, `connect-local.py` requires that archived history and moves only that job's failed local n8n dedup record into `archivedAttempts` before normal reprocessing. The original PostgreSQL callback and n8n dedup failure are both retained. Normal terminal callbacks remain immutable; no synthetic completion is written. This recovery was used only for the authorized existing test after the diagnosed model-schema error.

The owner explicitly approved the real AI test's specified prompt fields. Personal email and authentication/activation secrets were excluded. Worker dispatch remains scoped to the authorized employee. Next action is **manual HR review and approval** on the existing detail page; only HR may then send the invitation, and only the employee chooses activation credentials.
