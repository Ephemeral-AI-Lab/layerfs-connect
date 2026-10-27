// A made-up but believable project history: agents fork Branches off main's
// head Layer (or off a Commit on another Branch), commit in bursts, merge
// Branches into their parent or a sibling, and publish to main. It drives the
// castle game during development and the in-app "Simulate" demo, whole or one
// step at a time. Seeded: the same seed and steps give the same history.
import type { BranchState, FileChange, ForkBranch, ForkTree, HistoryCommit, Layer } from '@/data/forks'

import { ago } from '@/data/format'

type Kind = 'commit' | 'fork' | 'merge' | 'publish'

export interface SimOptions {
  seed?: number
  /** Epoch ms of Init; default now - 3 days (for whole histories). */
  start?: number
  agents?: string[]
  /** Relative weights of actions; sensible defaults. */
  weights?: Partial<Record<Kind, number>>
  /** Keep at most this many open Branches (default 18). */
  maxOpen?: number
  /** Deepest fork of a fork, main being 0 (default 4). */
  maxDepth?: number
}

export type SimAction = { kind: Kind; branch: string; id: string; at: number }

export const HEROES = ['axolotl', 'bat', 'bot', 'cactus', 'cloud', 'crab', 'flame', 'frog', 'ghost', 'jelly', 'penguin', 'shroom', 'snail', 'sprout']

const WEIGHTS: Record<Kind, number> = { commit: 76, fork: 10.5, merge: 3.9, publish: 4.4 }
const DAY = 24 * 3600_000
/** How many recent actions count an agent as busy. */
const BUSY_WINDOW = 6

// ---- randomness -------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ---- what agents work on ----------------------------------------------------------

type Prefix = 'feat' | 'fix' | 'refactor' | 'docs' | 'exp' | 'test' | 'perf' | 'chore'

interface Topic {
  prefix: Prefix
  slug: string
  area: string
  /** How messages name it: "login form". */
  phrase: string
  /** fix: what goes wrong, "race condition". */
  problem?: string
}

const PREFIXES: [Prefix, number][] = [
  ['feat', 34],
  ['fix', 26],
  ['refactor', 10],
  ['docs', 8],
  ['exp', 7],
  ['test', 7],
  ['perf', 5],
  ['chore', 3],
]

/** Source files per area (src/<area>/<name>.ts). */
const AREAS: Record<string, string[]> = {
  auth: ['session', 'login', 'tokens', 'middleware', 'password'],
  cache: ['store', 'keys', 'eviction', 'index'],
  api: ['routes', 'client', 'errors', 'schema', 'handlers'],
  ui: ['button', 'theme', 'layout', 'modal', 'shortcuts'],
  search: ['query', 'index', 'ranking', 'filters'],
  billing: ['invoices', 'plans', 'usage', 'stripe'],
  scheduler: ['cron', 'jobs', 'worker', 'clock'],
  storage: ['blobs', 's3', 'local', 'thumbnails'],
  sync: ['replica', 'conflicts', 'offline', 'protocol'],
  parser: ['lexer', 'grammar', 'ast', 'errors'],
  router: ['routes', 'matcher', 'guards', 'links'],
  queue: ['worker', 'retry', 'dlq', 'producer'],
  notify: ['email', 'push', 'digest', 'templates'],
  editor: ['state', 'toolbar', 'markdown', 'autosave'],
  export: ['csv', 'pdf', 'formats', 'writer'],
  metrics: ['counters', 'dashboard', 'sink', 'labels'],
  config: ['loader', 'schema', 'profiles', 'env'],
  cli: ['args', 'init', 'commands', 'output'],
  db: ['models', 'migrations', 'queries', 'pool'],
  upload: ['chunker', 'resumable', 'dropzone', 'progress'],
}
const AREA_NAMES = Object.keys(AREAS)
const TSX = new Set(['ui', 'editor'])
const TOOLING = ['package.json', 'pnpm-lock.yaml', '.github/workflows/ci.yml', 'tsconfig.json', 'eslint.config.js', '.nvmrc']

