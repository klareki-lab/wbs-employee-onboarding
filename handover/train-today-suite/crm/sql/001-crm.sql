-- CRM extension only. Does not create or change Sergii's trade_fair schema.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA crm;
CREATE ROLE crm_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
CREATE ROLE crm_agent LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
CREATE TABLE crm.users (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), login text NOT NULL UNIQUE,
 name text NOT NULL, role text NOT NULL CHECK(role IN ('advisor','manager','admin')),
 password_hash text NOT NULL, active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE crm.sessions(token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES crm.users,
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE crm.login_limits (key text PRIMARY KEY, attempts int NOT NULL, blocked_until timestamptz, window_start timestamptz NOT NULL DEFAULT now());
CREATE TABLE crm.records (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), kind text NOT NULL CHECK(kind IN
 ('company','contact','event','project','conversation','task','activity','offer','order','handoff','service','availability','rule','settlement')),
 project_id uuid REFERENCES crm.records(id), owner_id uuid REFERENCES crm.users(id),
 data jsonb NOT NULL DEFAULT '{}', version int NOT NULL DEFAULT 1,
 created_by uuid REFERENCES crm.users, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(jsonb_typeof(data)='object')
);
CREATE INDEX records_kind ON crm.records(kind);
CREATE INDEX records_project ON crm.records(project_id);
CREATE TABLE crm.members(project_id uuid NOT NULL REFERENCES crm.records, user_id uuid NOT NULL REFERENCES crm.users,
 contribution text NOT NULL CHECK(contribution IN ('origin','qualification','closing','support')), weight numeric NOT NULL DEFAULT 1 CHECK(weight>0),
 PRIMARY KEY(project_id,user_id,contribution));
CREATE TABLE crm.audit(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, actor_id uuid REFERENCES crm.users,
 action text NOT NULL, record_id uuid, before_data jsonb, after_data jsonb, reason text, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE crm.requests(user_id uuid REFERENCES crm.users, request_id uuid NOT NULL, digest text NOT NULL, result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,request_id));
CREATE TABLE crm.outbox(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), conversation_id uuid NOT NULL UNIQUE REFERENCES crm.records,
 submission_id text NOT NULL UNIQUE, payload jsonb NOT NULL, state text NOT NULL DEFAULT 'pending',
 attempts int NOT NULL DEFAULT 0, lease_id uuid, lease_until timestamptz, retry_at timestamptz NOT NULL DEFAULT now(),
 core_lead_id text, core_status jsonb, last_error text, updated_at timestamptz NOT NULL DEFAULT now());
CREATE FUNCTION crm.actor() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('crm.actor_id',true),'')::uuid $$;
CREATE FUNCTION crm.is_manager() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,crm AS $$
 SELECT EXISTS(SELECT 1 FROM crm.users WHERE id=crm.actor() AND active AND role IN ('manager','admin')) $$;
