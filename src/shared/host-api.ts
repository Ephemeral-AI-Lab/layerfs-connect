// The Connect host's HTTP API, as the renderer sees it. The host
// (apps/connect/host, plain Node) answers JSON on 127.0.0.1 behind a bearer
// token; host/README.md describes each route. These types are the contract
// between the host and the renderer: change both sides together.

// ---------- Deployment and status ----------

export interface HostStatus {
  platform: 'linux' | 'macos' | 'windows'
  /** Settings LayerFS still needs before Init and Workspaces work (image, daemon, bundle). */
  missing: string[]
  docker: { level: 'ok' | 'down' | string; version?: string | null; error?: string | null }
  worker: { name: string; state: string; build?: string | null; error?: string | null } | null
  disk: { home: number | null; volumes: number | null }
  settings: {
    state: string
    home: string
    image: string | null
    bundle: string | null
    containerPrefix: string
    docker: string
  }
}

// ---------- Projects (real LayerFS reads) ----------

/** A project key (ProjectSummary.key) as its name and Store: `store/name`, or a bare name. */
export function projectRef(key: string): { name: string; store: string | null } {
  const at = key.indexOf('/')
  return at < 0 ? { name: key, store: null } : { name: key.slice(at + 1), store: key.slice(0, at) }
}

/** How the app shows a project key: `name · store` in a shared Store. */
export function projectLabel(key: string): string {
  const { name, store } = projectRef(key)
  return store ? `${name} · ${store}` : name
}

/** The key the app calls a project by (ProjectSummary.key), falling back to its name on an older host. */
export const projectKey = (project: Pick<ProjectSummary, 'name' | 'key'>): string => project.key ?? project.name

export interface ProjectSummary {
  name: string
  volume: string | null
  source: string | null
  created: number | null
  initialized: boolean
  /** The demo whose run made this project, when a run made it. */
  demo?: string | null
  run?: string | null
  /** The Store that holds the project (layerfs#506); null with a LayerFS build from before Stores held several projects. */
  store?: string | null
  /** The Store's kind (layerfs#506). */
  kind?: StoreFamily | null
  /** In a Store with other projects: its name may also be in other Stores. */
  shared?: boolean
  /** What the app calls the project by: `store/name` in a shared Store, else its name (projectRef reads it back). */
  key?: string
  /** The Store's aggregate sync state (storage-redesign §4.5), from the host's cached storage view; absent when the host has no Storage view. */
  storeSync?: StoreSyncState | null
  /** The provider of the Store's link, for its StoreIcon badge (layerfs#509: at most one). */
  storeProviders?: RemoteProvider[]
  /** A PostgreSQL Store's connection. */
  connection?: string | null
}

export interface NewProjectInput {
  name: string
  /** Omit to create an empty project; otherwise import this absolute directory. */
  source?: string
  /** Init into this existing Store (layerfs#506); omit for a new Store of the project's own. */
  store?: string
}

export interface ProjectInitCounts {
  entries: number
  files: number
  bytes: number
}

export interface ProjectInitJob {
  id: string
  name: string
  source: string | null
  started: number
  ended: number | null
  step: 'scan' | 'volume' | 'import' | 'done' | 'failed'
  scanned: ProjectInitCounts | null
  totals: ProjectInitCounts | null
  imported: (ProjectInitCounts & { step: string }) | null
  project: ProjectSummary | null
  error: { code: string; message: string } | null
}

/** main-additions' name for a project's Init job. */
export type InitJob = ProjectInitJob

// ---------- Storage: Stores, links, remotes and PostgreSQL (layerfs#506, #509; docs/ui/storage-links.md §5) ----------
//
// Producer notes: H = the Connect host makes it; E<n> = it needs LayerFS
// (storage-redesign §8.3). A LayerFS build without an E field leaves it null,
// and the renderer degrades (§10.4): "size unknown", "Sync unknown", an
// indeterminate bar. Never assume one is present.

export type StoreFamily = 'sqlite' | 'postgresql'
export type RemoteProvider = 'minio' | 'r2' | 's3' | 'gcs' | 'google-drive' | 'folder'

/** A link's sync state (storage-links §4). */
export type SyncState = 'in_sync' | 'ahead' | 'behind' | 'diverged' | 'missing' | 'checking' | 'unreachable' | 'unknown' | 'transferring'
/** A Store's state: its link's, or one of the two Store-only states. */
export type StoreSyncState = SyncState | 'local_only' | 'live'

