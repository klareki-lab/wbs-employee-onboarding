-- ONLY this package's generated QA records. Never run against an unrelated database.
BEGIN;
CREATE TEMP TABLE crm_qa_ids AS
 WITH companies AS (SELECT id FROM crm.records WHERE kind='company' AND data->>'name' LIKE 'CRM-QA-%'),
 projects AS (SELECT id FROM crm.records WHERE kind='project' AND data->>'company_id' IN (SELECT id::text FROM companies))
 SELECT id FROM companies UNION SELECT id FROM projects
 UNION SELECT id FROM crm.records WHERE project_id IN (SELECT id FROM projects)
 UNION SELECT id FROM crm.records WHERE kind='rule' AND data->>'title' LIKE 'CRM-QA-%';
DELETE FROM crm.requests WHERE EXISTS(SELECT 1 FROM crm_qa_ids q WHERE result::text LIKE '%'||q.id::text||'%');
DELETE FROM crm.outbox WHERE conversation_id IN (SELECT id FROM crm_qa_ids);
DELETE FROM crm.members WHERE project_id IN (SELECT id FROM crm_qa_ids);
DELETE FROM crm.audit WHERE record_id IN (SELECT id FROM crm_qa_ids);
DELETE FROM crm.records WHERE id IN (SELECT id FROM crm_qa_ids) AND project_id IS NOT NULL;
DELETE FROM crm.records WHERE id IN (SELECT id FROM crm_qa_ids);
COMMIT;
