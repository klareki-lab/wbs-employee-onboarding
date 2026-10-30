const d=$input.first().json;
if(!d.plan||d.decision!=='approve'||!d.reviewer)throw new Error('Keine gültige HR-Freigabe.');
const tasks=d.plan.tasks.map(t=>({...t,status:t.id==='G01'?'Geprüft':'Zur manuellen Umsetzung freigegeben'}));
return [{json:{...d.plan,draft:d.draft,tasks,status:'approved',decision:{by:d.reviewer,at:d.decidedAt,comment:d.comment||'',value:'approve'},delivery:'Arbeitspaket freigegeben. Noch keine E-Mail versendet, kein Konto angelegt und kein Termin gebucht.'}}];
