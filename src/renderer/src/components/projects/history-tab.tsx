import { t, useI18n } from '@/i18n'
import { CircleAlert, GitCommitVertical, Network, X } from 'lucide-react'
import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react'
import { projectLabel, type CommitInfo, type ProjectState } from '@shared/host-api'

import { Segmented, type SegmentedOption } from '@/components/motion'
import { type BranchFilter, BranchTree, visibleBranches } from '@/components/projects/history/branch-tree'
import { CommitDetail } from '@/components/projects/history/commit-detail'
import { ForkMap } from '@/components/projects/history/fork-map'
import { type HistoryItem, LineageGraph } from '@/components/projects/history/lineage-graph'
import { HashChip, PaneHead, SearchField } from '@/components/projects/history/parts'
import { Empty, LoadError, Loading } from '@/components/projects/states'
import { host } from '@/host/client'
import { useHostQuery } from '@/host/use-host'
import { type ForkTree, ancestry, buildForkTree } from '@/data/forks'

export type HistoryView = 'lineage' | 'map'

const VIEWS: SegmentedOption<HistoryView>[] = [
  { value: 'lineage', label: 'Lineage', icon: GitCommitVertical },
  { value: 'map', label: 'Map', icon: Network },
]

/** The Map in 3D (three.js), loaded only when it is asked for. */
const Citadel = lazy(() => import('@/components/projects/history/citadel'))
/** The Map as a game: the castle built by the heroes, replayable (three.js, loaded on demand). */
const CastleGame = lazy(() => import('@/components/projects/history/game/castle-game'))

type MapLook = '2d' | '3d' | 'game'
const LOOK_KEY = 'connect.timeline.view'
const LOOKS = [
  { value: '2d' as const, label: '2D' },
  { value: '3d' as const, label: '3D' },
  { value: 'game' as const, label: 'Game' },
]
/** The 3D and Game views are hidden from the app for now; their code stays, and true brings the switch back. */
const SHOW_VIEWS = false

