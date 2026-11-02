// Connect's deployment: where its state lives, the LayerFS home it runs on,
// and the settings @layerfs/runtime and agents' bash calls need. Connect
// keeps its own home and container prefix (default lfc-), so its worker
// (<prefix>worker), Sandboxes and Store volumes never meet another
// integration's on the same Docker engine.
//   <state>/settings.json  { image, bundle, daemon, docker, containerPrefix,
//                            placement, sandbox, localDir, imageArchive,
//                            vm: { image, cpus, memory, storeSize },
//                            ssh: { host, user, port, identityFile, storePath, knownHostsFile } }
//   <state>/home           the LayerFS home (private: 0700)
//   <state>/runs           one folder per demo run
// Each setting comes from settings.json, else LAYERFS_CONNECT_<NAME>, else
// its default. LayerFS itself reads LAYERFS_* names only. `placement` is
// where the home's Stores and Sandboxes live (layerfs#526): `local` (the
// default: this machine's Docker, through the worker on macOS and Windows) or
// `vm:apple-container`, `vm:microsandbox` or `vm:ssh` (one Linux VM per
// project; `vm` sizes it, `ssh` names the host). Connect always passes its
// own placement, so a LAYERFS_PLACEMENT in the environment does not move
// Connect's home.
//
// `sandbox` (LayerFS's LAYERFS_SANDBOX) is `docker` unless set. `native` or
// `namespaces` on a local placement makes a host home (layerfs#529): its
// Stores are files under <state>/stores and its Sandboxes host daemons (a
// `mac` Sandbox on macOS, a `linux` one on Linux), reached through the SDK
// alone with the bundle's addon. The runtime is never opened there: on macOS
// it would hand every client its Docker worker. `localDir` holds the
// daemons (default <state>/local); `imageArchive` is the docker-archive a
// `linux` Sandbox's root is unpacked from. A host home plays scenario chats
// and runs; the rest of the app still needs a runtime home.
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs'
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
 * @property {string} placement `local` or `vm:<provider>`
 * @property {{ image?: string, cpus?: number, memory?: string, storeSize?: string }} vm a VM placement's VM, as given (the runtime fills the defaults)
 * @property {{ host?: string, user?: string, port?: number, identityFile?: string, storePath?: string, knownHostsFile?: string, strictHostKeyChecking?: boolean | string }} ssh vm:ssh's host, as given
 * @property {boolean} worker Store calls go through the home's one worker container (macOS, Windows; a local placement)
 * @property {Promise<LayerFSRuntime>} [runtime] opened once by openRuntime
 * @property {LayerFSRuntime} [opened] the runtime, once open
 */

const SETTINGS = ['image', 'bundle', 'daemon', 'docker', 'containerPrefix', 'placement', 'sandbox', 'localDir', 'imageArchive']
/** The object settings, each field with its LAYERFS_CONNECT_ name and type. */
const GROUPS = {
  vm: { image: ['VM_IMAGE', 'string'], cpus: ['VM_CPUS', 'number'], memory: ['VM_MEMORY', 'string'], storeSize: ['VM_STORE_SIZE', 'string'] },
  ssh: {
    host: ['SSH_HOST', 'string'],
    user: ['SSH_USER', 'string'],
    port: ['SSH_PORT', 'number'],
    identityFile: ['SSH_IDENTITY', 'string'],
    storePath: ['SSH_STORE', 'string'],
    knownHostsFile: ['SSH_KNOWN_HOSTS', 'string'],
    strictHostKeyChecking: [null, 'any'],
  },
}
const envName = (key) => `LAYERFS_CONNECT_${key.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase()}`

/** A VM placement: `vm:<provider>`. */
export const isVm = (spec) => typeof spec.placement === 'string' && spec.placement.startsWith('vm:')

/** A host home: Stores on this machine's disk, Sandboxes as host daemons, no runtime (see the top). */
export const isHostHome = (spec) => !!spec.hostHome

/** One object setting: settings.json's fields, else LAYERFS_CONNECT_<NAME>'s, only those given. */
function group(saved, name) {
  const out = {}
  for (const [key, [env, type]] of Object.entries(GROUPS[name])) {
    let value = saved[name]?.[key]
    if (value === undefined || value === null || value === '') value = env ? process.env[`LAYERFS_CONNECT_${env}`] || undefined : undefined
    if (value === undefined) continue
    // a number from the environment is text; the runtime checks the value itself
    out[key] = type === 'number' && typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value
  }
  return out
}

