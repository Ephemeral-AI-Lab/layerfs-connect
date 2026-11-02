// A scenario run's place in the project it plays on (scope.js says how its
// scripts are kept there):
//   setupFolder   picks the run's name <scenario>_<n> (the lowest n whose
//                 trunk Branch is free), forks the trunk <run>.main from main
//                 and Commits the scenario's fixture into /<run>/ on it, in a
//                 Workspace, so modes and symlinks are kept. A fixture's
//                 /.lww goes to the root too, its rules moved under the folder,
//                 since LayerFS reads only the root's.
//   landOnMain    once a run passed: its last trunk joins main, one run at a
//                 time per project. A Branch <run>.land from the trunk, with
//                 main's /.lww put back (a run's rules stay on its Branches),
//                 merged with main into <run>.landed, which is published.
//                 Runs touch only their own folders, so the merge is clean
//                 unless something else changed one; then nothing is published.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { keyOf, projectRef } from '../config.js'
import { layerfs, pages } from '../layerfs.js'
import { lwwFor, Scope } from './scope.js'

/** Base64 per printf argument: well under Linux's 128 KiB for one argument. */
const CHUNK = 96 * 1024

const refuse = (code, message) => Object.assign(new Error(message), { code })

/** The project's record (project.get): its Store, kind and machine. */
export function projectRecord(spec, key) {
  return layerfs(spec).project.get(projectRef(key).key)
}

/**
 * The machine a project's Sandboxes run on: a sqlite project's Store's
 * machine (another is Unsupported), or `machine` (native or docker) for a
 * PostgreSQL project.
 */
export const sandboxMachine = (record, machine = null) => (record.kind === 'postgresql' ? (machine ?? 'native') : record.machine)

/** A project handle { lfs, project, machine }: the host's client (no scope), the key and its Sandboxes' machine. */
export async function projectHandle(spec, key, machine = null) {
  const record = await projectRecord(spec, key)
  return { lfs: layerfs(spec), project: keyOf(record), machine: sandboxMachine(record, machine), record }
}

/**
 * Puts a run on `machine`: Sandboxes follow the Store, so a sqlite project's
 * Store moves there (store.move, the whole Store, idle only). A PostgreSQL
 * project's Sandboxes run on native or docker; its Store never moves.
 */
export async function placeRun(spec, key, machine, phase = () => {}) {
  const record = await projectRecord(spec, key)
  if (record.kind === 'postgresql') {
    if (machine !== 'native' && machine !== 'docker') throw refuse('Unsupported', `${key} is in a PostgreSQL Store: its Sandboxes run on native or docker`)
    return record
  }
  if (record.machine === machine) return record
  phase(`Moving Store ${record.store} to ${machine}`)
  await layerfs(spec).store.move(record.store, machine)
  return projectRecord(spec, key)
}

