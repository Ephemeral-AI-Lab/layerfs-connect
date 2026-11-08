import { useRef, useState } from 'react'
import { call, host } from '@/layerfs/client'
import { historyApi } from '@/layerfs/history-api'
import { exactBytes, exactCount } from '@/layerfs/exact-count'
import { shortId } from '@/layerfs/format'
import { CodeView } from './CodeView'
import { FileDiff, type FileDiffLine } from './FileDiff'
import { FileBlame, type BlameOrigin } from './FileBlame'
import { savedOrigin as owner, comparisonBranch, type SavedOwner as Owner } from './saved-query-model'
import { FileAttributionDiff } from './FileAttributionDiff'
import { useHostQuery } from '@/layerfs/use-host'
import { LoadError, Loading } from '@/components/layerfs/States'

type Row = { op: FileDiffLine['op']; text: string; left_line?: number; right_line?: number; before_owner?: Owner; after_owner?: Owner; owner_changed?: boolean | null }
type Result = {
  items?: { ref: { id: string; branch?: string | null }; compared_to?: { id: string }; kind: string; message?: string; time_status?: string; recorded_at?: number; changes?: Record<string, boolean> }[]
  rows?: Row[]; lines?: { n: number; text: string; owner: Owner | null; clipped?: boolean }[]
  has_more?: boolean; end_of_query?: boolean; continuation?: string | null; next_line?: number | null
  coverage?: { status?: string; reasons?: string[]; comparison?: string }; comparison_coarse?: boolean
  content_coverage?: { status?: string; reasons?: string[] }; attribution_coverage?: { status?: string; reasons?: string[] }
  change_kind?: string; changes?: { content?: boolean; metadata?: boolean; identity?: boolean; attribution?: boolean }; omission_reason?: string | null; hunks_omitted?: boolean; before?: { size?: number } | null; after?: { size?: number } | null; scan?: { complete?: boolean; candidates_examined?: number; reasons?: string[] }
}