/** Resolves Connect's settings once; makes the state folder and a private home. */
export function resolveSpec(state = process.env.LAYERFS_CONNECT_STATE || join(homedir(), '.layerfs-connect')) {
  mkdirSync(state, { recursive: true, mode: 0o700 })
  const saved = readSettings(state)
  const pick = (key) => saved[key] || process.env[envName(key)] || null
  const bundle = pick('bundle')
  const placement = pick('placement') || 'local'
  const home = join(state, 'home')
  // LayerFS refuses a home other users can read; make it private before the runtime makes folders in it
  mkdirSync(home, { recursive: true, mode: 0o700 })
  chmodSync(home, 0o700)
  const runs = join(state, 'runs')
  mkdirSync(runs, { recursive: true })
  const sandbox = pick('sandbox') || 'docker'
  const hostHome = (sandbox === 'native' || sandbox === 'namespaces') && !placement.startsWith('vm:')
  return {
    state,
    home,
    runs,
    image: pick('image'),
    bundle,
    daemon: pick('daemon') || (bundle ? join(bundle, 'layerfs-daemon') : null),
    docker: pick('docker') || '/var/run/docker.sock',
    prefix: pick('containerPrefix') || 'lfc-',
    placement,
    vm: group(saved, 'vm'),
    ssh: group(saved, 'ssh'),
    sandbox,
    hostHome,
    localDir: pick('localDir') || (hostHome ? join(state, 'local') : null),
    imageArchive: pick('imageArchive'),
    worker: process.platform !== 'linux' && !placement.startsWith('vm:') && !hostHome,
  }
}

export function readSettings(state) {
  const file = join(state, 'settings.json')
  if (!existsSync(file)) return {}
  const value = JSON.parse(readFileSync(file, 'utf8'))
  const out = Object.fromEntries(SETTINGS.filter((k) => typeof value[k] === 'string' && value[k]).map((k) => [k, value[k]]))
  for (const name of Object.keys(GROUPS)) {
    if (value[name] && typeof value[name] === 'object' && !Array.isArray(value[name])) out[name] = value[name]
  }
  return out
}

/** Saves the given settings over the saved ones (the Settings page). An object setting (vm, ssh) is replaced whole; null removes it. */
export function writeSettings(state, changes) {
  const next = { ...readSettings(state) }
  for (const key of SETTINGS) if (key in changes) next[key] = changes[key] || undefined
  for (const key of Object.keys(GROUPS)) if (key in changes) next[key] = changes[key] && typeof changes[key] === 'object' ? changes[key] : undefined
  const file = join(state, 'settings.json')
  writeFileSync(`${file}.tmp`, JSON.stringify(next, null, 2))
  renameSync(`${file}.tmp`, file)
}

/** The vm:ssh host as given: settings.json's or LAYERFS_CONNECT_SSH_HOST (spec.ssh), else LayerFS's own LAYERFS_SSH_HOST. */
export const sshHost = (spec) => spec.ssh?.host || process.env.LAYERFS_SSH_HOST || null

/**
 * Settings Init and Workspaces need that are missing, as the runtime's
 * status().missing names them: a VM home needs the bundle and no image (the
 * daemon is the guest's), and vm:ssh a host. `placement` asks about another
 * placement than the home's.
 */
export function missing(spec, placement = spec.placement) {
  if (isHostHome(spec) && placement === spec.placement) return ['bundle', ...(spec.sandbox === 'namespaces' ? ['imageArchive'] : [])].filter((k) => !spec[k])
  if (typeof placement === 'string' && placement.startsWith('vm:')) {
    return [...(spec.bundle ? [] : ['bundle']), ...(placement === 'vm:ssh' && !sshHost(spec) ? ['host'] : [])]
  }
  return ['image', 'daemon', ...(process.platform !== 'linux' ? ['bundle'] : [])].filter((k) => !spec[k])
}

/** What LayerFSRuntime.open gets. `vm` and `ssh` only when given: the runtime fills their defaults. */
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
  placement: spec.placement ?? 'local',
  // a Linux home's `linux` platform (layerfs#529); the runtime ignores them elsewhere
  ...(spec.localDir ? { localDir: spec.localDir } : {}),
  ...(spec.imageArchive ? { imageArchive: spec.imageArchive } : {}),
  ...(spec.vm && Object.keys(spec.vm).length ? { vm: spec.vm } : {}),
  ...(spec.ssh && Object.keys(spec.ssh).length ? { ssh: spec.ssh } : {}),
})

