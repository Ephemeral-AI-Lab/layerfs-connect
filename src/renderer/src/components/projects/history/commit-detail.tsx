import { FileMinus, FilePen, FilePlus, FileSymlink, type LucideIcon } from 'lucide-react'

import { AgentDot, laneColor } from '@/components/projects/history/branch-tree'
import type { HistoryItem } from '@/components/projects/history/lineage-graph'
import { Chip } from '@/components/storage/chips'
import type { FileChange, ForkTree } from '@/data/forks'
import { shortId, when } from '@/data/format'
import { cn } from '@/lib/utils'

const CHANGE: Record<string, { icon: LucideIcon; tone: string; label: string }> = {
  added: { icon: FilePlus, tone: 'text-success', label: 'added' },
  deleted: { icon: FileMinus, tone: 'text-destructive', label: 'deleted' },
  removed: { icon: FileMinus, tone: 'text-destructive', label: 'removed' },
  modified: { icon: FilePen, tone: 'text-warning', label: 'modified' },
  changed: { icon: FilePen, tone: 'text-warning', label: 'changed' },
  renamed: { icon: FileSymlink, tone: 'text-primary', label: 'renamed' },
}

function Changes({ changes }: { changes: FileChange[] }) {
  if (changes.length === 0)
    return <p className="text-xs text-faint">LayerFS listed no changed paths with this entry.</p>
  return (
    <div className="flex flex-col gap-2">
      <h4 className="text-xs font-medium text-faint">
        {changes.length} path{changes.length === 1 ? '' : 's'} changed
      </h4>
      <ul className="overflow-hidden rounded-xl border">
        {changes.map((ch) => {
          const c = CHANGE[ch.kind.toLowerCase()] ?? { icon: FilePen, tone: 'text-muted-foreground', label: ch.kind }
          return (
            <li key={`${ch.kind}:${ch.path}`} className="flex items-center gap-2.5 border-t px-3 py-1.5 first:border-t-0">
              <c.icon aria-hidden="true" className={cn('size-3.5 shrink-0', c.tone)} />
              <span className="min-w-0 flex-1 truncate font-mono text-xs" title={ch.path}>
                {ch.path}
              </span>
              <span className={cn('shrink-0 text-[11px]', c.tone)}>{c.label}</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

interface CommitDetailProps {
  tree: ForkTree
  item?: HistoryItem
  onFocus: (name: string) => void
}

/** The selected Commit or Layer: who made it, where it sits, what it changed. */
export function CommitDetail({ tree, item, onFocus }: CommitDetailProps) {
  const commit = item?.kind === 'commit' ? tree.commits.get(item.id) : undefined
  const layer = item?.kind === 'layer' ? tree.layers.find((l) => l.id === item.id) : undefined
  if (!commit && !layer) return <p className="p-6 text-sm text-muted-foreground">Pick a Commit or a Layer to see what it changed.</p>

  const id = commit?.id ?? layer?.id ?? ''
  const at = commit?.at ?? layer?.at
  const branch = commit ? tree.branches.get(commit.branch) : tree.branches.get('main')
  const forks = [...tree.branches.values()].filter((b) => b.forkedFrom?.id === id)
  const isHead = commit && branch?.commits[0]?.id === commit.id
  const mergedFrom = commit?.merged ? tree.commits.get(commit.merged) : undefined
  const from = layer?.from ? tree.branches.get(layer.from) : undefined

  return (
    <div className="flex flex-col gap-5 p-4">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <code title={id} className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
            {shortId(id)}
          </code>
          {layer && <Chip tone="neutral">Layer on main</Chip>}
          {layer && layer.id === tree.layers[0]?.id && <Chip tone="info">Head of main</Chip>}
          {isHead && <Chip tone="info">Head</Chip>}
          {commit?.merged && <Chip tone="neutral">Merge</Chip>}
          {branch && commit && (
            <button
              type="button"
              onClick={() => onFocus(branch.name)}
              className="max-w-full truncate rounded-md px-1.5 py-0.5 text-xs font-medium ring-1 ring-current/30 ring-inset hover:underline"
              style={{ color: laneColor(branch.depth) }}
            >
              {branch.name}
            </button>
          )}
        </div>
        <h3 className="mt-2 text-base font-semibold break-words">{commit?.message ?? layer?.message}</h3>
        <div className="mt-1 flex items-center gap-2 text-[13px] text-muted-foreground">
          {commit ? (
            commit.by ? (
              <span className="flex min-w-0 items-center gap-1.5">
                <AgentDot tree={tree} agent={commit.by} />
                <span className="truncate">{commit.by}</span>
              </span>
            ) : (
              <span className="text-faint italic">no agent recorded</span>
            )
          ) : from ? (
            <span className="min-w-0 truncate">
              Published from{' '}
              <button type="button" onClick={() => onFocus(from.name)} className="hover:underline" style={{ color: laneColor(from.depth) }}>
                {from.name}
              </button>
            </span>
          ) : (
            <span>{tree.layers[tree.layers.length - 1]?.id === layer?.id ? 'Init' : 'Published to main'}</span>
          )}
          <span>·</span>
          <span className="shrink-0" title={when(at)}>
            {commit?.ago ?? layer?.ago}
          </span>
        </div>
      </div>

      {mergedFrom && (
        <div className="flex flex-col gap-1.5">
          <h4 className="text-xs font-medium text-faint">Merged in</h4>
          <button
            type="button"
            onClick={() => onFocus(mergedFrom.branch)}
            className="flex w-fit items-center gap-1.5 rounded-md border px-2 py-1 text-xs hover:bg-muted"
          >
            <span
              aria-hidden="true"
              className="size-1.5 rounded-full"
              style={{ background: laneColor(tree.branches.get(mergedFrom.branch)?.depth ?? 1) }}
            />
            {mergedFrom.branch}
            <span className="font-mono text-faint">{shortId(mergedFrom.id)}</span>
          </button>
        </div>
      )}

      {forks.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h4 className="text-xs font-medium text-faint">Forked here</h4>
          <div className="flex flex-wrap gap-1.5">
            {forks.map((b) => (
              <button
                key={b.name}
                type="button"
                onClick={() => onFocus(b.name)}
                className={cn('flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs hover:bg-muted', b.state === 'merged' && 'text-faint')}
              >
                <span aria-hidden="true" className="size-1.5 rounded-full" style={{ background: laneColor(b.depth) }} />
                {b.name}
                <span className="font-mono text-faint">+{b.commits.length}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {commit ? (
        <Changes changes={commit.changes} />
      ) : (
        <p className="text-xs text-faint">A Layer is main's whole tree at a publish; its Commits hold the changes.</p>
      )}
    </div>
  )
}
