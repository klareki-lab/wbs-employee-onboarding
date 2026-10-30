CREATE TABLE IF NOT EXISTS crm.private_settings(key text PRIMARY KEY,value text NOT NULL);
REVOKE ALL ON crm.private_settings FROM PUBLIC,crm_app,crm_agent;
CREATE OR REPLACE FUNCTION crm.actor() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,crm,public AS $$
 SELECT CASE WHEN current_setting('crm.actor_signature',true)=
 encode(public.hmac(coalesce(current_setting('crm.actor_id',true),''),value,'sha256'),'hex')
 THEN nullif(current_setting('crm.actor_id',true),'')::uuid ELSE NULL END
 FROM crm.private_settings WHERE key='context_key'
$$;
REVOKE ALL ON FUNCTION crm.actor() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crm.actor() TO crm_app,crm_agent;
