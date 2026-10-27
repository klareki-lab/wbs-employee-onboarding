import { AlertCircle, CheckCircle2, LoaderCircle, ArrowRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { EmployeeStatus, ProcessingStatus, InvitationStatus, DeliveryStatus } from '../api/types';
import { onboardingLabels, invitationLabels, statusTone, processingLabels, processingTone, deliveryLabels } from '../lib/status';

export function Brand({ compact = false }: { compact?: boolean }) {
  return <div className="brand-lockup"><span className="brand-mark" aria-hidden="true">W<span>.</span></span>{!compact && <span className="brand-type"><strong>WBS <em>Onboarding</em></strong><small>EMPLOYEE EXPERIENCE</small></span>}</div>;
}
export function StatusBadge({ status }: { status: EmployeeStatus }) {
  const label = onboardingLabels[status] ?? 'Unbekannter Status';
  const tone = statusTone[status] ?? 'slate';
  return <span className={`status status-${tone}`}><span className="status-dot" />{label}</span>;
}
export function InvitationBadge({ status }: { status: InvitationStatus | 'none' }) {
  const tone = status === 'used' ? 'green' : status === 'expired' || status === 'revoked' ? 'red' : status === 'pending' ? 'amber' : 'slate';
  return <span className={`status status-${tone}`}><span className="status-dot" />{invitationLabels[status] ?? 'Unbekannter Status'}</span>;
}
export function ProcessingBadge({ status }: { status: ProcessingStatus }) {
  return <span className={`status status-${processingTone[status] || 'slate'}`}><span className="status-dot" />{processingLabels[status] ?? 'Unbekannter Status'}</span>;
}
export function DeliveryBadge({ status }: { status: DeliveryStatus }) {
  const tone = status === 'smtp_accepted' ? 'green' : status === 'failed' || status === 'unknown' ? 'red' : 'amber';
  return <span className={`status status-${tone}`}><span className="status-dot" />{deliveryLabels[status] ?? 'Unbekannter Status'}</span>;
}
export function InlineAlert({ message, success = false }: { message: string; success?: boolean }) {
  return <div role={success ? 'status' : 'alert'} className={`inline-alert ${success ? 'alert-success' : 'alert-error'}`}>
    {success ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}<span>{message}</span>
  </div>;
}
export function CenterState({ title, detail, action, busy = false }: { title: string; detail?: string; action?: ReactNode; busy?: boolean }) {
  return <div className="center-state" role={busy ? 'status' : undefined}>
    <div className="state-icon">{busy ? <LoaderCircle size={24} className="spin" /> : <AlertCircle size={24} />}</div>
    <h2>{title}</h2>{detail && <p>{detail}</p>}{action && <div className="state-action">{action}</div>}
  </div>;
}
export function PageHeader({ eyebrow, title, description, action }: { eyebrow: string; title: string; description?: string; action?: ReactNode }) {
  return <header className="page-header"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1>{description && <p className="page-subtitle">{description}</p>}</div>{action && <div className="header-action">{action}</div>}</header>;
}
export function Field({ id, label, error, children, hint }: { id: string; label: string; error?: string; children: ReactNode; hint?: string }) {
  return <div className={`form-field ${error ? 'field-invalid' : ''}`}><label htmlFor={id}>{label}<span aria-hidden="true" className="required-star"> *</span></label>{children}{hint && !error && <p className="field-hint">{hint}</p>}{error && <p id={`${id}-error`} className="field-error">{error}</p>}</div>;
}
export function TextLink({ to, children }: { to: string; children: ReactNode }) {
  return <Link className="text-link" to={to}>{children}<ArrowRight size={15} /></Link>;
}
