-- Phase 2: additive and backward-compatible task engine. All task titles below
-- are SYNTHETIC DEMO FIXTURES, NOT VERIFIED copies of WBS/Train Today checklists.
-- Replace ONLY after obtaining and reviewing the two authoritative source files.
-- Existing task snapshots must be preserved when templates change.
CREATE TABLE employee_onboarding.onboarding_task_templates (
  template_key text PRIMARY KEY CHECK (template_key ~ '^[GM]-[0-9]{2,3}$'),
  scope text NOT NULL CHECK (scope IN ('general','marketing')),
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 200),
  detail text NOT NULL DEFAULT '',
  assignee_role text NOT NULL CHECK (assignee_role IN ('hr','employee')),
  due_offset_days integer NOT NULL CHECK (due_offset_days BETWEEN -60 AND 365),
  needs_hr_approval boolean NOT NULL DEFAULT false,
  execution_mode text NOT NULL CHECK (execution_mode IN ('FULL_AUTOMATION','HITL','HOTL','ENTIRELY_HUMAN')),
  sort_order integer NOT NULL CHECK (sort_order > 0),
  source_id text NOT NULL DEFAULT 'phase2_demo_fixture',
  source_verified boolean NOT NULL DEFAULT false,
  template_version integer NOT NULL DEFAULT 1 CHECK (template_version > 0),
  CHECK (NOT needs_hr_approval OR assignee_role='employee')
);

CREATE TABLE employee_onboarding.onboarding_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employee_onboarding.employees(id),
  template_key text NOT NULL REFERENCES employee_onboarding.onboarding_task_templates(template_key),
  template_version integer NOT NULL CHECK (template_version > 0),
  title text NOT NULL,
  detail text NOT NULL DEFAULT '',
  assignee_role text NOT NULL CHECK (assignee_role IN ('hr','employee')),
  assigned_to uuid REFERENCES employee_onboarding.user_accounts(id),
  due_date date NOT NULL,
  needs_hr_approval boolean NOT NULL,
  execution_mode text NOT NULL,
  sort_order integer NOT NULL,
  source_verified boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','awaiting_hr','completed')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  approved_by uuid REFERENCES employee_onboarding.user_accounts(id),
  approved_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, template_key),
  CHECK (needs_hr_approval OR status <> 'awaiting_hr'),
  CHECK (status <> 'completed' OR NOT needs_hr_approval OR (approved_by IS NOT NULL AND approved_at IS NOT NULL)),
  CHECK ((approved_by IS NULL) = (approved_at IS NULL))
);
CREATE INDEX phase2_employee_tasks ON employee_onboarding.onboarding_tasks(employee_id,sort_order,template_key);
CREATE INDEX phase2_pending_hr ON employee_onboarding.onboarding_tasks(status,needs_hr_approval) WHERE status='awaiting_hr';

CREATE TABLE employee_onboarding.onboarding_task_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  task_id uuid NOT NULL REFERENCES employee_onboarding.onboarding_tasks(id),
  actor_user_id uuid REFERENCES employee_onboarding.user_accounts(id),
  action text NOT NULL CHECK (action IN ('created','status_changed','hr_approved')),
  from_status text,
  to_status text NOT NULL,
  version integer NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX phase2_task_events ON employee_onboarding.onboarding_task_events(task_id,id);

CREATE FUNCTION employee_onboarding.phase2_log_task_event() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE actor uuid;
DECLARE action_name text;
BEGIN
  actor := NULLIF(current_setting('app.actor_user_id', true),'')::uuid;
  IF TG_OP='INSERT' THEN
    action_name := 'created';
    INSERT INTO employee_onboarding.onboarding_task_events(task_id,actor_user_id,action,from_status,to_status,version)
    VALUES(NEW.id,actor,action_name,NULL,NEW.status,NEW.version);
  ELSIF OLD.status IS DISTINCT FROM NEW.status OR OLD.approved_by IS DISTINCT FROM NEW.approved_by THEN
    action_name := CASE WHEN OLD.approved_by IS NULL AND NEW.approved_by IS NOT NULL THEN 'hr_approved' ELSE 'status_changed' END;
    INSERT INTO employee_onboarding.onboarding_task_events(task_id,actor_user_id,action,from_status,to_status,version)
    VALUES(NEW.id,actor,action_name,OLD.status,NEW.status,NEW.version);
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER phase2_task_events_insert AFTER INSERT ON employee_onboarding.onboarding_tasks
FOR EACH ROW EXECUTE FUNCTION employee_onboarding.phase2_log_task_event();
CREATE TRIGGER phase2_task_events_update AFTER UPDATE ON employee_onboarding.onboarding_tasks
FOR EACH ROW EXECUTE FUNCTION employee_onboarding.phase2_log_task_event();

