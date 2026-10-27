// The Connect host's HTTP API (host/README.md), typed by @shared/host-api.
import type {
  DemoDetail,
  DemoSummary,
  FsEntry,
  CommitInfo,
  HostStatus,
  ProjectState,
  ProjectSummary,
  RunDetail,
  RunEvent,
  RunSummary,
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

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
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
  demos: () => call<DemoSummary[]>('GET', '/api/demos'),
  demo: (id: string) => call<DemoDetail>('GET', `/api/demos/${enc(id)}`),
  startRun: (id: string) => call<RunSummary>('POST', `/api/demos/${enc(id)}/runs`),
  runs: (demo?: string) => call<RunSummary[]>('GET', `/api/runs${q({ demo })}`),
  run: (id: string) => call<RunDetail>('GET', `/api/runs/${enc(id)}`),
  stopRun: (id: string) => call<RunSummary>('POST', `/api/runs/${enc(id)}/stop`),
}

/** Subscribes to the host's events; answers the unsubscribe. */
export function onHostEvent(listener: (event: RunEvent) => void): () => void {
  const host = hostEndpoint()
  if ('error' in host) return () => {}
  const source = new EventSource(`${host.url}/api/events?token=${enc(host.token)}`)
  source.onmessage = (m) => listener(JSON.parse(m.data) as RunEvent)
  return () => source.close()
}
