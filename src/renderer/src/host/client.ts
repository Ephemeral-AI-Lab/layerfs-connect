// The Connect host's HTTP API (host/README.md), typed by @shared/host-api.
import type {
  DemoDetail,
  DemoSummary,
  FsEntry,
  CommitInfo,
  CustomProviderInput,
  HostEvent,
  HostStatus,
  InitJob,
  LoginView,
  ModelsView,
  NewRemote,
  RemoteFile,
  ProjectState,
  ProjectSummary,
  RunDetail,
  RunSummary,
  SessionMessage,
  StorageCheck,
  StorageView,
  SyncJob,
  SynchronousCommit,
  TracePage,
} from '@shared/host-api'
import { projectRef } from '@shared/host-api'

export class HostError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

/** The host's address, or why there is none. */
export function hostEndpoint(): { url: string; token: string } | { error: string } {
  return window.connect.host ?? { error: 'The Connect host did not start.' }
}

/**
 * A read of one address in flight, or queued behind the one in flight.
 * Reads of an address go one at a time: callers while one runs share the next
 * (it starts when that one ends, so it sees what changed meanwhile). A read the
 * host is slow to answer (a project's state under load can take 45 s) then
 * holds one of the browser's six connections to the host, not all of them,
 * and a session's own read is not left waiting behind them.
 */
interface Flight {
  promise: Promise<unknown>
  started: boolean
}
const flights = new Map<string, Flight>()

function oneAtATime<T>(path: string, send: () => Promise<T>): Promise<T> {
  const last = flights.get(path)
  if (last && !last.started) return last.promise as Promise<T>
  const flight: Flight = { promise: Promise.resolve(), started: false }
  const begin = () => {
    flight.started = true
    return send()
  }
  flight.promise = (last ? last.promise.catch(() => undefined).then(begin) : begin()).finally(() => {
    if (flights.get(path) === flight) flights.delete(path)
  })
  flights.set(path, flight)
  return flight.promise as Promise<T>
}

function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  return method === 'GET' ? oneAtATime(path, () => send<T>(method, path)) : send<T>(method, path, body)
}