CREATE FUNCTION crm.project_access(p uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,crm AS $$
 SELECT crm.is_manager() OR EXISTS(SELECT 1 FROM crm.records WHERE id=p AND kind='project' AND owner_id=crm.actor())
 OR EXISTS(SELECT 1 FROM crm.members WHERE project_id=p AND user_id=crm.actor())
 OR EXISTS(SELECT 1 FROM crm.records WHERE project_id=p AND kind='handoff' AND data->>'recipient_id'=crm.actor()::text AND data->>'status'='pending') $$;
ALTER TABLE crm.records ENABLE ROW LEVEL SECURITY;
CREATE POLICY visible_records ON crm.records FOR SELECT USING
 ((current_user<>'crm_agent' OR kind IN ('company','project','task','conversation','activity','service','availability')) AND (kind<>'settlement' OR crm.is_manager()) AND
 (crm.is_manager() OR kind IN ('company','event','service','availability') OR
 (kind='project' AND (owner_id=crm.actor() OR crm.project_access(id))) OR (project_id IS NOT NULL AND crm.project_access(project_id)) OR
 (kind='conversation' AND owner_id=crm.actor())));
CREATE POLICY insert_records ON crm.records FOR INSERT WITH CHECK
 (crm.is_manager() OR (kind IN ('company','project','conversation','contact','task','activity','offer','handoff') AND owner_id=crm.actor()
 AND (project_id IS NULL OR crm.project_access(project_id))));
CREATE POLICY update_records ON crm.records FOR UPDATE USING
 (crm.is_manager() OR (kind IN ('project','task','contact','offer','handoff') AND
 ((kind='project' AND (owner_id=crm.actor() OR crm.project_access(id))) OR (project_id IS NOT NULL AND crm.project_access(project_id)))))
 WITH CHECK (crm.is_manager() OR (kind IN ('project','task','contact','offer','handoff') AND
 ((kind='project' AND (owner_id=crm.actor() OR crm.project_access(id))) OR (project_id IS NOT NULL AND crm.project_access(project_id)))));
CREATE VIEW crm.agent_context WITH (security_invoker=true) AS
 SELECT id,kind,project_id, data - ARRAY['email','phone','address','private_note'] AS data, updated_at
 FROM crm.records WHERE kind IN ('company','project','task','conversation','activity','service','availability');
GRANT USAGE ON SCHEMA crm TO crm_app,crm_agent;
GRANT SELECT,INSERT,UPDATE ON crm.records TO crm_app;
GRANT SELECT ON crm.records,crm.agent_context TO crm_agent;
GRANT SELECT,INSERT,UPDATE,DELETE ON crm.sessions,crm.login_limits TO crm_app;
GRANT SELECT ON crm.users TO crm_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON crm.members TO crm_app;
GRANT SELECT,INSERT ON crm.audit,crm.requests TO crm_app;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA crm TO crm_app;
GRANT SELECT,INSERT,UPDATE ON crm.outbox TO crm_app;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA crm FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crm.actor(),crm.is_manager(),crm.project_access(uuid) TO crm_app,crm_agent;
ALTER DEFAULT PRIVILEGES IN SCHEMA crm REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER ROLE crm_agent SET default_transaction_read_only=on;
COMMENT ON ROLE crm_agent IS 'Read-only assistant; no table writes, no access to login secrets. Scope assigned by trusted server.';
CREATE FUNCTION crm.protect_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.kind IN ('conversation','activity','rule') AND NEW.data<>OLD.data THEN RAISE EXCEPTION 'Original records are immutable'; END IF;
 IF OLD.kind='settlement' AND OLD.data->>'status'<>'draft' AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Decided settlement is immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER protected_history BEFORE UPDATE ON crm.records FOR EACH ROW EXECUTE FUNCTION crm.protect_history();
CREATE FUNCTION crm.create_advisor(p_login text,p_name text,p_password text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,crm,public AS $$
DECLARE result uuid;
BEGIN
 IF NOT crm.is_manager() THEN RAISE EXCEPTION 'Manager required' USING ERRCODE='42501'; END IF;
 IF length(p_password)<12 OR p_login!~'^[a-z0-9._-]{3,60}$' OR length(trim(p_name))<2 THEN RAISE EXCEPTION 'Invalid user data'; END IF;
 INSERT INTO crm.users(login,name,role,password_hash) VALUES(p_login,p_name,'advisor',public.crypt(p_password,public.gen_salt('bf',10))) RETURNING id INTO result;
 RETURN result;
END $$;
CREATE FUNCTION crm.set_advisor_active(p_user uuid,p_active boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,crm AS $$
BEGIN
 IF NOT crm.is_manager() THEN RAISE EXCEPTION 'Manager required' USING ERRCODE='42501'; END IF;
 UPDATE crm.users SET active=p_active WHERE id=p_user AND role='advisor';
 IF NOT FOUND THEN RAISE EXCEPTION 'Advisor not found'; END IF;
 IF NOT p_active THEN DELETE FROM crm.sessions WHERE user_id=p_user; END IF;
END $$;
REVOKE ALL ON FUNCTION crm.protect_history(),crm.create_advisor(text,text,text),crm.set_advisor_active(uuid,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crm.create_advisor(text,text,text),crm.set_advisor_active(uuid,boolean) TO crm_app;
