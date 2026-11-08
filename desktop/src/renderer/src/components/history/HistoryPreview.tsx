/* Hallmark · component: history comparison workbench · theme: existing Connect
 * Pre-emit critique: P4 H5 E4 S5 R5 V4. Local saved-tree samples only. */
import { ArrowLeft, ArrowLeftRight, ArrowUpRight, ChevronRight, Code2, FileQuestion, GitBranch, GitCommitHorizontal, GitCompareArrows, Info, Pin, Rows3, Search, X } from 'lucide-react'
import { useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { CodeView } from '@/components/files/CodeView'
import { FileDiff } from '@/components/files/FileDiff'
import { FileBlame } from '@/components/files/FileBlame'
import { FileAttributionDiff } from '@/components/files/FileAttributionDiff'
import { CommitDetails } from '@/components/files/CommitDetails'
import { PageControls } from '@/components/files/PageControls'
import { previewAttribution, previewBlame, previewBranches, previewChanges, previewComparisonChanges, previewCommits, previewDiff, previewHead, previewShort, previewTime, type PreviewCommit } from '@/components/files/file-preview-data'
import { HistoryGraph } from './HistoryGraph'
import { previewFind, previewGraph, previewGroupCommits, previewGroupId, previewParent } from './preview-model'
import './history-comparison.css'

type FileMode = 'diff' | 'attribution' | 'code' | 'blame'
const modes = [{ id: 'diff', label: 'Content', icon: GitCompareArrows }, { id: 'attribution', label: 'Attribution', icon: GitCommitHorizontal }, { id: 'code', label: 'Code', icon: Code2 }, { id: 'blame', label: 'Blame', icon: Rows3 }] as const
const noFamilies = new Set<string>()
const familyCounts = new Map([['main', 4]])

export function HistoryPreview({ project, onExit }: { project: string; onExit: () => void }) {
  const uid = useId()
  const [params, setParams] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const historyPath = `/storage/${project.split('/').map(encodeURIComponent).join('/')}/history`
  const isDiffPage = location.pathname.endsWith('/history/diff')
  const [expanded, setExpanded] = useState(false)
  const [reset, setReset] = useState(0)
  const [filter, setFilter] = useState('')
  const [pathPage, setPathPage] = useState(1)
  const [pathSize, setPathSize] = useState(5)
  const [originId, setOriginId] = useState<string | null>(null)
  const [returnTo, setReturnTo] = useState<{ search: string; key: string; scroll: number; graph: { left: number; top: number } } | null>(null)
  const [viewportRequest, setViewportRequest] = useState<{ left: number; top: number; token: number } | null>(null)
  const viewport = useRef({ left: 0, top: 0 })
  const historyReturn = useRef<{ search: string; graph: { left: number; top: number } } | null>(null)
  const fileBody = useRef<HTMLElement>(null)
  const scrollPositions = useRef(new Map<string, number>())
  const pendingRestore = useRef<{ key: string; scroll: number; graph: { left: number; top: number } } | null>(null)
  const group = params.get('commit') === previewGroupId
  const selected = group ? previewGroupCommits.at(-1)! : previewFind(params.get('commit')) ?? previewHead('main')
  const pinned = params.has('from')
  const defaultBase = group ? previewParent(previewGroupCommits[0]) : previewParent(selected)
  const before = pinned ? previewFind(params.get('from')) : defaultBase
  const modeParam = params.get('view')
  const mode: FileMode = modeParam === 'code' || modeParam === 'blame' || modeParam === 'attribution' ? modeParam : 'diff'
  const changes = useMemo(() => previewComparisonChanges(before, selected), [before, selected])
  const path = params.get('path') ?? changes.find(c => c.path.endsWith('/login.js'))?.path ?? changes[0]?.path ?? '/src/routes/login.js'
  const beforeFile = before?.tree[path], afterFile = selected.tree[path]
  const lines = previewDiff(beforeFile?.text ?? '', afterFile?.text ?? '')
  const origin = previewFind(originId)
  const graph = useMemo(() => previewGraph(expanded), [expanded])
  const filteredPaths = changes.filter(c => c.path.toLowerCase().includes(filter.toLowerCase()))
  const safePage = Math.min(pathPage, Math.max(1, Math.ceil(filteredPaths.length / pathSize)))
  const scrollKey = `${before?.id}:${selected.id}:${path}:${mode}`
  useLayoutEffect(() => {
    const element = fileBody.current
    const restore = pendingRestore.current?.key === scrollKey ? pendingRestore.current : null
    if (element) element.scrollTop = restore?.scroll ?? scrollPositions.current.get(scrollKey) ?? 0
    if (restore) {
      pendingRestore.current = null
      setViewportRequest(old => ({ ...restore.graph, token: (old?.token ?? 0) + 1 }))
    }
  }, [scrollKey, isDiffPage])

  function update(patch: Record<string, string | null>, replace = false) {
    setParams(previous => {
      const next = new URLSearchParams(previous)
      next.delete('call')
      for (const [key, value] of Object.entries(patch)) { if (value === null) next.delete(key); else next.set(key, value) }
      return next
    }, { replace })
  }
  function selectCommit(id: string, branch?: string) {
    update({ commit: id, branch: branch ?? previewFind(id)?.branch ?? 'feature-login', path: null, view: 'diff' })
    setOriginId(null); setPathPage(1); setFilter('')
  }
  function openDiff(patch: Record<string, string | null> = {}) {
    if (!isDiffPage) historyReturn.current = { search: params.toString(), graph: { ...viewport.current } }
    const next = new URLSearchParams(params)
    for (const [key, value] of Object.entries(patch)) { if (value === null) next.delete(key); else next.set(key, value) }
    navigate(`${historyPath}/diff${next.size ? `?${next}` : ''}`)
    setOriginId(null)
  }
  function backToHistory() {
    const previous = historyReturn.current
    navigate(`${historyPath}${previous?.search ? `?${previous.search}` : ''}`)
    setOriginId(null); setReturnTo(null)
    if (previous) setViewportRequest(old => ({ ...previous.graph, token: (old?.token ?? 0) + 1 }))
  }
  function attributionExample() {
    openDiff({ from: previewHead('main').id, commit: previewHead('review-login').id, branch: 'review-login', path: '/src/routes/login.js', view: 'attribution' })
  }
  function exitPreview() { navigate(historyPath, { replace: true }); onExit() }
  function inspectChange(commit: PreviewCommit, view: FileMode = 'diff', nextPath = path) {
    if (!isDiffPage) { openDiff({ commit: commit.id, branch: commit.branch, from: null, path: nextPath, view }); return }
    if (!returnTo) setReturnTo({ search: params.toString(), key: scrollKey, scroll: fileBody.current?.scrollTop ?? 0, graph: { ...viewport.current } })
    update({ commit: commit.id, branch: commit.branch, from: null, path: nextPath, view })
    setOriginId(null)
  }
  function backToComparison() {
    if (!returnTo) return
    const previous = returnTo
    pendingRestore.current = previous
    setParams(new URLSearchParams(previous.search)); setReturnTo(null); setOriginId(null)
  }
  function swap() {
    if (!before) return
    update({ from: selected.id, commit: before.id, branch: before.branch })
    setPathPage(1)
  }
  function arrowTabs(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = event.key === 'ArrowRight' ? (index + 1) % modes.length : event.key === 'ArrowLeft' ? (index + modes.length - 1) % modes.length : event.key === 'Home' ? 0 : event.key === 'End' ? modes.length - 1 : null
    if (next === null) return
    event.preventDefault(); update({ view: modes[next].id }, true)
    document.getElementById(`${uid}-${modes[next].id}`)?.focus()
  }
  const invalid = params.get('commit') && !group && !previewFind(params.get('commit')) || pinned && params.get('from') !== 'empty' && !before
  const graphSelected = group && !expanded ? previewGroupId : selected.id
  return <div className="history-view hc-view" data-history-preview onKeyDown={event => { if (event.key === 'Escape') setOriginId(null) }}>
    <div className="fp-preview-notice hc-notice"><span><strong>{isDiffPage ? 'Branch comparison preview' : 'History preview'}</strong><span>Sample data · read-only</span></span><button type="button" onClick={exitPreview}>Browse host history ↗</button></div>
    {invalid && <p className="hc-link-error" role="alert">This link names a commit outside the sample. <button type="button" onClick={exitPreview}>Open host history</button><button type="button" onClick={() => update({ commit: null, from: null, path: null, branch: null })}>Reset sample</button></p>}
    <div className="history-toolbar hc-toolbar">
      <div className="history-title">{isDiffPage ? <><button type="button" className="hc-return-history" onClick={backToHistory}><ArrowLeft size={14} />Back to History</button><span className="hc-page-divider">/</span><strong>Branch comparison</strong></> : <><GitBranch size={15} /><strong>History</strong><span className="history-main-summary">main <span>· project core</span></span><span className="history-count">{previewCommits.length} saved commits</span></>}</div>
      <div className="history-actions">{isDiffPage ? <button type="button" onClick={attributionExample}>Attribution example</button> : <><label className="hc-branch-select">Branch <select aria-label="History branch" value={selected.branch} onChange={e => selectCommit(previewHead(e.target.value).id, e.target.value)}>{previewBranches.map(b => <option value={b.name} key={b.name}>{b.name}</option>)}</select></label><button type="button" onClick={() => { update({ commit: null, branch: null, from: null, path: null, view: null }); setReset(n => n + 1); setReturnTo(null); setOriginId(null) }}>Now</button></>}</div>
    </div>
    <div className="hc-workspace" data-page={isDiffPage ? 'diff' : 'history'}>
      <div className="hc-graph-shell"><HistoryGraph
        nodes={graph.nodes} branches={graph.branches} lanes={graph.lanes} selected={graphSelected} linked={new Set([before?.id, selected.id].filter((id): id is string => !!id))} focus={graphSelected}
        onSelect={selectCommit} onBranch={name => selectCommit(previewHead(name).id, name)} onToggleFamily={() => {}} collapsed={noFamilies} familyCounts={familyCounts}
        expanded={expanded} onCollapse={() => { setExpanded(false); if (previewGroupCommits.some(c => c.id === selected.id)) update({ commit: previewGroupId }) }} reset={reset} comparison={{ from: before?.id ?? null, to: selected.id }} onViewport={(top, left) => { viewport.current = { top, left } }} viewportRequest={viewportRequest}
      />
      <div className="hc-graph-caption"><span><i />main · core content</span><span>● branch commit</span><span>From / To · selected comparison</span></div></div>
      {!isDiffPage && <div className="hc-history-selection"><div><GitCommitHorizontal size={17} /><span><strong>{group ? `Net changes across ${previewGroupCommits.length} commits` : selected.message}</strong><small>{selected.branch} · {previewShort(selected.id)} · {changes.length} changed paths</small></span></div><div className="hc-selection-actions"><button type="button" aria-pressed={pinned && before?.id === selected.id} onClick={() => update({ from: selected.id })}><Pin size={12} />Use as base</button>{group && <button type="button" onClick={() => { setExpanded(true); selectCommit(previewGroupCommits[0].id) }}>Expand {previewGroupCommits.length} commits</button>}<button type="button" onClick={() => setOriginId(selected.id)}>Details</button><button type="button" className="hc-open-diff" onClick={() => openDiff()}><GitCompareArrows size={14} />{pinned ? 'Open comparison' : 'Open changes'}<ArrowUpRight size={12} /></button></div>{pinned && <p className="hc-graph-base">Base pinned at {before ? `${before.branch} @ ${previewShort(before.id)}` : 'empty project'}. Select a destination, then open comparison.</p>}</div>}
      {isDiffPage && <>
        <div className="hc-comparison">
          <div className="hc-comparison-top">{returnTo && <button type="button" className="hc-return" onClick={backToComparison}><ArrowLeft size={13} />Back to comparison</button>}<span className="hc-comparison-kind">{group && !pinned ? `Net changes across ${previewGroupCommits.length} commits` : pinned ? 'Pinned comparison' : 'Changes from parent'}</span></div>
          <div className="hc-endpoints">
            <label><span>From</span><select aria-label="Comparison from commit" value={pinned ? params.get('from') ?? 'empty' : 'parent'} onChange={e => { update({ from: e.target.value === 'parent' ? null : e.target.value }); setPathPage(1) }}><option value="parent">{defaultBase ? `${defaultBase.branch} @ ${previewShort(defaultBase.id)} · ${group ? 'before group' : 'parent'}` : 'Empty project · no parent'}</option><option value="empty">Empty project</option>{previewBranches.map(branch => <optgroup key={branch.name} label={branch.name}>{previewCommits.filter(c => c.branch === branch.name).toReversed().map(c => <option key={c.id} value={c.id}>{previewShort(c.id)} · {c.message}</option>)}</optgroup>)}</select></label>
            <button type="button" className="hc-swap" aria-label="Swap history comparison" disabled={!before} onClick={swap}><ArrowLeftRight size={15} /></button>
            <label><span>To</span><select aria-label="Comparison to commit" value={group ? previewGroupId : selected.id} onChange={e => selectCommit(e.target.value)}>{group && <option value={previewGroupId}>Net group · {previewGroupCommits.length} commits</option>}{previewBranches.map(branch => <optgroup key={branch.name} label={branch.name}>{previewCommits.filter(c => c.branch === branch.name).toReversed().map(c => <option key={c.id} value={c.id}>{previewShort(c.id)} · {c.message}</option>)}</optgroup>)}</select></label>
            {pinned && <button type="button" className="hc-clear-base" onClick={() => update({ from: null })}>Clear base</button>}
          </div>
          <div className="hc-selection"><div><GitCommitHorizontal size={15} /><strong>{group ? `${previewGroupCommits.length} commits on ${selected.branch}` : selected.message}</strong><span>{previewTime(selected.time)}</span></div><div className="hc-selection-actions">
            <button type="button" aria-pressed={pinned && before?.id === selected.id} onClick={() => update({ from: selected.id })}><Pin size={12} />Use as base</button>
            {selected.branch !== 'main' && <button type="button" onClick={() => update({ from: previewHead('main').id })}>Compare with main</button>}
            {group && <button type="button" onClick={() => { setExpanded(true); selectCommit(previewGroupCommits[0].id) }}>Expand {previewGroupCommits.length} commits</button>}
            <button type="button" onClick={() => setOriginId(selected.id)}><Info size={12} />Details</button>
          </div></div>
          {pinned && before?.id === selected.id && <p className="hc-pin-hint"><Pin size={12} />Base pinned. Choose a different destination above.</p>}
          <div className="hc-file-workspace">
            <aside className="hc-paths" aria-label="Changed files"><div className="hc-paths-title"><strong>Changed files</strong><span>{changes.length}</span></div><label className="hc-path-search"><Search size={13} /><input aria-label="Filter changed files" placeholder="Find a path…" value={filter} onChange={e => { setFilter(e.target.value); setPathPage(1) }} />{filter && <button type="button" aria-label="Clear path filter" onClick={() => setFilter('')}><X size={12} /></button>}</label>
              <ul>{filteredPaths.slice((safePage - 1) * pathSize, safePage * pathSize).map(change => <li key={change.path}><button type="button" aria-current={path === change.path ? 'true' : undefined} onClick={() => { update({ path: change.path }); setOriginId(null) }} title={`${change.path}${change.attributionLines ? ` · ${change.attributionLines} unchanged lines with different owners` : ''}`}><span className={`fp-change fp-${change.kind.toLowerCase()}`}>{change.kind === 'Added' ? 'A' : change.kind === 'Removed' ? 'D' : change.kind === 'Attribution' ? 'O' : 'M'}</span><span>{change.path.slice(1)}</span>{change.attributionLines ? <span className="hc-owner-count" aria-label={`${change.attributionLines} owner changes`}>{change.attributionLines}↔</span> : <ChevronRight size={12} />}</button></li>)}</ul>
              {!filteredPaths.length && <div className="hc-no-paths"><p>{filter ? 'No changed paths match.' : 'No changed paths between these saved versions.'}</p>{filter ? <button type="button" onClick={() => setFilter('')}>Clear filter</button> : <button type="button" onClick={() => update({ from: null })}>Compare with parent</button>}</div>}
              <PageControls page={safePage} size={pathSize} count={filteredPaths.length} onPage={setPathPage} onSize={setPathSize} label="Changed files" />
            </aside>
            <section className="hc-file-pane"><div className="hc-file-heading"><span title={path}>{path.slice(1)}</span><div className="fp-modes" role="tablist" aria-label="History file views">{modes.map(({ id, label, icon: Icon }, index) => <button key={id} id={`${uid}-${id}`} type="button" role="tab" aria-controls={`${uid}-file`} aria-selected={mode === id} tabIndex={mode === id ? 0 : -1} onClick={() => update({ view: id }, true)} onKeyDown={event => arrowTabs(event, index)}><Icon size={13} />{label}</button>)}</div></div>
              <section className="hc-file-content fp-content" id={`${uid}-file`} ref={fileBody} role="tabpanel" aria-labelledby={`${uid}-${mode}`} tabIndex={0} onScroll={event => { scrollPositions.current.set(scrollKey, event.currentTarget.scrollTop) }}>
                {mode === 'diff' && <FileDiff path={path} lines={lines} before={beforeFile} after={afterFile} onPrevious={() => update({ from: null })} />}
                {mode === 'attribution' && <FileAttributionDiff lines={previewAttribution(before, selected, path)} unavailable={beforeFile?.text === null || afterFile?.text === null ? 'Binary files do not have line attribution.' : undefined} onInspect={owner => setOriginId(owner.id)} />}
                {mode === 'code' && (afterFile?.text != null ? <CodeView path={path} text={afterFile.text} /> : <div className="fp-empty"><FileQuestion size={24} /><strong>{afterFile ? 'Binary content' : 'File absent at destination'}</strong><p>{afterFile ? `${afterFile.size} bytes · text preview unavailable.` : 'Choose Diff to inspect the removed content.'}</p><button type="button" onClick={() => update({ view: 'diff' }, true)}>View diff</button></div>)}
                {mode === 'blame' && <FileBlame lines={previewBlame(selected, path)} unavailable={afterFile?.text != null ? undefined : afterFile ? 'Binary files do not have text lines to attribute.' : 'This file is absent at the destination commit.'} onInspect={owner => setOriginId(owner.id)} />}
              </section>
              <div className="hc-file-status">{mode === 'diff' || mode === 'attribution' ? `${before ? previewShort(before.id) : 'Empty'} → ${previewShort(selected.id)}` : `${mode === 'blame' ? 'Blame' : 'Saved content'} at ${previewShort(selected.id)}`}<span>Sample · saved content</span></div>
            </section>
          </div>
        </div>
      </>}
      {origin && <aside className="hc-origin" aria-label="History commit details"><div className="hc-origin-heading"><strong>Commit details</strong><button type="button" aria-label="Close history commit details" onClick={() => setOriginId(null)}><X size={15} /></button></div><button type="button" className="hc-origin-change" onClick={() => inspectChange(origin)}><GitCompareArrows size={14} />Show this change</button><CommitDetails project={project} commit={origin} path={path} changes={previewChanges(previewParent(origin), origin)} onParent={() => setOriginId(origin.parent)} onBrowse={() => inspectChange(origin, 'code')} onCompare={() => inspectChange(origin)} onPath={nextPath => inspectChange(origin, 'diff', nextPath)} /></aside>}
    </div>
    <p className="hc-coverage">Complete local sample · comparisons are pinned to saved versions. No SDK calls or file changes.</p>
  </div>
}
