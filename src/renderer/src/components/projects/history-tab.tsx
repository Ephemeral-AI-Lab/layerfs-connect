import { type ReactNode, Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react'
import { CircleAlert, X } from 'lucide-react'

import { Segmented } from '@/components/motion'
import { type BranchFilter, BranchTree, visibleBranches } from '@/components/projects/history/branch-tree'
import { CommitDetail } from '@/components/projects/history/commit-detail'
import { ForkMap } from '@/components/projects/history/fork-map'
import { type HistoryItem, LineageGraph } from '@/components/projects/history/lineage-graph'
import { HashChip, PaneHead, SearchField } from '@/components/projects/history/parts'
import { LoadError, Loading } from '@/components/projects/states'
import { host } from '@/host/client'
import { lastAnswer, useHostQuery } from '@/host/use-host'
import { type ForkTree, ancestry, buildForkTree } from '@/data/forks'
import type { CommitInfo, ProjectState, RunDetail } from '@shared/host-api'

/** Timeline in 3D (three.js), loaded only when it is asked for. */
const Citadel = lazy(() => import('@/components/projects/history/citadel'))
/** Timeline as a game: the castle built by the heroes, replayable (three.js, loaded on demand). */
const CastleGame = lazy(() => import('@/components/projects/history/game/castle-game'))

type TimelineView = '2d' | '3d' | 'game'
const VIEW_KEY = 'connect.timeline.view'
const VIEWS = [
  { value: '2d' as const, label: '2D' },
  { value: '3d' as const, label: '3D' },
  { value: 'game' as const, label: 'Game' },
]
/** The 3D and Game views are hidden from the app for now; their code stays, and true brings the switch back. */
const SHOW_VIEWS = false

/** The Timeline's view, kept on this machine (2D when nothing is kept). */
function useTimelineView(): [TimelineView, (v: TimelineView) => void] {
  const [view, setView] = useState<TimelineView>(() => {
    if (!SHOW_VIEWS) return '2d'
    try {
      const kept = localStorage.getItem(VIEW_KEY)
      return kept === '3d' || kept === 'game' ? kept : '2d'
    } catch {
      return '2d'
    }
  })
  const set = (v: TimelineView) => {
    setView(v)
    try {
      localStorage.setItem(VIEW_KEY, v)
    } catch {
      // not kept: 2D next time
    }
  }
  return [view, set]
}

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

/** The Branch to open on: the one asked for, else one an agent is working on now, else the one with the newest Commit. */
function firstFocus(tree: ForkTree, initialBranch?: string): string {
  if (initialBranch && tree.branches.has(initialBranch)) return initialBranch
  const busy = tree.order.find((n) => {
    const agent = tree.branches.get(n)?.agent
    return n !== 'main' && agent !== undefined && tree.busy.has(agent)
  })
  const newest = [...tree.commits.values()].sort((a, b) => b.at - a.at)[0]
  return busy ?? newest?.branch ?? 'main'
}

interface TreeProps {
  /** The LayerFS project. */
  project: string
  /** The run that made it: its trace names each Commit's agent. */
  runId?: string
  /** Changes when the run moved on, so the history reloads. */
  tick?: number
}

interface ForkData {
  state: ProjectState
  commits: Record<string, CommitInfo[]>
  run: RunDetail | undefined
  /** Drawn from the last project read another tab made: read again at once. */
  provisional?: boolean
}

/**
 * The project's fork tree, reread as `tick` moves; the loading and error states
 * until it is read. Commits come in one call for all the Branches asked for.
 * The first read, when another tab has read the project, draws from that read
 * (every Branch's Commits and the run, together) and reads again at once,
 * quietly, to catch up what moved since; without one, it reads the project
 * first. A reread asks for the Commits
 * of the Branches whose head moved, and for the run (it names each Commit's
 * agent) only when one did; when none moved it keeps what it has, so the
 * tree is not drawn again. The last tree shows at once when History opens again.
 */
function useForkTree({ project, runId, tick = 0 }: TreeProps) {
  const last = useRef<{ key: string; data: ForkData } | null>(null)
  const key = `forks:${project}:${runId ?? ''}`
  const q = useHostQuery(
    async (): Promise<ForkData> => {
      const before = last.current?.key === key ? last.current.data : undefined
      // the first read: draw from the project read another tab made, then read again (below)
      const seen = lastAnswer<ProjectState>(`project:${project}`)
      if (!before && seen && (seen.project.key ?? seen.project.name) === project) {
        const quick = await Promise.all([host.branchCommits(project, seen.branches.map((b) => b.name)), runId ? host.run(runId).catch(() => undefined) : undefined]).catch(() => null)
        if (quick) {
          const data = { state: seen, commits: quick[0], run: quick[1], provisional: true }
          last.current = { key, data }
          return data
        }
      }
      const state = await host.project(project)
      const known: Record<string, CommitInfo[]> = before?.commits ?? {}
      const heads = new Map(before?.state.branches.map((b) => [b.name, b.head]))
      const moved = state.branches.filter((b) => !known[b.name] || heads.get(b.name) !== b.head)
      const gone = before ? before.state.branches.some((b) => !state.branches.some((x) => x.name === b.name)) : true
      if (before && moved.length === 0 && !gone) {
        if (!before.provisional) return before
        const data = { ...before, state, provisional: false }
        last.current = { key, data }
        return data
      }
      const fresh = moved.length ? await host.branchCommits(project, moved.map((b) => b.name)) : {}
      const commits = Object.fromEntries(state.branches.map((b) => [b.name, fresh[b.name] ?? known[b.name] ?? []]))
      const run = runId ? await host.run(runId).catch(() => before?.run) : undefined
      const data = { state, commits, run }
      last.current = { key, data }
      return data
    },
    [project, runId, tick],
    key,
  )
  // a tree shown from the last visit is what the next reread starts from (never another project's)
  if (q.data && last.current?.key !== key && (q.data.state.project.key ?? q.data.state.project.name) === project) last.current = { key, data: q.data }
  // a tree drawn from another tab's read: catch up at once
  const provisional = q.data?.provisional === true
  const { reload } = q
  useEffect(() => {
    if (provisional) reload()
  }, [provisional, reload])
  const tree = useMemo(() => q.data && buildForkTree(q.data.state, q.data.commits, q.data.run), [q.data])
  const pending = tree ? null : q.error ? (
    <LoadError error={q.error} what="this project's history" onRetry={q.reload} />
  ) : (
    <Loading label="Reading Branches and Commits" />
  )
  return { tree, pending }
}

/** Search and filter over the Branches, and the history's counts. */
function Toolbar({
  tree,
  query,
  onQuery,
  filter,
  onFilter,
  extra,
}: {
  tree: ForkTree
  query: string
  onQuery: (q: string) => void
  filter: BranchFilter
  onFilter: (f: BranchFilter) => void
  /** Shown at the toolbar's start (Timeline's 2D/3D switch). */
  extra?: ReactNode
}) {
  const branches = [...tree.branches.values()]
  const open = branches.filter((b) => b.name !== 'main' && b.state === 'open').length
  const deepest = Math.max(0, ...branches.map((b) => b.depth))
  const counts = { all: branches.length - 1, open, done: branches.length - 1 - open }
  const filters = FILTERS.map((f) => ({ value: f.id, label: f.label, count: counts[f.id] }))
  return (
    <div className="flex items-center gap-3 border-b bg-muted/25 px-3 py-2">
      {extra}
      <SearchField label="Find a Branch or Commit" value={query} onChange={onQuery} className="w-60" />
      <Segmented aria-label="Show Branches" value={filter} onChange={onFilter} options={filters} />
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
    </div>
  )
}

interface HistoryTabProps extends TreeProps {
  /** The Branch to focus. */
  initialBranch?: string
  /** A Commit or Layer to open on: its Branch focused (main for a Layer), it selected. */
  initialItem?: HistoryItem
}

/** History: the Branch tree, the focused Branch's lineage, and the selected Commit or Layer. */
export function HistoryTab({ initialBranch, initialItem, ...source }: HistoryTabProps) {
  const { tree, pending } = useForkTree(source)
  if (!tree) return pending
  return <HistoryBody key={`${source.project}:${initialItem?.id ?? ''}`} tree={tree} initialBranch={initialBranch} initialItem={initialItem} />
}

/** Where a Commit or Layer is in the tree: its Branch, or null when the tree does not have it (yet). */
function branchOf(tree: ForkTree, item?: HistoryItem): string | null {
  if (!item) return null
  if (item.kind === 'commit') return tree.commits.get(item.id)?.branch ?? null
  return tree.layers.some((l) => l.id === item.id) ? 'main' : null
}

function HistoryBody({ tree, initialBranch, initialItem }: { tree: ForkTree; initialBranch?: string; initialItem?: HistoryItem }) {
  const [focusState, setFocusState] = useState(() => branchOf(tree, initialItem) ?? firstFocus(tree, initialBranch))
  const focus = tree.branches.has(focusState) ? focusState : 'main'
  const [picked, setSelected] = useState<HistoryItem | undefined>(() => (branchOf(tree, initialItem) ? initialItem : undefined))
  const selected = picked ?? headOf(tree, focus)
  // a linked Commit or Layer this tree does not have: said so, and opened once a later read has it
  const [missing, setMissing] = useState<HistoryItem | undefined>(() => (initialItem && !branchOf(tree, initialItem) ? initialItem : undefined))
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

  const setFocus = (name: string, item?: HistoryItem) => {
    setFocusState(name)
    setSelected(item)
    setMissing(undefined)
    setCollapsed((all) => {
      const next = new Set(all)
      for (const b of ancestry(tree, name)) next.delete(b.name)
      return next
    })
  }

  const found = branchOf(tree, missing)
  useEffect(() => {
    if (found && missing) setFocus(found, missing)
    // once, when a later read brings the item
  }, [found])

  const kind = selected?.kind === 'layer' ? 'Layer' : 'Commit'

  return (
    <div className="hist-frame flex h-0 min-h-[30rem] flex-1 flex-col overflow-hidden rounded-2xl">
      <Toolbar tree={tree} query={query} onQuery={setQuery} filter={filter} onFilter={setFilter} />
      {missing && <MissingNote item={missing} onDismiss={() => setMissing(undefined)} />}
      <div className="hist-swap grid min-h-0 flex-1 grid-cols-[15.5rem_minmax(0,1fr)_18rem]">
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
    </div>
  )
}

/** A linked Commit or Layer History cannot find: said, not swapped for another Branch's head. */
function MissingNote({ item, onDismiss }: { item: HistoryItem; onDismiss: () => void }) {
  const kind = item.kind === 'layer' ? 'Layer' : 'Commit'
  return (
    <div role="status" className="flex items-center gap-2 border-b bg-amber-500/10 px-3 py-1.5 text-xs text-amber-900 dark:text-amber-200">
      <CircleAlert className="size-3.5 shrink-0" />
      <span className="min-w-0 flex-1">
        {kind} <HashChip id={item.id} className="mx-0.5 text-[11px]" /> is not in this project&apos;s history. It may not be read yet (it opens when it is), or its Branch was removed.
      </span>
      <button type="button" onClick={onDismiss} aria-label="Dismiss" className="rounded p-0.5 hover:bg-amber-500/20">
        <X className="size-3.5" />
      </button>
    </div>
  )
}

interface TimelineTabProps extends TreeProps {
  /** Opens a Branch in History. */
  onOpenBranch?: (name: string) => void
  /** Dev aid: start replaying as soon as it opens. */
  autoplay?: boolean
}

/** Timeline: the fork map, main's Layers along a spine and each fork leaving its parent where it forked, replayable. */
export function TimelineTab({ onOpenBranch, autoplay, ...source }: TimelineTabProps) {
  const { tree, pending } = useForkTree(source)
  if (!tree) return pending
  return <TimelineBody key={source.project} project={source.project} tree={tree} onOpenBranch={onOpenBranch} autoplay={autoplay} />
}

function TimelineBody({ project, tree, onOpenBranch, autoplay }: { project: string; tree: ForkTree; onOpenBranch?: (name: string) => void; autoplay?: boolean }) {
  const [focusState, setFocus] = useState(() => firstFocus(tree))
  const focus = tree.branches.has(focusState) ? focusState : 'main'
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<BranchFilter>('all')
  const shown = useMemo(() => visibleBranches(tree, query, filter), [tree, query, filter])
  const [view, setView] = useTimelineView()
  const open = (name: string) => (onOpenBranch ? onOpenBranch(name) : setFocus(name))
  return (
    <div className="hist-frame flex h-0 min-h-[30rem] flex-1 flex-col overflow-hidden rounded-2xl">
      <Toolbar
        tree={tree}
        query={query}
        onQuery={setQuery}
        filter={filter}
        onFilter={setFilter}
        extra={SHOW_VIEWS ? <Segmented aria-label="Timeline view" value={view} onChange={setView} options={VIEWS} /> : undefined}
      />
      <div className="hist-swap flex min-h-0 flex-1 flex-col">
        {view === 'game' ? (
          <Suspense fallback={<Loading label="Loading the castle game" />}>
            <CastleGame tree={tree} onOpen={open} autoplay={autoplay} />
          </Suspense>
        ) : view === '3d' ? (
          <Suspense fallback={<Loading label="Loading the 3D view" />}>
            <Citadel tree={tree} focus={focus} shown={shown} onOpen={open} />
          </Suspense>
        ) : (
          <ForkMap title={`Fork timeline of ${project}`} tree={tree} focus={focus} shown={shown} autoplay={autoplay} onOpen={open} />
        )}
      </div>
    </div>
  )
}
