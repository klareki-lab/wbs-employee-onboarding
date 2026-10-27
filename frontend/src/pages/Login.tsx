import { useState, type FormEvent } from 'react';
import { ArrowRight, LockKeyhole, Eye, EyeOff } from 'lucide-react';
import { Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { AuthLayout } from '../components/Layout';
import { InlineAlert } from '../components/UI';
import { apiMessage } from '../api/client';

export function LoginPage() {
  const { user, status, signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [query] = useSearchParams();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (status === 'authenticated' && user) return <Navigate replace to={user.role === 'hr' ? '/hr' : '/dashboard'}/>;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !username.trim() || !password) return;
    setBusy(true); setError('');
    try {
      const verified = await signIn(username.trim(), password);
      const requested = (location.state as { from?: string } | null)?.from;
      const home = verified.role === 'hr' ? '/hr' : '/dashboard';
      const next = requested && requested.startsWith(verified.role === 'hr' ? '/hr' : '/dashboard') ? requested : home;
      navigate(next, { replace: true });
    } catch (e) { setError(apiMessage(e)); }
    finally { setBusy(false); }
  }
  return <AuthLayout eyebrow="MITARBEITER-LOGIN"><div className="auth-card-icon"><LockKeyhole size={24}/></div><p className="eyebrow">SICHERER ZUGANG</p><h2>Schön, dass du da bist.</h2><p className="auth-card-subtitle">Melde dich mit deinen WBS-Zugangsdaten an.</p>
    {query.get('activated') === '1' && <InlineAlert success message="Konto aktiviert. Du kannst dich jetzt anmelden." />}
    {error && <InlineAlert message={error} />}
    {status === 'unavailable' && <InlineAlert message="Sitzungsprüfung aktuell nicht erreichbar. Die Anmeldung erfordert eine Backend-Verbindung." />}
    <form onSubmit={e => void submit(e)} className="auth-form"><div className="form-field"><label htmlFor="username">Benutzername</label><input id="username" autoComplete="username" placeholder="Dein Benutzername" required value={username} onChange={e => setUsername(e.target.value)} /></div><div className="form-field"><label htmlFor="password">Passwort</label><div className="password-field"><input id="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" placeholder="Dein Passwort" required value={password} onChange={e => setPassword(e.target.value)} /><button type="button" title={showPassword ? 'Passwort verbergen' : 'Passwort anzeigen'} aria-label={showPassword ? 'Passwort verbergen' : 'Passwort anzeigen'} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff size={19}/> : <Eye size={19}/>}</button></div></div><button disabled={busy || status === 'checking'} className="button button-primary auth-submit" type="submit">{busy ? 'Anmeldung wird geprüft …' : <>Jetzt anmelden <ArrowRight size={18}/></>}</button></form>
    <p className="auth-card-foot">Noch kein Konto? Du erhältst deinen Aktivierungslink von HR per E-Mail.</p>
  </AuthLayout>;
}
