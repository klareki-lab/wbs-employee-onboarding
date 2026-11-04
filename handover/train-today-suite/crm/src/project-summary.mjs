export function projectSummaries(records,people=[],now=new Date()){
 const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
 const names=new Map(people.map(p=>[p.id,p.name])),all=new Map(records.map(r=>[r.id,r]));
 return records.filter(r=>r.kind==='project'&&!r.data.merged_into).map(p=>{
  const work=records.filter(r=>r.kind==='work_item'&&r.project_id===p.id).sort((a,b)=>String(a.data.starts_on).localeCompare(String(b.data.starts_on))||new Date(a.created_at)-new Date(b.created_at)),active=work.filter(w=>w.data.status!=='cancelled');
  const entries=records.filter(r=>r.kind==='time_entry'&&r.project_id===p.id),booked=entries.filter(t=>!['running','void'].includes(t.data.status));
  const comments=records.filter(r=>r.kind==='project_comment'&&r.project_id===p.id).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
  const planned=active.reduce((s,w)=>s+Number(w.data.planned_hours),0),earned=active.reduce((s,w)=>s+Number(w.data.planned_hours)*Number(w.data.progress)/100,0);
  const minutes=booked.reduce((s,t)=>s+Number(t.data.minutes||0),0),progress=planned>0?Math.round(earned/planned*1000)/10:null;
  const users=[...new Set([...active.map(w=>w.data.assignee_id),...booked.map(t=>t.owner_id)])];
  const team=users.map(id=>{const mine=active.filter(w=>w.data.assignee_id===id),plan=mine.reduce((s,w)=>s+Number(w.data.planned_hours),0),done=mine.reduce((s,w)=>s+Number(w.data.planned_hours)*Number(w.data.progress)/100,0),spent=booked.filter(t=>t.owner_id===id).reduce((s,t)=>s+Number(t.data.minutes||0),0);return{user_id:id,name:names.get(id)||'Nicht zugeordnet',planned_hours:plan,progress:plan?Math.round(done/plan*1000)/10:null,minutes:spent,hours_share:minutes?Math.round(spent/minutes*1000)/10:0};});
  const starts=active.map(w=>w.data.starts_on).filter(Boolean).sort(),ends=active.map(w=>w.data.ends_on).filter(Boolean).sort();
  const start=p.data.delivery_start||starts[0]||'',end=p.data.delivery_end||ends.at(-1)||'';
  const late=active.filter(w=>w.data.status!=='done'&&w.data.ends_on&&w.data.ends_on<day).length;
  const blocked=active.filter(w=>w.data.status==='blocked'||w.data.predecessor_id&&w.data.starts_on<=day&&all.get(w.data.predecessor_id)?.data.status!=='done'&&w.data.progress===0).length;
  return{id:p.id,company_id:p.data.company_id,company:all.get(p.data.company_id)?.data.name||'Unternehmen offen',title:p.data.title,owner_id:p.owner_id,owner:names.get(p.owner_id)||'',sales_stage:p.data.stage,status:p.data.delivery_status||'not_planned',starts_on:start,ends_on:end,progress,planned_hours:planned,earned_hours:earned,remaining_hours:Math.max(0,planned-earned),actual_minutes:minutes,approved_minutes:booked.filter(t=>t.data.status==='approved').reduce((s,t)=>s+t.data.minutes,0),billable_minutes:booked.filter(t=>t.data.billable).reduce((s,t)=>s+t.data.minutes,0),pending_minutes:booked.filter(t=>t.data.status==='submitted').reduce((s,t)=>s+t.data.minutes,0),over_budget:planned>0&&minutes>planned*60,overdue:late>0||!!end&&end<day&&progress!==100&&!['completed','cancelled','not_planned'].includes(p.data.delivery_status||'not_planned'),late_items:late,blocked_items:blocked,work_count:active.length,work,entries,comments,team};
 });
}
