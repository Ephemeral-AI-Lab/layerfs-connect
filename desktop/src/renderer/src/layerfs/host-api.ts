// The Connect host's HTTP API, as the renderer sees it. The host
// (apps/connect/host, plain Node) answers JSON on 127.0.0.1 behind a bearer
// token; host/README.md describes each route. These types are the contract
// between the host and the renderer: change both sides together.

// ---------- SDK facts and refusals (#535/#536) ----------

/** The public SDK operation view; it is not Connect's own job state. */
export interface SdkOperation {
  id: string
  name: string
  phase: string
  started: number | null
  uncertain: boolean
}

export interface RefusalEntity {
  kind: string
  name: string
  /** Home conversion also explains why this entity is live. */
  why?: string
}

export interface RefusalDetail {
  entity?: RefusalEntity
  phase?: string | null
  op?: string
  related?: RefusalEntity[]
  [key: string]: unknown
}

/** Preserve the SDK's text, including any status or clearing call it names. */
export interface SdkRefusal {
  code: string
  message: string
  detail?: RefusalDetail | null
}

export type MachineState = 'creating' | 'running' | 'stopped' | 'removing' | 'failed' | 'missing' | 'unresolved'
export type StoreState = 'idle' | 'in_use' | 'busy' | 'down' | 'unresolved'
export type SandboxState = 'creating' | 'running' | 'closing' | 'gone' | 'unresolved'

export interface MachineSupports {
  sqlite: boolean
  postgresql_sandbox: boolean
  reason: string | null
}

export interface PlatformOption {
  name: string
  kind: 'int' | 'size' | 'text' | 'bool' | 'name'
}

/** One machine.platforms row, including readiness and supported form options. */
export interface MachinePlatformInfo {
  platform: MachinePlatform | string
  how: string
  backend: string | null
  kernel: string | null
  sqlite: string | null
  postgresql: { store_calls: string; sandbox: boolean; reason: string | null }
  ready: boolean
  missing: string[]
  version: string | null
  options: PlatformOption[]
  description: string
}

export interface PlatformsView {
  host: string
  platforms: MachinePlatformInfo[]
}

// ---------- Deployment and status ----------

/** GET /api/status: Connect on its one LayerFS 2.0 home. Machine power is manual; listing status starts nothing. */
/** Which LayerFS the host runs on: the linked library, or the simulator (host/sim). */
export type LayerfsMode = 'real' | 'sim'

export interface HostStatus {
  platform: 'linux' | 'macos' | 'windows'
  mode: LayerfsMode
  /** The linked `layerfs` package's version. */
  layerfs: string | null
  settings: {
    state: string
    /** The LayerFS home (LAYERFS_HOME). */
    home: string
    /** The native `layerfs` binary agents' shells run, when found. */
    cli: string | null
  }
  /** macOS: whether the native machine has its daemon recorded (null elsewhere). */
  daemon: { recorded: boolean; why: string | null } | null
  machines: { name: string; platform: string; state: string | null }[]
  stores: number
}

/** A Sandbox's platform as sandbox.create records it (`mac` for a native macOS Sandbox). */
export type SandboxPlatform = 'docker' | 'mac' | 'linux' | 'apple-container' | 'microsandbox' | 'lima'

/** How a Sandbox runs: a Docker container, a host process (native), or Linux namespaces in a machine's VM. */
export type SandboxRuntime = 'docker' | 'native' | 'namespaces'

// ---------- Compute: machines (LayerFS 2.0, layerfs#533) ----------

/**
 * A machine's kind. `native` and `docker` are built in; the VM kinds are
 * created. LayerFS's `ssh` and `firecracker` are turned off in Connect: the
 * host offers neither, and a machine of either kind shows by its raw name.
 */
export type MachinePlatform = 'native' | 'docker' | 'apple-container' | 'microsandbox' | 'lima'