export interface Health {
  state: 'ok' | 'unreachable' | 'denied' | 'checking' | 'unknown'
  /** When the last check ended; null before the first. */
  at: number | null
  /** The failure's message, readable as is. */
  message: string | null
}

/** One push or pull of a whole Store file. */
export interface TransferInfo {
  direction: 'push' | 'pull'
  at: number | null
  bytes: number | null
  sha256: string | null
  /** The Store's history heads digest at that transfer (§4.1). */
  heads: string | null // E2
}

/** The last look at a linked file in its bucket: one HEAD. */
export interface CopyCheck {
  at: number // H (when the host ran it)
  present: boolean // E3
  bytes: number | null // E3
  sha256: string | null // E3 (layerfs-sha256 metadata)
  heads: string | null // E3 + E2 (layerfs-heads metadata)
  modified: number | null // E3 (Last-Modified)
  error: { code: string; message: string } | null // E3
}

/** A SQLite Store's link: the one remote file it pushes to and pulls from (layerfs#509). */
export interface StoreLink {
  /** The connection's name. */
  remote: string
  provider: RemoteProvider | null // H (joined from remote.list)
  /** The remote file's name: the object <prefix>/<file>/store.sqlite. */
  file: string
  /** The full object path, for display: <location>/<file>/store.sqlite. */
  object: string // H
  /** When the link was made. */
  linked: number | null
  /** Its last push or pull: what both sides are compared with. */
  last: TransferInfo | null
  /** The last successful check, and the last check if it failed. */
  check: CopyCheck | null // H←E3
  failedCheck: CopyCheck | null // H←E3
  local: 'same' | 'changed' | 'unknown' // H←E2
  remoteSide: 'same' | 'changed' | 'missing' | 'unknown' // H←E3
  sync: SyncState // H (§4)
  /** The state before the last failed check, shown dashed. */
  lastKnown: SyncState | null // H
  reason: string | null // H
}

export interface StoreSize {
  /** SQLite: store.sqlite + its WAL. PostgreSQL: the schema's tables, indexes and TOAST. */
  bytes: number
  file: number | null // SQLite only
  wal: number | null // SQLite only
  at: number
}

/** A Store: many projects in one SQLite file (its own Docker volume) or one PostgreSQL schema. */
export interface StoreInfo {
  name: string
  kind: StoreFamily
  /** A SQLite Store's Docker volume. */
  volume: string | null
  /** A PostgreSQL Store's connection name, and its schema. */
  connection: string | null
  schema: string | null
  synchronousCommit: SynchronousCommit | null // H
  /** SQLite: the remote file the Store is linked to, or null (local only). PostgreSQL: always null. */
  link: StoreLink | null
  projects: string[]
  created: number | null // H
  /** A project's own pre-#506 Store. */
  legacy: boolean // H
  /** SQLite: E1, else the host's stat; PostgreSQL: E5. */
  size: StoreSize | null
  /** @deprecated size?.bytes; kept one release for project-card.tsx. */
  bytes: number | null
  /** The Store file is open now (its -shm exists): a pull would be refused. */
  open: boolean | null
  sync: {
    state: StoreSyncState // H (§4)
  }
  /** PostgreSQL: the SQLite Store it was imported from. */
  importedFrom: { store: string; at: number | null; bytes: number | null } | null // E6, else H
  /** SQLite: PostgreSQL Stores imported from this one. */
  imports: string[] // H←E6
  /** The running job on this Store, if any. */
  job: string | null // H
}

/** A remote LayerFS knows; its keys stay in Connect. */
export interface RemoteInfo {
  name: string
  provider: RemoteProvider
  /** The endpoint as entered. */
  endpoint: string
  /** The address the LayerFS box uses (host.docker.internal for this machine's loopback on macOS and Windows). */
  reachAs: string
  /** R2: the Cloudflare account id; null for MinIO. */
  account?: string | null
  /** R2: '' (none), 'eu' or 'fedramp'; null for MinIO. */
  jurisdiction?: string | null
  bucket: string
  prefix: string
  /** Connect holds this remote's keys. */
  hasSecret: boolean
  /** host/bucket/prefix, for display. */
  location: string // H
  /** Local Stores linked to a file here. */
  stores: string[] // H
  /** The files in the bucket (from the last listing), each linked or not loaded; null before a listing or without E9. */
  files: RemoteFile[] | null // E9
  /** The sum of known file sizes (listed), else of the linked files'. */
  bytes: number | null // H
  /** The latest check or listing against this remote. */
  health: Health // H←E3
}

