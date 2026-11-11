import { call } from '@/layerfs/client'
import { useHostQuery } from '@/layerfs/use-host'
import { exactBytes, exactCount, type WireInteger } from '@/layerfs/exact-count'
import { LoadError, Loading } from '@/components/layerfs/States'
import { AllocationComposition, EncodingRibbon, FileLengthBars, type Allocation, type FileMeasurements } from '@/components/storage/RealStorageVisuals'
import { StoreObservations } from '@/components/storage/StoreObservations'
import { StoreSnapshotAnalysis } from '@/components/storage/StoreSnapshotAnalysis'
export interface StoreCounters extends Allocation {
  name: string; kind: string; history_logical: WireInteger; canonical: WireInteger; stored: WireInteger; metadata: WireInteger; file: WireInteger; free: WireInteger | null
  init: { files: WireInteger; bytes: WireInteger; stored: WireInteger; millis: WireInteger } | null
  observationError?: string
  fileMeasurements?: FileMeasurements | null
  fileMeasurementError?: string
}
export function StoreBreakdown({ name, postgresql, tick = 0, analysisProjects }: { name: string; postgresql: boolean; tick?: unknown; analysisProjects?: string[] }) {
  const q = useHostQuery(() => call<StoreCounters>('GET', `/api/stores/${encodeURIComponent(name)}/stats`), [name, tick])
  const s = q.data?.name === name ? q.data : undefined
  return <section className="storage-dashboard storage-store-analysis" aria-label="Store storage breakdown"><div className="storage-dashboard-header"><div><h2>Store storage</h2><p className="real-storage-note">Entire Store · {name} · all projects and retained history</p></div><button onClick={q.reload} disabled={q.loading}>{q.loading ? 'Refreshing…' : 'Refresh'}</button></div>
    {q.error ? <LoadError error={q.error} what="Store counters" onRetry={q.reload} /> : !s ? <Loading label="Reading Store counters" /> : <>
      <div className="storage-chart-hero storage-encoding-hero"><h3>From objects to database pages</h3><EncodingRibbon canonical={s.canonical} stored={s.stored} allocation={s.file} /><p className="real-storage-note">Encoded packs include metadata packs. Database pages also include overhead and free/slack; file lengths are observed separately below.</p></div>
      <div className="storage-allocation-panel"><AllocationComposition stats={s} postgresql={postgresql} />
        {!postgresql && <FileLengthBars measurement={s.fileMeasurements} error={s.fileMeasurementError} />}</div>
      {s.observationError && <p className="real-storage-note" role="status">These counters loaded, but the observation could not be saved: {s.observationError}. Refresh to retry recording.</p>}
      <div className="storage-support-grid"><StoreObservations key={`observations:${name}`} name={name} tick={q.observedAt} />
        {analysisProjects !== undefined && <StoreSnapshotAnalysis key={`analysis:${name}`} name={name} projects={analysisProjects} />}</div>
      <details className="real-measure-details"><summary>Exact Store measurements</summary><dl className="store-detail-facts">{[['History logical', s.history_logical], ['Canonical objects', s.canonical], ['Stored objects', s.stored], ['Metadata · including overhead', s.metadata], [postgresql ? 'Store allocation' : 'Database pages including WAL', s.file], ['Free pages', s.free]].map(([label, value]) => <div key={String(label)}><dt>{String(label)}</dt><dd>{value == null ? 'Not available' : exactBytes(value)}</dd></div>)}</dl>
        {s.init && <p className="real-storage-note">From Init: {exactCount(s.init.files)} files · {exactBytes(s.init.bytes)}</p>}</details>
      <details className="real-measure-details"><summary>How Store storage is measured</summary><p className="real-storage-note">Store-wide counters include all projects and retained history. History logical counts Commit and Layer records; it is not a deduplication numerator. Counters have distinct definitions and must not be added together. Database allocation includes pages represented in WAL; separately observed file lengths are not additional page allocation.{postgresql ? ' PostgreSQL free pages are unavailable.' : ''}</p></details>
    </>}
  </section>
}
