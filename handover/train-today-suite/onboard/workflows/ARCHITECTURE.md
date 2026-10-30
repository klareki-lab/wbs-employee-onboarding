# n8n Employee Onboarding — execution contract (MVP v1)

## Ownership and boundaries
This branch owns only `/workflows` and n8n documentation. Do not modify the Messe Hub or existing n8n workflows. Frontend and backend work in separate feature branches. Use the backend contract from `feat/backend:docs/integration.md` and `docs/api-contract.md`.

## WBS teaching requirement
Exactly one **Onboarding Coordinator AI Agent** calls two genuine **AI Agent Tool** subagents:
1. **Onboarding Info Agent**: read-only department lookup through the backend.
2. **Welcome Announcement Agent**: create a friendly German welcome draft (no email send; backend sends the eventual invitation only after HR approval).

The coordinator must actually invoke both tools and synthesize a validated structured result; a linear chain of independent LLM calls does not satisfy the exercise. Provide a separate Chat Trigger demonstration workflow, or another explicit demonstrator that uses the same coordinator, for the WBS chat-trigger exercise. No real email for the demo.

## System flow
Backend outbox dispatcher -> n8n production webhook -> authentication, schema validation, and durable `job_id` idempotency -> coordinator and tools -> deterministic result validation -> authenticated backend callback. The backend's outbox is at-least-once, so the same job may be dispatched repeatedly. 2xx webhook acknowledgement is not proof of successful processing. For processing or callback failures, use explicit failure handling and do not falsely return completed.

### Incoming payload (backend to n8n)
Headers:
- `Authorization: Bearer <N8N_ONBOARDING_WEBHOOK_SECRET>`
- `Idempotency-Key: <job UUID>`
- `Content-Type: application/json`

JSON:
```json
{
  "event": "employee.onboarding.requested",
  "job_id": "<job UUID>",
  "employee_id": "<employee UUID>",
  "first_name": "Tom",
  "last_name": "Becker",
  "department": "IT",
  "role": "Backend Developer",
  "start_date": "2026-11-03",
  "personal_email": "tom.becker@example.com"
}
```

Validate `event`, both UUIDs, required field types, and matching `Idempotency-Key` before invoking AI. Never include auth secrets in agent prompts. Avoid persisting plaintext employee email in execution logs when not necessary. Use deterministic routing and validation, not an LLM to check headers.

### Department lookup tool
`GET /api/internal/departments`
Header: `Authorization: Bearer <DEPARTMENTS_API_SECRET>`.
The tool returns a department array with `{id,name,team_lead,necessary_accounts,is_demo}`. The Info Agent must match the requested department and return the database facts with `is_demo`; it must not invent leads or accounts. If missing/unavailable, signal a clear failure.

### Agent tools
Coordinator tool descriptions must clearly explain when each AI Agent Tool is called and required inputs/outputs. Coordinator collects facts from Info Agent before calling Welcome Agent. Welcome Agent drafts a short German greeting from employee fields and department context, but **does not send emails or create accounts**.

### Callback (n8n to backend)
`POST /api/internal/onboarding/result` with `Authorization: Bearer <INTERNAL_API_SECRET>`.

Successful body (all required, no extras):
```json
{
  "employee_id": "<employee UUID>",
  "status": "completed",
  "team_lead": "Sarah Miller",
  "necessary_accounts": ["GitHub","Google Workspace"],
  "welcome_message": "Willkommen Tom im IT-Team!"
}
```

Failure:
```json
{"employee_id":"<employee UUID>","status":"failed","error_code":"AGENT_PROCESSING_FAILED"}
```

Do not callback until webhook dispatch has reached the backend (it supports fast callbacks during dispatch). Transient callback errors should be retried without rewriting terminal results. Identical completed callbacks are replay-safe, differing terminal results are rejected by backend.

## Implementation deliverables
- Importable, **unpublished** n8n workflow JSON under `workflows/`.
- Actual AI Agent Tool nodes, connected models, HTTP Request read-only department tool, webhook and callback nodes.
- A WBS Chat Trigger demonstrator.
- Sticky Notes documenting the architecture.
- `workflows/README.md`: exact setup steps, required credentials, required n8n environment configuration, node versions, known limitations, and how to run a local test using the demo backend and Mailpit.
- No secrets, tokens, production URLs for fictional routes, or credentials in exports.
- Draft PR `feat/n8n-orchestration` → `main`; no merge or production publish until combined integration review.

## Operational guardrails
- Never reuse or expose Trade Fair webhook keys.
- Do not configure the real n8n webhook URL before it exists.
- Backend must be reachable from n8n through a controlled route; `localhost` inside the n8n Docker container is not the host/other container.
- If durable dedup cannot be implemented with existing storage, state that limitation explicitly; backend callback idempotency alone does not stop duplicate model invocations.
- Favor a working, inspectable implementation over elaborate orchestration, but do not claim untested external connectivity.