// "slug:area" or "slug:area:Phrase"
const TOPICS: Record<Exclude<Prefix, 'fix' | 'test'>, string[]> = {
  feat: [
    'login-form:auth', 'oauth-google:auth', 'magic-links:auth', 'team-invites:auth', 'two-factor:auth', 'search-bar:search',
    'fuzzy-search:search', 'saved-filters:search', 'csv-export:export', 'pdf-export:export', 'dark-mode:ui', 'keyboard-shortcuts:ui',
    'command-palette:ui', 'onboarding-tour:ui', 'i18n:ui:i18n', 'drag-drop-upload:upload', 'resumable-upload:upload', 'rate-limiter:api',
    'webhooks:api', 'api-keys:api:API keys', 'pagination:api', 'invoices:billing', 'usage-meter:billing', 'cron-jobs:scheduler',
    'retry-policy:queue', 'dead-letter-queue:queue', 'offline-sync:sync', 'conflict-view:sync', 'email-digest:notify',
    'push-notifications:notify', 'markdown-preview:editor', 'autosave:editor', 'collab-cursors:editor', 'metrics-dashboard:metrics',
    'audit-log:db', 'soft-delete:db', 'cli-init:cli:cli init', 'config-profiles:config', 's3-backend:storage:S3 backend', 'thumbnails:storage',
  ],
  refactor: [
    'scheduler:scheduler', 'router:router', 'storage-layer:storage', 'auth-middleware:auth', 'config-loader:config', 'error-types:api',
    'api-client:api:API client', 'editor-state:editor', 'queue-workers:queue', 'db-models:db', 'ui-forms:ui', 'cli-args:cli', 'metrics-pipeline:metrics',
    'parser:parser', 'sync-protocol:sync', 'upload-chunks:upload', 'billing-plans:billing', 'notify-templates:notify', 'search-ranking:search',
    'cache-keys:cache',
  ],
  docs: [
    'readme:cli:README', 'api-reference:api:API reference', 'contributing:config', 'quickstart:cli', 'architecture:sync', 'deploy-guide:config',
    'changelog:config', 'faq:ui:FAQ', 'auth-guide:auth', 'cli-usage:cli:CLI usage', 'config-options:config', 'troubleshooting:api',
    'billing-guide:billing', 'search-syntax:search', 'migration-guide:db',
  ],
  exp: [
    'vector-index:search', 'wasm-parser:parser:WASM parser', 'sqlite-cache:cache:SQLite cache', 'edge-runtime:api', 'streaming-render:ui',
    'crdt-sync:sync:CRDT sync', 'bloom-filter:cache', 'llm-summaries:notify:LLM summaries', 'zstd-blobs:storage:zstd blobs', 'worker-pool:queue',
    'incremental-index:search', 'web-workers:editor', 'columnar-export:export', 'lsm-store:db:LSM store',
  ],
  perf: [
    'cold-start:cli', 'query-batching:db', 'lazy-routes:router', 'image-cache:storage', 'bundle-split:ui', 'index-scan:search',
    'render-memo:editor', 'gzip-assets:api', 'connection-pool:db', 'hot-path-alloc:parser:hot path allocations', 'debounce-sync:sync',
    'queue-throughput:queue',
  ],
  chore: [
    'deps-bump:config:dependencies', 'eslint-upgrade:config:ESLint', 'ci-cache:config:CI caching', 'node-22:config:Node 22',
    'typescript-5-6:config:TypeScript 5.6', 'renovate-config:config:Renovate', 'prettier-3:config:Prettier 3',
  ],
}
const FEAT_THINGS = ['settings', 'filters', 'bulk-actions', 'preview', 'history', 'import', 'sharing', 'templates', 'permissions', 'audit']
const FIX_NOUNS: [string, string][] = [
  ['cache', 'cache'], ['session', 'auth'], ['upload', 'upload'], ['scheduler', 'scheduler'], ['parser', 'parser'], ['router', 'router'],
  ['websocket', 'sync'], ['queue', 'queue'], ['token-refresh', 'auth'], ['migrations', 'db'], ['search-index', 'search'], ['export', 'export'],
  ['invoice-totals', 'billing'], ['autosave', 'editor'], ['config', 'config'], ['metrics', 'metrics'], ['cli', 'cli'], ['thumbnails', 'storage'],
]
const FIX_PROBLEMS: [string, string][] = [
  ['race', 'race condition'], ['leak', 'memory leak'], ['timeout', 'timeout'], ['crash', 'crash'], ['null-check', 'null dereference'],
  ['off-by-one', 'off-by-one'], ['encoding', 'encoding bug'], ['deadlock', 'deadlock'], ['double-submit', 'double submit'],
  ['stale-read', 'stale reads'], ['retry-storm', 'retry storm'], ['tz-offset', 'timezone offset'], ['flaky-test', 'flaky test'], ['overflow', 'overflow'],
]
const TEST_KINDS = ['e2e', 'fixtures', 'coverage', 'snapshots', 'property-tests']
const NEST = ['retry', 'v2', 'alt', 'followup', 'tests', 'cleanup', 'spike', 'split', 'edge-cases', 'perf']

// {t} the topic's phrase, {a} its area, {p} a fix's problem. The first is a
// Branch's usual opening Commit.
const MESSAGES: Record<Prefix, string[]> = {
  feat: [
    'Add {t} skeleton', 'Wire up {t} handler', 'Add validation to {t}', 'Add tests for {t}', 'Put {t} behind a flag',
    'Persist {t} settings', 'Expose {t} in the API', 'Document {t}', 'Add types for {t}', 'Cover {t} edge cases', 'Track {t} usage',
    'Hook {t} into {a}', 'Return clear errors from {t}', 'Add config options for {t}', 'Handle retries in {t}',
  ],
  fix: [
    'Reproduce {t} {p} in a test', 'Fix {p} in {t}', 'Add regression test for {t} {p}', 'Guard {t} against {p}',
    'Log more context around {t} {p}', 'Add timeout to {t} calls', 'Lock around {t} writes', 'Handle {t} errors explicitly',
    'Remove workaround for {t} {p}', 'Clean up {t} {p} fix', 'Retry {t} once before failing',
  ],
  refactor: [
    'Extract {t} helpers', 'Split {t} into modules', 'Rename {t} types', 'Inline unused {t} wrapper', 'Move {t} into src/{a}',
    'Simplify {t} control flow', 'Remove dead code in {t}', 'Type {t} errors', 'Replace callbacks with async in {t}', 'Deduplicate {t} constants',
  ],
  docs: [
    'Draft {t}', 'Add examples to {t}', 'Fix typos in {t}', 'Clarify {t} wording', 'Add diagram to {t}', 'Link {t} from the index',
    'Update {t} for the new API', 'Document {a} options in {t}',
  ],
  exp: [
    'Prototype {t}', 'Benchmark {t}', 'Try {t} with real data', 'Measure {t} memory', 'Sketch {t} interface', 'Write up {t} findings',
    'Compare {t} against baseline', 'Tune {t} parameters',
  ],
  test: [
    'Add {t}', 'Add fixtures for {t}', 'Stabilize {t}', 'Speed up {t}', 'Cover error paths in {t}', 'Run {t} in CI', 'Seed data for {t}',
    'Split slow {t}',
  ],
  perf: [
    'Profile {t}', 'Cache results for {t}', 'Batch work in {t}', 'Avoid extra allocations in {t}', 'Memoize {t} lookups',
    'Add benchmark for {t}', 'Lazy-load {t}', 'Drop redundant work in {t}',
  ],
  chore: ['Upgrade {t}', 'Update lockfile for {t}', 'Fix build after {t} change', 'Adjust config for {t}', 'Pin {t} version'],
}
/** feat on a screen: these too. */
const FEAT_UI = [
  'Handle empty state in {t}', 'Add loading state to {t}', 'Support keyboard nav in {t}', 'Polish {t} styles',
  'Add i18n strings for {t}', 'Split {t} into components', 'Show errors in {t}',
]
const UI_AREAS = new Set(['ui', 'editor', 'upload', 'search', 'export'])
/** Once a Branch has used every message of its kind. */
const FOLLOWUPS = ['Iterate on {t}', 'Follow up on {t} review', 'Tweak {t} after testing', 'More {t} cleanup', 'Small {t} fixes']
const CHATTER = [
  'Address review comments', 'Fix lint', 'Tidy imports', 'Fix typo', 'Rename variables for clarity', 'Bump test timeout',
  'Update snapshots', 'Remove debug logging', 'Format files', 'Fix types after rebase',
]

