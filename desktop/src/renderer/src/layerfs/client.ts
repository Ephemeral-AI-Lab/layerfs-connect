// The LayerFS host's API, typed by shared/host-api. On pi-desktop every call
// goes through Electron main (connect-bridge.ts); the host's token never
// reaches the renderer.
import { connectBridge } from '@/layerfs/bridge'
import { desktopAction } from '@/layerfs/activity-action'
import type { CliAction } from '../../../../../shared/cli-activity'
import { exampleChatReply } from '@/layerfs/chat-sim'
import type { BackupFile, CommitInfo, DemoDetail, DemoSummary, DoctorReport, FsEntry, HostEvent, HostStatus, MachinesView, NewMachine, NewProjectInput, ProjectInitJob, ProjectState, ProjectSummary, RefusalDetail, RunDetail, RunSummary, SandboxInfo, SandboxRecord, StorageJob, StorageView, TracePage } from '@/layerfs/host-api'

/** A refused call: LayerFS's code, its text (naming any status or clearing call) and its detail (entity, phase, op, related). */
export class HostError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly detail: RefusalDetail | null = null,
    /** A layout 2 home's conversion refusal: the app shows the upgrade screen. */
    readonly conversion = false,
    readonly transport?: string,
    readonly activityId?: string,
  ) {
    super(message)
  }
}

/** Fires with a layout 2 home's conversion refusal, from whichever call met it first. */
const conversionEvents = new EventTarget()
let lastConversion: HostError | null = null
export function onConversion(listener: (refusal: HostError | null) => void): () => void {
  const on = () => listener(lastConversion)
  conversionEvents.addEventListener('change', on)
  return () => conversionEvents.removeEventListener('change', on)
}
export const conversionNow = () => lastConversion
/** Marks the conversion done (a check answered) or still needed. */
export function setConversion(refusal: HostError | null) {
  if (refusal === lastConversion) return
  lastConversion = refusal
  conversionEvents.dispatchEvent(new Event('change'))
}


/**
 * A read of one address in flight, or queued behind the one in flight.
 * Reads of an address go one at a time: callers while one runs share the next
 * (it starts when that one ends, so it sees what changed meanwhile). A read the
 * host is slow to answer (a project's state under load can take 45 s) then
 * holds one of the browser's six connections to the host, not all of them,
 * and every other call is not left waiting behind them.
 */
interface Flight {
  promise: Promise<unknown>
  started: boolean
}
const flights = new Map<string, Flight>()

function oneAtATime<T>(path: string, run: () => Promise<T>): Promise<T> {
  const last = flights.get(path)
  if (last && !last.started) return last.promise as Promise<T>
  const flight: Flight = { promise: Promise.resolve(), started: false }
  const begin = () => {
    flight.started = true
    return run()
  }
  flight.promise = (last ? last.promise.catch(() => undefined).then(begin) : begin()).finally(() => {
    if (flights.get(path) === flight) flights.delete(path)
  })
  flights.set(path, flight)
  return flight.promise as Promise<T>
}

/**
 * Dev builds: a simulated host (components/simulation.tsx) answers the calls
 * about its sample home (`route`: a value, or an Error to refuse with) and can
 * add to a real answer (`extend`); every other call goes to the host.
 */
export interface SimHook {
  route: (method: string, path: string) => { value: unknown } | null
  extend?: (method: string, path: string, value: unknown) => unknown
}
let sim: SimHook | null = null
export const setSimHook = (hook: SimHook | null) => {
  sim = hook
}

export function call<T>(method: string, path: string, body?: unknown, activity?: CliAction): Promise<T> {
  const answer = exampleChatReply(method, path) ?? sim?.route(method, path)
  if (answer) return answer.value instanceof Error ? Promise.reject(answer.value) : Promise.resolve(answer.value as T)
  const action = activity ?? desktopAction(method, path)
  const real = method === 'GET' ? oneAtATime(path, () => send<T>(method, path, undefined, action)) : send<T>(method, path, body, action)
  return sim?.extend ? real.then((value) => (sim?.extend ? (sim.extend(method, path, value) as T) : value)) : real
}

async function send<T>(method: string, path: string, body?: unknown, action?: CliAction): Promise<T> {
  let reply: { status: number; body: unknown }
  try {
    reply = await connectBridge.request(method, path, body, action)
  } catch (error) {
    throw new HostError('no-host', error instanceof Error ? error.message : String(error), 0)
  }
  const value = (reply.body ?? {}) as { code?: string; message?: string; detail?: RefusalDetail; conversion?: boolean; transport?: string; activityId?: string }
  if (reply.status < 200 || reply.status >= 300) {
    const error = new HostError(value.code ?? 'failed', value.message ?? `${method} ${path}: ${reply.status}`, reply.status, value.detail ?? null, value.conversion === true, value.transport, value.activityId)
    if (error.conversion) setConversion(error)
    throw error
  }
  return value as T
}