/** A SQLite Store file in a connection's bucket (layerfs#509). */
export interface RemoteFile {
  file: string
  bytes: number | null
  modified: number | null
  /** The Store of this machine linked to it, or null: not loaded. */
  linkedBy: string | null
}

export type SynchronousCommit = 'off' | 'local' | 'remote_write' | 'on' | 'remote_apply'

/** A named PostgreSQL connection Connect keeps; its URL (with the password) stays in Connect. */
export interface PostgresqlConnection {
  name: string
  /** The URL with its password hidden. */
  url: string
  synchronousCommit: SynchronousCommit
  /** Stores in this database. */
  stores: string[]
  host: string | null // H (host:port, parsed from the URL)
  database: string | null // H (parsed from the URL)
  health: Health & {
    serverVersion: string | null // E7
    latencyMs: number | null // H (timed around E7)
  }
  bytes: number | null // H←E5 (sum of its Stores)
}

export type SyncPhase = 'check' | 'snapshot' | 'hash' | 'upload' | 'download' | 'verify' | 'install' | 'copy' | 'record'

/** A publish, push, pull, send, load or PostgreSQL import in progress or just ended. */
export interface SyncJob {
  id: string
  kind: 'publish' | 'push' | 'pull' | 'send' | 'load' | 'import'
  /** The Store it moves (for a load, the new Store; for an import, the source). */
  store: string
  /** The connection's name, or connection/schema for an import. */
  target: string
  /** The remote file it moves (layerfs#509); null for an import. */
  file: string | null // H
  /** A load's remote file; an import's new PostgreSQL Store. */
  from: string | null // H
  provider: RemoteProvider | 'postgresql' | null // H
  force: boolean // H
  step: 'running' | 'done' | 'failed'
  phase: SyncPhase | null // E4
  /** Within the current phase, updated while running. */
  bytes: number | null // E4
  total: number | null // E4
  pieces: { done: number; of: number } | null // E4 (optional)
  /** Bytes per second in the current phase (§5.2). */
  rate: number | null // H
  /** Seconds left in the current phase (§5.2). */
  eta: number | null // H
  cancellable: boolean // H (always false in v1)
  error: { code: string; message: string } | null // H (the runtime's code)
  result: { bytes: number | null; sha256: string | null } | null // H
  started: number
  ended: number | null
}

export interface ProviderInfo {
  id: RemoteProvider
  /** This LayerFS build can add it. */
  available: boolean // E8, else H
  reason: string | null // H
}

/** What the linked LayerFS build reports, for graceful fallbacks (§10). */
export interface StorageSupports {
  size: boolean // E1
  heads: boolean // E2
  check: boolean // E3
  progress: boolean // E4
  postgresqlStatus: boolean // E5/E7
  listCopies: boolean // E9 (connection file listings)
}

export interface StorageTotals {
  sqlite: { stores: number; bytes: number; unknown: number }
  postgresql: { stores: number; connections: number; bytes: number; unknown: number }
  /** SQLite Stores with a link, and their linked files' known sizes. */
  linked: { stores: number; bytes: number; unknown: number }
  sync: Partial<Record<StoreSyncState, number>>
}

/** Each part's `available` is false while the linked LayerFS build lacks it, and `reason` says why. */
export interface StorageView {
  stores: { available: boolean; reason: string | null; list: StoreInfo[] }
  remotes: { available: boolean; reason: string | null; list: RemoteInfo[] }
  postgresql: { available: boolean; reason: string | null; connections: PostgresqlConnection[] }
  jobs: SyncJob[]
  providers: ProviderInfo[] // H / E8
  totals: StorageTotals // H
  supports: StorageSupports // H
  /** The newest finished check, for "Checked 2 min ago". */
  checkedAt: number | null // H
  /** Checks running now. */
  checking: number // H
}

/** POST /api/storage/check: what to check; empty means everything. */
export interface StorageCheck {
  store?: string
  remote?: string
  connection?: string
}

