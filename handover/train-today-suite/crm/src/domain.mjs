import {extraFields,normalizeWorkspace,workspaceCommand} from './workspace.mjs';
import {projectCommand,deliveryFields} from './projects.mjs';
import {randomUUID,createHash} from 'node:crypto';
import {transaction,fail,manager,record,add,put,audit,uuid} from './db.mjs';
export const stages=['new','qualified','consultation','offered','decision','won','lost'];
const canonical=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
const allowed={
 company:['name','website','industry','size','source_url','checked_at'],event:['name','starts_at','ends_at','cost'],
 project:['title','company_id','event_id','stage','paused','budget','budget_status','participants','decision_maker','start_date','format','language','training_interest','uncertainties','loss_reason','expected_value','newsletter_consent'],
 contact:['name','email','phone','role','decision_role','contact_preference','consent_note'],
 task:['title','due_at','status','type','assignee_id','result','priority'],
 activity:['type','note','occurred_at','outcome'],offer:['title','amount','cost','status','valid_until','version_note','reference'],
 order:['reference','amount','cost','paid_amount','refund_amount','cancelled','confirmed_at'],
 service:['title','description','topics','languages','formats','reference_url','duration'],
 availability:['title','trainer','service_id','starts_at','ends_at','status'],
 rule:['title','pool_percent','origin_percent','qualification_percent','closing_percent','effective_from'],
 handoff:['recipient_id','note'],settlement:[]
};
for(const [kind,fields]of Object.entries(extraFields))allowed[kind]=[...(allowed[kind]||[]),...fields];
function clean(kind,data){if(!allowed[kind])fail('Unbekannter Datensatztyp.');if(!data||typeof data!=='object'||Array.isArray(data))fail('Daten fehlen.');
 const result={};for(const[k,v]of Object.entries(data)){if(!allowed[kind].includes(k))fail(`Nicht erlaubtes Feld: ${k}`);if(typeof v==='string'&&v.length>12000)fail('Text zu lang.');result[k]=v;}
 for(const k of ['amount','cost','paid_amount','refund_amount','budget','participants','expected_value','pool_percent','origin_percent','qualification_percent','closing_percent'])if(result[k]!==undefined&&result[k]!==null&&result[k]!==''){result[k]=Number(result[k]);if(!Number.isFinite(result[k])||result[k]<0)fail(`Ungültiger Zahlenwert: ${k}`);}else if(k in result)result[k]=null;
 for(const k of ['company_id','event_id','assignee_id','recipient_id','service_id'])if(result[k]&&!uuid.test(result[k]))fail(`Ungültige Referenz: ${k}`);
 for(const k of ['due_at','occurred_at','starts_at','ends_at','confirmed_at','checked_at','start_date','valid_until','effective_from'])if(result[k]&&!Number.isFinite(Date.parse(result[k])))fail(`Ungültiges Datum: ${k}`);
 for(const k of ['website','source_url','reference_url'])if(result[k]){let u;try{u=new URL(result[k]);}catch{fail('Vollständige HTTPS-Adresse verwenden.');}if(!['http:','https:'].includes(u.protocol))fail('Nur Web-Adressen erlaubt.');}
 if(result.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.email))fail('E-Mail-Adresse prüfen.');
 for(const k of ['paused','cancelled','newsletter_consent'])if(k in result&&typeof result[k]!=='boolean')fail('Ja/Nein-Wert erforderlich: '+k);
 if(result.budget_status&&!['approved','planned','unknown','not_disclosed','no_budget'].includes(result.budget_status))fail('Unbekannter Budgetstatus.');
 if(result.training_interest&&!['leadership','communication','sales','project_management','digital_skills','ai_automation','other'].includes(result.training_interest))fail('Unbekannter Trainingsbedarf.');
 if(kind==='project'){if('stage' in result&&!stages.includes(result.stage))fail('Unbekannte Vertriebsphase.');if(result.stage==='lost'&&!result.loss_reason?.trim())fail('Bitte einen Verlustgrund dokumentieren.');}
 if(kind==='task'&&'status' in result&&!['open','done','cancelled'].includes(result.status))fail('Unbekannter Aufgabenstatus.');
 if(kind==='offer'&&'status' in result&&!['draft','sent','accepted','declined','expired'].includes(result.status))fail('Unbekannter Angebotsstatus.');
 if(kind==='activity'&&result.type&&!['call_attempt','contacted','next_agreed','meeting','email_draft','email_sent','note','correction'].includes(result.type))fail('Unbekannte Aktivität.');
 if(kind==='order'&&Number(result.refund_amount||0)>Number(result.paid_amount||0))fail('Erstattung übersteigt Zahlung.');
 if(kind==='rule'){if(Number(result.pool_percent)>100||['origin_percent','qualification_percent','closing_percent'].reduce((s,k)=>s+Number(result[k]||0),0)!==100)fail('Anteile müssen zusammen 100 % ergeben; Prämientopf höchstens 100 %.');}
 return normalizeWorkspace(kind,result);
}
async function refs(c,d){for(const[k,kind]of [['company_id','company'],['event_id','event'],['service_id','service']])if(d[k])await record(c,d[k],kind);for(const k of ['assignee_id','recipient_id'])if(d[k]&&!(await c.query('SELECT id FROM crm.users WHERE id=$1 AND active',[d[k]])).rowCount)fail('Person nicht aktiv.');}
function summary(r){return {id:r.id,kind:r.kind,project_id:r.project_id,owner_id:r.owner_id,data:r.data,version:r.version};}
async function auditRecord(c,u,action,before,after,reason){await audit(c,u,action,after?.id||before.id,before?summary(before):null,after?summary(after):null,reason);}
async function ensureMember(c,p,user,contribution='support',weight=1){await c.query('INSERT INTO crm.members(project_id,user_id,contribution,weight) VALUES($1,$2,$3,$4) ON CONFLICT(project_id,user_id,contribution) DO UPDATE SET weight=excluded.weight',[p,user,contribution,weight]);}
export async function snapshot(user){return transaction(user,async c=>{
 const records=(await c.query('SELECT * FROM crm.records ORDER BY created_at DESC')).rows;
 const people=(await c.query('SELECT id,name,role,active FROM crm.users WHERE active OR crm.is_manager() ORDER BY name')).rows;
 const members=(await c.query('SELECT * FROM crm.members WHERE crm.project_access(project_id)')).rows;
 const outbox=(await c.query('SELECT o.id,o.conversation_id,o.state,o.attempts,o.last_error,o.core_lead_id,o.core_status FROM crm.outbox o JOIN crm.records r ON r.id=o.conversation_id')).rows;
 const history=['manager','admin'].includes(user.role)?(await c.query('SELECT * FROM crm.audit ORDER BY created_at DESC,id DESC LIMIT 300')).rows:[];
 const directory=(await c.query('SELECT * FROM crm.project_directory()')).rows;
 const cohorts=[];
 if(['manager','admin'].includes(user.role))for(const days of [30,60,90]){
 const result=(await c.query(`WITH projects AS (
 SELECT p.id,COALESCE(NULLIF(e.data->>'starts_at','')::timestamptz,p.created_at) AS origin
 FROM crm.records p LEFT JOIN crm.records e ON e.id=NULLIF(p.data->>'event_id','')::uuid
 WHERE p.kind='project' AND p.data->>'merged_into' IS NULL), eligible AS
 (SELECT * FROM projects WHERE origin+make_interval(days=>$1)<=now())
 SELECT count(*)::int AS eligible,count(*) FILTER(WHERE (SELECT a.after_data#>>'{data,stage}' FROM crm.audit a WHERE a.record_id=eligible.id AND a.after_data#>>'{data,stage}' IS NOT NULL AND a.created_at<=eligible.origin+make_interval(days=>$1) ORDER BY a.created_at DESC,a.id DESC LIMIT 1)='won')::int AS won FROM eligible`,[days])).rows[0];cohorts.push({days,...result});}
 return {user,records,people,members,outbox,history,directory,cohorts,server_time:new Date().toISOString(),core_configured:!!process.env.CORE_BASE_URL,core_mode:process.env.CORE_MODE||'disconnected',ai_configured:!!process.env.AI_API_KEY};
});}
export async function command(user,body){if(!uuid.test(body.request_id||''))fail('Eine stabile Anfrage-ID ist erforderlich.');
 return transaction(user,async c=>{
 await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[user.id+body.request_id]);
 const digest=createHash('sha256').update(JSON.stringify(body)).digest('hex');
 const prior=(await c.query('SELECT * FROM crm.requests WHERE user_id=$1 AND request_id=$2',[user.id,body.request_id])).rows[0];
 if(prior){if(prior.digest!==digest)fail('Diese Anfrage-ID wurde bereits mit anderen Daten verwendet.',409);return {...prior.result,replayed:true};}
 const result=await perform(c,user,body);
 await c.query('INSERT INTO crm.requests(user_id,request_id,digest,result) VALUES($1,$2,$3,$4)',[user.id,body.request_id,digest,result]);return result;
 });
}
async function perform(c,u,b){
 const projectAction=await projectCommand(c,u,b);if(projectAction)return projectAction;
 const extra=await workspaceCommand(c,u,b);if(extra)return extra;
 if(b.action==='remove_contribution'){manager(u);await record(c,b.project_id,'project');if(!b.reason?.trim())fail('Entfernung bitte begründen.');const old=(await c.query('DELETE FROM crm.members WHERE project_id=$1 AND user_id=$2 AND contribution=$3 RETURNING *',[b.project_id,b.user_id,b.contribution])).rows[0];if(!old)fail('Beitrag nicht gefunden.',404);await audit(c,u,'contribution_removed',b.project_id,old,null,b.reason);return{ok:true};}
 if(b.action==='change_password'){if(typeof b.old_password!=='string'||typeof b.new_password!=='string'||b.new_password.length<12)fail('Aktuelles Passwort und mindestens zwölf Zeichen für das neue Passwort erforderlich.');await c.query('SELECT crm.change_password($1,$2)',[b.old_password,b.new_password]);await audit(c,u,'password_changed',u.id,null,null,'Alle bisherigen Sitzungen beendet.');return{ok:true};}
 if(b.action==='retry_delivery'){manager(u);if(!uuid.test(b.id||''))fail('Übertragung fehlt.');const old=(await c.query('SELECT * FROM crm.outbox WHERE id=$1 FOR UPDATE',[b.id])).rows[0];if(!old||old.core_lead_id||old.state==='leased')fail('Nur noch nicht bestätigte, nicht laufende Übertragungen erneut einreihen.');if(!b.reason?.trim())fail('Erneuten Versuch bitte begründen.');await c.query("UPDATE crm.outbox SET state='pending',attempts=0,retry_at=now(),last_error=null WHERE id=$1",[b.id]);await audit(c,u,'retry_delivery',old.conversation_id,{state:old.state},{state:'pending'},b.reason);return{ok:true};}
 if(b.action==='create_advisor'){manager(u);const login=String(b.login||'').trim().toLowerCase(),password=String(b.password||'');if(password.length<12||!b.name?.trim())fail('Name und ein Passwort mit mindestens 12 Zeichen erforderlich.');const id=(await c.query('SELECT crm.create_advisor($1,$2,$3) AS id',[login,b.name.trim(),password])).rows[0].id;await audit(c,u,'user_created',id,null,{login,name:b.name,role:'advisor'},'Persönlicher Beraterzugang angelegt.');return{ok:true,id};}
 if(b.action==='set_advisor_active'){manager(u);if(!uuid.test(b.user_id||''))fail('Person fehlt.');if(!b.reason?.trim())fail('Änderung bitte begründen.');await c.query('SELECT crm.set_advisor_active($1,$2)',[b.user_id,b.active===true]);await audit(c,u,'user_active_changed',b.user_id,null,{active:b.active===true},b.reason);return{ok:true};}
 if(b.action==='capture')return capture(c,u,b);
 if(b.action==='create'){
  if(Object.keys(b.data||{}).some(k=>deliveryFields.includes(k)))fail('Projektplanung bitte über die Projektübersicht ändern.');
  const kind=b.kind;if(['event','service','availability','rule','order','campaign','task_template'].includes(kind))manager(u);
  if(['settlement','handoff','conversation'].includes(kind))fail('Bitte die zugehörige Fachaktion verwenden.');
  const d=clean(kind,b.data);await refs(c,d);if(kind==='order'&&d.source_offer_id)fail('Bitte Angebot in Auftrag übernehmen.');
  if(['contact','task','activity','offer','order','ticket','appointment','document'].includes(kind)&&!b.project_id)fail('Projekt erforderlich.');
  if(b.project_id){const p=await record(c,b.project_id,'project');if(p.data.merged_into)fail('Bitte das zusammengeführte Hauptprojekt öffnen.');}
  if(kind==='project'){if(!d.title?.trim()||!d.company_id)fail('Projektname und Unternehmen erforderlich.');d.stage=d.stage||'new';if(d.stage==='won')fail('Zuerst die Chance anlegen und anschließend einen bestätigten Auftrag erfassen.');}
  if(['ticket','appointment'].includes(kind)){d.assignee_id=d.assignee_id||u.id;await assignedToProject(c,b.project_id,d.assignee_id);}
  if(kind==='offer'){if(!d.title?.trim())fail('Angebotstitel erforderlich.');d.status=d.status||'draft';d.reference=d.reference||'ANG-'+randomUUID().slice(0,8).toUpperCase();await uniqueOffer(c,d.reference);}
  if(kind==='task'){if(!d.title?.trim())fail('Aufgabentitel erforderlich.');d.status=d.status||'open';d.assignee_id=d.assignee_id||u.id;if(d.assignee_id!==u.id){const ok=(await c.query('SELECT 1 FROM crm.members WHERE project_id=$1 AND user_id=$2 UNION SELECT 1 FROM crm.records WHERE id=$1 AND owner_id=$2',[b.project_id,d.assignee_id])).rowCount;if(!ok)fail('Aufgaben nur an Projektbeteiligte vergeben.');}}
  if(kind==='order'){if(!d.reference?.trim())fail('Auftragsnummer erforderlich.');await uniqueOrder(c,d.reference);}
  const r=await add(c,u,kind,d,b.project_id||null);if(kind==='project')await ensureMember(c,r.id,u.id,'origin');
  await auditRecord(c,u,'create',null,r);return {record:r};
 }
 if(b.action==='update'){
  if(Object.keys(b.data||{}).some(k=>deliveryFields.includes(k)))fail('Projektplanung bitte über die Projektübersicht ändern.');
  const r=await record(c,b.id);if(r.version!==b.version)fail('Zwischenzeitlich geändert. Ansicht aktualisieren und Änderungen prüfen.',409);
  if(['conversation','activity','settlement','rule','handoff'].includes(r.kind))fail('Dieser Verlauf ist unveränderlich; bitte Ergänzung oder Fachaktion verwenden.');
  if(['company','event','service','availability','order','campaign','task_template'].includes(r.kind))manager(u);
  const d=clean(r.kind,{...r.data,...b.data});await refs(c,d);
  if(['ticket','appointment'].includes(r.kind))await assignedToProject(c,r.project_id,d.assignee_id||u.id);
  if(r.kind==='order'&&d.source_offer_id!==r.data.source_offer_id)fail('Angebotsverknüpfung ist unveränderlich.');
  if(r.kind==='offer'){await uniqueOffer(c,d.reference,r.id);if(r.data.status!=='draft'&&(d.status==='draft'||['lines','amount','cost','tax_total','gross_total','reference','payment_terms','introduction','valid_until'].some(k=>canonical(d[k])!==canonical(r.data[k]))))fail('Bereits ausgegebenes Angebot: bitte eine neue Fassung anlegen.');}
  if(r.kind==='project'&&d.stage==='won'){if(!(await c.query("SELECT 1 FROM crm.records WHERE project_id=$1 AND kind='order' AND coalesce((data->>'cancelled')::boolean,false)=false",[r.id])).rowCount)fail('Für „Gewonnen“ zuerst einen bestätigten Auftrag hinterlegen.');}
  if(r.kind==='order'){await uniqueOrder(c,d.reference,r.id);if(!b.reason?.trim())fail('Änderung einer Zahlung oder eines Auftrags bitte begründen.');}
  if(r.kind==='task'&&d.assignee_id!==r.data.assignee_id)fail('Zuständigkeit über eine neue Aufgabe oder bestätigte Übergabe ändern.');
  const next=await put(c,r,d);await auditRecord(c,u,'update',r,next,b.reason);return {record:next};
 }
 if(b.action==='handoff'){
  const p=await record(c,b.project_id,'project');if(p.owner_id!==u.id&&!['manager','admin'].includes(u.role))fail('Nur Projektverantwortliche dürfen eine Übergabe anfragen.',403);
  const d=clean('handoff',b.data);await refs(c,d);if(!d.recipient_id||d.recipient_id===p.owner_id)fail('Andere Empfängerperson wählen.');
  const r=await add(c,u,'handoff',{...d,status:'pending',previous_owner:p.owner_id},p.id);await auditRecord(c,u,'handoff_requested',null,r);return {record:r};
 }
 if(b.action==='handoff_decision'){
  const h=await record(c,b.id,'handoff');if(h.data.recipient_id!==u.id)fail('Nur die angefragte Person kann die Übergabe annehmen oder ablehnen.',403);
  if(h.data.status!=='pending')fail('Übergabe bereits entschieden.',409);const p=await record(c,h.project_id,'project');
  const accepted=b.accept===true;if(accepted){if(p.owner_id!==h.data.previous_owner)fail('Projektverantwortung wurde bereits geändert.',409);await ensureMember(c,p.id,u.id);await c.query('UPDATE crm.records SET owner_id=$2,version=version+1,updated_at=now() WHERE id=$1',[p.id,u.id]);}
  const r=await put(c,h,{...h.data,status:accepted?'accepted':'declined',decided_at:new Date().toISOString()});await auditRecord(c,u,'handoff_decision',h,r);return {record:r};
 }
 if(b.action==='contribution'){
  manager(u);await record(c,b.project_id,'project');if(!['origin','qualification','closing','support'].includes(b.contribution)||!Number.isFinite(Number(b.weight))||Number(b.weight)<=0)fail('Beitragsart oder Gewicht ungültig.');
  if(!uuid.test(b.user_id||'')||!(await c.query('SELECT 1 FROM crm.users WHERE id=$1 AND active',[b.user_id])).rowCount)fail('Person fehlt.');if(!b.reason?.trim())fail('Beitrag bitte begründen.');
  const old=(await c.query('SELECT * FROM crm.members WHERE project_id=$1',[b.project_id])).rows;await ensureMember(c,b.project_id,b.user_id,b.contribution,Number(b.weight));
  await audit(c,u,'contribution',b.project_id,old,{user_id:b.user_id,contribution:b.contribution,weight:Number(b.weight)},b.reason);return {ok:true};
 }
 if(b.action==='merge'){
  manager(u);if(b.id===b.target_id)fail('Zwei unterschiedliche Projekte wählen.');
  // Stable lock order avoids concurrent merge deadlocks.
  const ids=[b.id,b.target_id].sort();for(const id of ids)await record(c,id,'project');
  const source=await record(c,b.id,'project'),target=await record(c,b.target_id,'project');
  if(source.data.merged_into||target.data.merged_into||source.data.company_id!==target.data.company_id)fail('Nur aktive Projekte desselben Unternehmens zusammenführen.');
  if(!b.reason?.trim())fail('Abgleich und Entscheidung bitte begründen.');
  if((await c.query("SELECT 1 FROM crm.records WHERE kind='settlement' AND project_id=ANY($1::uuid[]) AND data->>'status'='approved'",[[source.id,target.id]])).rowCount)fail('Freigegebene Prämie vorhanden. Erst Korrekturprozess abschließen.');
  if((await c.query("SELECT 1 FROM crm.records WHERE kind='time_entry' AND project_id=ANY($1::uuid[]) AND data->>'status'='approved'",[[source.id,target.id]])).rowCount)fail('Freigegebene Zeitnachweise vorhanden. Projekte mit bestätigten Leistungsnachweisen bleiben getrennte Akten.');
  const children=(await c.query('SELECT id,version FROM crm.records WHERE project_id=$1 FOR UPDATE',[source.id])).rows;
  const members=(await c.query('SELECT * FROM crm.members WHERE project_id=$1',[source.id])).rows;
  const targetMembers=(await c.query('SELECT * FROM crm.members WHERE project_id=$1 ORDER BY user_id,contribution',[target.id])).rows;
  await c.query('UPDATE crm.records SET project_id=$2,version=version+1,updated_at=now() WHERE project_id=$1',[source.id,target.id]);
  for(const m of members)await c.query('INSERT INTO crm.members(project_id,user_id,contribution,weight) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[target.id,m.user_id,m.contribution,m.weight]);
  const mergedMembers=(await c.query('SELECT * FROM crm.members WHERE project_id=$1 ORDER BY user_id,contribution',[target.id])).rows;
  const r=await put(c,source,{...source.data,merged_into:target.id});
  await audit(c,u,'merge',source.id,{source:summary(source),children,members,targetMembers},{target_id:target.id,source:summary(r),mergedMembers},b.reason);return {record:r};
 }
 if(b.action==='unmerge'){
  manager(u);const s=await record(c,b.id,'project');if(!s.data.merged_into)fail('Projekt ist nicht zusammengeführt.');if(!b.reason?.trim())fail('Trennung bitte begründen.');
  const log=(await c.query("SELECT * FROM crm.audit WHERE record_id=$1 AND action='merge' ORDER BY id DESC LIMIT 1",[s.id])).rows[0];if(!log)fail('Zusammenführungsverlauf fehlt.');
  await record(c,s.data.merged_into,'project');
  const currentMembers=(await c.query('SELECT * FROM crm.members WHERE project_id=$1 ORDER BY user_id,contribution',[s.data.merged_into])).rows;
  if(!log.before_data.targetMembers||canonical(currentMembers)!==canonical(log.after_data.mergedMembers))fail('Beiträge wurden nach der Zusammenführung geändert. Manuelle Klärung erforderlich.',409);
  if((await c.query("SELECT 1 FROM crm.records WHERE kind='settlement' AND project_id=ANY($1::uuid[]) AND data->>'status'='approved'",[[s.id,s.data.merged_into]])).rowCount)fail('Freigegebene Prämie vorhanden; Trennung gesperrt.');
  for(const child of log.before_data.children){const r=await record(c,child.id);if(r.version!==child.version+1||r.project_id!==s.data.merged_into)fail('Nach Zusammenführung bearbeitet. Manuelle Klärung erforderlich.',409);}
  for(const child of log.before_data.children)await c.query('UPDATE crm.records SET project_id=$2,version=version+1,updated_at=now() WHERE id=$1',[child.id,s.id]);
  await c.query('DELETE FROM crm.members WHERE project_id=$1',[s.data.merged_into]);for(const m of log.before_data.targetMembers)await ensureMember(c,s.data.merged_into,m.user_id,m.contribution,m.weight);
  const d={...s.data};delete d.merged_into;const next=await put(c,s,d);await auditRecord(c,u,'unmerge',s,next,b.reason);return {record:next};
 }
 if(b.action==='settlement')return settlement(c,u,b);
 if(b.action==='settlement_decision'){
  manager(u);const r=await record(c,b.id,'settlement');if(r.data.status!=='draft')fail('Entscheidung ist bereits abgeschlossen.',409);
  if(!b.reason?.trim())fail('Freigabeentscheidung bitte begründen.');
  // Recompute under the project lock. Changed payments, shares or rule invalidate a draft.
  await record(c,r.project_id,'project');const calculation=await calculate(c,r.project_id,r.data.rule_id);
  if(canonical(calculation)!==canonical(r.data.calculation))fail('Berechnungsgrundlagen geändert. Neue Abrechnung erstellen.',409);
  if((await c.query("SELECT 1 FROM crm.records WHERE kind='settlement' AND project_id=$1 AND data->>'status'='approved' AND data->>'basis_hash'=$2",[r.project_id,r.data.basis_hash])).rowCount)fail('Diese Grundlage wurde bereits freigegeben.',409);
  const next=await put(c,r,{...r.data,status:b.approve?'approved':'rejected',approved_by:u.id,decision_at:new Date().toISOString(),decision_reason:b.reason});await auditRecord(c,u,'settlement_decision',r,next,b.reason);return {record:next};
 }
 fail('Unbekannte Aktion.');
}
async function uniqueOrder(c,ref,id=null){if(!ref?.trim())fail('Auftragsnummer fehlt.');await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,1))',[ref.trim().toLowerCase()]);if((await c.query("SELECT id FROM crm.records WHERE kind='order' AND lower(data->>'reference')=lower($1) AND ($2::uuid IS NULL OR id<>$2)",[ref.trim(),id])).rowCount)fail('Diese Auftragsnummer existiert bereits.',409);}
async function capture(c,u,b){
 const f=b.data||{};if(!f.notes?.trim()||f.notes.length>10000)fail('Bitte eine Gesprächsnotiz mit höchstens 10.000 Zeichen eingeben.');
 if(Array.isArray(f.projects)&&f.projects.length>8)fail('Höchstens acht Projekte pro Gespräch erfassen.');
 if(f.occurred_at&&!Number.isFinite(Date.parse(f.occurred_at)))fail('Gesprächszeit prüfen.');
 let company;if(f.company_id)company=await record(c,f.company_id,'company');else{if(!f.company_name?.trim())fail('Unternehmen eingeben oder „Unbekannt“ verwenden.');const normalized=f.company_name.trim().toLowerCase();await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,2))',[normalized]);company=(await c.query("SELECT * FROM crm.records WHERE kind='company' AND lower(data->>'name')=$1",[normalized])).rows[0]||await add(c,u,'company',clean('company',{name:f.company_name.trim(),website:f.website||''}));}
 if(f.event_id)await record(c,f.event_id,'event');
 const projects=[];for(const item of (Array.isArray(f.projects)&&f.projects.length?f.projects:[{title:f.title||'Bedarf klären'}]).slice(0,8)){
  let p;if(item.id){p=await record(c,item.id,'project');if(p.data.company_id!==company.id||p.data.merged_into)fail('Projekt gehört nicht zum gewählten Unternehmen oder ist zusammengeführt.');}
  else{const multiple=f.projects?.length>1;p=await add(c,u,'project',clean('project',{title:item.title||'Bedarf klären',company_id:company.id,event_id:f.event_id||null,stage:'new',budget:multiple?null:f.budget??null,budget_status:multiple?'unknown':f.budget_status||'unknown',participants:multiple?null:f.participants??null,training_interest:f.training_interest||'other',uncertainties:(f.uncertainties||'')+(multiple?' Mehrere Vorhaben: gemeinsame Budget- und Teilnehmerangaben erst nach fachlicher Zuordnung je Projekt übernehmen.':'')}));await ensureMember(c,p.id,u.id,'origin');}
  if(!projects.some(x=>x.id===p.id))projects.push(p);
 }
 const group=randomUUID();const conversations=[];
 for(const p of projects){const conv=await add(c,u,'conversation',{group_id:group,notes:f.notes,occurred_at:f.occurred_at||null,event_id:f.event_id||null,structured_capture:{budget:f.budget??null,participants:f.participants??null,budget_status:f.budget_status||'unknown'},uncertainties:f.uncertainties||'',contact_preference:f.contact_preference||'',confirmed_by_advisor:true,source:'advisor_form'},p.id);conversations.push(conv);
  if(f.contact_name||f.email||f.phone)await add(c,u,'contact',clean('contact',{name:f.contact_name||'',email:f.email||'',phone:f.phone||'',contact_preference:f.contact_preference||'',consent_note:f.consent_note||''}),p.id);
  if(f.next_step)await add(c,u,'task',clean('task',{title:f.next_step,due_at:f.follow_up_date||null,status:'open',assignee_id:u.id,priority:'normal',type:'follow_up'}),p.id);
  await auditRecord(c,u,'capture',null,conv);
 }
 const submission='crm-'+group;
 const payload={source:'internal_form',company_name:company.data.name,contact_name:f.contact_name||null,email:f.email||null,phone:f.phone||null,website:company.data.website||null,training_interest:f.training_interest||'other',budget_status:f.budget_status||'unknown',follow_up:f.follow_up_date?'on_date':'not_decided',follow_up_date:f.follow_up_date?f.follow_up_date.slice(0,10):null,notes:f.notes,submission_id:submission};
 await c.query('INSERT INTO crm.outbox(conversation_id,submission_id,payload) VALUES($1,$2,$3)',[conversations[0].id,submission,payload]);
 return {projects,conversations,submission_id:submission};
}
async function calculate(c,projectId,ruleId){
 const rule=await record(c,ruleId,'rule');const project=await record(c,projectId,'project');if(project.data.merged_into)fail('Zusammengeführtes Projekt ist keine eigene Prämiengrundlage.');
 const orders=(await c.query("SELECT * FROM crm.records WHERE kind='order' AND project_id=$1 ORDER BY id",[projectId])).rows;
 const members=(await c.query('SELECT * FROM crm.members WHERE project_id=$1 ORDER BY user_id,contribution',[projectId])).rows;
 const cents=n=>Math.round(Number(n||0)*100);
 const margin=orders.reduce((s,o)=>{const d=o.data;if(d.cancelled)return s;const amount=cents(d.amount),paid=Math.min(amount,Math.max(0,cents(d.paid_amount)-cents(d.refund_amount)));return s+Math.round(Math.max(0,amount-cents(d.cost))*(amount?paid/amount:0));},0);
 const pool=Math.round(margin*Number(rule.data.pool_percent)/100);
 const amounts={};let undistributed=0;
 for(const [role,key] of [['origin','origin_percent'],['qualification','qualification_percent'],['closing','closing_percent']]){
  const bucket=Math.floor(pool*Number(rule.data[key])/100),people=members.filter(m=>m.contribution===role),total=people.reduce((s,m)=>s+Number(m.weight),0);let assigned=0;
  for(const m of people){const value=Math.floor(bucket*Number(m.weight)/total);amounts[m.user_id]=(amounts[m.user_id]||0)+value;assigned+=value;}undistributed+=bucket-assigned;
 }
 const paid={};for(const old of(await c.query("SELECT data FROM crm.records WHERE kind='settlement' AND project_id=$1 AND data->>'status'='approved' ORDER BY created_at,id",[projectId])).rows)for(const [id,value]of Object.entries(old.data.delta_cents||{}))paid[id]=(paid[id]||0)+value;
 const delta={};for(const id of [...new Set([...Object.keys(amounts),...Object.keys(paid)])].sort())delta[id]=(amounts[id]||0)-(paid[id]||0);
 return {rule:summary(rule),orders:orders.map(summary),members,margin_cents:margin,pool_cents:pool,entitlement_cents:amounts,previous_approved_cents:paid,delta_cents:delta,undistributed_cents:pool-Object.values(amounts).reduce((a,b)=>a+b,0)};
}
async function settlement(c,u,b){manager(u);await record(c,b.project_id,'project');if(!b.reason?.trim())fail('Abrechnung bitte begründen.');const calc=await calculate(c,b.project_id,b.rule_id);
 const hash=createHash('sha256').update(canonical({orders:calc.orders,members:calc.members,rule:calc.rule})).digest('hex');
 if((await c.query("SELECT 1 FROM crm.records WHERE kind='settlement' AND project_id=$1 AND data->>'basis_hash'=$2 AND data->>'status' IN ('draft','approved')",[b.project_id,hash])).rowCount)fail('Für diese Grundlage existiert bereits eine Abrechnung.',409);
 const r=await add(c,u,'settlement',{title:b.reason,status:'draft',rule_id:b.rule_id,basis_hash:hash,calculation:calc,delta_cents:calc.delta_cents},b.project_id);await auditRecord(c,u,'settlement_draft',null,r,b.reason);return {record:r};}

async function assignedToProject(c,id,user){if(!(await c.query('SELECT 1 FROM crm.members WHERE project_id=$1 AND user_id=$2 UNION SELECT 1 FROM crm.records WHERE id=$1 AND owner_id=$2',[id,user])).rowCount)fail('Zuständige Person muss am Projekt beteiligt sein.');}
async function uniqueOffer(c,ref,id=null){if(!ref?.trim())fail('Angebotsnummer fehlt.');await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,4))',[ref.trim().toLowerCase()]);if((await c.query("SELECT 1 FROM crm.records WHERE kind='offer' AND lower(data->>'reference')=lower($1) AND ($2::uuid IS NULL OR id<>$2)",[ref.trim(),id])).rowCount)fail('Angebotsnummer bereits vorhanden.',409);}
