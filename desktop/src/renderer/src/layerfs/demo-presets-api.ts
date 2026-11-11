import { call } from './client'
import { connectBridge } from './bridge'
import type { CleanupPlan, DemoPresets, EnvironmentResetPlan, PresetJob, PresetScript, PresetExecutionMode } from '../../../../../shared/demo-presets'
export type { CleanupPlan, DemoPreset, DemoPresets, EnvironmentResetPlan, PresetJob, PresetScript, PresetExecutionMode } from '../../../../../shared/demo-presets'

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (method === 'GET') return call<T>(method, `/api/demo-presets${path}`)
  const reply = await connectBridge.request(method, `/api/demo-presets${path}`, body)
  if (reply.status !== 200) throw Object.assign(new Error((reply.body as { message?: string })?.message || 'Preset controls are unavailable. Reconnect to an updated host and try again.'), { status: reply.status })
  return reply.body as T
}
export const presetApi = {
  buildPlan: (environment: string, sandboxes: boolean, executionMode: PresetExecutionMode = 'filesystem') => request<EnvironmentResetPlan>('GET', `/${environment}/${sandboxes ? 'build-plan' : 'build-plan-no-sandboxes'}?executionMode=${executionMode}`),
  script: (preset: string, sandboxes: boolean, page?: { offset: number; limit?: number; snapshot?: string; kind?: string; name?: string }, executionMode: PresetExecutionMode = 'filesystem') => request<PresetScript>('GET', `/${preset}/${sandboxes ? 'script' : 'script-no-sandboxes'}?${new URLSearchParams(Object.entries({ ...page, executionMode }).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)]))}`),
  job: (id: string) => request<PresetJob>('GET', `/jobs/${encodeURIComponent(id)}`),
  environmentPlan: (environment: string) => request<EnvironmentResetPlan>('GET', `/${environment}/environment-plan`),
  resetEnvironment: (environment: string, input: { requestId: string; expectedPlan: string; confirm: true; rebuild: boolean; sandboxes: boolean; executionMode?: PresetExecutionMode }) => request<PresetJob>('POST', `/${environment}/environment-reset`, input),
  list: () => request<DemoPresets>('GET', ''),
  operation: (requestId: string) => request<PresetJob>('GET', `/requests/${encodeURIComponent(requestId)}`),
  activate: (preset: string) => request<{ active: string }>('POST', `/${preset}/activate`, {}),
  run: (preset: string, input: { requestId: string; sandboxes: boolean }) => request<PresetJob>('POST', `/${preset}/run`, input),
  plan: (preset: string, command: 'reset' | 'teardown') => request<CleanupPlan>('GET', `/${preset}/${command}-plan`),
  reset: (preset: string, input: { requestId: string; sandboxes: boolean; expectedRevision: string | null; expectedCleanup: string; clearActivity: true }) => request<PresetJob>('POST', `/${preset}/reset`, input),
  teardown: (preset: string, input: { requestId: string; sandboxes: boolean; expectedRevision: string | null; expectedCleanup: string }) => request<PresetJob>('POST', `/${preset}/teardown`, input),
}

// Reload only the renderer: clears home-scoped caches and reconnects the one stream.
// The host job survives navigation and reload, and is never submitted again here.
export function reloadEnvironment(path = '/presets') { window.location.hash = `#${path}`; window.location.reload() }