const q = (params: Record<string, string | number | undefined>) => {
  const s = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined) as [string, string][]).toString()
  return s ? `?${s}` : ''
}
const enc = encodeURIComponent
/** A project key's route: `<store>/<project>` as one encoded segment. */
const at = (project: string) => `/api/projects/${enc(project)}`

/** Fires when the LayerFS projects change from this app: an Init ended, a project or Store was removed, a sync job ended. */
const projectsEvents = new EventTarget()
export function onProjectsChanged(listener: () => void): () => void {
  projectsEvents.addEventListener('change', listener)
  return () => projectsEvents.removeEventListener('change', listener)
}
const projectsChanged = <T>(value: T): T => {
  projectsEvents.dispatchEvent(new Event('change'))
  return value
}

export const host = {
  status: () => call<HostStatus>('GET', '/api/status'),
  /** Compute's machines (layerfs#533); `available: false` on a LayerFS with none. */
  inspectMachine: (name: string) => call<{ state?: string; observedAt: number }>('GET', `/api/machines/${enc(name)}/inspect`),
  machines: () => call<MachinesView>('GET', '/api/machines'),
  /** A VM. */
  createMachine: (input: NewMachine, activity?: CliAction) => call<unknown>('POST', '/api/machines', input, activity),
  /** machine.start: a stopped machine and its worker (nothing else starts one, #535 D11). */
  startMachine: (name: string, activity?: CliAction) => call<unknown>('POST', `/api/machines/${enc(name)}/start`, undefined, activity),
  /** machine.stop: refused InUse while Sandboxes run on it (detail.related names them). */
  stopMachine: (name: string) => call<unknown>('POST', `/api/machines/${enc(name)}/stop`),
  /** Removes a VM; refused InUse while it holds Stores or running Sandboxes. */
  removeMachine: (name: string) => call<unknown>('DELETE', `/api/machines/${enc(name)}`),
  /** A built-in's { image, docker, wsl }, or a VM's { cpus, memory }. */
  updateMachine: (name: string, changes: { image?: string; docker?: string; wsl?: string; cpus?: number; memory?: number }) => call<unknown>('POST', `/api/machines/${enc(name)}/update`, changes),
  projects: () => call<ProjectSummary[]>('GET', '/api/projects'),
  /** A new project: Init from `input.source` (absolute) or empty; into the existing Store `input.store` when given, else a new Store (layerfs#506). */
  createProject: (input: NewProjectInput) => call<ProjectInitJob>('POST', '/api/projects', input),
  projectInit: (id: string) =>
    call<ProjectInitJob>('GET', `/api/project-inits/${enc(id)}`).then((job) => (job.ended ? projectsChanged(job) : job)),
  // `project` below is a project key (ProjectSummary.key, else its name): `store/name` sends ?store= (layerfs#506)
  project: (project: string) => call<ProjectState>('GET', `${at(project)}`),
  /** The project's recorded Sandboxes; opening detail reads Workspaces on demand. */
  projectSandboxes: (project: string) => call<SandboxInfo[]>('GET', `${at(project)}/sandboxes`),
  /** A new Sandbox on `platform` (layerfs#529 sandbox.create({ platform })); left out, the home's default. */
  createSandbox: (project: string, input: { name: string; image?: string; machine?: string }) => call<SandboxRecord>('POST', `${at(project)}/sandboxes`, input),
  /** sandbox.close; `force` closes it with Workspaces whose state LayerFS cannot learn (listed in `unknown`). */
  closeSandbox: (name: string, force = false) => call<{ kind: string; closed: string; unknown: string[] }>('DELETE', `/api/sandboxes/${enc(name)}${q({ force: force ? '1' : undefined })}`),
  /** One Sandbox with its Workspaces (sandbox.get). */
  sandbox: (name: string) => call<SandboxInfo>('GET', `/api/sandboxes/${enc(name)}`),
  /** A Workspace in a Sandbox: a side Branch (D14), forked from main first when `fork`; `name` names it (<sandbox>:<name>). */
  mountWorkspace: (sandbox: string, input: { branch: string; fork?: boolean; name?: string }) => call<{ ws: string; name: string | null; path: string; branch: string }>('POST', `/api/sandboxes/${enc(sandbox)}/workspaces`, input),
  /** workspace.unmount; `discard` drops changes not committed. */
  unmountWorkspace: (ws: string, discard = false) => call<unknown>('DELETE', `/api/workspaces/${enc(ws)}${q({ discard: discard ? '1' : undefined })}`),
  /** Closes every Sandbox of the project (Delete's "Close N Sandboxes and delete"). */
  closeSandboxes: (project: string, force = false) => call<{ kind: string; closed: string; unknown: string[] }[]>('POST', `${at(project)}/close-sandboxes`, force ? { force: true } : {}),
  commits: (project: string, branch: string, limit = 200) =>
    call<CommitInfo[]>('GET', `${at(project)}/commits${q({ branch, limit })}`),
  /** Several Branches' Commits in one call (a Branch gone meanwhile is left out; main's are []). */
  branchCommits: (project: string, branches: string[]) =>
    call<Record<string, CommitInfo[]>>(
      'GET',
      `${at(project)}/branch-commits?${new URLSearchParams(branches.map((b) => ['branch', b])).toString()}`,
    ),
  list: (project: string, branch: string, path: string, pin?: string, pos = 0) =>
    call<{ items: FsEntry[]; next: number | null; at: { id: string } }>('GET', `${at(project)}/fs${q({ branch, path, pin, pos })}`),
  file: (project: string, branch: string, path: string, pin?: string, line = 1) =>
    call<{ path: string; size: number; binary: boolean; text: string | null; next_line?: number | null; truncated?: boolean; line_truncated?: boolean; at?: { id: string; kind?: string } }>(
      'GET',
      `${at(project)}/file${q({ branch, path, pin, line })}`,
    ),
  removeProject: (project: string) =>
    call<{ removed: true }>('DELETE', `${at(project)}`).then(projectsChanged),

  // ---------- scenarios and their runs (host/runs) ----------

  demos: () => call<DemoSummary[]>('GET', '/api/demos'),
  demo: (id: string) => call<DemoDetail>('GET', `/api/demos/${enc(id)}`),
  /** Plays scenario `id` on `project` (a project key: `store/name` in a shared Store), in a folder of its own. */
  startRun: (id: string, project: string) => call<RunSummary>('POST', `/api/demos/${enc(id)}/runs`, { project }),
  /** Plays every scenario on `project` at once, each in its own folder: the first run of each. */
  startAll: (project: string) => call<RunSummary[]>('POST', '/api/demos/all/runs', { project }),
  /** Runs, newest first; of scenario `demo` alone when given. */
  runs: (demo?: string) => call<RunSummary[]>('GET', `/api/runs${q({ demo })}`),
  run: (id: string) => call<RunDetail>('GET', `/api/runs/${enc(id)}`),
  /** One agent's Trace rows, the newest `limit` before `before` (default: the end). */
  trace: (id: string, o: { agent?: string; before?: number; limit?: number } = {}) =>
    call<TracePage>('GET', `/api/runs/${enc(id)}/trace${q(o)}`),
  stopRun: (id: string) => call<RunSummary>('POST', `/api/runs/${enc(id)}/stop`),
  /** Deletes a finished run's saved record and traces; its project stays. 409 while it plays. */
  removeRun: (id: string) => call<{ id: string }>('DELETE', `/api/runs/${enc(id)}`),

  // ---------- Storage (LayerFS 2.0) ----------

  /** Stores by machine, PostgreSQL Stores, buckets and this host's jobs. */
  storage: () => call<StorageView>('GET', '/api/storage'),
  /** `layerfs doctor` on the home: report-only (#537 §8.7). */
  doctor: () => call<DoctorReport>('GET', '/api/doctor'),
  /** A new, empty sqlite Store on native. */
  createStore: (name: string) => call<StorageView>('POST', '/api/stores', { name }).then(projectsChanged),
  /** Removes a Store and every project in it; `confirm` is the Store's name. */
  removeStore: (name: string, confirm: string) => call<StorageView>('DELETE', `/api/stores/${enc(name)}${q({ confirm })}`).then(projectsChanged),
  /** A PostgreSQL database as a Store: the URL holds no password; `password` is a reference (env:LAYERFS_… or file:/path). */
  connectPostgresql: (input: { name: string; url: string; password: string; synchronousCommit?: string }) => call<StorageView>('POST', '/api/stores/postgresql', input).then(projectsChanged),
  disconnectStore: (name: string) => call<StorageView>('POST', `/api/stores/${enc(name)}/disconnect`).then(projectsChanged),
  /** store.push: a sqlite Store on native to `machine`: a job. */
  pushStore: (store: string, machine: string) => call<StorageJob>('POST', `/api/stores/${enc(store)}/push`, { machine }),
  /** store.pull: a sqlite Store on a machine back to native: a job. */
  pullStore: (store: string) => call<StorageJob>('POST', `/api/stores/${enc(store)}/pull`),
  /** Between two machines: pull, then push, one job with two halves (#537 U5). */
  moveStore: (store: string, machine: string) => call<StorageJob>('POST', `/api/stores/${enc(store)}/move`, { machine }),
  /** Puts a sqlite Store on `machine`, whichever of push, pull or move that takes: a job. */
  placeStore: (store: string, machine: string) => call<StorageJob>('POST', `/api/machines/${enc(machine)}/stores`, { store }),
  /** Backs a sqlite Store up to `bucket` (as `file`, default its name): a job. */
  backupStore: (store: string, bucket: string, file?: string) => call<StorageJob>('POST', `/api/stores/${enc(store)}/backup`, { bucket, ...(file ? { file } : {}) }),
  /**
   * An r2 or MinIO bucket: its URL whole or by its parts, and either a key
   * reference (env:LAYERFS_… or file:/path) or the two keys, which the host
   * writes to an owner-only file and passes to LayerFS by reference.
   */
  connectBucket: (input: { name: string; url?: string; provider?: 'minio' | 'r2'; endpoint?: string; account?: string; jurisdiction?: string; bucket?: string; prefix?: string; key?: string; accessKey?: string; secretKey?: string; region?: string }) => call<StorageView>('POST', '/api/buckets', input),
  /** Drops the bucket and every Store's link to it: answers which Stores lost theirs. */
  replaceBucketKeys: (name: string, keys: { accessKey: string; secretKey: string }) => call<StorageView>('POST', `/api/buckets/${enc(name)}/keys`, keys),
  disconnectBucket: (name: string) => call<{ unlinked: string[]; view: StorageView }>('DELETE', `/api/buckets/${enc(name)}`),
  /** backup.list(bucket): its files with their states, now. */
  listBucket: (name: string) => call<{ at: number; items: BackupFile[] | null; error: { code: string; message: string } | null }>('GET', `/api/buckets/${enc(name)}/files`),
  /** Every bucket listed again (one call each); `bucket` alone when given. */
  checkStorage: (bucket?: string) => call<StorageView>('POST', '/api/storage/check', bucket ? { bucket } : {}),
  /** Restores `file` (default `store`) of `bucket` as the new Store `store`, on native: a job. */
  restoreBackup: (bucket: string, store: string, file?: string) => call<StorageJob>('POST', `/api/buckets/${enc(bucket)}/restore`, { store, ...(file ? { file } : {}) }),
  storageJobInspect: (id: string) => call<StorageJob>('POST', `/api/storage-jobs/${enc(id)}/inspect`),
  storageJobRetry: (id: string) => call<StorageJob>('POST', `/api/storage-jobs/${enc(id)}/retry`),
  workspaceStatus: (id: string) => call<{ branch_head: string | null }>('GET', `/api/workspaces/${enc(id)}/status`),
  storageJob: (id: string) => call<StorageJob>('GET', `/api/storage-jobs/${enc(id)}`).then((job) => (job.ended ? projectsChanged(job) : job)),
}

