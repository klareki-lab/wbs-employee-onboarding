// Repairs only the automatically seeded fictional exercises, preserving raw conversations.
import {pool,transaction,add,put,audit} from './db.mjs';
import fs from 'node:fs';
const source=JSON.parse(fs.readFileSync(new URL('./demo-conversations.json',import.meta.url))),u=(await pool.query("SELECT id,role FROM crm.users WHERE login='leitung'")).rows[0];
await transaction(u,async c=>{
 for(const [name,url]of [['Ottobock','https://www.ottobock.com'],['Bechtle','https://www.bechtle.com'],['DATEV','https://www.datev.de'],['Kärcher','https://www.kaercher.com'],['VAUDE','https://www.vaude.com'],['Miele','https://www.miele.de']]){
  const company=(await c.query("SELECT * FROM crm.records WHERE kind='company' AND data->>'name'=$1 ORDER BY created_at LIMIT 1",[name])).rows[0]||await add(c,u,'company',{name,website:url});
  for(const item of source.filter(s=>s.notiz.slice(0,350).toLowerCase().includes(name.toLowerCase()))){
   const conv=(await c.query("SELECT * FROM crm.records WHERE kind='conversation' AND data->>'notes'=$1",[item.notiz])).rows[0];if(!conv)continue;
   const p=(await c.query('SELECT * FROM crm.records WHERE id=$1',[conv.project_id])).rows[0];if(p.data.company_id===company.id)continue;
   const next=await put(c,p,{...p.data,company_id:company.id});await audit(c,u,'demo_company_assignment',p.id,p,next,'Firmenname aus Original-Testfall '+item.testfall_id+' zugeordnet.');
  }
 }
 const titles={'UC-05':'KI-Orientierung – Bedarf klären','UC-12':'Train-the-Trainer im Service','UC-15':'Bedarfsklärung Kundenservice','UC-16':'Anbieterangebot – keine Schulungsanfrage','UC-17':'Change-Begleiter qualifizieren','UC-19':'Projektmoderation','UC-27':'Zwei Vorhaben: Ausbilderfeedback und Projektzusammenarbeit','UC-37':'Produktschulung – Leistungsumfang prüfen','UC-38':'Zusammenarbeit in Projektteams'};
 for(const [key,title]of Object.entries(titles)){const notes=source.find(x=>x.testfall_id===key)?.notiz;const r=(await c.query("SELECT p.* FROM crm.records p JOIN crm.records v ON v.project_id=p.id WHERE v.kind='conversation' AND v.data->>'notes'=$1",[notes])).rows[0];if(r&&r.data.title!==title){const next=await put(c,r,{...r.data,title});await audit(c,u,'demo_title_review',r.id,r,next,'Lesbare Bezeichnung des Testfalls '+key+'; Originalnotiz unverändert.');}}
});
console.log('Fiktive Testfälle den sechs fehlenden echten Firmennamen zugeordnet.');await pool.end();
