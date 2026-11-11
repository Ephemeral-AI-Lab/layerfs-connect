import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export const fixtureBusy = message => Object.assign(new Error(message), { status: 409, code: 'ConnectBusy' })
export function liveReceipt(file) {
  let receipt
  try { receipt = JSON.parse(readFileSync(file, 'utf8')) } catch (e) { if (e.code === 'ENOENT') return null; throw fixtureBusy('The demo ownership receipt is unreadable. Inspect its state directory.') }
  if (!Number.isInteger(receipt.pid) || receipt.pid <= 0) throw fixtureBusy('The demo ownership receipt has an invalid process ID. Inspect its state directory.')
  try { process.kill(receipt.pid, 0) } catch (e) { if (e.code === 'ESRCH') return null; throw e }
  return receipt
}
/** Terminal resets must honor host jobs even between their CLI processes. */
export async function assertHostIdle(state) {
  const endpoint = liveReceipt(join(state, 'host.json'))
  if (!endpoint) return
  const url = new URL(endpoint.url)
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password || !endpoint.token) throw fixtureBusy('Invalid local demo host receipt.')
  let res
  try { res = await fetch(new URL('/api/demo-runtime', url), { headers: { authorization: `Bearer ${endpoint.token}` }, signal: AbortSignal.timeout(5000) }) }
  catch { throw fixtureBusy('The demo host could not confirm it is idle. Inspect its active work before resetting.') }
  if (!res.ok) throw fixtureBusy('The running demo host cannot confirm reset admission. Restart it with the updated host before resetting.')
  const result = await res.json()
  if (!Array.isArray(result.busy)) throw fixtureBusy('The demo host returned no reliable active-work status.')
  if (result.busy.length) throw fixtureBusy(`Wait for active work to finish: ${result.busy.join(', ')}.`)
}
/** Fixtures block conflicting mutations; read-only pages keep showing real state. */
export function guardFixtureRequest(state, method, pathname, actionId) {
  if (['/api/demo-runtime', '/api/events'].includes(pathname) || pathname.startsWith('/api/cli-activity') || pathname.startsWith('/api/demo-presets')) return
  const lock = liveReceipt(join(state, 'demo-fixtures.lock'))
  if (!lock || lock.pid === process.pid || lock.actionId && lock.actionId === actionId) return
  if (method === 'GET') return
  throw fixtureBusy('A CLI preset operation is in progress. Wait for it to finish before using this environment.')
}
