import { call } from './client'
import type { AgentCapabilities, AgentCapabilityChange } from '../../../../../src/shared/agent-api'

export type { AgentCapabilities, AgentCapabilityChange, AgentKind } from '../../../../../src/shared/agent-api'

export const capabilityHost = {
  get: () => call<AgentCapabilities>('GET', '/api/agent/capabilities'),
  change: (input: AgentCapabilityChange) => call<AgentCapabilities>('POST', '/api/agent/capabilities', input),
}
