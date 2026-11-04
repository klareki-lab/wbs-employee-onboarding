# Draft PR — Phase 2 Smart Onboarding Coordinator

> **Draft only / not ready for merge**. Requires authenticated writer access to `klareki-lab/wbs-employee-onboarding`. No PR has been created by this offline bundle.

## Changes

- Add migration 003: deterministic task template assignment, unique per-employee task IDs, versioned state and audit events; 10+6 synthetic demo fixtures.
- Add protected role-scoped task APIs, HR task approvals, optimistic concurrency and idempotent replay behavior.
- Add HR task board and a real employee My Tasks view, with explicit demo-source disclaimer.
- Enhance existing Coordinator to draft advisory `personal_plan`; preserve the Info/Welcome agents and prior callback contract.
- Document process classification, risks, test evidence and 7-minute HR demo.

## Known blockers

- **P0 SOURCE BLOCKER:** Original General / Marketing checklists are not in repo; seeded fixture is NOT canonical. Exact task counts and wording unverified.
- **P0 TEST BLOCKER:** No local Docker/PostgreSQL/n8n or real AI E2E verification in the authoring environment. Run real test suite and record outputs before declaring PASS.
- GitHub connector returned 403 on branch creation (no write permission). Publishing must occur from an authorized GitHub user after review.

## Release safety

Main unchanged, no merge, no external services touched. No secrets, real employee data or production changes. Keep this PR draft until the owner accepts all P0 gates.
