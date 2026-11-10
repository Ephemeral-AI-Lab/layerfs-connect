// Cross-process admission for activity writes and queued/running CLI calls.
// The exclusive gate protects a clear boundary; leases include queued work.
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const busy = () => Object.assign(new Error('CLI activity is busy. Wait for active commands or another reset to finish, then try again.'), { code: 'ConnectBusy', status: 409 })
const alive = pid => { try { process.kill(pid, 0); return true } catch (e) { return e.code !== 'ESRCH' } }
function owner(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')) } catch (e) { if (e.code === 'ENOENT') return null; throw busy() }
}
function lockOf(state) {
  const dir = join(state, 'logs', 'cli-control')
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  return { dir, lock: join(dir, 'clear.lock') }
}
function check(lock) {
  const held = owner(lock)
  if (!held) return
  if (!Number.isInteger(held.pid) || held.pid <= 0) throw busy()
  if (alive(held.pid)) throw busy()
  // Remove only the exact stale receipt read above.
  if (owner(lock)?.id === held.id) { try { unlinkSync(lock) } catch (e) { if (e.code !== 'ENOENT') throw e } }
}
export function activityLease(state) {
  const { dir, lock } = lockOf(state)
  check(lock)
  const file = join(dir, `lease-${process.pid}-${randomUUID()}.json`)
  const fd = openSync(file, 'wx', 0o600)
  writeFileSync(fd, JSON.stringify({ pid: process.pid })); closeSync(fd)
  let released = false
  const release = () => { if (!released) { released = true; try { unlinkSync(file) } catch (e) { if (e.code !== 'ENOENT') throw e } } }
  try { check(lock) } catch (e) { release(); throw e }
  return release
}
export function exclusiveActivity(state) {
  const { dir, lock } = lockOf(state)
  check(lock)
  const id = randomUUID()
  let fd
  try { fd = openSync(lock, 'wx', 0o600) } catch (e) { if (e.code === 'EEXIST') throw busy(); throw e }
  writeFileSync(fd, JSON.stringify({ pid: process.pid, id })); closeSync(fd)
  const release = () => { if (owner(lock)?.id === id) unlinkSync(lock) }
  try {
    for (const name of readdirSync(dir).filter(name => /^lease-\d+-[\w-]+\.json$/.test(name))) {
      const file = join(dir, name), held = owner(file)
      if (!held) continue
      if (!Number.isInteger(held.pid) || held.pid <= 0 || alive(held.pid)) throw busy()
      try { unlinkSync(file) } catch (e) { if (e.code !== 'ENOENT') throw e }
    }
    return release
  } catch (e) { release(); throw e }
}
export function activityGeneration(state) {
  const path = join(state, 'logs', 'cli-control', 'generation.json')
  if (!existsSync(path)) return 'initial'
  const generation = JSON.parse(readFileSync(path, 'utf8')).generation
  if (typeof generation !== 'string' || !generation) throw new Error('Invalid CLI activity generation. Inspect the activity control directory.')
  return generation
}
