import { simulationEnded } from '@/layerfs/simulation-api'
import type { useSimulationLaunch } from './use-simulation'

export function SimulationLaunchStatus({ launch }: { launch: ReturnType<typeof useSimulationLaunch> }) {
  const { run } = launch
  return <>
    {(launch.creating || run) && <div role="status" className="mt-2 flex flex-wrap items-center gap-2 px-1 text-12 text-muted-foreground">
      <span>{run ? `Simulation ${run.project ?? run.id} · ${run.state}` : 'Preparing simulation…'}</span>
      {run && !simulationEnded(run.state) && <button type="button" className="underline" disabled={launch.stopping} onClick={() => void launch.stop()}>{launch.stopping ? 'Stopping…' : 'Stop'}</button>}
      {run && !launch.polling && <button type="button" className="underline" onClick={launch.resume}>Resume status</button>}
    </div>}
    {(launch.error || run?.error) && <p role="alert" className="mt-2 px-1 text-12 text-destructive">{launch.error || run?.error}</p>}
  </>
}
