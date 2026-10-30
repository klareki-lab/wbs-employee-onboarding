import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { TaskBoard } from '../components/TaskBoard';
import { PageHeader } from '../components/UI';
export function MyTasksPage() {
  const [plan, setPlan] = useState<string | null>(null);
  const [processing, setProcessing] = useState<string | null>(null);
  const [planError, setPlanError] = useState(false);
  useEffect(() => { let active = true; void api.getMyPlan().then(result => {
    if (active) { setPlan(result.personal_plan); setProcessing(result.processing_status); }
  }).catch(() => { if (active) setPlanError(true); }); return () => { active = false; }; }, []);
  return <>
    <PageHeader eyebrow="MEIN PORTAL / ONBOARDING" title="Meine Aufgaben" description="Deine nächsten Schritte und Freigaben. Aufgaben werden dauerhaft gespeichert." />
    {processing === 'failed' && <p className="phase2-demo" role="status">Der KI-Plan konnte nicht erstellt werden. Die Aufgaben bleiben erhalten und können normal bearbeitet werden.</p>}
    {planError && <p className="phase2-error" role="alert">Der KI-Plan ist derzeit nicht verfügbar. Die Checkliste wird unabhängig geladen.</p>}
    {plan && <section className="main-panel phase2-board"><div className="panel-heading"><h2>Dein persönlicher KI-Plan</h2></div><div className="phase2-inner"><p className="phase2-plan">{plan}</p><p className="phase2-demo">KI-Entwurf zur Orientierung. Die echten Aufgaben und Freigaben stehen in der Checkliste unten.</p></div></section>}
    <TaskBoard mode="employee" />
  </>;
}
