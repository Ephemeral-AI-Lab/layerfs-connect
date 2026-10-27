// A project's Branches as a fork tree, with main as its line of Layers, the
// way project.list_branches and branch.list_commits report them. LayerFS
// lists each Branch with `forkedFrom`, a Commit or a Layer; Connect derives
// the parent from it: a Layer means main, a Commit means the Branch whose
// history holds that Commit. Forks nest to any depth. Sample data until the
// host process serves the real ones.

import { CHANGES, type Commit, type FileChange, MESSAGES } from '@/data/repo'
import type { Agent, Project } from '@/data/sample'

export type BranchState = 'open' | 'merged' | 'published'

export interface HistoryCommit extends Commit {
  branch: string
  /** Minutes ago; ids rise with time. */
  minutes: number
}

/** One publication on main. */
export interface Layer {
  id: string
  minutes: number
  ago: string
  message: string
  /** The Branch whose publish made this Layer; absent for Init and older ones. */
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
  /** Its own Commits, newest first. main has none: it moves by Layers. */
  commits: HistoryCommit[]
  state: BranchState
  /** The Layer its publish made. */
  publishedAs?: string
  /** The Connect session working on it. */
  session?: string
  children: string[]
}

export interface ForkTree {
  /** Newest first. */
  layers: Layer[]
  branches: Map<string, ForkBranch>
  /** Depth-first, oldest fork first, starting with main. */
  order: string[]
  commits: Map<string, HistoryCommit>
}

export interface Branch {
  name: string
  head: string
  /** Commits on it that its parent does not have. */
  ahead: number
  published?: boolean
}

interface Spec {
  name: string
  /** For main's children, a Layer counted back from the newest (-1 is the newest);
   * otherwise the index of the parent's Commit, oldest first. */
  at: number
  n: number
  state?: BranchState
  agent?: Agent
  kids?: Spec[]
}

const TEMPLATE: Spec[] = [
  {
    name: 'spike/search',
    at: -8,
    n: 3,
    kids: [{ name: 'search/index', at: 2, n: 4, kids: [{ name: 'search/ranking', at: 3, n: 2 }] }],
  },
  {
    name: 'feature/checkout',
    at: -6,
    n: 4,
    state: 'published',
    kids: [
      { name: 'checkout/address-form', at: 1, n: 3, state: 'merged' },
      {
        name: 'checkout/payment',
        at: 2,
        n: 5,
        agent: 'builder',
        kids: [
          { name: 'payment/stripe-mock', at: 1, n: 2, state: 'merged' },
          {
            name: 'payment/refunds',
            at: 3,
            n: 3,
            kids: [
              {
                name: 'refunds/partial',
                at: 1,
                n: 2,
                kids: [{ name: 'refunds/partial-tests', at: 1, n: 1, agent: 'tester' }],
              },
            ],
          },
        ],
      },
    ],
  },
  { name: 'fix/cart-total', at: -4, n: 2, state: 'published' },
  {
    name: 'review/cart-api',
    at: -3,
    n: 2,
    agent: 'reviewer',
    kids: [{ name: 'review/cart-api-notes', at: 1, n: 1 }],
  },
  {
    name: 'tests/flaky',
    at: -2,
    n: 3,
    kids: [
      { name: 'tests/flaky-retry', at: 0, n: 2, state: 'merged' },
      { name: 'tests/flaky-seed', at: 1, n: 2 },
    ],
  },
  { name: 'docs/api', at: -1, n: 2, agent: 'docs' },
]

/** How many of the template's top-level Branches each sample project has. */
const TOP_LEVEL: Record<string, number> = { shop: 6, wayfare: 5, quarry: 4, depot: 2, 'docs-site': 1, archive: 0 }

const STEPS = [
  'Start {t}',
  'Sketch {t}',
  'Wire {t} into the page',
  'Test {t}',
  'Fix a {t} edge case',
  'Tidy {t}',
  'Cover {t} in test.sh',
]

const LAYER_GAP = 45

export function ago(minutes: number): string {
  const m = Math.round(minutes)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  if (m < 24 * 60) return `${Math.round(m / 60)} h ago`
  if (m < 48 * 60) return 'yesterday'
  return `${Math.round(m / (24 * 60))} days ago`
}

function hash(text: string) {
  let h = 0
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return h
}

const headNumber = (project: Project) => Number(project.lastCommit.id.replace(/\D/g, '')) || 1

