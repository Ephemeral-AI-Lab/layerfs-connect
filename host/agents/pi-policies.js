import { readFileSync, renameSync, writeFileSync } from 'node:fs'

// maxRetries remains owned by run-limits.json, including existing installations.
export const DEFAULT_PI_POLICIES = {
  compaction: { enabled: true, reserveTokens: 16384, keepRecentTokens: 20000 },
  retry: { enabled: true, baseDelayMs: 500, maxAgentDelayMs: 5000 },
}
const object = (value) => value && typeof value === 'object' && !Array.isArray(value)
const invalid = (message) => { throw Object.assign(new Error(message), { status: 400 }) }
const bounds = {
  compaction: { reserveTokens: [0, 10000000], keepRecentTokens: [0, 10000000] },
  retry: { maxRetries: [0, 5], baseDelayMs: [1, 60000], maxAgentDelayMs: [1, 60000] },
}
export function validatePiPolicies(input, previous) {
  if (!object(input)) invalid('Pi policies must be an object.')
  const next = structuredClone(previous)
  for (const [group, fields] of Object.entries(input)) {
    if (!Object.hasOwn(bounds, group) || !object(fields)) invalid(`Unknown or invalid Pi policy group: ${group}.`)
    for (const [key, value] of Object.entries(fields)) {
      if (key === 'enabled') {
        if (typeof value !== 'boolean') invalid(`${group}.enabled must be a boolean.`)
      } else {
        const range = bounds[group][key]
        if (!range || !Number.isSafeInteger(value) || value < range[0] || value > range[1]) invalid(`Invalid ${group}.${key}${range ? `: use an integer from ${range[0]} to ${range[1]}` : ''}.`)
      }
      next[group][key] = value
    }
  }
  if (next.retry.baseDelayMs > next.retry.maxAgentDelayMs) invalid('Initial retry delay must not exceed the maximum delay.')
  return next
}

export class PiPolicySettings {
  constructor(file) {
    this.file = file
    this.value = structuredClone(DEFAULT_PI_POLICIES)
    try { this.value = validatePiPolicies(JSON.parse(readFileSync(file, 'utf8')), this.value) }
    catch (error) { if (error.code !== 'ENOENT') console.error(`[agents] ignoring ${file}: ${error.message}`) }
  }
  get(maxRetries) { return { ...structuredClone(this.value), retry: { ...this.value.retry, maxRetries } } }
  set(policies) {
    const value = structuredClone(policies)
    delete value.retry.maxRetries
    writeFileSync(`${this.file}.tmp`, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 })
    renameSync(`${this.file}.tmp`, this.file)
    this.value = value
  }
  // Subagents load Pi's private agent-directory settings; preserve unrelated settings.
  syncAgentSettings(file, maxRetries) {
    let settings = {}
    try { settings = JSON.parse(readFileSync(file, 'utf8')) }
    catch (error) { if (error.code !== 'ENOENT') throw error }
    const policies = this.get(maxRetries)
    for (const group of ['compaction', 'retry']) settings[group] = { ...settings[group], ...policies[group] }
    settings.retry.enabled = policies.retry.enabled && maxRetries > 0
    writeFileSync(`${file}.tmp`, JSON.stringify(settings, null, 2) + '\n', { mode: 0o600 })
    renameSync(`${file}.tmp`, file)
  }
}
