\set app_role crm_capture
\set app_database crm
-- psql-only configuration script. Use a REAL, dedicated, existing LOGIN role.
-- Example syntax (replace the uppercase values):
-- psql ... -v app_role=ACTUAL_WF_A_ROLE -v app_database=ACTUAL_APPLICATION_DB \
--   -f ops/grant_app_role.sql
-- No role, database, password or credential is created by this script.
\set ON_ERROR_STOP on
\if :{?app_role}
\else
  \echo 'Missing -v app_role=ACTUAL_WF_A_ROLE. No grants applied.'
  \quit
\endif
\if :{?app_database}
\else
  \echo 'Missing -v app_database=ACTUAL_APPLICATION_DB. No grants applied.'
  \quit
\endif

BEGIN;
GRANT USAGE ON SCHEMA trade_fair TO :"app_role";
GRANT EXECUTE ON FUNCTION trade_fair.capture_lead(jsonb) TO :"app_role";
GRANT SELECT, INSERT ON trade_fair.companies, trade_fair.lead_submissions TO :"app_role";
GRANT UPDATE (website) ON trade_fair.companies TO :"app_role";
GRANT SELECT ON trade_fair.contacts TO :"app_role";
GRANT INSERT (company_id, contact_name, contact_name_normalized, email, phone, phone_normalized)
  ON trade_fair.contacts TO :"app_role";
-- These settings apply to new sessions for this role in the selected database.
ALTER ROLE :"app_role" IN DATABASE :"app_database" SET statement_timeout = '10s';
ALTER ROLE :"app_role" IN DATABASE :"app_database" SET lock_timeout = '3s';
ALTER ROLE :"app_role" IN DATABASE :"app_database" SET idle_in_transaction_session_timeout = '15s';
COMMIT;

-- Never grant this role INSERT/UPDATE(email_verified), schema ownership,
-- superuser privileges or a membership that supplies those privileges.
-- This script assumes a NEW dedicated role; it does not remove preexisting grants.

\set worker_role crm_worker
\set status_role crm_status
\set operator_role crm_operator
-- Run with psql as the trusted migration owner after 002_processing.sql.
-- Supply three DIFFERENT existing, dedicated, non-owner roles:
-- psql ... -v worker_role=ACTUAL_WORKER_ROLE -v status_role=ACTUAL_STATUS_ROLE \
--   -v operator_role=ACTUAL_OPERATOR_ROLE -f ops/grant_processing_roles.sql
-- This script creates no roles or passwords. Do not reuse the WF-A capture role.
\set ON_ERROR_STOP on
\if :{?worker_role}
\else
  \echo 'Missing -v worker_role=<existing dedicated role>'
  DO $deny$ BEGIN RAISE EXCEPTION 'Processing role grants refused; see preceding message'; END $deny$;
\endif
\if :{?status_role}
\else
  \echo 'Missing -v status_role=<existing dedicated role>'
  DO $deny$ BEGIN RAISE EXCEPTION 'Processing role grants refused; see preceding message'; END $deny$;
\endif
\if :{?operator_role}
\else
  \echo 'Missing -v operator_role=<existing dedicated role>'
  DO $deny$ BEGIN RAISE EXCEPTION 'Processing role grants refused; see preceding message'; END $deny$;
\endif

SELECT count(*)=3
       AND count(DISTINCT r.oid)=3
       AND bool_and(NOT r.rolsuper)
       AND bool_and(NOT pg_has_role(r.oid,n.nspowner,'MEMBER'))
       AND bool_and(NOT EXISTS (
           SELECT 1 FROM pg_proc p WHERE p.pronamespace=n.oid AND p.prosecdef
             AND pg_has_role(r.oid,p.proowner,'MEMBER')
       )) AS roles_valid
FROM pg_roles r CROSS JOIN pg_namespace n
WHERE n.nspname='trade_fair'
  AND r.rolname IN (:'worker_role',:'status_role',:'operator_role')
\gset
\if :roles_valid
\else
  \echo 'Use three existing, distinct, non-superuser roles without membership in any schema/function-owner role.'
  DO $deny$ BEGIN RAISE EXCEPTION 'Processing role grants refused; see preceding message'; END $deny$;
\endif

BEGIN;
REVOKE CREATE ON SCHEMA trade_fair FROM PUBLIC;
REVOKE ALL ON SCHEMA trade_fair FROM :"worker_role", :"status_role", :"operator_role";
GRANT USAGE ON SCHEMA trade_fair TO :"worker_role", :"status_role", :"operator_role";

