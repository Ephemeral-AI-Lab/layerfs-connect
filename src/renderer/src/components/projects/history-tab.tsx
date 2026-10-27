import { GitCommitVertical, Network, Search } from 'lucide-react'
import { useMemo, useState } from 'react'

import { type BranchFilter, BranchTree, visibleBranches } from '@/components/projects/history/branch-tree'
import { CommitDetail } from '@/components/projects/history/commit-detail'
import { ForkMap } from '@/components/projects/history/fork-map'
import { type HistoryItem, LineageGraph } from '@/components/projects/history/lineage-graph'
import { LoadError, Loading } from '@/components/projects/states'
import { Input } from '@/components/ui/input'
import { host } from '@/host/client'
import { useHostQuery } from '@/host/use-host'
import { type ForkTree, ancestry, buildForkTree } from '@/data/forks'
import { shortId } from '@/data/format'
import { cn } from '@/lib/utils'

export type HistoryView = 'lineage' | 'map'

const FILTERS: { id: BranchFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'open', label: 'Open' },
  { id: 'done', label: 'Done' },
]

/** The newest thing on a Branch: its head Commit, or main's head Layer. */
function headOf(tree: ForkTree, name: string): HistoryItem | undefined {
  const b = tree.branches.get(name)
  if (b?.commits[0] && (name !== 'main' || !tree.layers[0] || b.commits[0].at > tree.layers[0].at))
    return { kind: 'commit', id: b.commits[0].id }
  if (name === 'main') return tree.layers[0] && { kind: 'layer', id: tree.layers[0].id }
  return b?.forkedFrom && { kind: b.forkedFrom.kind, id: b.forkedFrom.id }
}

interface HistoryTabProps {
  /** The LayerFS project. */
  project: string
  /** The run that made it: its trace names each Commit's agent. */
  runId?: string
  /** Changes when the run moved on, so the history reloads. */
  tick?: number
  /** Dev aid: the Branch to focus and the view to open on. */
  initialBranch?: string
  initialView?: HistoryView
  /** Dev aid: open the Map already replaying. */
  autoplay?: boolean
}

export function HistoryTab({ project, runId, tick = 0, ...rest }: HistoryTabProps) {
  const q = useHostQuery(async () => {
    const state = await host.project(project)
    const lists = await Promise.all(state.branches.map((b) => host.commits(project, b.name)))
    const run = runId ? await host.run(runId).catch(() => undefined) : undefined
    return { state, commits: Object.fromEntries(state.branches.map((b, i) => [b.name, lists[i]])), run }
  }, [project, runId, tick])
  const tree = useMemo(() => q.data && buildForkTree(q.data.state, q.data.commits, q.data.run), [q.data])

  if (!tree) {
    if (q.error) return <LoadError error={q.error} what="this project's history" onRetry={q.reload} />
    return <Loading label="Reading Branches and Commits" />
  }
  return <HistoryBody key={project} project={project} tree={tree} {...rest} />
}

interface HistoryBodyProps {
  project: string
  tree: ForkTree
  initialBranch?: string
  initialView?: HistoryView
  autoplay?: boolean
}

