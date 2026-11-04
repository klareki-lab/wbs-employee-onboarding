import fs from 'node:fs';
import pg from 'pg';
import {createHash} from 'node:crypto';
import {pool} from './db.mjs';
import {command} from './domain.mjs';
import {cases,duplicates,companyProfiles,historical,ticketers} from './leadership-demo-data.mjs';

// Explicit local fixture loader. Credentials arrive via stdin, never command arguments or reports.
const config=Object.fromEntries(fs.readFileSync(0,'utf8').split(/\r?\n/).filter(x=>x.includes('=')).map(x=>[x.slice(0,x.indexOf('=')),x.slice(x.indexOf('=')+1)]));
const dbUrl=new URL(process.env.DATABASE_URL||'');
if(dbUrl.hostname!=='db'||dbUrl.pathname!=='/crm'||!config.DB_OWNER_PASSWORD)throw Error('Run only inside the local CRM Docker app, with local configuration on stdin.');
dbUrl.username='crm_owner';dbUrl.password=config.DB_OWNER_PASSWORD;
const owner=new pg.Client({connectionString:dbUrl.href});await owner.connect();
const dataset='leadership-demo-v1',source=JSON.parse(fs.readFileSync(new URL('demo-conversations.json',import.meta.url)));
let summary;
const reportPath='/tmp/crm-leadership-demo-report.json';
try{
 await owner.query("SELECT pg_advisory_lock(hashtextextended('leadership-demo-v1',57))");
 await owner.query(`CREATE SCHEMA IF NOT EXISTS crm_demo;
 CREATE TABLE IF NOT EXISTS crm_demo.fixture_runs(key text PRIMARY KEY,base_day date NOT NULL,started_at timestamptz NOT NULL DEFAULT now(),completed_at timestamptz,summary jsonb,before_records jsonb);
 CREATE TABLE IF NOT EXISTS crm_demo.fixture_steps(dataset text NOT NULL,key text NOT NULL,result jsonb NOT NULL,PRIMARY KEY(dataset,key));
 REVOKE ALL ON SCHEMA crm_demo FROM PUBLIC;`);
 const baseline=(await owner.query('SELECT * FROM crm.records ORDER BY id')).rows;
 await owner.query("INSERT INTO crm_demo.fixture_runs(key,base_day,before_records) VALUES($1,(now() AT TIME ZONE 'Europe/Berlin')::date,$2) ON CONFLICT DO NOTHING",[dataset,JSON.stringify(baseline)]);
 const run=(await owner.query("SELECT *,to_char(base_day,'YYYY-MM-DD') AS day FROM crm_demo.fixture_runs WHERE key=$1",[dataset])).rows[0];
 if(run.completed_at){summary=run.summary;console.log('Dieser Testbestand ist bereits eingerichtet. Bestehende Bearbeitungen wurden nicht verändert.');}
 else{
 const base=new Date(run.day+'T10:00:00Z');
 const at=(days=0,hour=10)=>{const d=new Date(base);d.setUTCDate(d.getUTCDate()+days);d.setUTCHours(hour,0,0,0);return d.toISOString();};
 const day=days=>at(days).slice(0,10),uid=key=>{const h=createHash('sha256').update(dataset+':'+key).digest('hex');return h.slice(0,8)+'-'+h.slice(8,12)+'-4'+h.slice(13,16)+'-a'+h.slice(17,20)+'-'+h.slice(20,32);};
 const users=(await owner.query("SELECT id,name,role,login FROM crm.users WHERE active")).rows;
 const byLogin=Object.fromEntries(users.map(u=>[u.login,u])),leader=byLogin.leitung,advisors=['anna','ben','cem','dora','eva'];
 if(!leader||advisors.some(x=>!byLogin[x]))throw Error('Die sechs bekannten lokalen Demozugänge werden benötigt.');
 const get=async id=>(await owner.query('SELECT * FROM crm.records WHERE id=$1',[id])).rows[0];
 async function operation(key,u,body,when=null){
  const saved=(await owner.query('SELECT result FROM crm_demo.fixture_steps WHERE dataset=$1 AND key=$2',[dataset,key])).rows[0];if(saved)return saved.result;
  const request_id=uid(key),prior=(await owner.query('SELECT result FROM crm.requests WHERE user_id=$1 AND request_id=$2',[u.id,request_id])).rows[0];
  const result=prior?.result||await command(u,{request_id,...body});
  if(when&&result.record){const r=result.record;
   await owner.query("UPDATE crm.audit SET created_at=$3,reason='SIMULIERTER TESTVERLAUF · '||coalesce(reason,'') WHERE record_id=$1 AND after_data->>'version'=$2 AND created_at>=$4",[r.id,String(r.version),when,run.started_at]);
   if(['create','convert_offer','revise_offer','settlement'].includes(body.action))await owner.query('UPDATE crm.records SET created_at=$2,updated_at=$2 WHERE id=$1',[r.id,when]);
   else await owner.query('UPDATE crm.records SET updated_at=greatest(created_at,$2::timestamptz) WHERE id=$1',[r.id,when]);
  }
  await owner.query('INSERT INTO crm_demo.fixture_steps(dataset,key,result) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[dataset,key,result]);return result;
 }
 const create=async(key,u,kind,data,project=null,when=null)=>(await operation(key,u,{action:'create',kind,project_id:project,data},when)).record;
 const update=async(key,u,id,data,when=null)=>{const current=await get(id);return(await operation(key,u,{action:'update',id,version:current.version,data,reason:'Fiktiver Testbestand: '+key},when)).record;};
 const contribution=async(key,p,login,role)=>operation(key,leader,{action:'contribution',project_id:p.id,user_id:byLogin[login].id,contribution:role,weight:1,reason:'Simulierte Zusammenarbeit im Leitungstest.'});
 const companies={},projects={},projectInfo={};
 const currentRecords=(await owner.query('SELECT * FROM crm.records')).rows;
 const edited=new Set((await owner.query("SELECT DISTINCT record_id FROM crm.audit WHERE action='update' AND created_at<$1",[run.started_at])).rows.map(x=>x.record_id));
 for(const [i,profile]of companyProfiles.entries()){
  const [name,industry,city,postal,size,status,url]=profile;
  let r=currentRecords.find(r=>r.kind==='company'&&r.data.name===name);
  if(!r)r=await create('company-new-'+i,leader,'company',{name,website:url});
  if(!edited.has(r.id))r=await update('company-profile-'+i,leader,r.id,{customer_number:'DEMO-K'+String(1001+i),customer_status:status,industry,street:i===7?'':'Beispielallee '+(10+i)+' (fiktive Übungsadresse)',postal_code:i===11?'':postal,city,country:'Deutschland',size:'Demoannahme: '+size,source_url:r.data.website||url||'',tags:'Testbestand, '+(i%3===0?'Bestandskunde':'Messe 2026')+', '+(i%2===0?'Führung':'Digitalisierung'),account_note:'Reale Firmenbezeichnung. Alle Kontakte, Beziehungen, Adressen, Größenangaben, Bedarfe und Umsätze in diesem CRM sind fiktive Übungsdaten. Website aus Übung übernommen, keine Unternehmensrecherche durchgeführt.'});
  companies[name]=r;
 }
 // Retain old import placeholders as visibly inactive records instead of deleting them.
 for(const r of currentRecords.filter(r=>r.kind==='company'&&r.data.name.startsWith('Ungeklärtes Unternehmen UC-'))){if(!edited.has(r.id))await update('placeholder-'+r.id,leader,r.id,{customer_status:'inactive',tags:'Altimport, Zuordnung erledigt',account_note:'Historischer Importplatzhalter ohne eigene Kundenbeziehung. Gespräch wurde bereits der bekannten Firma zugeordnet. Als Prüfspur erhalten; keine Vertriebsprognose.'});}
 const contactDefaults={role:'Fachlicher Ansprechpartner',department:'Personalentwicklung',decision_role:'Empfehlung; Bestellung durch Bereichsleitung',newsletter_status:'unknown',do_not_contact:false};
 for(const item of cases){
  const raw=source.find(s=>s.testfall_id===item.key),conversation=currentRecords.find(r=>r.kind==='conversation'&&r.data.notes===raw.notiz);
  if(!conversation)throw Error('Originalgespräch fehlt: '+item.key);
  let p=await get(conversation.project_id);const u=users.find(u=>u.id===p.owner_id);const duplicate=!!duplicates[item.n];
  const stage=item.stage,omitted=duplicate||[5,8,15,16,38].includes(item.n);
  const budget=[13,14,15].includes(item.n)?null:item.value;
  const info={...item,u,company:p.data.company_id};projectInfo[item.key]=info;
  const patch={stage:stage==='won'?'decision':stage,budget,budget_status:item.budget_status,expected_value:item.value,probability:item.probability,expected_close:item.close===null?'':day(item.close),participants:item.participants,forecast_category:omitted?'omit':stage==='decision'?'commit':item.probability>=65?'best_case':'pipeline',paused:duplicate||[5,8,15,38].includes(item.n),next_step:item.next_step,format:[14,23,32].includes(item.n)?'Online · kurze Module':item.n===19?'Online · halber Tag + Transfertermin':'Blended · Workshop und digitale Transferphase',language:[6,14,23,26,29,30].includes(item.n)?'Deutsch / Englisch':'Deutsch',start_date:day(70+(item.n%5)*14),decision_maker:item.n===15?'Noch kein zuständiger Entscheider bekannt':item.role.includes('Einkauf')?'Fachbereich und Einkauf entscheiden gemeinsam':'Fachliche Empfehlung durch '+item.name+'; Bestellung durch Bereichsleitung / Einkauf',training_interest:[5,11,36].includes(item.n)?'ai_automation':[13,29,30,31].includes(item.n)?'sales':[1,2,6,7,10,28,35].includes(item.n)?'leadership':'communication',uncertainties:'FIKTIVE TESTFORTSCHREIBUNG · '+item.issue,tags:'Demo, '+item.key+(duplicate?', Dublettenprüfung':'')};
  if([1,11].includes(item.n))patch.probability=100;
  if(stage==='lost')patch.loss_reason=({9:'Budget nicht freigegeben',16:'Kein Schulungsbedarf – Partnerkontakt',37:'Fachlicher Leistungsumfang nicht passend'})[item.n];
  if(item.n===27){patch.title='Ausbilderfeedback – Pilot';patch.start_date='2027-02-15';}
  if([20,39,40].includes(item.n))patch.start_date=item.n===20||item.n===40?'2027-01-15':'2027-03-15';
  if(item.n===28)patch.start_date='2027-05-03';
  if(!edited.has(p.id))p=await update('case-structure-'+item.key,u,p.id,patch);
  projects[item.key]=p;
  let c=currentRecords.find(r=>r.kind==='contact'&&r.project_id===p.id);
  const inferred=raw.notiz.match(/[\w.+-]+@[\w.-]+\.example\b/i)?.[0]?.toLowerCase()||'';
  const contact={...contactDefaults,name:item.name,role:item.role,department:item.role.includes('Einkauf')?'Einkauf':item.role.includes('Service')?'Service / Personalentwicklung':'Learning & Development',email:[12,15].includes(item.n)?'':c?.data.email||inferred,phone:[3,12,15,17,20,39,40].includes(item.n)?'':'DEMO-Durchwahl '+(100+item.n)+' (nicht wählbar)',contact_preference:item.n===9?'Keine weiteren Angebote oder Erinnerungen. Nur interne Klärung.':item.n===15?'Wartet auf eigene Rückmeldung; keine Kontaktadresse hinterlassen.':item.n===20?'Telefon gewünscht; Durchwahl fehlt. Neuere Abstimmung in UC-39 prüfen.':item.n===39?'E-Mail mit zwei Videoterminen ausdrücklich angefragt. Keine Werbung.':'Nur persönlich angefragte Unterlagen; keine automatische Werbung.',newsletter_status:[1,2,9,19,20,39,40].includes(item.n)?'opted_out':'unknown',do_not_contact:[3,9,12,15].includes(item.n),consent_note:'Fiktiver Messekontakt. Kein allgemeines Newsletter-Opt-in aus dem Gespräch abgeleitet.',review_at:item.n%5===0?day(-3):day(45)};
  if(!c)c=await create('contact-missing-'+item.key,u,'contact',contact,p.id);
  else if(!edited.has(c.id))c=await update('contact-complete-'+item.key,u,c.id,contact);
  const initialTask=currentRecords.find(r=>r.kind==='task'&&r.project_id===p.id&&r.data.title==='Notiz prüfen und nächsten Schritt abstimmen');
  const taskDone=[1,4,6,10,11,18,21,23,26,28,29,32,33,35,39].includes(item.n);
  if(initialTask&&!edited.has(initialTask.id))await update('initial-task-'+item.key,u,initialTask.id,{title:duplicate?'Doppelaufnahme intern vergleichen':taskDone?'Gespräch und Zuständigkeit fachlich geprüft':item.next_step,status:[9,16,37].includes(item.n)?'cancelled':taskDone?'done':'open',due_at:at(taskDone?-1:item.n%4===0?-2:1+item.n%6,9),priority:item.n%5===0?'high':'normal',result:taskDone?'Fiktiver Arbeitsstand: Notiz geprüft, nächster Schritt und offene Punkte dokumentiert.':[9,16,37].includes(item.n)?'Kein weiterer Vertriebsschritt; Grund in der Projektakte.':''});
  await create('followup-'+item.key,u,'task',{title:item.next_step,due_at:[15,38].includes(item.n)?'':at(item.n%7===0?-1:1+item.n%9,9+item.n%3),status:[9,16,37].includes(item.n)?'cancelled':'open',priority:[6,11,28,29,35,39].includes(item.n)?'high':'normal',assignee_id:u.id,type:duplicate||[3,9,12,15].includes(item.n)?'internal_review':'follow_up',result:[9,16,37].includes(item.n)?'Fiktiver Abschluss: keine externe Folgeansprache.':''},p.id);
  const internalOnly=duplicate||[3,5,9,12,15,16,37,38].includes(item.n);
  for(const [j,type]of ['note',internalOnly?'note':item.n%4===0?'call_attempt':'contacted',duplicate?'correction':internalOnly?'note':'next_agreed'].entries())await create('activity-'+item.key+'-'+j,u,'activity',{type,note:['SIMULATION · Gespräch strukturiert nachbereitet. '+item.issue,internalOnly?'SIMULATION · Nur interne Prüfung. Keine Kontaktaufnahme oder Zusage dokumentiert.':item.n%4===0?'SIMULATION · Rückrufversuch ohne Gespräch; keine Zusage oder Einwilligung daraus abgeleitet.':'SIMULATION · Fachlicher Abstimmungsstand dokumentiert: '+item.next_step,'SIMULATION · '+(duplicate?'Abgleich mit '+cases.find(x=>x.n===duplicates[item.n]).key+' erforderlich. Kein zweites Angebot senden.':item.next_step+'. Offene Angaben bleiben als solche markiert.')][j],occurred_at:at(-2+j,9+item.n%4),outcome:internalOnly?'Interne Klärung':j===1&&item.n%4===0?'Nicht erreicht':'Fiktiver Bearbeitungsstand'},p.id,at(-2+j,9+item.n%4));
  if(item.n%3===0||[1,11,35,39].includes(item.n)){
   await contribution('member-'+item.key,p,advisors[item.n%5],'qualification');
   await contribution('closing-'+item.key,p,u.login,'closing');
  }
 }
 // Separate the second need in UC-27 without duplicating the original raw note or its budget.
 const split=await create('split-27',byLogin.ben,'project',{title:'Projektzusammenarbeit – Bedarf noch offen',company_id:projects['UC-27'].data.company_id,event_id:projects['UC-27'].data.event_id,stage:'new',budget:null,budget_status:'unknown',expected_value:null,probability:15,participants:30,forecast_category:'omit',paused:true,training_interest:'project_management',next_step:'Drei Rückfragen zur Abgrenzung mit Jochen besprechen',uncertainties:'FIKTIVER TESTBESTAND · Zweites, getrenntes Vorhaben aus UC-27. Keine Übernahme der 4.800 EUR für das Ausbildertraining.',tags:'Demo, UC-27-B'});
 await create('split-activity',byLogin.ben,'activity',{type:'correction',note:'SIMULATION · Zweites Vorhaben getrennt aus UC-27 abgebildet. Originalgespräch bleibt bei Ausbilderfeedback – Pilot. 8 Ausbilder und 30 Projektmitglieder werden nicht addiert.',occurred_at:at(0,11)},split.id);
 // Current offers: variants and drafts remain reviewable, duplicate projects get no additional offer.
 for(const item of cases.filter(x=>['offered','decision','won'].includes(x.stage)&&!duplicates[x.n])){
  const p=projects[item.key],u=projectInfo[item.key].u,amount=item.value;
  const offer=await create('offer-'+item.key,u,'offer',{title:p.data.title+' · Programmvorschlag',reference:'DEMO-ANG-'+item.key,status:'draft',valid_until:day(item.n===19?-1:21),cost:Math.round(amount*.6),payment_terms:'Fiktive Konditionen: 50 % nach Auftrag, 50 % nach Durchführung; 14 Tage netto.',introduction:'Fiktives Testangebot zur CRM-Erprobung. '+item.next_step+'. Nur der beschriebene Umfang ist kalkuliert.',version_note:'Demo v1; Optionen und offene Fragen separat prüfen.',lines:[{description:'Konzeption und Vorgespräch',quantity:1,unit_price:amount*.2,discount:0,tax_rate:19},{description:'Trainingsmodule und Praxisübungen',quantity:2,unit_price:amount*.35,discount:0,tax_rate:19},{description:'Transfertermin und Lernmaterial',quantity:1,unit_price:amount*.1,discount:0,tax_rate:19}]},p.id);
  if(item.n!==23)await update('offer-status-'+item.key,u,offer.id,{status:item.n===19?'expired':item.stage==='won'?'accepted':'sent'});
  if(item.n===11){await operation('order-from-'+item.key,leader,{action:'convert_offer',id:offer.id,reference:'DEMO-AUF-'+item.key,reason:'Fiktive Auftragsbestätigung, noch kein Zahlungseingang.'});}
  if(item.stage==='won')projects[item.key]=await update('won-'+item.key,u,p.id,{stage:'won'});
 }
 // Historic events ensure meaningful 30/60/90-day cohort views.
 const events=[];for(const [i,age]of [155,112,80,50].entries())events.push(await create('past-event-'+i,leader,'event',{name:['Demo · Weiterbildungstag Frühjahr','Demo · HR-Fachforum Sommer','Demo · Kundenforum Spätsommer','Demo · Praxistag Herbst'][i],starts_at:at(-age,8),ends_at:at(-age+1,17),cost:[6800,9500,4200,3500][i]},null,at(-age-7)));
 const demoRule=await create('historical-rule',leader,'rule',{title:'Demoregel · 10 % der bezahlten Marge',pool_percent:10,origin_percent:30,qualification_percent:20,closing_percent:50,effective_from:day(-200)},null,at(-200));
 const histOrders={},histOffers={};
 for(const [i,h]of historical.entries()){
  const u=byLogin[h.advisor],e=events[h.age>=130?0:h.age>=95?1:h.age>=68?2:3];
  let p=await create('history-project-'+h.key,u,'project',{title:h.title,company_id:companies[h.company].id,event_id:e.id,stage:'new',budget:h.value,budget_status:h.stage==='lost'?'planned':'approved',expected_value:h.value,probability:h.stage==='won'?100:h.stage==='lost'?0:h.stage==='decision'?85:50,expected_close:h.closed===null?day(h.stage==='decision'?14:21):day(-h.age+h.closed),forecast_category:h.stage==='decision'?'commit':'pipeline',paused:false,participants:12+i*2,format:i%2?'Online · 4 kurze Module':'Präsenz + digitale Transferbegleitung',language:i===1?'Englisch':'Deutsch',start_date:day(-h.age+50),decision_maker:h.contact+' koordiniert, Bereichsleitung bestätigt; Einkauf bestellt.',training_interest:i%3===0?'leadership':'communication',next_step:h.stage==='won'?'Durchführung und Zahlungseingang nachhalten':h.stage==='lost'?'Verlustgrund dokumentieren, keine automatische Ansprache':'Offene Vertrags- und Terminfragen klären',uncertainties:'FIKTIVER HISTORISCHER TESTFALL '+h.key+'. Sämtliche Vorgänge und Zahlungen sind simuliert.',tags:'Demo, Historie, '+h.key},null,at(-h.age));
  projects[h.key]=p;projectInfo[h.key]={...h,u,company:p.data.company_id};
  await contribution('hist-qual-'+h.key,p,advisors[(i+1)%5],'qualification');await contribution('hist-closing-'+h.key,p,h.advisor,'closing');
  const email=h.contact.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/ /g,'.')+'@'+h.company.toLowerCase().replace(/[^a-z]/g,'')+'.example';
  await create('historic-contact-'+h.key,u,'contact',{name:h.contact,email,phone:'DEMO-Durchwahl '+(300+i)+' (nicht wählbar)',role:i%2?'Leitung Personalentwicklung':'Programmkoordination',department:'Personalentwicklung',decision_role:i%3?'Fachliche Empfehlung':'Budgetverantwortung im Testfall',contact_preference:'Persönliche Abstimmung per E-Mail; Termine vorher vereinbaren.',newsletter_status:[0,1,5,6,8,11].includes(i)?'opted_in':i===10?'opted_out':'unknown',consent_at:[0,1,5,6,8,11].includes(i)?day(-h.age+2):'',consent_note:[0,1,5,6,8,11].includes(i)?'FIKTIVER Nachweis: Zustimmung zum Train-Today-Newsletter im Demoformular; dient nur dem Versandfiltertest.':'Keine Newsletter-Zustimmung dokumentiert.',do_not_contact:i===10,review_at:i===2?day(-4):day(60)},p.id,at(-h.age+1));
  for(const [j,stage]of ['qualified','consultation','offered'].entries())p=await update('hist-stage-'+h.key+'-'+j,u,p.id,{stage},at(-h.age+4+j*6));
  let offer=await create('hist-offer-'+h.key,u,'offer',{title:h.title+' · Leistungsumfang',reference:'DEMO-ANG-'+h.key,status:'draft',valid_until:day(-h.age+40),cost:h.cost,payment_terms:'Testkonditionen: 50 % Anzahlung, Rest nach Durchführung.',introduction:'Fiktives historisches Angebot. Trainingsziel: konkrete Praxissituationen sicher bearbeiten und Ergebnisse in den Arbeitsalltag übertragen.',lines:[{description:'Trainingsprogramm einschließlich Vorbereitung',quantity:1,unit_price:h.value*.85,discount:0,tax_rate:19},{description:'Transferbegleitung und Material',quantity:1,unit_price:h.value*.15,discount:0,tax_rate:19}]},p.id,at(-h.age+17));
  offer=await update('hist-offer-status-'+h.key,u,offer.id,{status:h.stage==='won'||h.key==='H-11'?'accepted':h.stage==='lost'?'declined':'sent'},at(-h.age+20));histOffers[h.key]=offer;
  if(h.stage==='won'||h.key==='H-11'){
   let order=(await operation('hist-order-'+h.key,leader,{action:'convert_offer',id:offer.id,reference:'DEMO-AUF-'+h.key,reason:'Simulierte Bestellung für historischen Leitungstest.'},at(-h.age+h.closed))).record;
   order=await update('hist-payment-'+h.key,leader,order.id,{paid_amount:h.paid,refund_amount:h.key==='H-04'?0:h.refund,cancelled:h.key==='H-11',confirmed_at:at(-h.age+h.closed)},at(-h.age+h.closed+1));histOrders[h.key]=order;
  }
  const loss=h.key==='H-03'?'Wettbewerber mit bestehendem Rahmenvertrag':h.key==='H-08'?'Budget kurzfristig eingefroren':'Fiktive Stornierung; Anzahlung vollständig erstattet';
  p=await update('hist-final-'+h.key,u,p.id,{stage:h.stage,...(h.stage==='lost'?{loss_reason:loss}:{})},at(h.closed===null?-3:-h.age+h.closed));projects[h.key]=p;
  for(const [j,type]of ['contacted','meeting','next_agreed','note'].entries())await create('hist-activity-'+h.key+'-'+j,u,'activity',{type,occurred_at:at(-h.age+2+j*7,9+j),note:'SIMULIERTER VERLAUF · '+['Bedarf, Teilnehmende und fachliche Entscheidung geklärt.','Konzeptgespräch durchgeführt; Beispiele anonymisiert abgestimmt.','Angebot und nächsten Entscheidungstermin vereinbart.',h.stage==='won'?'Fiktive Bestellung dokumentiert; Durchführung und Zahlung werden separat verfolgt.':h.stage==='lost'?loss:'Rückmeldung noch offen; Verantwortliche bleiben zugeordnet.'][j],outcome:j===3?h.stage:'Fiktiv dokumentiert'},p.id,at(-h.age+2+j*7,9+j));
  for(let j=0;j<3;j++)await create('hist-task-'+h.key+'-'+j,u,'task',{title:['Bedarf und Entscheidungsweg klären','Programm und Angebotsumfang abstimmen','Rückmeldung zur Durchführung einholen'][j],status:j===2&&h.stage!=='lost'?'open':'done',due_at:at(j===2?(i%4===0?-3:i%6+1):-h.age+8+j*8,9),assignee_id:u.id,priority:i%4===0?'high':'normal',type:'follow_up',result:j===2&&h.stage!=='lost'?'':'Fiktiver Verlauf: Schritt abgeschlossen und Ergebnis in der Kundenakte festgehalten.'},p.id,at(-h.age+3+j));
 }
 // Establish all contributors before bonus calculations so support assignments do not stale drafts.
 for(const key of ['UC-06','UC-28','UC-29','UC-35','H-02','H-04','H-07','H-09'])await contribution('leader-support-'+key,projects[key],'leitung','support');
 // Management decisions use their actual simulation time; finalized settlements stay immutable.
 const settle=async(key,p,rule,reason,approve=null,when=null)=>{const r=(await operation(key,leader,{action:'settlement',project_id:p.id,rule_id:rule.id,reason},when)).record;if(approve!==null)return(await operation(key+'-decision',leader,{action:'settlement_decision',id:r.id,approve,reason:approve?'SIMULATION · Beiträge und Zahlung geprüft; keine echte Auszahlung.':'SIMULATION · Auszahlung noch nicht freigegeben; interner Klärungsbedarf.'},when)).record;return r;};
 await settle('bonus-h01',projects['H-01'],demoRule,'Demo · vollständig bezahlter Auftrag, bereits freigegeben',true);
 await settle('bonus-h02',projects['H-02'],demoRule,'Zur Prüfung · Siemens mit 50 % Teilzahlung');
 await settle('bonus-h04-before',projects['H-04'],demoRule,'Demo · Freigabe vor späterer Erstattung',true);
 await update('refund-h04',leader,histOrders['H-04'].id,{refund_amount:5600});
 await settle('bonus-h04-refund',projects['H-04'],demoRule,'Korrektur prüfen · 5.600 EUR Erstattung nach Freigabe');
 await settle('bonus-h06',projects['H-06'],demoRule,'Demo · abgelehnter Prämienvorschlag',false);
 await settle('bonus-h07',projects['H-07'],demoRule,'Zur Freigabe · Festo vollständig bezahlt');
 await settle('bonus-h09-old',projects['H-09'],demoRule,'Veraltet · Zahlung wurde nach der Berechnung geändert');
 await update('payment-h09-more',leader,histOrders['H-09'].id,{paid_amount:10000});
 await settle('bonus-h09-new',projects['H-09'],demoRule,'Aktuelle Teilzahlung · neuer prüfbarer Entwurf');
 await settle('bonus-h12',projects['H-12'],demoRule,'Zur Freigabe · elobau vollständig bezahlt');
 await contribution('uc01-qual-ensure',projects['UC-01'],'ben','qualification');await contribution('uc01-closing-ensure',projects['UC-01'],'anna','closing');
 await settle('bonus-uc01',projects['UC-01'],demoRule,'Zur Prüfung · dm-Pilot, erste Hälfte bezahlt');
 // Tasks owned by leadership provide immediate personal actions.
 for(const [i,key]of ['UC-06','UC-28','UC-29','UC-35','H-02','H-04','H-07','H-09'].entries()){
  const p=projects[key];await contribution('leader-support-'+key,p,'leitung','support');
  await create('leader-task-'+key,leader,'task',{title:['Pilotumfang und Preisgrenze freigeben','Einheitliche Zuständigkeit nach Planänderung festlegen','Coachingoption vor Angebotsfreigabe abgrenzen','Projektübergabe annehmen oder ablehnen','Prämienentwurf auf Teilzahlungsbasis prüfen','Negative Prämienkorrektur nach Erstattung prüfen','Vollständig bezahlten Auftrag zur Prämie prüfen','Veralteten und aktuellen Prämienentwurf vergleichen'][i],status:'open',due_at:at([-1,0,1,2,0,1,3,4][i],9+i%3),assignee_id:leader.id,priority:i<6?'high':'normal',type:'management_review',result:''},p.id);
 }
 for(const [i,[key,recipient,decision]]of [['UC-35','leitung',null],['H-10','leitung',null],['UC-26','ben',null],['UC-28','dora',true],['UC-12','eva',false]].entries()){
  const p=await get(projects[key].id),u=users.find(x=>x.id===p.owner_id);const h=(await operation('handoff-'+i,u,{action:'handoff',project_id:p.id,data:{recipient_id:byLogin[recipient].id,note:'FIKTIVE ÜBERGABE · '+(recipient==='leitung'?'Leitungsentscheidung zu Zuständigkeit und nächstem Schritt erbeten.':'Fachliche Kapazität und Zuständigkeit abstimmen.')}})).record;
  if(decision!==null)await operation('handoff-decision-'+i,byLogin[recipient],{action:'handoff_decision',id:h.id,accept:decision});
 }
 for(const [i,t]of ticketers.entries()){
  const [key,title,status,priority,description,days,category]=t,p=await get(projects[key].id),u=users.find(x=>x.id===p.owner_id);
  await create('ticket-'+i,u,'ticket',{title,status,priority,description:'FIKTIVER SERVICEFALL · '+description,assignee_id:u.id,due_at:at(days,14),category,resolution:['resolved','closed'].includes(status)?'SIMULIERTE LÖSUNG · '+description:''},p.id,at(-5+i%4));
 }
 // This week, next week, missed appointments and two overlapping options.
 const appointmentKeys=['UC-01','UC-04','UC-06','UC-11','UC-18','UC-19','UC-21','UC-23','UC-24','UC-26','UC-28','UC-29','UC-32','UC-33','UC-35','UC-39','H-01','H-02','H-04','H-05','H-07','H-09','H-10','H-12'];
 for(const [i,key]of appointmentKeys.entries()){
  const p=await get(projects[key].id),u=users.find(x=>x.id===p.owner_id),offset=[-4,-3,-2,-1,0,0,1,2,2,3,4,5,6,7,2,3,1,4,5,6,7,8,9,10][i],hour=8+i%6;
  const start=at(offset,hour),end=new Date(new Date(start).getTime()+[30,45,60][i%3]*60000).toISOString();
  await create('appointment-'+i,u,'appointment',{title:(i<4?'Nachbesprechung':i===8?'Terminoption – Rückbestätigung fehlt':'Konzept- und Abstimmungsgespräch')+' · '+p.data.title,starts_at:start,ends_at:end,location:i%3===0?'Demo-Besprechungsraum Nord':'Videotermin – Einladungslink im Test noch offen',status:i<3?'done':i===3?'cancelled':'planned',description:'FIKTIVER TERMIN · Ziele: Bedarf abgleichen, offene Fragen priorisieren und nächsten Schritt festhalten. '+(i===8?'Kundenseitige Zusage steht noch aus.':i===3?'Vom Kunden verschoben; neuer Vorschlag erforderlich.':'Keine echte Einladung versendet.'),assignee_id:u.id},p.id,at(-3));
 }
 // A genuine scheduling conflict in the demo, same advisor and same time as appointment 14.
 const clash=await get(projects['UC-35'].id),clashUser=users.find(x=>x.id===clash.owner_id);
 await create('appointment-conflict',clashUser,'appointment',{title:'Zweite Terminoption · internen Konflikt prüfen',starts_at:at(2,10),ends_at:at(2,11),location:'Interne Demo-Besprechung',status:'planned',description:'FIKTIVER KONFLIKTFALL · Überlappt mit dem Konzeptgespräch zu Führen ohne Weisungsbefugnis. Erst nach Klärung bestätigen.',assignee_id:clashUser.id},clash.id);
 const services=(await owner.query("SELECT * FROM crm.records WHERE kind='service' ORDER BY created_at")).rows;
 for(const [i,trainer]of ['Alex Winter','Samira Braun','Lars König','Alex Winter','Samira Braun','Lars König'].entries())await create('availability-'+i,leader,'availability',{title:'Demo · '+services[i%services.length].data.title,trainer:trainer+' (fiktiv)',service_id:services[i%services.length].id,starts_at:at(2+i*3,8),ends_at:at(2+i*3,15),status:i===2?'unavailable':i%2?'reserved':'available'});
 for(const [i,key]of ['UC-01','UC-06','UC-11','UC-21','UC-23','UC-29','UC-33','UC-35','UC-39','H-01','H-02','H-04','H-07','H-09','H-12'].entries()){
  const p=await get(projects[key].id),u=users.find(x=>x.id===p.owner_id);
  await create('document-'+i,u,'document',{title:['Programmbeispiel Führung','Programmbeispiel KI','Checkliste Projektstart','Feedbackbogen – Beispiel'][i%4]+' (Demo)',url:'http://localhost:3080/demo-documents/'+['fuehrung','ki','projektstart','feedback'][i%4]+'.txt',category:i%4===3?'Qualität':'Trainingsunterlagen',description:'Fiktive, lokal mitgelieferte Beispielunterlage. Keine Kundendaten oder echten Referenzen.'},p.id);
 }
 for(const [i,c]of [{title:'Demo · Impulse für Bestandskunden',tag:'Testbestand',industry:'',status:'active',description:'Fiktive Zielgruppe mit dokumentierter Zustimmung. Nur Vorschau und CSV; kein Versand.'},{title:'Demo · Führung im Handel',tag:'',industry:'Handel',status:'planned',description:'Segment nach Branche; fehlende Einwilligungen werden ausgeschlossen.'},{title:'Demo · Sommerprogramm – Rückblick',tag:'Bestandskunde',industry:'',status:'completed',description:'Abgeschlossene fiktive Planung; kein tatsächlicher Mailversand erfolgt.'}].entries())await create('campaign-'+i,leader,'campaign',{...c,starts_at:at(i===2?-60:2),ends_at:at(i===2?-30:30)});
 for(const [i,v]of [{title:'Leitung · Entscheidungen offen',filters:{q:'',stage:'decision',owner:'',event:'',risk:'',mode:'list'}},{title:'Leitung · Prognose vervollständigen',filters:{q:'',stage:'',owner:'',event:'',risk:'incomplete',mode:'list'}},{title:'Leitung · Pipeline im Board',filters:{q:'',stage:'',owner:'',event:'',risk:'',mode:'board'}}].entries())await create('leader-view-'+i,leader,'saved_view',{...v,module:'projects'});
 const counts=(await owner.query('SELECT kind,count(*)::int AS count FROM crm.records GROUP BY kind ORDER BY kind')).rows;
 const stages=(await owner.query("SELECT data->>'stage' AS stage,count(*)::int AS count FROM crm.records WHERE kind='project' AND data->>'merged_into' IS NULL GROUP BY 1 ORDER BY 1")).rows;
 const forecast=(await owner.query(`SELECT left(data->>'expected_close',7) AS month,count(*)::int AS opportunities,round(sum((data->>'expected_value')::numeric),2) AS net,round(sum((data->>'expected_value')::numeric*(data->>'probability')::numeric/100),2) AS weighted FROM crm.records WHERE kind='project' AND data->>'stage' NOT IN ('won','lost') AND coalesce((data->>'paused')::boolean,false)=false AND coalesce(data->>'forecast_category','pipeline')<>'omit' AND nullif(data->>'expected_value','') IS NOT NULL AND nullif(data->>'probability','') IS NOT NULL AND nullif(data->>'expected_close','') IS NOT NULL GROUP BY 1 ORDER BY 1`)).rows;
 const afterRecords=(await owner.query("SELECT * FROM crm.records WHERE kind='conversation'")).rows;
 const preserved=source.every(s=>afterRecords.some(r=>r.data.notes===s.notiz));
 if(!preserved)throw Error('Originalnotes missing');
 summary={dataset,base_day:run.day,completed_at:new Date().toISOString(),counts,stages,forecast,original_conversations_preserved:40,synthetic_history:true,projects:Object.fromEntries(Object.entries(projects).map(([key,p])=>[key,p.id])),leader_cases:['UC-35','H-10','H-02','H-04','H-07','H-09']};
 await owner.query('INSERT INTO crm.audit(actor_id,action,after_data,reason) VALUES($1,$2,$3,$4)',[leader.id,'demo_dataset_loaded',{dataset,counts},'Lokaler fiktiver Leitungstestbestand eingerichtet. Rückdatierte Verlaufseinträge sind ausdrücklich Simulationen; keine echten Kundenaktionen.']);
 await owner.query('UPDATE crm_demo.fixture_runs SET completed_at=now(),summary=$2 WHERE key=$1',[dataset,summary]);
 console.log('Lokaler Leitungstestbestand angelegt. Originalnotizen, Benutzerbearbeitungen und externe Workflows erhalten.');
 }
 fs.writeFileSync(reportPath,JSON.stringify(summary,null,2));console.log(JSON.stringify({counts:summary.counts,stages:summary.stages,forecast:summary.forecast},null,2));
}finally{await owner.end();await pool.end();}