/** The Map's look, kept on this machine (2D when nothing is kept). */
function useMapLook(): [MapLook, (v: MapLook) => void] {
  const [look, setLook] = useState<MapLook>(() => {
    if (!SHOW_VIEWS) return '2d'
    try {
      const kept = localStorage.getItem(LOOK_KEY)
      return kept === '3d' || kept === 'game' ? kept : '2d'
    } catch {
      return '2d'
    }
  })
  const set = (v: MapLook) => {
    setLook(v)
    try {
      localStorage.setItem(LOOK_KEY, v)
    } catch {
      // not kept: 2D next time
    }
  }
  return [look, set]
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

interface HistoryTabProps {
  /** The LayerFS project's key (`store/name` in a shared Store). */
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
  /** A Commit or Layer to open on: its Branch focused (main for a Layer), it selected. */
  initialItem?: HistoryItem
}

export function HistoryTab({ project, runId, tick = 0, ...rest }: HistoryTabProps) {
  const { locale } = useI18n()
  // the last read of this project: a reread asks only for the Branches whose head moved, all in one call
  const last = useRef<{ project: string; state: ProjectState; commits: Record<string, CommitInfo[]> } | null>(null)
  const q = useHostQuery(async () => {
    const before = last.current?.project === project ? last.current : null
    const state = await host.project(project)
    const heads = new Map(before?.state.branches.map((b) => [b.name, b.head]))
    const moved = state.branches.filter((b) => !before?.commits[b.name] || heads.get(b.name) !== b.head).map((b) => b.name)
    const fresh = moved.length > 0 ? await host.branchCommits(project, moved) : {}
    const commits = Object.fromEntries(state.branches.map((b) => [b.name, fresh[b.name] ?? before?.commits[b.name] ?? []]))
    last.current = { project, state, commits }
    const run = runId ? await host.run(runId).catch(() => undefined) : undefined
    return { state, commits, run }
  }, [project, runId, tick])
  const tree = useMemo(() => q.data && buildForkTree(q.data.state, q.data.commits, q.data.run), [q.data, locale])

  if (!tree) {
    if (q.error) return <LoadError error={q.error} what={t("this project's history")} onRetry={q.reload} />
    return <Loading label={t("Reading Branches and Commits")} />
  }
  if (q.data!.state.branches.length === 0 && q.data!.state.layers.length === 0 && q.data!.state.commits === 0) {
    return <Empty icon={GitCommitVertical} title={t("No history yet")}>{t("No Commits or Layers yet.")}</Empty>
  }
  return <HistoryBody key={`${project}:${rest.initialItem?.id ?? ''}`} project={project} tree={tree} {...rest} />
}

/** Where a Commit or Layer is in the tree: its Branch, or null when the tree does not have it (yet). */
function branchOf(tree: ForkTree, item?: HistoryItem): string | null {
  if (!item) return null
  if (item.kind === 'commit') return tree.commits.get(item.id)?.branch ?? null
  return tree.layers.some((l) => l.id === item.id) ? 'main' : null
}

interface HistoryBodyProps {
  project: string
  tree: ForkTree
  initialBranch?: string
  initialView?: HistoryView
  autoplay?: boolean
  initialItem?: HistoryItem
}

function HistoryBody({ project, tree, initialBranch, initialView = 'lineage', autoplay, initialItem }: HistoryBodyProps) {
  useI18n()
  const firstFocus = () => {
    const at = branchOf(tree, initialItem)
    if (at) return at
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
  const [picked, setSelected] = useState<HistoryItem | undefined>(() => (branchOf(tree, initialItem) ? initialItem : undefined))
  const selected = picked ?? headOf(tree, focus)
  // a linked Commit or Layer this tree does not have: said so, and opened once a later read has it
  const [missing, setMissing] = useState<HistoryItem | undefined>(() => (initialItem && !branchOf(tree, initialItem) ? initialItem : undefined))
  const [view, setView] = useState<HistoryView>(initialItem ? 'lineage' : initialView)
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

  const branches = [...tree.branches.values()]
  const open = branches.filter((b) => b.name !== 'main' && b.state === 'open').length
  const deepest = Math.max(0, ...branches.map((b) => b.depth))

  const counts = { all: branches.length - 1, open, done: branches.length - 1 - open }
  const filters = FILTERS.map((f) => ({ value: f.id, label: t(f.id === 'open' ? 'Running' : f.label), count: counts[f.id] }))
  const kind = selected?.kind === 'layer' ? 'Layer' : 'Commit'
  const [look, setLook] = useMapLook()
  const openBranch = (name: string) => {
    setFocus(name)
    setView('lineage')
  }

  return (
    <div className="hist-frame @container/history flex h-0 min-h-[34rem] flex-1 flex-col overflow-hidden rounded-2xl">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b bg-muted/25 px-3 py-2.5">
        {SHOW_VIEWS && view === 'map' && <Segmented aria-label={t("Map view")} value={look} onChange={setLook} options={LOOKS.map((option) => ({...option, label: typeof option.label === 'string' ? t(option.label) : option.label}))} />}
        <SearchField label={t("Find a Branch or Commit")} value={query} onChange={setQuery} className="min-w-40 flex-1 basis-48" />
        <Segmented aria-label={t("Show Branches")} value={filter} onChange={setFilter} options={filters} />
        <span className="min-w-0 flex-1 truncate text-right text-xs text-muted-foreground tabular-nums @max-[58rem]/history:order-last @max-[58rem]/history:basis-full @max-[58rem]/history:text-left">
          {tree.branches.size === 1
            ? t("No Branches yet")
            : t("{branches} · {count} open · forks {depth} deep", {branches: t(tree.branches.size === 2 ? "{count} Branch" : "{count} Branches", {count: tree.branches.size - 1}), count: open, depth: deepest})}
          {' · '}
          {tree.commits.size} {t(tree.commits.size === 1 ? "Commit" : "Commits")}
          {tree.layers[0] && (
            <>
              {t(" · main at ")}
              <HashChip id={tree.layers[0].id} className="ml-0.5 text-[11px]" />
            </>
          )}
        </span>
        <Segmented aria-label={t("View")} value={view} onChange={setView} options={VIEWS.map((option) => ({...option, label: typeof option.label === 'string' ? t(option.label) : option.label}))} />
      </div>
      {missing && <MissingNote item={missing} onDismiss={() => setMissing(undefined)} />}

      {view === 'lineage' ? (
        <div key="lineage" className="hist-swap grid min-h-0 flex-1 grid-cols-[11rem_minmax(0,1fr)] grid-rows-[minmax(14rem,1fr)_12rem] @min-[58rem]/history:grid-cols-[14rem_minmax(0,1fr)_17rem] @min-[58rem]/history:grid-rows-1">
          <aside aria-label={t("Branches")} className="hist-side flex min-h-0 flex-col border-r">
            <PaneHead label={t("Branches")} count={shown.size} />
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
          <section aria-label={t("{value1} detail", {value1: t(kind)})} className="hist-side col-span-2 min-h-0 overflow-y-auto border-t @min-[58rem]/history:col-span-1 @min-[58rem]/history:border-t-0">
            <PaneHead label={selected ? t(kind) : t("Detail")} />
            <div key={selected ? `${selected.kind}:${selected.id}` : 'none'} className="hist-swap">
              <CommitDetail tree={tree} item={selected} onFocus={setFocus} />
            </div>
          </section>
        </div>
      ) : (
        <div key="map" className="hist-swap flex min-h-0 flex-1 flex-col">
          {look === 'game' ? (
            <Suspense fallback={<Loading label={t("Loading the castle game")} />}>
              <CastleGame tree={tree} onOpen={openBranch} autoplay={autoplay} />
            </Suspense>
          ) : look === '3d' ? (
            <Suspense fallback={<Loading label={t("Loading the 3D view")} />}>
              <Citadel tree={tree} focus={focus} shown={shown} onOpen={openBranch} />
            </Suspense>
          ) : (
            <ForkMap title={t("Fork timeline of {value1}", {value1: projectLabel(project)})} tree={tree} focus={focus} shown={shown} autoplay={autoplay} onOpen={openBranch} />
          )}
        </div>
      )}
    </div>
  )
}

/** A linked Commit or Layer History cannot find: said, not swapped for another Branch's head. */
function MissingNote({ item, onDismiss }: { item: HistoryItem; onDismiss: () => void }) {
  useI18n()
  const kind = item.kind === 'layer' ? 'Layer' : 'Commit'
  return (
    <div role="status" className="flex items-center gap-2 border-b bg-amber-500/10 px-3 py-1.5 text-xs text-amber-900 dark:text-amber-200">
      <CircleAlert className="size-3.5 shrink-0" />
      <span className="min-w-0 flex-1">
        {kind} <HashChip id={item.id} className="mx-0.5 text-[11px]" />{t("is not in this project's history. It may not be read yet (it opens when it is), or its Branch was removed.")}</span>
      <button type="button" onClick={onDismiss} aria-label={t("Dismiss")} className="inline-flex size-5 shrink-0 items-center justify-center rounded outline-none hover:bg-amber-500/20 focus-visible:ring-2 focus-visible:ring-ring">
        <X className="size-3.5" />
      </button>
    </div>
  )
}
