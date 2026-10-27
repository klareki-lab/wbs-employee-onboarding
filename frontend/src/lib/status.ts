import type { EmployeeStatus, ProcessingStatus, InvitationStatus, DeliveryStatus } from '../api/types';
export const onboardingLabels: Record<EmployeeStatus, string> = {
  pending: 'Freigabe ausstehend', approved: 'HR-Freigabe erteilt', active: 'Aktiviert',
};
export const processingLabels: Record<ProcessingStatus, string> = {
  unavailable: 'n8n nicht eingerichtet', queued: 'In Warteschlange',
  dispatching: 'Wird an n8n gesendet', awaiting_result: 'Wartet auf Agenten',
  completed: 'Verarbeitung abgeschlossen', failed: 'Verarbeitung fehlgeschlagen',
};
export const invitationLabels: Record<InvitationStatus | 'none', string> = {
  none: 'Keine Einladung', pending: 'Ausstehend', used: 'Verwendet',
  revoked: 'Widerrufen', expired: 'Abgelaufen',
};
export const deliveryLabels: Record<DeliveryStatus, string> = {
  sending: 'Versand in Bearbeitung', smtp_accepted: 'Von SMTP angenommen',
  unknown: 'Versand unklar', failed: 'Versand fehlgeschlagen',
};
export const statusTone: Record<EmployeeStatus, string> = {
  pending: 'amber', approved: 'blue', active: 'green',
};
export const processingTone: Record<ProcessingStatus, string> = {
  unavailable: 'slate', queued: 'blue', dispatching: 'blue', awaiting_result: 'amber',
  completed: 'green', failed: 'red',
};
export function hasHrApproval(status: EmployeeStatus): boolean { return status === 'approved' || status === 'active'; }
export function mayApprove(status: EmployeeStatus, processing: ProcessingStatus): boolean {
  return status === 'pending' && processing === 'completed';
}
export function maySendInvitation(status: EmployeeStatus): boolean { return status === 'approved'; }