INSERT INTO employee_onboarding.onboarding_task_templates
(template_key,scope,title,detail,assignee_role,due_offset_days,needs_hr_approval,execution_mode,sort_order)
VALUES
('G-01','general','Personal- und Startdaten überprüfen','HR prüft die Angaben vor dem ersten Arbeitstag.','hr',-3,false,'ENTIRELY_HUMAN',10),
('G-02','general','Willkommensinformationen durchsehen','Die Begrüßung ist nur ein Entwurf; verbindliche Unternehmensregeln kommen von HR.','employee',0,false,'HOTL',20),
('G-03','general','Erstes Gespräch mit HR durchführen','HR organisiert und dokumentiert das Gespräch manuell.','hr',0,false,'ENTIRELY_HUMAN',30),
('G-04','general','Unternehmensregeln kennenlernen','Informationen lesen und offene Fragen mit HR klären.','employee',1,false,'ENTIRELY_HUMAN',40),
('G-05','general','Benötigte IT-Zugänge prüfen','Nur Bedarf prüfen, keine Accounts oder Berechtigungen erzeugen.','hr',0,false,'HITL',50),
('G-06','general','Zugangsbedarf zur HR-Freigabe melden','Die Aufgabe beantragt lediglich eine Prüfung; sie gewährt keine Berechtigung.','employee',1,true,'HITL',60),
('G-07','general','Datenschutz und Sicherheit kennenlernen','Einführung lesen und Verständnisfragen an HR richten.','employee',2,false,'ENTIRELY_HUMAN',70),
('G-08','general','Übergabe der Arbeitsmittel bestätigen','HR prüft die Bestätigung; keine automatische Geräteverwaltung.','employee',2,true,'HITL',80),
('G-09','general','Einführungstraining besuchen','Teilnahme durch die verantwortliche Person bestätigen.','employee',5,false,'ENTIRELY_HUMAN',90),
('G-10','general','Feedback zur ersten Woche geben','Kurzes persönliches Feedback an HR.','employee',7,false,'ENTIRELY_HUMAN',100),
('M-01','marketing','Marketing-Team kennenlernen','Kontaktpersonen und Zusammenarbeit im Team kennenlernen.','employee',0,false,'ENTIRELY_HUMAN',110),
('M-02','marketing','Markenleitlinien kennenlernen','Brand Guidelines und freigegebene Materialien lesen.','employee',1,false,'ENTIRELY_HUMAN',120),
('M-03','marketing','Bedarf an Marketing-Tools zur Freigabe melden','Canva/Analytics nur anfragen; keine realen Berechtigungen vergeben.','employee',1,true,'HITL',130),
('M-04','marketing','Kampagnenkalender kennenlernen','Aktuelle Planung mit der Marketing-Leitung besprechen.','employee',3,false,'ENTIRELY_HUMAN',140),
('M-05','marketing','Content- und Freigabeprozess verstehen','Vor Veröffentlichungen ist die menschliche Freigabe maßgeblich.','employee',5,false,'HOTL',150),
('M-06','marketing','Feedback zum Marketing-Onboarding geben','Offene Fragen mit der Marketing-Leitung besprechen.','employee',7,false,'ENTIRELY_HUMAN',160);

CREATE FUNCTION employee_onboarding.phase2_assign_tasks_to_employee() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO employee_onboarding.onboarding_tasks
  (employee_id,template_key,template_version,title,detail,assignee_role,due_date,
   needs_hr_approval,execution_mode,sort_order,source_verified)
  SELECT NEW.id,t.template_key,t.template_version,t.title,t.detail,t.assignee_role,
         NEW.start_date+t.due_offset_days,t.needs_hr_approval,t.execution_mode,t.sort_order,t.source_verified
  FROM employee_onboarding.onboarding_task_templates t
  WHERE t.scope='general' OR (t.scope='marketing' AND NEW.department='Marketing')
  ON CONFLICT (employee_id,template_key) DO NOTHING;
  RETURN NEW;
END; $$;
CREATE TRIGGER phase2_employee_tasks_insert AFTER INSERT ON employee_onboarding.employees
FOR EACH ROW EXECUTE FUNCTION employee_onboarding.phase2_assign_tasks_to_employee();

-- Upgrade existing synthetic MVP employees without ever deleting or resetting records.
INSERT INTO employee_onboarding.onboarding_tasks
(employee_id,template_key,template_version,title,detail,assignee_role,due_date,
 needs_hr_approval,execution_mode,sort_order,source_verified)
SELECT e.id,t.template_key,t.template_version,t.title,t.detail,t.assignee_role,
       e.start_date+t.due_offset_days,t.needs_hr_approval,t.execution_mode,t.sort_order,t.source_verified
FROM employee_onboarding.employees e CROSS JOIN employee_onboarding.onboarding_task_templates t
WHERE t.scope='general' OR (t.scope='marketing' AND e.department='Marketing')
ON CONFLICT (employee_id,template_key) DO NOTHING;
