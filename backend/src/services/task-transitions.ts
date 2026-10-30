// Pure rules. AI output cannot influence transitions, dates or approval.
export type TaskStatus = 'pending' | 'in_progress' | 'awaiting_hr' | 'completed';
export type ActorRole = 'hr' | 'employee';
export interface TaskRules {
  status: TaskStatus;
  assignee_role: ActorRole;
  needs_hr_approval: boolean;
}
export function canTransition(current: TaskRules, target: TaskStatus, actor: ActorRole): boolean {
  if (current.status === 'completed' || current.assignee_role !== actor) return false;
  if (actor === 'employee') {
    if (current.status === 'awaiting_hr') return target === 'in_progress';
    if (current.needs_hr_approval) return target === 'awaiting_hr' || target === 'in_progress';
    return target === 'in_progress' || target === 'completed';
  }
  return target === 'in_progress' || target === 'completed';
}
