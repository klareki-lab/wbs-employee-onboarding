import {fail,manager,record,add,put,audit,uuid} from './db.mjs';
import {projectSummaries} from './project-summary.mjs';
export const deliveryFields=['delivery_status','delivery_start','delivery_end','delivery_goal'];
const leader=u=>['manager','admin'].includes(u.role);
const ownsPlan=(u,p)=>leader(u)||p.owner_id===u.id;
const dateOnly=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
const text=(v,max=300)=>typeof v==='string'&&v.trim()&&v.length<=max;
function keys(data,allowed){if(!data||typeof data!=='object'||Array.isArray(data)||Object.keys(data).some(k=>!allowed.includes(k)))fail('Unbekannte oder fehlende Projektangaben.');}
function version(r,v){if(v!==r.version)fail('Zwischenzeitlich geändert. Bitte aktualisieren.',409);}
async function project(c,id){const p=await record(c,id,'project');if(p.data.merged_into)fail('Bitte das zusammengeführte Hauptprojekt verwenden.');return p;}
async function member(c,p,id){if(!uuid.test(id||'')||!(await c.query('SELECT 1 FROM crm.users u WHERE u.id=$2 AND u.active AND (EXISTS(SELECT 1 FROM crm.members m WHERE m.project_id=$1 AND m.user_id=$2) OR EXISTS(SELECT 1 FROM crm.records p WHERE p.id=$1 AND p.owner_id=$2))',[p.id,id])).rowCount)fail('Zuständige Person muss aktiv und am Projekt beteiligt sein.');}
export function validateDelivery(d){
 if(d.delivery_status&&!['not_planned','planned','active','on_hold','completed','cancelled'].includes(d.delivery_status))fail('Projektstatus prüfen.');
 for(const k of ['delivery_start','delivery_end'])if(d[k]&&!dateOnly(d[k]))fail('Gültiges Planungsdatum erforderlich.');
 if(d.delivery_start&&d.delivery_end&&d.delivery_end<d.delivery_start)fail('Projektende liegt vor dem Projektbeginn.');
 if(d.delivery_goal!==undefined&&(typeof d.delivery_goal!=='string'||d.delivery_goal.length>4000))fail('Projektziel ist zu lang.');
}
async function workRef(c,p,id){if(!id)return null;const w=await record(c,id,'work_item');if(w.project_id!==p.id)fail('Arbeitspaket gehört zu einem anderen Projekt.');return w;}
async function noOverlap(c,user,start,end,except=null){const result=await c.query("SELECT id FROM crm.records WHERE kind='time_entry' AND owner_id=$1 AND ($4::uuid IS NULL OR id<>$4) AND data->>'status'<>'void' AND (data->>'started_at')::timestamptz<$3::timestamptz AND coalesce(nullif(data->>'ended_at','')::timestamptz,'infinity'::timestamptz)>$2::timestamptz",[user,start,end,except]);if(result.rowCount)fail('Diese Zeit überschneidet sich mit einer vorhandenen Buchung oder laufenden Stoppuhr.',409);}
function timeData(d){
 keys(d,['description','work_item_id','started_at','ended_at','break_minutes','billable']);
 if(!text(d.description,2000))fail('Bitte eine Tätigkeitsbeschreibung eingeben.');
 if(typeof d.started_at!=='string'||typeof d.ended_at!=='string'||!Number.isFinite(Date.parse(d.started_at))||!Number.isFinite(Date.parse(d.ended_at)))fail('Beginn und Ende erforderlich.');
 const start=new Date(d.started_at),end=new Date(d.ended_at),elapsed=(end-start)/60000,pause=Number(d.break_minutes??0);
 if(elapsed<=0||elapsed>1440||end>new Date(Date.now()+60000)||!Number.isInteger(pause)||pause<0||pause>=elapsed)fail('Zeitspanne, Pause oder zukünftigen Zeitpunkt prüfen (höchstens 24 Stunden).');
 if(typeof d.billable!=='boolean')fail('Abrechenbar bitte mit Ja oder Nein angeben.');
 return{description:d.description.trim(),work_item_id:d.work_item_id||null,started_at:start.toISOString(),ended_at:end.toISOString(),break_minutes:pause,minutes:Math.max(1,Math.ceil(elapsed-pause)),billable:d.billable,status:'draft'};
}
export async function projectCommand(c,u,b){
 if(!['project_plan','work_save','project_comment','time_save','time_submit','time_withdraw','time_decide','time_void','timer_start','timer_stop'].includes(b.action))return null;
 // Per-person serialization also catches concurrent overlapping entries and double timer starts.
 if(b.action.startsWith('time')||b.action.startsWith('timer'))await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,81))',[u.id]);
 if(b.action==='project_plan'){
  const p=await project(c,b.project_id);if(!ownsPlan(u,p))fail('Projektplanung ist Sache der Projektverantwortlichen oder Leitung.',403);version(p,b.version);keys(b.data,deliveryFields);const d={...p.data,...b.data};validateDelivery(d);
  if(d.delivery_status==='completed'&&(!(await c.query("SELECT 1 FROM crm.records WHERE kind='work_item' AND project_id=$1 AND data->>'status'<>'cancelled'",[p.id])).rowCount||(await c.query("SELECT 1 FROM crm.records WHERE kind='work_item' AND project_id=$1 AND data->>'status' NOT IN ('done','cancelled')",[p.id])).rowCount))fail('Zum Abschluss müssen alle Arbeitspakete erledigt sein.');
  const next=await put(c,p,d);await audit(c,u,'project_plan',p.id,p,next,b.reason||'Projektplanung aktualisiert.');return{record:next};
 }
 if(b.action==='work_save'){
  const p=await project(c,b.project_id),old=b.id?await workRef(c,p,b.id):null;if(old)version(old,b.version);
  if(['completed','cancelled'].includes(p.data.delivery_status))fail('Projekt für Änderungen zuerst wieder öffnen.');
  const planner=ownsPlan(u,p);if(!planner&&(!old||old.data.assignee_id!==u.id))fail('Nur Zuständige dürfen den Fortschritt ihres Arbeitspakets ändern.',403);
  keys(b.data,['title','description','planned_hours','assignee_id','starts_on','ends_on','progress','status','blocked_reason','predecessor_id']);
  if(!planner&&Object.keys(b.data).some(k=>!['progress','status','blocked_reason'].includes(k)))fail('Planungsangaben nur durch Projektverantwortliche ändern.',403);
  const d={...(old?.data||{}),...b.data};if(!text(d.title)||typeof(d.description||'')!=='string'||(d.description||'').length>4000)fail('Titel und Beschreibung prüfen.');
  d.planned_hours=Number(d.planned_hours);d.progress=Number(d.progress??0);d.status=d.status||'planned';
  if(!Number.isFinite(d.planned_hours)||d.planned_hours<0.25||d.planned_hours>5000||!Number.isFinite(d.progress)||d.progress<0||d.progress>100)fail('Planstunden (0,25–5.000) und Fortschritt (0–100 %) prüfen.');
  if(!['planned','in_progress','blocked','done','cancelled'].includes(d.status))fail('Unbekannter Arbeitspaketstatus.');
  if(d.status==='done')d.progress=100;if(['planned','cancelled'].includes(d.status))d.progress=0;
  if(d.status==='in_progress'&&(d.progress<=0||d.progress>=100))fail('Laufende Arbeitspakete benötigen einen Fortschritt zwischen 0 und 100 %.');
  if(d.status==='blocked'&&(!text(d.blocked_reason,2000)||d.progress>=100))fail('Blockierung bitte begründen; erledigte Arbeitspakete sind nicht blockiert.');
  if(d.status!=='blocked')d.blocked_reason='';
  if(!dateOnly(d.starts_on)||!dateOnly(d.ends_on)||d.ends_on<d.starts_on)fail('Beginn und Ende des Arbeitspakets prüfen.');
  await member(c,p,d.assignee_id);
  if(d.predecessor_id){await workRef(c,p,d.predecessor_id);const rows=(await c.query("SELECT id,data FROM crm.records WHERE kind='work_item' AND project_id=$1",[p.id])).rows;const map=new Map(rows.map(w=>[w.id,w.data.predecessor_id]));const seen=new Set(old?[old.id]:[]);let next=d.predecessor_id;while(next){if(seen.has(next))fail('Abhängigkeit würde einen Kreis bilden.');seen.add(next);next=map.get(next);}}
  else d.predecessor_id=null;
  const r=old?await put(c,old,d):await add(c,u,'work_item',d,p.id);await audit(c,u,old?'work_updated':'work_created',r.id,old,r,b.reason||'Arbeitspaket dokumentiert.');return{record:r};
 }
 if(b.action==='project_comment'){
  const p=await project(c,b.project_id);keys(b.data,['text','work_item_id']);if(!text(b.data.text,4000))fail('Kommentar fehlt oder ist zu lang.');await workRef(c,p,b.data.work_item_id);
  const r=await add(c,u,'project_comment',{text:b.data.text.trim(),work_item_id:b.data.work_item_id||null},p.id);await audit(c,u,'project_comment',r.id,null,r);return{record:r};
 }
 if(b.action==='time_save'){
  const p=await project(c,b.project_id),old=b.id?await record(c,b.id,'time_entry'):null;
  if(old){if(old.project_id!==p.id||old.owner_id!==u.id)fail('Nur eigene Zeiten dürfen bearbeitet werden.',403);version(old,b.version);if(!['draft','rejected'].includes(old.data.status))fail('Eingereichte oder freigegebene Zeiten können nicht bearbeitet werden.',409);if(!text(b.reason,2000))fail('Korrektur bitte begründen.');}
  const d=timeData(b.data);await member(c,p,u.id);await workRef(c,p,d.work_item_id);await noOverlap(c,u.id,d.started_at,d.ended_at,old?.id);
  const r=old?await put(c,old,d):await add(c,u,'time_entry',d,p.id);await audit(c,u,old?'time_corrected':'time_recorded',r.id,old,r,b.reason||'Arbeitszeit erfasst.');return{record:r};
 }
 if(b.action==='timer_start'){
  const p=await project(c,b.project_id);keys(b.data,['description','work_item_id','billable']);if(!text(b.data.description,2000)||typeof b.data.billable!=='boolean')fail('Tätigkeit und Abrechenbarkeit erforderlich.');await member(c,p,u.id);await workRef(c,p,b.data.work_item_id);
  const start=new Date().toISOString();await noOverlap(c,u.id,start,'infinity');
  const r=await add(c,u,'time_entry',{description:b.data.description.trim(),work_item_id:b.data.work_item_id||null,started_at:start,ended_at:null,break_minutes:0,minutes:0,billable:b.data.billable,status:'running'},p.id);await audit(c,u,'timer_started',r.id,null,r);return{record:r};
 }
 if(!uuid.test(b.id||''))fail('Zeitbuchung fehlt.');const pointer=(await c.query("SELECT project_id FROM crm.records WHERE id=$1 AND kind='time_entry'",[b.id])).rows[0];if(!pointer)fail('Zeitbuchung nicht gefunden.',404);await project(c,pointer.project_id);const r=await record(c,b.id,'time_entry');version(r,b.version);
 if(b.action==='time_decide'){
  manager(u);if(r.owner_id===u.id)fail('Eigene Zeiten benötigen die Freigabe einer anderen Leitungsperson.',403);if(r.data.status!=='submitted')fail('Nur eingereichte Zeiten können entschieden werden.',409);if(typeof b.approve!=='boolean'||!text(b.reason,2000))fail('Entscheidung und Begründung erforderlich.');
  const next=await put(c,r,{...r.data,status:b.approve?'approved':'rejected',decision_by:u.id,decision_at:new Date().toISOString(),decision_reason:b.reason.trim()});await audit(c,u,'time_decided',r.id,r,next,b.reason);return{record:next};
 }
 if(r.owner_id!==u.id)fail('Nur eigene Zeiten können geändert werden.',403);
 let d={...r.data};
 if(b.action==='timer_stop'){
  if(d.status!=='running')fail('Diese Stoppuhr läuft nicht mehr.',409);
  d=timeData({description:d.description,work_item_id:d.work_item_id,started_at:d.started_at,ended_at:b.ended_at||new Date().toISOString(),break_minutes:b.break_minutes??0,billable:d.billable});await noOverlap(c,u.id,d.started_at,d.ended_at,r.id);
 }else if(b.action==='time_submit'){if(!['draft','rejected'].includes(d.status))fail('Nur offene Zeiten können eingereicht werden.',409);d.status='submitted';d.submitted_at=new Date().toISOString();delete d.decision_by;delete d.decision_at;delete d.decision_reason;}
 else if(b.action==='time_withdraw'){if(d.status!=='submitted')fail('Nur eingereichte Zeiten können zurückgenommen werden.',409);d.status='draft';}
 else if(b.action==='time_void'){if(!['running','draft','rejected'].includes(d.status)||!text(b.reason,2000))fail('Nur eigene offene Buchungen mit Begründung stornieren.');d.status='void';d.void_reason=b.reason.trim();}
 const next=await put(c,r,d);await audit(c,u,b.action,r.id,r,next,b.reason||'Zeitstatus geändert.');return{record:next};
}
export async function projectApi(c,u,resource){
 if(resource!=='project-overview')return null;
 const records=(await c.query('SELECT * FROM crm.records ORDER BY created_at DESC')).rows,people=(await c.query('SELECT id,name FROM crm.users')).rows;
 return{api_version:'1',projects:projectSummaries(records,people),generated_at:new Date().toISOString()};
}