export interface NewMinioRemote {
  name: string
  provider: 'minio'
  endpoint: string
  bucket: string
  prefix?: string
  accessKey: string
  secretKey: string
}

/** A Cloudflare R2 bucket: LayerFS reaches it at https://<account>[.<jurisdiction>].r2.cloudflarestorage.com. */
export interface NewR2Remote {
  name: string
  provider: 'r2'
  account: string
  jurisdiction?: '' | 'eu' | 'fedramp'
  bucket: string
  prefix?: string
  accessKey: string
  secretKey: string
}

export type NewRemote = NewMinioRemote | NewR2Remote

export interface BranchInfo {
  name: string
  /** The head Commit or Layer id this Branch points at. */
  head: string | null
  /** The Branch it was forked from, null for main. */
  parent: string | null
  forkedFrom: string | null
  state: 'open' | 'merged' | 'published' | string
  commits: number
}

export interface CommitInfo {
  id: string
  branch: string
  message: string
  at: number | null
  parent: string | null
  /** Merge Commits have a second parent. */
  merged?: string | null
  kind?: string | null
  changes?: { path: string; kind: string }[]
}

export interface LayerInfo {
  id: string
  message: string
  at: number | null
  from: string | null
}

export interface FsEntry {
  name: string
  path: string
  kind: 'file' | 'dir' | 'symlink' | string
  size: number | null
  mode?: number | null
}

export interface SandboxInfo {
  id: string
  name: string
  state: string
  image: string | null
  /** Its mounted Workspaces: read only by GET /api/projects/<key>/sandboxes (the project read leaves them empty). */
  workspaces: { ws: string; branch: string; path: string }[]
  /** Its daemon did not answer that read in time (busy) or refused it (unreachable); its Workspaces are then unknown. */
  reach?: 'busy' | 'unreachable'
  /** What the daemon said, when it refused. */
  detail?: string
}

export interface ProjectState {
  project: ProjectSummary
  branches: BranchInfo[]
  layers: LayerInfo[]
  sandboxes: SandboxInfo[]
  /** The newest Commit on any Branch, null before the first. */
  last: CommitInfo | null
  /** Commits on every Branch. */
  commits: number
  /** The project's Store file (in its Docker volume) and its bytes with the WAL; null when unreadable. */
  store: { path: string | null; bytes: number | null }
  /** What the Store holds and what it costs (backend.store.project.get_storage); null when unreadable. */
  storage: StoreStats | null
}

/**
 * The Store's totals, in bytes. `logical` is every Commit and Layer counted
 * as a full snapshot; `canonical` the distinct content after dedupe;
 * `stored` that content compressed; `metadata` metadata packs plus SQLite
 * space outside packs (it overlaps `stored`: do not add them).
 */
export interface StoreStats {
  logical: number
  canonical: number
  stored: number
  metadata: number
  /** SQLite pages in bytes, free pages included. */
  file: number
  free: number
  /** logical / canonical; null when canonical is 0. */
  dedupe: number | null
  /** canonical / stored; null when stored is 0. */
  compression: number | null
  /** What Init imported, recorded once; null before Init records it. */
  init: { files: number; bytes: number; stored: number; millis: number } | null
  /** main's newest Layer as a full snapshot; null when the Layer is not in the answer. */
  main: number | null
  /** Every Commit read, oldest first, with the bytes its Save added. */
  commits: CommitStorage[]
}

export interface CommitStorage {
  id: string
  branch: string
  message: string
  at: number | null
  /** exec (a Workspace commit), fs (a file call) or merge. */
  kind: string | null
  /** The whole tree's bytes at this Commit. */
  logical: number
  /** Distinct new content this Commit added, and the same compressed. */
  canonical: number
  stored: number
}

// ---------- Demos (scenarios) ----------

export type ToolName =
  | 'bash'
  | 'subagent'
  | 'send_message'
  | 'interrupt_agent'
  | 'list_agents'
  | 'job_output'
  | 'job_kill'
  | 'job_list'
  | 'working_directory'

