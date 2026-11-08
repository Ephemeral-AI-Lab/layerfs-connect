import { ArrowUpRight, ChevronDown, ChevronRight, GitBranch, LoaderCircle, RefreshCw, Search, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { exactBytes } from '@/layerfs/exact-count'
import type { CommitInfo } from '@/layerfs/host-api'
import { historyApi } from '@/layerfs/history-api'
import { branchLanes, graphNodes, layoutNodes, type BranchPage, type HistoryBranch, type Source } from './model'
import { HistoryPreview } from './HistoryPreview'
import { connectBridge } from '@/layerfs/bridge'
import { HistoryComparison } from './HistoryComparison'
import { HistoryGraph } from './HistoryGraph'
import './history.css'

type View = { query: string; branch: string; selected: string | null; expanded: Set<string>; families: Set<string>; sides: Map<string, number>; top: number; left: number }
const saved = new Map<string, View>()
const short = (id: string) => id.slice(0, 10)
const newView = (): View => ({ query: '', branch: '', selected: null, expanded: new Set(), families: new Set(), sides: new Map(), top: 0, left: -1 })

export interface HistoryTrace {
  sources: Map<string, Source>
  findSource: (commit: string, signal: AbortSignal) => Promise<Map<string, Source>>
  href: (source: Source) => string
  childId?: string
  revision: unknown
  earlier: number
  loadEarlier: () => Promise<void>
  loadingOlder: boolean
  error: string | null
}
const noSources = new Map<string, Source>()

interface ProjectHistoryProps {
  project: string; viewKey?: string; trace?: HistoryTrace; example?: boolean; tick?: number
}
export function ProjectHistory(props: ProjectHistoryProps) {
  const location = useLocation()
  const [sample, setSample] = useState(false)
  const available = import.meta.env.DEV && connectBridge.mode === 'sim' && props.project === 'shop/api' && !props.trace
  if (available && sample) return <HistoryPreview project={props.project} onExit={() => setSample(false)} />
  return <>{available && <div className="fp-preview-notice"><span>Browsing simulated CLI history</span><button onClick={() => setSample(true)}>Open labelled design preview</button></div>}{location.pathname.endsWith('/diff') ? <HistoryComparison project={props.project} /> : <HostProjectHistory {...props} />}</>
}

function HostProjectHistory({ project, viewKey = project, trace, example = false, tick = 0 }: ProjectHistoryProps) {
  const key = `graph:${viewKey}`
  const childId = trace?.childId
  const [params, setParams] = useSearchParams()
  const focusCommit = params.get('commit')
  const focusCall = params.get('call')
  const focusBranch = params.get('branch')
  const [view, setView] = useState<View>(() => saved.get(key) ?? newView())
  const viewRef = useRef(view); viewRef.current = view
  const viewport = useRef({ top: view.top, left: view.left })
  const [branches, setBranches] = useState<HistoryBranch[]>([])
  const [branchNext, setBranchNext] = useState<number | null>(null)
  const [pages, setPages] = useState<Record<string, BranchPage>>({})
  const [busy, setBusy] = useState<string | null>('initial')
  const [error, setError] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  const [detail, setDetail] = useState<{ item: CommitInfo; changes: CommitInfo['changes'] | null; nextChanges: string | null } | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [linkedSources, setLinkedSources] = useState(new Map<string, Source>())
  const [finding, setFinding] = useState(false)
  const [sourceError, setSourceError] = useState<string | null>(null)
  const sources = useMemo(() => new Map([...linkedSources, ...(trace?.sources ?? noSources)]), [trace?.sources, linkedSources])
  const [branchesOpen, setBranchesOpen] = useState(false)
  const [mapReset, setMapReset] = useState(0)
  const writeView = (patch: Partial<View>) => setView(v => ({ ...v, ...patch }))
  function clearLinkFocus() {
    if (!focusCommit && !focusCall && !focusBranch) return
    const next = new URLSearchParams(params)
    next.delete('commit'); next.delete('call'); next.delete('branch')
    setParams(next, { replace: true })
  }

  useEffect(() => () => {
    if (saved.size > 40) saved.delete(saved.keys().next().value!)
    saved.set(key, { ...viewRef.current, ...viewport.current })
  }, [key])

  useEffect(() => {
    let live = true
    setBusy('initial'); setError(null)
    void historyApi.branches(project).then(async result => {
      if (!live) return
      while (focusBranch && !result.branches.some(b => b.name === focusBranch) && result.next !== null) {
        const more = await historyApi.branches(project, result.next)
        if (!live) return
        result.branches.push(...more.branches); result.next = more.next
      }
      setBranches(result.branches); setBranchNext(result.next)
      const names = result.branches.slice(0, 8)
      const loaded: Record<string, BranchPage> = {}
      // Bound concurrent Store reads, irrespective of the number of forks.
      for (let i = 0; i < names.length; i += 4) {
        const results = await Promise.allSettled(names.slice(i, i + 4).map(async b => [b.name, await historyApi.commits(project, b.name)] as const))
        for (const r of results) {
          if (r.status === 'fulfilled') loaded[r.value[0]] = r.value[1]
          else if (live) setError(String(r.reason?.message ?? r.reason))
        }
      }
      if (live) setPages(loaded)
    }).catch(e => live && setError(e.message)).finally(() => live && setBusy(null))
    return () => { live = false }
  }, [project, revision, tick])

  async function loadBranch(name: string, more = false) {
    if (busy) return
    setBusy(name); setError(null)
    try {
      const previous = pages[name]
      const next = await historyApi.commits(project, name, more ? previous?.next ?? 0 : 0, more ? previous?.head ?? undefined : undefined)
      setPages(p => ({ ...p, [name]: { ...next, items: more ? [...new Map([...previous.items, ...next.items].map(c => [c.id, c])).values()] : next.items } }))
    } catch (e) { setError((e as Error).message) } finally { setBusy(null) }
  }

  const structure = useMemo(() => branchLanes(branches, pages, busy === 'initial' ? new Map(view.sides) : view.sides), [branches, pages, view.sides, busy === 'initial'])
  const parents = structure.parents
  // A collapsed family hides descendants, never its own fork/head or the selected branch's ancestry.
  const forced = new Set<string>()
  for (let b: string | null = focusBranch ?? view.branch; b && !forced.has(b); b = parents.get(b) ?? null) forced.add(b)
  const visibleBranches = branches.filter(b => {
    const seen = new Set<string>([b.name])
    let p = parents.get(b.name)
    while (p && p !== 'main' && !seen.has(p)) {
      if (view.families.has(p) && !forced.has(b.name)) return false
      seen.add(p); p = parents.get(p)
    }
    return true
  })
  const nodes = graphNodes(visibleBranches, pages, sources, view.expanded, view.selected)
  const layout = layoutNodes(nodes, structure.lanes)
  const selected = layout.points.get(view.selected ?? '')
  const selectedCommit = selected?.commits.find(c => c.id === view.selected) ?? selected?.commits.at(-1)
  const source = sources.get(selectedCommit?.id ?? view.selected ?? '')
  const callCommits = new Set([...sources].filter(([, s]) => (s.row.callId ?? s.row.id) === focusCall && s.child === childId).map(([id]) => id))

  useEffect(() => {
    if (!focusCommit && !focusCall) return
    const s = [...sources].find(([id, s]) => id === focusCommit || (s.row.callId ?? s.row.id) === focusCall)?.[0]
    if (focusCommit || s) writeView({ selected: focusCommit ?? s!, branch: focusBranch ?? viewRef.current.branch })
  }, [focusCommit, focusCall, focusBranch, trace?.revision]) // Sources arrive with the trace page.

  // Resolve linked commits outside the first metadata page without asking the user to page manually.
  useEffect(() => {
    if (!focusCommit || !focusBranch || busy || layout.points.has(focusCommit)) return
    let live = true
    void historyApi.detail(project, focusBranch, focusCommit).then(result => {
      if (!live) return
      setPages(p => ({ ...p, [focusBranch]: { ...(p[focusBranch] ?? { next: null, head: null }), items: [...new Map([...(p[focusBranch]?.items ?? []), result.item].map(c => [c.id, c])).values()] } }))
      writeView({ branch: focusBranch, selected: focusCommit })
    }).catch(e => live && setError(`Linked checkpoint could not load: ${e.message}`))
    return () => { live = false }
  }, [focusCommit, focusBranch, busy, project])

  useEffect(() => {
    setDetail(null); setDetailError(null)
    if (!selectedCommit) return
    let live = true
    void historyApi.detail(project, selectedCommit.branch, selectedCommit.id, selected?.kind === 'group' ? selected.commits[0].parent ?? undefined : undefined).then(r => live && setDetail(r)).catch(e => live && setDetailError(e.message))
    return () => { live = false }
  }, [project, selectedCommit?.id, selected?.kind, selected?.id])

  // Trace lookup is provided only by the chat wrapper.
  useEffect(() => {
    setSourceError(null)
    if (!selectedCommit || source || !trace) return
    let live = true
    setFinding(true)
    const controller = new AbortController()
    void trace.findSource(selectedCommit.id, controller.signal).then(found => {
      if (live) setLinkedSources(old => new Map([...old, ...found]))
    }).catch(e => live && setSourceError(e.message)).finally(() => live && setFinding(false))
    return () => { live = false; controller.abort(); setFinding(false) }
  }, [selectedCommit?.id, source?.row.id, trace?.revision, trace?.findSource])

  const filtered = branches.filter(b => b.name.toLowerCase().includes(view.query.toLowerCase()))
  function select(id: string, branch: string) { clearLinkFocus(); writeView({ selected: id, branch }) }
  function toggleFamily(name: string) {
    clearLinkFocus()
    const families = new Set(view.families); if (families.has(name)) families.delete(name); else families.add(name)
    writeView({ families, branch: '', selected: null })
  }
  const loaded = Object.values(pages).reduce((sum, p) => sum + p.items.length, 0)
  const openBranch = (name: string) => {
    const b = branches.find(b => b.name === name)
    clearLinkFocus(); writeView({ branch: name, selected: b?.head ?? `branch:${name}` })
    setBranchesOpen(false)
    if (!pages[name]) void loadBranch(name)
  }
  const inspector = selected ? (
      <aside className="history-detail" aria-label="Checkpoint details"><button className="history-inspector-close" aria-label="Close checkpoint details" onClick={() => { clearLinkFocus(); writeView({ selected: null, branch: '' }) }}><X size={15} /></button>
        {!selected ? <><h3>Explore history</h3><p>Select a checkpoint or a group to inspect it.</p><p>Fork and merge endpoints stay visible when checkpoints are collapsed.</p></> : <>
          <span className="history-eyebrow">{selected.kind === 'group' ? 'Checkpoint group' : selected.kind === 'layer' ? 'Layer on main' : 'Checkpoint'}</span>
          <h3>{selected.kind === 'group' ? selected.label : detail?.item.message || selected.label}</h3>
          <dl><dt>Branch</dt><dd>{selected.branch}</dd><dt>{selected.kind === 'group' ? 'Checkpoints' : 'ID'}</dt><dd>{selected.kind === 'group' ? selected.commits.length : selected.id}</dd>{selectedCommit?.at && <><dt>When</dt><dd>{new Date(selectedCommit.at).toLocaleString()}</dd></>}</dl>
          {selected.kind === 'group' && <><button className="history-primary" onClick={() => writeView({ expanded: new Set([...view.expanded, selected.id]), selected: selected.commits[0].id })}>Expand {selected.commits.length} checkpoints</button><p>Expand to inspect each intermediate change.</p></>}
          {source && <Link className="history-trace-link" to={trace!.href(source)}><ArrowUpRight size={14} />View in Trace{source.checkpoint !== null ? ` · #${source.checkpoint}` : ''}</Link>}
          {trace && !source && selected.kind !== 'group' && <p>{finding ? 'Finding the producing Trace step…' : 'No linked trace in this chat or its agents.'}</p>}
          {sourceError && <p role="alert" className="history-error">Trace lookup failed: {sourceError}</p>}
          {selected.parent && !layout.points.has(selected.parent) && <p>Earlier parent is not loaded: <code>{short(selected.parent)}</code></p>}
          {selectedCommit?.sourceBranch && <p>Source Branch: {selectedCommit.sourceBranch}</p>}
          {selectedCommit?.sourceCommit && <p>Source Commit: <code>{short(selectedCommit.sourceCommit)}</code></p>}
          {selectedCommit?.base && <p>Base Layer: <code>{short(selectedCommit.base)}</code></p>}
          {selectedCommit?.logical != null && <p>Saved tree size: {exactBytes(selectedCommit.logical)}</p>}
          {selected.kind === 'layer' && <p>Publication time not recorded{selectedCommit?.sourceTime ? ` · source saved ${new Date(selectedCommit.sourceTime).toLocaleString()}` : ''}</p>}
          {selectedCommit && <Link className="history-trace-link" to={`/storage/${project}/history/diff?branch=${encodeURIComponent(selectedCommit.branch)}&commit=${selectedCommit.id}${selectedCommit.parent ?? selectedCommit.base ? `&from=${selectedCommit.parent ?? selectedCommit.base}` : ''}`}>Compare saved versions</Link>}
          {selected.second && <p>Merge parent: <code>{short(selected.second)}</code></p>}
          {detailError && <p role="alert" className="history-error">Changes could not load: {detailError}</p>}
          {selectedCommit && selected.kind !== 'group' && !detail && !detailError && <p>Reading changed paths…</p>}
          {detail && <><h4>{selected.kind === 'group' ? 'Net changed paths' : 'Changed paths'}</h4>{detail.changes == null ? <p>No comparison endpoint is available.</p> : detail.changes.length === 0 ? <p>{selected.kind === 'layer' && !selectedCommit?.parent && !selectedCommit?.base ? 'Initial import.' : 'No file changes.'}</p> : <ul className="history-paths">{detail.changes.map((c,i) => <li key={`${c.path}:${i}`}><span>{c.kind}</span><code>{c.path}</code></li>)}</ul>}{detail.nextChanges != null && <button disabled={!!busy} onClick={() => { setBusy('changes'); void historyApi.detail(project, detail.item.branch, detail.item.id, selected.kind === 'group' ? selected.commits[0].parent ?? undefined : undefined, detail.nextChanges!).then(next => setDetail(d => d ? { ...next, changes: [...(d.changes ?? []), ...(next.changes ?? [])] } : next)).catch(e => setDetailError(e.message)).finally(() => setBusy(null)) }}>Load more changed paths</button>}</>}
        </>}
        {selected && view.branch && <div className="history-pagination">
          {pages[view.branch]?.next != null ? <button disabled={!!busy} onClick={() => void loadBranch(view.branch, true)}>Load earlier checkpoints</button> : !pages[view.branch] ? <button disabled={!!busy} onClick={() => void loadBranch(view.branch)}>Load checkpoints</button> : <p>All available checkpoints on this branch loaded.</p>}
        </div>}
      </aside>
  ) : undefined
  return <div className="history-view">
    <div className="history-toolbar">
      <div className="history-title"><GitBranch size={15} /><strong>History</strong><span className="history-main-summary">main <span>@ {short(branches.find(b => b.name === 'main')?.head ?? '—')}</span></span><span className="history-count">{loaded.toLocaleString()} checkpoints loaded</span></div>
      <div className="history-actions">
        <button aria-expanded={branchesOpen} onClick={() => setBranchesOpen(v => !v)} aria-label="Find a branch">Branches <span>{branches.length}{branchNext !== null ? '+' : ''}</span><ChevronDown size={12} /></button>
        <button onClick={() => { clearLinkFocus(); writeView({ selected: null, branch: '' }); setMapReset(n => n + 1) }}>Now</button>
        <button onClick={() => setRevision(n => n + 1)} disabled={!!busy} aria-label="Refresh History"><RefreshCw size={14} className={busy ? 'animate-spin' : ''} /></button>
      </div>
    </div>
    {branchesOpen && <div className="history-branches" role="dialog" aria-label="Find a history branch" onKeyDown={e => { if (e.key === 'Escape') setBranchesOpen(false) }}>
      <label className="history-search"><Search size={14} /><input autoFocus aria-label="Search history branches" placeholder="Find a branch…" value={view.query} onChange={e => writeView({ query: e.target.value })} /><button onClick={() => setBranchesOpen(false)} aria-label="Close branch finder"><X size={13} /></button></label>
      <div className="history-branch-list">{filtered.map(b => {
        const children = branches.filter(c => parents.get(c.name) === b.name).length
        return <div className="history-branch" key={b.name}><button onClick={() => openBranch(b.name)} title={b.name}><GitBranch size={13} /><span>{b.name}</span>{busy === b.name && <LoaderCircle size={12} className="animate-spin" />}</button>{children > 0 && b.name !== 'main' && <button className="history-family" aria-expanded={!view.families.has(b.name)} aria-label={`${view.families.has(b.name) ? 'Expand' : 'Collapse'} ${b.name} family`} onClick={() => toggleFamily(b.name)}><ChevronRight size={12} />{children}</button>}</div>
      })}{!filtered.length && <p className="history-note">No branches match.</p>}
      {branchNext !== null && <button disabled={!!busy} onClick={() => { setBusy('branches'); void historyApi.branches(project, branchNext).then(r => { setBranches(b => [...new Map([...b, ...r.branches].map(x => [x.name, x])).values()]); setBranchNext(r.next) }).catch(e => setError(e.message)).finally(() => setBusy(null)) }}>Load more branches</button>}</div>
    </div>}
    {error && <div role="alert" className="history-error">{error} <button onClick={() => setRevision(n => n + 1)}>Try again</button></div>}
    <div className="history-stage">
      {busy === 'initial' && !Object.keys(pages).length ? <p className="history-loading"><LoaderCircle size={16} className="animate-spin" /> Reading history…</p> : !branches.length ? <p className="history-empty">No history yet.</p> : <HistoryGraph
        nodes={nodes} lanes={structure.lanes} branches={visibleBranches} familyCounts={new Map(branches.map(b => [b.name, branches.filter(c => parents.get(c.name) === b.name).length]))} selected={view.selected} linked={callCommits} focus={view.selected}
        onSelect={select} onBranch={openBranch} collapsed={view.families} onToggleFamily={toggleFamily}
        expanded={view.expanded.size > 0} onCollapse={() => { clearLinkFocus(); writeView({ expanded: new Set(), selected: null, branch: '' }) }} reset={mapReset}
        inspector={inspector} onViewport={(top,left) => { viewport.current = { top, left } }}
      />}
    </div>
    <div className="history-legend" aria-label="History legend">
      <span><i className="legend-trunk" />Layer on main</span>
      <span><svg width="19" height="14" viewBox="-1 -8 20 16" aria-hidden="true"><circle cx="8" cy="0" r="3" /></svg>Checkpoint</span>
      <span><i className="legend-bough" />Branch</span><span><i className="legend-merge" />Merge</span><span><i className="legend-publish" />Publish</span>
      <span className="history-legend-hint">Drag to pan · ⌘/Ctrl + scroll to zoom</span>
    </div>
    <div className="history-footer"><span>{example ? 'Read-only sample · ' : ''}Saved Commit and Layer history · pinned pages</span>{trace && trace.earlier > 0 && <button disabled={trace.loadingOlder} onClick={() => void trace.loadEarlier()}>Load earlier Trace links</button>}{(trace?.error || sourceError) && <span role="alert">{trace?.error ?? sourceError}</span>}</div>
  </div>
}
