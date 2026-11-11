import { connectBridge } from './bridge'
import type { CliActivity, CliActivityPage, CliInvocation, CliInvocationPage } from '../../../../../shared/cli-activity'
export type { CliActivity, CliInvocation, CliText } from '../../../../../shared/cli-activity'
export interface ActivityState { environment: string; home: string; busy: boolean; generation: string; clearedAt: number | null }

async function read<T>(path: string): Promise<T> {
  const reply = await connectBridge.request('GET', path)
  if (reply.status !== 200) throw new Error('CLI activity could not be loaded. Check the host connection and try again.')
  return reply.body as T
}
export const activityApi = {
  state: () => read<ActivityState>('/api/cli-activity/state'),
  clear: async (state: ActivityState) => {
    const reply = await connectBridge.request('POST', '/api/cli-activity/clear', { confirm: true, home: state.home, generation: state.generation })
    if (reply.status !== 200) throw new Error((reply.body as { message?: string })?.message || 'History could not be cleared. Refresh its status before trying again.')
    return reply.body as { cleared: true; clearedAt: number }
  },
  list: (params: { origin: string; status: string; search: string; before?: string }) => read<CliActivityPage>(`/api/cli-activity?summary=1&${new URLSearchParams(Object.entries(params).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)]))}`),
  // Machine progress consumes its small action's complete stage events.
  get: (id: string) => read<CliActivity | { cleared: true; id: string } | null>(`/api/cli-activity/${encodeURIComponent(id)}`),
  summary: (id: string) => read<CliActivity | { cleared: true; id: string } | null>(`/api/cli-activity/${encodeURIComponent(id)}?summary=1`),
  invocations: (id: string, params: { after?: string; project?: string; limit?: number } = {}) => read<CliInvocationPage>(`/api/cli-activity/${encodeURIComponent(id)}/invocations?${new URLSearchParams(Object.entries(params).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)]))}`),
  invocation: (actionId: string, id: string) => read<CliInvocation | null>(`/api/cli-activity/${encodeURIComponent(actionId)}/invocations/${encodeURIComponent(id)}`),
}
