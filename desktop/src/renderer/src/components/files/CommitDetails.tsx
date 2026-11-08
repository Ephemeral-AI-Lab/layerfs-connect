import { Code2, GitCompareArrows } from 'lucide-react'
import { bytes } from '@/layerfs/format'
import { shortId } from '@/layerfs/format'

export interface CommitDetailRecord {
  id: string; branch: string; message: string; time: string; operation: string
  parent: string | null; source?: string
  tree: Record<string, { size: number; mode: string }>
}
const time = (value: string) => new Date(value).toLocaleString('en-GB', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC'

export function CommitDetails({ project, commit, path, changes, onParent, onBrowse, onCompare, onPath }: {
  project: string; commit: CommitDetailRecord; path?: string; changes: { path: string; kind: 'Added' | 'Removed' | 'Modified' }[]
  onParent: () => void; onBrowse: () => void; onCompare: () => void; onPath: (path: string) => void
}) {
  return <div className="fp-commit-detail">
    <span className="fp-eyebrow">{commit.branch === 'main' ? 'Main publication' : 'Saved commit'}</span>
    <h2>{commit.message}</h2><code className="fp-full-id">{commit.id}</code>
    <dl>
      <dt>Project</dt><dd>{project}</dd><dt>Branch</dt><dd>{commit.branch}</dd>
      <dt>Operation</dt><dd>{commit.operation}</dd>
      <dt>{commit.branch === 'main' ? 'Published' : 'Saved'}</dt><dd>{time(commit.time)}</dd>
      <dt>Parent</dt><dd>{commit.parent ? <button type="button" onClick={onParent}>{shortId(commit.parent)}</button> : 'Project origin'}</dd>
      {commit.source && <><dt>Source commit</dt><dd><code>{shortId(commit.source)}</code></dd></>}
      <dt>Logical size</dt><dd>{bytes(Object.values(commit.tree).reduce((n, f) => n + f.size, 0))}</dd>
      {path && <><dt>This file</dt><dd>{commit.tree[path] ? `${bytes(commit.tree[path].size)} · ${commit.tree[path].mode}` : 'Not present'}</dd></>}
    </dl>
    <button type="button" className="fp-open-commit" onClick={onBrowse}><Code2 size={14} />Browse files at this commit</button>
    <button type="button" className="fp-open-commit fp-compare-parent" onClick={onCompare}><GitCompareArrows size={14} />Compare with parent</button>
    <h3>Changed paths</h3>
    <ul className="fp-detail-paths">{changes.map(change => <li key={change.path}>
      <span className={`fp-change fp-${change.kind.toLowerCase()}`}>{change.kind === 'Added' ? '+' : change.kind === 'Removed' ? '−' : '~'}</span>
      <button type="button" onClick={() => onPath(change.path)}>{change.path}</button>
    </li>)}</ul>
  </div>
}