/** One entry of machine.list().machines (2.0's machine/calls.rs). */
export interface MachineInfo {
  name: string
  platform: MachinePlatform | string
  backend: 'native' | 'docker' | 'namespaces' | string
  /** SDK-derived state; a stopped machine requires an explicit Start. */
  state: MachineState | string
  op?: SdkOperation | null
  supports?: MachineSupports
  cpus: number | null
  /** Bytes. */
  memory: number | null
  /** Bytes: the VM's data disk. */
  disk: number | null
  /** Names of the sqlite Stores it holds. */
  stores: string[]
  /** Names of its Sandboxes. */
  sandboxes: string[]
  /** Its Sandbox image (a digest, or an archive path). */
  image?: string
  /** docker: the Docker socket. */
  docker?: string
  /** docker on Windows: the WSL distribution. */
  wsl?: string
  error?: string
}

/** A sqlite Store on a machine (store.list()). */
export interface MachineStore {
  state?: StoreState | string
  op?: SdkOperation | null
  name: string
  machine: string
  projects: number
  /** Its projects' names (keys are `<store>/<name>`), when store.list gives them. */
  names?: string[]
  /** Bytes, when LayerFS reports it. */
  size: number | null
}

/** A PostgreSQL Store (store.list()): on no machine; Sandboxes on a machine that supports PostgreSQL reach its database. */
export interface MachinePgStore {
  state?: StoreState | string
  op?: SdkOperation | null
  name: string
  projects: number
  /** Its projects' names (keys are `<store>/<name>`). */
  names?: string[]
}

/** A Sandbox on a machine (sandbox.list()). */
export interface MachineSandbox {
  state?: SandboxState | string
  op?: SdkOperation | null
  backend?: string | null
  route?: string | null
  /** The image it was created from (a digest, or an archive path), when its record names one. */
  image?: string | null
  name: string
  machine: string | null
  project: string | null
  /** Its mounted Workspaces (sandbox.get); null when that read was refused. */
  workspaces: number | null
}

/** machine.status(name) for a VM (built-ins are not asked). */
export interface MachineLive {
  op?: SdkOperation | null
  name: string
  state: string | null
  freeDisk: number | null
  toolVersion: string | null
  /** Why it is down (2.0's `down_reason`). */
  down: string | null
}

/** GET /api/machines. */
export type MachinesView =
  | {
      available: true
      /** The linked LayerFS's version. */
      layerfs: string | null
      machines: MachineInfo[]
      /** machine.platforms(): each platform on this host, its readiness and its create options. */
      platforms: MachinePlatformInfo[]
      stores: MachineStore[]
      /** The PostgreSQL Stores; a machine whose `supports.postgresql_sandbox` is true reaches every one. */
      postgresql: MachinePgStore[]
      sandboxes: MachineSandbox[]
      /** By machine name. */
      status: Record<string, MachineLive>
    }
  | {
      /** Connect links a LayerFS with no machines (1.x): nothing to show, nothing to do. */
      available: false
      layerfs: string | null
      reason: string
    }

/** POST /api/machines: a VM (`platform` a VM kind). */
export interface NewMachine {
  platform: Exclude<MachinePlatform, 'native' | 'docker'>
  name: string
  cpus?: number
  memory?: number
  disk?: number
  image?: string
  os_image?: string
}

// ---------- Projects (real LayerFS reads) ----------

/** A project key (ProjectSummary.key, `<store>/<project>`) as its name and Store; a bare name (a LayerFS 1.1.0 record) has no Store. */
export function projectRef(key: string): { name: string; store: string | null } {
  const at = key.indexOf('/')
  return at < 0 ? { name: key, store: null } : { name: key.slice(at + 1), store: key.slice(0, at) }
}

/** How the app shows a project key: `name · store`. */
export function projectLabel(key: string): string {
  const { name, store } = projectRef(key)
  return store ? `${name} · ${store}` : name
}

/** The key the app calls a project by (ProjectSummary.key). */
export const projectKey = (project: Pick<ProjectSummary, 'key'>): string => project.key

