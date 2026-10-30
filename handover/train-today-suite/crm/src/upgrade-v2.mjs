import fs from 'node:fs';
const root=new URL('../',import.meta.url);
function edit(file,fn){const p=new URL(file,root);fs.writeFileSync(p,fn(fs.readFileSync(p,'utf8')));}
edit('src/domain.mjs',s=>{
 if(s.includes("from './workspace.mjs'"))return s;
 s="import {extraFields,normalizeWorkspace,workspaceCommand} from './workspace.mjs';\n"+s;
 s=s.replace('function clean(kind,data)',"for(const [kind,fields]of Object.entries(extraFields))allowed[kind]=[...(allowed[kind]||[]),...fields];\nfunction clean(kind,data)");
 s=s.replace(' return result;\n}', ' return normalizeWorkspace(kind,result);\n}');
 s=s.replace('async function perform(c,u,b){',"async function perform(c,u,b){\n const extra=await workspaceCommand(c,u,b);if(extra)return extra;");
 s=s.replaceAll("['event','service','availability','rule','order']","['event','service','availability','rule','order','campaign','task_template']");
 s=s.replaceAll("['company','event','service','availability','order']","['company','event','service','availability','order','campaign','task_template']");
 s=s.replace("['contact','task','activity','offer','order'].includes(kind)","['contact','task','activity','offer','order','ticket','appointment','document'].includes(kind)");
 s=s.replace("if(kind==='task'){if(!d.title", "if(['ticket','appointment'].includes(kind)){d.assignee_id=d.assignee_id||u.id;await assignedToProject(c,b.project_id,d.assignee_id);}\n  if(kind==='offer'){if(!d.title?.trim())fail('Angebotstitel erforderlich.');d.status=d.status||'draft';d.reference=d.reference||'ANG-'+randomUUID().slice(0,8).toUpperCase();await uniqueOffer(c,d.reference);}\n  if(kind==='task'){if(!d.title");
 s=s.replace("const d=clean(r.kind,{...r.data,...b.data});await refs(c,d);", "const d=clean(r.kind,{...r.data,...b.data});await refs(c,d);\n  if(['ticket','appointment'].includes(r.kind))await assignedToProject(c,r.project_id,d.assignee_id||u.id);\n  if(r.kind==='order'&&d.source_offer_id!==r.data.source_offer_id)fail('Angebotsverknüpfung ist unveränderlich.');\n  if(r.kind==='offer'){await uniqueOffer(c,d.reference,r.id);if(r.data.status!=='draft'&&['lines','amount','cost','tax_total','gross_total','reference','payment_terms','introduction','valid_until'].some(k=>canonical(d[k])!==canonical(r.data[k])))fail('Bereits ausgegebenes Angebot: bitte eine neue Fassung anlegen.');}");
 s=s.replace("const d=clean(kind,b.data);await refs(c,d);", "const d=clean(kind,b.data);await refs(c,d);if(kind==='order'&&d.source_offer_id)fail('Bitte Angebot in Auftrag übernehmen.');");
 s+=`\nasync function assignedToProject(c,id,user){if(!(await c.query('SELECT 1 FROM crm.members WHERE project_id=$1 AND user_id=$2 UNION SELECT 1 FROM crm.records WHERE id=$1 AND owner_id=$2',[id,user])).rowCount)fail('Zuständige Person muss am Projekt beteiligt sein.');}\nasync function uniqueOffer(c,ref,id=null){if(!ref?.trim())fail('Angebotsnummer fehlt.');await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,4))',[ref.trim().toLowerCase()]);if((await c.query("SELECT 1 FROM crm.records WHERE kind='offer' AND lower(data->>'reference')=lower($1) AND ($2::uuid IS NULL OR id<>$2)",[ref.trim(),id])).rowCount)fail('Angebotsnummer bereits vorhanden.',409);}\n`;
 return s;
});
edit('src/db.mjs',s=>s.replace("['company','event','service','availability'].includes(kind)","['company','event','service','availability','task_template'].includes(kind)"));
edit('src/server.mjs',s=>{
 if(s.includes("from './workspace.mjs'"))return s;
 s="import {workspaceApi} from './workspace.mjs';\n"+s;
 s=s.replace("const user=await auth(req);", "const user=await auth(req);\n if(req.method==='GET'&&pathname.startsWith('/api/v1/')){send(res,200,await transaction(user,c=>workspaceApi(c,user,pathname.slice(8),new URL(req.url,'http://localhost'))));return;}");
 return s;
});
edit('Start-CRM.ps1',s=>s.includes('013-crm-workspace.sql')?s:s.replace("if (-not (Test-Path -LiteralPath '.local-n8n.json')) {", "& $crmDocker compose exec -T db psql -U crm_owner -d crm -v ON_ERROR_STOP=1 -f /docker-entrypoint-initdb.d/013-crm-workspace.sql\nif ($LASTEXITCODE) { throw 'CRM-Erweiterung konnte nicht eingespielt werden.' }\nif (-not (Test-Path -LiteralPath '.local-n8n.json')) {"));
console.log('CRM v2 backend files updated.');
