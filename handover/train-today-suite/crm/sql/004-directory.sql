-- Minimal team directory for avoiding duplicate projects; no contacts, notes or money.
CREATE OR REPLACE FUNCTION crm.project_directory() RETURNS TABLE(id uuid,company_id text,title text,owner_id uuid,stage text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,crm AS $$
 SELECT r.id,r.data->>'company_id',r.data->>'title',r.owner_id,r.data->>'stage'
 FROM crm.records r WHERE r.kind='project' AND r.data->>'merged_into' IS NULL
 AND EXISTS(SELECT 1 FROM crm.users WHERE users.id=crm.actor() AND active)
$$;
REVOKE ALL ON FUNCTION crm.project_directory() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crm.project_directory() TO crm_app;
