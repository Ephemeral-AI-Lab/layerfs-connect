import { useState } from 'react'
import { call } from '@/layerfs/client'
import { useHostQuery } from '@/layerfs/use-host'
import { exactBytes, exactCount } from '@/layerfs/exact-count'
import type { StorageReport } from '@/layerfs/host-api'
import { shortId } from '@/layerfs/format'
import { LoadError, Loading } from '@/components/layerfs/States'
import { ReuseRing, StagedStorageFlow, ratioStep } from './StagedStorageFlow'

type CanonicalReport = Omit<StorageReport, 'selection'>
export function SavedRevisionAnalysis({ project, branch, pin, size = 20 }: { project: string; branch: string; pin: string | null; size?: number }) {
  const [requested, setRequested] = useState(false)
  const q = useHostQuery(async () => {
    if (!pin || !requested) return undefined
    const result = await call<StorageReport>('GET', `/api/projects/${encodeURIComponent(project)}/storage-report?branch=${encodeURIComponent(branch)}&at=${encodeURIComponent(pin)}&size=${size}`)
    if (result.scope !== 'project' || result.project !== project) throw new Error('The analysis response does not match the requested project. Retry the analysis.')
    return result
  }, [project, branch, pin, size, requested])
  const report = q.data, busy = requested && q.loading && !!pin
  const error = busy ? undefined : q.error
  const analyze = () => { if (requested) q.reload(); else setRequested(true) }
  return <div className="storage-analysis-panel storage-efficiency-hero"><div className="real-storage-heading"><h3>From snapshots to stored data</h3><button onClick={analyze} disabled={!pin || busy}>{busy ? 'Analyzing…' : report ? 'Analyze again' : error ? 'Retry analysis' : 'Analyze revisions'}</button></div>
    <p className="real-storage-note">Project · {project}</p>
    {!requested && pin && <p className="real-storage-note">Analyze the latest {size} saved revisions when needed. Earlier history is excluded.</p>}
    {!pin && <p className="real-storage-note">No saved revisions on {branch} to analyze.</p>}
    {busy && <Loading label="Analyzing selected saved revisions" />}
    {error && <LoadError error={error} what="saved revision analysis" onRetry={analyze} />}
    {report && !busy && !error && <>
      <p className="real-storage-note">{report.snapshots.length} selected saved revisions · {branch} · pinned {pin ? shortId(pin) : 'none'}{report.selection.hasEarlier ? ' · Earlier revisions excluded' : ''} · {report.complete ? 'Complete' : 'Incomplete'}</p>
      <CanonicalReportResult report={report} />
    </>}
  </div>
}
export function CanonicalReportResult({ report }: { report: CanonicalReport }) {
  const complete = report.definition_version === 1 && report.population === 'explicit_saved_snapshots' && report.complete && report.referenced_canonical_bytes !== null && report.unique_canonical_bytes !== null
  const payload = report.payload_encoding
  const payloadComplete = complete && payload?.definition_version === 1 && payload.population === 'selected_payload_object_records' && payload.available && payload.referenced_canonical_bytes !== null && payload.unique_canonical_bytes !== null && payload.encoded_record_bytes !== null && payload.dependency_closure_included === false && payload.shared_framing_included === false
  const referenced = payloadComplete ? payload.referenced_canonical_bytes : report.referenced_canonical_bytes
  const unique = payloadComplete ? payload.unique_canonical_bytes : report.unique_canonical_bytes
  const stages = [
    { label: 'Referenced', caption: 'Across selected snapshots', value: referenced, tone: 'referenced' as const },
    { label: 'Unique data', caption: 'After deduplication', value: unique, tone: 'canonical' as const },
    ...(payloadComplete ? [{ label: 'Encoded data', caption: 'Compression + delta encoding', value: payload.encoded_record_bytes, tone: 'stored' as const }] : []),
  ]
  const steps = [ratioStep(referenced, unique, 'deduplication'), ...(payloadComplete ? [ratioStep(unique, payload.encoded_record_bytes, 'encoding')] : [])]
  return <>
      {complete ? <div className="storage-population-efficiency"><div className="storage-efficiency-summary"><div><h4>{payloadComplete ? 'Deduplication and compression' : 'Canonical deduplication'}</h4><p className="real-storage-note">{payloadComplete ? 'Selected file-data objects · WholeFile and Chunk records' : 'Selected snapshots · all canonical objects'}</p></div><ReuseRing referenced={referenced} unique={unique} /></div><StagedStorageFlow stages={stages} steps={steps} label={payloadComplete ? 'Selected snapshots deduplication and encoding' : 'Selected snapshots deduplication'} /></div> : <p className="real-storage-note" role="status">{report.reason ?? 'The requested population could not be completely measured.'} Canonical reuse totals remain unavailable.</p>}
      {payloadComplete ? <p className="real-storage-note">File-data record bytes exclude shared pack framing and external delta-base dependencies. Metadata groups and physical allocation are outside this flow.</p> : <p className="real-storage-note">{payload?.reason ?? 'Encoded bytes for this canonical population are unavailable with this LayerFS build.'}</p>}
      <details className="real-measure-details"><summary>How this analysis is measured</summary><p className="real-storage-note">Full canonical totals: {exactBytes(report.referenced_canonical_bytes)} referenced · {exactBytes(report.unique_canonical_bytes)} unique. Referenced counts each snapshot’s distinct canonical objects; unique counts their union. This comparison describes canonical reuse across the selected snapshots. Analysis is bounded to 10,000 object visits and 64 MiB of visited canonical objects.</p>
      {payloadComplete && <p className="real-storage-note">Distinct external direct delta bases: {exactCount(payload.external_direct_base_count)}. Shared group/pack framing, metadata groups and external base dependency storage are excluded from encoded record bytes.</p>}
      <p className="real-storage-note">Objects examined: {exactCount(report.examined_objects)} · Canonical bytes read: {exactBytes(report.canonical_bytes_read)}</p></details>
      <details className="real-measure-details"><summary>Analysis scope and unavailable measurements</summary><p className="real-storage-note">Physical allocation: {exactBytes(report.physical_bytes)} · Reclaimable bytes: {exactBytes(report.reclaimable_bytes)}. {report.physical_reason}</p><ul className="real-analysis-pins">{report.snapshots.map(snapshot => <li key={`${snapshot.project}:${snapshot.branch}:${snapshot.at.id}`}><span>{snapshot.project} · {snapshot.branch}</span><code title={snapshot.at.id}>{shortId(snapshot.at.id)}</code></li>)}</ul></details>
    </>
}
