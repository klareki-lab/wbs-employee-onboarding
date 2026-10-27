# Local n8n integration — Employee Onboarding MVP v1

The safe connection is a new, isolated n8n 2.41.7 container on the existing **onboarding-only** Docker network. The editor binds only to `127.0.0.1:5681`; the backend stays on localhost:3009. n8n calls `http://api:3001` over Docker; the backend calls `http://n8n:5678/webhook/wbs-onboarding`. No tunnel, public backend exposure, live n8n modification, DNS, production credential reuse or mail changes are involved.

## Current verified state (2026-10-27)

- Local n8n: http://localhost:5681, with a dedicated `onboarding_n8n` volume and encryption key.
- A published **connectivity-only** workflow rejects unsigned requests with 403, reads all three departments using the independent read-only credential, and reaches the authenticated callback endpoint.
- The callback probe sends `{}` and confirms HTTP 400 `VALIDATION_ERROR`, demonstrating authentication and routing without changing any employee or onboarding job.
- Backend health is `ok`. Real-inbox acceptance now follows [real-smtp.md](real-smtp.md); delivery is disabled until independent SMTP settings pass verification. No invitation for the authorized employee has been sent.
- Existing employee **Sergii Tytov**, ID `71fac882-8236-4641-98d5-86ffd1b60ab1`, has job `c4007247-e99e-4a31-8eb4-0f4462648996`. It is now `completed` after the reviewed model-initialization failure was corrected. The same job has two dispatch attempts, with the first failed result retained in `attempt_history`. The employee is still pending HR approval. No duplicate employee has been created.
- The single-employee guard used for the first controlled test is retired from the worker and configuration. After authorized rollout, all eligible queued/unavailable jobs are dispatched; completed/failed jobs are not re-claimed.
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
```

The backend is rebuilt/restarted using the local overlay. The existing unavailable job automatically becomes queued and is dispatched by the normal durable worker. No database status reset, artificial callback, new registration or account creation is used. There is no employee-specific dispatcher filter. `--employee-id` selects the existing record to observe during bootstrap; it never restricts worker claims. Do not rerun bootstrap for each registration: the running worker automatically claims every eligible queued job. The bootstrap removes the obsolete test setting and preserves an already configured real SMTP overlay.

The command observes the job for up to 45 seconds; slow AI processing may continue afterward. Refresh the existing employee detail page. An actual terminal failure must be investigated rather than overwritten or silently retried with a new employee.

## Complete the demonstration

Once the independent real SMTP adapter is configured and verified per [real-smtp.md](real-smtp.md), sign in as the existing HR user, review the completed employee, explicitly approve, and select send. The backend enforces processing completion and HR approval. Confirm `smtp_accepted`, then verify the German invitation in the employee's real personal inbox. SMTP acceptance is not final inbox delivery; Mailpit is no longer the primary acceptance path.

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

The owner explicitly approved the real AI test's specified prompt fields. Personal email and authentication/activation secrets were excluded. The former per-employee test restriction is removed from the implementation; activating automatic processing requires the owner's authorization for the real pipeline's employee-data transmission. Next action is **manual HR review and approval** on the existing detail page; only HR may then send the invitation, and only the employee chooses activation credentials.

## Automatic processing after the controlled test

Root cause of the second registration remaining queued: the retired `ONBOARDING_WORKER_EMPLOYEE_ID` configuration still selected the first, already-completed employee, and the bootstrap wrote that restriction back on each run. A different queued employee could never be claimed, so it stayed at zero attempts. The live n8n workflow and webhook authentication were healthy; disabled approval/invitation controls correctly reflected unfinished processing.

The worker/config/Compose/template no longer support that filter. Bootstrap now configures automatic processing, uses its employee argument only for observation, cleans up the retired setting, and retains real SMTP when that profile is configured. Leases, SKIP LOCKED claims, retry delay/limit, stable job IDs/idempotency keys, callback authentication/state validation and HR approval rules are unchanged. Existing queued records require no reset or duplicate registration.

HR detail/list pages now refresh live queued/dispatching/awaiting-result states every three seconds while visible. Completed and failed states stop polling, remain explicitly labeled, and only successful completion of a pending employee enables manual approval. The polling code only performs reads; it cannot approve or send.

Regression: a real HTTP/PostgreSQL test with a mock orchestrator processes the first employee, registers the second afterward, observes automatic dispatch, injects one webhook 503, verifies retry delay and the unchanged job/idempotency key, then stores a validated completion callback. The first result stays unchanged, no duplicate employee/job is created, and the second remains unapproved with zero invitations. The retired environment setting cannot filter these jobs even if supplied. Test database: onboarding_dispatch_test; SMTP disabled; no real AI or email used by this regression. All 29 frontend tests and both builds pass.

Owner authorization subsequently covered the queued second employee and future local HR registrations: names, department, job title, start date and department reference facts may be sent to OpenAI through local n8n. The obsolete private env entry was removed and only the API was rebuilt/recreated with both n8n and existing external SMTP overlays. Automatic processing is now running without the employee filter. No new credentials, workflow import, database reset or duplicate employee was required. Personal email is removed before agent prompts; passwords, session credentials and invitation tokens never enter those prompts.

The existing second job `d406852f-bd45-4760-9c36-c5e516cd09a9` completed on attempt 1 at 2026-10-27 19:28:51 UTC, correlated with local n8n execution 18. Finished-node and generated-model metadata confirms the real Coordinator, Info Agent, department tool, Welcome Agent, strict output validation, completed callback and terminal persistence; the workflow-success event was recorded. PostgreSQL independently contains the completed result, a matching department lead, three necessary accounts and a 236-character welcome message. The employee remains pending/unapproved with zero invitations. The pre-existing fictional smoke job was also recovered automatically (execution 17); no employees were added. The first activated employee's job remains completed with its existing attempt count and invitation.

Backend health and frontend return HTTP 200. Authenticated empty webhook preflight returns 400; missing/wrong authentication returns 403. Runtime SMTP remains external Resend. All 29 frontend tests pass, including terminal status and approval gating. Read-only visible HR pages poll every three seconds while processing; completed + pending enables the manual approval control. The available browser profile is employee-authenticated, so visual HR-session acceptance remains an HR check rather than an assertion of this verification. HR should open the existing detail page, review the stored result and manually approve; sending remains a separate manual action.