/** A Sandbox name of the host's own, unique in the home (1–63 of a-z 0-9 _ . -). */
export const ownSandbox = (what) => `${what}.${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.slice(0, 63)

const branches = async (lf) => (await pages((p) => lf.lfs.branch.list(lf.project, p))).map((b) => b.name)

/** The fixture folder as a gzipped tar, base64: owners left out, macOS metadata too. */
function packed(folder) {
  const env = { ...process.env, COPYFILE_DISABLE: '1' }
  // bsdtar (macOS) names the owner with --uid/--gid, GNU tar (Linux) with --owner/--group
  const args = process.platform === 'darwin' ? ['--no-mac-metadata', '--no-xattrs', '--uid', '0', '--gid', '0'] : ['--owner=0', '--group=0', '--numeric-owner']
  return execFileSync('tar', ['-czf', '-', ...args, '-C', folder, '.'], { env, maxBuffer: 1 << 30 }).toString('base64')
}

/**
 * Makes a run's folder on its trunk.
 * @param {object} o
 * @param {string} o.scenarioId  the scenario's id (the run's name starts with it, - as _)
 * @param {string} o.fixture     the folder to copy in (a seed already written out)
 * @param {string} o.project     the project key
 * @param {string} o.scopeDir    where the run's scope state goes
 * @param {(phase: string) => void} [o.phase]
 * @param {string | null} [o.machine] a PostgreSQL project's Sandboxes' machine (native or docker); a sqlite project's run on its Store's
 * @returns {Promise<{ run: string, scope: Scope }>}
 */
export async function setupFolder(spec, { scenarioId, fixture, project, scopeDir, phase = () => {}, machine = null }) {
  const lf = await projectHandle(spec, project, machine)
  const stem = scenarioId.replaceAll('-', '_')
  const taken = (await branches(lf)).map((b) => new RegExp(`^${stem}_(\\d+)\\.main$`).exec(b)?.[1]).filter(Boolean).map(Number)
  let n = Math.max(0, ...taken) + 1
  let run
  // another run of this scenario may take the same number first: try the next
  for (;; n++) {
    run = `${stem}_${n}`
    try {
      await lf.lfs.branch.fork(lf.project, `${run}.main`, 'main')
      break
    } catch (error) {
      if (error.code !== 'Exists' && error.code !== 'NameTaken') throw error
    }
  }
  phase(`Setting up /${run}`)
  const tar = packed(fixture)
  const lww = existsSync(join(fixture, '.lww')) ? Buffer.from(lwwFor(run, readFileSync(join(fixture, '.lww'), 'utf8'))).toString('base64') : null
  // portable to a `mac` Sandbox, which runs on macOS: its own temporary file (/tmp is the Mac's,
  // shared by every Sandbox), base64 reading stdin (macOS takes no file argument), and a folder
  // left empty fails (a pipeline's exit is tar's alone)
  const lines = ['set -e', `mkdir -p ${run}`, 'b64=$(mktemp)']
  for (let i = 0; i < tar.length; i += CHUNK) lines.push(`printf '%s' '${tar.slice(i, i + CHUNK)}' >> "$b64"`)
  lines.push(`base64 -d < "$b64" | tar -xzf - -C ${run} --no-same-owner`, 'rm -f "$b64"', `[ -n "$(ls -A ${run})" ] || { echo "the fixture did not unpack into ${run}" >&2; exit 1; }`)
  if (lww) lines.push(`printf '%s' '${lww}' | base64 -d > .lww`)
  const sandbox = ownSandbox(`${run}.setup`)
  await lf.lfs.sandbox.create(lf.project, sandbox, lf.machine)
  let ws = null
  try {
    ws = (await lf.lfs.workspace.mount(sandbox, `${run}.main`)).ws
    // one exec per argument-sized chunk would also do; fixtures are a few KiB
    const out = await lf.lfs.workspace.exec(ws, lines.join('\n'), { message: `setup: the fixture into /${run}` })
    if (out.exit_code !== 0) throw refuse('Failed', `copying the fixture into /${run} exited ${out.exit_code}: ${String(out.stderr ?? '').slice(0, 400)}`)
    await lf.lfs.workspace.commit(ws, { message: `setup: ${scenarioId} in /${run}` })
    await lf.lfs.workspace.unmount(ws)
    ws = null
  } finally {
    if (ws) await lf.lfs.workspace.unmount(ws, { discard: true }).catch(() => {})
    await lf.lfs.sandbox.close(sandbox).catch(() => {})
  }
  return { run, scope: Scope.create(scopeDir, { run, project: lf.project, trunk: `${run}.main`, machine: lf.machine }) }
}

/** One landing at a time per project: the next waits for the one before. */
const lanes = new Map()

/**
 * Lands a run's last trunk on main (see the top of this file).
 * @returns {Promise<{ ok: boolean, detail: string }>}
 */
export function landOnMain(spec, { project, scope }) {
  const lane = projectRef(project).key
  const before = lanes.get(lane) ?? Promise.resolve()
  const landing = before.then(() => land(spec, lane, scope))
  lanes.set(lane, landing.catch(() => {}))
  return landing
}

async function land(spec, project, scope) {
  const { run } = scope
  const trunk = scope.trunk().branch
  const { lfs } = await projectHandle(spec, project)
  const lww = async (ref) => {
    try {
      return (await lfs.file.read(project, ref, '/.lww')).text
    } catch (error) {
      if (error.code === 'NoSuchPath' || error.code === 'NotFound') return null
      throw error
    }
  }
  await lfs.branch.fork(project, `${run}.land`, trunk)
  const [mine, main] = [await lww(`${run}.land`), await lww('main')]
  if (mine !== main) {
    const message = `land ${run}: main keeps its /.lww`
    if (main === null) await lfs.file.rm(project, `${run}.land`, '/.lww', { message })
    else await lfs.file.write(project, `${run}.land`, '/.lww', main, { message })
  }
  let merged
  try {
    merged = await lfs.branch.merge(project, `${run}.landed`, 'main', `${run}.land`, { message: `land /${run} from ${trunk}` })
  } catch (error) {
    return { ok: false, detail: `${trunk} did not merge with main: ${error.code ?? ''} ${error.message}` }
  }
  if (merged.kind !== 'Merged') return { ok: false, detail: `${trunk} did not merge with main: ${merged.kind}${merged.conflicts?.length ? ` (${merged.conflicts.length} conflicts)` : ''}` }
  const published = await lfs.branch.publish(project, `${run}.landed`)
  return { ok: true, detail: `/${run} from ${trunk} is on main (${merged.fast_forward ? 'fast-forward' : 'merged'}; ${published.kind})` }
}
