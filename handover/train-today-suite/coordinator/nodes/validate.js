const data=$input.first().json;
const fields=['fullName','personalEmail','companyEmail','department','role','manager','startDate'];
const e={};const errors=[];
for(const k of fields){e[k]=typeof data.employee?.[k]==='string'?data.employee[k].trim():'';if(!e[k]&&k!=='companyEmail')errors.push('Pflichtfeld fehlt: '+k);if(e[k].length>160)errors.push('Angabe zu lang: '+k);}
for(const k of ['personalEmail','companyEmail'])if(e[k]&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e[k]))errors.push('E-Mail ungültig: '+k);
const date=new Date(e.startDate+'T12:00:00Z');
if(!/^\d{4}-\d{2}-\d{2}$/.test(e.startDate)||!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==e.startDate)errors.push('Startdatum ist ungültig.');
e.managerial=data.employee?.managerial===true;
const warnings=[];if(!e.companyEmail)warnings.push('Firmen-E-Mail noch nicht vorhanden: IT muss sie einrichten und bestätigen.');
if(Number.isFinite(date.getTime())){if([0,6].includes(date.getUTCDay()))warnings.push('Startdatum liegt am Wochenende. HR muss den Termin prüfen.');if(e.startDate<new Date().toISOString().slice(0,10))warnings.push('Startdatum liegt in der Vergangenheit. Fristen prüfen.');}
if(e.managerial&&e.department.toLowerCase()==='marketing')warnings.push('Die Marketing-Checkliste gilt nur für Rollen ohne Führungsverantwortung. Eine individuelle Ergänzung ist nötig.');
return [{json:{runId:data.runId,employee:e,valid:errors.length===0,errors,warnings,source:'Train-Today-Onboarding-Checklists.pdf · Seiten 1–2'}}];
