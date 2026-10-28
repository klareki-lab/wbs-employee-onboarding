# Yuri: local onboarding integration handover — 2026-10-28

Based on integration/mvp-v1 at 85421b28c4bb0b29cbb4e3ab2ec7471774c1566c. No main merge or production deployment.

## Changes
- Durable administrator notification outbox on employee creation (migration 003). Exactly one queued notification per employee; registration replay creates no duplicate. Concurrent workers claim rows with locking. Uncertain delivery is marked for manual review, not automatically resent.
- Configurable SYSTEM_ADMIN_EMAIL. Current local setup uses Mailpit only. Messages include start date, position, department, contact and required systems, never passwords. ERP/CRM accounts are not automatically provisioned.
- HR card displays administrator notification status; department selector loads the database registry through authenticated GET /api/hr/departments.
- Local installer imports the chat workflow as well, preserves optional custom OpenAI provider credential data, uses UTF-8 and checks the actual department count.
- Windows start/stop helpers; existing main n8n is untouched.

## Database and access handover
handover/onboarding-private.7z contains onboarding.dump and ZUGAENGE.txt. It uses encrypted file names and password-protected 7z encryption. Obtain the archive password separately from Yuri. Do not commit the extracted files or archive password.
The PostgreSQL 17 custom dump contains onboarding employee records, account password hashes, department registry, processing results and administrator notification history. Browser sessions are excluded. It does not contain the n8n database, API credentials or install.env.
ZUGAENGE.txt includes the local HR, employee and local n8n login details. Its n8n login applies to Yuri's instance only; it is not provisioned by restoring this PostgreSQL dump. Create your own n8n owner login on your installation.
The 14 added employees have example addresses and start date 2026-11-02. Anna Berger uses anna.berger because anna already belongs to Anna Mueller. Employee accounts have no HR administrator permissions, including the person titled managing director.

## Isolated setup / restore
1. Follow docs/YURI-SETUP.md to configure a NEW local installation with your own OpenAI credentials, independent secrets and `configure --mail-mode capture`. Do not point it at production.
2. Optionally set SYSTEM_ADMIN_EMAIL in the private install.env. Without it, new notifications are not queued. Mailpit remains local capture.
3. Start with scripts/local.py up. Migration 003 runs automatically. Existing installs that already have an imported marker retain their current n8n workflows; chat import changes apply to fresh installs. Existing employee registration workflow JSON remains unchanged.
4. Stop only this installation's api and web services before restoring. Extract the archive outside the repository. Restore ONLY into the new disposable local onboarding database, never a shared or production database. The following --clean command replaces its existing contents.

```powershell
docker cp "C:\private\onboarding.dump" wbs-onboarding-local-db-1:/tmp/onboarding.dump
docker exec wbs-onboarding-local-db-1 pg_restore -U onboarding -d onboarding --clean --if-exists --no-owner --no-acl /tmp/onboarding.dump
docker exec wbs-onboarding-local-db-1 rm -f /tmp/onboarding.dump
```

5. Run scripts/local.py up and check again. Use the restored HR/employee credentials. The database grants remain local to the configured DB role.
6. For ZUGAENGE-ANZEIGEN.cmd put the extracted access file at .local-install/wbs-onboarding-local/ZUGAENGE.txt. Other project names require adjusting that path.
7. Verify HR list, a new employee's processing result, administrator Mailpit message, HR approval and separate employee login. No automatic email is sent to the 14 pre-provisioned employee accounts.

## Evidence and limits
33 automated tests passed against isolated PostgreSQL onboarding_test: 4 backend integration scenarios and 29 frontend tests. Both production builds succeeded. See TEST-RESULTS.txt for the actual test log (tested locally before handover).
All 14 new employee logins were tested, AI processing completed, exactly 14 admin messages were captured, and zero employee invitations were created for these records. The connectivity check passed with the expanded registry.
External SMTP delivery is NOT TESTED/configured. Employee portal content areas remain placeholders. n8n execution persistence remains disabled in the local installer; no historic executions are included. Compatibility with production has not been verified.

## Rollback
Before applying to any existing staging environment take an independent backup. Revert this code commit and rebuild API/web if necessary; retain the additive admin_notifications table to preserve delivery history. Restore a database backup only into the intended isolated environment. No production workflows were changed.
