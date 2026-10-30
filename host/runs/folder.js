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
import { keyOf, openRuntime, withProjectEnv } from '../config.js'
import { lwwFor, Scope } from './scope.js'

/** Base64 per printf argument: well under Linux's 128 KiB for one argument. */
const CHUNK = 96 * 1024

const refuse = (code, message) => Object.assign(new Error(message), { code })

/** The project's record (volume, image), or a refusal when there is none. */
export async function projectRecord(spec, key) {
  const runtime = await openRuntime(spec)
  // `key` is the project key: `store/name` in a shared Store (layerfs#506)
  const found = (await runtime.project.list()).find((p) => keyOf(p) === key)
  if (!found) throw refuse('NotFound', `no LayerFS project named ${key}`)
  return found
}

/** A client of `project` (the host's own: no scope). */
export async function openProject(spec, project) {
  await openRuntime(spec)
  const { LayerFS } = await import('@layerfs/agent')
  // a project of a shared Store also carries its Store (layerfs#506)
  return withProjectEnv(spec, { name: project.name, store: project.store ?? null, shared: !!project.shared, volume: project.volume, image: project.image }, () => LayerFS.open(project.name))
}

async function branches(lf) {
  const names = []
  for (let pos = 0; ; ) {
    const page = await lf.project.list_branches(1000, pos)
    names.push(...page.items.map((b) => b.name))
    if (!page.hasMore) return names
    pos += page.items.length
  }
}

/** The fixture folder as a gzipped tar, base64: owners left out, macOS metadata too. */
function packed(folder) {
  const env = { ...process.env, COPYFILE_DISABLE: '1' }
  const args = process.platform === 'darwin' ? ['--no-mac-metadata', '--no-xattrs'] : []
  return execFileSync('tar', ['-czf', '-', ...args, '--uid', '0', '--gid', '0', '-C', folder, '.'], { env, maxBuffer: 1 << 30 }).toString('base64')
}

/**
 * Makes a run's folder on its trunk.
 * @param {object} o
 * @param {string} o.scenarioId  the scenario's id (the run's name starts with it, - as _)
 * @param {string} o.fixture     the folder to copy in (a seed already written out)
 * @param {object} o.project     the project's record (name, volume, image)
 * @param {string} o.scopeDir    where the run's scope state goes
 * @param {(phase: string) => void} [o.phase]
 * @returns {Promise<{ run: string, scope: Scope }>}
 */
export async function setupFolder(spec, { scenarioId, fixture, project, scopeDir, phase = () => {} }) {
  const lf = await openProject(spec, project)
  try {
    const stem = scenarioId.replaceAll('-', '_')
    const taken = (await branches(lf)).map((b) => new RegExp(`^${stem}_(\\d+)\\.main$`).exec(b)?.[1]).filter(Boolean).map(Number)
    let n = Math.max(0, ...taken) + 1
    let run
    // another run of this scenario may take the same number first: try the next
    for (;; n++) {
      run = `${stem}_${n}`
      try {
        await lf.branch.fork(`${run}.main`, 'main')
        break
      } catch (error) {
        if (error.code !== 'NameTaken') throw error
      }
    }
    phase(`Setting up /${run}`)
    const tar = packed(fixture)
    const lww = existsSync(join(fixture, '.lww')) ? Buffer.from(lwwFor(run, readFileSync(join(fixture, '.lww'), 'utf8'))).toString('base64') : null
    const lines = ['set -e', `mkdir -p ${run}`, ': > /tmp/lfc-fixture.b64']
    for (let i = 0; i < tar.length; i += CHUNK) lines.push(`printf '%s' '${tar.slice(i, i + CHUNK)}' >> /tmp/lfc-fixture.b64`)
    lines.push(`base64 -d /tmp/lfc-fixture.b64 | tar -xzf - -C ${run} --no-same-owner`, 'rm -f /tmp/lfc-fixture.b64')
    if (lww) lines.push(`printf '%s' '${lww}' | base64 -d > .lww`)
    const { sandbox } = await lf.sandbox.create()
    let ws = null
    try {
      ws = await lf.workspace.mount(sandbox, `${run}.main`)
      // one exec per argument-sized chunk would also do; fixtures are a few KiB
      const out = await lf.workspace.exec(ws, lines.join('\n'), `setup: the fixture into /${run}`)
      if (out.exitCode !== 0) throw refuse('Failed', `copying the fixture into /${run} exited ${out.exitCode}: ${String(out.stderr ?? '').slice(0, 400)}`)
      await lf.workspace.commit(ws, `setup: ${scenarioId} in /${run}`)
      await lf.workspace.unmount(ws)
      ws = null
    } finally {
      if (ws) await lf.workspace.unmount(ws, true).catch(() => {})
      await lf.sandbox.close(sandbox).catch(() => {})
    }
    return { run, scope: Scope.create(scopeDir, { run, project: project.name, trunk: `${run}.main` }) }
  } finally {
    await lf.close()
  }
}

/** One landing at a time per project: the next waits for the one before. */
const lanes = new Map()

/**
 * Lands a run's last trunk on main (see the top of this file).
 * @returns {Promise<{ ok: boolean, detail: string }>}
 */
export function landOnMain(spec, { project, scope }) {
  const lane = keyOf(project)
  const before = lanes.get(lane) ?? Promise.resolve()
  const landing = before.then(() => land(spec, project, scope))
  lanes.set(lane, landing.catch(() => {}))
  return landing
}

async function land(spec, project, scope) {
  const { run } = scope
  const trunk = scope.trunk().branch
  const lf = await openProject(spec, project)
  try {
    const lww = async (ref) => {
      try {
        return (await lf.fs.read(ref, '/.lww')).text
      } catch (error) {
        if (error.code === 'NoSuchPath' || error.code === 'NotFound') return null
        throw error
      }
    }
    await lf.branch.fork(`${run}.land`, trunk)
    const [mine, main] = [await lww(`${run}.land`), await lww('main')]
    if (mine !== main) {
      if (main === null) await lf.fs.rm(`${run}.land`, '/.lww', `land ${run}: main keeps its /.lww`)
      else await lf.fs.write(`${run}.land`, '/.lww', main, `land ${run}: main keeps its /.lww`)
    }
    let merged
    try {
      merged = await lf.branch.merge('main', `${run}.land`, `${run}.landed`, `land /${run} from ${trunk}`)
    } catch (error) {
      return { ok: false, detail: `${trunk} did not merge with main: ${error.code ?? ''} ${error.message}` }
    }
    const published = await lf.branch.publish(`${run}.landed`)
    return { ok: true, detail: `/${run} from ${trunk} is on main (${merged.fastForward ? 'fast-forward' : 'merged'}; ${published.kind})` }
  } finally {
    await lf.close()
  }
}
