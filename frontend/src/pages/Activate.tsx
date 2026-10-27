import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, CheckCircle2, Eye, EyeOff, KeyRound, LockKeyhole } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { api, apiMessage, ApiError } from '../api/client';
import type { InvitationValidation } from '../api/types';
import { AuthLayout } from '../components/Layout';
import { CenterState, InlineAlert } from '../components/UI';
import { validateActivation } from '../lib/validation';

// A one-time in-memory buffer also tolerates React StrictMode's development double-render.
let initialToken = '';
function takeTokenFromFragment(): string {
  const hash = window.location.hash;
  const token = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash).get('token');
  if (token) {
    initialToken = token;
    window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
  }
  return initialToken;
}
function invitationInvalid(e: unknown): boolean {
  return e instanceof ApiError && e.status === 410 && e.code === 'INVITATION_INVALID';
}
export function ActivatePage() {
  // The invitation secret only exists in component memory, never localStorage/sessionStorage.
  const token = useRef(takeTokenFromFragment());
  const [validation, setValidation] = useState<InvitationValidation | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [checking, setChecking] = useState(true);
  const [networkError, setNetworkError] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submissionError, setSubmissionError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const sending = useRef(false);
  const navigate = useNavigate();

  async function validate() {
    if (!token.current) { setInvalid(true); setChecking(false); return; }
    setChecking(true); setNetworkError('');
    try {
      const result = await api.validateInvitation(token.current);
      if (!result?.first_name || !result?.last_name || !result.expires_at) throw new Error('Einladungsdaten unvollständig.');
      setValidation(result); setInvalid(false);
    } catch (e) {
      if (invitationInvalid(e)) { setInvalid(true); token.current = ''; initialToken = ''; }
      else setNetworkError(apiMessage(e));
    } finally { setChecking(false); }
  }
  useEffect(() => { void validate(); /* validation only on initial invitation */ // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (sending.current || !validation || invalid) return;
    const normalizedUsername = username.trim().toLowerCase();
    const found = validateActivation(normalizedUsername, password, confirmation);
    setErrors(found);
    if (Object.keys(found).length) return;
    sending.current = true; setBusy(true); setSubmissionError('');
    try {
      const result = await api.activate({ token: token.current, username: normalizedUsername, password });
      if (!result?.id || result.role !== 'employee' || result.username !== normalizedUsername || !result.employee_id) throw new Error('Backend hat die Aktivierung nicht bestätigt.');
      token.current = ''; initialToken = '';
      setPassword(''); setConfirmation('');
      navigate('/login?activated=1', { replace: true });
    } catch (err) {
      if (invitationInvalid(err)) { setInvalid(true); setValidation(null); token.current = ''; initialToken = ''; }
      else if (err instanceof ApiError && err.fieldErrors) { setErrors(err.fieldErrors); setSubmissionError(err.message); }
      else setSubmissionError(apiMessage(err));
    } finally { sending.current = false; setBusy(false); }
  }
  return <AuthLayout eyebrow="KONTOAKTIVIERUNG">
    {checking ? <CenterState busy title="Einladung wird geprüft" detail="Dein Link wird vom Backend validiert." /> : networkError ? <><CenterState title="Validierung nicht verfügbar" detail={networkError} action={<button className="button button-secondary" type="button" onClick={() => void validate()}>Erneut versuchen</button>} /></> : !validation || invalid ? <><div className="auth-card-icon muted-icon"><KeyRound size={24}/></div><h2>Einladung ungültig oder nicht mehr nutzbar</h2><p className="auth-card-subtitle">Der Link ist ungültig, abgelaufen oder bereits verwendet. Bitte wende dich an HR.</p><Link className="button button-secondary auth-submit" to="/login">Zur Anmeldung <ArrowRight size={17}/></Link></> : <>
      <div className="auth-card-icon"><CheckCircle2 size={25}/></div><p className="eyebrow">EINLADUNG BESTÄTIGT</p><h2>Hallo {validation.first_name}!</h2><p className="auth-card-subtitle">Deine Einladung ist gültig. Erstelle jetzt deine Zugangsdaten für das Mitarbeiterportal.</p>
      {submissionError && <InlineAlert message={submissionError} />}
      <form className="auth-form" noValidate onSubmit={e => void submit(e)}>
        <div className="form-field"><label htmlFor="activation_username">Benutzername *</label><input id="activation_username" autoComplete="username" value={username} onChange={e => { setUsername(e.target.value.toLowerCase()); setErrors(v => ({ ...v, username: '' })); }} aria-invalid={!!errors.username} aria-describedby={errors.username ? 'activation_username-error' : undefined} placeholder="z. B. anna.mueller" required />{errors.username ? <p id="activation_username-error" className="field-error">{errors.username}</p> : <p className="field-hint">3–64 Zeichen, Kleinbuchstaben, Zahlen, Punkt, _ oder -; erstes Zeichen: Buchstabe/Zahl</p>}</div>
        <div className="form-field"><label htmlFor="activation_password">Passwort *</label><div className="password-field"><input id="activation_password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} aria-invalid={!!errors.password} aria-describedby={errors.password ? 'activation_password-error' : undefined} placeholder="Mindestens 12 Zeichen" required /><button type="button" aria-label={showPassword ? 'Passwort verbergen' : 'Passwort anzeigen'} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff size={18}/> : <Eye size={18}/>}</button></div>{errors.password && <p id="activation_password-error" className="field-error">{errors.password}</p>}</div>
        <div className="form-field"><label htmlFor="activation_confirmation">Passwort bestätigen *</label><div className="password-field"><input id="activation_confirmation" type="password" autoComplete="new-password" value={confirmation} onChange={e => setConfirmation(e.target.value)} aria-invalid={!!errors.confirmation} aria-describedby={errors.confirmation ? 'activation_confirmation-error' : undefined} placeholder="Passwort wiederholen" required /><LockKeyhole size={18} className="password-icon" /></div>{errors.confirmation && <p id="activation_confirmation-error" className="field-error">{errors.confirmation}</p>}</div>
        <button type="submit" disabled={busy} className="button button-primary auth-submit">{busy ? 'Aktivierung läuft …' : <>Konto aktivieren <ArrowRight size={18}/></>}</button>
      </form><p className="auth-card-foot">Deine Zugangsdaten werden verschlüsselt an den Server übertragen. Das Passwort wird nicht im Browser gespeichert.</p>
    </>}
  </AuthLayout>;
}