const srcOf = (area: string, f: string) => `src/${area}/${f}.${TSX.has(area) ? 'tsx' : 'ts'}`
const testOf = (area: string, f: string) => `tests/${area}/${f}.test.ts`
const phraseOf = (slug: string) => slug.replace(/-/g, ' ')

function parseTopic(prefix: Prefix, entry: string): Topic {
  const [slug, area, phrase] = entry.split(':')
  return { prefix, slug, area, phrase: phrase ?? phraseOf(slug) }
}

// ---- the simulator ----------------------------------------------------------------

interface Rec {
  name: string
  parent: string
  depth: number
  from: { kind: 'layer' | 'commit'; id: string; at: number }
  /** Oldest first; never handed out (snapshots copy). */
  commits: HistoryCommit[]
  state: BranchState
  publishedAs?: string
  owner: string
  topic: Topic
  /** Paths it works on: true while the file exists in its view. */
  files: Map<string, boolean>
  /** Message templates it already used. */
  used: Set<number>
  children: string[]
  born: number
  touched: number
}

interface InternalLayer {
  id: string
  at: number
  message: string
  from?: string
}

export class HistorySim {
  private rng: () => number
  private weights: Record<Kind, number>
  private maxOpen: number
  private maxDepth: number
  private heroes: string[]
  private clock: number
  private pending: number | null = null
  private n = 0
  private layers: InternalLayer[] = []
  private recs = new Map<string, Rec>()
  /** The open Branches, oldest fork first. */
  private owners = new Map<string, Rec>()
  /** Open Branches by parent, oldest fork first. */
  private openKids = new Map<string, Set<Rec>>()
  private mainKids: string[] = []
  private ids = new Set<string>()
  private names = new Set<string>(['main'])
  /** Next number to try per taken name. */
  private nextNo = new Map<string, number>()
  private existing = new Set<string>()
  private agentOrder: string[] = []
  private agentSeen = new Set<string>()
  /** Action number and owner of each recent commit or merge. */
  private recent: { n: number; agent: string }[] = []
  private last: Rec | null = null

  constructor(opts: SimOptions = {}) {
    this.rng = mulberry32(opts.seed ?? 7)
    this.weights = { ...WEIGHTS, ...opts.weights }
    this.maxOpen = Math.max(1, opts.maxOpen ?? 18)
    this.maxDepth = Math.max(1, opts.maxDepth ?? 4)
    this.heroes = opts.agents?.length ? [...opts.agents] : [...HEROES]
    this.clock = opts.start ?? Date.now() - 3 * DAY
    // what main holds at Init
    for (const area of AREA_NAMES) {
      const files = AREAS[area]
      files.slice(0, -1).forEach((f) => this.existing.add(srcOf(area, f)))
      files.slice(0, 2).forEach((f) => this.existing.add(testOf(area, f)))
      if (area.length % 2) this.existing.add(`docs/${area}.md`)
    }
    for (const f of ['README.md', 'docs/README.md', ...TOOLING]) this.existing.add(f)
    this.layers.push({ id: this.id('32'), at: this.clock, message: 'Init' })
  }

  /** One action; returns what it did. */
  step(): SimAction {
    this.n++
    const kind = this.choose()
    if (kind === 'fork') return this.fork()
    if (kind === 'publish') return this.publish()
    if (kind === 'merge') return this.merge()
    return this.commit()
  }

  steps(n: number): SimAction[] {
    const out: SimAction[] = []
    for (let i = 0; i < n; i++) out.push(this.step())
    return out
  }

  /** The next action lands at `t`, or just after the last one when `t` is not later. */
  setClock(t: number): void {
    this.pending = Math.max(this.pending ?? t, t)
  }

  /** Move the whole history in time so its newest action is at `end`. */
  shiftTo(end: number): void {
    const dt = end - this.clock
    if (!dt) return
    for (const l of this.layers) l.at += dt
    for (const r of this.recs.values()) {
      r.from.at += dt
      for (const c of r.commits) c.at += dt
    }
    this.clock += dt
    if (this.pending !== null) this.pending += dt
  }

  /** A fresh snapshot, shaped exactly as buildForkTree builds it. */
  tree(): ForkTree {
    const now = Date.now()
    const commits = new Map<string, HistoryCommit>()
    const branches = new Map<string, ForkBranch>()
    branches.set('main', { name: 'main', depth: 0, forkedFrom: undefined, commits: [], state: 'open', agent: undefined, children: [...this.mainKids] })
    for (const r of this.recs.values()) {
      const own: HistoryCommit[] = []
      for (let i = r.commits.length - 1; i >= 0; i--) {
        const c = r.commits[i]
        const copy: HistoryCommit = {
          id: c.id,
          branch: c.branch,
          message: c.message,
          at: c.at,
          ago: ago(c.at, now),
          parent: c.parent,
          merged: c.merged,
          kind: c.kind,
          by: c.by,
          changes: c.changes.map((ch) => ({ path: ch.path, kind: ch.kind })),
        }
        own.push(copy)
        commits.set(copy.id, copy)
      }
      // keys in buildForkTree's order
      const b: ForkBranch = {
        name: r.name,
        depth: r.depth,
        forkedFrom: { kind: r.from.kind, id: r.from.id },
        commits: own,
        state: r.state,
        agent: mostFrequent(own),
        children: [...r.children],
      }
      b.parent = r.parent
      if (r.publishedAs) b.publishedAs = r.publishedAs
      branches.set(r.name, b)
    }
    const layers: Layer[] = []
    for (let i = this.layers.length - 1; i >= 0; i--) {
      const l = this.layers[i]
      layers.push({ id: l.id, at: l.at, ago: ago(l.at, now), message: l.message, from: l.from, changes: [] })
    }
    const order: string[] = []
    const walk = (name: string) => {
      order.push(name)
      for (const kid of branches.get(name)!.children) walk(kid)
    }
    walk('main')
    const busy = new Set<string>()
    for (const r of this.recent) if (r.n > this.n - BUSY_WINDOW) busy.add(r.agent)
    return { layers, branches, order, commits, agents: [...this.agentOrder], busy }
  }