/**
 * The runtime, opened once per process. On macOS and Windows it hands its
 * worker's endpoint to @layerfs/agent, so every client this process makes
 * after it uses the worker.
 * @returns {Promise<LayerFSRuntime>}
 */
export function openRuntime(spec) {
  if (isHostHome(spec)) return Promise.reject(Object.assign(new Error(`a ${spec.sandbox} home (settings.json sandbox) runs without the LayerFS runtime`), { code: 'Unsupported' }))
  spec.runtime ??= LayerFSRuntime.open(runtimeSettings(spec)).then((runtime) => {
    spec.opened = runtime
    return runtime
  })
  return spec.runtime
}

/**
 * The LAYERFS_<NAME> deployment of one project, without the prefix: what an
 * agent's bash call and the host's own clients set. `project` is the
 * runtime's record ({ name, volume, image? }).
 */
export function deploymentEnv(spec, project) {
  // a host home: the Store file on this disk, Sandboxes as host daemons, the bundle's addon in-process
  if (isHostHome(spec)) {
    return {
      PROJECT: project.name,
      HOME: spec.home,
      SANDBOX: spec.sandbox,
      NATIVE: spec.bundle ? join(spec.bundle, 'layerfs.node') : '',
      DAEMON: spec.daemon ?? '',
      LOCAL_DIR: spec.localDir,
      STORE_PATH: hostStorePath(spec, project.name),
      IMAGE: spec.image ?? '',
      IMAGE_ARCHIVE: spec.imageArchive ?? '',
      CONTAINER_PREFIX: spec.prefix,
    }
  }
  // layerfs#526: on a VM home a project's Store and Sandboxes are in its own
  // VM; the runtime's platform gives the guest's settings (native Sandboxes
  // with the namespaces backend, the guest home and Store path, and this
  // project's worker endpoint), and no Docker setting
  if (isVm(spec)) {
    const platform = spec.opened?.platform
    const guest = platform?.deploymentEnv
      ? platform.deploymentEnv(spec.opened.settings, project)
      : { WORKER_ENDPOINT: join(spec.home, 'worker', `${project.name}.json`), CONTAINER_PREFIX: spec.prefix }
    return { PROJECT: project.name, ...guest, STORE: project.shared ? project.store : '' }
  }
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
    // a Linux home's `linux` Sandboxes (layerfs#529)
    ...(spec.localDir ? { LOCAL_DIR: spec.localDir } : {}),
    ...(spec.imageArchive ? { IMAGE_ARCHIVE: spec.imageArchive } : {}),
    ...(spec.worker ? { WORKER_ENDPOINT: join(spec.home, 'worker', 'endpoint.json') } : {}),
  }
}

/** A host home's project Store file. */
export const hostStorePath = (spec, name) => join(spec.state, 'stores', name, 'store.sqlite')

/** A host home's projects, as the runtime's records look: one per Store file under <state>/stores. */
export function hostProjects(spec) {
  const dir = join(spec.state, 'stores')
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((name) => existsSync(join(dir, name, 'store.sqlite'))).sort().map((name) => ({ name, volume: null, image: spec.image ?? null, host: true }))
}

/**
 * runtime.status() as a host home answers it (it opens no runtime): the
 * platforms the SDK allows such a home (layerfs#529 §4: `mac` on macOS;
 * `docker` and `linux` on Linux) and what each lacks.
 */
export function hostStatus(spec) {
  const os = process.platform
  const missingNow = missing(spec)
  const linuxLacks = [
    ...['daemon', 'localDir', 'imageArchive'].filter((k) => !spec[k]),
    ...(process.getuid?.() === 0 ? [] : ['host:root']),
    ...(existsSync('/dev/fuse') ? [] : ['host:/dev/fuse']),
    ...(existsSync('/sys/fs/cgroup/cgroup.controllers') ? [] : ['host:cgroup2']),
  ]
  const allowed = os === 'darwin' ? { mac: missingNow } : os === 'linux' ? { docker: [...missingNow, ...(existsSync(spec.docker) ? [] : ['tool:docker'])], linux: linuxLacks } : {}
  const names = ['docker', 'mac', 'linux', 'apple-container', 'microsandbox', 'lima', 'firecracker', 'ssh']
  return {
    platform: os,
    placement: 'local',
    missing: missingNow,
    platforms: names.map((id) => (id in allowed ? { id, allowed: true, ready: allowed[id].length === 0, missing: allowed[id] } : { id, allowed: false, ready: false, missing: [] })),
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