function build(project: Project): ForkTree {
  const layerCount = Math.min(Math.max(Math.round(headNumber(project) / 2), 1), 20)
  const layers: Layer[] = Array.from({ length: layerCount }, (_, i) => {
    const minutes = (layerCount - i) * LAYER_GAP + 3
    return {
      id: `L${i + 1}`,
      minutes,
      ago: ago(minutes),
      message: i === 0 ? 'Init' : (MESSAGES[(layerCount - 1 - i) % (MESSAGES.length - 1)] ?? 'Update files'),
      changes: i === 0 ? [{ path: '/', added: 120, removed: 0 }] : (CHANGES[(i * 5) % (CHANGES.length - 1)] ?? []),
    }
  })

  const branches = new Map<string, ForkBranch>()
  const order: string[] = ['main']
  const all: HistoryCommit[] = []
  branches.set('main', { name: 'main', depth: 0, commits: [], state: 'open', children: [] })

  const place = (spec: Spec, parent: ForkBranch) => {
    let forkedFrom: ForkBranch['forkedFrom']
    let forkMinutes: number
    let endMinutes = 0
    let publishedAs: string | undefined
    if (parent.name === 'main') {
      const index = Math.min(Math.max(layerCount + spec.at, 0), layerCount - 1)
      forkedFrom = { kind: 'layer', id: layers[index].id }
      forkMinutes = layers[index].minutes
      // A published Branch's Commits come before the Layer its publish made.
      if (spec.state === 'published' && index + 1 < layerCount) {
        publishedAs = layers[index + 1].id
        endMinutes = layers[index + 1].minutes
        layers[index + 1].from = spec.name
        layers[index + 1].message = `Publish ${spec.name}`
      }
    } else {
      const oldestFirst = [...parent.commits].reverse()
      const at = oldestFirst[Math.min(spec.at, oldestFirst.length - 1)]
      forkedFrom = { kind: 'commit', id: at.id }
      forkMinutes = at.minutes
    }

    const session = spec.agent ? project.sessions.find((s) => s.agent === spec.agent) : undefined
    const topic = (spec.name.split('/').pop() ?? spec.name).replace(/-/g, ' ')
    const seed = hash(spec.name)
    const commits: HistoryCommit[] = Array.from({ length: spec.n }, (_, j) => {
      const minutes = endMinutes + ((forkMinutes - endMinutes) * (spec.n - j)) / (spec.n + 1)
      const other = project.sessions[(seed + j) % project.sessions.length]
      const by = session
        ? { session: session.id, agent: session.agent }
        : j % 3 === 2 || !other
          ? undefined
          : { session: other.id, agent: other.agent }
      return {
        id: '',
        branch: spec.name,
        minutes,
        ago: ago(minutes),
        message: (j === 0 ? STEPS[0] : STEPS[1 + ((seed + j) % (STEPS.length - 1))]).replace('{t}', topic),
        by,
        changes: CHANGES[(seed + j) % (CHANGES.length - 1)] ?? [],
      }
    }).reverse()
    all.push(...commits)

    const node: ForkBranch = {
      name: spec.name,
      parent: parent.name,
      depth: parent.depth + 1,
      forkedFrom,
      commits,
      state: spec.state ?? 'open',
      publishedAs,
      session: session?.id,
      children: [],
    }
    branches.set(node.name, node)
    parent.children.push(node.name)
    order.push(node.name)
    for (const kid of spec.kids ?? []) place(kid, node)
  }

  const top = TOP_LEVEL[project.key] ?? 2
  for (const spec of top > 0 ? TEMPLATE.slice(-top) : []) place(spec, branches.get('main')!)

  // Commit ids rise with time; the newest is the project's last Commit.
  const byAge = [...all].sort((a, b) => b.minutes - a.minutes)
  const first = Math.max(headNumber(project), byAge.length) - byAge.length + 1
  byAge.forEach((c, i) => {
    c.id = `c${first + i}`
  })
  // Fork points were taken before ids existed; resolve them now.
  for (const b of branches.values()) {
    if (b.forkedFrom?.kind === 'commit') {
      const parent = branches.get(b.parent ?? '')
      const oldestFirst = parent ? [...parent.commits].reverse() : []
      const spec = findSpec(b.name)
      const at = oldestFirst[Math.min(spec?.at ?? 0, oldestFirst.length - 1)]
      if (at) b.forkedFrom = { kind: 'commit', id: at.id }
    }
  }

  return {
    layers: [...layers].reverse(),
    branches,
    order,
    commits: new Map(all.map((c) => [c.id, c])),
  }
}

function findSpec(name: string, specs: Spec[] = TEMPLATE): Spec | undefined {
  for (const s of specs) {
    if (s.name === name) return s
    const found = findSpec(name, s.kids ?? [])
    if (found) return found
  }
  return undefined
}

const cache = new Map<string, ForkTree>()

export function forkTreeFor(project: Project): ForkTree {
  let tree = cache.get(project.key)
  if (!tree) {
    tree = build(project)
    cache.set(project.key, tree)
  }
  return tree
}

/** main, then each Branch from main down to `name`. */
export function ancestry(tree: ForkTree, name: string): ForkBranch[] {
  const path: ForkBranch[] = []
  for (let b = tree.branches.get(name); b; b = b.parent ? tree.branches.get(b.parent) : undefined) path.unshift(b)
  return path
}

/** Branches that are not merged away, for ref pickers and counts. */
export function branchesFor(project: Project): Branch[] {
  const tree = forkTreeFor(project)
  return tree.order
    .map((name) => tree.branches.get(name)!)
    .filter((b) => b.state !== 'merged')
    .map((b) =>
      b.name === 'main'
        ? { name: 'main', head: tree.layers[0]?.id ?? 'L1', ahead: 0, published: true }
        : { name: b.name, head: b.commits[0]?.id ?? b.forkedFrom?.id ?? '', ahead: b.commits.length },
    )
}
