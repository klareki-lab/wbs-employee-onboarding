# Phase 2 test and release evidence (2026-10-30)

**Scope:** static overlay package prepared against audited `main` SHA `de7486893f53afa2512234490e0bced3fd78cafb`. Full source checkout was not available to the build container (GitHub DNS/network unavailable). GitHub connector now has write permission and the Phase 2 feature branch was created in `klareki-lab/wbs-employee-onboarding`.

| Gate | Evidence/status | Interpretation |
|---|---|---|
| Database migration code and 10+6 fixture | Source authored, static checks in package | NOT equivalent to migration execution |
| Deterministic transition rules | 3/3 pure Node tests in `tests/test_task_transitions.mjs` passed | Unit logic only; not API/RBAC E2E |
| Safe patcher write and replay handling | 22 files applied to a synthetic preimage fixture; second application rejected, n8n JSON parsed and wiring preserved | PASS fixture only. Real checkout and full module integration NOT run |
| TS/TSX syntax checks | 5/5 standalone source files transpile with TypeScript compiler, zero syntax diagnostics | Not a full dependency/type-check |
| Backend TypeScript compilation | NOT RUN against full dependency tree in this container | Automated run provisioned in `.github/workflows/phase2-ci.yml`; check actual run conclusion |
| Frontend TypeScript + Vite build | NOT RUN against full dependency tree in this container | Automated run provisioned in `.github/workflows/phase2-ci.yml`; check actual run conclusion |
| PostgreSQL migration, task generation, persistence | NOT RUN | Needs isolated PostgreSQL |
| HR/Employee auth, approval, duplicate API tests | Source test `backend/test/tasks.test.ts` provided, NOT EXECUTED | Needs `_test` PostgreSQL and dependencies |
| Modified production webhook import / execution | NOT RUN in live n8n | Needs isolated local n8n and three configured agents |
| Genuine OpenAI output, failure path | NOT RUN | Requires separately authorized API credentials |
| Real inbox / SMTP | Intentionally NOT RUN | Not needed for task P0; Mailpit capture only |
| Full local E2E + restart persistence | NOT RUN | Release blocker |
| Official Train Today checklist fidelity | NOT VERIFIED | Release blocker; demo fixtures only |
| Production/VPS | NOT TOUCHED | No release permitted |

## Acceptance test sequence (isolated system)

1. Use **only a disposable PostgreSQL database whose database name ends `_test`**; never run integration tests on retained personal data. Apply migrations through `backend/src/migrate.ts`.
2. `cd backend && npm ci && npm run build && npm test`; capture test report. Existing tests and Phase 2 `tasks.test.ts` must all pass. The new test checks General 10 / Marketing 16 **fixture** counts, concurrent duplicate registration, employee isolation, CSRF, task transitions, approval, event history, AI failure preservation and application restart + DB re-read. This test is provided but NOT EXECUTED in the current environment.
3. `cd frontend && npm ci && npm run typecheck && npm test && npm run build`; capture output and manually inspect HR and employee task pages in a real browser.
4. `python3 scripts/local.py up` in a separate, previously configured local install. Confirm successful migration and inspect `onboarding_task_templates` provenance. Never run `destroy` against data to preserve.
5. Import/update local workflow through the approved n8n procedure. Confirm three agents, the two existing subagent links, new Sticky Notes, valid callback, and no second active webhook with the same path.
6. Create one synthetic IT and one Marketing employee through UI; verify task keys, due dates, unique count and no duplicates after retry. Test invalid date/body/status, forced AI error and callback failure (no task loss).
7. Activate synthetic account via Mailpit capture only; read My Tasks and change allowed statuses. Verify employee cannot access HR or another employee's tasks. Request HR approval, approve as HR, inspect actor/time history and replay behavior.
8. Restart application containers using the existing non-destructive local launcher; verify tasks and approvals persist. Check no external HR/IT actions or uncontrolled messages. Record the exact commands, environment mode, timestamps, and results before changing P0 to PASS.
9. Reconcile both original checklists row-by-row and verify canonical counts. This is a separate required gate from the fixture test.

**GitHub CI is intentionally synthetic only: disposable PostgreSQL and Mailpit, no real OpenAI, HR/IT provisioning or production/VPS. CI is evidence only after a finished run.

**No claim of Phase 2 full n8n live end-to-end PASS or production readiness is made by this package.****