const modes = ['code', 'compare', 'attribution', 'blame', 'revisions'] as const
type Mode = typeof modes[number]
export function SavedFileExplorer({ project, branch, path, pin, onPin, initialMode = 'code', initialLeft = '', leftBranch }: { project: string; branch: string; path: string; pin?: string; onPin: (pin: string) => void; initialMode?: Mode; initialLeft?: string; leftBranch?: string }) {
  const [versionsOpen, setVersionsOpen] = useState(false)
  const [older, setOlder] = useState<string | number>(0)
  const versions = useHostQuery(() => versionsOpen ? historyApi.commits(project, branch, older, pin) : Promise.resolve(null), [project, branch, older, pin, versionsOpen])
  const [mode, setMode] = useState<Mode>(initialMode)
  const [left, setLeft] = useState(initialLeft)
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(50)
  const [tokens, setTokens] = useState<(string | undefined)[]>([undefined])
  const [line, setLine] = useState(1)
  const [traversal, setTraversal] = useState('provenance')
  const file = useHostQuery(() => host.file(project, branch, path, pin, line), [project, branch, path, pin, line])
  const retained = useRef(new Map<string, Result>())
  const resetPage = () => { setPage(1); setTokens([undefined]); setLine(1) }
  const detail = useHostQuery(async () => {
    if (!pin || mode === 'code' || ((mode === 'compare' || mode === 'attribution') && !left)) return null
    const q = new URLSearchParams({ branch, path, pin, kind: mode, size: String(size), traversal, line: String(line) })
    if (left) { q.set('left', left); q.set('rightBranch', comparisonBranch(leftBranch, branch)) }
    if (tokens[page - 1]) q.set('continuation', tokens[page - 1]!)
    else q.set('page', String(page))
    const key = q.toString()
    const cached = retained.current.get(key)
    if (cached) return cached
    const result = await call<Result>('GET', `/api/projects/${encodeURIComponent(project)}/file-query?${q}`)
    retained.current.set(key, result)
    return result
  }, [project, branch, path, pin, mode, left, leftBranch, page, size, traversal, line])
  const r = detail.loading ? undefined : detail.data
  function next() { if (r?.continuation) setTokens(t => [...t.slice(0, page), r.continuation!]); setPage(p => p + 1) }
  const inspect = (o: BlameOrigin) => { if (!o.branch) return; location.hash = `#/storage/${project}/history?branch=${encodeURIComponent(o.branch)}&commit=${o.id}` }
  const rows = (r?.rows ?? []).map(v => ({ op: v.op, text: v.text, left: v.left_line ?? null, right: v.right_line ?? null, before: owner(v.before_owner), after: owner(v.after_owner), ownerChanged: v.op === ' ' ? v.owner_changed ?? null : false }))
  return <div className="fp-explorer fp-saved">
    <div className="fp-context"><code>{path}</code> · {exactBytes(file.data?.size)} · {file.data?.at?.kind ?? 'Saved'} <code title={pin}>{shortId(pin)}</code><button type="button" onClick={() => onPin('latest')}>Latest saved</button><button type="button" aria-expanded={versionsOpen} onClick={() => setVersionsOpen(v => !v)}>Saved versions</button></div>
    {versionsOpen && <div className="fp-context">{versions.error ? <span role="alert">{versions.error.message}</span> : versions.loading ? 'Reading versions…' : versions.data?.items.map(c => <button key={c.id} onClick={() => onPin(c.id)}>{c.message || 'Saved Layer'} · {shortId(c.id)}</button>)}{versions.data?.next && <button onClick={() => setOlder(versions.data!.next!)}>Earlier versions</button>}</div>}
    <div className="fp-modes fp-toolbar" role="tablist" aria-label="Saved file views">{modes.map(m => <button type="button" role="tab" aria-selected={mode === m} key={m} onClick={() => { resetPage(); setMode(m) }}>{m[0].toUpperCase() + m.slice(1)}</button>)}</div>
    {(mode === 'compare' || mode === 'attribution') && <label className="fp-context">Compare saved id <input aria-label="Comparison saved id" placeholder="Full Commit or Layer id" value={left} onChange={e => { resetPage(); setLeft(e.target.value) }} /></label>}
    {mode === 'revisions' && <label className="fp-context">Traversal <select value={traversal} onChange={e => { resetPage(); setTraversal(e.target.value) }}><option value="provenance">Inherited provenance</option><option value="branch">This Branch</option></select></label>}
    {mode === 'code' ? file.error && 'code' in file.error && file.error.code === 'NoSuchPath' ? <p className="fp-context">This path is absent at the selected saved version.</p> : file.error ? <LoadError error={file.error} what={path} onRetry={file.reload} /> : !file.data || file.loading ? <Loading label="Reading saved file" /> : file.data.binary ? <p className="fp-context">Binary file · {exactBytes(file.data.size)}</p> : <><CodeView path={path} text={file.data.text ?? ''} />{file.data.truncated && <p className="fp-coverage">Showing a bounded text window.</p>}{file.data.line_truncated && <p className="fp-coverage">A long line was clipped.</p>}{file.data.next_line != null && <button onClick={() => setLine(file.data!.next_line!)}>Next text window</button>}</> : detail.error ? <LoadError error={detail.error} what={`${mode} of ${path}`} onRetry={detail.reload} /> : !r ? <p className="fp-context">{(mode === 'compare' || mode === 'attribution') && !left ? 'Choose a full saved id to compare with the pinned file.' : 'Reading saved query…'}</p> : <>
      {mode === 'revisions' && <div className="fp-revisions"><div className="fp-revision-list">{r.items?.map(v => <article className="fp-revision" key={v.ref.id}><div><strong>{v.message || `${v.kind} at ${shortId(v.ref.id)}`}</strong><p>{v.kind} · {v.ref.branch ?? 'Unknown branch'} · {v.recorded_at ? new Date(v.recorded_at).toLocaleString() : v.time_status ?? 'Time unavailable'}</p><button onClick={() => { onPin(v.ref.id); setMode('code') }}>Open file</button>{v.compared_to && <button onClick={() => { onPin(v.ref.id); setLeft(v.compared_to!.id); setMode('compare') }}>Compare with parent</button>}<button disabled={!v.ref.branch} onClick={() => inspect({ id: v.ref.id, branch: v.ref.branch ?? null, message: v.message ?? '' })}>Inspect checkpoint</button></div></article>)}{!r.items?.length && <p className="fp-context">No revisions in this page.</p>}</div></div>}
      {mode === 'blame' && <><FileBlame lines={(r.lines ?? []).map(v => ({ text: v.text, owner: owner(v.owner), n: v.n, clipped: v.clipped }))} onInspect={inspect} /><p className="fp-coverage">Coverage: {r.coverage?.status ?? 'unknown'}{r.comparison_coarse ? ' · comparison coarse' : ''} {r.coverage?.reasons?.join(', ')}</p>{r.next_line && <button onClick={() => setLine(r.next_line!)}>Next blame window</button>}</>}
      {(mode === 'compare' || mode === 'attribution') && <><p className="fp-coverage">{r.change_kind ?? 'Saved comparison'}{r.changes?.metadata ? ' · Metadata changed' : ''}{r.changes?.identity ? ' · Identity changed' : ''} · Content: {r.content_coverage?.status ?? 'unknown'} · Attribution: {r.attribution_coverage?.status ?? 'not requested'}{r.omission_reason ? ` · ${r.omission_reason}` : ''}{r.hunks_omitted ? ' · hunks omitted' : ''}</p>{r.omission_reason || (!rows.length && r.content_coverage?.status !== 'complete') ? <p className="fp-context">Comparison omitted: {r.omission_reason ?? r.content_coverage?.status ?? 'coverage unavailable'}</p> : mode === 'attribution' ? <FileAttributionDiff lines={rows} onInspect={inspect} /> : <FileDiff path={path} lines={rows} before={r.before ? { text: '', size: r.before.size ?? 0 } : undefined} after={r.after ? { text: '', size: r.after.size ?? 0 } : undefined} />}</>}
      {mode === 'revisions' && <p className="fp-coverage">{r.end_of_query === true ? 'End of query' : r.end_of_query === false ? 'More revisions available' : 'Query completion unavailable'} · {r.scan?.candidates_examined == null ? 'Unknown' : exactCount(r.scan.candidates_examined)} history records examined{r.scan?.complete === false ? ' · incomplete scan' : ''}</p>}
      {mode !== 'blame' && <div className="fp-pagination"><label>Per page <select aria-label="Saved query page size" value={size} onChange={e => { resetPage(); setSize(Number(e.target.value)) }}><option>10</option><option>50</option><option>100</option></select></label><span>Page {page}</span><button disabled={page === 1} onClick={() => setPage(p => p - 1)}>Previous</button><button disabled={!r.has_more} onClick={next}>Next</button></div>}
    </>}
  </div>
}