async function send<T>(method: string, path: string, body?: unknown): Promise<T> {
  const host = hostEndpoint()
  if ('error' in host) throw new HostError('no-host', host.error, 0)
  const res = await fetch(`${host.url}${path}`, {
    method,
    headers: { authorization: `Bearer ${host.token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const value = await res.json().catch(() => ({}))
  if (!res.ok) throw new HostError(value.code ?? 'failed', value.message ?? `${method} ${path}: ${res.status}`, res.status)
  return value as T
}

const q = (params: Record<string, string | number | undefined>) => {
  const s = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined) as [string, string][]).toString()
  return s ? `?${s}` : ''
}
const enc = encodeURIComponent
/** A project key's route and Store (undefined for a project with a Store of its own). */
const at = (project: string) => {
  const { name, store } = projectRef(project)
  return { path: `/api/projects/${enc(name)}`, store: store ?? undefined }
}

/** Fires when the LayerFS projects change from this app: an Init ended, a project was removed. */
const projectsEvents = new EventTarget()
export function onProjectsChanged(listener: () => void): () => void {
  projectsEvents.addEventListener('change', listener)
  return () => projectsEvents.removeEventListener('change', listener)
}
const projectsChanged = () => projectsEvents.dispatchEvent(new Event('change'))

export const host = {
  status: () => call<HostStatus>('GET', '/api/status'),
  startWorker: () => call<HostStatus>('POST', '/api/worker/start'),
  projects: () => call<ProjectSummary[]>('GET', '/api/projects'),
  // `project` is a project key (ProjectSummary.key): `store/name` sends ?store= (layerfs#506)
  project: (project: string) => call<ProjectState>('GET', `${at(project).path}${q({ store: at(project).store })}`),
  commits: (project: string, branch: string, limit = 200) =>
    call<CommitInfo[]>('GET', `${at(project).path}/commits${q({ branch, limit, store: at(project).store })}`),
  /** Several Branches' Commits in one call (a Branch gone meanwhile is left out). */
  branchCommits: (project: string, branches: string[]) =>
    call<Record<string, CommitInfo[]>>(
      'GET',
      `${at(project).path}/branch-commits?${new URLSearchParams([...branches.map((b) => ['branch', b]), ...(at(project).store ? [['store', at(project).store!]] : [])]).toString()}`,
    ),
  list: (project: string, branch: string, path: string) =>
    call<FsEntry[]>('GET', `${at(project).path}/fs${q({ branch, path, store: at(project).store })}`),
  file: (project: string, branch: string, path: string) =>
    call<{ path: string; size: number; binary: boolean; text: string | null }>(
      'GET',
      `${at(project).path}/file${q({ branch, path, store: at(project).store })}`,
    ),
  removeProject: (project: string) =>
    call<{ removed: true }>('DELETE', `${at(project).path}${q({ store: at(project).store })}`).then((answer) => {
      projectsChanged()
      return answer
    }),
  /** Stores, remotes, PostgreSQL connections and running jobs (layerfs#506). */
  storage: () => call<StorageView>('GET', '/api/storage'),
  /** A new, empty local SQLite Store. */
  createStore: (name: string) =>
    call<StorageView>('POST', '/api/stores', { name }).then((view) => {
      projectsChanged()
      return view
    }),
  /** Deletes a Store and every project in it; `confirm` is the Store's name. */
  removeStore: (name: string, confirm: string) =>
    call<StorageView>('DELETE', `/api/stores/${enc(name)}${q({ confirm })}`).then((view) => {
      projectsChanged()
      return view
    }),
  /** Runs link checks (one HEAD per linked Store), connection listings and PostgreSQL status reads, then answers the view; an empty body checks everything. */
  checkStorage: (body: StorageCheck = {}) => call<StorageView>('POST', '/api/storage/check', body),
  /** Uploads an unlinked Store to a new file `file` (default its name) on `remote`, and links it (layerfs#509). */
  publish: (store: string, remote: string, file?: string) => call<SyncJob>('POST', `/api/stores/${enc(store)}/publish`, { remote, ...(file ? { file } : {}) }),
  /** Uploads the whole Store (all of its projects) to its link; `force` replaces a file that changed since the last push or pull. */
  push: (store: string, options: { force?: boolean } = {}) => call<SyncJob>('POST', `/api/stores/${enc(store)}/push`, options.force ? { force: true } : {}),
  /** Replaces the whole Store with its linked file; `confirm` is the Store's name. */
  pull: (store: string, confirm: string) => call<SyncJob>('POST', `/api/stores/${enc(store)}/pull`, { confirm }),
  /** Uploads a copy of the Store to a new, unlinked file on `remote`; the Store's link does not change. */
  send: (store: string, remote: string, file: string) => call<SyncJob>('POST', `/api/stores/${enc(store)}/send`, { remote, file }),
  /** Drops the Store's link; the file stays, loadable. `confirm` is the Store's name. */
  unlink: (store: string, confirm: string) =>
    call<StorageView>('POST', `/api/stores/${enc(store)}/unlink`, { confirm }).then((view) => {
      projectsChanged()
      return view
    }),
  /** Copies a SQLite Store into a schema of `connection`, as the new Store `name`. */
  importPostgresql: (store: string, connection: string, name?: string) =>
    call<SyncJob>('POST', `/api/stores/${enc(store)}/import-postgresql`, { connection, ...(name ? { name } : {}) }),
  addRemote: (remote: NewRemote) => call<StorageView>('POST', '/api/remotes', remote),
  removeRemote: (name: string) => call<StorageView>('DELETE', `/api/remotes/${enc(name)}`),
  /** The files in a connection's bucket now, each with the Store linked to it. */
  remoteFiles: (remote: string) => call<RemoteFile[]>('GET', `/api/remotes/${enc(remote)}/files`),
  /** A new local Store `store` (default the file's name) from `file` in `remote`, linked to it. */
  load: (remote: string, file: string, store?: string) => call<SyncJob>('POST', `/api/remotes/${enc(remote)}/load`, { file, ...(store ? { store } : {}) }),
  addPostgresql: (connection: { name: string; url: string; synchronousCommit: SynchronousCommit }) => call<StorageView>('POST', '/api/postgresql', connection),
  removePostgresql: (name: string) => call<StorageView>('DELETE', `/api/postgresql/${enc(name)}`),
  syncJob: (id: string) =>
    call<SyncJob>('GET', `/api/sync-jobs/${enc(id)}`).then((job) => {
      if (job.ended) projectsChanged()
      return job
    }),
  demos: () => call<DemoSummary[]>('GET', '/api/demos'),
  demo: (id: string) => call<DemoDetail>('GET', `/api/demos/${enc(id)}`),
  /** Plays scenario `id` on `project` (default: its own), resetting the project first; `confirm` (the project's name) allows it on a project no scenario made. */
  /** Plays scenario `id` on `project`, in a folder of its own. */
  startRun: (id: string, project: string) => call<RunSummary>('POST', `/api/demos/${enc(id)}/runs`, { project }),
  /** Plays every scenario on `project` at once: the first run of each. */
  startAll: (project: string) => call<RunSummary[]>('POST', '/api/demos/all/runs', { project }),
  /** A new project: Init from `folder` (absolute), or empty without one; into Store `store` when given, else into a new Store (layerfs#506). */
  createProject: (name: string, folder?: string, store?: string) =>
    call<InitJob>('POST', '/api/projects', { name, ...(folder ? { folder } : {}), ...(store ? { store } : {}) }),
  initJob: (id: string) =>
    call<InitJob>('GET', `/api/inits/${enc(id)}`).then((job) => {
      if (job.ended) projectsChanged()
      return job
    }),
  /** A live session on `project`, as it is; `text` is its first message. */
  startSession: (project: string, message?: Partial<SessionMessage>) => call<RunSummary>('POST', '/api/sessions', { project, ...message }),
  sendMessage: (id: string, message: SessionMessage) => call<RunSummary>('POST', `/api/runs/${enc(id)}/messages`, message),
  runs: (demo?: string) => call<RunSummary[]>('GET', `/api/runs${q({ demo })}`),
  run: (id: string) => call<RunDetail>('GET', `/api/runs/${enc(id)}`),
  /** One agent's Trace rows, the newest `limit` before `before` (default: the end). */
  trace: (id: string, o: { agent?: string; before?: number; limit?: number } = {}) => call<TracePage>('GET', `/api/runs/${enc(id)}/trace${q(o)}`),
  stopRun: (id: string) => call<RunSummary>('POST', `/api/runs/${enc(id)}/stop`),
  models: () => call<ModelsView>('GET', '/api/models'),
  saveProvider: (id: string, change: { key?: string; baseUrl?: string | null }) =>
    call<ModelsView>('POST', `/api/models/providers/${enc(id)}`, change),
  removeProvider: (id: string) => call<ModelsView>('DELETE', `/api/models/providers/${enc(id)}`),
  saveCustomProvider: (input: CustomProviderInput) => call<ModelsView>('POST', '/api/models/custom', input),
  setDefaultModel: (choice: { provider: string; model: string; thinking: string }) =>
    call<ModelsView>('POST', '/api/models/default', choice),
  startLogin: (provider: string) => call<LoginView>('POST', `/api/models/providers/${enc(provider)}/login`),
  login: (id: string) => call<LoginView>('GET', `/api/models/logins/${enc(id)}`),
  respondLogin: (id: string, value: string) => call<LoginView>('POST', `/api/models/logins/${enc(id)}/respond`, { value }),
  cancelLogin: (id: string) => call<LoginView>('POST', `/api/models/logins/${enc(id)}/cancel`),
  openLogin: (id: string) => call<LoginView>('POST', `/api/models/logins/${enc(id)}/open`),
}

// One event stream for every listener: a browser keeps at most six connections
// to one host, and a stream per hook would leave none for the API calls.
const listeners = new Set<(event: HostEvent) => void>()
let source: EventSource | null = null

/** Subscribes to the host's events (runs, and Storage's `sync` and `storage`); answers the unsubscribe. */
export function onHostEvent(listener: (event: HostEvent) => void): () => void {
  const host = hostEndpoint()
  if ('error' in host) return () => {}
  listeners.add(listener)
  if (!source) {
    source = new EventSource(`${host.url}/api/events?token=${enc(host.token)}`)
    source.onmessage = (m) => {
      const event = JSON.parse(m.data) as HostEvent
      for (const l of [...listeners]) l(event)
    }
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && source) {
      source.close()
      source = null
    }
  }
}

/** The event stream is open now; while it is not, callers fall back to polling (storage-redesign §8.4). */
export function hostEventsOpen(): boolean {
  return source !== null && source.readyState === EventSource.OPEN
}
