/* Hallmark · component: file inspector · genre: modern-minimal · theme: existing Connect
 * Pre-emit critique: P4 H4 E4 S5 R5 V3. Local sample data only. */
import { ArrowLeftRight, ArrowUpRight, Check, ChevronRight, Code2, FileQuestion, GitBranch, GitCommitHorizontal, GitCompareArrows, History, ListFilter, PanelRightClose, Rows3, Search, X } from 'lucide-react'
import { useId, useState, type KeyboardEvent } from 'react'
import { CodeView } from './CodeView'
import { FileDiff } from './FileDiff'
import { FileBlame } from './FileBlame'
import { FileAttributionDiff } from './FileAttributionDiff'
import { CommitDetails } from './CommitDetails'
import { PageControls } from './PageControls'
import { bytes } from '@/layerfs/format'
import { previewAncestry, previewAt, previewAttribution, previewBlame, previewBranches, previewChanges, previewComparisonChanges, previewCommits, previewDiff, previewHead, previewOwn, previewRevisions, previewShort, previewTime, type PreviewCommit } from './file-preview-data'

type Mode = 'code' | 'compare' | 'attribution' | 'blame' | 'revisions'
const modes = [
  { id: 'code', label: 'Code', icon: Code2 },
  { id: 'compare', label: 'Compare', icon: GitCompareArrows },
  { id: 'attribution', label: 'Attribution', icon: GitCommitHorizontal },
  { id: 'blame', label: 'Blame', icon: Rows3 },
  { id: 'revisions', label: 'Revisions', icon: History },
] as const
const parentOf = (commit: PreviewCommit) => previewCommits.find(c => c.id === commit.parent) ?? null

