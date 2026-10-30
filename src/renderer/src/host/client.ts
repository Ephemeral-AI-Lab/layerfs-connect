// The Connect host's HTTP API (host/README.md), typed by @shared/host-api.
import type {
  FsEntry,
  CommitInfo,
  HostStatus,
  ProjectState,
  ProjectSummary,
  NewProjectInput,
  ProjectInitJob,
  RunDetail,
  HostEvent,
} from '@shared/host-api'

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

export async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
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

export const host = {
  status: () => call<HostStatus>('GET', '/api/status'),
  startWorker: () => call<HostStatus>('POST', '/api/worker/start'),
  projects: () => call<ProjectSummary[]>('GET', '/api/projects'),
  createProject: (input: NewProjectInput) => call<ProjectInitJob>('POST', '/api/projects', input),
  projectInit: (id: string) => call<ProjectInitJob>('GET', `/api/project-inits/${enc(id)}`),
  project: (name: string) => call<ProjectState>('GET', `/api/projects/${enc(name)}`),
  commits: (name: string, branch: string, limit = 200) =>
    call<CommitInfo[]>('GET', `/api/projects/${enc(name)}/commits${q({ branch, limit })}`),
  list: (name: string, branch: string, path: string) =>
    call<FsEntry[]>('GET', `/api/projects/${enc(name)}/fs${q({ branch, path })}`),
  file: (name: string, branch: string, path: string) =>
    call<{ path: string; size: number; binary: boolean; text: string | null }>(
      'GET',
      `/api/projects/${enc(name)}/file${q({ branch, path })}`,
    ),
  removeProject: (name: string) => call<{ removed: true }>('DELETE', `/api/projects/${enc(name)}`),
  run: (id: string) => call<RunDetail>('GET', `/api/runs/${enc(id)}`),

}

// One event stream for every listener: a browser keeps at most six connections
// to one host, and a stream per hook would leave none for the API calls.
const listeners = new Set<(event: HostEvent) => void>()
const connections = new Map<(event: HostEvent) => void, () => void>()
let source: EventSource | null = null
export type HostConnection = 'connecting' | 'connected' | 'reconnecting'
let connection: HostConnection = 'connecting'
const connectionListeners = new Set<(state: HostConnection) => void>()
function setConnection(next: HostConnection) {
  connection = next
  for (const listener of connectionListeners) listener(next)
}
export function onHostConnection(listener: (state: HostConnection) => void): () => void {
  connectionListeners.add(listener)
  listener(connection)
  return () => { connectionListeners.delete(listener) }
}

/** Subscribes to the host's events; answers the unsubscribe. */
export function onHostEvent(listener: (event: HostEvent) => void, onConnect?: () => void): () => void {
  const host = hostEndpoint()
  if ('error' in host) return () => {}
  listeners.add(listener)
  if (onConnect) connections.set(listener, onConnect)
  if (!source) {
    setConnection('connecting')
    source = new EventSource(`${host.url}/api/events?token=${enc(host.token)}`)
    source.onmessage = (m) => {
      const event = JSON.parse(m.data) as HostEvent
      for (const l of [...listeners]) l(event)
    }
    source.onopen = () => { setConnection('connected'); for (const connected of connections.values()) connected() }
    source.onerror = () => { setConnection('reconnecting') }
  } else if (onConnect && source.readyState === EventSource.OPEN) {
    onConnect()
  }
  return () => {
    listeners.delete(listener)
    connections.delete(listener)
    if (listeners.size === 0 && source) {
      source.close()
      source = null
    }
  }
}
