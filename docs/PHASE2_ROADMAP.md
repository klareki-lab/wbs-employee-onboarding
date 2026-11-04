# Phase 2 Roadmap — no unapproved P1 work

## P0 acceptance blockers

1. Obtain the two original Train Today/WBS checklist documents. Reconcile EVERY row, label, due rule, owner and category; confirm exact General and Marketing task counts and publish a reviewed, versioned migration (fixtures must not be silently accepted).
2. Install the patch on a clean feature branch of the exact audited `main` SHA. Run both `backend` and `frontend` builds/tests, apply migration against an isolated PostgreSQL `_test` database, import the modified n8n workflow and verify credentials.
3. Execute local E2E with fully synthetic employee identities and either approved local AI credentials or an explicitly named deterministic fake. An AI fake does not prove OpenAI integration.
4. Complete human acceptance: HR controls, role isolation, visible task changes after restart, no external side effects, and a 7-minute demonstration. Open Draft PR only when GitHub push permission is provided; no merge without owner approval.

## P1 only after P0 sign-off

- Reminders: durable outbox, deduplication and escalation policy. Do not send emails until explicit HR approval.
- Calendar: scheduling proposals first, confirmed events only after owner approval.
- HR/IT integration: scoped dry-run design, least-privilege credentials and audit trail before any account provisioning.
- Week 1/2 reports: deterministic progress snapshots; AI narrative must cite task state and remain a draft.
- Expanded HR dashboard: KPIs computed from task rows, including overdue and approval queue.

## No-go conditions

Official task count not reconciled, credentials/shared systems involved, failing authorization, migration failure on retained data, replay duplicates, unexpected external API calls, AI able to grant access, or unverified live acceptance. Never claim local E2E PASS based only on source inspection or pure unit tests.