  // ---- choosing ---------------------------------------------------------------------

  private choose(): Kind {
    const open = this.open()
    if (!open.length) return 'fork'
    const w = { ...this.weights }
    const ready = open.filter((r) => r.commits.length > 0)
    if (!ready.length) w.publish = w.merge = 0
    else if (!ready.some((r) => this.canMerge(r))) w.merge = 0
    if (open.length >= this.maxOpen) {
      w.fork = 0
      w.publish *= 3
      w.merge *= 2.5
    } else if (open.length < Math.min(4, this.maxOpen)) w.fork *= 3
    const kinds: Kind[] = ['commit', 'fork', 'merge', 'publish']
    return this.weighted(kinds, (k) => Math.max(0, w[k])) ?? 'commit'
  }

  private open(): Rec[] {
    return [...this.owners.values()]
  }

  private canMerge(r: Rec): boolean {
    return this.owners.has(r.parent) || (this.openKids.get(r.parent)?.size ?? 0) > 1
  }

  /** Where `r` can merge: its open parent, or an open sibling. */
  private targets(r: Rec): Rec[] {
    const out: Rec[] = []
    const parent = this.owners.get(r.parent)
    if (parent) out.push(parent)
    for (const s of this.openKids.get(r.parent) ?? []) if (s !== r) out.push(s)
    return out
  }

  // ---- acting -----------------------------------------------------------------------

  private fork(): SimAction {
    const head = this.layers[this.layers.length - 1]
    const holders = this.open().filter((r) => r.commits.length > 0 && r.depth < this.maxDepth)
    let parent: Rec | undefined
    let from: Rec['from'] = { kind: 'layer', id: head.id, at: head.at }
    if (holders.length && this.rng() < 0.28) {
      // deeper Branches fork less, gently so when deep forks are allowed
      const damp = 4 / this.maxDepth
      parent = this.weighted(holders, (r) => Math.min(r.commits.length, 6) / r.depth ** damp)!
      const at = this.rng() < 0.7 ? parent.commits.length - 1 : this.int(0, parent.commits.length - 1)
      const c = parent.commits[at]
      from = { kind: 'commit', id: c.id, at: c.at }
    }
    let topic: Topic
    let name: string
    if (parent && this.rng() < 0.45) {
      topic = parent.topic
      name = this.unique(`${parent.name}-${this.pick(NEST)}`)
    } else {
      topic = this.topic(parent?.topic.area)
      name = this.unique(`${topic.prefix}/${topic.slug}`)
    }
    const owner = parent && this.rng() < 0.5 ? parent.owner : this.freeAgent()
    const files = new Map<string, boolean>()
    const view = (p: string) => parent?.files.get(p) ?? this.existing.has(p)
    for (const p of this.workingSet(topic)) files.set(p, view(p))
    if (parent && topic === parent.topic) for (const [p, ok] of parent.files) if (this.rng() < 0.5) files.set(p, ok)
    const r: Rec = {
      name,
      parent: parent?.name ?? 'main',
      depth: (parent?.depth ?? 0) + 1,
      from,
      commits: [],
      state: 'open',
      owner,
      topic,
      files,
      used: new Set(),
      children: [],
      born: this.n,
      touched: this.n,
    }
    this.recs.set(name, r)
    this.owners.set(name, r)
    let kin = this.openKids.get(r.parent)
    if (!kin) this.openKids.set(r.parent, (kin = new Set()))
    kin.add(r)
    this.seen(owner)
    // siblings oldest fork point first, then by name, as buildForkTree sorts them
    const kids = parent ? parent.children : this.mainKids
    const forkAt = (k: string) => this.recs.get(k)!.from.at
    let i = kids.length
    while (i > 0 && (forkAt(kids[i - 1]) > from.at || (forkAt(kids[i - 1]) === from.at && kids[i - 1].localeCompare(name) > 0))) i--
    kids.splice(i, 0, name)
    const at = this.tick(false)
    this.last = r
    return { kind: 'fork', branch: name, id: name, at }
  }

  private commit(): SimAction {
    const open = this.open()
    let r: Rec
    if (this.last && this.last.state === 'open' && this.rng() < 0.55) r = this.last
    else r = this.weighted(open, (b) => (b.commits.length ? 1 : 4) * (1 + 3 / (1 + (this.n - b.touched) / 8)))!
    const by = this.rng() < 0.08 ? this.pick(this.heroes) : r.owner
    const message = this.message(r)
    const changes = this.changes(r)
    const at = this.tick(this.last === r)
    const c = this.add(r, { message, at, merged: null, kind: null, by, changes })
    return { kind: 'commit', branch: r.name, id: c.id, at }
  }

  private merge(): SimAction {
    const sources = this.open().filter((r) => r.commits.length > 0 && this.canMerge(r))
    const src = this.weighted(sources, (r) => {
      const intoParent = this.owners.has(r.parent) ? 3 : 1
      return Math.min(r.commits.length, 8) ** 1.2 * intoParent * (1 + (this.n - r.born) / 80)
    })!
    const parent = this.owners.get(src.parent)
    const siblings = this.targets(src).filter((t) => t !== parent)
    const into = parent && (!siblings.length || this.rng() < 0.75) ? parent : this.pick(siblings)
    const changes: FileChange[] = []
    const paths = [...src.files].filter(([, ok]) => ok).map(([p]) => p)
    for (const p of this.sample(paths.length ? paths : [...src.files.keys()], this.int(1, 4))) {
      const had = into.files.get(p) ?? this.existing.has(p)
      changes.push({ path: p, kind: had ? 'modified' : 'added' })
      into.files.set(p, true)
    }
    const head = src.commits[src.commits.length - 1]
    const at = this.tick(this.last === src || this.last === into)
    const c = this.add(into, { message: `Merge ${src.name} into ${into.name}`, at, merged: head.id, kind: 'merge', by: src.owner, changes })
    this.close(src, 'merged')
    return { kind: 'merge', branch: into.name, id: c.id, at }
  }

