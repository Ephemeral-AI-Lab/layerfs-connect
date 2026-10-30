export const DEFAULT_LIMITS = { maxTurns: 32, maxRuntimeSeconds: 1800, bashTimeoutSeconds: 120, maxRetries: 2, instructions: '' }

export function runLimits(input = {}, previous = DEFAULT_LIMITS) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Object.assign(new Error('Choose valid run limits.'), { status: 400 })
  const result = { ...DEFAULT_LIMITS, ...previous }
  for (const [field, min, max] of [['maxTurns', 0, 1000], ['maxRuntimeSeconds', 0, 86400], ['bashTimeoutSeconds', 1, 86400], ['maxRetries', 0, 5]]) {
    if (input[field] === undefined) continue
    if (!Number.isSafeInteger(input[field]) || input[field] < min || input[field] > max) throw Object.assign(new Error(`${field} must be an integer from ${min} to ${max}.`), { status: 400 })
    result[field] = input[field]
  }
  if (input.instructions !== undefined) {
    if (typeof input.instructions !== 'string' || input.instructions.length > 32768) throw Object.assign(new Error('Instructions must contain at most 32,768 characters.'), { status: 400 })
    result.instructions = input.instructions
  }
  return result
}

export const idleExecution = () => ({ phase: 'idle', startedAt: null, turns: 0, toolCalls: 0, retryAttempt: 0 })

/** The raw Pi tree includes billed attempts and compacted/abandoned branches. */
export function sessionUsage(manager) {
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: 0, toolCalls: 0 }
  const add = (value) => {
    if (!value) return
    for (const field of ['input', 'output', 'cacheRead', 'cacheWrite']) usage[field] += value[field] ?? 0
    usage.cost += value.cost?.total ?? 0
  }
  for (const entry of manager?.getEntries() ?? []) {
    if (['usage', 'compaction', 'branch_summary'].includes(entry.type)) add(entry.usage)
    if (entry.type !== 'message') continue
    if (entry.message.role === 'assistant') {
      usage.toolCalls += entry.message.content.filter((part) => part.type === 'toolCall').length
      add(entry.message.usage)
    } else if (entry.message.role === 'toolResult') add(entry.message.usage)
  }
  usage.totalTokens = usage.input + usage.output + usage.cacheRead + usage.cacheWrite
  return usage
}
