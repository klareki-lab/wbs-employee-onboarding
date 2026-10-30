import {projectSummaries} from './project-summary.mjs';
export const berlinDay=(d=new Date())=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);
export function crmReport(records,people,history=[],now=new Date()){
 const today=berlinDay(now),names=new Map(people.map(p=>[p.id,p.name]));
 const completed=new Map();
 for(const h of history){if(h.after_data?.data?.status==='done'&&h.before_data?.data?.status!=='done'&&Number.isFinite(Date.parse(h.created_at))){const prior=completed.get(h.record_id);if(!prior||new Date(h.created_at)>new Date(prior))completed.set(h.record_id,h.created_at);}}
 const projects=projectSummaries(records,people,now).map(p=>{
  const tasks=records.filter(r=>r.project_id===p.id&&['task','work_item'].includes(r.kind)).map(r=>{
   const d=r.data,done=d.status==='done',cancelled=d.status==='cancelled',due=d.ends_on||d.due_at||null;
   const dueDay=due?(due.length===10?due:berlinDay(new Date(due))):null;
   const at=done?(completed.get(r.id)||null):null;
   const timing=cancelled?'cancelled':done?(dueDay&&at?(berlinDay(new Date(at))<=dueDay?'on_time':'late'):'unknown'):(dueDay&&dueDay<today?'overdue':'pending');
   return{id:r.id,version:r.version,kind:r.kind,title:d.title,assignee_id:d.assignee_id||r.owner_id,assignee:names.get(d.assignee_id||r.owner_id)||'Nicht zugeordnet',status:d.status,progress:r.kind==='work_item'?Number(d.progress||0):done?100:0,planned_hours:d.planned_hours||null,starts_on:d.starts_on||null,due:dueDay,completed_at:at,timing,blocked_reason:d.blocked_reason||'',result:d.result||''};
  });
  const {work,entries,comments,...summary}=p;
  return{...summary,tasks,comments:comments.slice(0,12).map(c=>({id:c.id,text:c.data.text,by:names.get(c.owner_id)||'',at:c.created_at})),metrics:taskMetrics(tasks)};
 });
 const all=projects.flatMap(p=>p.tasks);
 return{source:'Train Today CRM',generated_at:now.toISOString(),today,projects,people:people.filter(p=>p.active).map(p=>({id:p.id,name:p.name,role:p.role})),metrics:taskMetrics(all),byAssignee:people.map(p=>({id:p.id,name:p.name,...taskMetrics(all.filter(t=>t.assignee_id===p.id))})),definition:'Fristgerecht = Abschlüsse am oder vor dem Fälligkeitstag / Abschlüsse mit Frist und dokumentiertem Abschluss. Europe/Berlin. Stornierte Aufgaben zählen nicht; fehlende Abschlussnachweise werden separat gezeigt. Keine automatische Leistungsbewertung.'};
}
export function taskMetrics(tasks){const active=tasks.filter(t=>t.status!=='cancelled'),done=active.filter(t=>t.status==='done').length,onTime=active.filter(t=>t.timing==='on_time').length,late=active.filter(t=>t.timing==='late').length;return{total:active.length,done,open:active.length-done,overdue:active.filter(t=>t.timing==='overdue').length,unknown:active.filter(t=>t.status==='done'&&t.timing==='unknown').length,onTime,late,completionPercent:active.length?Math.round(done/active.length*100):null,onTimePercent:onTime+late?Math.round(onTime/(onTime+late)*100):null};}
