// Connect's state folder and the one LayerFS 2.0 home in it
// (docs/layerfs-2.0-integration.md §6).
//   <state>            LAYERFS_CONNECT_STATE, else ~/.layerfs-connect
//   <state>/home-2     the LayerFS 2.0 home (private: 0700): client({ home })
//                      and agents' LAYERFS_HOME. A fresh home (owner, C1):
//                      <state>/home, a 1.1.0 home, is left as it is, and a
//                      non-empty folder without a 2.0 layerfs.json is refused
//                      rather than handed to LayerFS, whose first call would
//                      convert it in place
//   <state>/runs       one folder per demo run
//   <state>/host.json  the running host's url and token (main.js)
// LayerFS reads LAYERFS_HOME and the trace settings only; every machine,
// Store and image is a record in the home. Two dev settings name LayerFS
// builds Connect does not make (§5), from the environment only:
//   LAYERFS_CONNECT_CLI     the native `layerfs` binary agents' shells run;
//                           default: the linked package's checkout's
//                           target/debug/layerfs
//   LAYERFS_CONNECT_DAEMON  the macOS native daemon, recorded once on the
//                           home's `native` machine; default: beside the CLI
import { chmodSync, existsSync, mkdirSync, readdirSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

/** apps/connect */
export const APP = fileURLToPath(new URL('..', import.meta.url))

/** The 2.0 home's folder in Connect's state (the 1.1.0 home was `home`). */
export const HOME_DIR = 'home-2'

/** The trace settings LayerFS reads besides LAYERFS_HOME (O26). */
export const TRACE_ENV = ['LAYERFS_TRACE', 'LAYERFS_TRACE_STEP', 'LAYERFS_TRACE_START']

/**
 * @typedef {object} Spec
 * @property {string} state Connect's state folder
 * @property {string} home the LayerFS home
 * @property {string} runs one folder per demo run
 * @property {string | null} cli the native `layerfs` binary, when found
 * @property {string | null} daemon the macOS native daemon to record, when found
 */

/** The linked `layerfs` package's folder (api/node), by its real path. */
export function packageDir() {
  try {
    return dirname(dirname(realpathSync(createRequire(import.meta.url).resolve('layerfs'))))
  } catch {
    return null
  }
}

/** The package's checkout: api/node, two folders up. */
const checkout = () => {
  const dir = packageDir()
  return dir && dirname(dirname(dir))
}

const file = (path) => (path && existsSync(path) ? path : null)

/** Resolves Connect's settings once; makes the state folder and a private home. */
export function resolveSpec(state = process.env.LAYERFS_CONNECT_STATE || join(homedir(), '.layerfs-connect')) {
  mkdirSync(state, { recursive: true, mode: 0o700 })
  const home = join(state, HOME_DIR)
  if (existsSync(home) && readdirSync(home).length && !existsSync(join(home, 'layerfs.json'))) {
    throw new Error(`${home} holds files but no LayerFS 2.0 layerfs.json: Connect does not hand an older home to LayerFS 2.0, whose first call would convert it`)
  }
  // LayerFS refuses a home other users can read
  mkdirSync(home, { recursive: true, mode: 0o700 })
  chmodSync(home, 0o700)
  const runs = join(state, 'runs')
  mkdirSync(runs, { recursive: true })
  const root = checkout()
  const cli = process.env.LAYERFS_CONNECT_CLI || file(root && join(root, 'target', 'debug', 'layerfs'))
  const daemon = process.env.LAYERFS_CONNECT_DAEMON || file(cli && join(dirname(cli), 'layerfs-daemon'))
  return { state, home, runs, cli: cli || null, daemon: daemon || null }
}

/** The environment an agent's shell or a run's script gets for LayerFS: the home and the trace settings, nothing else. */
export function layerfsEnv(spec) {
  const env = { LAYERFS_HOME: spec.home }
  for (const name of TRACE_ENV) if (process.env[name]) env[name] = process.env[name]
  return env
}

/** A project key `<store>/<project>` as its parts; a bare name is refused, as 2.0 refuses it. LayerFS checks the names themselves. */
export function projectRef(key) {
  const text = String(key ?? '')
  const at = text.indexOf('/')
  const store = text.slice(0, at)
  const name = text.slice(at + 1)
  if (at <= 0 || !name || name.includes('/') || text.includes('\0')) {
    throw Object.assign(new Error(`${JSON.stringify(text)} is not a project key: write it as <store>/<project>`), { status: 400, code: 'InvalidInput' })
  }
  return { store, name, key: `${store}/${name}` }
}

/** The key of a project record (project.list/get: `project`, else `store/name`). */
export const keyOf = (p) => p.project ?? `${p.store}/${p.name}`
