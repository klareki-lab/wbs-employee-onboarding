import {fail,manager,record,add,put,audit,uuid} from './db.mjs';
import {projectApi,deliveryFields,validateDelivery} from './projects.mjs';

export const extraFields={
 company:['customer_number','customer_status','street','postal_code','city','country','tags','account_note'],
 project:['probability','expected_close','forecast_category','next_step','tags',...deliveryFields],
 contact:['department','newsletter_status','consent_at','do_not_contact','review_at'],
 offer:['lines','tax_total','gross_total','payment_terms','introduction','revision_of'],
 order:['source_offer_id'],
 ticket:['title','description','status','priority','assignee_id','due_at','resolution','category'],
 appointment:['title','starts_at','ends_at','location','status','description','assignee_id'],
 document:['title','url','description','category'],
 campaign:['title','status','industry','tag','description','starts_at','ends_at'],
 task_template:['title','steps','description'],
 saved_view:['title','filters','module']
};
const choices={customer_status:['prospect','customer','partner','inactive'],newsletter_status:['unknown','opted_in','opted_out'],forecast_category:['pipeline','best_case','commit','omit']};
const textFields=['customer_number','street','postal_code','city','country','tags','account_note','department','next_step','payment_terms','introduction','location','resolution','category'];
const validDate=v=>typeof v==='string'&&Number.isFinite(Date.parse(v));
const round=n=>Math.round((n+Number.EPSILON)*100)/100;
export function normalizeWorkspace(kind,d){
 if(kind==='project')validateDelivery(d);
 for(const key of textFields)if(key in d&&typeof d[key]!=='string')fail('Text erforderlich: '+key);
 for(const [key,values]of Object.entries(choices))if(d[key]&&!values.includes(d[key]))fail('Ungültige Auswahl: '+key);
 for(const key of ['consent_at','review_at','expected_close'])if(d[key]&&!validDate(d[key]))fail('Datum prüfen: '+key);
 if('do_not_contact'in d&&typeof d.do_not_contact!=='boolean')fail('Kontaktsperre muss Ja oder Nein sein.');
 if(d.probability!==undefined&&d.probability!==null&&d.probability!==''){d.probability=Number(d.probability);if(!Number.isFinite(d.probability)||d.probability<0||d.probability>100)fail('Abschlusswahrscheinlichkeit muss zwischen 0 und 100 liegen.');}else if('probability'in d)d.probability=null;
 if(kind==='contact'&&d.newsletter_status==='opted_in'&&(!d.consent_note?.trim()||!d.consent_at))fail('Newsletter-Einwilligung benötigt einen Nachweis und ein Datum.');
 if(kind==='offer'&&d.lines!==undefined){
  if(!Array.isArray(d.lines)||d.lines.length>50)fail('Höchstens 50 Angebotspositionen.');
  if(d.lines.length){let net=0,tax=0;d.lines=d.lines.map(line=>{
   if(!line||typeof line!=='object'||Object.keys(line).some(k=>!['description','quantity','unit_price','discount','tax_rate'].includes(k)))fail('Ungültige Angebotsposition.');
   const l={description:String(line.description||'').trim(),quantity:Number(line.quantity),unit_price:Number(line.unit_price),discount:Number(line.discount??0),tax_rate:Number(line.tax_rate??19)};
   if(!l.description||l.description.length>2000||!Number.isFinite(l.quantity)||l.quantity<=0||l.quantity>100000||!Number.isFinite(l.unit_price)||l.unit_price<0||l.unit_price>10000000||!Number.isFinite(l.discount)||l.discount<0||l.discount>100||![0,7,19].includes(l.tax_rate))fail('Menge, Preis, Rabatt oder Steuersatz der Position prüfen.');
   const value=round(l.quantity*l.unit_price*(1-l.discount/100));net+=value;tax+=round(value*l.tax_rate/100);return l;
  });d.amount=round(net);d.tax_total=round(tax);d.gross_total=round(net+tax);}
  else{d.tax_total=null;d.gross_total=null;}
 }
 if(['ticket','appointment','campaign','task_template','document','saved_view'].includes(kind)&&!d.title?.trim())fail('Bezeichnung erforderlich.');
 if(kind==='ticket'){
  d.status=d.status||'open';d.priority=d.priority||'normal';
  if(!['open','in_progress','waiting','resolved','closed'].includes(d.status)||!['low','normal','high','urgent'].includes(d.priority))fail('Service-Status oder Priorität prüfen.');
  if(['resolved','closed'].includes(d.status)&&!d.resolution?.trim())fail('Bitte die Lösung des Servicefalls dokumentieren.');
 }
 if(kind==='appointment'){
  if(!validDate(d.starts_at)||!validDate(d.ends_at)||new Date(d.ends_at)<=new Date(d.starts_at))fail('Termin benötigt einen Beginn und ein späteres Ende.');
  d.status=d.status||'planned';if(!['planned','done','cancelled'].includes(d.status))fail('Terminstatus prüfen.');
 }
 if(kind==='document'){let url;try{url=new URL(d.url);}catch{fail('Vollständige Dokument-Adresse erforderlich.');}if(!['https:','http:'].includes(url.protocol))fail('Dokumentlinks müssen HTTP oder HTTPS verwenden.');}
 if(kind==='campaign'){d.status=d.status||'planned';if(!['planned','active','completed','cancelled'].includes(d.status))fail('Kampagnenstatus prüfen.');if(d.starts_at&&d.ends_at&&new Date(d.ends_at)<new Date(d.starts_at))fail('Kampagnenende liegt vor dem Beginn.');}
 if(kind==='task_template'){
  if(!Array.isArray(d.steps)||d.steps.length<1||d.steps.length>20)fail('Eine Vorlage benötigt 1 bis 20 Schritte.');
  d.steps=d.steps.map(s=>{if(typeof s.title!=='string'||!s.title.trim()||s.title.length>300||!Number.isInteger(Number(s.days))||Number(s.days)<0||Number(s.days)>365)fail('Vorlagenschritt: Titel und 0 bis 365 Tage Abstand erforderlich.');return{title:s.title.trim(),days:Number(s.days)};});
 }
 if(kind==='saved_view'){
  if(d.module!=='projects'||!d.filters||typeof d.filters!=='object'||Array.isArray(d.filters)||Object.keys(d.filters).some(k=>!['q','stage','owner','event','risk','mode'].includes(k))||Object.values(d.filters).some(v=>typeof v!=='string'||v.length>300))fail('Ungültiger Ansichtsfilter.');
 }
 return d;
}
export async function workspaceCommand(c,u,b){
 if(b.action==='apply_template'){
  const p=await record(c,b.project_id,'project');if(p.data.merged_into)fail('Bitte das Hauptprojekt verwenden.');
  const template=await record(c,b.template_id,'task_template');if(!validDate(b.base_date))fail('Startdatum erforderlich.');
  const result=[];for(const step of template.data.steps){const date=new Date(b.base_date);date.setUTCDate(date.getUTCDate()+step.days);const t=await add(c,u,'task',{title:step.title,status:'open',priority:'normal',assignee_id:u.id,due_at:date.toISOString(),type:'follow_up'},p.id);result.push(t);await audit(c,u,'template_task',t.id,null,t,template.data.title);}
  return {records:result};
 }
 if(b.action==='revise_offer'){
  const old=await record(c,b.id,'offer'),p=await record(c,old.project_id,'project');if(p.data.merged_into)fail('Bitte das Hauptprojekt verwenden.');
  const d={...old.data,status:'draft',revision_of:old.id,reference:'ANG-'+crypto.randomUUID().slice(0,8).toUpperCase(),version_note:'Neue Fassung von '+(old.data.reference||old.id)};
  const r=await add(c,u,'offer',d,old.project_id);await audit(c,u,'offer_revision',r.id,old,r);return {record:r};
 }
 if(b.action==='convert_offer'){
  manager(u);const offer=await record(c,b.id,'offer');if(offer.data.status!=='accepted')fail('Nur ein angenommenes Angebot kann zum Auftrag werden.');
  if((await c.query("SELECT 1 FROM crm.records WHERE kind='order' AND data->>'source_offer_id'=$1",[offer.id])).rowCount)fail('Für dieses Angebot gibt es bereits einen Auftrag.',409);
  const p=await record(c,offer.project_id,'project');if(p.data.merged_into)fail('Bitte das Hauptprojekt verwenden.');
  if(typeof b.reference!=='string'||!b.reference.trim()||b.reference.length>120||!b.reason?.trim())fail('Auftragsnummer und Bestätigungsvermerk erforderlich.');
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,1))',[b.reference.trim().toLowerCase()]);
  if((await c.query("SELECT 1 FROM crm.records WHERE kind='order' AND lower(data->>'reference')=lower($1)",[b.reference.trim()])).rowCount)fail('Auftragsnummer bereits vorhanden.',409);
  const r=await add(c,u,'order',{reference:b.reference.trim(),amount:Number(offer.data.amount||0),cost:Number(offer.data.cost||0),paid_amount:0,refund_amount:0,cancelled:false,confirmed_at:new Date().toISOString(),source_offer_id:offer.id},p.id);
  await audit(c,u,'offer_to_order',r.id,null,r,b.reason);return{record:r};
 }
 return null;
}

