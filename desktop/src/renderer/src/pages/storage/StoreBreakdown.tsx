import { useState } from 'react'
import { connectBridge } from '@/layerfs/bridge'
import { StoreBreakdownSample } from './StoreBreakdownSample'
import { call } from '@/layerfs/client'
import { useHostQuery } from '@/layerfs/use-host'
import { exactBytes, exactCount, safeEncodingRatio, type WireInteger } from '@/layerfs/exact-count'
import { LoadError, Loading } from '@/components/layerfs/States'
export interface StoreCounters {
  name: string; kind: string; history_logical: WireInteger; canonical: WireInteger; stored: WireInteger; metadata: WireInteger; file: WireInteger; free: WireInteger | null
  init: { files: WireInteger; bytes: WireInteger; stored: WireInteger; millis: WireInteger } | null
}
export function StoreBreakdown({ name, postgresql, tick = 0 }: { name: string; postgresql: boolean; tick?: unknown }) {
  const [sample, setSample] = useState(false)
  const available = import.meta.env.DEV && connectBridge.mode === 'sim'
  const q = useHostQuery(() => call<StoreCounters>('GET', `/api/stores/${encodeURIComponent(name)}/stats`), [name, tick])
  const s = q.data
  const ratio = s ? safeEncodingRatio(s.canonical, s.stored) : null
  if (sample && available) return <><button onClick={() => setSample(false)}>Back to CLI measurements</button><StoreBreakdownSample postgresql={postgresql} /></>
  return <section className="store-breakdown" aria-label="Store storage breakdown"><div className="store-section-heading"><h2>Storage breakdown</h2><div className="store-breakdown-controls">{available && <button onClick={() => setSample(true)}>Open labelled design preview</button>}<button onClick={q.reload}>Refresh</button></div></div>
    {q.error ? <LoadError error={q.error} what="Store counters" onRetry={q.reload} /> : !s ? <Loading label="Reading Store counters" /> : <>
      <dl className="store-detail-facts">{[['History logical', s.history_logical], ['Canonical objects', s.canonical], ['Stored objects', s.stored], ['Metadata', s.metadata], [postgresql ? 'Store allocation' : 'Database pages including WAL', s.file], ['Free pages', s.free]].map(([label, value]) => <div key={String(label)}><dt>{String(label)}</dt><dd>{value == null ? 'Not available' : exactBytes(value)}</dd></div>)}</dl>
      {ratio && <p className="store-breakdown-note">Canonical / stored: {ratio}× encoding ratio.</p>}
      {s.init && <p className="store-breakdown-note">From Init: {exactCount(s.init.files)} files · {exactBytes(s.init.bytes)}</p>}
      <p className="store-breakdown-note">Store-wide counters across all projects. History logical counts Commit and Layer records; it is not a deduplication numerator. Counters have distinct definitions and must not be added together. File allocation includes database pages and WAL.{postgresql ? ' PostgreSQL free pages are unavailable.' : ''}</p>
    </>}
  </section>
}
