import { useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { ArrowRight, BookOpen, Building2, ClipboardList, GraduationCap, LayoutDashboard, LogOut, Menu, Plus, ShieldCheck, Users, X } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { Brand, InlineAlert } from './UI';

export function Layout({ area }: { area: 'hr' | 'employee' }) {
  const { user, employee, signOut } = useAuth();
  const displayName = employee ? `${employee.first_name} ${employee.last_name}` : (user?.username || '');
  const initials = employee ? `${employee.first_name[0] || ''}${employee.last_name[0] || ''}` : (user?.username?.[0] || 'W').toUpperCase();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [logoutError, setLogoutError] = useState('');
  const hr = area === 'hr';
  const links = hr ? [
    { to: '/hr', label: 'Übersicht', icon: LayoutDashboard, end: true },
    { to: '/hr/new', label: 'Neuer Mitarbeiter', icon: Plus, end: false },
  ] : [
    { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, end: true },
    { to: '/dashboard/rules', label: 'Unternehmensregeln', icon: ShieldCheck, end: false },
    { to: '/dashboard/training', label: 'Mein Training', icon: GraduationCap, end: false },
    { to: '/dashboard/team', label: 'Mein Team', icon: Users, end: false },
    { to: '/dashboard/tasks', label: 'Meine Aufgaben', icon: ClipboardList, end: false },
  ];
  async function onLogout() {
    setLogoutError('');
    try { await signOut(); navigate('/login', { replace: true }); }
    catch { setLogoutError('Abmeldung nicht bestätigt. Bitte erneut versuchen.'); }
  }
  return <div className="app-shell">
    {open && <button type="button" aria-label="Menü schließen" className="mobile-scrim" onClick={() => setOpen(false)} />}
    <aside className={`sidebar ${open ? 'sidebar-open' : ''}`}>
      <div className="side-brand"><Brand /><button type="button" className="icon-button mobile-only" aria-label="Schließen" onClick={() => setOpen(false)}><X size={20} /></button></div>
      <div className="side-divider" /><div className="nav-caption">ARBEITSBEREICH</div>
      <div className="workspace"><span className="workspace-icon">{hr ? <Building2 size={19} /> : <BookOpen size={19} />}</span><div><strong>{hr ? 'HR Administration' : 'Mitarbeiterportal'}</strong><span>{hr ? 'Personal & Onboarding' : 'Dein Arbeitsbereich'}</span></div></div>
      <div className="nav-caption">NAVIGATION</div>
      <nav aria-label="Hauptnavigation" className="sidebar-nav">{links.map(({ to, label, icon: Icon, end }) =>
        <NavLink key={to} end={end} to={to} onClick={() => setOpen(false)} className={({ isActive }) => `side-link ${isActive ? 'selected' : ''}`}><Icon size={19} strokeWidth={1.8} />{label}</NavLink>
      )}</nav>
      <div className="sidebar-spacer" />
      <div className="sidebar-help"><div className="help-symbol"><ShieldCheck size={18} /></div><strong>Sicherer Onboarding-Prozess</strong><p>Alle Freigaben und Einladungen werden durch das Backend geprüft.</p></div>
      <div className="sidebar-account"><div className="account-avatar" aria-hidden="true">{initials}</div><div className="account-name"><strong>{displayName}</strong><span>{hr ? 'HR-Administrator' : 'Mitarbeiter'}</span></div><button type="button" onClick={() => void onLogout()} title="Abmelden" aria-label="Abmelden" className="logout-button"><LogOut size={19} /></button></div>
      {logoutError && <div className="side-error" role="alert">{logoutError}</div>}
    </aside>
    <div className="content-shell"><header className="topbar"><div className="topbar-left"><button type="button" className="icon-button mobile-only" aria-label="Menü öffnen" onClick={() => setOpen(true)}><Menu size={21} /></button><span className="topbar-section">{hr ? 'HR WORKSPACE' : 'EMPLOYEE WORKSPACE'}</span><span className="topbar-separator">/</span><span className="topbar-current">{hr ? 'Onboarding' : 'Mein Start'}</span></div><div className="topbar-right"><span className="topbar-privacy"><span className="privacy-dot" /> Geschützter Bereich</span><div className="topbar-avatar">{initials[0] || 'W'}</div></div></header><main className="main-content"><Outlet /></main><footer className="footer"><span>© WBS Coding School · Onboarding MVP</span><span>Version 1.0 <ArrowRight size={13} /></span></footer></div>
  </div>;
}

export function AuthLayout({ children, eyebrow }: { children: React.ReactNode; eyebrow: string }) {
  return <div className="auth-page"><div className="auth-top"><Link to="/login" className="auth-brand"><Brand /></Link><span className="auth-top-label">{eyebrow}</span></div><div className="auth-page-inner"><div className="auth-intro"><div className="hero-tag">WILLKOMMEN BEI WBS</div><h1>Dein nächster Schritt beginnt <span>hier.</span></h1><p>Ein guter Start macht den Unterschied. Alles Wichtige für deinen Einstieg an einem Ort – übersichtlich, sicher und persönlich.</p><div className="auth-feature"><ShieldCheck size={20} /><span>Geschützter Zugang für neue Mitarbeiter</span></div></div><div className="auth-card">{children}</div></div><div className="auth-bottom">© WBS Coding School <span>Onboarding Portal · MVP v1</span></div></div>;
}
export function SessionError({ retry }: { retry: () => void }) {
  return <div className="session-block"><Brand /><InlineAlert message="Die Sitzung konnte nicht überprüft werden. Bitte prüfen Sie die Backend-Verbindung." /><button className="button button-primary" type="button" onClick={retry}>Erneut versuchen</button></div>;
}
