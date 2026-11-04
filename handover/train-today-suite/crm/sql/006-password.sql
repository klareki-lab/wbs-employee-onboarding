CREATE OR REPLACE FUNCTION crm.change_password(old_password text,new_password text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,crm,public AS $$
BEGIN
 IF length(new_password)<12 THEN RAISE EXCEPTION 'Password too short'; END IF;
 UPDATE crm.users SET password_hash=public.crypt(new_password,public.gen_salt('bf',10))
 WHERE id=crm.actor() AND active AND password_hash=public.crypt(old_password,password_hash);
 IF NOT FOUND THEN RAISE EXCEPTION 'Current password incorrect' USING ERRCODE='42501'; END IF;
 DELETE FROM crm.sessions WHERE user_id=crm.actor();
END $$;
REVOKE ALL ON FUNCTION crm.change_password(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crm.change_password(text,text) TO crm_app;
