// Connect's deployment: where its state lives, the LayerFS home it runs on,
// and the settings @layerfs/runtime and agents' bash calls need. Connect
// keeps its own home and container prefix (default lfc-), so its worker
// (<prefix>worker), Sandboxes and Store volumes never meet another
// integration's on the same Docker engine.
//   <state>/settings.json  { image, bundle, daemon, docker, containerPrefix }
//   <state>/home           the LayerFS home (private: 0700)
//   <state>/runs           one folder per demo run
// Each setting comes from settings.json, else LAYERFS_CONNECT_<NAME>, else
// its default. LayerFS itself reads LAYERFS_* names only.
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LayerFSRuntime } from '@layerfs/runtime'

/** Docker's volumes directory, in Docker's VM on macOS and Windows. */
export const VOLUMES = '/var/lib/docker/volumes'

/** apps/connect */
export const APP = fileURLToPath(new URL('..', import.meta.url))
/** The LayerFS api/ folder Connect links @layerfs/* to (package.json), or LAYERFS_CONNECT_API: the layerfs command. */
export const API = process.env.LAYERFS_CONNECT_API || dirname(realpathSync(join(APP, 'node_modules', '@layerfs', 'cli')))

/**
 * @typedef {object} Spec
 * @property {string} state Connect's state folder
 * @property {string} home the LayerFS home
 * @property {string} runs one folder per demo run
 * @property {string | null} image runtime image digest Sandboxes run
 * @property {string | null} bundle sealed Linux LayerFS build (macOS and Windows: the worker runs it)
 * @property {string | null} daemon Linux layerfs-daemon Sandboxes run (default: the bundle's)
 * @property {string} docker Docker Engine socket
 * @property {string} prefix container and volume name prefix
 * @property {boolean} worker Store calls go through the home's worker (macOS, Windows)
 * @property {Promise<LayerFSRuntime>} [runtime] opened once by openRuntime
 */

const SETTINGS = ['image', 'bundle', 'daemon', 'docker', 'containerPrefix']
const envName = (key) => `LAYERFS_CONNECT_${key.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase()}`

/** Resolves Connect's settings once; makes the state folder and a private home. */
export function resolveSpec(state = process.env.LAYERFS_CONNECT_STATE || join(homedir(), '.layerfs-connect')) {
  mkdirSync(state, { recursive: true, mode: 0o700 })
  const saved = readSettings(state)
  const pick = (key) => saved[key] || process.env[envName(key)] || null
  const bundle = pick('bundle')
  const home = join(state, 'home')
  // LayerFS refuses a home other users can read; make it private before the runtime makes folders in it
  mkdirSync(home, { recursive: true, mode: 0o700 })
  chmodSync(home, 0o700)
  const runs = join(state, 'runs')
  mkdirSync(runs, { recursive: true })
  return {
    state,
    home,
    runs,
    image: pick('image'),
    bundle,
    daemon: pick('daemon') || (bundle ? join(bundle, 'layerfs-daemon') : null),
    docker: pick('docker') || '/var/run/docker.sock',
    prefix: pick('containerPrefix') || 'lfc-',
    worker: process.platform !== 'linux',
  }
}

export function readSettings(state) {
  const file = join(state, 'settings.json')
  if (!existsSync(file)) return {}
  const value = JSON.parse(readFileSync(file, 'utf8'))
  return Object.fromEntries(SETTINGS.filter((k) => typeof value[k] === 'string' && value[k]).map((k) => [k, value[k]]))
}

/** Saves the given settings over the saved ones (the Settings page). */
export function writeSettings(state, changes) {
  const next = { ...readSettings(state) }
  for (const key of SETTINGS) if (key in changes) next[key] = changes[key] || undefined
  const file = join(state, 'settings.json')
  writeFileSync(`${file}.tmp`, JSON.stringify(next, null, 2))
  renameSync(`${file}.tmp`, file)
}

/** Settings Init and Workspaces need that are missing. */
export const missing = (spec) => ['image', 'daemon', ...(spec.worker ? ['bundle'] : [])].filter((k) => !spec[k])

/** What LayerFSRuntime.open gets. */
export const runtimeSettings = (spec) => ({
  home: spec.home,
  image: spec.image,
  bundle: spec.bundle,
  daemon: spec.daemon,
  docker: spec.docker,
  containerPrefix: spec.prefix,
  traceDir: join(spec.home, 'traces'),
  stateDir: join(spec.home, '.runtime'),
  sweep: true,
})

/**
 * The runtime, opened once per process. On macOS and Windows it hands its
 * worker's endpoint to @layerfs/agent, so every client this process makes
 * after it uses the worker.
 * @returns {Promise<LayerFSRuntime>}
 */
export function openRuntime(spec) {
  spec.runtime ??= LayerFSRuntime.open(runtimeSettings(spec))
  return spec.runtime
}

/**
 * The LAYERFS_<NAME> deployment of one project, without the prefix: what an
 * agent's bash call and the host's own clients set. `project` is the
 * runtime's record ({ name, volume, image? }).
 */
export function deploymentEnv(spec, project) {
  return {
    PROJECT: project.name,
    HOME: spec.home,
    DOCKER: spec.docker,
    IMAGE: project.image ?? spec.image ?? '',
    DAEMON: spec.daemon ?? '',
    VOLUME: project.volume,
    STORE_PATH: `${VOLUMES}/${project.volume}/_data/global/store.sqlite`,
    CONTAINER_PREFIX: spec.prefix,
    ...(spec.worker ? { WORKER_ENDPOINT: join(spec.home, 'worker', 'endpoint.json') } : {}),
  }
}

/** `deploymentEnv` as LAYERFS_* environment variables. */
export const layerfsEnv = (spec, project) =>
  Object.fromEntries(
    Object.entries(deploymentEnv(spec, project))
      .filter(([, v]) => v)
      .map(([k, v]) => [`LAYERFS_${k}`, v]),
  )

/** Runs `make` with LAYERFS_* set for `project`, restoring the environment before it returns. LayerFS.open reads it synchronously. */
export function withProjectEnv(spec, project, make) {
  const env = layerfsEnv(spec, project)
  const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]))
  Object.assign(process.env, env)
  try {
    return make()
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }
}