export interface ProjectSummary {
  name: string
  /** `<store>/<project>`: what every call names it by. */
  key: string
  store: string
  kind: StoreFamily | null
  /** The machine its Store is on (sqlite), where its Sandboxes run. */
  machine: string | null
  created: number | null
  /** The demo whose run made this project, when a run made it. */
  demo?: string | null
  run?: string | null
  /** Its Store's SDK state. Busy and unresolved can also refuse project reads. */
  storeState?: StoreState | string | null
  storeOp?: SdkOperation | null
  /** Why its Store is down (its machine is stopped or does not answer), from store.status. */
  storeDown?: string | null
  /** A Store call the project page needs was refused (Busy, Unresolved, Unavailable): its Branches were not read. */
  refusal?: SdkRefusal | null
}

export interface NewProjectInput {
  name: string
  /** An existing sqlite Store on any machine, or a PostgreSQL Store. Init reads source on the caller host. */
  store: string
  /** Omit to create an empty project; otherwise import this absolute directory. */
  source?: string
}

export interface ProjectInitCounts {
  entries: number
  files: number
  bytes: number
}

/** One Init this host started (2.0 keeps no job registry; Connect keeps its own, fed by on_progress). */
export interface ProjectInitJob {
  id: string
  /** The project key. */
  name: string
  source: string | null
  started: number
  ended: number | null
  /** project.init's step (scan, files, tree, publish, seal), then done or failed. */
  step: string
  progress: ProjectInitCounts | null
  project: ProjectSummary | null
  error: { code: string; message: string } | null
}

/** main-additions' name for a project's Init job. */
export type InitJob = ProjectInitJob

// ---------- Storage on LayerFS 2.0 (docs/layerfs-2.0-integration.md step 5) ----------

export type StoreFamily = 'sqlite' | 'postgresql'

/** A bucket file's state against a Store (backup.list). */
export type BackupState = 'current' | 'store_changed' | 'bucket_changed' | 'both_changed' | 'unknown' | 'unlinked' | 'missing'

/** A Store's link to a bucket: the file its backups go to, and the last transfer. */
export interface StoreBackupLink {
  bucket: string
  file: string
  last: { op: string; at: number | null; bytes: number | null } | null
}

/** One Store: store.list with its store.status. */
export interface StoreRow {
  name: string
  kind: StoreFamily
  /** A sqlite Store's machine; null for PostgreSQL. */
  machine: string | null
  projects: string[]
  created: number | null
  /** The sqlite file and its WAL, where it lives; null when unknown or PostgreSQL. */
  size: { bytes: number; file: number; wal: number } | null
  /** SDK-derived state; listing a stopped machine starts nothing. */
  state: StoreState | string
  op?: SdkOperation | null
  refusal?: SdkRefusal | null
  holders: number
  down: string | null
  links: StoreBackupLink[]
  /** The job of this host running on it. */
  job: string | null
  /** A PostgreSQL Store's server: `user@host:port/db` from its record (never a password) and store.status's answer. */
  postgresql?: PgServer | null
}

export interface PgServer {
  target: string | null
  /** null when store.status did not say. */
  reachable: boolean | null
  version: string | null
  latencyMs: number | null
  error: string | null
}

/** A file in a bucket, as backup.list answers it: one row per Store linked to it (or one with no Store). */
export interface BackupFile {
  file: string
  store: string | null
  state: BackupState
  bytes: number | null
  modified: number | null
  reason: string | null
}

export interface BucketRow {
  name: string
  /** minio or r2, when this host connected it. */
  provider: string | null
  /** Where it points, as Connect connected it (http(s)://host/bucket/prefix or r2://account/bucket/prefix; never a key); null when another host connected it. */
  url?: string | null
  region?: string | null
  /** Whose keys it reads: an owner-only file Connect saved ('saved', replaceable), or a reference given at connect ('reference'). */
  keys?: 'saved' | 'reference' | null
  /** The reference ('reference' keys): env:LAYERFS_… or file:/abs, never the secret. */
  key?: string | null
  /** When this host last listed it (backup.list); null before the first. */
  listed: number | null
  files: BackupFile[] | null
  error: { code: string; message: string } | null
  /** Stores linked to it. */
  stores: string[]
}