  private publish(): SimAction {
    const ready = this.open().filter((r) => r.commits.length > 0)
    const r = this.weighted(ready, (b) => Math.min(b.commits.length, 10) ** 1.6 * (1 + (this.n - b.born) / 60) * (b.depth > 1 ? 0.35 : 1))!
    const at = this.tick(this.last === r)
    const layer: InternalLayer = { id: this.id('32'), at, message: `Publish ${r.name}`, from: r.name }
    this.layers.push(layer)
    for (const [p, ok] of r.files) {
      if (ok) this.existing.add(p)
      else this.existing.delete(p)
    }
    r.publishedAs = layer.id
    this.close(r, 'published')
    this.last = r
    return { kind: 'publish', branch: r.name, id: layer.id, at }
  }

  private add(r: Rec, c: Pick<HistoryCommit, 'message' | 'at' | 'merged' | 'kind' | 'by' | 'changes'>): HistoryCommit {
    const parent = r.commits.length ? r.commits[r.commits.length - 1].id : r.from.id
    const commit: HistoryCommit = { id: this.id('12'), branch: r.name, ago: '', parent, ...c }
    r.commits.push(commit)
    r.touched = this.n
    this.recent.push({ n: this.n, agent: r.owner })
    if (this.recent.length > 16) this.recent.splice(0, this.recent.length - 16)
    if (c.by) this.seen(c.by)
    this.last = r
    return commit
  }

  private close(r: Rec, state: BranchState) {
    r.state = state
    this.owners.delete(r.name)
    this.openKids.get(r.parent)?.delete(r)
  }

  // ---- making things up -------------------------------------------------------------

  private topic(area?: string): Topic {
    for (let tries = 0; tries < 12; tries++) {
      const t = this.freshTopic(area && this.rng() < 0.5 ? area : undefined)
      if (!this.names.has(`${t.prefix}/${t.slug}`)) return t
    }
    return this.freshTopic()
  }

  private freshTopic(area?: string): Topic {
    const prefix = this.weighted(PREFIXES, (p) => p[1])![0]
    if (prefix === 'fix') {
      const nouns = area ? FIX_NOUNS.filter((n) => n[1] === area) : FIX_NOUNS
      const [noun, a] = this.pick(nouns.length ? nouns : FIX_NOUNS)
      const [p, problem] = this.pick(FIX_PROBLEMS)
      return { prefix, slug: `${noun}-${p}`, area: a, phrase: phraseOf(noun), problem }
    }
    if (prefix === 'test') {
      const a = area ?? this.pick(AREA_NAMES)
      const kind = this.pick(TEST_KINDS)
      return { prefix, slug: `${a}-${kind}`, area: a, phrase: `${a} ${phraseOf(kind)}` }
    }
    if (prefix === 'feat' && this.rng() < 0.3) {
      const a = area ?? this.pick(AREA_NAMES)
      const thing = this.pick(FEAT_THINGS)
      return { prefix, slug: `${a}-${thing}`, area: a, phrase: `${a} ${phraseOf(thing)}` }
    }
    const list = TOPICS[prefix].map((e) => parseTopic(prefix, e))
    const near = area ? list.filter((t) => t.area === area) : []
    return this.pick(near.length ? near : list)
  }

  private unique(name: string): string {
    let out = name
    let k = this.nextNo.get(name) ?? 2
    while (this.names.has(out)) out = `${name}-${k++}`
    if (out !== name) this.nextNo.set(name, k)
    this.names.add(out)
    return out
  }

  private workingSet(t: Topic): string[] {
    const files = AREAS[t.area]
    const out = new Set<string>()
    if (t.prefix === 'chore') {
      out.add('package.json')
      for (const f of this.sample(TOOLING.slice(1), this.int(2, 3))) out.add(f)
    } else if (t.prefix === 'docs') {
      out.add(t.slug === 'readme' ? 'README.md' : `docs/${t.slug}.md`)
      out.add(`docs/${t.area}.md`)
      if (this.rng() < 0.4) out.add('docs/README.md')
      if (this.rng() < 0.4) out.add(srcOf(t.area, this.pick(files)))
    } else if (t.prefix === 'test') {
      for (const f of this.sample(files, this.int(2, 3))) out.add(testOf(t.area, f))
      if (this.rng() < 0.5) out.add(`tests/fixtures/${t.area}.json`)
      out.add(srcOf(t.area, this.pick(files)))
    } else {
      if (t.prefix === 'feat' || t.prefix === 'exp') out.add(srcOf(t.area, t.slug))
      for (const f of this.sample(files, this.int(2, 3))) out.add(srcOf(t.area, f))
      for (const f of this.sample(files, this.int(1, 2))) out.add(testOf(t.area, f))
      if (this.rng() < 0.3) out.add(`docs/${t.area}.md`)
      if (t.prefix === 'perf' && this.rng() < 0.5) out.add(`bench/${t.area}.bench.ts`)
    }
    return [...out]
  }

  private message(r: Rec): string {
    if (r.commits.length && this.rng() < 0.1) return this.pick(CHATTER)
    const { prefix, area } = r.topic
    const list = prefix === 'feat' && UI_AREAS.has(area) ? [...MESSAGES.feat, ...FEAT_UI] : MESSAGES[prefix]
    let i = 0
    if (r.commits.length || this.rng() < 0.3) {
      const fresh = list.map((_, k) => k).filter((k) => !r.used.has(k))
      if (!fresh.length) return this.pick(FOLLOWUPS).replace('{t}', r.topic.phrase)
      i = this.pick(fresh)
    }
    r.used.add(i)
    return list[i].replace('{t}', r.topic.phrase).replace('{a}', r.topic.area).replace('{p}', r.topic.problem ?? 'bug')
  }

