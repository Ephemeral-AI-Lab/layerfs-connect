import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { execute } from '../cli/spawn.js'
import { stringify } from '../cli/json.js'
/** Persisted launch ownership also covers workspace exec inside folder Bash. */
export function registerExec(directory, execution) {
  if (!directory) return () => {}
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const file = join(directory, `${execution.exec_id}.json`)
  if (existsSync(join(directory, 'stopping'))) throw new Error('The chat is stopping; queued command was not launched.')
  writeFileSync(file, JSON.stringify(execution), { mode: 0o600 })
  // Close the check/register race with the host's persistent Stop marker.
  if (existsSync(join(directory, 'stopping'))) { rmSync(file); throw new Error('The chat is stopping; queued command was not launched.') }
  return () => rmSync(file, { force: true })
}
export function resumeExecs(directory) { rmSync(join(directory, 'stopping'), { force: true }) }
export async function cancelExecs(directory, run = execute) {
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  writeFileSync(join(directory, 'stopping'), '', { mode: 0o600 })
  const results = []
  for (const name of readdirSync(directory).filter(n => n.endsWith('.json'))) {
    const file = join(directory, name)
    const launch = JSON.parse(readFileSync(file, 'utf8'))
    // One explicit attempt per Stop intent; an unknown outcome is retained.
    if (launch.cancel && launch.cancel.outcome !== 'unknown') { results.push(launch.cancel); continue }
    try {
      if (launch.cancel?.outcome === 'unknown') launch.observation = await run({ cli: launch.cli, home: launch.home }, ['workspace', 'status', launch.ws], { read: true })
      launch.cancel = await run({ cli: launch.cli, home: launch.home }, ['workspace', 'exec-cancel', launch.ws, launch.exec_id])
    }
    catch (error) { launch.cancel = { outcome: 'unknown', message: error.message, code: error.code } }
    if (existsSync(file)) writeFileSync(file, stringify(launch), { mode: 0o600 })
    results.push(launch.cancel)
  }
  return results
}
