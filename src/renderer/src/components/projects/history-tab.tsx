import { GitCommitVertical, Network, Search } from 'lucide-react'
import { useMemo, useState } from 'react'

import { type BranchFilter, BranchTree, visibleBranches } from '@/components/projects/history/branch-tree'
import { CommitDetail } from '@/components/projects/history/commit-detail'
import { ForkMap } from '@/components/projects/history/fork-map'
import { type HistoryItem, LineageGraph } from '@/components/projects/history/lineage-graph'
import { Input } from '@/components/ui/input'
import { type ForkTree, ancestry, forkTreeFor } from '@/data/forks'
import type { Project } from '@/data/sample'
import { cn } from '@/lib/utils'

export type HistoryView = 'lineage' | 'map'

const FILTERS: { id: BranchFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'open', label: 'Open' },
  { id: 'session', label: 'With a session' },
]

/** The newest thing on a Branch: its head Commit, or main's head Layer. */
function headOf(tree: ForkTree, name: string): HistoryItem | undefined {
  const b = tree.branches.get(name)
  if (name === 'main') return tree.layers[0] && { kind: 'layer', id: tree.layers[0].id }
  if (b?.commits[0]) return { kind: 'commit', id: b.commits[0].id }
  return b?.forkedFrom && { kind: b.forkedFrom.kind, id: b.forkedFrom.id }
}

interface HistoryTabProps {
  project: Project
  /** The session open in the sidebar; its Branch is focused first. */
  currentSession?: string
  /** Dev aid: the Branch to focus and the view to open on. */
  initialBranch?: string
  initialView?: HistoryView
  /** Dev aid: open the Map already replaying. */
  autoplay?: boolean
}

export function HistoryTab({ project, currentSession, initialBranch, initialView = 'lineage', autoplay }: HistoryTabProps) {
  const tree = forkTreeFor(project)
  const firstFocus = () => {
    if (initialBranch && tree.branches.has(initialBranch)) return initialBranch
    const busy = project.sessions.filter((s) => (currentSession ? s.id === currentSession : s.busy)).map((s) => s.id)
    return tree.order.find((n) => busy.includes(tree.branches.get(n)?.session ?? '')) ?? 'main'
  }
  const [focus, setFocusState] = useState(firstFocus)
  const [selected, setSelected] = useState<HistoryItem | undefined>(() => headOf(tree, focus))
  const [view, setView] = useState<HistoryView>(initialView)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<BranchFilter>('all')
  // Open Branches with forks start expanded; merged ones start folded.
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const open = new Set(tree.order.filter((n) => tree.branches.get(n)?.state !== 'merged'))
    for (const b of ancestry(tree, focus)) open.add(b.name)
    return open
  })
  const shown = useMemo(() => visibleBranches(tree, query, filter), [tree, query, filter])

  const setFocus = (name: string) => {
    setFocusState(name)
    setSelected(headOf(tree, name))
    setExpanded((all) => {
      const next = new Set(all)
      for (const b of ancestry(tree, name)) next.add(b.name)
      return next
    })
  }

  const open = [...tree.branches.values()].filter((b) => b.name !== 'main' && b.state === 'open').length
  const deepest = Math.max(...[...tree.branches.values()].map((b) => b.depth))

  return (
    <div className="flex h-[calc(100svh-13.5rem)] min-h-[30rem] flex-col overflow-hidden rounded-2xl border bg-card">
      <div className="flex flex-wrap items-center gap-3 border-b px-3 py-2.5">
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
        <span className="ml-auto text-xs text-muted-foreground">
          {tree.branches.size === 1
            ? 'No Branches yet'
            : `${tree.branches.size - 1} Branch${tree.branches.size === 2 ? '' : 'es'} · ${open} open · forks ${deepest} deep`}{' '}
          · main at {tree.layers[0]?.id}
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
              project={project}
              tree={tree}
              focus={focus}
              onFocus={setFocus}
              expanded={expanded}
              onToggle={(name, to) =>
                setExpanded((all) => {
                  const next = new Set(all)
                  if (to ?? !next.has(name)) next.add(name)
                  else next.delete(name)
                  return next
                })
              }
              query={query}
              filter={filter}
            />
          </aside>
          <LineageGraph project={project} tree={tree} focus={focus} onFocus={setFocus} selected={selected} onSelect={setSelected} />
          <section className="min-h-0 overflow-y-auto">
            <CommitDetail project={project} tree={tree} item={selected} onFocus={setFocus} />
          </section>
        </div>
      ) : (
        <ForkMap
          project={project}
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
