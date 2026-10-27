import { ArrowLeft, ArrowUpRight, BookOpen, ClipboardList, GraduationCap, ShieldCheck, Users, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { PageHeader } from '../components/UI';
import { t } from '../i18n/de';

type Section = 'rules' | 'training' | 'team' | 'tasks';
const modules = [
  { key: 'rules' as const, title: t.rules, description: 'Alles, was du über unsere gemeinsamen Grundsätze wissen solltest.', icon: ShieldCheck, no: '01', className: 'portal-sky' },
  { key: 'training' as const, title: t.training, description: 'Dein Einstieg, deine Lernangebote und deine Entwicklung.', icon: GraduationCap, no: '02', className: 'portal-peach' },
  { key: 'team' as const, title: t.team, description: 'Lerne die Menschen kennen, mit denen du zusammenarbeitest.', icon: Users, no: '03', className: 'portal-mint' },
  { key: 'tasks' as const, title: t.tasks, description: 'Deine nächsten Schritte und alles, was noch vor dir liegt.', icon: ClipboardList, no: '04', className: 'portal-lavender' },
];
export function DashboardPage() {
  const { employee } = useAuth();
  return <>
    <PageHeader eyebrow="DEIN ARBEITSBEREICH" title="Mein Dashboard" description="Alle wichtigen Bereiche für deinen Start bei WBS." />
    <section className="welcome-banner"><div className="welcome-content"><div className="welcome-pill"><Sparkles size={14}/> DEIN ONBOARDING</div><h2>Willkommen, {employee?.first_name}!</h2><p>Schön, dass du Teil unseres Teams bist. Hier findest du alles, was du für deinen gelungenen Einstieg brauchst.</p><div className="welcome-signature"><span className="welcome-line"/> Gemeinsam mehr bewegen.</div></div><div className="welcome-art" aria-hidden="true"><div className="art-halo"/><div className="art-circle large"><BookOpen size={62} strokeWidth={1.2}/></div><div className="art-circle small"><Sparkles size={28}/></div><div className="art-dot"/></div></section>
    <div className="section-head"><div><p className="eyebrow">ALLES AN EINEM ORT</p><h2>Deine Bereiche</h2></div><span>4 Bereiche</span></div>
    <div className="portal-grid">{modules.map(item => <Link to={`/dashboard/${item.key}`} className={`portal-card ${item.className}`} key={item.key}><div className="portal-card-top"><span className="portal-icon"><item.icon size={27} strokeWidth={1.75}/></span><span className="portal-number">{item.no} / 04</span></div><h3>{item.title}</h3><p>{item.description}</p><div className="portal-card-bottom"><span>Bereich öffnen</span><span className="portal-arrow"><ArrowUpRight size={20}/></span></div></Link>)}</div>
    <div className="portal-bottom-note"><ShieldCheck size={18}/><span>Dein persönlicher Bereich ist nur nach erfolgreicher Anmeldung zugänglich.</span></div>
  </>;
}
export function PlaceholderPage({ section }: { section: Section }) {
  const module = modules.find(m => m.key === section)!;
  const Icon = module.icon;
  return <><div className="back-row"><Link to="/dashboard" className="back-link"><ArrowLeft size={17}/> Zurück zum Dashboard</Link></div><PageHeader eyebrow="MEIN PORTAL / BEREICH" title={module.title} description="Dein persönlicher Onboarding-Bereich" /><div className="placeholder-card"><div className={`placeholder-symbol ${module.className}`}><Icon size={34} strokeWidth={1.6}/></div><p className="eyebrow">IN VORBEREITUNG</p><h2>Inhalte folgen in Kürze.</h2><p>Dieser Bereich ist bereits erreichbar. Die Inhalte werden in einer späteren Version ergänzt.</p><Link to="/dashboard" className="button button-primary"><ArrowLeft size={17}/> Zurück zum Dashboard</Link></div></>;
}