function HistoryBody({ project, tree, initialBranch, initialView = 'lineage', autoplay }: HistoryBodyProps) {
  const firstFocus = () => {
    if (initialBranch && tree.branches.has(initialBranch)) return initialBranch
    // The Branch an agent is working on now, else the one with the newest Commit.
    const busy = tree.order.find((n) => {
      const agent = tree.branches.get(n)?.agent
      return n !== 'main' && agent !== undefined && tree.busy.has(agent)
    })
    const newest = [...tree.commits.values()].sort((a, b) => b.at - a.at)[0]
    return busy ?? newest?.branch ?? 'main'
  }
  const [focusState, setFocusState] = useState(firstFocus)
  const focus = tree.branches.has(focusState) ? focusState : 'main'
  const [picked, setSelected] = useState<HistoryItem | undefined>()
  const selected = picked ?? headOf(tree, focus)
  const [view, setView] = useState<HistoryView>(initialView)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<BranchFilter>('all')
  // Merged Branches with forks start folded; everything else, including
  // Branches a live run forks later, starts open.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    const keep = new Set(ancestry(tree, focus).map((b) => b.name))
    return new Set(tree.order.filter((n) => tree.branches.get(n)?.state === 'merged' && !keep.has(n)))
  })
  const expanded = useMemo(() => new Set(tree.order.filter((n) => !collapsed.has(n))), [tree, collapsed])
  const shown = useMemo(() => visibleBranches(tree, query, filter), [tree, query, filter])

  const setFocus = (name: string) => {
    setFocusState(name)
    setSelected(undefined)
    setCollapsed((all) => {
      const next = new Set(all)
      for (const b of ancestry(tree, name)) next.delete(b.name)
      return next
    })
  }

  const branches = [...tree.branches.values()]
  const open = branches.filter((b) => b.name !== 'main' && b.state === 'open').length
  const deepest = Math.max(0, ...branches.map((b) => b.depth))

  return (
    <div className="flex h-[calc(100svh-13.5rem)] min-h-[30rem] flex-col overflow-hidden rounded-2xl border bg-card">
      <div className="flex items-center gap-3 border-b px-3 py-2.5">
        <div className="relative w-60">
          <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-faint" />
          <Input
            aria-label="Find a Branch or Commit"
            placeholder="Find a Branch or Commit"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-8 pl-7 text-[13px]"
          />
        </div>
        <div role="radiogroup" aria-label="Show Branches" className="flex gap-0.5 rounded-lg bg-muted p-0.5">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              role="radio"
              aria-checked={filter === f.id}
              onClick={() => setFilter(f.id)}
              className={cn(
                'rounded-md px-2.5 py-1 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring',
                filter === f.id ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <span className="min-w-0 flex-1 truncate text-right text-xs text-muted-foreground">
          {tree.branches.size === 1
            ? 'No Branches yet'
            : `${tree.branches.size - 1} Branch${tree.branches.size === 2 ? '' : 'es'} · ${open} open · forks ${deepest} deep`}
          {' · '}
          {tree.commits.size} Commit{tree.commits.size === 1 ? '' : 's'}
          {tree.layers[0] && ` · main at ${shortId(tree.layers[0].id)}`}
        </span>
        <div role="radiogroup" aria-label="View" className="flex gap-0.5 rounded-lg bg-muted p-0.5">
          {(
            [
              { id: 'lineage', label: 'Lineage', icon: GitCommitVertical },
              { id: 'map', label: 'Map', icon: Network },
            ] as const
          ).map((v) => (
            <button
              key={v.id}
              type="button"
              role="radio"
              aria-checked={view === v.id}
              onClick={() => setView(v.id)}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring',
                view === v.id ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <v.icon className="size-3.5" />
              {v.label}
            </button>
          ))}
        </div>
      </div>

      {view === 'lineage' ? (
        <div className="grid min-h-0 flex-1 grid-cols-[15.5rem_minmax(0,1fr)_17.5rem]">
          <aside className="flex min-h-0 flex-col border-r">
            <BranchTree
              tree={tree}
              focus={focus}
              onFocus={setFocus}
              expanded={expanded}
              onToggle={(name, to) =>
                setCollapsed((all) => {
                  const next = new Set(all)
                  if (to ?? next.has(name)) next.delete(name)
                  else next.add(name)
                  return next
                })
              }
              query={query}
              filter={filter}
            />
          </aside>
          <LineageGraph tree={tree} focus={focus} onFocus={setFocus} selected={selected} onSelect={setSelected} />
          <section className="min-h-0 overflow-y-auto">
            <CommitDetail tree={tree} item={selected} onFocus={setFocus} />
          </section>
        </div>
      ) : (
        <ForkMap
          title={`Fork timeline of ${project}`}
          tree={tree}
          focus={focus}
          shown={shown}
          autoplay={autoplay}
          onOpen={(name) => {
            setFocus(name)
            setView('lineage')
          }}
        />
      )}
    </div>
  )
}
