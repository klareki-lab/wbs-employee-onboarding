-- Generated from these three recorded test runs only. No trade_fair changes.
BEGIN;
CREATE TEMP TABLE current_qa_prefix(prefix text PRIMARY KEY);
INSERT INTO current_qa_prefix VALUES ('CRM-QA-1792874976554'),('CRM-V2-QA-1792874963793'),('CRM-V2-QA-1792874943619');
CREATE TEMP TABLE current_qa_ids AS
WITH companies AS (SELECT id FROM crm.records WHERE kind='company' AND data->>'name' IN ('CRM-QA-1792874976554','CRM-V2-QA-1792874963793','CRM-V2-QA-1792874943619')),
projects AS (SELECT id FROM crm.records WHERE kind='project' AND data->>'company_id' IN (SELECT id::text FROM companies))
SELECT id FROM companies UNION SELECT id FROM projects UNION
SELECT id FROM crm.records WHERE project_id IN (SELECT id FROM projects) UNION
SELECT r.id FROM crm.records r WHERE r.kind IN ('rule','task_template','saved_view','campaign') AND EXISTS(SELECT 1 FROM current_qa_prefix q WHERE r.data->>'title'=q.prefix OR r.data->>'title'=q.prefix||' UI Ansicht');
DELETE FROM crm.requests WHERE EXISTS(SELECT 1 FROM current_qa_ids q WHERE result::text LIKE '%'||q.id::text||'%');
DELETE FROM crm.outbox WHERE conversation_id IN (SELECT id FROM current_qa_ids);
DELETE FROM crm.members WHERE project_id IN (SELECT id FROM current_qa_ids);
DELETE FROM crm.audit WHERE record_id IN (SELECT id FROM current_qa_ids);
DELETE FROM crm.records WHERE id IN (SELECT id FROM current_qa_ids) AND project_id IS NOT NULL;
DELETE FROM crm.records WHERE id IN (SELECT id FROM current_qa_ids);
CREATE TEMP TABLE current_qa_users AS SELECT id FROM crm.users WHERE NOT active AND login IN (SELECT lower(prefix) FROM current_qa_prefix);
DELETE FROM crm.sessions WHERE user_id IN (SELECT id FROM current_qa_users);
DELETE FROM crm.requests WHERE user_id IN (SELECT id FROM current_qa_users);
DELETE FROM crm.audit WHERE record_id IN (SELECT id FROM current_qa_users) OR actor_id IN (SELECT id FROM current_qa_users);
DELETE FROM crm.users WHERE id IN (SELECT id FROM current_qa_users);
COMMIT;
SELECT kind,count(*) FROM crm.records GROUP BY kind ORDER BY kind;
