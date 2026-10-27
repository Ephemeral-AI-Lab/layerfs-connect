// A project's Branches as a fork tree, with main as its line of Layers, built
// from what the host reads from LayerFS: project.list_branches (each Branch's
// parent, `forkedFrom` and state), the Layers on main, and
// branch.list_commits per Branch. LayerFS records no author; a Commit's agent
// comes from the run's trace (the call that made it), when a run made it.

import type { BranchInfo, CommitInfo, ProjectState, RunDetail } from '@shared/host-api'

import { ago, toMs } from '@/data/format'

export type BranchState = 'open' | 'merged' | 'published'

export interface FileChange {
  path: string
  /** added, modified, deleted … as LayerFS reports it. */
  kind: string
}

export interface HistoryCommit {
  id: string
  branch: string
  message: string
  /** Epoch ms; 0 when LayerFS did not say. */
  at: number
  ago: string
  parent: string | null
  /** A merge Commit's second parent. */
  merged: string | null
  kind: string | null
  /** The run's agent whose call made it; absent when the trace does not say. */
  by?: string
  changes: FileChange[]
}

/** One publication on main. */
export interface Layer {
  id: string
  at: number
  ago: string
  message: string
  /** The Branch whose publish made this Layer; absent for Init. */
  from?: string
  changes: FileChange[]
}

export interface ForkBranch {
  name: string
  /** Absent for main. */
  parent?: string
  depth: number
  /** What LayerFS records: the Layer or Commit the Branch was forked at. */
  forkedFrom?: { kind: 'layer' | 'commit'; id: string }
  /** Its own Commits, newest first. */
  commits: HistoryCommit[]
  state: BranchState
  /** The Layer its publish made. */
  publishedAs?: string
  /** The run's agent that made most of its Commits. */
  agent?: string
  children: string[]
}

export interface ForkTree {
  /** Newest first. */
  layers: Layer[]
  branches: Map<string, ForkBranch>
  /** Depth-first, oldest fork first, starting with main. */
  order: string[]
  commits: Map<string, HistoryCommit>
  /** The run's agents, root first: their place picks their colour. */
  agents: string[]
  /** Agents with a call in flight right now. */
  busy: Set<string>
}

const stateOf = (s: string): BranchState => (s === 'merged' || s === 'published' ? s : 'open')

/** Which agent's call made each Commit, from the run's trace. */
export function authorsOf(run: RunDetail | undefined): Map<string, string> {
  const by = new Map<string, string>()
  for (const step of run?.steps ?? []) for (const call of step.calls) if (call.commit) by.set(call.commit, call.agent)
  return by
}

