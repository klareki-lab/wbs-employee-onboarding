import { ArrowUpRight, ClipboardList, KeyRound, ShieldCheck, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
export function WorkspaceCards({hr=false}:{hr?:boolean}) {
 const items=[
  {key:'rules',title:'Unternehmensregeln',text:'Unsere Grundsätze für Zusammenarbeit, Sicherheit und Kundenbetreuung.',icon:ShieldCheck,color:'sky'},
  {key:'accesses',title:'Meine Zugänge',text:'Deine Anwendungen, Benutzernamen und der Stand der Freischaltung.',icon:KeyRound,color:'peach'},
  {key:'team',title:'Mein Team',text:'Deine Kolleginnen und Kollegen und Ansprechpartner in deiner Abteilung.',icon:Users,color:'mint'},
  {key:'tasks',title:hr?'Aufgaben & Zuständigkeiten':'Meine Aufgaben',text:hr?'Alle Onboarding-Schritte, verteilt auf HR und Systemadministration.':'Deine nächsten Schritte mit Terminen, Rückmeldungen und Fortschritt.',icon:ClipboardList,color:'lavender'}
 ];
 return <section className="workspace-areas"><div className="section-head"><div><p className="eyebrow">ALLES AN EINEM ORT</p><h2>Deine Bereiche</h2></div><span>4 Bereiche</span></div><div className="portal-grid">{items.map((item,i)=><Link to={`${hr?'/hr':'/dashboard'}/${item.key}`} className={`portal-card portal-${item.color}`} key={item.key}><div className="portal-card-top"><span className="portal-icon"><item.icon size={27}/></span><span className="portal-number">0{i+1} / 04</span></div><h3>{item.title}</h3><p>{item.text}</p><div className="portal-card-bottom"><span>Bereich öffnen</span><span className="portal-arrow"><ArrowUpRight size={20}/></span></div></Link>)}</div></section>;
}
