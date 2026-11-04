import { useCallback, useEffect, useState } from 'react';
import { api, apiMessage } from '../api/client';
import type { OnboardingTask, TaskListPayload } from '../api/types';

type Props = { mode: 'hr'; employeeId: string } | { mode: 'employee'; employeeId?: never };
const statusName: Record<OnboardingTask['status'], string> = {
  pending: 'Offen', in_progress: 'In Bearbeitung',
  awaiting_hr: 'HR-Freigabe erforderlich', completed: 'Erledigt',
};
const modeName: Record<OnboardingTask['execution_mode'], string> = {
  FULL_AUTOMATION: 'Automatisierung', HITL: 'Human in the Loop',
  HOTL: 'Human on the Loop', ENTIRELY_HUMAN: 'Menschlich',
};
const dateText = (value: string) => new Intl.DateTimeFormat('de-DE').format(new Date(`${value.slice(0, 10)}T12:00:00`));

export function TaskBoard(props: Props) {
  const { mode, employeeId } = props;
  const [payload, setPayload] = useState<TaskListPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const load = useCallback(async (): Promise<boolean> => {
    setBusy(true);
    try {
      const result = mode === 'hr' ? await api.getHrTasks(employeeId!) : await api.getMyTasks();
      setPayload(result);
      setError('');
      return true;
    } catch (err) { setError(apiMessage(err)); return false; }
    finally { setBusy(false); }
  }, [mode, employeeId]);
  useEffect(() => { void load(); }, [load]);

  async function change(task: OnboardingTask, status: OnboardingTask['status'] | 'approve') {
    if (processingId) return;
    setProcessingId(task.id);
    setError('');
    setNotice('');
    try {
      const result = status === 'approve'
        ? await api.approveTask(task.id, task.version)
        : mode === 'hr'
          ? await api.updateHrTask(task.id, status, task.version)
          : await api.updateMyTask(task.id, status, task.version);
      if (result.task.id !== task.id) throw new Error('Aufgabenänderung nicht bestätigt.');
      // The server, not the browser, is the source of truth after every mutation.
      if (!(await load())) throw new Error('Statusänderung möglicherweise gespeichert, aber der aktuelle Stand konnte nicht geladen werden. Bitte erneut aktualisieren.');
      setNotice(result.replayed ? 'Aufgabe war bereits in diesem Status.' : 'Status wurde im Backend gespeichert.');
    } catch (err) {
      setError(apiMessage(err));
      void load();
    } finally { setProcessingId(null); }
  }

  const tasks = payload?.tasks ?? [];
  return <section className="main-panel phase2-board" aria-label="Onboarding-Aufgaben">
    <div className="panel-heading phase2-heading"><div><h2>{mode === 'hr' ? 'Onboarding-Checkliste' : 'Meine Aufgaben'}</h2><p>Verbindliche Schritte und Zuständigkeiten; KI gibt nur Empfehlungen.</p></div><button type="button" className="button button-secondary button-sm" disabled={busy || Boolean(processingId)} onClick={() => void load()}>Aktualisieren</button></div>
    <div className="phase2-inner">
      {error && <p className="phase2-error" role="alert">{error}</p>}
      {notice && <p className="phase2-success" role="status">{notice}</p>}
      {payload && <p className="phase2-summary" role="status">{payload.summary.completed} von {payload.summary.total} Aufgaben erledigt · {payload.summary.waiting_for_hr} warten auf HR</p>}
      {payload && !payload.summary.source_verified && <p className="phase2-demo" role="note">DEMO-DATEN: Die Aufgaben sind noch nicht mit den offiziellen Train Today Checklists abgeglichen.</p>}
      {!payload && busy && <p>Aufgaben werden geladen …</p>}
      {payload && tasks.length === 0 && <p>Für diesen Bereich sind keine Aufgaben vorhanden.</p>}
      {tasks.map(task => <article className="phase2-task" key={task.id}>
        <div className="phase2-task-main">
          <div className="phase2-task-title"><span className="phase2-key">{task.template_key}</span><h3>{task.title}</h3></div>
          <p>{task.detail}</p>
          <div className="phase2-meta"><span className={`phase2-state phase2-state-${task.status}`}>{statusName[task.status]}</span><span>Frist: {dateText(task.due_date)}</span><span>Verantwortlich: {task.assignee_role === 'hr' ? 'HR' : 'Mitarbeiter'}</span><span>{modeName[task.execution_mode]}</span>{task.needs_hr_approval && <span>HR-Prüfung erforderlich</span>}</div>
        </div>
        <div className="phase2-actions">
          {task.status === 'pending' && task.assignee_role === mode && <button type="button" className="button button-secondary button-sm" disabled={Boolean(processingId)} onClick={() => void change(task, 'in_progress')}>Beginnen</button>}
          {task.status !== 'completed' && task.assignee_role === mode && task.status !== 'awaiting_hr' && !task.needs_hr_approval && <button type="button" className="button button-primary button-sm" disabled={Boolean(processingId)} onClick={() => void change(task, 'completed')}>Erledigt</button>}
          {task.assignee_role === 'employee' && mode === 'employee' && task.needs_hr_approval && (task.status === 'pending' || task.status === 'in_progress') && <button type="button" className="button button-primary button-sm" disabled={Boolean(processingId)} onClick={() => void change(task, 'awaiting_hr')}>HR-Freigabe anfragen</button>}
          {task.assignee_role === 'employee' && mode === 'employee' && task.status === 'awaiting_hr' && <button type="button" className="button button-secondary button-sm" disabled={Boolean(processingId)} onClick={() => void change(task, 'in_progress')}>Anfrage zurückziehen</button>}
          {mode === 'hr' && task.needs_hr_approval && task.status === 'awaiting_hr' && <button type="button" className="button button-primary button-sm" disabled={Boolean(processingId)} onClick={() => void change(task, 'approve')}>Als HR freigeben</button>}
        </div>
      </article>)}
    </div>
  </section>;
}