// One event stream for every listener: a browser keeps at most six connections
// to one host, and a stream per hook would leave none for the API calls.
const listeners = new Set<(event: HostEvent) => void>()
const connections = new Map<(event: HostEvent) => void, () => void>()
export type HostConnection = 'connecting' | 'connected' | 'reconnecting'
let connection: HostConnection = 'connecting'
const connectionListeners = new Set<(state: HostConnection) => void>()
function setConnection(next: HostConnection) {
  connection = next
  for (const listener of connectionListeners) listener(next)
  if (next === 'connected') for (const connected of connections.values()) connected()
}
export function onHostConnection(listener: (state: HostConnection) => void): () => void {
  connectionListeners.add(listener)
  listener(connection)
  return () => { connectionListeners.delete(listener) }
}

/** Main's forwarding of the host's event stream, opened once for the window's lifetime. */
let streaming = false
function ensureStream() {
  if (streaming) return
  streaming = true
  connectBridge.onStream((message) => {
    if (message.kind === 'connection') setConnection(message.state)
    else for (const l of [...listeners]) l(message.event as HostEvent)
  })
  void connectBridge.subscribe().catch(() => setConnection('reconnecting'))
}

/** Subscribes to the host's events (Storage's `sync` and `storage`); answers the unsubscribe. */
export function onHostEvent(listener: (event: HostEvent) => void, onConnect?: () => void): () => void {
  listeners.add(listener)
  if (onConnect) connections.set(listener, onConnect)
  ensureStream()
  if (onConnect && connection === 'connected') onConnect()
  return () => {
    listeners.delete(listener)
    connections.delete(listener)
  }
}

/** The event stream is open now; while it is not, callers fall back to polling (storage-redesign §8.4). */
export function hostEventsOpen(): boolean {
  return connection === 'connected'
}
