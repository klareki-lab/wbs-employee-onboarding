-- Additive CRM workspace migration. No changes to trade_fair or existing records.
BEGIN;
ALTER TABLE crm.records DROP CONSTRAINT IF EXISTS records_kind_check;
ALTER TABLE crm.records ADD CONSTRAINT records_kind_check CHECK(kind IN
 ('company','contact','event','project','conversation','task','activity','offer','order','handoff','service','availability','rule','settlement','ticket','appointment','campaign','task_template','saved_view','document','work_item','time_entry','project_comment'));
DROP POLICY IF EXISTS visible_records ON crm.records;
CREATE POLICY visible_records ON crm.records FOR SELECT USING
 ((current_user<>'crm_agent' OR kind IN ('company','project','task','conversation','activity','service','availability')) AND
 CASE WHEN kind='saved_view' THEN owner_id=crm.actor()
 WHEN kind IN ('settlement','campaign') THEN crm.is_manager()
 ELSE crm.is_manager() OR kind IN ('company','event','service','availability','task_template') OR
 (kind='project' AND (owner_id=crm.actor() OR crm.project_access(id))) OR (project_id IS NOT NULL AND crm.project_access(project_id)) OR
 (kind='conversation' AND owner_id=crm.actor()) END);
DROP POLICY IF EXISTS insert_records ON crm.records;
CREATE POLICY insert_records ON crm.records FOR INSERT WITH CHECK
 (CASE WHEN kind='saved_view' THEN owner_id=crm.actor() ELSE crm.is_manager() OR
 (kind IN ('company','project','conversation','contact','task','activity','offer','handoff','ticket','appointment','document') AND owner_id=crm.actor() AND (project_id IS NULL OR crm.project_access(project_id))) END);
DROP POLICY IF EXISTS update_records ON crm.records;
CREATE POLICY update_records ON crm.records FOR UPDATE USING
 (CASE WHEN kind='saved_view' THEN owner_id=crm.actor() ELSE crm.is_manager() OR
 (kind IN ('project','task','contact','offer','handoff','ticket','appointment','document') AND
 ((kind='project' AND crm.project_access(id)) OR (project_id IS NOT NULL AND crm.project_access(project_id)))) END)
 WITH CHECK (CASE WHEN kind='saved_view' THEN owner_id=crm.actor() ELSE crm.is_manager() OR
 (kind IN ('project','task','contact','offer','handoff','ticket','appointment','document') AND
 ((kind='project' AND crm.project_access(id)) OR (project_id IS NOT NULL AND crm.project_access(project_id)))) END);
CREATE INDEX IF NOT EXISTS crm_records_company ON crm.records ((data->>'company_id')) WHERE kind='project';
CREATE INDEX IF NOT EXISTS crm_contact_email ON crm.records (lower(data->>'email')) WHERE kind='contact';
COMMENT ON SCHEMA crm IS 'Train Today local CRM v2; trade_fair remains a separate integration.';
INSERT INTO crm.records(kind,owner_id,created_by,data)
SELECT 'task_template',u.id,u.id,t.data FROM
 (SELECT id FROM crm.users WHERE active AND role IN ('manager','admin') ORDER BY created_at LIMIT 1) u,
 (VALUES
 ('{"title":"Messekontakt nachbereiten","description":"Bedarf prüfen, Rückfragen klären und nächsten Schritt vereinbaren.","steps":[{"title":"Gespräch und Kontaktdaten prüfen","days":0},{"title":"Vereinbarten nächsten Schritt bestätigen","days":1},{"title":"Bedarf und Entscheidungsweg klären","days":3}]}'::jsonb),
 ('{"title":"Angebot begleiten","description":"Angebotsprüfung und Rückmeldung im Blick behalten.","steps":[{"title":"Angebotspositionen und Konditionen prüfen","days":0},{"title":"Eingang des Angebots nachfragen","days":3},{"title":"Entscheidung und offene Fragen besprechen","days":7}]}'::jsonb),
 ('{"title":"Neukunden starten","description":"Übergabe vom Vertrieb an die Durchführung vorbereiten.","steps":[{"title":"Auftrag und Ansprechpartner bestätigen","days":0},{"title":"Auftakttermin abstimmen","days":2},{"title":"Rückmeldung zum Projektstart einholen","days":14}]}'::jsonb)
 ) AS t(data)
WHERE NOT EXISTS(SELECT 1 FROM crm.records r WHERE r.kind='task_template' AND r.data->>'title'=t.data->>'title');
COMMIT;
