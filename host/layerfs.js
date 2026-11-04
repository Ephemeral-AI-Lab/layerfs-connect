// The one LayerFS 2.0 client of Connect's home (docs/layerfs-2.0-integration.md
// §4): `client({ home })`, made once per process. There is no open and no
// per-project client; every call names its project (`<store>/<project>`).
// Every call is one attempt; a refusal throws LayerFSError { code, message,
// detail } and passes through with its code. `closeStores()` at exit closes
// the Stores the process holds open, so it leaves no stale lease.
import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { client, close, doctor } from 'layerfs'
import { packageDir } from './config.js'

/**
 * `layerfs doctor` on the home (#536 H7): report-only, starts no machine and
 * changes nothing. `{ ok, findings: [{ severity, entity, message, fix }] }`.
 */
export const doctorOf = (spec) => doctor({ home: spec.home })

/**
 * Closes every Store this process holds open with no call running, dropping
 * its leases (`layerfs.close()`); answers how many. The host's last step at
 * exit: a lease of a process that ended shows as stale until the Store's next call.
 */
export const closeStores = () => close()

/** The largest page a list call takes. */
export const PAGE = 1000

/** The client of `spec.home`, made on first use. */
export function layerfs(spec) {
  spec.lfs ??= client({ home: spec.home })
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

/** A Sandbox's Workspaces: every page of sandbox.get (its pages hold `workspaces`, not `items`). */
export async function workspacesOf(lfs, sandbox) {
  const all = []
  for (let pos = 0; pos !== null; ) {
    const page = await lfs.sandbox.get(sandbox, { page_size: PAGE, page_pos: pos })
    all.push(...(page.workspaces ?? []))
    pos = page.next_page_pos ?? null
  }
  return all
}

/** The linked `layerfs` package's version, or null. */
export function linkedVersion() {
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