/** What a piece of an agent's call does. */
export type SegmentKind =
  | 'workspace' // mount, exec, commit, status, unmount
  | 'fs' // fs read/write/edit/list/… on a Branch (each write is a Commit)
  | 'branch' // fork, merge, publish, list/diff commits
  | 'sandbox' // create, list, close a Sandbox
  | 'project' // project-level reads (branches, layers, state)
  | 'backend' // @layerfs/backend reads and background processes
  | 'subagent' // subagent, send_message, interrupt_agent, list_agents
  | 'job' // a background bash job: run_in_background, job_output, job_kill, job_list
  | 'local' // plain shell with no LayerFS call (jq, echo, files in the agent's folder)

export interface Segment {
  kind: SegmentKind
  /** cli: the `layerfs` command; sdk: a Node script on @layerfs/agent or @layerfs/backend; shell; tool: a non-bash tool call. */
  form: 'cli' | 'sdk' | 'shell' | 'tool'
  /** The LayerFS method, e.g. "workspace.exec", "fs.edit", "branch.merge"; absent for local shell. */
  call?: string
  /** The source text of this segment. */
  text: string
  /** 1-based first and last line in the command. */
  lines: [number, number]
  /** The command a workspace.exec runs inside the Workspace, a subagent's name, a job's id. */
  detail?: string
  /** Where each LayerFS call of the segment is: its line in the command and the columns of `lf.fs.edit(` or `layerfs fs edit`. */
  at?: SegmentCall[]
}

export interface SegmentCall {
  call: string
  line: number
  cols: [number, number]
}

export interface StepView {
  index: number
  tool: ToolName | 'reply'
  /** The bash command, the subagent prompt, the message: the call's main text. */
  text: string
  description?: string
  say?: string
  phase?: string
  note?: string
  expect?: string[]
  exit?: number
  /** The kind the step is mostly about (the first LayerFS kind among its segments, else local/subagent/job). */
  kind: SegmentKind
  segments: Segment[]
  /** reply steps: the agents it waits for. */
  until?: string[]
  /** bash with run_in_background: it runs as a job. */
  background?: boolean
  /** The job's or child's `as` name, which later steps call it by (`@name`). */
  job?: string
}

export interface DemoAgent {
  name: string
  /** The prompt a parent starts it with; null for root. */
  prompt: string | null
  steps: number
}

export interface DemoSession {
  name: string
  /** What the user asked the session's root agent (named `name`). */
  prompt: string
  /** Its agents, root first. */
  agents: string[]
}

export interface DemoSummary {
  id: string
  title: string
  blurb: string | null
  /** What the user asked root: the conversation's opening message. */
  prompt: string | null
  order: number
  tags: string[]
  agents: DemoAgent[]
  /**
   * A demo of several sessions: each is a run of its own, started together in
   * one folder of the project they play on; its root agent is named after it
   * and starts with its prompt. Null for a demo of one session.
   */
  sessions?: DemoSession[] | null
  /** Total steps over every agent. */
  steps: number
  /** Counts by segment kind over every step. */
  kinds: Partial<Record<SegmentKind, number>>
  fixture: string
  latest: RunSummary | null
  runs: number
}

export interface DemoDetail extends DemoSummary {
  /** Steps per agent, root first. */
  script: Record<string, StepView[]>
}

// ---------- Runs ----------

export type RunState = 'starting' | 'running' | 'passed' | 'failed' | 'stopped'

/**
 * 'replay': a scenario played on a project, in a folder of its own. 'live': a
 * Pi session an earlier build of the engine saved; the host lists and reads
 * them but no longer starts or continues them (Chat replaces them).
 */
export type RunKind = 'replay' | 'live'

export interface RunSummary {
  id: string
  /** Always sent by this host; 'replay' for every run it starts. */
  kind?: RunKind
  demo: string
  /**
   * The key of the LayerFS project this run played on: its name, or
   * `store/name` in a shared Store (ProjectSummary.key; projectRef reads it
   * back). A scenario plays in a folder of its own there (`folder`); older
   * runs reset a project named after the demo, or older still made their own
   * (`<demo>-<n>`).
   */
  project: string
  /**
   * A scenario run's folder and name, `<scenario>_<n>`: its files are under
   * /<folder>/, its Branches are `<folder>.<name>`, and `<folder>.main`,
   * `<folder>.main.1`, … (one per publish) stand for main; once it passed it
   * lands on main (check `main.landed`). Null until set up, and on older runs.
   */
  folder?: string | null
  /** The replay's number among its demo's (1, 2, …); null on runs from before one project per demo. */
  replay: number | null
  /** A demo of several sessions: the session this run plays (its root agent's name); null otherwise. */
  session?: string | null
  /** A demo of several sessions: the launch that started its sessions together; null otherwise. */
  launch?: string | null
  state: RunState
  /**
   * A heavy scenario waiting its turn (two play at once, host runs/index.js HEAVY_AT_ONCE): state
   * 'starting', not set up yet; `phase` says so. Its `started` is reset when
   * it begins to play.
   */
  queued?: boolean
  started: number
  ended: number | null
  error: string | null
  /** Finished and total steps over every agent. */
  done: number
  of: number
  phase: string | null
  /** The agents started so far: the replay's sessions. */
  agents: AgentRun[]
}