-- Dedicated roles must not retain earlier direct data access or broad function
-- grants. Unrelated schemas and the separately configured WF-A role are untouched.
REVOKE ALL ON ALL TABLES IN SCHEMA trade_fair FROM :"worker_role", :"status_role", :"operator_role";
REVOKE ALL ON ALL SEQUENCES IN SCHEMA trade_fair FROM :"worker_role", :"status_role", :"operator_role";
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA trade_fair FROM :"worker_role", :"status_role", :"operator_role";

GRANT EXECUTE ON FUNCTION trade_fair.claim_processing(text,integer,integer,integer),
    trade_fair.renew_processing(text,uuid,integer),
    trade_fair.finish_processing(text,uuid,jsonb,jsonb),
    trade_fair.fail_processing(text,uuid,text,boolean),
    trade_fair.claim_email(text,integer,integer,integer),
    trade_fair.begin_email_send(uuid,uuid),
    trade_fair.finish_email_send(uuid,uuid,text),
    trade_fair.fail_email_send(uuid,uuid,text,text)
TO :"worker_role";

GRANT EXECUTE ON FUNCTION trade_fair.get_lead_status(text,text)
TO :"status_role";

GRANT EXECUTE ON FUNCTION trade_fair.retry_failed_processing(text,text),
    trade_fair.resolve_email_uncertain(uuid,text,text),
    trade_fair.retry_failed_email(uuid,text),
    trade_fair.queue_health()
TO :"operator_role";

-- Inherited privileges cannot be safely removed by a project-local script.
-- Stop if a role still has data access, schema CREATE or cross-role function
-- access through another role/PUBLIC. Column-level grants are checked too.
SELECT NOT EXISTS (
    SELECT 1 FROM pg_roles r
    CROSS JOIN pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE r.rolname IN (:'worker_role',:'status_role',:'operator_role')
      AND n.nspname='trade_fair' AND c.relkind IN ('r','p','v')
      AND (has_table_privilege(r.oid,c.oid,'SELECT')
        OR has_table_privilege(r.oid,c.oid,'INSERT')
        OR has_table_privilege(r.oid,c.oid,'UPDATE')
        OR has_table_privilege(r.oid,c.oid,'DELETE')
        OR has_table_privilege(r.oid,c.oid,'TRUNCATE')
        OR has_table_privilege(r.oid,c.oid,'REFERENCES')
        OR has_table_privilege(r.oid,c.oid,'TRIGGER')
        OR has_any_column_privilege(r.oid,c.oid,'SELECT')
        OR has_any_column_privilege(r.oid,c.oid,'INSERT')
        OR has_any_column_privilege(r.oid,c.oid,'UPDATE')
        OR has_any_column_privilege(r.oid,c.oid,'REFERENCES'))
) AND NOT EXISTS (
    SELECT 1 FROM pg_roles r
    WHERE r.rolname IN (:'worker_role',:'status_role',:'operator_role')
      AND has_schema_privilege(r.oid,'trade_fair','CREATE')
) AND NOT EXISTS (
    SELECT 1 FROM pg_roles r
    CROSS JOIN pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE r.rolname IN (:'worker_role',:'status_role',:'operator_role')
      AND n.nspname='trade_fair' AND has_function_privilege(r.oid,p.oid,'EXECUTE')
      AND NOT (
        (r.rolname=:'worker_role' AND p.oid=ANY(ARRAY[
            'trade_fair.claim_processing(text,integer,integer,integer)'::regprocedure,
            'trade_fair.renew_processing(text,uuid,integer)'::regprocedure,
            'trade_fair.finish_processing(text,uuid,jsonb,jsonb)'::regprocedure,
            'trade_fair.fail_processing(text,uuid,text,boolean)'::regprocedure,
            'trade_fair.claim_email(text,integer,integer,integer)'::regprocedure,
            'trade_fair.begin_email_send(uuid,uuid)'::regprocedure,
            'trade_fair.finish_email_send(uuid,uuid,text)'::regprocedure,
            'trade_fair.fail_email_send(uuid,uuid,text,text)'::regprocedure
        ]))
        OR (r.rolname=:'status_role' AND p.oid='trade_fair.get_lead_status(text,text)'::regprocedure)
        OR (r.rolname=:'operator_role' AND p.oid=ANY(ARRAY[
            'trade_fair.retry_failed_processing(text,text)'::regprocedure,
            'trade_fair.resolve_email_uncertain(uuid,text,text)'::regprocedure,
            'trade_fair.retry_failed_email(uuid,text)'::regprocedure,
            'trade_fair.queue_health()'::regprocedure
        ]))
      )
) AS execute_only_verified
\gset
\if :execute_only_verified
  COMMIT;
\else
  ROLLBACK;
  \echo 'Excess data/schema/function privileges remain. Use clean dedicated roles; no grant changes were committed.'
  DO $deny$ BEGIN RAISE EXCEPTION 'Processing role grants refused; see preceding message'; END $deny$;
\endif
