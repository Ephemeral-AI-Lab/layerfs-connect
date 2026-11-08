// Host calls use one CLI process per attempt, for real and simulated modes.
import { existsSync } from 'node:fs'
import { modeOf } from './config.js'
import { client } from './cli/calls.js'
import { execute } from './cli/spawn.js'
import { discover, lastIdentity } from './cli/capabilities.js'
export const backend = { mode: modeOf() }
export async function loadBackend(mode = modeOf()) {
  return { mode, client: (spec) => client({ ...spec, mode }), close: () => 0 }
}
export const doctorOf = async (spec) => { await discover(spec); return execute(spec, ['doctor'], { read: true }) }
export const closeStores = () => 0 // Each CLI closes its Store before returning.
export function layerfs(spec) { return spec.lfs ??= client(spec) }

/** The largest page a list call takes. */
export const PAGE = 1000

/**
 * Every item of a paged list: `read({ page_size, page_pos })` until
 * `next_page_pos` is null (sandbox.list, sandbox.get and project.list give no
 * `has_more`). `most` stops early.
 */
export async function pages(read, most = Infinity) {
  const all = []
  for (let pos = 0; pos !== null && all.length < most; ) {
    const page = await read({ page_size: PAGE, page_pos: pos })
    all.push(...(page.items ?? []))
    pos = page.next_page_pos ?? null
  }
  return all
}

/** How long a Sandbox's `Busy` refusal (its daemon admits no connection: LayerFS waited 60 s for one) answers its reads before it is asked again. */
export const BUSY_MS = 30_000
/** Per client: each Sandbox's read in flight, and its last `Busy` refusal. */
const reads = new WeakMap()

/**
 * A Sandbox's Workspaces: every page of sandbox.get (its pages hold
 * `workspaces`, not `items`). One read per Sandbox at a time: callers share
 * the one in flight, so polls never stack 60 s admission waits on the host's
 * threads. A `Busy` refusal answers again for BUSY_MS without a call. With
 * `wait` (ms) the caller gives up first, refused `Timeout`; the read goes on
 * and the next caller shares it.
 */
export function sandboxObservation(lfs, sandbox, { wait = null } = {}) {
  if (!reads.has(lfs)) reads.set(lfs, { flying: new Map(), busy: new Map() })
  const { flying, busy } = reads.get(lfs)
  const refused = busy.get(sandbox)
  if (refused && Date.now() - refused.at < BUSY_MS) return Promise.reject(refused.error)
  let read = flying.get(sandbox)
  if (!read) {
    read = (async () => {
      const all = []
      let observation
      for (let pos = 0; pos !== null; ) {
        const page = await lfs.sandbox.get(sandbox, { page_size: PAGE, page_pos: pos })
        observation ??= page
        all.push(...(page.workspaces ?? []))
        pos = page.next_page_pos ?? null
      }
      return { ...observation, workspaces: all }
    })().then(
      (all) => (busy.delete(sandbox), all),
      (error) => {
        if (error?.code === 'Busy') busy.set(sandbox, { at: Date.now(), error })
        throw error
      },
    ).finally(() => flying.delete(sandbox))
    read.started = Date.now()
    flying.set(sandbox, read)
  }
  if (!wait) return read
  // a read already past the wait is not waited for again
  const left = wait - (Date.now() - read.started)
  let timer
  const late = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error(`Sandbox ${sandbox} did not answer in ${wait / 1000} s`), { code: 'Timeout' })), Math.max(0, left))
  })
  return Promise.race([read, late]).finally(() => clearTimeout(timer))
}

export const workspacesOf = (lfs, sandbox, options) => sandboxObservation(lfs, sandbox, options).then((observation) => { if (observation.down_reason) throw Object.assign(new Error(observation.down_reason), { code: 'Unavailable' }); return observation.workspaces })

/** How long a page's view waits for one Sandbox's Workspaces before showing it unread. */
export const VIEW_WAIT_MS = 5000

/** The most recently discovered binary identity, shown without a capability claim. */
export const linkedVersion = () => lastIdentity?.version ?? (backend.mode === 'sim' ? '2.0.0 (simulated)' : null)

/**
 * On macOS, records the native daemon (spec.daemon) on the home's `native`
 * machine: the CLI's `import-env` with only LAYERFS_HOME and LAYERFS_DAEMON
 * set (§5) writes it when none is recorded. It keeps a
 * value already recorded, unless that daemon is not there any more (its
 * checkout moved or was removed): then `machine.update` records spec.daemon
 * in its place (`replaced` names the old one). Answers what it did; never throws.
 */
export async function recordNativeDaemon(spec) {
  if (backend.mode === 'sim') return { recorded: false, why: 'simulated LayerFS' }
  const done = await importDaemon(spec)
  if (!done.kept) return done
  try {
    const lfs = layerfs(spec)
    const recorded = (await lfs.machine.get('native')).daemon
    if (!recorded || existsSync(recorded)) return done
    await lfs.machine.update('native', { daemon: spec.daemon })
    return { recorded: true, kept: false, replaced: recorded }
  } catch (error) {
    return { recorded: false, why: `the recorded native daemon is not there and was not replaced: ${error?.message ?? error}` }
  }
}

/** `import-env` of spec.daemon: what it wrote or kept, or why it did neither. */
async function importDaemon(spec) {
  if (process.platform !== 'darwin') return { recorded: false, why: 'not macOS' }
  if (!spec.cli || !spec.daemon) return { recorded: false, why: 'no configured CLI or daemon' }
  try {
    await discover(spec)
    const report = await execute(spec, ['import-env'], { env: { LAYERFS_DAEMON: spec.daemon }, timeout: 30000 })
    return { recorded: (report.written ?? []).some((w) => w.setting === 'LAYERFS_DAEMON'), kept: (report.kept ?? []).some((w) => w.setting === 'LAYERFS_DAEMON') }
  } catch { return { recorded: false, why: 'daemon recording failed; inspect the configured binary and home' } }
}
