CREATE OR REPLACE VIEW crm.agent_context WITH (security_invoker=true) AS
 SELECT id,kind,project_id, data - ARRAY['email','phone','address','private_note'] AS data, updated_at
 FROM crm.records WHERE kind IN ('company','project','task','conversation','activity','service','availability');