/** A push, pull, move, backup or restore this host started, fed by its calls' on_progress. */
export interface StorageJob {
  id: string
  /** `move` is a pull then a push (two operations, #537 U5). */
  kind: 'push' | 'pull' | 'move' | 'backup' | 'restore'
  store: string
  /** The machine (push, pull: native, move) or bucket (backup, restore). */
  target: string
  /** A pull's machine: where the Store came from (null when not known). */
  from?: string | null
  /** The half a move is in: its pull, then its push. */
  half?: 'pull' | 'push' | null
  file: string | null
  started: number
  ended: number | null
  phase: string | null
  done: number | null
  total: number | null
  /** The SDK's refusal as it came; `note: 'pulled'` when a move's push half failed after its pull (the Store is on native). */
  error: (SdkRefusal & { phase: string | null; note?: 'pulled' }) | null
  result: unknown
}

/** GET /api/storage. */
/** GET /api/doctor: `layerfs doctor` on the home (report-only; #536 H7). */
export interface DoctorFinding {
  severity: 'error' | 'warning'
  entity: { kind: string; name: string } | null
  message: string
  /** The call that fixes it, in LayerFS's words. */
  fix: string | null
}

export interface DoctorReport {
  ok: boolean
  findings: DoctorFinding[]
  at: number
}

export interface StorageView {
  machines: { name: string; platform: string; state: string | null; supports: MachineSupports | null }[]
  stores: StoreRow[]
  buckets: BucketRow[]
  jobs: StorageJob[]
  at: number
}

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

/** A Sandbox record as sandbox.create, sandbox.list and sandbox.get answer it. */
export interface SandboxRecord {
  op?: SdkOperation | null
  backend?: string | null
  route?: string | null
  name: string
  project: string
  machine: string
  state: string
  created: number | null
  platform?: SandboxPlatform | string
  runtime?: SandboxRuntime | string
  image?: string | null
}

/** A mounted side Branch; mounting main is refused (D14). */
export interface WorkspaceInfo {
  ws: string
  name?: string | null
  branch: string
  path: string
  activity?: string | null
}

/** A Sandbox of a project: its record, and its Workspaces when read (GET /api/projects/<key>/sandboxes). */
export interface SandboxInfo {
  /** Its name (unique in the home): what every call names it by. */
  id: string
  name: string
  /** The SDK-derived state, including any operation in flight. */
  state: SandboxState | string
  op?: SdkOperation | null
  backend?: string | null
  route?: string | null
  project?: string | null
  /** sandbox.get refused (Busy, Unresolved, Unavailable, …): its Workspaces are unknown; the SDK's words. */
  refusal?: SdkRefusal | null
  image: string | null
  machine: string | null
  runtime?: SandboxRuntime | string | null
  platform?: SandboxPlatform | string
  /** Its Workspaces: `ws` is the handle every Workspace call takes (`<sandbox>:<path>`). */
  workspaces: WorkspaceInfo[]
  /** The project read lists records only: its Workspaces were not read. */
  unread?: boolean
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
  /**
   * True when summed from the Commits read (LayerFS 2.0 has no Store totals):
   * Init, main's Layers and earlier history are not counted, and init, main
   * and free are null / 0.
   */
  partial?: boolean
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
  /** Why it cannot play on LayerFS 2.0 yet (background processes, the 1.1.0 JS SDK), or null. */
  blocked?: string | null
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

/** Every server-sent event on /api/events: the runs' events and Storage's. */
export type HostEvent = RunEvent
  /** A storage job moved on, or ended. */
  | { type: 'storage-job'; job: StorageJob }
  /** The storage view changed (a listing ended, a job ended): read /api/storage again. */
  | { type: 'storage' }
  /** A chat changed (layerfs/agent-api.ts); it carries the whole chat. */
  | { type: 'chat'; session: import('./agent-api').ChatSummary }
