import type { ChatDetail } from '@/layerfs/agent-api'
import type { PiPolicies } from '@/layerfs/pi-policies'

export const POLICY_PREVIEWS = [
  ['original', 'Original chat'], ['near-limit', 'Near context limit'], ['compacting', 'Compacting'],
  ['compacted', 'Compaction completed'], ['retrying', 'Retrying'], ['exhausted', 'Retries exhausted'], ['compact-failed', 'Compaction failed'],
] as const
export type PolicyPreview = typeof POLICY_PREVIEWS[number][0]
export const SAMPLE_POLICIES: PiPolicies = {
  compaction: { enabled: true, reserveTokens: 16384, keepRecentTokens: 20000 },
  retry: { enabled: true, maxRetries: 2, baseDelayMs: 500, maxAgentDelayMs: 5000 },
}
export function previewChat(source: ChatDetail, mode: PolicyPreview, policies: PiPolicies): ChatDetail {
  if (mode === 'original') return source
  const contextWindow = 200000
  const tokens = Math.max(1, contextWindow - policies.compaction.reserveTokens + 1000)
  const next: ChatDetail = { ...source, scenario: null, state: 'idle', error: null, recovery: undefined,
    contextUsage: { tokens, contextWindow, percent: tokens / contextWindow * 100 },
    execution: { phase: 'idle', startedAt: null },
  }
  if (mode === 'compacting') {
    next.state = 'running'; next.execution = { phase: 'compacting', startedAt: Date.now() }
  }
  if (mode === 'compacted') {
    next.contextUsage = { tokens: null, contextWindow, percent: null }
    next.messages = [...source.messages, { id: 'example-pi-summary', role: 'assistant', details: { kind: 'compactionSummary' }, text: `Goal: Add project search.\nConstraints: Preserve existing behavior and use LayerFS checkpoints.\nDone: Normalize names and queries; empty and mixed-case tests pass.\nDecision: Use case-insensitive matching.\nNext: Review the change with the user.\nRecent context retained: approximately ${policies.compaction.keepRecentTokens.toLocaleString()} tokens.\nFiles: src/filter.ts, test/filter.test.ts.\n\nSimulated summary; no model ran.` }]
  }
  if (mode === 'retrying') {
    next.state = 'running'; next.execution = { phase: 'retrying', startedAt: Date.now(), retryAttempt: 1, retryMaxAttempts: policies.retry.maxRetries, retryAt: Date.now() + policies.retry.baseDelayMs, reason: '503 · The model provider is temporarily overloaded.' }
  }
  if (mode === 'exhausted') {
    next.state = 'error'; next.error = `The provider is still unavailable after ${policies.retry.maxRetries} retries. Completed commands were preserved.`
    next.execution = { phase: 'error', startedAt: null, retryAttempt: policies.retry.maxRetries }; next.recovery = { required: true, canContinue: true }
  }
  if (mode === 'compact-failed') {
    next.state = 'error'; next.error = 'Compaction failed: the summary request could not reach the model provider. No summary was saved; history is preserved.'
    next.execution = { phase: 'error', startedAt: null }
  }
  return next
}
