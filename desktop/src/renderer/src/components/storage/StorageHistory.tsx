import { useState } from 'react'
import { call } from '@/layerfs/client'
import { useHostQuery } from '@/layerfs/use-host'
import { exactBytes, exactCount, type WireInteger } from '@/layerfs/exact-count'
import type { CommitInfo, StorageHistoryPage } from '@/layerfs/host-api'
import { shortId } from '@/layerfs/format'
import { LoadError, Loading } from '@/components/layerfs/States'
import { MeasurementLine, MeasuredValue } from './RealStorageVisuals'
import { coordinate, integer, maximum } from './measures'
import { SavedRevisionAnalysis } from './SavedRevisionAnalysis'

export function StorageHistory({ project, branches, pin }: { project: string; branches: { name: string; head: string | null }[]; pin?: string | null }) {
  const [branch, setBranch] = useState('main')
  const [size, setSize] = useState(20)
  const selectedPin = branch === 'main' ? pin : branches.find(b => b.name === branch)?.head
  return <section className="storage-project-analysis" aria-label="Project storage history">
    <div className="storage-dashboard-header"><div><h2>Project storage</h2><p className="real-storage-note">Saved revisions · {project}</p></div><div className="storage-toolbar">
      <label>Branch <select aria-label="Storage history branch" value={branch} onChange={e => setBranch(e.target.value)}>{Array.from(new Set(['main', ...branches.map(b => b.name)])).map(name => <option key={name} value={name}>{name}</option>)}</select></label>
      <select aria-label="Storage revision range" value={size} onChange={e => setSize(Number(e.target.value))}><option value={10}>Last 10 revisions</option><option value={20}>Last 20 revisions</option></select>
    </div></div>
    <MainSnapshotSummary key={`${project}:main:${pin}`} project={project} pin={pin} />
    <History key={`${project}:${branch}:${selectedPin}:${size}`} project={project} branch={branch} pin={selectedPin} size={size} />
  </section>
}
function History({ project, branch, pin, size }: { project: string; branch: string; pin?: string | null; size: number }) {
  const path = `/api/projects/${encodeURIComponent(project)}/storage-history?branch=${encodeURIComponent(branch)}&size=${size}`
  const q = useHostQuery(() => call<StorageHistoryPage>('GET', `${path}${pin ? `&at=${encodeURIComponent(pin)}` : ''}`), [project, branch, pin, size])
  const [older, setOlder] = useState<CommitInfo[]>([])
  const [next, setNext] = useState<string | null | undefined>()
  const [selected, setSelected] = useState<string>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error>()
  const page = q.data
  if (q.error) return <LoadError error={q.error} what="saved storage history" onRetry={q.reload} />
  if (!page) return <Loading label="Reading saved storage history" />
  const rows = [...new Map([...page.items, ...older].map(item => [item.id, item])).values()].reverse()
  const cursor = next === undefined ? page.next : next
  const maxAdded = maximum(rows.map(c => c.savedKind === 'commit' ? c.newStored : null))
  const active = rows.find(row => row.id === selected) ?? rows.at(-1)
  async function loadEarlier() {
    if (!cursor || loading) return
    setLoading(true); setError(undefined)
    try { const result = await call<StorageHistoryPage>('GET', `${path}&at=${encodeURIComponent(cursor)}`); setOlder(items => [...items, ...result.items]); setNext(result.next) }
    catch (e) { setError(e instanceof Error ? e : new Error(String(e))) }
    finally { setLoading(false) }
  }
  return <>
    <SavedRevisionAnalysis key={`reuse:${project}:${branch}:${page.head?.id ?? 'empty'}:${size}`} project={project} branch={branch} pin={page.head?.id ?? null} size={size} />
    <div className="storage-history-inspection-grid"><div className="storage-chart-hero"><div className="real-storage-heading"><div><h3>Saved file size</h3><p className="real-storage-note">{branch} · {rows.length} saved revisions · oldest to newest</p></div><div className="storage-latest"><span>Latest saved size</span><strong><MeasuredValue value={rows.at(-1)?.logical} bytes /></strong></div></div>
      {rows.length ? <><MeasurementLine values={rows.map(row => row.logical)} points={rows.map(row => shortId(row.id))} label="Logical snapshot size by revision, oldest to newest" selectedIndex={rows.findIndex(row => row.id === active?.id)} onSelect={index => setSelected(rows[index].id)} />
        <div className="storage-save-heading"><span>New stored bytes per Save</span><span>{rows.some(row => row.savedKind === 'commit' && integer(row.newStored) !== null) ? <>Separate scale · peak {exactBytes(maxAdded <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(maxAdded) : { $layerfs: 'i64-v1', decimal: maxAdded.toString() })}</> : 'Save additions unavailable'}</span></div>
        <div className="real-save-bars" aria-label="Save additions aligned with saved revisions">{rows.map((c, index) => {
          const available = c.savedKind === 'commit' && integer(c.newStored) !== null
          return <button aria-label={`Inspect revision ${shortId(c.id)}; new stored bytes: ${available ? exactBytes(c.newStored) : 'unavailable'}`} aria-pressed={active?.id === c.id} className="storage-save-slot" style={{ left: `${rows.length === 1 ? 50 : (8 + index / (rows.length - 1) * 584) / 6}%`, width: `min(28px, ${85 / rows.length}%)` }} key={c.id} onClick={() => setSelected(c.id)}><span className="real-save-bar" data-missing={!available} style={{ height: `${Math.max(2, (available ? coordinate(c.newStored, maxAdded) ?? 0 : 0) * 100)}%` }} /></button>
        })}</div>
        <div className="real-chart-ends"><span>{shortId(rows[0].id)}</span><span>{shortId(rows.at(-1)!.id)}</span></div>
        <p className="real-storage-note">Select a point or bar to inspect a revision. Dashed marks indicate unavailable Save additions, including publications.</p>
      </> : <p className="real-storage-note">No saved revisions on this branch.</p>}
      {error && <LoadError error={error} what="earlier storage history" onRetry={loadEarlier} />}
      {cursor && <button className="storage-load-earlier" disabled={loading} onClick={loadEarlier}>{loading ? 'Reading earlier revisions…' : 'Load earlier revisions'}</button>}
    </div>
      {active && <RevisionInspector key={`inspector:${active.id}`} project={project} branch={branch} revision={active} rows={rows} onSelect={setSelected} />}
    </div>
    {rows.length > 0 && <details className="real-measure-details"><summary>Exact measurements · {rows.length} revisions</summary><table className="real-measure-table"><thead><tr><th>Revision</th><th>Saved file size</th><th>New canonical</th><th>New stored<small>metadata included</small></th></tr></thead><tbody>{rows.map(row => <tr key={row.id}><td><button onClick={() => setSelected(row.id)} title={row.id}>{shortId(row.id)}</button><small>{row.savedKind === 'layer' ? 'Publication' : 'Commit'}</small></td><td>{exactBytes(row.logical)}</td><td>{exactBytes(row.newCanonical)}</td><td>{exactBytes(row.newStored)}<small>Metadata: {exactBytes(row.newMetadata)}</small></td></tr>)}</tbody></table></details>}
    <details className="real-measure-details"><summary>How project storage is measured</summary><p className="real-storage-note">Saved file size counts regular-file bytes per path; hard links count per path and symlinks are not followed. Counts exclude the root and uncommitted changes. Save additions include metadata and do not measure net disk growth. Revision spacing indicates order, not elapsed time. Missing measurements leave gaps. Canonical reuse analyzes the latest {size} saved revisions at the pinned head, independently of any earlier pages loaded above.</p></details>
  </>
}
interface TreeStats { projectKey: string; at: { id: string; kind: string }; files: WireInteger; directories: WireInteger; symlinks: WireInteger; others: WireInteger; logical: WireInteger; complete: boolean; reason?: string }
function RevisionInspector({ project, branch, revision, rows, onSelect }: { project: string; branch: string; revision: CommitInfo; rows: CommitInfo[]; onSelect: (id: string) => void }) {
  const q = useHostQuery(() => call<TreeStats>('GET', `/api/projects/${encodeURIComponent(project)}/stats?branch=${encodeURIComponent(branch)}&pin=${encodeURIComponent(revision.id)}`), [project, branch, revision.id])
  const s = q.data?.projectKey === project && q.data.at.id === revision.id ? q.data : undefined
  return <aside className="storage-revision-inspector" aria-label="Selected revision"><div className="real-storage-heading"><h3>Selected revision</h3><span className="storage-kind">{revision.savedKind === 'layer' ? 'Publication' : 'Commit'}</span></div>
    <select aria-label="Selected storage revision" value={revision.id} onChange={e => onSelect(e.target.value)}>{rows.map(row => <option key={row.id} value={row.id}>{shortId(row.id)}{row.id === rows.at(-1)?.id ? ' · latest' : ''}</option>)}</select>
    <p className="storage-revision-message">{revision.message || 'Saved revision'}</p><p className="real-storage-note">{branch} · {revision.at == null ? 'Save time unavailable' : new Date(revision.at).toLocaleString()}</p>
    <dl className="storage-inspector-facts"><div><dt>Saved file size</dt><dd>{exactBytes(revision.logical)}</dd></div></dl>
    {q.error ? <LoadError error={q.error} what="revision entry counts" onRetry={q.reload} /> : !s ? <Loading label="Counting saved entries" /> : <><dl className="storage-inspector-facts">{[['Files', s.files], ['Directories', s.directories], ['Symlinks', s.symlinks], ['Other entries', s.others]].map(([label, value]) => <div key={String(label)}><dt>{String(label)}</dt><dd>{exactCount(value)}</dd></div>)}</dl>{!s.complete && <p className="real-storage-note" role="status">Partial counts: {s.reason ?? 'entry budget reached'}</p>}</>}
    <div className="storage-save-facts"><h4>This Save added</h4><dl className="storage-inspector-facts"><div><dt>New unique canonical</dt><dd>{exactBytes(revision.newCanonical)}</dd></div><div><dt>Stored objects</dt><dd>{exactBytes(revision.newStored)}</dd></div><div><dt>Metadata · included above</dt><dd>{exactBytes(revision.newMetadata)}</dd></div></dl>{revision.savedKind === 'layer' && <p className="real-storage-note">Publication layers do not record Save additions.</p>}</div>
  </aside>
}

function MainSnapshotSummary({ project, pin }: { project: string; pin?: string | null }) {
  const q = useHostQuery(() => call<TreeStats>('GET', `/api/projects/${encodeURIComponent(project)}/stats?branch=main${pin ? `&pin=${encodeURIComponent(pin)}` : ''}`), [project, pin])
  const s = q.data?.projectKey === project && (!pin || q.data.at.id === pin) ? q.data : undefined
  return <section className="storage-main-summary" aria-label="Latest main snapshot">
    <div><span className="storage-main-badge">main</span><span>Latest saved snapshot</span>{s && <code title={s.at.id}>{shortId(s.at.id)}</code>}</div>
    {q.error ? <LoadError error={q.error} what="latest main snapshot" onRetry={q.reload} /> : !s ? <Loading label="Reading main snapshot" /> : <><strong><MeasuredValue value={s.logical} bytes /></strong><span>{exactCount(s.files)} files · {exactCount(s.directories)} directories{s.complete ? '' : ' · partial entry counts'}</span></>}
  </section>
}
