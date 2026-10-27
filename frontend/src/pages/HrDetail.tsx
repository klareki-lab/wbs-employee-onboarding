import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useParams, Link } from 'react-router-dom';
import { ArrowLeft, BadgeCheck, CalendarDays, CheckCircle2, Mail, Send, User, Users } from 'lucide-react';
import { api, apiMessage } from '../api/client';
import type { EmployeeDetails } from '../api/types';
import { mayApprove, maySendInvitation } from '../lib/status';
import { InlineAlert, PageHeader, StatusBadge, InvitationBadge, DeliveryBadge, ProcessingBadge, CenterState } from '../components/UI';

export function HrDetailPage() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const [employee, setEmployee] = useState<EmployeeDetails | null>(null);
  const [busy, setBusy] = useState(true);
  const [mutating, setMutating] = useState(false);
  const actionLock = useRef(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(location.state?.created ? 'Anfrage vom Backend bestätigt. Aktuellen Verarbeitungsstatus beachten.' : '');
  const load = useCallback(async () => {
    if (!id) return;
    setBusy(true); setError('');
    try {
      const response = await api.getEmployee(id);
      if (!response?.id) throw new Error('Ungültige Mitarbeiterantwort.');
      setEmployee(response);
    } catch (err) { setError(apiMessage(err)); }
    finally { setBusy(false); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  async function act(type: 'approve' | 'send') {
    if (!id || !employee || actionLock.current) return;
    if (type === 'approve' && !mayApprove(employee.status, employee.processing_status)) return;
    if (type === 'send' && !maySendInvitation(employee.status)) return;
    actionLock.current = true; setMutating(true); setError(''); setNotice('');
    try {
      if (type === 'approve') {
        const result = await api.approveEmployee(id);
        if (result.employee_id !== id || result.status !== 'approved') throw new Error('HR-Freigabe vom Backend nicht bestätigt.');
      } else {
        const result = await api.sendInvitation(id);
        if (result.employee_id !== id || !result.invitation_id || !result.delivery_status) throw new Error('Einladungsauftrag nicht bestätigt.');
      }
      // Never claim that invitation was sent without fetching the authoritative new state.
      const updated = await api.getEmployee(id);
      if (!updated?.id) throw new Error('Backend hat keinen aktuellen Status geliefert.');
      setEmployee(updated);
      setNotice(type === 'approve' ? 'Freigabe bestätigt. Aktueller Status wurde geladen.' : 'Einladungsauftrag bearbeitet. SMTP-Status wurde vom Backend geladen (keine Postfachzustellung garantiert).');
    } catch (err) {
      // After an ambiguous timeout the backend might already have committed.
      // Refresh state, but preserve the original mutation error for HR.
      try { const latest = await api.getEmployee(id); if (latest?.id) setEmployee(latest); }
      catch { /* Keep the previous record and show the mutation error. */ }
      setError(apiMessage(err));
    } finally { actionLock.current = false; setMutating(false); }
  }
  if (busy && !employee) return <CenterState title="Mitarbeiter wird geladen" busy />;
  if (error && !employee) return <CenterState title="Mitarbeiter nicht verfügbar" detail={error} action={<Link to="/hr" className="button button-secondary">Zur Übersicht</Link>} />;
  if (!employee) return null;
  const fullName = `${employee.first_name} ${employee.last_name}`;
  return <>
    <div className="back-row"><Link to="/hr" className="back-link"><ArrowLeft size={17} /> Zur Mitarbeiterübersicht</Link></div>
    <PageHeader eyebrow="PERSONALMANAGEMENT / MITARBEITERDETAILS" title={fullName} description={`${employee.role} · ${employee.department}`} action={<button type="button" className="button button-secondary" disabled={busy || mutating} onClick={() => void load()}>Aktualisieren</button>} />
    {(notice || error) && <div className="detail-messages">{notice && <InlineAlert success message={notice} />}{error && <InlineAlert message={error}/>}</div>}
    <div className="detail-grid"><div className="detail-main">
      <section className="main-panel detail-card"><div className="panel-heading"><h2>Onboarding-Fortschritt</h2><StatusBadge status={employee.status}/></div><div className="detail-body"><p className="muted">Verarbeitung: <ProcessingBadge status={employee.processing_status} /></p><div className="approval-banner"><div className="approval-icon"><BadgeCheck size={24}/></div><div><h3>HR-Freigabe</h3><p>{mayApprove(employee.status, employee.processing_status) ? 'Die Onboarding-Informationen sind zur Prüfung bereit. Bitte vor der Einladung freigeben.' : maySendInvitation(employee.status) ? 'Freigabe liegt vor. Die Einladung kann jetzt angefordert werden.' : employee.processing_status === 'unavailable' ? 'n8n ist noch nicht konfiguriert. Eine HR-Freigabe ist noch nicht möglich.' : employee.processing_status === 'failed' ? 'Die Verarbeitung ist fehlgeschlagen. Bitte den Fehler im Backend untersuchen.' : employee.status === 'pending' ? 'Die Verarbeitung läuft. Freigabe erst nach abgeschlossener Verarbeitung.' : employee.status === 'active' ? 'Das Mitarbeiterkonto ist aktiviert.' : 'Aktueller Vorgang wurde durch das Backend verarbeitet.'}</p></div></div><div className="approval-actions"><button className="button button-secondary" type="button" disabled={mutating || !mayApprove(employee.status, employee.processing_status)} onClick={() => void act('approve')}><CheckCircle2 size={17} /> HR-Freigabe erteilen</button><button className="button button-primary" type="button" disabled={mutating || !maySendInvitation(employee.status)} onClick={() => void act('send')}><Send size={17}/> Einladung senden</button></div><p className="button-note">Freigabe und Versand werden serverseitig geprüft. Die Einladung wird nicht vom Browser verschickt.</p></div></section>
      <section className="main-panel detail-card"><div className="panel-heading"><h2>Onboarding-Informationen</h2></div><div className="detail-body"><div className="information-grid"><div className="info-item"><div className="info-symbol"><Users size={19}/></div><div><span>Teamleitung</span><strong>{employee.team_lead || 'Noch nicht verfügbar'}</strong></div></div><div className="info-item"><div className="info-symbol"><User size={19}/></div><div><span>Abteilung</span><strong>{employee.department}</strong></div></div></div><h3 className="subheading">Benötigte Konten</h3>{employee.necessary_accounts?.length ? <div className="account-chips">{employee.necessary_accounts.map(a => <span key={a}><CheckCircle2 size={15} />{a}</span>)}</div> : <p className="muted">Noch keine Konten vom Info Agent gemeldet.</p>}{employee.department_is_demo && <p className="muted">Abteilungsdaten sind Demo-Werte.</p>}{employee.error_code && <p className="muted">Verarbeitungsfehler: {employee.error_code}</p>}</div></section>
    </div><aside className="detail-side"><section className="main-panel detail-card"><div className="panel-heading"><h2>Stammdaten</h2></div><div className="detail-body metadata"><div><User size={17}/><span>Vollständiger Name</span><strong>{fullName}</strong></div><div><Mail size={17}/><span>Persönliche E-Mail</span><strong className="break-email">{employee.personal_email}</strong></div><div><CalendarDays size={17}/><span>Eintrittsdatum</span><strong>{new Intl.DateTimeFormat('de-DE').format(new Date(`${employee.start_date}T12:00:00`))}</strong></div><div><Send size={17}/><span>Einladungsstatus</span><InvitationBadge status={employee.invitation?.status ?? 'none'} /></div>{employee.invitation && <><div><Send size={17}/><span>Versandstatus</span><DeliveryBadge status={employee.invitation.delivery_status} /></div><div><CalendarDays size={17}/><span>Gültig bis</span><strong>{new Date(employee.invitation.expires_at).toLocaleString('de-DE')}</strong></div></>}</div></section><section className="subtle-panel"><strong>Einladung & Aktivierung</strong><p>Einladungs-Token und Passwort werden ausschließlich durch das Backend verarbeitet.</p></section></aside></div>
  </>;
}
