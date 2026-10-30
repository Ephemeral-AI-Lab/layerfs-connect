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
  // layerfs#506 d: a project of a PostgreSQL Store has no volume; its Store
  // calls and its Sandboxes' daemons open the schema with the connection's
  // URL, noted in this process only (notePostgresql), never written
  const url = project.store ? spec.postgresqlUrls?.get(project.store) : undefined
  if (url) {
    return {
      PROJECT: project.name,
      HOME: spec.home,
      DOCKER: spec.docker,
      IMAGE: project.image ?? spec.image ?? '',
      DAEMON: spec.daemon ?? '',
      STORE_PATH: `postgresql:${project.store}`,
      STORE: project.store,
      STORE_POSTGRESQL: JSON.stringify({ url }),
      CONTAINER_PREFIX: spec.prefix,
      ...(spec.worker ? { WORKER_ENDPOINT: join(spec.home, 'worker', 'endpoint.json') } : {}),
    }
  }
  return {
    PROJECT: project.name,
    HOME: spec.home,
    DOCKER: spec.docker,
    IMAGE: project.image ?? spec.image ?? '',
    DAEMON: spec.daemon ?? '',
    VOLUME: project.volume,
    STORE_PATH: `${VOLUMES}/${project.volume}/_data/global/store.sqlite`,
    // layerfs#506: a project of a shared Store is addressed by its Store and name
    STORE: project.shared ? project.store : '',
    CONTAINER_PREFIX: spec.prefix,
    ...(spec.worker ? { WORKER_ENDPOINT: join(spec.home, 'worker', 'endpoint.json') } : {}),
  }
}

/**
 * Whether the project `key` (a key or a projectRef) is in a PostgreSQL Store
 * (layerfs#506 d): then its connection's URL, as the LayerFS box reaches
 * it, is noted for deploymentEnv in this process. `spec.postgresqlUrl(store)`
 * (set by main.js from storage.js) answers it, or refuses NoSuchStore for a
 * Store that is not one; any other refusal (its connection is gone) is thrown.
 */
export async function notePostgresql(spec, key) {
  const ref = typeof key === 'string' ? projectRef(key) : key
  if (!ref?.store || !spec.postgresqlUrl) return false
  if (spec.postgresqlUrls?.has(ref.store)) return true
  let url
  try {
    url = await spec.postgresqlUrl(ref.store)
  } catch (error) {
    if (error?.code === 'NoSuchStore') return false
    throw error
  }
  ;(spec.postgresqlUrls ??= new Map()).set(ref.store, url)
  return true
}

/** The Store holding a runtime project record (a build before layerfs#506 has none: the project's own). */
export const storeOf = (p) => (typeof p.store === 'string' ? p.store : (p.store?.name ?? p.name))
/** The key a project goes by, as the runtime's: `store/name` in a shared Store, else the name. */
export const keyOf = (p) => (p.shared ? `${storeOf(p)}/${p.name}` : p.name)

/**
 * A project key as the app and runs know it (layerfs#506): `store/name` for
 * a project of a shared Store, else the bare name. As a project for
 * deploymentEnv: `{ name, store, shared }`.
 */
export function projectRef(key) {
  const at = String(key).indexOf('/')
  return at < 0 ? { name: key, store: null, shared: false } : { name: key.slice(at + 1), store: key.slice(0, at), shared: true }
}

/** `deploymentEnv` as LAYERFS_* environment variables. */
export const layerfsEnv = (spec, project) =>
  Object.fromEntries(
    Object.entries(deploymentEnv(spec, project))
      .filter(([, v]) => v)
      .map(([k, v]) => [`LAYERFS_${k}`, v]),
  )

/** Runs `make` with LAYERFS_* set for `project` (and `extra`), restoring the environment before it returns. LayerFS.open reads it synchronously. */
export function withProjectEnv(spec, project, make, extra = {}) {
  const env = { ...layerfsEnv(spec, project), ...extra }
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
