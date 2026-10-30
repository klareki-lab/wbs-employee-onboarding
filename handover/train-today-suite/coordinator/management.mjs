export function berlinDay(date=new Date()){
 return new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(date));
}
const isoDay=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)?value:null;
export function completedAt(task,c){
 if(task.state!=='done')return null;
 if(task.completedAt&&!Number.isNaN(Date.parse(task.completedAt)))return task.completedAt;
 const history=task.comments||[];let start=0;
 for(let i=0;i<history.length;i++)if(history[i].state&&history[i].state!=='done')start=i+1;
 const entry=history.slice(start).find(e=>e.state==='done'&&e.stateChanged!==false&&e.at&&!Number.isNaN(Date.parse(e.at)));
 if(entry)return entry.at;
 if(task.id==='G01')return c.runs?.find(r=>r.kind==='prepare'&&r.status==='success')?.stoppedAt||null;
 return null;
}
export function measure(tasks){
 const n=key=>tasks.filter(t=>t.timing===key).length,done=tasks.filter(t=>t.state==='done').length;
 const onTime=n('on_time'),late=n('late'),unknown=n('unknown'),overdue=n('overdue');
 return {total:tasks.length,done,open:tasks.length-done,onTime,late,unknown,overdue,completionPercent:tasks.length?Math.round(done/tasks.length*100):null,onTimePercent:onTime+late?Math.round(onTime/(onTime+late)*100):null};
}
export function responsibleGroups(plans,roster){
 const area=name=>({HR:'Personal',Personal:'Personal',IT:'IT','IT-Service':'IT','Head of Marketing':'Marketing','Product Manager':'Operations',Sales:'Vertrieb'}[name]||name||'Weitere Zuständigkeiten');
 const norm=s=>String(s||'').trim().toLocaleLowerCase('de');
 const groups=new Map();
 const group=name=>{if(!groups.has(name))groups.set(name,{name,people:new Map(),tasks:[],unassigned:[],automatic:[]});return groups.get(name);};
 for(const e of roster)group(area(e.department)).people.set(e.id,{id:e.id,name:e.first_name+' '+e.last_name,role:e.role,tasks:[]});
 for(const p of plans.filter(p=>p.published))for(const task of p.tasks){
  const t={...task,caseId:p.id,employeeName:p.name},g=group(area(t.owner));g.tasks.push(t);
  if(t.id==='G01'){g.automatic.push(t);continue;}
  const matches=roster.filter(e=>norm(e.first_name+' '+e.last_name)===norm(t.assignee)||e.id===t.assignee);
  if(matches.length!==1){g.unassigned.push(t);continue;}
  const e=matches[0];if(!g.people.has(e.id))g.people.set(e.id,{id:e.id,name:e.first_name+' '+e.last_name,role:e.role,tasks:[]});g.people.get(e.id).tasks.push(t);
 }
 return [...groups.values()].map(g=>({name:g.name,metrics:measure(g.tasks),people:[...g.people.values()].map(p=>({...p,metrics:measure(p.tasks)})).sort((a,b)=>a.name.localeCompare(b.name,'de')),unassigned:{tasks:g.unassigned,metrics:measure(g.unassigned)},automatic:{tasks:g.automatic,metrics:measure(g.automatic)}})).sort((a,b)=>b.metrics.total-a.metrics.total||a.name.localeCompare(b.name,'de'));
}
export function managementReport(cases,roster=[],now=new Date()){
 const today=berlinDay(now),soon=berlinDay(new Date(new Date(now).getTime()+7*86400000));
 const plans=[...cases].map(c=>{
  const tasks=(c.result?.tasks||[]).map(t=>{
   const due=isoDay(t.due),end=completedAt(t,c),state=t.state||'open';
   const timing=state==='done'?(end&&due?(berlinDay(end)<=due?'on_time':'late'):'unknown'):(due&&due<today?'overdue':'pending');
   return {id:t.id,title:t.title,owner:t.owner,assignee:t.assignee||t.owner,due,state,completedAt:end,timing,category:t.category,deadlineAssumption:!!t.deadlineAssumption};
  });
  const published=c.status==='approved',start=isoDay(c.employee.startDate),beforeStart=tasks.filter(t=>t.category!=='business'&&t.state!=='done'&&t.due&&start&&t.due<=start);
  return {id:c.id,employeeId:c.hrEmployeeId,name:c.employee.fullName,department:c.employee.department,role:c.employee.role,startDate:start,status:c.status,published,tasks,metrics:measure(published?tasks:[]),preStartOpen:beforeStart.length,atRisk:c.kind!=='work'&&!!(start&&start<=soon&&(!published||beforeStart.length))};
 });
 const published=plans.filter(p=>p.published),all=published.flatMap(p=>p.tasks),owners=new Map();
 for(const t of all){const list=owners.get(t.assignee)||[];list.push(t);owners.set(t.assignee,list);}
 const linked=new Set(plans.map(p=>p.employeeId).filter(Boolean));
 return {today,soon,metrics:measure(all),plans,responsibleGroups:responsibleGroups(plans,roster),byAssignee:[...owners].map(([name,tasks])=>({name,...measure(tasks)})),unplanned:roster.filter(e=>!linked.has(e.id)).map(e=>({id:e.id,name:e.first_name+' '+e.last_name,department:e.department,startDate:e.start_date})),definition:'Pünktlichkeitsquote = fristgerechte Abschlüsse / Abschlüsse mit belegtem Abschlussdatum und Frist. Offene Aufgaben und unbekannte Abschlussdaten werden separat ausgewiesen. Maßgeblich ist der Kalendertag in Europe/Berlin.'};
}
