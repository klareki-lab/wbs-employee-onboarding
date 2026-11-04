import {taskSpec,validateAction,employeeAction,visiblePersonal,ownsWorkTask} from './task-actions.mjs';
import {managementReport,completedAt} from './management.mjs';
import http from 'node:http';
import fs from 'node:fs/promises';
import {randomUUID,randomBytes,timingSafeEqual} from 'node:crypto';
import {call,unwrap} from './mcp.mjs';
import {catalog,modes} from './catalog.mjs';
import {cases,save,pool,messages} from './storage.mjs';
import {validateTaskChange,publicCase} from './domain.mjs';
import nodemailer from 'nodemailer';
const port=Number(process.env.PORT||3010),hrApi=process.env.HR_API||'http://localhost:3009/api';
const config=JSON.parse(await fs.readFile(new URL('config.json',import.meta.url),'utf8'));
const graph={};for(const kind of ['prepare','decision']){const d=JSON.parse(await fs.readFile(new URL(`workflows/${kind}.json`,import.meta.url),'utf8')).workflow;graph[kind]={id:d.id,name:d.name,nodes:d.nodes.filter(n=>n.type!=='n8n-nodes-base.stickyNote').map(n=>({id:n.id,name:n.name,type:n.type,position:n.position,notes:n.notes})),connections:d.connections};}
const fail=(msg,status=400)=>{throw Object.assign(new Error(msg),{status});};
const safe=v=>{if(Array.isArray(v))return v.map(safe);if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).filter(([k])=>!['headers','capability','webhookUrl','executionMode'].includes(k)).map(([k,x])=>[k,safe(x)]));return v;};
const view=c=>safe({id:c.id,updatedAt:c.updatedAt,hrEmployeeId:c.hrEmployeeId,employee:c.employee,status:c.status,createdAt:c.createdAt,result:c.result,error:c.error,runs:c.runs.map(r=>({kind:r.kind,executionId:r.executionId,status:r.status,events:r.events,startedAt:r.startedAt,stoppedAt:r.stoppedAt}))});
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function body(req){let s='';for await(const chunk of req){s+=chunk;if(Buffer.byteLength(s)>50000)fail('Anfrage zu groß.',413);}try{return JSON.parse(s||'{}');}catch{fail('Ungültiges JSON.');}}
function json(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));}
function extractRunData(d){return d?.resultData?.runData||d?.data?.resultData?.runData||d?.runData||{};}
function executionError(d){return d?.resultData?.error?.message||d?.data?.resultData?.error?.message||'Die n8n-Ausführung ist fehlgeschlagen. Details in n8n prüfen.';}
async function execute(c,kind){
 const run={kind,capability:randomBytes(32).toString('hex'),claimed:false,events:[],status:'starting',startedAt:new Date().toISOString()};c.runs.push(run);await save(c,'system','workflow-start',{kind});
 try{
  const r=unwrap(await call('execute_workflow',{workflowId:config[kind],executionMode:'production',triggerNodeName:'Dashboard-Aufruf',inputs:{webhookData:{method:'POST',body:{runId:c.id,capability:run.capability}}}}));
  if(!r.executionId)throw new Error('n8n hat keine Ausführungs-ID geliefert.');run.executionId=r.executionId;run.status='running';
  const deadline=Date.now()+155000;let failures=0;
  while(Date.now()<deadline){
   await delay(1200);
   let r;try{r=unwrap(await call('get_workflow_execution',{workflowId:config[kind],executionId:run.executionId,includeData:true}));failures=0;}catch(e){if(++failures<4)continue;throw e;}
   const ex=r.execution;if(!ex)continue;
   const rd=extractRunData(r.data);const events=[];
   for(const [name,entries]of Object.entries(rd))for(const [index,entry]of entries.entries()){
    const outputs=entry.data?.main||entry.data?.ai_languageModel||[];
    events.push({key:`${name}:${index}`,name,at:entry.startTime,duration:entry.executionTime||0,status:entry.error?'error':'done',output:safe(outputs.flat().map(x=>x.json??x)),error:entry.error?.message||null});
   }
   events.sort((a,b)=>a.at-b.at);run.events=events;run.status=ex.status;
   if(['success','error','canceled','crashed'].includes(ex.status)){
    run.stoppedAt=ex.stoppedAt;
    if(ex.status!=='success')throw new Error(executionError(r.data));
    const finals=kind==='prepare'?['HR-Prüfung bereit','Rückfrage an HR']:['Arbeitspaket freigeben','Zur Überarbeitung zurückgeben'];
    const last=events.findLast(e=>finals.includes(e.name));if(!last?.output?.[0])throw new Error('n8n ist fertig, aber das erwartete Ergebnis fehlt.');
    c.result=last.output[0];c.status=c.result.status;c.error=null;if(c.status==='approved')for(const t of c.result.tasks||[]){t.state=t.id==='G01'?'done':'open';t.assignee=t.owner;t.completedAt=t.id==='G01'?(c.runs.find(r=>r.kind==='prepare')?.stoppedAt||new Date().toISOString()):null;t.evidence=t.id==='G01'?'Pflichtfelder im Workflow geprüft.':'';}return;
   }
  }
  throw new Error('Ausführung konnte nicht rechtzeitig bestätigt werden. In n8n prüfen; kein automatischer Neustart.');
 }catch(e){run.status='error';run.stoppedAt=new Date().toISOString();c.status='error';c.error=String(e.message).slice(0,800);console.error('Onboarding',c.id,kind,c.error);}
 finally{run.capability=null;await save(c,'system','workflow-result',{kind,status:c.status});}
}
async function hrRequest(req,path){
 const cookie=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('wbs_onboarding_session='))||'';
 let response;try{response=await fetch(hrApi+path,{headers:{cookie},signal:AbortSignal.timeout(5000)});}catch{fail('HR-Anmeldung ist momentan nicht erreichbar.',503);}
 if(!response.ok)fail(response.status===401?'Bitte im HR-Portal anmelden und diese Seite neu laden.':'HR-Zugriff verweigert.',response.status);
 return response.json();
}
async function hrWrite(req,path,data,csrf){
 const cookie=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('wbs_onboarding_session='))||'';
 let r;try{r=await fetch(hrApi+path,{method:'POST',headers:{cookie,Origin:(process.env.PORTAL_ORIGIN||'http://localhost:5173'),'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify(data),signal:AbortSignal.timeout(8000)});}catch{fail('Portal nicht erreichbar. Aufgabe bleibt offen; erneut versuchen.',503);}
 if(!r.ok)fail(r.status===403?'Nur die Systemadministration darf diesen Zugang freischalten.':'Der Zugang konnte nicht im Mitarbeiterportal gespeichert werden.',r.status);
 return r.json();
}
async function executeTaskAction(req,principal,c,old,b){
 const spec=taskSpec(old.id),data=validateAction(old,b);
 if(spec.kind==='automatic')fail('Automatisch geprüfte Aufgaben können nicht manuell geändert werden.',409);
 if(b.publish){const required=spec.fields.filter(f=>f.required&&f.type!=='checkbox');for(const f of required)if(!data[f.key])fail('Bitte ausfüllen: '+f.label);}
 if((b.state==='done'||b.publish)&&!c.hrEmployeeId&&['access','portal','training','appointment','introduction','buddy','notification'].includes(spec.kind))fail('Bitte den Fall zuerst mit einem HR-Mitarbeiter verknüpfen.',409);
 if(spec.kind==='notification'&&data.recipientId){const roster=(await hrRequest(req,'/workspace/management-roster')).data;if(!roster.some(e=>e.id===data.recipientId))fail('Empfänger nicht gefunden.');}
 if(spec.kind==='welcome'&&b.state==='done'&&!(await messages(c.id)).some(m=>m.kind==='welcome'&&m.status==='sent'))fail('Begrüßung zuerst im Onboarding-Fall versenden und Zustellstatus prüfen.',409);
 if(spec.kind==='portal'&&b.state==='done'){
  const result=(await hrRequest(req,'/workspace/portal-check/'+c.hrEmployeeId)).data;
  if(!result.ready)fail('Noch kein aktivierter Mitarbeiter-Account. HR muss die Einladung und Aktivierung abschließen.',409);
  if(old.id==='M06'&&result.department!=='Marketing')fail('Der Mitarbeiter ist nicht der Abteilung Marketing zugeordnet.',409);
  b.evidence=`Aktiviertes Mitarbeiterkonto ${result.username}; Rolle Mitarbeiter; Abteilung ${result.department}.`;
 }
 if(b.state==='done'&&!b.evidence)b.evidence=spec.title+' – durch '+principal.user.username+' bestätigt.';
 // Validate all remaining fields before writing to the other database.
 validateTaskChange({...old,completedAt:completedAt(old,c)},b);
 if(b.resourceUrl){let u;try{u=new URL(b.resourceUrl);}catch{fail('Ungültiger Link.');}if((u.protocol!=='https:'&&!(u.protocol==='http:'&&u.hostname==='localhost'))||u.username||u.password)fail('Ungültiger Link.');}
 if(spec.kind==='access'&&b.state==='done'){
  await hrWrite(req,'/workspace/task-access',{employeeId:c.hrEmployeeId,taskId:old.id,username:data.username,url:data.url,scope:data.scope},principal.csrf_token);
  b.evidence=`${spec.system}: Zugang für den verknüpften Mitarbeiter in „Meine Zugänge“ gespeichert. Rechte: ${data.scope}`;
 }
 return data;
}
const transport=nodemailer.createTransport({host:process.env.SMTP_HOST||'wbs-onboarding-local-mailpit-1',port:1025,secure:false,ignoreTLS:true,connectionTimeout:5000,socketTimeout:10000});
let sending=false;
async function deliver(){if(sending)return;sending=true;try{
 const row=(await pool.query("UPDATE coordinator_mail SET status='sending' WHERE id=(SELECT id FROM coordinator_mail WHERE status='queued' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *")).rows[0];
 if(!row)return;
 try{await transport.sendMail({from:'Train Today <onboarding@example.invalid>',to:row.recipient,subject:row.subject,text:row.body,messageId:`<${row.id}@onboarding.local>`});await pool.query("UPDATE coordinator_mail SET status='sent',sent_at=now() WHERE id=$1",[row.id]);}
 catch{await pool.query("UPDATE coordinator_mail SET status='unknown' WHERE id=$1",[row.id]);}
 }catch{console.error('Mailbox processing failed; inspect local database.');}finally{sending=false;}}
setInterval(deliver,2000).unref();
const server=http.createServer(async(req,res)=>{try{
 const path=new URL(req.url,'http://localhost').pathname;
 if(path==='/internal/claim'&&req.method==='POST'){
  const b=await body(req),c=cases.get(b.runId),r=c?.runs.at(-1);const token=typeof b.capability==='string'?b.capability:'';
  if(!r||!r.capability||r.claimed||r.kind!==b.kind||token.length!==r.capability.length||!timingSafeEqual(Buffer.from(token),Buffer.from(r.capability)))fail('Auftrag nicht gültig oder bereits verwendet.',403);
  r.claimed=true;await save(c,'system','workflow-claimed');return json(res,200,b.kind==='prepare'?{runId:c.id,employee:c.employee}:{runId:c.id,plan:c.result,...c.decision});
 }
 const host=req.headers.host;if(![`localhost:${port}`,`127.0.0.1:${port}`].includes(host))fail('Ungültiger Host.',403);
 if(req.headers.origin&&!['http://localhost:'+port,'http://127.0.0.1:'+port,(process.env.PORTAL_ORIGIN||'http://localhost:5173')].includes(req.headers.origin))fail('Fremder Ursprung nicht erlaubt.',403);
 let principal=null;
 if(path.startsWith('/api/')){
  const auth=await hrRequest(req,'/auth/me');principal=auth.data;
  if(!principal?.user)fail('Bitte im HR-Portal anmelden und diese Seite neu laden.',401);
  if(!path.startsWith('/api/mine')&&!path.startsWith('/api/workspace/')&&principal.user.role!=='hr')fail('Nur HR darf Onboarding-Fälle verwalten.',403);
  if(req.method!=='GET'&&req.headers['x-onboarding-csrf']!==principal.csrf_token)fail('Bitte Dashboard neu laden.',403);
 }
 if(path.startsWith('/api/workspace/')){
  const profile=(await hrRequest(req,'/workspace/profile')).data;
  const hr=principal.user.role==='hr',admin=profile.systemAdmin===true;
  if(path==='/api/workspace/management'&&req.method==='GET'){
   if(!hr&&!profile.leadership)fail('Nur Geschäftsleitung und HR dürfen diese Übersicht öffnen.',403);
   const roster=(await hrRequest(req,'/workspace/management-roster')).data;
   return json(res,200,managementReport(cases.values(),roster));
  }
  if(path==='/api/workspace/tasks'&&req.method==='GET'){
   const entries=[];
   for(const c of cases.values()){
    if(c.status!=='approved')continue;
    if(!hr&&!admin&&c.hrEmployeeId!==principal.user.employee_id&&!(c.result?.tasks||[]).some(t=>t.actionPublished&&t.actionData?.recipientId===principal.user.employee_id))continue;
    const personalIds=new Set(publicCase(c).tasks.map(t=>t.id));
    for(const t of c.result?.tasks||[]){
     const lane=t.owner==='IT'?'it':'hr';
     const canManage=hr||(admin&&lane==='it')||ownsWorkTask(c,t,principal.user.employee_id);
     const recipient=t.actionPublished&&t.actionData?.recipientId===principal.user.employee_id;
     if(!canManage&&!recipient&&!(c.hrEmployeeId===principal.user.employee_id&&personalIds.has(t.id)))continue;
     entries.push({caseId:c.id,employeeName:c.employee.fullName,employeeId:c.hrEmployeeId,department:c.employee.department,id:t.id,title:t.title,due:t.due,state:t.state||'open',owner:t.owner,lane,assignee:t.assignee||t.owner,canManage,actionSpec:taskSpec(t.id),actionData:canManage?(t.actionData||{}):employeeAction(t),actionPublished:!!t.actionPublished,dependencies:['G19','M12'].includes(t.id)?c.result.tasks.filter(x=>x.category!=='business'&&x.id!==t.id&&x.state!=='done'&&(t.id==='M12'?['M01','M02','M03','M04','M05','M06'].includes(x.id):!['G20','M13'].includes(x.id))).map(x=>({id:x.id,title:x.title})):[],
      evidence:canManage?t.evidence:undefined,comments:canManage?(t.comments||[]):undefined,resourceUrl:t.resourceUrl||'',employeeConfirmation:canManage?t.employeeConfirmation:undefined,confirmationRequested:!!t.employeeConfirmation});
    }
   }
   return json(res,200,{csrf:principal.csrf_token,hr,systemAdmin:admin,entries});
  }
  const edit=path.match(/^\/api\/workspace\/tasks\/([a-f0-9-]+)\/([GM][0-9]{2})$/);
  if(edit&&req.method==='PATCH'){
   const c=cases.get(edit[1]),old=c?.result?.tasks?.find(t=>t.id===edit[2]);
   if(!c||c.status!=='approved'||!old)fail('Aufgabe nicht gefunden.',404);
   if(!hr&&!(admin&&old.owner==='IT')&&!ownsWorkTask(c,old,principal.user.employee_id))fail('Diese Aufgabe gehört nicht zu deinem Verantwortungsbereich.',403);
   const b=await body(req);
   if(!hr&&!admin&&ownsWorkTask(c,old,principal.user.employee_id))b.assignee=old.assignee;
   if(['G19','M12'].includes(old.id)&&b.state==='done'){
    const required=old.id==='M12'?['M01','M02','M03','M04','M05','M06']:c.result.tasks.filter(t=>t.category!=='business'&&!['G19','G20','M13'].includes(t.id)).map(t=>t.id);
    if(c.result.tasks.some(t=>required.includes(t.id)&&t.state!=='done'))fail('Abhängige Aufgaben sind noch offen.',409);
   }
   const actionData=await executeTaskAction(req,principal,c,old,b);
   const t=validateTaskChange({...old,completedAt:completedAt(old,c)},b);
   if(taskSpec(t.id).kind==='training'&&['name','url','instructions'].some(k=>actionData[k]!==old.actionData?.[k]))delete t.employeeConfirmation;t.actionData=actionData;t.actionPublished=b.publish===true||b.state==='done'||!!old.actionPublished;
   if(taskSpec(t.id).kind==='training'&&t.actionPublished)t.resourceUrl=actionData.url||'';
   t.comments=[...(t.comments||[]),{by:principal.user.username,at:new Date().toISOString(),text:String(b.comment||'Status aktualisiert').slice(0,2000),state:t.state,stateChanged:old.state!==t.state}];
   if(b.resourceUrl){let u;try{u=new URL(b.resourceUrl);}catch{fail('Ungültiger Link.');}if(u.protocol!=='https:'&&!(u.protocol==='http:'&&u.hostname==='localhost'))fail('Nur HTTPS oder lokale Links erlaubt.');if(u.username||u.password)fail('Keine Zugangsdaten im Link.');t.resourceUrl=u.href;}
   if(b.resourceUrl==='')t.resourceUrl='';
   c.result.tasks[c.result.tasks.findIndex(x=>x.id===t.id)]=t;
   await save(c,principal.user.username,'task-update',{task:t.id,state:t.state,evidence:t.evidence,comment:String(b.comment||'').slice(0,2000),source:'workspace'});
   return json(res,200,{ok:true});
  }
  fail('Nicht gefunden.',404);
 }
 const linkCase=path.match(/^\/api\/cases\/([a-f0-9-]+)\/link$/);
 if(linkCase&&req.method==='POST'){
  const c=cases.get(linkCase[1]),b=await body(req);if(!c)fail('Fall nicht gefunden.',404);
  if(c.hrEmployeeId)fail('Fall ist bereits verknüpft.',409);
  if(!/^[a-f0-9-]{36}$/.test(b.employeeId||''))fail('Mitarbeiter auswählen.');
  const employee=(await hrRequest(req,'/hr/employees/'+b.employeeId)).data;
  if((employee.first_name+' '+employee.last_name).trim().toLocaleLowerCase('de')!==c.employee.fullName.trim().toLocaleLowerCase('de')||employee.department!==c.employee.department||String(employee.start_date).slice(0,10)!==String(c.employee.startDate).slice(0,10))fail('Name, Abteilung und Eintrittsdatum müssen mit dem HR-Datensatz übereinstimmen. Bitte zuerst die Stammdaten prüfen.',409);
  if([...cases.values()].some(x=>x.id!==c.id&&x.hrEmployeeId===employee.id&&!['error','rejected','needs_input'].includes(x.status)))fail('Für diesen Mitarbeiter gibt es bereits einen Fall.',409);
  c.hrEmployeeId=employee.id;c.employee.fullName=employee.first_name+' '+employee.last_name;c.employee.personalEmail=employee.personal_email;
  await save(c,principal.user.username,'employee-linked',{employeeId:employee.id});return json(res,200,{ok:true});
 }
 if(path==='/api/hr-departments'&&req.method==='GET')return json(res,200,await hrRequest(req,'/hr/departments'));
 if(path==='/api/hr-employees'&&req.method==='GET'){
  const data=[];let offset=0;
  while(true){const page=await hrRequest(req,`/hr/employees?limit=200&offset=${offset}`);data.push(...page.data);if(page.data.length<200)break;offset+=200;}
  return json(res,200,{data});
 }
 if(path==='/api/mine'&&req.method==='GET'){
  if(principal.user.role!=='employee'||!principal.user.employee_id)fail('Mitarbeiter-Anmeldung erforderlich.',403);
  return json(res,200,{csrf:principal.csrf_token,cases:[...cases.values()].filter(c=>c.hrEmployeeId===principal.user.employee_id&&c.status==='approved').map(publicCase)});
 }
 const confirmation=path.match(/^\/api\/mine\/([a-f0-9-]+)\/([GM][0-9]{2})$/);
 if(confirmation&&req.method==='POST'){
  const c=cases.get(confirmation[1]),recipient=c?.result?.tasks?.some(t=>t.id===confirmation[2]&&t.actionPublished&&t.actionData?.recipientId===principal.user.employee_id);if(principal.user.role!=='employee'||!c||(c.hrEmployeeId!==principal.user.employee_id&&!recipient)||c.status!=='approved')fail('Kein Zugriff.',403);
  if(!recipient&&!publicCase(c).tasks.some(t=>t.id===confirmation[2]))fail('Keine persönliche Aufgabe.',403);
  const t=c.result.tasks.find(t=>t.id===confirmation[2]),b=await body(req);
  t.employeeConfirmation={at:new Date().toISOString(),by:principal.user.id,comment:String(b.comment||'Zur Prüfung eingereicht.').slice(0,1000)};
  await save(c,principal.user.username,'employee-confirmation',{task:t.id});return json(res,200,{ok:true});
 }
 const action=path.match(/^\/api\/cases\/([a-f0-9-]+)\/(tasks|mail|history)(?:\/([GM][0-9]{2}))?$/);
 if(action){
  const c=cases.get(action[1]);if(!c)fail('Fall nicht gefunden.',404);
  if(action[2]==='history'&&req.method==='GET')return json(res,200,{events:(await pool.query('SELECT actor,kind,detail,created_at FROM coordinator_events WHERE case_id=$1 ORDER BY id DESC LIMIT 100',[c.id])).rows});
  if(action[2]==='mail'&&req.method==='GET')return json(res,200,{messages:await messages(c.id)});
  if(c.status!=='approved')fail('Zuerst muss HR den Plan freigeben.',409);
  if(action[2]==='tasks'&&req.method==='PATCH'){
   const b=await body(req),index=c.result.tasks.findIndex(t=>t.id===action[3]);if(index<0)fail('Aufgabe nicht gefunden.',404);
   if(['G19','M12'].includes(action[3])&&b.state==='done'){
    const required=action[3]==='M12'?['M01','M02','M03','M04','M05','M06']:c.result.tasks.filter(t=>t.category!=='business'&&!['G19','G20','M13'].includes(t.id)).map(t=>t.id);
    if(c.result.tasks.some(t=>required.includes(t.id)&&t.state!=='done'))fail('Abhängige Aufgaben sind noch offen. Erst tatsächliche Abschlüsse bestätigen.',409);
   }
   const old=c.result.tasks[index],actionData=await executeTaskAction(req,principal,c,old,b),t=validateTaskChange({...old,completedAt:completedAt(old,c)},b);if(taskSpec(t.id).kind==='training'&&['name','url','instructions'].some(k=>actionData[k]!==old.actionData?.[k]))delete t.employeeConfirmation;t.actionData=actionData;t.actionPublished=b.publish===true||b.state==='done'||!!old.actionPublished;
   t.comments=[...(t.comments||[]),{by:principal.user.username,at:new Date().toISOString(),text:String(b.comment||'Status aktualisiert').slice(0,2000),state:t.state,stateChanged:old.state!==t.state}];
   if(b.resourceUrl){const u=new URL(b.resourceUrl);if(u.protocol!=='https:'&&!(u.protocol==='http:'&&u.hostname==='localhost'))fail('Nur HTTPS oder lokale Links erlaubt.');t.resourceUrl=u.href;}
   c.result.tasks[index]=t;await save(c,principal.user.username,'task-update',{task:t.id,state:t.state,evidence:t.evidence,comment:String(b.comment||'').slice(0,2000)});return json(res,200,view(c));
  }
  if(action[2]==='mail'&&req.method==='POST'){
   const b=await body(req);if(!['welcome','admin'].includes(b.kind))fail('Ungültige Nachricht.');
   const mail=b.kind==='welcome'?{recipient:c.employee.personalEmail,subject:c.result.draft.subject,body:c.result.draft.body}:{recipient:process.env.SYSTEM_ADMIN_EMAIL,subject:'Onboarding: Systemzugänge vorbereiten – '+c.employee.fullName,body:`Mitarbeiter: ${c.employee.fullName}\nEintritt: ${c.employee.startDate}\nPosition: ${c.employee.role}\nAbteilung: ${c.employee.department}\nFührungskraft: ${c.employee.manager}\nFirmen-E-Mail (geplant): ${c.employee.companyEmail}\n\nBitte freigegebene Zugänge zum Mitarbeiterportal und rollenabhängig zu ERP/CRM einrichten. Einrichtung anschließend im Aufgabenplan bestätigen. Keine Slack- oder Notion-Konten.\nFall: ${c.id}`};
   if(!mail.recipient||/[\r\n]/.test(mail.recipient+mail.subject))fail('Ungültige Maildaten.');
   await save(c,principal.user.username,'mail-requested',{kind:b.kind},{...mail,id:randomUUID(),kind:b.kind});return json(res,202,{messages:await messages(c.id)});
  }
 }

 if(path==='/api/bootstrap'&&req.method==='GET')return json(res,200,{csrf:principal.csrf_token,user:principal.user,graph,catalog,modes,storage:'PostgreSQL · Fälle, Freigaben, Aufgaben und Nachrichten dauerhaft gespeichert.'});
 if(path==='/api/health'&&req.method==='GET'){let connected=false;try{const r=await fetch((process.env.N8N_MCP_URL||'http://localhost:5678/mcp-server/http').replace('/mcp-server/http','/healthz'),{signal:AbortSignal.timeout(2500)});connected=r.ok;}catch{}return json(res,200,{connected,workflows:config});}
 if(path==='/api/cases'&&req.method==='GET')return json(res,200,{cases:[...cases.values()].reverse().map(view)});
 if(path==='/api/cases'&&req.method==='POST'){
  if([...cases.values()].some(c=>['running','deciding'].includes(c.status)))fail('Es läuft bereits ein Onboarding. Bitte kurz warten.',409);

  const b=await body(req);const employee={};for(const k of ['fullName','personalEmail','companyEmail','department','role','manager','startDate']){if(b[k]!=null&&typeof b[k]!=='string')fail('Ungültiges Feld: '+k);employee[k]=(b[k]||'').slice(0,200);}employee.managerial=b.managerial===true;
  let hrEmployeeId=null;if(b.hrEmployeeId){if(!/^[a-f0-9-]{36}$/.test(b.hrEmployeeId))fail('Ungültige Mitarbeiter-ID.');const hr=(await hrRequest(req,'/hr/employees/'+b.hrEmployeeId)).data;hrEmployeeId=hr.id;employee.fullName=hr.first_name+' '+hr.last_name;employee.personalEmail=hr.personal_email;employee.department=hr.department;employee.role=hr.role;employee.startDate=hr.start_date;const existing=[...cases.values()].find(x=>x.hrEmployeeId===hrEmployeeId&&!['error','rejected','needs_input'].includes(x.status));if(existing){if(b.reuseExisting===true)return json(res,200,{id:existing.id,reused:true});fail('Für diesen Mitarbeiter besteht bereits ein Onboarding-Fall.',409);}}
  const c={id:randomUUID(),hrEmployeeId,employee,status:'running',createdAt:new Date().toISOString(),runs:[]};cases.set(c.id,c);await save(c,principal.user.username,'case-created');json(res,202,{id:c.id});void execute(c,'prepare');return;
 }
 const match=path.match(/^\/api\/cases\/([a-f0-9-]+)(?:\/(decision|download))?$/);
 if(match){const c=cases.get(match[1]);if(!c)fail('Fall nicht gefunden.',404);
  if(!match[2]&&req.method==='GET')return json(res,200,view(c));
  if(match[2]==='download'&&req.method==='GET'){res.setHeader('Content-Disposition',`attachment; filename="onboarding-${c.id.slice(0,8)}.json"`);return json(res,200,view(c));}
  if(match[2]==='decision'&&req.method==='POST'){
   if(c.status!=='pending_approval')fail('Dieser Fall wartet nicht auf eine HR-Entscheidung.',409);
   if([...cases.values()].some(x=>['running','deciding'].includes(x.status)))fail('Es läuft bereits eine Ausführung.',409);
   const b=await body(req);if(!['approve','reject'].includes(b.decision))fail('Ungültige Entscheidung.');
   const reviewer=principal.user.username,comment=String(b.comment||'').trim().slice(0,1000);
   if(!reviewer)fail('Bitte den Namen der prüfenden Person angeben.');if(b.decision==='reject'&&!comment)fail('Bitte eine Begründung für die Rückgabe angeben.');
   const draft={subject:String(b.draft?.subject||c.result.draft.subject).trim(),body:String(b.draft?.body||c.result.draft.body).trim()};if(draft.subject.length>200||draft.body.length>6000||draft.body.length<10)fail('Bitte einen gültigen Entwurf angeben.');
   c.decision={decision:b.decision,reviewer,comment,draft,decidedAt:new Date().toISOString()};c.status='deciding';await save(c,principal.user.username,'decision-requested',{decision:b.decision});json(res,202,{id:c.id});void execute(c,'decision');return;
  }
 }
 const files={'/':['index.html','text/html'],'/app.js':['app.js','text/javascript'],'/style.css':['style.css','text/css'],'/konzept':['konzept.html','text/html']};
 if(files[path]&&req.method==='GET'){const[f,type]=files[path];res.writeHead(200,{'Content-Type':type+'; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"});res.end(await fs.readFile(new URL('public/'+f,import.meta.url)));return;}
 fail('Nicht gefunden.',404);
 }catch(e){if(!res.headersSent)json(res,e.status||500,{error:e.status?e.message:'Lokaler Dienst konnte die Anfrage nicht verarbeiten.'});else res.end();if(!e.status)console.error(e);}});

server.listen(port,'0.0.0.0',()=>console.log(`Onboarding-Dashboard: http://localhost:${port}`));
