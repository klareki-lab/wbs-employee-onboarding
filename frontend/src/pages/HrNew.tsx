import { useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, BadgeCheck, CalendarDays, UserPlus } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { api, apiMessage, ApiError } from '../api/client';
import type { NewEmployeeRequest } from '../api/types';
import { Field, InlineAlert, PageHeader } from '../components/UI';
import { validateEmployee, type FormErrors } from '../lib/validation';

const initial: NewEmployeeRequest = { first_name: '', last_name: '', personal_email: '', department: '', role: '', start_date: '' };
const departments = ['IT', 'Marketing', 'Sales'];
export function HrNewPage() {
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState<FormErrors>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const key = useRef(crypto.randomUUID()); // UUID is an idempotency key, NEVER an invitation token.
  const navigate = useNavigate();
  function change(name: keyof NewEmployeeRequest, value: string) {
    setForm(v => ({ ...v, [name]: value }));
    setErrors(v => ({ ...v, [name]: undefined }));
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting.current) return;
    const normalized = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v.trim()])) as unknown as NewEmployeeRequest;
    const validation = validateEmployee(normalized);
    setErrors(validation);
    if (Object.keys(validation).length) return;
    submitting.current = true; setBusy(true); setError('');
    try {
      const result = await api.createOnboarding(normalized, key.current);
      if (!result?.employee_id || !result.job_id || !result.processing_status) throw new Error('Unvollständige Bestätigung vom Backend.');
      navigate(`/hr/employees/${encodeURIComponent(result.employee_id)}`, { replace: true, state: { created: true } });
    } catch (err) {
      if (err instanceof ApiError && err.fieldErrors) setErrors(err.fieldErrors as FormErrors);
      setError(apiMessage(err));
    } finally { submitting.current = false; setBusy(false); }
  }
  const fieldProps = (id: keyof NewEmployeeRequest) => ({ id, error: errors[id] });
  return <>
    <div className="back-row"><Link to="/hr" className="back-link"><ArrowLeft size={17} /> Zur Mitarbeiterübersicht</Link></div>
    <PageHeader eyebrow="PERSONALMANAGEMENT / NEUER MITARBEITER" title="Neuen Mitarbeiter anlegen" description="Erfasse die Stammdaten. Danach bereitet der Onboarding Coordinator den Einstieg vor." />
    <div className="form-layout"><form className="main-panel employee-form" onSubmit={e => void submit(e)} noValidate>
      <div className="form-section-heading"><span className="form-section-icon"><UserPlus size={20} /></span><div><h2>Persönliche Angaben</h2><p>Alle mit * markierten Felder sind erforderlich.</p></div></div>
      {error && <InlineAlert message={error} />}
      <div className="form-grid">
        <Field {...fieldProps('first_name')} label="Vorname"><input id="first_name" autoComplete="given-name" value={form.first_name} onChange={e => change('first_name', e.target.value)} aria-invalid={!!errors.first_name} aria-describedby={errors.first_name ? 'first_name-error' : undefined} placeholder="z. B. Anna" maxLength={100} required /></Field>
        <Field {...fieldProps('last_name')} label="Nachname"><input id="last_name" autoComplete="family-name" value={form.last_name} onChange={e => change('last_name', e.target.value)} aria-invalid={!!errors.last_name} aria-describedby={errors.last_name ? 'last_name-error' : undefined} placeholder="z. B. Müller" maxLength={100} required /></Field>
        <div className="full-span"><Field {...fieldProps('personal_email')} label="Persönliche E-Mail-Adresse" hint="An diese Adresse wird die Einladung gesendet, sobald HR sie freigibt."><input id="personal_email" type="email" autoComplete="email" inputMode="email" value={form.personal_email} onChange={e => change('personal_email', e.target.value)} aria-invalid={!!errors.personal_email} aria-describedby={errors.personal_email ? 'personal_email-error' : undefined} placeholder="anna.mueller@beispiel.de" maxLength={254} required /></Field></div>
      </div>
      <div className="form-rule" /><div className="form-section-heading"><span className="form-section-icon"><CalendarDays size={20} /></span><div><h2>Arbeitsplatz & Einstieg</h2><p>Diese Informationen helfen bei der Vorbereitung der benötigten Konten.</p></div></div>
      <div className="form-grid">
        <Field {...fieldProps('department')} label="Abteilung"><select id="department" value={form.department} onChange={e => change('department', e.target.value)} aria-invalid={!!errors.department} aria-describedby={errors.department ? 'department-error' : undefined} required><option value="">Abteilung wählen …</option>{departments.map(d => <option key={d} value={d}>{d}</option>)}</select></Field>
        <Field {...fieldProps('role')} label="Position"><input id="role" value={form.role} onChange={e => change('role', e.target.value)} aria-invalid={!!errors.role} aria-describedby={errors.role ? 'role-error' : undefined} placeholder="z. B. UX Designerin" maxLength={100} required /></Field>
        <Field {...fieldProps('start_date')} label="Eintrittsdatum"><input id="start_date" type="date" value={form.start_date} onChange={e => change('start_date', e.target.value)} aria-invalid={!!errors.start_date} aria-describedby={errors.start_date ? 'start_date-error' : undefined} required /></Field>
      </div>
      <div className="form-footer"><Link className="button button-secondary" to="/hr">Abbrechen</Link><button className="button button-primary" type="submit" disabled={busy}>{busy ? 'Wird übermittelt …' : <>Onboarding starten <ArrowRight size={17} /></>}</button></div>
    </form>
    <aside className="form-side"><div className="side-info-card"><span className="side-info-icon"><BadgeCheck size={22}/></span><h3>So geht es weiter</h3><div className="vertical-steps"><div><span>01</span><p><strong>Anfrage senden</strong><small>Stammdaten werden sicher an das Backend übertragen.</small></p></div><div><span>02</span><p><strong>Informationen aufbereiten</strong><small>Die Agenten ermitteln Teamleitung und benötigte Konten.</small></p></div><div><span>03</span><p><strong>HR gibt frei</strong><small>Erst nach ausdrücklicher Freigabe kann die Einladung gesendet werden.</small></p></div></div></div><div className="subtle-panel"><strong>Datenschutz</strong><p>Hier werden keine Passwörter oder Einladungs-Token erstellt.</p></div></aside></div>
  </>;
}
