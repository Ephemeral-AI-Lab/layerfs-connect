// The one LayerFS 2.0 client of Connect's home (docs/layerfs-2.0-integration.md
// §4): `client({ home })`, made once per process. There is no open and no
// per-project client; every call names its project (`<store>/<project>`).
// Every call is one attempt; a refusal throws LayerFSError { code, message,
// detail } and passes through with its code. `closeStores()` at exit closes
// the Stores the process holds open, so it leaves no stale lease.
//
// Which LayerFS answers is the process's mode (config.js modeOf,
// LAYERFS_CONNECT_MODE), read once as this module loads: `real` loads the
// linked `layerfs` package, `sim` the simulator (sim/index.js), which has the
// same calls, answers and refusals. Nothing above this module knows which
// one runs; a host never switches mode while it runs (the app restarts it).
import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { modeOf, packageDir } from './config.js'

/** The mode's package: `{ mode, client, close, doctor, table, LayerFSError, version }`. */
export async function loadBackend(mode = modeOf()) {
  const lib = mode === 'sim' ? await import('./sim/index.js') : await import('layerfs')
  return { mode, client: lib.client, close: lib.close, doctor: lib.doctor, table: lib.table, LayerFSError: lib.LayerFSError, version: mode === 'sim' ? lib.VERSION : packageVersion() }
}

/** This process's LayerFS. */
export const backend = await loadBackend()

/**
 * `layerfs doctor` on the home (#536 H7): report-only, starts no machine and
 * changes nothing. `{ ok, findings: [{ severity, entity, message, fix }] }`.
 */
export const doctorOf = (spec) => backend.doctor({ home: spec.home })

/**
 * Closes every Store this process holds open with no call running, dropping
 * its leases (`layerfs.close()`); answers how many. The host's last step at
 * exit: a lease of a process that ended shows as stale until the Store's next call.
 */
export const closeStores = () => backend.close()

/** The largest page a list call takes. */
export const PAGE = 1000

/** The client of `spec.home`, made on first use. */
export function layerfs(spec) {
  spec.lfs ??= backend.client({ home: spec.home })
  return spec.lfs
}

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
export function workspacesOf(lfs, sandbox, { wait = null } = {}) {
  if (!reads.has(lfs)) reads.set(lfs, { flying: new Map(), busy: new Map() })
  const { flying, busy } = reads.get(lfs)
  const refused = busy.get(sandbox)
  if (refused && Date.now() - refused.at < BUSY_MS) return Promise.reject(refused.error)
  let read = flying.get(sandbox)
  if (!read) {
    read = (async () => {
      const all = []
      for (let pos = 0; pos !== null; ) {
        const page = await lfs.sandbox.get(sandbox, { page_size: PAGE, page_pos: pos })
        all.push(...(page.workspaces ?? []))
        pos = page.next_page_pos ?? null
      }
      return all
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

/** How long a page's view waits for one Sandbox's Workspaces before showing it unread. */
export const VIEW_WAIT_MS = 5000

/** The running LayerFS's version: the linked package's, or the simulator's. */
export const linkedVersion = () => backend.version

/** The linked `layerfs` package's version, or null. */
function packageVersion() {
  try {
    return JSON.parse(readFileSync(join(packageDir(), 'package.json'), 'utf8')).version ?? null
  } catch {
    return null
  }
}

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
function importDaemon(spec) {
  if (process.platform !== 'darwin') return Promise.resolve({ recorded: false, why: 'not macOS' })
  if (!spec.cli || !spec.daemon) return Promise.resolve({ recorded: false, why: `no ${spec.cli ? 'daemon' : 'layerfs CLI'} found (LAYERFS_CONNECT_${spec.cli ? 'DAEMON' : 'CLI'})` })
  return new Promise((resolve) => {
    const env = { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', LAYERFS_HOME: spec.home, LAYERFS_DAEMON: spec.daemon }
    execFile(spec.cli, ['import-env'], { env, timeout: 30_000 }, (error, stdout, stderr) => {
      if (error) return resolve({ recorded: false, why: String(stderr || error.message).trim().split('\n')[0] })
      try {
        const report = JSON.parse(stdout)
        resolve({ recorded: (report.written ?? []).some((w) => w.setting === 'LAYERFS_DAEMON'), kept: (report.kept ?? []).some((w) => w.setting === 'LAYERFS_DAEMON') })
      } catch {
        resolve({ recorded: false, why: 'import-env answered no report' })
      }
    })
  })
}