export type AgentState = 'waiting' | 'running' | 'idle' | 'done' | 'failed' | 'stopped'

export interface AgentRun {
  name: string
  /** The agent that started it; null for root. */
  parent: string | null
  state: AgentState
  done: number
  of: number
  /** When its state last changed (absent on runs recorded before it was kept). */
  since?: number
  /** When its current pause before a step began; null between pauses. */
  thinking?: number | null
}

/** One LayerFS call from a trace line. */
export interface TraceCall {
  id: string
  agent: string
  /** The step label this call ran under: "<agent>:<index>". */
  step: string
  method: string
  ok: boolean | null
  kind: string | null
  code: string | null
  ms: number | null
  start: string
  branch?: string | null
  sandbox?: string | null
  path?: string | null
  commit?: string | null
  /** A write (host/runs/traces.js WRITES): its message or why it was refused (cut), sizes, and the Branches it named. */
  message?: string | null
  sizes?: { logical: number | null; stored: number | null } | null
  from?: string | null
  onto?: string | null
  with?: string | null
  name?: string | null
  layer?: string | null
}

export interface CheckResult {
  /** "exit", "expect", "commits", "final" … */
  name: string
  ok: boolean
  detail: string
}

export interface StepResult {
  agent: string
  index: number
  state: 'running' | 'ok' | 'failed' | 'stopped'
  started: number
  ended: number | null
  exitCode?: number | null
  stdout?: string
  stderr?: string
  /** True when stdout or stderr was cut to the kept size. */
  truncated?: boolean
  /** Tool calls other than bash: their answer text. */
  output?: string
  calls: TraceCall[]
  checks: CheckResult[]
}

/**
 * A call that changed the project's store (its Branches, Commits, Layers):
 *   file       a Branch file op (fs.write, fs.apply, fs.edit, fs.mkdir, fs.rm,
 *              fs.mv, fs.cp), committed straight to its Branch
 *   workspace  workspace.commit: a mounted Workspace's changes, saved to its Branch
 *   fork       branch.fork: a new Branch `branch` from `from`
 *   merge      branch.merge: `onto` and `with` merged into a new Branch `branch`
 *   publish    branch.publish: `branch` added to main as Layer `layer` (in a
 *              scenario run, a fork of its next trunk `trunk` from `branch`)
 *   init       project.init
 * Refused ones too (status 'failed', `outcome` its code, `message` why).
 * Every successful write is an auto-checkpoint, numbered across the session
 * (all its agents) in the order writes ended; a refused one has none.
 */
export interface TraceWrite {
  kind: 'file' | 'workspace' | 'fork' | 'merge' | 'publish' | 'init'
  method: string
  status: 'ok' | 'failed' | 'running'
  outcome: string | null
  commit: string | null
  branch: string | null
  path: string | null
  workspace: string | null
  from: string | null
  onto: string | null
  with: string | null
  layer: string | null
  /** publish in a scenario run: the run's trunk Branch (<folder>.main.<k>) it went to instead of main. */
  trunk: string | null
  message: string | null
  sizes: { logical: number | null; stored: number | null } | null
  start: number | null
  ms: number | null
  /** Its auto-checkpoint number in the session; null when refused. */
  checkpoint: number | null
}

