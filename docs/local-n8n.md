# Local n8n integration and operator notes

For a new installation use [YURI-SETUP.md](YURI-SETUP.md) and `python3 scripts/local.py configure`, `up`, `hr`. The portable launcher creates an independent Compose project, generates separate secrets, imports credentials/workflows and publishes authenticated production webhooks automatically. No existing employee ID, owner account, production instance, JSON editing or SQL editing is required.

## Automatic processing contract

Every HR registration creates one employee/job transactionally. The worker claims eligible queued jobs with PostgreSQL row locks/leases, sends authenticated internal payloads with the stable job ID as idempotency key, and retries dispatch failures with a 30-second delay up to five attempts. Previously unavailable jobs become eligible when the adapter is enabled. Completed and failed results are not silently replayed. There is **no per-employee dispatch filter**.

The local production webhook is `http://localhost:<n8n-port>/webhook/wbs-onboarding`. Between containers it is `http://n8n:5678/webhook/wbs-onboarding`. Header Auth rejects absent/incorrect bearer credentials before the validation Code node. Authenticated `{}` must return HTTP 400. Bot filtering is disabled on this programmatic webhook: enabling `ignoreBots` caused Python's legitimate client to receive an unrelated HTTP 403 before Code execution. Environment access is blocked in Code nodes; credentials are explicit encrypted n8n references instead.

The Coordinator must call `onboarding_info`, which uses the authenticated read-only departments HTTP tool, and `welcome_announcement`. All three model nodes use an actual OpenAI credential. The model selector uses n8n's resource-locator structure (`model.value`), not a bare model string. The strict output validator and authenticated callback control backend transitions; no synthetic AI completion is written by setup/check commands.

Prompts receive only authorized names, department, job title, start date and fictional department reference facts. Email is validated at ingress then removed before prompts. Passwords, session credentials and invitation tokens never enter agent prompts. Backend records and state transitions remain authoritative; AI cannot provision accounts, grant permissions, approve employees or send invitations.

## Credentials and restart safety

Initial import files live under the ignored installation directory with restrictive permissions. Temporary credential JSON is removed after import; encrypted credentials persist in the matching n8n volume. Retain `N8N_ENCRYPTION_KEY` alongside that volume. The install marker prevents routine `up` from reimporting/resetting workflow history. Update the existing OpenAI credential in the local editor for key rotation, retaining its ID; update the private installer configuration too. Do not publish credential exports.

`local.py check` probes authenticated department lookup and rejects an empty callback at schema validation without changing a record. It checks missing/incorrect employee-webhook auth (403), authenticated invalid body (400), health and the frontend API proxy. External SMTP verification checks authentication/TLS without sending an email. These checks do not prove AI model billing, actual execution or inbox delivery.

HR list/detail pages refresh visible in-progress states every three seconds. Processing completion + pending employee status enables manual approval. Sending still requires separate HR approval. Failed/unavailable/completed states have explicit German labels; no polling timer performs mutations.

## Failure recovery

Inspect the existing record first; duplicate registration is not a retry strategy. Dispatch delivery failures retry normally. A failed AI callback or an awaiting-result job with a lost callback requires reviewed recovery, not fabricated completion.

The legacy operator backend includes a local-only CLI:

```text
node dist/retry-local-job.js <employee-id> <expected-attempts> "<reviewed technical reason>"
```

It requires disabled dispatch, development/test mode, a pending employee, an exact attempt count, and a terminal `AGENT_PROCESSING_FAILED` result. It archives that result in `attempt_history`, retaining the employee/job IDs, before returning the same job to unavailable. It does not approve/send or reset accounts. A corresponding failed n8n dedup entry must be archived consistently; do not remove n8n history or reimport workflows blindly. The older `workflows/scripts/connect-local.py` implements this reviewed legacy workflow, uses fixed legacy container names and **must not be pointed at the portable launcher installation**. Safe recovery for that installation requires an operator to adapt container selection and review both records. No public retry endpoint is provided in MVP v1.

## Verification

Earlier controlled real-provider tests proved Coordinator, Info Agent, department tool, Welcome Agent and authenticated callback execution for existing records. The initial single-employee test filter was removed after it blocked subsequent registrations; backend regression covers a second employee, retries and stable idempotency keys. Public documentation intentionally omits real employee identities, account usernames and invitation links.

Clean-install evidence, synthetic-provider tests and platform limitations are recorded in [verification.md](verification.md). No production n8n, Messe Hub, DNS/MX or external account provisioning is part of these scripts.
