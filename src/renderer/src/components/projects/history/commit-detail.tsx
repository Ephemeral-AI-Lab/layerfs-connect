import { AGENT_DOT } from '@/components/app-sidebar'
import { laneColor } from '@/components/projects/history/branch-tree'
import type { HistoryItem } from '@/components/projects/history/lineage-graph'
import { Chip } from '@/components/storage/chips'
import type { ForkTree } from '@/data/forks'
import type { Author, FileChange } from '@/data/repo'
import type { Project } from '@/data/sample'
import { cn } from '@/lib/utils'

function By({ project, by }: { project: Project; by?: Author }) {
  if (!by) return <span className="text-faint italic">outside Connect</span>
  const session = project.sessions.find((s) => s.id === by.session)
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span aria-hidden="true" className={cn('size-2 shrink-0 rounded-full', AGENT_DOT[by.agent])} />
      <span className="truncate">
        {by.agent}
        {session && <span className="text-muted-foreground"> · {session.title}</span>}
      </span>
    </span>
  )
}

function Changes({ changes }: { changes: FileChange[] }) {
  return (
    <div className="flex flex-col gap-3">
      <h4 className="text-xs font-medium text-faint">
        {changes.length} file{changes.length === 1 ? '' : 's'} changed
      </h4>
      {changes.map((ch) => (
        <div key={ch.path} className="overflow-hidden rounded-xl border">
          <div className="flex items-center gap-3 bg-muted/40 px-3.5 py-2">
            <span className="min-w-0 flex-1 truncate font-mono text-xs">{ch.path}</span>
            <span className="font-mono text-xs text-success">+{ch.added}</span>
            <span className="font-mono text-xs text-destructive">−{ch.removed}</span>
          </div>
          {ch.hunk ? (
            <pre className="overflow-x-auto py-1.5 font-mono text-xs leading-relaxed">
              {ch.hunk.map((line, i) => (
                <div
                  key={i}
                  className={cn(
                    'px-3.5',
                    line.startsWith('+') && 'bg-success/10 text-success',
                    line.startsWith('-') && 'bg-destructive/10 text-destructive',
                  )}
                >
                  {line}
                </div>
              ))}
            </pre>
          ) : (
            <p className="px-3.5 py-2 text-xs text-faint">The sample has no hunks for this file.</p>
          )}
        </div>
      ))}
    </div>
  )
}

interface CommitDetailProps {
  project: Project
  tree: ForkTree
  item?: HistoryItem
  onFocus: (name: string) => void
}

/** The selected Commit or Layer: who made it, where it sits, what it changed. */
export function CommitDetail({ project, tree, item, onFocus }: CommitDetailProps) {
  const commit = item?.kind === 'commit' ? tree.commits.get(item.id) : undefined
  const layer = item?.kind === 'layer' ? tree.layers.find((l) => l.id === item.id) : undefined
  if (!commit && !layer)
    return <p className="p-6 text-sm text-muted-foreground">Pick a Commit or a Layer to see what it changed.</p>

  const branch = commit ? tree.branches.get(commit.branch) : tree.branches.get('main')
  const forks = [...tree.branches.values()].filter((b) => b.forkedFrom?.id === (commit?.id ?? layer?.id))
  const isHead = commit && branch?.commits[0]?.id === commit.id

  return (
    <div className="flex flex-col gap-5 p-4">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{commit?.id ?? layer?.id}</code>
          {layer && <Chip tone="neutral">Layer on main</Chip>}
          {layer && layer.id === tree.layers[0]?.id && <Chip tone="info">Head of main</Chip>}
          {isHead && <Chip tone="info">Head</Chip>}
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
        <h3 className="mt-2 text-base font-semibold">{commit?.message ?? layer?.message}</h3>
        <div className="mt-1 flex items-center gap-2 text-[13px] text-muted-foreground">
          {commit ? <By project={project} by={commit.by} /> : <span>{layer?.from ? `Published from ${layer.from}` : 'Published to main'}</span>}
          <span>·</span>
          <span className="shrink-0">{commit?.ago ?? layer?.ago}</span>
        </div>
      </div>

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

      <Changes changes={commit?.changes ?? layer?.changes ?? []} />
    </div>
  )
}
