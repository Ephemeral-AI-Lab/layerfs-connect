import { readFileSync, renameSync, writeFileSync } from 'node:fs'

export const DEFAULT_LIMITS = { bashTimeoutSeconds: 900, maxRetries: 2, instructions: '' }

/** The old default command timeout: chats still on it move to the current setting (AgentManager). */
export const OLD_DEFAULT_BASH_TIMEOUT_SECONDS = 120

/** Limits earlier versions kept that no longer exist; dropped from saved chats. */
export const REMOVED_LIMITS = ['maxTurns', 'maxRuntimeSeconds']

export function runLimits(input = {}, previous = DEFAULT_LIMITS) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Object.assign(new Error('Choose valid run limits.'), { status: 400 })
  const result = { ...DEFAULT_LIMITS, ...previous }
  for (const field of REMOVED_LIMITS) delete result[field]
  for (const [field, min, max] of [['bashTimeoutSeconds', 1, 86400], ['maxRetries', 0, 5]]) {
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

/** The limits Settings → Runs edits; a chat's additional instructions stay its own. */
export const RUN_LIMIT_FIELDS = ['bashTimeoutSeconds', 'maxRetries']
const pickRunLimits = (value) => Object.fromEntries(RUN_LIMIT_FIELDS.map((field) => [field, value[field]]))

/** The run limits every chat uses (Settings → Runs), kept in run-limits.json. */
export class RunLimitSettings {
  constructor(file) {
    this.file = file
    this.value = pickRunLimits(DEFAULT_LIMITS)
    try {
      this.value = pickRunLimits(runLimits(pickRunLimits(JSON.parse(readFileSync(file, 'utf8')))))
    } catch (error) {
      if (error.code !== 'ENOENT') console.error(`[agents] ignoring ${file}: ${error.message}`)
    }
  }

  get() { return { ...this.value } }

  /** Checks a change against the current limits without saving it. */
  check(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return runLimits(input)
    const change = Object.fromEntries(RUN_LIMIT_FIELDS.filter((field) => input[field] !== undefined).map((field) => [field, input[field]]))
    return pickRunLimits(runLimits(change, this.value))
  }

  set(input) {
    const next = this.check(input)
    writeFileSync(`${this.file}.tmp`, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 })
    renameSync(`${this.file}.tmp`, this.file)
    this.value = next
    return this.get()
  }
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
