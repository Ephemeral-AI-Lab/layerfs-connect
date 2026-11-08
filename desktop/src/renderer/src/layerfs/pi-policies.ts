import { call } from './client'

export interface PiPolicies {
  compaction: { enabled: boolean; reserveTokens: number; keepRecentTokens: number }
  retry: { enabled: boolean; maxRetries: number; baseDelayMs: number; maxAgentDelayMs: number }
}
export interface PiPolicyView { policies: PiPolicies; defaults: PiPolicies; busy: string[] }
export const piPolicyHost = {
  get: () => call<PiPolicyView>('GET', '/api/agent/pi-policies'),
  save: (policies: PiPolicies) => call<PiPolicyView>('POST', '/api/agent/pi-policies', policies),
}