// All entry points use the authenticated user's RLS scope. No credentials in HTML.
export async function workspaceApi(c,u,resource,url){
 const projectResult=await projectApi(c,u,resource);if(projectResult)return projectResult;
 if(resource==='campaign-recipients'){
  manager(u);const campaign=await record(c,url.searchParams.get('campaign_id'),'campaign');
  const contacts=(await c.query("SELECT * FROM crm.records WHERE kind='contact' ORDER BY created_at,id")).rows;
  const projects=new Map((await c.query("SELECT * FROM crm.records WHERE kind='project'")).rows.map(p=>[p.id,p]));
  const companies=new Map((await c.query("SELECT * FROM crm.records WHERE kind='company'")).rows.map(p=>[p.id,p]));
  const blocked=new Set(contacts.filter(x=>x.data.do_not_contact||x.data.newsletter_status==='opted_out').map(x=>(x.data.email||'').trim().toLowerCase())),seen=new Set();
  const records=contacts.filter(x=>{const company=companies.get(projects.get(x.project_id)?.data.company_id),mail=(x.data.email||'').trim().toLowerCase();
   if(!mail||blocked.has(mail)||seen.has(mail)||x.data.newsletter_status!=='opted_in'||!x.data.consent_note?.trim()||!x.data.consent_at)return false;
   if(campaign.data.industry&&!company?.data.industry?.toLowerCase().includes(campaign.data.industry.toLowerCase()))return false;
   if(campaign.data.tag&&!String(company?.data.tags||'').split(',').map(t=>t.trim().toLowerCase()).includes(campaign.data.tag.toLowerCase()))return false;
   seen.add(mail);return true;
  });return{api_version:'1',campaign_id:campaign.id,records,total:records.length,generated_at:new Date().toISOString(),sent:false};
 }
 const types={companies:'company',contacts:'contact',opportunities:'project',tasks:'task',activities:'activity',offers:'offer',orders:'order',tickets:'ticket',appointments:'appointment','work-items':'work_item','time-entries':'time_entry','project-comments':'project_comment'};
 if(!types[resource])fail('Unbekannte CRM-Ressource.',404);
 const limit=Math.min(100,Math.max(1,Number(url.searchParams.get('limit'))||50)),offset=Math.max(0,Number(url.searchParams.get('offset'))||0);
 if(!Number.isInteger(limit)||!Number.isInteger(offset))fail('Ganzzahlige Seitengröße erforderlich.');
 const project=url.searchParams.get('project_id'),since=url.searchParams.get('updated_since');
 if(project&&!uuid.test(project)||since&&!validDate(since))fail('Ungültiger Suchparameter.');
 const values=[types[resource]],where=['kind=$1'];if(project){values.push(project);where.push('project_id=$'+values.length+'::uuid');}if(since){values.push(since);where.push('updated_at >= $'+values.length+'::timestamptz');}
 const total=Number((await c.query('SELECT count(*) FROM crm.records WHERE '+where.join(' AND '),values)).rows[0].count);
 values.push(limit,offset);const records=(await c.query('SELECT * FROM crm.records WHERE '+where.join(' AND ')+' ORDER BY updated_at,id LIMIT $'+(values.length-1)+' OFFSET $'+values.length,values)).rows;
 return{api_version:'1',resource,total,limit,offset,records,next_offset:offset+records.length<total?offset+records.length:null};
}
