import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../components/UI';

type Task={id:string;title:string;due:string;state:string;owner:string;resourceUrl:string|null;confirmationRequested:boolean};
type Plan={id:string;employeeName:string;startDate:string;manager:string;department:string;tasks:Task[]};
const titles={rules:'Regeln und Dokumente',training:'Meine Schulungen',team:'Mein Team',tasks:'Meine Aufgaben'};
const states:Record<string,string>={open:'Offen',in_progress:'In Bearbeitung',blocked:'Blockiert',done:'Von HR bestätigt'};
export function OnboardingArea({section}:{section:keyof typeof titles}){
 const [plans,setPlans]=useState<Plan[]>([]),[csrf,setCsrf]=useState(''),[error,setError]=useState(''),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false);
 async function load(){try{const r=await fetch('/coordinator/mine');if(!r.ok)throw new Error('Deine Onboarding-Aufgaben sind momentan nicht erreichbar.');const d=await r.json();setPlans(d.cases);setCsrf(d.csrf);setError('');}catch(e){setError((e as Error).message);}finally{setLoading(false);}}
 useEffect(()=>{void load();},[]);
 async function confirm(plan:Plan,task:Task){setBusy(true);try{const r=await fetch(`/coordinator/mine/${plan.id}/${task.id}`,{method:'POST',headers:{'Content-Type':'application/json','X-Onboarding-CSRF':csrf},body:JSON.stringify({comment:'Ich habe diesen Schritt abgeschlossen und bitte um Prüfung.'})});if(!r.ok)throw new Error('Rückmeldung konnte nicht gespeichert werden.');await load();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <><Link to="/dashboard" className="back-link">← Zurück zum Dashboard</Link><PageHeader eyebrow="MEIN ONBOARDING" title={titles[section]} description="Freigegebene Informationen aus deinem persönlichen Onboarding-Plan"/>
 <button className="button button-secondary" onClick={()=>void load()}>Aktualisieren</button>
 {error&&<p role="alert">{error}</p>}{loading&&<p>Wird geladen …</p>}
 {!loading&&!error&&!plans.length&&<div className="placeholder-card"><h2>Noch kein freigegebener Plan</h2><p>HR muss deinen Mitarbeiterdatensatz im Onboarding-Koordinator verknüpfen und den Plan freigeben.</p></div>}
 {plans.map(plan=><section className="placeholder-card" style={{display:'block',textAlign:'left',marginTop:20,padding:28}} key={plan.id}>
 <h2>{plan.employeeName} · Start {plan.startDate}</h2>
 {section==='team'?<><p>Abteilung: {plan.department}</p><p>Führungskraft: {plan.manager}</p><p>Buddy und weitere Ansprechpartner bestätigt HR im persönlichen Einführungsgespräch.</p></>:<>
 {plan.tasks.filter(t=>section==='tasks'||(section==='training'?['G17','G18','M10'].includes(t.id):['G07','M09'].includes(t.id))).map(task=><article key={task.id} style={{borderBottom:'1px solid #dfe6eb',padding:'18px 0'}}>
 <h3>{task.title}</h3><p>{states[task.state]||task.state} · Zieltermin {task.due} · Zuständig: {task.owner}</p>
 {task.resourceUrl?<p><a href={task.resourceUrl} target="_blank" rel="noreferrer">Freigegebenen Inhalt öffnen ↗</a></p>:section!=='tasks'&&<p>HR hat noch keinen Dokument- oder Schulungslink hinterlegt.</p>}
 {task.state==='done'?<p>Der Abschluss wurde von HR bestätigt.</p>:task.confirmationRequested?<p>Deine Rückmeldung liegt HR zur Prüfung vor.</p>:<button disabled={busy} className="button button-primary" onClick={()=>void confirm(plan,task)}>Abgeschlossen – HR um Bestätigung bitten</button>}
 </article>)}<p>Deine Rückmeldung ersetzt keine HR-Prüfung oder bestätigte Kontofreischaltung.</p></>}
 </section>)}</>;
}
