BEGIN;
-- The project assistant remains a read-only database user; no write grants.
GRANT SELECT(id,name,role,active) ON crm.users TO crm_agent;
CREATE OR REPLACE VIEW crm.leadership_completions AS SELECT record_id,created_at AS completed_at FROM crm.audit WHERE crm.is_manager() AND after_data#>>'{data,status}'='done' AND coalesce(before_data#>>'{data,status}','')<>'done';
GRANT SELECT ON crm.leadership_completions TO crm_agent;
DROP POLICY IF EXISTS visible_records ON crm.records;
CREATE POLICY visible_records ON crm.records FOR SELECT USING
 ((current_user<>'crm_agent' OR kind IN ('company','project','task','conversation','activity','service','availability','work_item','time_entry','project_comment')) AND
 CASE WHEN kind='saved_view' THEN owner_id=crm.actor()
 WHEN kind IN ('settlement','campaign') THEN crm.is_manager()
 WHEN kind='time_entry' THEN crm.is_manager() OR owner_id=crm.actor() OR (project_id IS NOT NULL AND crm.project_access(project_id))
 ELSE crm.is_manager() OR kind IN ('company','event','service','availability','task_template') OR
 (kind='project' AND (owner_id=crm.actor() OR crm.project_access(id))) OR (project_id IS NOT NULL AND crm.project_access(project_id)) OR
 (kind='conversation' AND owner_id=crm.actor()) END);
COMMIT;
