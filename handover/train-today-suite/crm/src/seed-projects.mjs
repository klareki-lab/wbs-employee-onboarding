import fs from 'node:fs';import {createHash} from 'node:crypto';import {pool,transaction} from './db.mjs';import {command,snapshot} from './domain.mjs';import {projectSummaries} from './project-summary.mjs';
const url=new URL(process.env.DATABASE_URL);if(url.hostname!=='db'||!['/crm','/crm_regression_20261025'].includes(url.pathname))throw Error('Nur für die lokale CRM-Datenbank.');
const seed='project-delivery-v1',uid=key=>{const h=createHash('sha256').update(seed+':'+key).digest('hex');return h.slice(0,8)+'-'+h.slice(8,12)+'-4'+h.slice(13,16)+'-a'+h.slice(17,20)+'-'+h.slice(20,32);};
const users=(await pool.query('SELECT id,name,login,role FROM crm.users WHERE active')).rows,manager=users.find(u=>u.login==='leitung'),allUsers=new Map(users.map(u=>[u.id,u]));
const fetchRecord=id=>transaction(manager,async c=>(await c.query('SELECT * FROM crm.records WHERE id=$1',[id])).rows[0]);
async function op(key,u,body){const request_id=uid(key),prior=(await pool.query('SELECT result FROM crm.requests WHERE user_id=$1 AND request_id=$2',[u.id,request_id])).rows[0];return prior?.result||command(u,{request_id,...body});}
let report;
try{
 const complete=(await pool.query('SELECT result FROM crm.requests WHERE user_id=$1 AND request_id=$2',[manager.id,uid('complete')])).rows[0];
 if(complete){console.log('Projektpläne bereits eingerichtet; spätere Bearbeitungen bleiben erhalten.');}
 else{
 const initial=await snapshot(manager),cases=[['H-01','completed',-65,-35],['H-02','active',-35,30],['H-04','completed',-50,-15],['H-05','planned',8,60],['H-06','completed',-45,-20],['H-07','active',-24,12],['H-09','active',-18,25],['H-12','active',-12,32],['UC-01','active',-14,45],['UC-04','planned',10,50],['UC-06','active',-28,55],['UC-11','planned',5,30],['UC-18','active',-15,20],['UC-21','planned',14,75],['UC-23','active',-22,40],['UC-26','on_hold',-30,20],['UC-28','active',-18,40],['UC-29','active',-35,65],['UC-32','on_hold',-25,15],['UC-35','active',-35,-2],['UC-39','planned',20,80]];
 const find=key=>initial.records.find(r=>r.kind==='project'&&String(r.data.tags||'').split(',').map(s=>s.trim()).includes(key));
 if(cases.some(([key])=>!find(key)))throw Error('Zuerst den Kundenbestand mit Testdaten-laden.ps1 einrichten.');
 const marker=(await op('start',manager,{action:'project_comment',project_id:find('H-01').id,data:{text:'Projektplanung und Leistungsnachweise aus den vorliegenden Kundenakten übernommen. Rückfragen und weitere Entscheidungen bitte im jeweiligen Projekt ergänzen.'}})).record;
 const base=new Date(new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(marker.created_at))+'T12:00:00Z'),day=offset=>{const d=new Date(base);d.setUTCDate(d.getUTCDate()+offset);return d.toISOString().slice(0,10);};
 const used=new Map();for(const t of initial.records.filter(r=>r.kind==='time_entry'&&r.data.status!=='void')){if(!used.has(t.owner_id))used.set(t.owner_id,[]);used.get(t.owner_id).push([Date.parse(t.data.started_at),Date.parse(t.data.ended_at||new Date().toISOString())]);}
 const bookSlot=(id,from,to,minutes)=>{const occupied=used.get(id)||[];for(let offset=from;offset<=Math.min(to,-1);offset++){const d=new Date(day(offset)+'T08:00:00Z');if([0,6].includes(d.getUTCDay()))continue;for(const hour of [8,13]){d.setUTCHours(hour,0,0,0);const start=d.getTime(),end=start+minutes*60000;if(!occupied.some(([a,b])=>a<end&&b>start)){occupied.push([start,end]);used.set(id,occupied);return{started_at:new Date(start).toISOString(),ended_at:new Date(end).toISOString()};}}}return null;};
 let timeNumber=0;const created=[];
 for(const [index,[key,status,start,end]]of cases.entries()){
  let p=await fetchRecord(find(key).id);const already=(await pool.query('SELECT 1 FROM crm.requests WHERE user_id=$1 AND request_id=$2',[p.owner_id,uid('plan-'+key)])).rowCount;
  if(p.data.delivery_status&&!already){console.log('Vorhandene Planung beibehalten: '+p.data.title);continue;}
  const owner=allUsers.get(p.owner_id);if(!owner||owner.role!=='advisor')throw Error('Projektverantwortliche nicht verfügbar: '+key);
  const contributors=initial.members.filter(m=>m.project_id===p.id&&m.user_id!==p.owner_id).map(m=>allUsers.get(m.user_id)).filter(u=>u?.role==='advisor'),other=contributors[0]||owner;
  p=(await op('plan-'+key,owner,{action:'project_plan',project_id:p.id,version:p.version,data:{delivery_status:status==='completed'?'active':status,delivery_start:day(start),delivery_end:day(end),delivery_goal:'Gemeinsam mit '+initial.records.find(c=>c.id===p.data.company_id)?.data.name+' das Programm „'+p.data.title+'“ umsetzen: Bedarf und Erfolgskriterien abstimmen, Durchführung vorbereiten und den Transfer in den Arbeitsalltag begleiten.'}})).record;
  const titles=['Bedarf & Auftakt','Konzeption & Vorbereitung','Durchführung & Begleitung','Auswertung & Transfer'];const descriptions=['Ansprechpartner, Teilnehmerkreis und Erfolgskriterien abstimmen.','Ablauf, Praxisfälle, Materialien und Trainerbriefing vorbereiten.','Workshops durchführen, Rückfragen klären und Ergebnisse dokumentieren.','Rückmeldungen auswerten und nächste Anwendungsschritte vereinbaren.'];
  const work=[];
  for(let j=0;j<4;j++){
   const from=Math.round(start+(end-start)*j/4),to=j===3?end:Math.round(start+(end-start)*(j+1)/4)-1;
   let progress=status==='completed'?100:status==='planned'?0:to<0?100:from<0?Math.max(10,Math.min(85,Math.round(-from/Math.max(1,to-from)*80/5)*5)):0;
   let state=progress===100?'done':progress===0?'planned':'in_progress',blocked='';
   if(status==='on_hold'){progress=[100,40,0,0][j];state=['done','blocked','planned','planned'][j];if(j===1)blocked=key==='UC-32'?'Freigabe der Untertitel und des englischen Moderationskonzepts steht aus.':'Bestellende Gesellschaft und Umfang der Analyse sind noch zu bestätigen.';}
   if(key==='UC-35'&&j===3){progress=50;state='blocked';blocked='Feedback der Bereichsleitung fehlt; Abschlussgespräch neu terminieren.';}
   const person=j%2?other:owner,planned=key==='UC-35'?1:[4+index%3*2,12+index%4*2,24+index%3*8,4+index%3*2][j];
   const w=(await op('work-'+key+'-'+j,owner,{action:'work_save',project_id:p.id,data:{title:titles[j],description:descriptions[j],planned_hours:planned,assignee_id:person.id,starts_on:day(from),ends_on:day(to),progress,status:state,blocked_reason:blocked,predecessor_id:work[j-1]?.id||null}})).record;work.push(w);
   if(progress>0){const target=Math.round((key==='UC-35'?2:planned*progress/100*(.85+(index%3)*.15))*60/15)*15;let left=Math.max(30,target),part=0;
    while(left>0){const minutes=Math.min(240,left),cached=(await pool.query('SELECT result FROM crm.requests WHERE user_id=$1 AND request_id=$2',[person.id,uid('time-'+key+'-'+j+'-'+part)])).rows[0]?.result.record;const slot=cached?{started_at:cached.data.started_at,ended_at:cached.data.ended_at}:bookSlot(person.id,from,Math.min(to,-1),minutes);if(!slot)break;
     let t=(await op('time-'+key+'-'+j+'-'+part,person,{action:'time_save',project_id:p.id,data:{description:[titles[j]+' mit dem Kunden abgestimmt',descriptions[j]][part%2],work_item_id:w.id,...slot,break_minutes:0,billable:j!==0}})).record;
     const step=timeNumber++;
     if(status==='completed'||step%4!==0){t=(await op('submit-'+key+'-'+j+'-'+part,person,{action:'time_submit',id:t.id,version:t.version})).record;
      if(status==='completed'||step%4===1)t=(await op('approve-'+key+'-'+j+'-'+part,manager,{action:'time_decide',id:t.id,version:t.version,approve:true,reason:'Tätigkeit, Zeitraum und Projektzuordnung geprüft.'})).record;
      else if(step%11===0)await op('reject-'+key+'-'+j+'-'+part,manager,{action:'time_decide',id:t.id,version:t.version,approve:false,reason:'Bitte Vorbereitungszeit und Kundentermin getrennt beschreiben.'});
     }
     left-=minutes;part++;
    }
   }
  }
  if(status==='completed'){const current=await fetchRecord(p.id);await op('complete-project-'+key,owner,{action:'project_plan',project_id:p.id,version:current.version,data:{delivery_status:'completed'}});}
  await op('comment-'+key+'-1',owner,{action:'project_comment',project_id:p.id,data:{text:status==='completed'?'Durchführung abgeschlossen. Rückmeldungen und Leistungsnachweise liegen vor; offene Servicepunkte werden separat nachgehalten.':status==='planned'?'Nächster Schritt: Auftakt und Teilnehmerkreis bestätigen. Der Stundenansatz dient als Grundlage für die Einsatzplanung.':'Der aktuelle Stand ist in den Arbeitspaketen gepflegt. Bitte Abweichungen bei Terminen und Aufwand frühzeitig im Projekt kommentieren.',work_item_id:work[0].id}});
  await op('comment-'+key+'-2',other,{action:'project_comment',project_id:p.id,data:{text:status==='on_hold'?'Die offene Freigabe verhindert die weitere Vorbereitung. Rückmeldung angefragt; nächster Abgleich im Wochenmeeting.':key==='UC-35'?'Der Abstimmungsbedarf war höher als geplant. Die zusätzlichen Stunden sind erfasst; den Restumfang bitte gemeinsam priorisieren.':'Materialien und Praxisbeispiele abgestimmt. Für weitere Änderungen bitte den konkreten Umfang nennen, damit wir den Aufwand aktualisieren können.',work_item_id:work[1].id}});created.push({key,project_id:p.id});
 }
 await op('complete',manager,{action:'project_comment',project_id:find('H-01').id,data:{text:'Projektübersichten, Verantwortlichkeiten und zugehörige Zeitnachweise sind für die weitere Bearbeitung verfügbar.'}});
 console.log(created.length+' Kundenprojekte mit Arbeitspaketen und Leistungsnachweisen eingerichtet.');
 }
 const state=await snapshot(manager),summary=projectSummaries(state.records,state.people);report={at:new Date().toISOString(),projects:summary.filter(p=>p.work_count).length,work_items:state.records.filter(r=>r.kind==='work_item').length,time_entries:state.records.filter(r=>r.kind==='time_entry').length,comments:state.records.filter(r=>r.kind==='project_comment').length,planned_hours:summary.reduce((s,p)=>s+p.planned_hours,0),recorded_hours:summary.reduce((s,p)=>s+p.actual_minutes,0)/60,pending:state.records.filter(r=>r.kind==='time_entry'&&r.data.status==='submitted').length,over_budget:summary.filter(p=>p.over_budget).length,blocked:summary.filter(p=>p.blocked_items).length};fs.writeFileSync('/tmp/crm-project-data-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await pool.end();}
