// The final checks of a finished run, after its root agent's last step. A
// scenario with a recorded final.json (the replays: shop, depot, crew) has
// its run's project checked against it, through the run's open client:
//   final.order    every Branch's Commits, forks, merges and publishes as recorded
//   final.tree     main's tracked files have the recorded SHA-256 (hashed in
//                  a Workspace of a Branch forked from main for the check)
//   final.closed   no Sandbox of the project still runs
// A scenario without final.json has no final checks. Each check is one
// attempt; one that throws fails with its error, and the next still runs.
// A run in a scope (host/runs/scope.js) is checked on its folder, Branches,
// trunks and Sandboxes only: other runs may be playing in the project.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { LayerFSBackend } from '@layerfs/backend'
import { finalTreeFailures, openSandboxes, orderFailures } from './final.js'

/** How many failure messages a check's detail lists before it counts the rest. */
const SHOWN = 8

/** One CheckResult from a check's failure messages. */
export function result(name, failures, passed) {
  if (!failures.length) return { name, ok: true, detail: passed }
  const more = failures.length > SHOWN ? `\n… and ${failures.length - SHOWN} more` : ''
  return { name, ok: false, detail: `${failures.length} failure(s):\n${failures.slice(0, SHOWN).join('\n')}${more}` }
}

/** final.json beside the scenario, or null when it has none. */
export function readFinal(scenarioDir) {
  const file = join(scenarioDir, 'final.json')
  if (!existsSync(file)) return null
  const final = JSON.parse(readFileSync(file, 'utf8'))
  if (!final || typeof final.main !== 'object' || typeof final.history !== 'object') throw new Error(`${file}: has no main and history`)
  return final
}

/**
 * The final checks of a run of `scenario`, on its project.
 * @param {{ scenario?: object | string, scenarioDir: string, project: string, client: object, backend?: object }} run
 *   client: an open @layerfs/agent client on `project` (the engine opens and closes it);
 *   backend: its LayerFSBackend, made from client when not given (tests pass a stand-in)
 * @returns {Promise<{ name: string, ok: boolean, detail: string }[]>}
 */
export async function finalChecks({ scenarioDir, project, client, backend, scope = null }) {
  let final
  try {
    final = readFinal(scenarioDir)
  } catch (error) {
    return [{ name: 'final', ok: false, detail: error.message }]
  }
  if (!final) return []
  const checks = []
  const attempt = async (name, run) => {
    try {
      checks.push(await run())
    } catch (error) {
      checks.push({ name, ok: false, detail: `${error.code ? `${error.code}: ` : ''}${error.message}` })
    }
  }
  await attempt('final.order', async () => {
    const order = await orderFailures(final, client, backend ?? LayerFSBackend.of(client), scope)
    return result(
      'final.order',
      order.failures,
      scope
        ? `/${scope.run}: every Branch's Commits, forks, merges and publishes as recorded (${order.branches} Branches, ${order.layers - 1} publishes to its trunk)`
        : `${project}: every Branch's Commits, forks, merges and publishes as recorded (${order.branches} Branches, ${order.layers} Layers)`,
    )
  })
  await attempt('final.tree', async () => {
    const tree = await finalTreeFailures(final, client, scope)
    return result(
      'final.tree',
      tree.failures,
      `${tree.files} tracked files ${scope ? `in /${scope.run} on ${scope.trunk().branch}` : 'on main'} as recorded (${tree.varies.stamped} by stamped name, ${tree.varies.content} by presence)`,
    )
  })
  await attempt('final.closed', async () => {
    const open = await openSandboxes(client, scope)
    return result(
      'final.closed',
      open.map((s) => `${s} still runs`),
      'every Sandbox of the run is closed',
    )
  })
  return checks
}
