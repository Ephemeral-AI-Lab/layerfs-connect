import { useEffect, useState } from 'react'
import { simulationEnded, simulationHost, type SimulationRun } from '@/layerfs/simulation-api'

/** Run status belongs to the simulation, including all its saved conversations. */
export function SimulationStatus({ id, shown = true }: { id: string; shown?: boolean }) {
  const [run, setRun] = useState<SimulationRun | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [stopping, setStopping] = useState(false)
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    if (!shown) return
    let disposed = false
    let timer: ReturnType<typeof setTimeout>
    async function load() {
      try {
        const next = await simulationHost.get(id)
        if (disposed) return
        setRun(next); setError(null)
        if (!simulationEnded(next.state)) timer = setTimeout(() => void load(), 1500)
      } catch (cause) {
        if (!disposed) setError(`Could not load simulation status: ${(cause as Error).message}. Retry to reconnect.`)
      }
    }
    void load()
    return () => { disposed = true; clearTimeout(timer) }
  }, [id, revision, shown])
  async function stop() {
    setStopping(true)
    try { setRun(await simulationHost.stop(id)); setRevision(current => current + 1) }
    catch (cause) { setError(`Could not stop simulation: ${(cause as Error).message}. Try Stop again.`) }
    finally { setStopping(false) }
  }
  return <div className="rounded-md border border-border px-4 py-3 text-13">
    <div className="flex flex-wrap items-center gap-2">
      <span role="status" className="min-w-0 break-words">Simulation{run?.project ? ` ${run.project}` : ''} · {run?.state ?? 'Loading…'}</span>
      {run?.progress && <span className="tabular-nums text-12 text-muted-foreground">{run.progress.completed.toLocaleString()} / {run.progress.total.toLocaleString()} commands</span>}
      {run && !simulationEnded(run.state) && <button type="button" className="ml-auto underline" disabled={stopping} onClick={() => void stop()}>{stopping ? 'Stopping…' : 'Stop simulation'}</button>}
      {error && <button type="button" className="underline" onClick={() => setRevision(current => current + 1)}>Retry status</button>}
    </div>
    {(error || run?.error) && <p role="alert" className="mt-2 text-destructive">{error || run?.error}</p>}
  </div>
}
