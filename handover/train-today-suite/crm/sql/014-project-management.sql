BEGIN;
ALTER TABLE crm.records DROP CONSTRAINT IF EXISTS records_kind_check;
ALTER TABLE crm.records ADD CONSTRAINT records_kind_check CHECK(kind IN
 ('company','contact','event','project','conversation','task','activity','offer','order','handoff','service','availability','rule','settlement','ticket','appointment','campaign','task_template','saved_view','document','work_item','time_entry','project_comment'));
DROP POLICY IF EXISTS visible_records ON crm.records;
CREATE POLICY visible_records ON crm.records FOR SELECT USING
 ((current_user<>'crm_agent' OR kind IN ('company','project','task','conversation','activity','service','availability')) AND
 CASE WHEN kind='saved_view' THEN owner_id=crm.actor()
 WHEN kind IN ('settlement','campaign') THEN crm.is_manager()
 WHEN kind='time_entry' THEN crm.is_manager() OR owner_id=crm.actor() OR (project_id IS NOT NULL AND crm.project_access(project_id))
 ELSE crm.is_manager() OR kind IN ('company','event','service','availability','task_template') OR
 (kind='project' AND (owner_id=crm.actor() OR crm.project_access(id))) OR (project_id IS NOT NULL AND crm.project_access(project_id)) OR
 (kind='conversation' AND owner_id=crm.actor()) END);
DROP POLICY IF EXISTS insert_records ON crm.records;
CREATE POLICY insert_records ON crm.records FOR INSERT WITH CHECK
 (CASE WHEN kind='saved_view' THEN owner_id=crm.actor() ELSE crm.is_manager() OR
 (kind IN ('company','project','conversation','contact','task','activity','offer','handoff','ticket','appointment','document','work_item','time_entry','project_comment') AND owner_id=crm.actor() AND (project_id IS NULL OR crm.project_access(project_id))) END);
DROP POLICY IF EXISTS update_records ON crm.records;
CREATE POLICY update_records ON crm.records FOR UPDATE USING
 (CASE WHEN kind='saved_view' THEN owner_id=crm.actor() WHEN kind='time_entry' THEN crm.is_manager() OR owner_id=crm.actor() ELSE crm.is_manager() OR
 (kind IN ('project','task','contact','offer','handoff','ticket','appointment','document','work_item') AND
 ((kind='project' AND crm.project_access(id)) OR (project_id IS NOT NULL AND crm.project_access(project_id)))) END)
 WITH CHECK (CASE WHEN kind='saved_view' THEN owner_id=crm.actor() WHEN kind='time_entry' THEN crm.is_manager() OR owner_id=crm.actor() ELSE crm.is_manager() OR
 (kind IN ('project','task','contact','offer','handoff','ticket','appointment','document','work_item') AND
 ((kind='project' AND crm.project_access(id)) OR (project_id IS NOT NULL AND crm.project_access(project_id)))) END);
CREATE UNIQUE INDEX IF NOT EXISTS crm_one_running_timer ON crm.records(owner_id) WHERE kind='time_entry' AND data->>'status'='running';
CREATE INDEX IF NOT EXISTS crm_time_person ON crm.records(owner_id,(data->>'started_at')) WHERE kind='time_entry';
CREATE OR REPLACE FUNCTION crm.protect_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.kind IN ('conversation','activity','rule','project_comment') AND NEW.data<>OLD.data THEN RAISE EXCEPTION 'Original records are immutable'; END IF;
 IF OLD.kind='settlement' AND OLD.data->>'status'<>'draft' AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Decided settlement is immutable'; END IF;
 IF OLD.kind='time_entry' AND OLD.data->>'status'='approved' AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Approved time is immutable'; END IF;
 RETURN NEW;
END $$;
COMMIT;
