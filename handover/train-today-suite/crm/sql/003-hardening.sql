DROP POLICY IF EXISTS visible_records ON crm.records;
CREATE POLICY visible_records ON crm.records FOR SELECT USING
 ((current_user<>'crm_agent' OR kind IN ('company','project','task','conversation','activity','service','availability')) AND (kind<>'settlement' OR crm.is_manager()) AND
 (crm.is_manager() OR kind IN ('company','event','service','availability') OR
 (kind='project' AND (owner_id=crm.actor() OR crm.project_access(id))) OR (project_id IS NOT NULL AND crm.project_access(project_id)) OR
 (kind='conversation' AND owner_id=crm.actor())));
DROP TRIGGER IF EXISTS protected_history ON crm.records;
CREATE OR REPLACE FUNCTION crm.protect_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.kind IN ('conversation','activity','rule') AND NEW.data<>OLD.data THEN RAISE EXCEPTION 'Original records are immutable'; END IF;
 IF OLD.kind='settlement' AND OLD.data->>'status'<>'draft' AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Decided settlement is immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER protected_history BEFORE UPDATE ON crm.records FOR EACH ROW EXECUTE FUNCTION crm.protect_history();
CREATE OR REPLACE FUNCTION crm.create_advisor(p_login text,p_name text,p_password text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,crm,public AS $$
DECLARE result uuid;
BEGIN
 IF NOT crm.is_manager() THEN RAISE EXCEPTION 'Manager required' USING ERRCODE='42501'; END IF;
 IF length(p_password)<12 OR p_login!~'^[a-z0-9._-]{3,60}$' OR length(trim(p_name))<2 THEN RAISE EXCEPTION 'Invalid user data'; END IF;
 INSERT INTO crm.users(login,name,role,password_hash) VALUES(p_login,p_name,'advisor',public.crypt(p_password,public.gen_salt('bf',10))) RETURNING id INTO result;
 RETURN result;
END $$;
CREATE OR REPLACE FUNCTION crm.set_advisor_active(p_user uuid,p_active boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,crm AS $$
BEGIN
 IF NOT crm.is_manager() THEN RAISE EXCEPTION 'Manager required' USING ERRCODE='42501'; END IF;
 UPDATE crm.users SET active=p_active WHERE id=p_user AND role='advisor';
 IF NOT FOUND THEN RAISE EXCEPTION 'Advisor not found'; END IF;
 IF NOT p_active THEN DELETE FROM crm.sessions WHERE user_id=p_user; END IF;
END $$;
REVOKE ALL ON FUNCTION crm.protect_history(),crm.create_advisor(text,text,text),crm.set_advisor_active(uuid,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crm.create_advisor(text,text,text),crm.set_advisor_active(uuid,boolean) TO crm_app;
