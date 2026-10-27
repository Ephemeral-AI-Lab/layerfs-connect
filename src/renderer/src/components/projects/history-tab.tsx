import { GitCommitVertical, Network } from 'lucide-react'
import { useMemo, useState } from 'react'

import { Segmented, type SegmentedOption } from '@/components/motion'
import { type BranchFilter, BranchTree, visibleBranches } from '@/components/projects/history/branch-tree'
import { CommitDetail } from '@/components/projects/history/commit-detail'
import { ForkMap } from '@/components/projects/history/fork-map'
import { type HistoryItem, LineageGraph } from '@/components/projects/history/lineage-graph'
import { HashChip, PaneHead, SearchField } from '@/components/projects/history/parts'
import { LoadError, Loading } from '@/components/projects/states'
import { host } from '@/host/client'
import { useHostQuery } from '@/host/use-host'
import { type ForkTree, ancestry, buildForkTree } from '@/data/forks'

export type HistoryView = 'lineage' | 'map'

const VIEWS: SegmentedOption<HistoryView>[] = [
  { value: 'lineage', label: 'Lineage', icon: GitCommitVertical },
  { value: 'map', label: 'Map', icon: Network },
]

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

  const counts = { all: branches.length - 1, open, done: branches.length - 1 - open }
  const filters = FILTERS.map((f) => ({ value: f.id, label: f.label, count: counts[f.id] }))
  const kind = selected?.kind === 'layer' ? 'Layer' : 'Commit'

  return (
    <div className="hist-frame flex h-0 min-h-[30rem] flex-1 flex-col overflow-hidden rounded-2xl">
      <div className="flex items-center gap-3 border-b bg-muted/25 px-3 py-2">
        <SearchField label="Find a Branch or Commit" value={query} onChange={setQuery} className="w-60" />
        <Segmented aria-label="Show Branches" value={filter} onChange={setFilter} options={filters} />
        <span className="min-w-0 flex-1 truncate text-right text-xs text-muted-foreground tabular-nums">
          {tree.branches.size === 1
            ? 'No Branches yet'
            : `${tree.branches.size - 1} Branch${tree.branches.size === 2 ? '' : 'es'} · ${open} open · forks ${deepest} deep`}
          {' · '}
          {tree.commits.size} Commit{tree.commits.size === 1 ? '' : 's'}
          {tree.layers[0] && (
            <>
              {' · main at '}
              <HashChip id={tree.layers[0].id} className="ml-0.5 text-[11px]" />
            </>
          )}
        </span>
        <Segmented aria-label="View" value={view} onChange={setView} options={VIEWS} />
      </div>

      {view === 'lineage' ? (
        <div key="lineage" className="hist-swap grid min-h-0 flex-1 grid-cols-[15.5rem_minmax(0,1fr)_18rem]">
          <aside aria-label="Branches" className="hist-side flex min-h-0 flex-col border-r">
            <PaneHead label="Branches" count={shown.size} />
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
              onClear={() => {
                setQuery('')
                setFilter('all')
              }}
            />
          </aside>
          <LineageGraph tree={tree} focus={focus} onFocus={setFocus} selected={selected} onSelect={setSelected} />
          <section aria-label={`${kind} detail`} className="hist-side min-h-0 overflow-y-auto">
            <PaneHead label={selected ? kind : 'Detail'} />
            <div key={selected ? `${selected.kind}:${selected.id}` : 'none'} className="hist-swap">
              <CommitDetail tree={tree} item={selected} onFocus={setFocus} />
            </div>
          </section>
        </div>
      ) : (
        <div key="map" className="hist-swap flex min-h-0 flex-1 flex-col">
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
        </div>
      )}
    </div>
  )
}