/** One row of a session's Trace (host/runs/trajectory.js): what one agent was given and did. */
export interface TraceRecord {
  id: string
  kind: 'system' | 'user' | 'context' | 'assistant' | 'tool' | 'subagent' | 'layerfs' | 'check'
  /** 0 before the first message; a user's message or a parent's task opens the next. */
  turn: number
  /** The model request (or scripted step) this row belongs to. */
  step: number | null
  title: string
  status: 'ok' | 'failed' | 'running' | 'stopped' | 'starting'
  start: number | null
  ms: number | null
  text?: string | null
  /** user/context: where it came from. */
  source?: 'user' | 'parent' | 'child' | 'model' | 'host' | 'scenario'
  from?: string
  opens?: boolean
  /** system/assistant: no model, the scenario's script. */
  scripted?: boolean
  sections?: string[] | null
  model?: string | null
  thinking?: string | null
  toolOnly?: boolean
  final?: boolean
  phase?: string | null
  usage?: { input: number; output: number; cacheRead: number; cacheWrite: number; reasoning: number; cost: number } | null
  stopReason?: string | null
  error?: string | null
  /** tool/subagent */
  tool?: string
  child?: string | null
  output?: string | null
  exitCode?: number | null
  checks?: { name: string; ok: boolean; detail: string }[]
  background?: boolean
  calls?: number
  /** tool: the writes its LayerFS calls made, in order. */
  writes?: TraceWrite[]
  /** tool: the session's auto-checkpoints its writes made, ascending; other agents' may fall between. */
  checkpoints?: number[]
  /** layerfs: the kind of write this call is. */
  writeKind?: TraceWrite['kind'] | null
  /** layerfs: the tool row it ran in. */
  parent?: string
  outcome?: string | null
  args?: Record<string, string>
}

/** A page of one agent's Trace, newest last: records [from, from + records.length) of total. */
export interface TracePage {
  agent: string
  kind: 'live' | 'replay'
  total: number
  from: number
  records: TraceRecord[]
  agents: { name: string; parent: string | null; state: string }[]
  /** How many auto-checkpoints the whole session made (all agents). */
  checkpoints?: number
}

export interface RunDetail extends RunSummary {
  agents: AgentRun[]
  /** Every step result so far, in the order steps started. */
  steps: StepResult[]
  /** Replies and messages between agents. */
  messages: { at: number; from: string; to: string | null; text: string }[]
  /** Values captured during the run: commits by ref, the sandbox, the ws. */
  captured: Record<string, string>
  /** Final checks after the root's last step (final.json and the like). */
  checks: CheckResult[]
  /** What the agents hold in LayerFS now, from their trace lines. */
  live: RunLive
}

/** A LayerFS call an agent has started and not finished. */
export interface RunningCall {
  id: string
  agent: string
  method: string
  sandbox: string | null
  path: string | null
  branch: string | null
  /** workspace.exec's command, cut to 240 characters. */
  command: string | null
  start: number
}

/** A Workspace an agent mounted and has not unmounted. */
export interface LiveMount {
  sandbox: string
  path: string
  branch: string | null
  agent: string
  since: number
  /** Commits made from it so far. */
  commits: number
  /** Its last finished exec. */
  last: { command: string | null; kind: string | null; at: number } | null
}

export interface RunLive {
  running: RunningCall[]
  mounts: LiveMount[]
  /** Sandboxes the agents made (sandbox.create), still open. */
  sandboxes: { id: string; agent: string; at: number }[]
  /** Each agent's last finished call. */
  last: Record<string, { method: string; ok: boolean; code: string | null; at: number }>
}

/** One server-sent event on /api/events. */
export type RunEvent =
  | { type: 'run'; run: RunSummary }
  | { type: 'run-removed'; id: string; demo: string }
  | { type: 'agent'; run: string; agent: AgentRun }
  | { type: 'step'; run: string; step: StepResult }
  | { type: 'call'; run: string; call: TraceCall }
  | { type: 'message'; run: string; message: RunDetail['messages'][number] }
  | { type: 'checks'; run: string; checks: CheckResult[] }
  | { type: 'live'; run: string; live: RunLive }

/** Every server-sent event on /api/events: the runs' events, the agents' chat events, and Storage's. */
export type HostEvent = RunEvent
  | { type: 'chat'; session: import('./agent-api').AgentSessionDetail }
  | { type: 'chat-navigate'; fromId: string; sessionId: string }
  /** Each new sample of a running sync job, and its end. */
  | { type: 'sync'; job: SyncJob }
  /** The storage view changed (a check ended, a job ended): read /api/storage again. */
  | { type: 'storage' }
