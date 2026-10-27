# WBS Employee Onboarding — n8n workflows (MVP v1)

Importable, **unpublished** n8n workflows for the WBS Employee Onboarding Assistant. These workflows are the n8n side of the contract defined in `feat/backend:docs/integration.md` and `docs/api-contract.md` and the design in `workflows/ARCHITECTURE.md`.

- Target n8n version: **2.41.7** (self-hosted).
- Live deployment: **do not activate** on the production n8n host. These files are for import, review and local inspection only.
- Boundaries: this branch owns only `/workflows`. It does not modify the Trade Fair Assistant, the production n8n host, DNS, SMTP, or the production database.

## Files

| File | Purpose |
|------|---------|
| `ARCHITECTURE.md` | Execution contract, boundaries, system flow. |
| `onboarding-webhook.json` | Production-oriented Webhook workflow: deterministic validation → idempotency → Coordinator AI Agent (two AI Agent Tools) → strict output validation → authenticated callback. |
| `onboarding-chat-trigger.json` | WBS Chat Trigger demonstrator for the assignment. Same coordinator + two tools, driven by chat. No callback and no email. |
| `README.md` | This file. |

## Required credentials (configure in n8n before import)

Create these as named n8n credentials and then re-link them inside each imported workflow (the exports contain `REPLACE_*_CREDENTIAL_ID` placeholders).

1. **OpenAI (`OpenAI (configure in n8n)`)** — OpenAI API credential. Model defaults to `gpt-4o-mini` (cost-efficient) and can be overridden via the `OPENAI_MODEL` environment variable.
2. **Onboarding Webhook Secret** — not an n8n credential, but a webhook bearer secret. The `Validate Input (Headers + Schema)` node compares the incoming `Authorization: Bearer …` against the `N8N_ONBOARDING_WEBHOOK_SECRET` environment variable. This secret is **independent** of the Trade Fair webhook keys.
3. **Departments API Secret (`httpHeaderAuth`)** — Header Auth credential:
   - Name: `Authorization`
   - Value: `Bearer <DEPARTMENTS_API_SECRET>`
4. **Internal API Secret (`httpHeaderAuth`)** — Header Auth credential:
   - Name: `Authorization`
   - Value: `Bearer <INTERNAL_API_SECRET>`

The two Header Auth credentials are intentionally separate because `DEPARTMENTS_API_SECRET` authorises read-only department lookups and must not be accepted on the callback route.

## Required environment variables (n8n host)

| Name | Example | Purpose |
|------|---------|---------|
| `N8N_ONBOARDING_WEBHOOK_SECRET` | 32+ random chars | Bearer secret the backend uses to call this webhook. |
| `BACKEND_BASE_URL` | `http://backend:3000` | Reachable base URL of the onboarding backend from inside the n8n container. `localhost` inside the n8n Docker container is NOT the host. |
| `OPENAI_MODEL` | `gpt-4o-mini` | Optional, defaults to `gpt-4o-mini`. |

## Import instructions

1. In n8n, open **Workflows → Import from File** and import `onboarding-webhook.json`.
2. Open each `OpenAI` sub-node, each HTTP Request tool and the two HTTP Request callback nodes, and re-select the credentials you created above.
3. Repeat for `onboarding-chat-trigger.json`.
4. Keep both workflows **inactive**. Do not activate on the production host.

## Testing

Two test modes are available. The **E2E mode** is the only path that can produce a successful backend callback, because `/api/internal/onboarding/result` rejects results for jobs with no recorded dispatch attempt. Standalone curl against the n8n Webhook can only exercise the webhook/agent half of the pipeline — the callback will be rejected by the backend by design.

### Mode A — Backend-driven end-to-end (full happy path)