  private changes(r: Rec): FileChange[] {
    let live = [...r.files.values()].filter(Boolean).length
    // a deleted file comes back now and then
    let paths = [...r.files.keys()].filter((p) => r.files.get(p) || this.rng() < 0.1)
    if (!paths.length) paths = [...r.files.keys()]
    const k = this.weighted([1, 2, 3, 4], (n) => [40, 32, 18, 10][n - 1])!
    const out: FileChange[] = []
    for (const p of this.sample(paths, k)) {
      let kind = 'added'
      if (r.files.get(p)) kind = live > 2 && !p.startsWith(`src/${r.topic.area}/${r.topic.slug}`) && this.rng() < 0.06 ? 'deleted' : 'modified'
      if (kind === 'deleted') live--
      if (kind === 'added') live++
      r.files.set(p, kind !== 'deleted')
      out.push({ path: p, kind })
    }
    return out
  }

  /** An agent with the fewest open Branches, mostly. */
  private freeAgent(): string {
    if (this.rng() < 0.2) return this.pick(this.heroes)
    const load = new Map(this.heroes.map((h) => [h, 0]))
    for (const r of this.owners.values()) load.set(r.owner, (load.get(r.owner) ?? 0) + 1)
    const least = Math.min(...load.values())
    return this.pick(this.heroes.filter((h) => load.get(h) === least))
  }

  private seen(agent: string) {
    if (this.agentSeen.has(agent)) return
    this.agentSeen.add(agent)
    this.agentOrder.push(agent)
  }

  /** The next event's time: seconds apart inside a burst, minutes between, now and then a long pause. */
  private tick(burst: boolean): number {
    const s = burst ? 8 + this.rng() * 110 : this.rng() < 0.05 ? 1500 + this.rng() * 5700 : 40 + this.rng() ** 1.6 * 560
    let at = this.clock + Math.max(1, Math.round(s * 1000))
    if (this.pending !== null) at = Math.max(this.clock + 1, this.pending)
    this.pending = null
    this.clock = at
    return at
  }

  /** A 0x12 (Commit) or 0x32 (Layer) tagged id: the tag, then 64 hex digits. */
  private id(tag: string): string {
    let id = ''
    do {
      id = tag
      for (let i = 0; i < 8; i++) id += (Math.floor(this.rng() * 4294967296) >>> 0).toString(16).padStart(8, '0')
    } while (this.ids.has(id))
    this.ids.add(id)
    return id
  }

  private int(lo: number, hi: number): number {
    return lo + Math.floor(this.rng() * (hi - lo + 1))
  }

  private pick<T>(list: readonly T[]): T {
    return list[Math.floor(this.rng() * list.length)]
  }

  private sample<T>(list: readonly T[], k: number): T[] {
    const pool = [...list]
    const out: T[] = []
    while (out.length < k && pool.length) out.push(pool.splice(Math.floor(this.rng() * pool.length), 1)[0])
    return out
  }

  private weighted<T>(list: readonly T[], weight: (t: T) => number): T | undefined {
    let total = 0
    for (const t of list) total += weight(t)
    if (!(total > 0)) return list[0]
    let x = this.rng() * total
    for (const t of list) {
      x -= weight(t)
      if (x < 0) return t
    }
    return list[list.length - 1]
  }
}

/** The agent with the most Commits, ties to the newest: as buildForkTree picks it. */
function mostFrequent(own: HistoryCommit[]): string | undefined {
  const counts = new Map<string, number>()
  for (const c of own) if (c.by) counts.set(c.by, (counts.get(c.by) ?? 0) + 1)
  let best: string | undefined
  let n = 0
  for (const [k, v] of counts) if (v > n) [best, n] = [k, v]
  return best
}

/** The hero names, then numbered ones ('axolotl-2', …) when `n` asks for more. */
export function agentNames(n: number): string[] {
  const out: string[] = []
  for (let i = 0; i < n; i++) {
    const round = Math.floor(i / HEROES.length)
    out.push(round ? `${HEROES[i % HEROES.length]}-${round + 1}` : HEROES[i])
  }
  return out
}

/**
 * A ready-made busy history. Without `start` it is placed to end about a
 * minute ago, so a live demo can carry on from it with setClock(Date.now()).
 */
export function simulatedHistory(opts: SimOptions & { actions?: number } = {}): HistorySim {
  const { actions = 700, ...rest } = opts
  // the gaps do not depend on the start, so build from 0 and move it after
  const sim = new HistorySim({ ...rest, start: rest.start ?? 0 })
  sim.steps(actions)
  if (rest.start === undefined) sim.shiftTo(Date.now() - 60_000)
  return sim
}

export type SimPresetName = 'tiny' | 'busy' | 'huge' | 'x10' | 'x30' | 'x100'

// Bigger histories run more work at once: more open Branches, deeper forks, more agents.
const PRESETS: Record<SimPresetName, { label: string; opts: SimOptions & { actions: number } }> = {
  tiny: { label: 'Tiny', opts: { actions: 25, maxOpen: 5, weights: { publish: 13, merge: 5 } } },
  busy: { label: 'Busy', opts: { actions: 300 } },
  huge: { label: 'Huge', opts: { actions: 1200, maxOpen: 24 } },
  x10: { label: '10× history', opts: { actions: 12_000, maxOpen: 36, maxDepth: 5, agents: agentNames(28) } },
  x30: { label: '30× history', opts: { actions: 36_000, maxOpen: 60, maxDepth: 6, agents: agentNames(42) } },
  x100: { label: '100× history', opts: { actions: 120_000, maxOpen: 100, maxDepth: 6, agents: agentNames(70) } },
}

