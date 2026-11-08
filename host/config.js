// Connect's state folder and the one LayerFS 2.0 home in it
// (docs/layerfs-2.0-integration.md §6).
//   <mode>             LAYERFS_CONNECT_MODE: `real` (the default) runs the
//                      linked LayerFS; `sim` runs the simulator (sim/), which
//                      needs no native library, machine or Docker
//   <state>            LAYERFS_CONNECT_STATE, else ~/.layerfs-connect, or
//                      ~/.layerfs-connect-sim in sim mode: the two modes never
//                      share a folder, so a simulated call never reaches a
//                      real Store
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
import { chmodSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** apps/connect */
export const APP = fileURLToPath(new URL('..', import.meta.url))

/** The 2.0 home's folder in Connect's state (the 1.1.0 home was `home`). */
export const HOME_DIR = 'home-2'

/** The trace settings LayerFS reads besides LAYERFS_HOME (O26). */
export const TRACE_ENV = ['LAYERFS_TRACE', 'LAYERFS_TRACE_STEP', 'LAYERFS_TRACE_START']

/** The two LayerFS modes: the linked library, or the simulator. */
export const MODES = ['real', 'sim']

/** LAYERFS_CONNECT_MODE as a mode: unset is `real`; another word is refused rather than guessed. */
export function modeOf(value = process.env.LAYERFS_CONNECT_MODE) {
  if (value === undefined || value === '') return 'real'
  if (!MODES.includes(value)) throw new Error(`LAYERFS_CONNECT_MODE must be ${MODES.join(' or ')}, not ${JSON.stringify(value)}`)
  return value
}

/** A mode's default state folder. */
export const defaultState = (mode) => join(homedir(), mode === 'sim' ? '.layerfs-connect-sim' : '.layerfs-connect')

/**
 * @typedef {object} Spec
 * @property {'real' | 'sim'} mode which LayerFS the host runs on
 * @property {string} state Connect's state folder
 * @property {string} home the LayerFS home
 * @property {string} runs one folder per demo run
 * @property {string | null} cli the native `layerfs` binary, when found
 * @property {string | null} daemon the macOS native daemon to record, when found
 */

const file = (path) => (path && existsSync(path) ? path : null)

/** Resolves Connect's settings once; makes the state folder and a private home. */
export function resolveSpec(state = process.env.LAYERFS_CONNECT_STATE || defaultState(modeOf()), mode = modeOf()) {
  mkdirSync(state, { recursive: true, mode: 0o700 })
  const home = join(state, HOME_DIR)
  // the simulator keeps its world in its own home (sim/world.js), never a LayerFS one
  if (mode === 'real' && existsSync(home) && readdirSync(home).length && !existsSync(join(home, 'layerfs.json'))) {
    throw new Error(`${home} holds files but no LayerFS 2.0 layerfs.json: Connect does not hand an older home to LayerFS 2.0, whose first call would convert it`)
  }
  if (mode === 'sim' && existsSync(join(home, 'layerfs.json'))) {
    throw new Error(`${home} is a real LayerFS home: the simulator runs in a state folder of its own (unset LAYERFS_CONNECT_STATE, or name another folder)`)
  }
  // LayerFS refuses a home other users can read
  mkdirSync(home, { recursive: true, mode: 0o700 })
  chmodSync(home, 0o700)
  const runs = join(state, 'runs')
  mkdirSync(runs, { recursive: true })
  // the native binaries are the real library's: the simulator has none
  if (mode === 'sim') return { mode, state, home, runs, cli: null, daemon: null }
  const cli = process.env.LAYERFS_CONNECT_CLI || file(join(APP, 'runtime', 'bin', 'layerfs'))
  const daemon = process.env.LAYERFS_CONNECT_DAEMON || file(cli && join(dirname(cli), 'layerfs-daemon'))
  return { mode, state, home, runs, cli: cli || null, daemon: daemon || null }
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