export function FileExplorerPreview({ project, branch, path, snapshot, onSnapshot, onOpenFile }: {
  project: string; branch: string; path: string; snapshot: string; onSnapshot: (id: string) => void; onOpenFile: (path: string) => void
}) {
  const uid = useId()
  const [mode, setMode] = useState<Mode>('code')
  const [compare, setCompare] = useState(branch === 'main' ? 'previous' : 'main')
  const [swapped, setSwapped] = useState(false)
  const [inspector, setInspector] = useState<string | null>(null)
  const [commitPage, setCommitPage] = useState(1)
  const [commitSize, setCommitSize] = useState(2)
  const [revisionPage, setRevisionPage] = useState(1)
  const [revisionSize, setRevisionSize] = useState(2)
  const [query, setQuery] = useState('')
  const [changeFilter, setChangeFilter] = useState('all')
  const current = previewAt(branch, snapshot)
  const data = current.tree[path]
  const own = previewOwn(branch)
  const revisions = previewRevisions(current, path)
  const lastChange = revisions[0]
  const selected = previewCommits.find(c => c.id === inspector)
  const source = compare === 'previous' ? parentOf(current) : compare.startsWith('commit:') ? previewCommits.find(c => c.id === compare.slice(7)) ?? null : previewHead(compare)
  const left = swapped ? current : source
  const right = swapped ? source : current
  const changes = previewComparisonChanges(left, right)
  const leftFile = left?.tree[path], rightFile = right?.tree[path]
  const diff = previewDiff(leftFile?.text ?? '', rightFile?.text ?? '')
  const binaryDiff = (leftFile && leftFile.text === null) || (rightFile && rightFile.text === null)
  const additions = diff.filter(line => line.op === '+').length
  const removals = diff.filter(line => line.op === '-').length
  const filteredRevisions = revisions.filter(c => {
    const change = previewChanges(parentOf(c), c).find(change => change.path === path)!
    return `${c.message} ${c.id} ${c.branch}`.toLowerCase().includes(query.toLowerCase()) && (changeFilter === 'all' || change.kind.toLowerCase() === changeFilter)
  })
  const revisionLastPage = Math.max(1, Math.ceil(filteredRevisions.length / revisionSize))
  const safeRevisionPage = Math.min(revisionPage, revisionLastPage)
  function selectMode(next: Mode) { setMode(next); setQuery(''); setRevisionPage(1) }
  function arrowTabs(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = event.key === 'ArrowRight' ? (index + 1) % modes.length : event.key === 'ArrowLeft' ? (index + modes.length - 1) % modes.length : event.key === 'Home' ? 0 : event.key === 'End' ? modes.length - 1 : null
    if (next === null) return
    event.preventDefault(); selectMode(modes[next].id)
    document.getElementById(`${uid}-${modes[next].id}`)?.focus()
  }
  const inspect = (commit: PreviewCommit) => { setInspector(commit.id); setCommitPage(Math.floor(Math.max(0, own.findIndex(c => c.id === commit.id)) / commitSize) + 1) }
  return <div className="fp-explorer" data-file-preview onKeyDown={e => { if (e.key === 'Escape') setInspector(null) }}>
    <div className="fp-file-heading">
      <span className="fp-path" title={path}>{path.slice(1)}</span>
      <span className="fp-file-meta">{data ? `${data.text === null ? 'Binary' : `${data.text.trimEnd().split('\n').length} lines`} · ${bytes(data.size)}` : 'Not present at this commit'}</span>
    </div>
    <div className="fp-toolbar">
      <div role="tablist" aria-label="File views" className="fp-modes">
        {modes.map(({ id, label, icon: Icon }, index) => <button key={id} type="button" id={`${uid}-${id}`} role="tab" aria-selected={mode === id} aria-controls={`${uid}-panel`} tabIndex={mode === id ? 0 : -1} onClick={() => selectMode(id)} onKeyDown={e => arrowTabs(e, index)}><Icon size={14} />{label}{id === 'revisions' && <span className="fp-count">{revisions.length}</span>}</button>)}
      </div>
      <div className="fp-version-controls">
        <label className="fp-version"><GitCommitHorizontal size={14} /><select aria-label="Saved commit" value={snapshot} onChange={e => { onSnapshot(e.target.value); setRevisionPage(1) }}>
          <option value="latest">Latest saved</option>
          {previewAncestry(previewHead(branch)).map(c => <option key={c.id} value={c.id}>{previewShort(c.id)} · {c.message}</option>)}
        </select></label>
        <button type="button" className="fp-commits-button" aria-label="Browse branch commits" aria-expanded={!!inspector} onClick={() => inspector ? setInspector(null) : inspect(current)}><GitBranch size={14} />Commits</button>
      </div>
    </div>
    <div className="fp-save-line">
      <button type="button" onClick={() => lastChange && inspect(lastChange)} disabled={!lastChange}><GitCommitHorizontal size={14} /><code>{lastChange ? previewShort(lastChange.id) : '—'}</code><span>{lastChange?.message ?? 'No saved changes to this path'}</span><ArrowUpRight size={12} /></button>
      {lastChange && <time dateTime={lastChange.time}>{previewTime(lastChange.time)}</time>}
    </div>
    <div className={`fp-body ${inspector ? 'fp-with-inspector' : ''}`}>
      <section className="fp-content" role="tabpanel" id={`${uid}-panel`} aria-labelledby={`${uid}-${mode}`} tabIndex={0}>
        {mode === 'code' && (data ? data.text !== null ? <CodeView path={path} text={data.text} /> : <div className="fp-empty"><FileQuestion size={24} /><strong>Binary content</strong><p>{bytes(data.size)} · Content preview is unavailable for this file.</p><button type="button" onClick={() => selectMode('revisions')}>View revisions</button></div> : <div className="fp-empty"><History size={24} /><strong>This file is not in this saved commit</strong><p>Choose a newer commit to return to its saved content.</p><button type="button" onClick={() => onSnapshot('latest')}>Open latest saved</button></div>)}
        {(mode === 'compare' || mode === 'attribution') && <div className="fp-compare">
          <div className="fp-compare-controls"><label>Compare against <select aria-label="Compare against" value={compare} onChange={e => { setCompare(e.target.value); setSwapped(false) }}><option value="previous">Previous commit</option><optgroup label="Branch heads">{previewBranches.map(b => <option value={b.name} key={b.name}>{b.name}{b.name === 'main' ? ' · core content' : ''}</option>)}</optgroup><optgroup label="Saved commits">{previewCommits.toReversed().map(c => <option value={`commit:${c.id}`} key={c.id}>{previewShort(c.id)} · {c.message}</option>)}</optgroup></select></label><button type="button" onClick={() => setSwapped(value => !value)} aria-label="Swap comparison sides"><ArrowLeftRight size={14} />Swap</button></div>
          <div className="fp-compare-heading"><span><strong>{left?.branch ?? 'Empty project'}</strong><code>{left ? previewShort(left.id) : 'No parent'}</code><span aria-hidden="true">→</span><strong>{right?.branch ?? 'Empty project'}</strong><code>{right ? previewShort(right.id) : 'No parent'}</code></span><span className="fp-diff-totals"><span className="fp-added">+{binaryDiff ? '—' : additions}</span><span className="fp-removed">−{binaryDiff ? '—' : removals}</span></span></div>
          <details className="fp-changed-files"><summary>{changes.length} changed {changes.length === 1 ? 'path' : 'paths'} across these saved versions</summary><ul>{changes.map(change => <li key={change.path}><span className={`fp-change fp-${change.kind.toLowerCase()}`}>{change.kind}</span><button type="button" onClick={() => onOpenFile(change.path)}>{change.path}</button></li>)}</ul></details>
          {mode === 'compare' ? <FileDiff path={path} lines={diff} before={leftFile} after={rightFile} onPrevious={() => setCompare('previous')} /> : <FileAttributionDiff lines={previewAttribution(left, right, path)} unavailable={binaryDiff ? 'Binary files do not have line attribution.' : undefined} onInspect={owner => { const commit = previewCommits.find(c => c.id === owner.id); if (commit) inspect(commit) }} />}
        </div>}
        {mode === 'blame' && <FileBlame lines={previewBlame(current, path)} unavailable={data?.text != null ? undefined : data ? 'Binary files do not have text lines to attribute.' : 'This file is absent at the selected commit.'} onInspect={owner => { const commit = previewCommits.find(c => c.id === owner.id); if (commit) inspect(commit) }} onRevisions={() => selectMode('revisions')} />}
        {mode === 'revisions' && <div className="fp-revisions">
          <div className="fp-revision-heading"><div><h2>File revisions</h2><p>Saved changes to this path, including inherited history.</p></div><span className="fp-count">{revisions.length}</span></div>
          <div className="fp-revision-filters"><label className="fp-search"><Search size={14} /><input aria-label="Search file revisions" placeholder="Find a message or commit…" value={query} onChange={e => { setQuery(e.target.value); setRevisionPage(1) }} />{query && <button type="button" aria-label="Clear revision search" onClick={() => setQuery('')}><X size={12} /></button>}</label><label className="fp-filter"><ListFilter size={14} /><select aria-label="Revision change type" value={changeFilter} onChange={e => { setChangeFilter(e.target.value); setRevisionPage(1) }}><option value="all">All changes</option><option value="added">Added</option><option value="modified">Modified</option><option value="removed">Removed</option></select></label></div>
          <div className="fp-revision-list">{filteredRevisions.slice((safeRevisionPage - 1) * revisionSize, safeRevisionPage * revisionSize).map(c => {
            const change = previewChanges(parentOf(c), c).find(change => change.path === path)!
            return <article className="fp-revision" key={c.id}><GitCommitHorizontal size={17} /><div className="fp-revision-main"><button type="button" className="fp-revision-title" onClick={() => inspect(c)}>{c.message}</button><div className="fp-revision-facts"><code>{previewShort(c.id)}</code><span>{c.branch}</span><span className={`fp-change fp-${change.kind.toLowerCase()}`}>{change.kind}</span><time dateTime={c.time}>{previewTime(c.time)}</time></div><div className="fp-revision-actions"><button type="button" onClick={() => { onSnapshot(c.id); selectMode('code') }}>Open file</button><button type="button" onClick={() => { onSnapshot(c.id); setCompare('previous'); setSwapped(false); setMode('compare') }}>Compare with parent</button></div></div><button type="button" className="fp-icon-button" aria-label={`Inspect revision ${previewShort(c.id)}`} onClick={() => inspect(c)}><ChevronRight size={15} /></button></article>
          })}{!filteredRevisions.length && <div className="fp-empty"><Search size={24} /><strong>No matching revisions</strong><p>Try another message, commit ID, or change type.</p><button type="button" onClick={() => { setQuery(''); setChangeFilter('all') }}>Clear filters</button></div>}</div>
          <PageControls page={safeRevisionPage} size={revisionSize} count={filteredRevisions.length} onPage={setRevisionPage} onSize={setRevisionSize} label="Revisions" />
          <p className="fp-coverage"><Check size={12} />Complete sample history · pinned at {previewShort(current.id)}</p>
        </div>}
      </section>
      {selected && <aside className="fp-inspector" aria-label="Commit details"><div className="fp-inspector-heading"><strong>Commits</strong><span>{branch}</span><button type="button" aria-label="Close commit details" onClick={() => setInspector(null)}><PanelRightClose size={15} /></button></div>
        <div className="fp-commit-list">{own.slice((commitPage - 1) * commitSize, commitPage * commitSize).map(c => <button type="button" key={c.id} aria-pressed={c.id === selected.id} onClick={() => setInspector(c.id)}><GitCommitHorizontal size={14} /><span><strong>{c.message}</strong><small>{previewShort(c.id)} · {previewTime(c.time)}</small></span></button>)}</div>
        <PageControls page={commitPage} size={commitSize} count={own.length} onPage={setCommitPage} onSize={setCommitSize} label="Commits" />
        <CommitDetails project={project} commit={selected} path={path} changes={previewChanges(parentOf(selected), selected)} onParent={() => inspect(parentOf(selected)!)} onBrowse={() => { onSnapshot(selected.id); setMode('code') }} onCompare={() => { onSnapshot(selected.id); setCompare('previous'); setSwapped(false); setMode('compare'); setInspector(null) }} onPath={path => { onSnapshot(selected.id); onOpenFile(path); setMode('code') }} />
      </aside>}
    </div>
    <footer className="fp-status"><span><span className="fp-status-dot" />Saved content · {branch === 'main' ? 'Project core' : branch}</span><span>{snapshot === 'latest' ? 'Latest' : 'Historical'} · <code>{previewShort(current.id)}</code>{data && ` · ${data.mode}`}</span></footer>
  </div>
}
