# Phase 2 — Smart Onboarding Coordinator (architecture, source status, boundaries)

**Base:** `klareki-lab/wbs-employee-onboarding`, main SHA `de7486893f53afa2512234490e0bced3fd78cafb` (2026-10-28), v1.0.0. Phase 2 is ADDITIVE. Main, production, Trade Fair Assistant, external HR/IT services and email credentials are not modified by this overlay.

## Important source-of-truth release gate

The official **General Onboarding Checklist** and **Marketing Onboarding Checklist** were NOT present in the audited repository or accessible source documents. Migration 003 therefore ships **synthetic, explicitly unverified demonstration fixtures** (10 General, 6 Marketing). The titles, offsets and counts CANNOT be claimed to match the two WBS/Train Today documents. All seeded rows have `source_id='phase2_demo_fixture'`, `source_verified=false`; the UI displays an explicit demo warning. **P0 checklist-exactness acceptance remains BLOCKED until both original checklists are supplied and reconciled.**

Use `CHECKLIST_RECONCILIATION_TEMPLATE.csv` with each source document. Review full text, item order, responsibility and due-date semantics. Replace provisional entries with a *new reviewed migration*, version templates and plan a safe reconciliation of existing tasks; do not silently update task snapshots or reset completed tasks. No arbitrary source text is loaded into n8n prompts without backend validation.

## Architecture and data flow

```text
HR registers fictional employee (existing POST /api/onboarding)
    -> PostgreSQL employees INSERT transaction
       -> AFTER INSERT trigger assigns General (+ Marketing when department=Marketing)
       -> onboarding_tasks unique(employee_id,template_key) + event 'created'
    -> existing onboarding_jobs dispatcher
       -> read-only task_outline (title, date, role, approval flag)
       -> local n8n webhook, existing three agents
          Onboarding Coordinator -> onboarding_info -> welcome_announcement
          -> personal_plan (advisory string), validated, callback
       -> PostgreSQL onboarding_jobs.orchestration_result
    -> Existing independent HR approval and invitation (unchanged)
    -> Employee activates account using existing invitation
    -> Employee sees My Tasks, changes own tasks (authorized API)
    -> HR approves requested tasks in separate HR-specific endpoint
       -> PostgreSQL version + history; no external provisioning
```

The database—not the model or the browser—owns eligibility, dates, ownership, status and approval. The coordinator only writes advisory `personal_plan` into the existing job result, never into the task or employee tables. The original three agents and their tool connections are preserved; the Chat Trigger demonstrator remains read-only. Original callbacks without `personal_plan` still satisfy the backend's schema; a fresh Phase 2 workflow is required to generate the new plan.

## Data and consistency

- `onboarding_task_templates`: versionable catalog; source identity and verified flag, title, detail, owner role, due offset, approval flag, execution mode and order.
- `onboarding_tasks`: per-employee immutable template snapshot (task key/version/title/detail, due date and owner), mutable status/version/approval data, assigned human account and timestamps. `UNIQUE(employee_id,template_key)` is the final duplicate guard, not the AI.
- `onboarding_task_events`: database-triggered append-only-at-API-level event log (`created`, `status_changed`, `hr_approved`), user ID of the actor and old/new status/version. The database superuser can technically change any table; this is not an immutable external compliance log.
- Dates use **calendar-day offsets** from employee.start_date in the synthetic catalog. Weekends/holidays and original timing rules remain to be validated against the real checklists.
- Migration 003 backfills existing employees without modifying their existing records or completed jobs. It is not safe to roll back by dropping migration 003 once tasks have been used; retain a backup and use forward migrations.
- Ordinary registrations remain protected by the existing personal-email duplicate policy. Replays do not trigger new employee INSERTs; database uniqueness prevents duplicate tasks if the assignment query is rerun.

## Task state machine, permissions and replay safety

