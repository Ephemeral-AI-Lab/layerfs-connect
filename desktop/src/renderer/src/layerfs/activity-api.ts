import { connectBridge } from './bridge'
import type { CliActivity, CliActivityPage } from '../../../../../shared/cli-activity'
export type { CliActivity, CliInvocation, CliText } from '../../../../../shared/cli-activity'

async function read<T>(path: string): Promise<T> {
  const reply = await connectBridge.request('GET', path)
  if (reply.status !== 200) throw new Error('CLI activity could not be loaded. Check the host connection and try again.')
  return reply.body as T
}
export const activityApi = {
  list: (params: { origin: string; status: string; search: string; before?: string }) => read<CliActivityPage>(`/api/cli-activity?${new URLSearchParams(Object.entries(params).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)]))}`),
  get: (id: string) => read<CliActivity | { cleared: true; id: string } | null>(`/api/cli-activity/${encodeURIComponent(id)}`),
}