/** Builds the tree. `commits` holds each Branch's list_commits answer, newest first. */
export function buildForkTree(state: ProjectState, commits: Record<string, CommitInfo[]>, run?: RunDetail): ForkTree {
  const now = Date.now()
  const authors = authorsOf(run)
  const time = (at: number | null) => toMs(at) ?? 0

  const layerIds = new Set(state.layers.map((l) => l.id))
  const all = new Map<string, HistoryCommit>()
  const ownerOf = new Map<string, string>()
  const branchInfo = new Map<string, BranchInfo>(state.branches.map((b) => [b.name, b]))
  if (!branchInfo.has('main'))
    branchInfo.set('main', { name: 'main', head: state.layers[0]?.id ?? null, parent: null, forkedFrom: null, state: 'open', commits: 0 })

  // A Branch's list_commits may reach back past its fork point into its
  // parent's history; each Commit belongs to the Branch that made it.
  for (const [name, list] of Object.entries(commits)) {
    for (const c of list) {
      const branch = c.branch && branchInfo.has(c.branch) ? c.branch : name
      if (all.has(c.id) && branch !== name) continue
      all.set(c.id, {
        id: c.id,
        branch,
        message: c.message || '(no message)',
        at: time(c.at),
        ago: ago(c.at, now),
        parent: c.parent,
        merged: c.merged ?? null,
        kind: c.kind ?? null,
        by: authors.get(c.id),
        changes: (c.changes ?? []).map((ch) => ({ path: ch.path, kind: ch.kind })),
      })
      ownerOf.set(c.id, branch)
    }
  }

  const branches = new Map<string, ForkBranch>()
  for (const info of branchInfo.values()) {
    const own = [...all.values()].filter((c) => c.branch === info.name).sort((a, b) => b.at - a.at)
    // A Branch with no recorded fork point forked where its oldest Commit's parent is.
    const from = info.forkedFrom ?? (info.name === 'main' ? null : (own[own.length - 1]?.parent ?? null))
    const counts = new Map<string, number>()
    for (const c of own) if (c.by) counts.set(c.by, (counts.get(c.by) ?? 0) + 1)
    branches.set(info.name, {
      name: info.name,
      depth: 0,
      forkedFrom: from ? { kind: layerIds.has(from) ? 'layer' : 'commit', id: from } : undefined,
      commits: own,
      state: info.name === 'main' ? 'open' : stateOf(info.state),
      agent: [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0],
      children: [],
    })
  }

  // Parent: what LayerFS says, else the Branch holding the fork point, else main.
  for (const b of branches.values()) {
    if (b.name === 'main') continue
    const said = branchInfo.get(b.name)?.parent
    const holder = b.forkedFrom?.kind === 'commit' ? ownerOf.get(b.forkedFrom.id) : 'main'
    b.parent = said && branches.has(said) && said !== b.name ? said : holder && holder !== b.name ? holder : 'main'
  }
  // A cycle in what was reported would never reach main: such a Branch hangs off main.
  for (const b of branches.values()) {
    const seen = new Set<string>()
    for (let n: ForkBranch | undefined = b; n?.parent; n = branches.get(n.parent)) {
      if (seen.has(n.name)) {
        b.parent = 'main'
        break
      }
      seen.add(n.name)
    }
  }

  const layers: Layer[] = state.layers
    .map((l) => {
      const from = l.from && branches.has(l.from) ? l.from : l.from ? ownerOf.get(l.from) : undefined
      return { id: l.id, at: time(l.at), ago: ago(l.at, now), message: l.message || 'Publish', from, changes: [] }
    })
    .sort((a, b) => b.at - a.at)
  for (const l of [...layers].reverse()) {
    const b = l.from ? branches.get(l.from) : undefined
    if (b && b.name !== 'main' && !b.publishedAs) b.publishedAs = l.id
  }

  // The fork point's time, for ordering siblings oldest first.
  const forkTime = (b: ForkBranch) =>
    b.forkedFrom ? (all.get(b.forkedFrom.id)?.at ?? layers.find((l) => l.id === b.forkedFrom?.id)?.at ?? 0) : 0
  for (const b of branches.values()) if (b.parent) branches.get(b.parent)?.children.push(b.name)
  for (const b of branches.values())
    b.children.sort((x, y) => forkTime(branches.get(x)!) - forkTime(branches.get(y)!) || x.localeCompare(y))

  const order: string[] = []
  const walk = (name: string, depth: number) => {
    const b = branches.get(name)
    if (!b || order.includes(name)) return
    b.depth = depth
    order.push(name)
    for (const kid of b.children) walk(kid, depth + 1)
  }
  walk('main', 0)

  return {
    layers,
    branches,
    order,
    commits: all,
    agents: run?.agents.map((a) => a.name) ?? [],
    busy: new Set(run?.agents.filter((a) => a.state === 'running').map((a) => a.name) ?? []),
  }
}

/** main, then each Branch from main down to `name`. */
export function ancestry(tree: ForkTree, name: string): ForkBranch[] {
  const path: ForkBranch[] = []
  for (let b = tree.branches.get(name); b && !path.includes(b); b = b.parent ? tree.branches.get(b.parent) : undefined)
    path.unshift(b)
  return path
}