1. Start the backend from `feat/backend` with Mailpit per its README (SMTP captured, no real delivery). Run migrations as the owner role. Seed the three demo departments (IT, Marketing, Sales).
2. Configure the backend's `N8N_ONBOARDING_WEBHOOK_URL` to point at the n8n test webhook URL from Execute workflow, and set its `N8N_ONBOARDING_WEBHOOK_SECRET` to match n8n's env var. Also set `INTERNAL_API_SECRET` and `DEPARTMENTS_API_SECRET` consistently on both sides.
3. Expose the backend to the n8n container at a URL that resolves from inside Docker (`BACKEND_BASE_URL`): Docker Desktop → `http://host.docker.internal:3000`; Linux → the Docker bridge gateway or the Compose service name. `localhost` inside the n8n container is NOT the host.
4. Click **Execute workflow** on the n8n Webhook node to arm the test URL.
5. Create an employee via the backend's authenticated HR API (login, obtain the CSRF token, then `POST /api/onboarding` with a valid EmployeeInput). The backend commits the employee + job, its in-process worker polls every ~2 s, leases the job and dispatches it to n8n with the correct `Authorization`, `Idempotency-Key` and body.
6. Observe in n8n: Webhook responds `202 awaiting_result`; Coordinator invokes both tool subagents; Validate Output passes; Callback: Completed POSTs the strict JSON to `/api/internal/onboarding/result`; Persist Terminal State writes the dedup record.
7. In the backend, `GET /api/hr/employees/:id` should now show `processing_status: "completed"` and the stored `orchestration_result`.
8. Chat demo: open `onboarding-chat-trigger.json` and click **Chat** on the Chat Trigger. Example: `New employee: Tom Becker, Backend Developer in IT, starts 2026-11-03`. This path never calls the backend callback and never sends email.

### Mode B — Webhook-only smoke (NOT a full E2E)

Use this only to confirm the webhook accepts a signed request, the deterministic gate works, the Coordinator invokes both subagents and the output validator passes. **The callback will be rejected by the backend with 409 `ILLEGAL_JOB_TRANSITION` / `CALLBACK_CONFLICT` or a validation error because no dispatch attempt is recorded for the fabricated `job_id`.** This is expected — do not interpret the resulting failed-callback status as a product bug.

```bash
JOB_ID=$(uuidgen | tr '[:upper:]' '[:lower:]')
EMP_ID=$(uuidgen | tr '[:upper:]' '[:lower:]')
curl -X POST "$WEBHOOK_URL" \
  -H "Authorization: Bearer $N8N_ONBOARDING_WEBHOOK_SECRET" \
  -H "Idempotency-Key: $JOB_ID" \
  -H "Content-Type: application/json" \
  -d "{
    \"event\":\"employee.onboarding.requested\",
    \"job_id\":\"$JOB_ID\",
    \"employee_id\":\"$EMP_ID\",
    \"first_name\":\"Tom\",\"last_name\":\"Becker\",
    \"department\":\"IT\",\"role\":\"Backend Developer\",
    \"start_date\":\"2026-11-03\",
    \"personal_email\":\"tom.becker@example.com\"
  }"
```

Expected: webhook returns `202 awaiting_result`; n8n execution log shows both subagents invoked and output validated. The subsequent authenticated callback will be rejected by the backend because the `job_id` was never dispatched — this proves the backend contract is enforced, not an n8n defect.

### Negative tests

- Invalid bearer → `400` from Webhook, agents never run.
- Mismatched `Idempotency-Key` ≠ `body.job_id` → `400`.
- Replayed delivery (same `job_id` after a terminal result) → `200 replayed`, agents not re-invoked.
- Unknown department in Chat demo → Info Agent returns `DEPARTMENT_UNKNOWN`, Coordinator surfaces the failure.

## How the WBS requirement is satisfied

- **One Coordinator AI Agent** (`Onboarding Coordinator (AI Agent)` / `Onboarding Coordinator (Chat)`) orchestrates the plan.
- **Two genuine AI Agent Tools**, wired via `ai_tool` connections:
  - **Onboarding Info Agent** (`@n8n/n8n-nodes-langchain.agentTool`) — its own LLM + an `@n8n/n8n-nodes-langchain.toolHttpRequest` that calls `GET /api/internal/departments`. Never invents team leads or accounts.
  - **Welcome Announcement Agent** (`@n8n/n8n-nodes-langchain.agentTool`) — its own LLM. Drafts a short German welcome message. Does NOT send email.
- The Coordinator must invoke both subagents (via the agent framework) before producing the final structured JSON. A linear chain of independent LLM calls would NOT satisfy the exercise and is explicitly avoided.

## Deterministic validation layers

The LLM is never trusted at the trust boundary:

