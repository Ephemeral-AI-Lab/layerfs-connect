import { call } from './client'
import type { SimulationInput } from './simulation-command'

export interface SimulationRun {
  id: string
  state: string
  project: string | null
  sessionId?: string | null
  error?: string | null
  progress?: { completed: number; total: number }
}
const path = (id: string) => `/api/simulations/${encodeURIComponent(id)}`
export const simulationHost = {
  create: (input: SimulationInput) => call<SimulationRun>('POST', '/api/simulations', input),
  get: (id: string) => call<SimulationRun>('GET', path(id)),
  stop: (id: string) => call<SimulationRun>('POST', `${path(id)}/stop`, {}),
}
export const simulationEnded = (state: string) => ['completed', 'failed', 'stopped', 'error', 'cancelled', 'interrupted'].includes(state)
