// The one LayerFS 2.0 client of Connect's home (docs/layerfs-2.0-integration.md
// §4): `client({ home })`, made once per process. There is no open or close
// and no per-project client; every call names its project (`<store>/<project>`).
// Every call is one attempt; a refusal throws LayerFSError { code, message,
// detail } and passes through with its code.
import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { client, doctor } from 'layerfs'
import { packageDir } from './config.js'

/**
 * `layerfs doctor` on the home (#536 H7): report-only, starts no machine and
 * changes nothing. `{ ok, findings: [{ severity, entity, message, fix }] }`.
 */
export const doctorOf = (spec) => doctor({ home: spec.home })

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
 * machine: `machine.update` takes no daemon, so this runs the CLI's
 * `import-env` with only LAYERFS_HOME and LAYERFS_DAEMON set (§5). It keeps a
 * value already recorded. Answers what it did; never throws.
 */
export function recordNativeDaemon(spec) {
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
