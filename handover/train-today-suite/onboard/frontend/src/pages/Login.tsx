import { useState, type FormEvent } from 'react';
import { ArrowRight, LockKeyhole, Eye, EyeOff } from 'lucide-react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { AuthLayout } from '../components/Layout';
import { InlineAlert } from '../components/UI';
import { apiMessage } from '../api/client';
import { loginDestination, roleHome } from '../auth/routes';

export function LoginPage() {
  const { user, status, signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [query] = useSearchParams();
  const activatedUsername = (location.state as { activatedUsername?: string } | null)?.activatedUsername;
  const [username, setUsername] = useState(activatedUsername ?? '');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || status === 'checking' || !username.trim() || !password) return;
    setBusy(true); setError('');
    try {
      const verified = await signIn(username.trim(), password);
      const requested = (location.state as { from?: string } | null)?.from;
      const next = loginDestination(verified.role, requested);
      navigate(next, { replace: true });
    } catch (e) { setError(apiMessage(e)); }
    finally { setPassword(''); setBusy(false); }
  }
  return <AuthLayout eyebrow="MITARBEITER-LOGIN"><div className="auth-card-icon"><LockKeyhole size={24}/></div><p className="eyebrow">SICHERER ZUGANG</p><h2>Schön, dass du da bist.</h2><p className="auth-card-subtitle">Melde dich mit deinen Train-Today-Zugangsdaten an.</p>
    {query.get('activated') === '1' && <InlineAlert success message={activatedUsername ? `Konto aktiviert. Melde dich als ${activatedUsername} an.` : 'Konto aktiviert. Verwende den bei der Aktivierung gewählten Benutzernamen.'} />}
    {user && status === 'authenticated' && <div className="inline-alert alert-success" role="status"><div>In diesem Browserprofil als <strong>{user.username}</strong> angemeldet. Eine neue Anmeldung ersetzt diese Sitzung. Für getrennte HR- und Mitarbeiterkonten ein separates privates Fenster verwenden. <Link to={roleHome(user.role)}>Mit bestehender Sitzung fortfahren</Link></div></div>}
    {error && <InlineAlert message={error} />}
    {status === 'unavailable' && <InlineAlert message="Sitzungsprüfung aktuell nicht erreichbar. Die Anmeldung erfordert eine Backend-Verbindung." />}
    <form onSubmit={e => void submit(e)} className="auth-form"><div className="form-field"><label htmlFor="username">Benutzername</label><input id="username" autoComplete="username" placeholder="Dein Benutzername" required value={username} onChange={e => setUsername(e.target.value)} /></div><div className="form-field"><label htmlFor="password">Passwort</label><div className="password-field"><input id="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" placeholder="Dein Passwort" required value={password} onChange={e => setPassword(e.target.value)} /><button type="button" title={showPassword ? 'Passwort verbergen' : 'Passwort anzeigen'} aria-label={showPassword ? 'Passwort verbergen' : 'Passwort anzeigen'} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff size={19}/> : <Eye size={19}/>}</button></div></div><button disabled={busy || status === 'checking'} className="button button-primary auth-submit" type="submit">{busy ? 'Anmeldung wird geprüft …' : <>Jetzt anmelden <ArrowRight size={18}/></>}</button></form>
    <p className="auth-card-foot">Noch kein Konto? Du erhältst deinen Aktivierungslink von HR per E-Mail.</p>
  </AuthLayout>;
}
