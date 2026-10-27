import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { Layout, SessionError } from './components/Layout';
import { CenterState } from './components/UI';
import { HrPage } from './pages/Hr';
import { HrNewPage } from './pages/HrNew';
import { HrDetailPage } from './pages/HrDetail';
import { ActivatePage } from './pages/Activate';
import { LoginPage } from './pages/Login';
import { DashboardPage, PlaceholderPage } from './pages/Portal';

function Protected({ role }: { role: 'hr' | 'employee' }) {
  const { user, status, refresh } = useAuth();
  const location = useLocation();
  if (status === 'checking') return <div className="global-state"><CenterState busy title="Sitzung wird geprüft" detail="Einen Moment bitte …" /></div>;
  if (status === 'unavailable') return <SessionError retry={() => void refresh().catch(() => undefined)} />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (user.role !== role) return <div className="global-state"><CenterState title="Keine Berechtigung" detail="Dieses Konto hat keinen Zugriff auf diesen Bereich." /></div>;
  return <Outlet />;
}
function Home() {
  const { user, status } = useAuth();
  if (status === 'checking') return <div className="global-state"><CenterState busy title="Sitzung wird geprüft" /></div>;
  if (status === 'unavailable') return <SessionError retry={() => window.location.reload()} />;
  if (!user) return <Navigate replace to="/login" />;
  return <Navigate replace to={user.role === 'hr' ? '/hr' : '/dashboard'} />;
}
export function App() {
  return <BrowserRouter><AuthProvider><Routes>
    <Route path="/" element={<Home />} />
    <Route path="/login" element={<LoginPage />} />
    <Route path="/activate" element={<ActivatePage />} />
    <Route element={<Protected role="hr" />}><Route element={<Layout area="hr" />}>
      <Route path="/hr" element={<HrPage />} />
      <Route path="/hr/new" element={<HrNewPage />} />
      <Route path="/hr/employees/:id" element={<HrDetailPage />} />
    </Route></Route>
    <Route element={<Protected role="employee" />}><Route element={<Layout area="employee" />}>
      <Route path="/dashboard" element={<DashboardPage />} />
      <Route path="/dashboard/rules" element={<PlaceholderPage section="rules" />} />
      <Route path="/dashboard/training" element={<PlaceholderPage section="training" />} />
      <Route path="/dashboard/team" element={<PlaceholderPage section="team" />} />
      <Route path="/dashboard/tasks" element={<PlaceholderPage section="tasks" />} />
    </Route></Route>
    <Route path="*" element={<div className="global-state"><CenterState title="Seite nicht gefunden" detail="Der angeforderte Bereich existiert nicht." action={<a href="/" className="button button-primary">Zur Startseite</a>} /></div>} />
  </Routes></AuthProvider></BrowserRouter>;
}
