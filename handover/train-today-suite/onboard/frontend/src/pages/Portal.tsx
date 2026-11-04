import { WorkspaceCards } from '../components/WorkspaceCards';
import { ShieldCheck } from 'lucide-react';
import { PageHeader } from '../components/UI';

export function DashboardPage() {
  return <>
    <PageHeader eyebrow="DEIN ARBEITSBEREICH" title="Mein Dashboard" description="Alle wichtigen Bereiche für deinen Start bei Train Today." />
    <WorkspaceCards />
    <div className="portal-bottom-note"><ShieldCheck size={18}/><span>Dein persönlicher Bereich ist nur nach erfolgreicher Anmeldung zugänglich.</span></div>
  </>;
}