- **Input validation** (`Validate Input (Headers + Schema)`): Bearer check against env secret, event name, UUID shape for `job_id` and `employee_id`, header `Idempotency-Key == body.job_id`, type/range checks for names, department, role, `YYYY-MM-DD` date, email shape.
- **Output validation** (`Validate Output (Strict Schema)`): JSON must parse; `team_lead` 1–200 chars; 1–30 account labels each 1–200 chars; `welcome_message` 1–4000 chars; otherwise `AGENT_PROCESSING_FAILED`.

Both validations match the backend contract (`api-contract.md`, `integration.md`) exactly.

## Idempotency: implementation and limitation

- Keyed on `job_id`.
- Storage: n8n **workflow static data** (`$getWorkflowStaticData('global')`), written in the `Idempotency Check (job_id)` node and finalised in `Persist Terminal State` / `Persist Failed State`.
- Known duplicates with a terminal status short-circuit to `200 replayed`.

**Important wiring detail.** The HTTP Request callback nodes replace the current item's `$json` with the backend response body (`{processing_status, replayed}`), which does not carry `job_id`. Both persist nodes therefore pull `job_id` from the earlier `Idempotency Check (job_id)` node, and the completed path pulls `team_lead` / `necessary_accounts` / `welcome_message` from `Validate Output (Strict Schema)` via explicit `$('<node>').item.json` lookups. Without this, the dedup record would be written with `undefined` and subsequent duplicate deliveries would re-run the LLM.

**Limitation (explicit).** Workflow static data is persisted by n8n but is not a dedicated distributed job store. Under aggressive concurrency the window between `Idempotency Check` and `Persist Terminal State` can allow a parallel delivery to re-invoke the agents, and a hard crash between those nodes can leave `in_progress` state behind for ~30 s. The backend callback endpoint deduplicates terminal results and rejects conflicting ones with `409 CALLBACK_CONFLICT`, so **duplicate agent runs cannot corrupt the stored outcome**, but they can incur duplicate OpenAI costs.

Replace with Postgres (`SELECT … FOR UPDATE SKIP LOCKED` on an `n8n_onboarding_jobs` table) or Redis (`SETNX job_id`) for strict single-run guarantees. This replacement is out of scope for MVP v1 and gated on operator decision.

## Failure handling

Three distinct failure paths, all funnelled into a single `Callback: Failed` → `Persist Failed State` chain:

1. **Deterministic rejection** — invalid headers or body → HTTP 400 immediately, agents never run.
2. **Invalid structured output** — `Validate Output (Strict Schema)` returns `valid:false` with an `error_code` → `Callback: Failed`.
3. **Thrown agent/tool exception** — the Coordinator agent node is configured with `onError: continueErrorOutput`. If the agent itself throws (model unavailable, tool timeout surfaced as an exception, output parser crash) the error output is wired through `On Agent Error (map to failed)` → `Callback: Failed`.

Known terminal duplicates short-circuit to `200 replayed` before any agent runs. Callbacks are retried up to 5 × 3 s on transient network errors; the backend accepts identical terminal replays with `replayed:true` and rejects differing terminal results with `409 CALLBACK_CONFLICT`.

**Residual exposure.** If a thrown error happens inside a sub-agent before the Coordinator surfaces it (unusual, but possible with aggressive abort behaviour from the underlying LangChain tool invocation), the Coordinator may still return a plausible JSON — in that case the deterministic `Validate Output` catches schema violations and routes to Callback: Failed. We do not claim to cover n8n engine-level crashes that terminate the execution process; those leave the backend in `awaiting_result` until an operator resets the job via the SQL recipe in `feat/backend:docs/integration.md`.

## Security posture

- OpenAI credentials, bearer secrets and header-auth secrets are stored exclusively in n8n credentials or environment variables — never embedded in LLM prompts or JSON exports.
- No real production URL, Trade Fair webhook key, or production credential is referenced.
- The Welcome Agent intentionally lacks any outbound tool; it cannot send email or create accounts even if its prompt were adversarially altered.
- `personal_email` is excluded from agent prompts (see `Validate Input` → `personal_email_present` flag only).
- HTTP tool and callback follow-redirects are disabled to prevent credential leaks to redirected hosts.

## What this branch does NOT do

- Does not activate on the production n8n host.
- Does not reuse Trade Fair webhook keys or any production credential.
- Does not modify the backend, DNS, SMTP or the production database.
- Does not merge into `main`; a Draft PR is opened for combined integration review.
