import { useState } from 'react'
import { call } from '@/layerfs/client'
import { useHostQuery } from '@/layerfs/use-host'
import { exactBytes } from '@/layerfs/exact-count'
import type { StoreObservations as Observations } from '@/layerfs/host-api'
import { LoadError, Loading } from '@/components/layerfs/States'
import { MeasurementLine } from './RealStorageVisuals'

const date = (time: number) => new Date(time).toLocaleString()
export function StoreObservations({ name, tick }: { name: string; tick?: unknown }) {
  const q = useHostQuery(() => call<Observations>('GET', `/api/stores/${encodeURIComponent(name)}/observations`), [name, tick])
  const [identity, setIdentity] = useState<string>()
  const data = q.data
  const selected = data?.series.find(s => s.identity === identity) ?? data?.series.at(-1)
  const points = selected?.points ?? []
  const values: unknown[] = [], times: number[] = [], labels: string[] = []
  points.forEach((point, i) => {
    if (i > 0 && point.observedAt - points[i - 1].observedAt > (data?.gapAfterMs ?? 1800000)) {
      values.push(null); times.push(points[i - 1].observedAt + 1); labels.push('Observation gap')
    }
    values.push(point.stats.file); times.push(point.observedAt); labels.push(date(point.observedAt))
  })
  return <div className="storage-analysis-panel"><div className="real-storage-heading"><h3>Observed storage growth</h3>{data && data.series.length > 1 && <label className="text-xs text-muted-foreground">Store identity <select aria-label="Store observation identity" value={selected?.identity} onChange={e => setIdentity(e.target.value)}>{data.series.map(s => <option key={s.identity} value={s.identity}>{date(s.startedAt)}</option>)}</select></label>}</div>
    {q.error ? <LoadError error={q.error} what="Store allocation observations" onRetry={q.reload} /> : !data ? <Loading label="Reading Store observations" /> : points.length < 2 ? <p className="real-storage-note">{points.length === 1 ? `First measurement: ${exactBytes(points[0].stats.file)} at ${date(points[0].observedAt)}.` : 'No Store measurements recorded yet.'} Refresh later to compare actual observations.</p> : <><MeasurementLine values={values} times={times} points={labels} label="Observed Store allocation over time" /><div className="real-chart-ends"><span>{date(points[0].observedAt)}</span><span>{date(points.at(-1)!.observedAt)}</span></div></>}
    <details className="real-measure-details"><summary>About these observations</summary><p className="real-storage-note">Recorded when Connect reads Store statistics. Includes all projects and retained history. Gaps over 30 minutes and Store identity changes are not connected. No earlier disk history is inferred.</p></details>
    {points.length > 0 && <details className="real-measure-details"><summary>Inspect {points.length} observations</summary><table className="real-measure-table"><thead><tr><th>Observed at</th><th>Store allocation</th></tr></thead><tbody>{points.map((point, i) => <tr key={`${point.observedAt}:${i}`}><td>{date(point.observedAt)}</td><td>{exactBytes(point.stats.file)}</td></tr>)}</tbody></table></details>}
  </div>
}