/** The presets, smallest first, for the UI to list. */
export const SIM_PRESETS: { id: SimPresetName; label: string; actions: number }[] = (Object.keys(PRESETS) as SimPresetName[]).map((id) => ({
  id,
  label: PRESETS[id].label,
  actions: PRESETS[id].opts.actions,
}))

/** A preset's options, with its action count. */
export function presetOptions(name: SimPresetName): SimOptions & { actions: number } {
  const { opts } = PRESETS[name]
  return { ...opts, agents: opts.agents && [...opts.agents], weights: opts.weights && { ...opts.weights } }
}

export function simPreset(name: SimPresetName, seed?: number): HistorySim {
  return simulatedHistory({ ...presetOptions(name), seed })
}

// ---- invariants -------------------------------------------------------------------

const ID = /^(12|32)[0-9a-f]{64}$/
const CHANGE_KINDS = new Set(['added', 'modified', 'deleted'])

/**
 * What is wrong with a tree, as plain sentences; empty when nothing is. With
 * the actions that made it, also checks each fork's timing.
 */
export function checkTree(tree: ForkTree, actions?: SimAction[]): string[] {
  const out: string[] = []
  const bad = (s: string) => {
    if (out.length < 100) out.push(s)
  }
  const { branches, commits, layers } = tree
  const main = branches.get('main')
  if (!main) return ['no main']
  if (main.parent || main.depth !== 0 || main.forkedFrom || main.commits.length || main.state !== 'open') bad('main is not a bare root')

  // Layers: newest first, Init oldest and plain
  const layerOf = new Map<string, Layer>()
  layers.forEach((l, i) => {
    layerOf.set(l.id, l)
    if (i > 0 && l.at >= layers[i - 1].at) bad(`Layer ${i} is not older than the one before it`)
    if (!l.message) bad(`Layer ${l.id} has no message`)
  })
  const init = layers[layers.length - 1]
  if (!init || init.from || init.message !== 'Init') bad('the oldest Layer is not a plain Init')

  // ids and times unique over every event
  const ids = new Set<string>()
  const times = new Set<number>()
  const event = (id: string, at: number, what: string) => {
    if (!ID.test(id)) bad(`${what} id ${id} is malformed`)
    if (ids.has(id)) bad(`id ${id} used twice`)
    ids.add(id)
    if (!(at > 0)) bad(`${what} ${id} has no time`)
    if (times.has(at)) bad(`two events at ${at}`)
    times.add(at)
    if (init && at < init.at) bad(`${what} ${id} is before Init`)
  }
  for (const l of layers) event(l.id, l.at, 'Layer')
  for (const c of commits.values()) event(c.id, c.at, 'Commit')
  for (const l of layers) if (!l.id.startsWith('32')) bad(`Layer ${l.id} is not tagged 32`)
  for (const c of commits.values()) if (!c.id.startsWith('12')) bad(`Commit ${c.id} is not tagged 12`)

  // Commits on their Branches
  let total = 0
  const mergedBy = new Map<string, HistoryCommit[]>()
  for (const b of branches.values()) {
    total += b.commits.length
    b.commits.forEach((c, i) => {
      if (commits.get(c.id) !== c) bad(`${b.name}: Commit ${c.id} is not the one in commits`)
      if (c.branch !== b.name) bad(`${b.name}: Commit ${c.id} says branch ${c.branch}`)
      if (i > 0 && c.at >= b.commits[i - 1].at) bad(`${b.name}: Commits not newest first at ${i}`)
      const parent = i === b.commits.length - 1 ? (b.forkedFrom?.id ?? null) : b.commits[i + 1].id
      if (c.parent !== parent) bad(`${b.name}: Commit ${c.id} parent ${c.parent} should be ${parent}`)
      if (!c.message) bad(`${b.name}: Commit ${c.id} has no message`)
      if (c.changes.length < 1 || c.changes.length > 4) bad(`${b.name}: Commit ${c.id} has ${c.changes.length} changes`)
      const paths = new Set<string>()
      for (const ch of c.changes) {
        if (!CHANGE_KINDS.has(ch.kind)) bad(`${b.name}: change kind ${ch.kind}`)
        if (!ch.path || paths.has(ch.path)) bad(`${b.name}: Commit ${c.id} change path "${ch.path}" empty or repeated`)
        paths.add(ch.path)
      }
      if (c.merged) {
        mergedBy.set(c.merged, [...(mergedBy.get(c.merged) ?? []), c])
        const m = commits.get(c.merged)
        if (c.kind !== 'merge') bad(`${b.name}: merge Commit ${c.id} kind ${c.kind}`)
        if (!m) bad(`${b.name}: merged ${c.merged} does not exist`)
        else {
          if (m.branch === b.name) bad(`${b.name}: merges its own Commit`)
          if (m.at >= c.at) bad(`${b.name}: merged Commit is not older than the merge`)
          if (c.message !== `Merge ${m.branch} into ${b.name}`) bad(`${b.name}: merge message "${c.message}"`)
          const src = branches.get(m.branch)
          if (src?.state !== 'merged') bad(`${m.branch} was merged but is ${src?.state}`)
          if (src?.commits[0]?.id !== m.id) bad(`${m.branch}: the merged Commit is not its head`)
        }
      } else if (c.kind === 'merge') bad(`${b.name}: Commit ${c.id} is kind merge without a second parent`)
    })
  }
  if (total !== commits.size) bad(`commits holds ${commits.size}, Branches hold ${total}`)

  const forkAt = (b: ForkBranch) =>
    b.forkedFrom ? (commits.get(b.forkedFrom.id)?.at ?? layerOf.get(b.forkedFrom.id)?.at ?? 0) : 0
  const closedAt = new Map<string, number>()
  const kinOf = new Set<string>()
  for (const b of branches.values()) for (const k of b.children) kinOf.add(`${b.name}\n${k}`)
  // Branches
  let kids = 0
  for (const b of branches.values()) {
    for (const k of b.children) {
      kids++
      if (branches.get(k)?.parent !== b.name) bad(`${b.name} lists child ${k} whose parent is ${branches.get(k)?.parent}`)
    }
    for (let i = 1; i < b.children.length; i++) {
      const x = branches.get(b.children[i - 1])
      const y = branches.get(b.children[i])
      if (x && y && (forkAt(x) - forkAt(y) || x.name.localeCompare(y.name)) > 0) bad(`${b.name}: children out of order at ${i}`)
    }
    if (b.name === 'main') continue
    if (!/^[a-z]+\/[a-z0-9-]+$/.test(b.name)) bad(`odd Branch name ${b.name}`)
    const parent = b.parent ? branches.get(b.parent) : undefined
    if (!parent) bad(`${b.name}: parent ${b.parent} missing`)
    else {
      if (!kinOf.has(`${parent.name}\n${b.name}`)) bad(`${b.name}: not among ${parent.name}'s children`)
      if (b.depth !== parent.depth + 1) bad(`${b.name}: depth ${b.depth}, parent's ${parent.depth}`)
    }
    const f = b.forkedFrom
    if (!f) bad(`${b.name}: no fork point`)
    else if (f.kind === 'layer') {
      if (!layerOf.has(f.id)) bad(`${b.name}: fork Layer ${f.id} missing`)
      if (b.parent !== 'main') bad(`${b.name}: forked at a Layer but its parent is ${b.parent}`)
    } else {
      const c = commits.get(f.id)
      if (!c) bad(`${b.name}: fork Commit ${f.id} missing`)
      else if (c.branch !== b.parent) bad(`${b.name}: forked at a Commit on ${c.branch}, parent ${b.parent}`)
    }
    const first = b.commits[b.commits.length - 1]
    if (first && first.at <= forkAt(b)) bad(`${b.name}: first Commit is not after its fork point`)
    const head = b.commits[0]
    if (b.state === 'published') {
      const l = b.publishedAs ? layerOf.get(b.publishedAs) : undefined
      if (!l) bad(`${b.name}: published as ${b.publishedAs}, which is missing`)
      else {
        if (l.from !== b.name) bad(`${b.name}: its Layer says from ${l.from}`)
        if (!head) bad(`${b.name}: published with no Commits`)
        else if (head.at >= l.at) bad(`${b.name}: Commit after its publish`)
        closedAt.set(b.name, l.at)
      }
    } else {
      if (b.publishedAs) bad(`${b.name}: ${b.state} but published as ${b.publishedAs}`)
      if (b.state === 'merged') {
        const by = head ? mergedBy.get(head.id) : undefined
        if (!by || by.length !== 1) bad(`${b.name}: merged, but ${by?.length ?? 0} merges take its head`)
        else closedAt.set(b.name, by[0].at)
      }
    }
    if (b.state === 'open' && head && mergedBy.has(head.id)) bad(`${b.name}: open but its head was merged`)
    if (b.agent !== mostFrequent(b.commits)) bad(`${b.name}: agent ${b.agent} is not its most frequent author`)
  }
  if (kids !== branches.size - 1) bad(`children name ${kids} Branches, there are ${branches.size - 1}`)
  for (const l of layers) {
    if (!l.from) continue
    if (branches.get(l.from)?.publishedAs !== l.id) bad(`Layer ${l.id} from ${l.from}, which does not point back`)
  }

  // order: depth-first from main
  const order: string[] = []
  const walked = new Set<string>()
  const walk = (name: string) => {
    if (walked.has(name)) return
    walked.add(name)
    order.push(name)
    for (const k of branches.get(name)?.children ?? []) walk(k)
  }
  walk('main')
  if (order.join('\n') !== tree.order.join('\n')) bad('order is not the depth-first walk from main')
  if (tree.order.length !== branches.size) bad(`order has ${tree.order.length}, there are ${branches.size} Branches`)

  // agents
  const agents = new Set(tree.agents)
  if (agents.size !== tree.agents.length) bad('agents repeat')
  for (const c of commits.values()) if (c.by && !agents.has(c.by)) bad(`author ${c.by} not in agents`)
  for (const b of branches.values()) if (b.agent && !agents.has(b.agent)) bad(`agent ${b.agent} not in agents`)
  for (const a of tree.busy) if (!agents.has(a)) bad(`busy ${a} not in agents`)

  if (actions) {
    for (let i = 1; i < actions.length; i++) if (actions[i].at <= actions[i - 1].at) bad(`action ${i} is not after the one before`)
    const oldestFirst = [...layers].reverse()
    for (const a of actions) {
      if (a.kind === 'fork') {
        const b = branches.get(a.branch)
        if (!b) {
          bad(`fork ${a.branch} missing`)
          continue
        }
        const first = b.commits[b.commits.length - 1]
        if (first && first.at <= a.at) bad(`${b.name}: Commit before its fork`)
        if (b.forkedFrom?.kind === 'layer') {
          // main's newest Layer before the fork
          let lo = 0
          let hi = oldestFirst.length
          while (lo < hi) {
            const mid = (lo + hi) >> 1
            if (oldestFirst[mid].at < a.at) lo = mid + 1
            else hi = mid
          }
          const headThen = oldestFirst[lo - 1]
          if (headThen?.id !== b.forkedFrom.id) bad(`${b.name}: forked at a Layer that was not main's head`)
        } else if (b.parent) {
          const shut = closedAt.get(b.parent)
          if (shut !== undefined && shut <= a.at) bad(`${b.name}: forked from ${b.parent} after it closed`)
          if (forkAt(b) >= a.at) bad(`${b.name}: fork point is not before the fork`)
        }
      } else if (a.kind === 'publish') {
        if (!layerOf.has(a.id) || layerOf.get(a.id)?.at !== a.at) bad(`publish ${a.id} missing or mistimed`)
      } else if (commits.get(a.id)?.at !== a.at || commits.get(a.id)?.branch !== a.branch) bad(`${a.kind} ${a.id} missing or mistimed`)
    }
    const made = actions.filter((a) => a.kind === 'commit' || a.kind === 'merge').length
    if (made !== commits.size) bad(`actions made ${made} Commits, the tree has ${commits.size}`)
  }
  return out
}