`pending -> in_progress -> completed` for ordinary tasks. Sensitive employee tasks use `pending|in_progress -> awaiting_hr -> completed` exclusively via `POST /hr/tasks/:id/approve`. An employee may withdraw their own pending approval request by moving `awaiting_hr -> in_progress`. Completed tasks cannot be reopened via the normal API. HR tasks are mutable only by HR; an HR member who starts a task claims its `assigned_to` slot. Other HR accounts cannot mutate that claimed task through the ordinary status endpoint. Human approvals are separately recorded with `approved_by` and `approved_at`.

All state changes require a positive `expected_version`, use `SELECT FOR UPDATE` and increment version atomically. Stale differing writes return HTTP 409. Replaying an already achieved target status (or existing approval) is read-only and returns `replayed: true`. Employee task mutations must match the authenticated employee ID in SQL, not a client-supplied employee ID. No employee endpoint exposes another employee's tasks, and non-HR clients cannot call HR endpoints. The legacy HttpOnly cookie, CSRF and exact browser Origin checks remain in force for new PATCH/POST routes.

## Phase 2 API additions (`/api`, envelope `{data:...}`)

| Method | Route | Auth | Purpose |
|---|---|---|---|
| GET | `/hr/checklist-templates` | HR | Inspect template catalog, source verification status |
| GET | `/hr/employees/:id/tasks` | HR | All tasks and progress for selected employee |
| PATCH | `/hr/tasks/:id/status` | HR + CSRF | Change assigned HR-owned task, `{status,expected_version}` |
| POST | `/hr/tasks/:id/approve` | HR + CSRF | Approve employee request, `{expected_version}` |
| GET | `/hr/tasks/:id/history` | HR | Task audit events including actor ID |
| GET | `/employee/tasks` | Employee | Only authenticated employee's owned tasks |
| PATCH | `/employee/tasks/:id/status` | Employee + CSRF | Own task transition, `{status,expected_version}` |
| GET | `/employee/tasks/:id/history` | Employee | Own task events, actor IDs redacted |
| GET | `/employee/plan` | Employee | Optional AI draft plan, never a command |

All v1 routes and v1 employee invitation/activation semantics remain unchanged. Phase 2 added an **optional** `personal_plan` string (1–4000 chars) to the successful internal n8n callback. Existing n8n credentials and secrets are not exported into source control.

## Automation classification

| Category | Phase 2 example | Actual decision-maker | Boundary |
|---|---|---|---|
| Full Automation | Create task snapshots deterministically on registration | PostgreSQL trigger | No account creation or HR decisions |
| HITL (Human in the Loop) | Sensitive employee task requests HR approval | HR person | Approval remains pending until explicit HR action |
| HOTL (Human on the Loop) | AI drafts German personalized plan and welcoming text | HR supervises and edits outside AI | Advisory information only |
| Entirely Human | Introductory conversation, read internal rules, give feedback | Employee / HR | A user manually confirms completion |

The `execution_mode` on each provisional task is a *process classification*; it is not permission to operate outside this application. No Google Workspace, GitHub, Canva, Analytics, SMTP or HRIS account is created by task completion. SMTP invitation remains an explicitly separate v1 HR-approved action.

## Local installer compatibility

The v1 launcher `scripts/local.py` runs sorted migrations on startup, so a clean install picks up `003_onboarding_checklists_phase2.sql` automatically. A pre-existing installation should first be backed up (matching Postgres and n8n volumes plus private config), then upgraded in place without `destroy`. **Existing n8n instances are deliberately not reimported on restart**; to use Phase 2 personal plans, import/update the modified `workflows/onboarding-webhook.json` manually into an isolated local n8n instance while preserving local secrets/credentials, checking webhook path uniqueness and testing with synthetic data. Do NOT publish an accidental second active workflow using the same webhook path. The Chat Trigger export is not a production endpoint.

Portability, SMTP mail acceptance and live OpenAI calls are environment-specific; use `docs/PHASE2_TEST_REPORT.md` for evidenced versus pending checks. Do not point this prototype at an existing VPS or Trade Fair service.
