// Compute's machines (LayerFS 2.0, layerfs#533): `GET /api/machines` and the
// calls the Compute page makes. A LayerFS 2.0 home's compute is a set of
// machines: `native` and `docker` built in, VMs it creates (apple-container,
// microsandbox, lima, firecracker) and ssh hosts it connects. A machine holds
// sqlite Stores; a project's Sandboxes run on its Store's machine. Machines
// start on the first call that needs them and stop after 10 idle minutes, so
// there are no start or stop calls.
//
// Connect links the 2.0 package (`layerfs`, with `client({ home })` and the
// machine family) when it is built against it. Linked to an older LayerFS
// (@layerfs/runtime 1.x), there is none: the view says so, with no sample
// data, and every action is refused Unsupported.
//
// The view (MachinesView, src/shared/host-api.ts) is machine.list() as 2.0
// answers it, with store.list(), sandbox.list() and each VM's
// machine.status(), so the page needs one read.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const BUILT_IN = new Set(['native', 'docker'])
const SSH = 'ssh'

const refuse = (code, message) => Object.assign(new Error(message), { code })

/** The linked LayerFS's version (@layerfs/runtime 1.x, or `layerfs` 2.x), or null. */
export function linkedVersion() {
  const require = createRequire(import.meta.url)
  for (const name of ['layerfs/package.json', '@layerfs/runtime/package.json']) {
    try {
      return JSON.parse(readFileSync(require.resolve(name), 'utf8')).version ?? null
    } catch {
      /* not linked under this name */
    }
  }
  return null
}

/** The 2.0 package when it is linked and has machines, else null. */
export async function loadLayerfs2() {
  try {
    const mod = await import('layerfs')
    const client = mod.client ?? mod.default?.client
    const table = mod.table ?? mod.default?.table ?? []
    return typeof client === 'function' ? { client, table } : null
  } catch {
    return null
  }
}

const list = (value) => (Array.isArray(value) ? value : Array.isArray(value?.items) ? value.items : [])
const text = (value) => (typeof value === 'string' && value ? value : null)
const count = (value) => (typeof value === 'number' ? value : Array.isArray(value) ? value.length : 0)
const num = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null)

/** One machine.list() entry, as the page reads it. */
export function machineOf(m) {
  return {
    name: String(m.name),
    platform: String(m.platform),
    backend: text(m.backend) ?? (m.platform === 'docker' ? 'docker' : m.platform === 'native' ? 'native' : 'namespaces'),
    state: text(m.state) ?? (BUILT_IN.has(m.platform) ? 'ready' : 'stopped'),
    cpus: num(m.cpus),
    memory: num(m.memory),
    disk: num(m.disk),
    stores: list(m.stores).map(String),
    sandboxes: list(m.sandboxes).map(String),
    ...(text(m.image) ? { image: m.image } : {}),
    ...(text(m.host) ? { host: m.host } : {}),
    ...(typeof m.nested === 'boolean' ? { nested: m.nested } : {}),
    ...(text(m.docker) ? { docker: m.docker } : {}),
    ...(text(m.wsl) ? { wsl: m.wsl } : {}),
    ...(text(m.error) ? { error: m.error } : {}),
    ...(m.ssh && typeof m.ssh === 'object' ? { ssh: { host: String(m.ssh.host ?? ''), user: text(m.ssh.user) ?? 'root', port: num(m.ssh.port) ?? 22, identity: text(m.ssh.identity), root: text(m.ssh.root) } } : {}),
  }
}

/** One can_create entry. */
export const creatableOf = (c) => ({ platform: String(c.platform), ready: c.ready === true, missing: list(c.missing).map(String), version: text(c.version) })

/** One store.list() item, when it is a sqlite Store on a machine. */
export function storeOf(s) {
  const machine = text(s.machine)
  if (!machine) return null
  return { name: String(s.name), machine, projects: count(s.projects), size: num(s.size ?? s.bytes) }
}

/** One sandbox.list() item. */
export function sandboxOf(b) {
  return { name: String(b.name ?? b.sandbox), machine: text(b.machine), project: text(b.project), workspaces: count(b.workspaces) }
}

/** One machine.status() answer (2.0 calls the reason `down_reason`). */
export const statusOf = (s) => ({ name: String(s.name), state: text(s.state), freeDisk: num(s.free_disk), toolVersion: text(s.tool_version), down: text(s.down_reason ?? s.why_down) })

/**
 * The machines view and its calls.
 * @param {object} options
 * @param {object} options.spec config.js's resolved spec (its `home`)
 * @param {() => Promise<{ client: Function, table?: object[] } | null>} [options.load] the 2.0 package and its call table (tests pass a stand-in)
 * @param {() => string | null} [options.version] the linked LayerFS's version
 */
export class Machines {
  constructor({ spec, load = loadLayerfs2, version = linkedVersion }) {
    this.spec = spec
    this.load = load
    this.version = version
    this.lfs = null
    this.table = []
  }

  /** Whether the linked call `family.call` takes option `name`. */
  takes(family, call, name) {
    return this.table.some((c) => c.family === family && c.call === call && (c.options ?? []).some((o) => o.name === name))
  }

  /** A 2.0 client of this home, or null on an older LayerFS. */
  async client() {
    if (this.lfs) return this.lfs
    const mod = await this.load()
    if (!mod) return null
    this.table = Array.isArray(mod.table) ? mod.table : []
    this.lfs = mod.client({ home: this.spec.home })
    return this.lfs
  }

  async need() {
    const lfs = await this.client()
    if (!lfs?.machine) throw refuse('Unsupported', `machines need Connect on LayerFS 2.0; this Connect links LayerFS ${this.version() ?? 'of an unknown version'}`)
    return lfs
  }

  /** MachinesView. */
  async view() {
    const lfs = await this.client()
    if (!lfs?.machine?.list) return { available: false, layerfs: this.version(), reason: 'This LayerFS has no machines: they come with LayerFS 2.0.' }
    const listed = await lfs.machine.list()
    const machines = list(listed.machines).map(machineOf)
    const [stores, sandboxes, statuses] = await Promise.all([
      lfs.store.list().then((r) => list(r).map(storeOf).filter(Boolean), () => []),
      lfs.sandbox.list().then((r) => list(r).map(sandboxOf), () => []),
      // a stopped VM answers without being started; docker's gives its VM's free disk, native has none to give
      Promise.all(machines.filter((m) => m.platform !== 'native').map((m) => lfs.machine.status(m.name).then(statusOf, (e) => ({ name: m.name, state: 'down', freeDisk: null, toolVersion: null, down: e?.message ?? String(e) })))),
    ])
    return { available: true, layerfs: this.version(), machines, canCreate: list(listed.can_create).map(creatableOf), stores, sandboxes, status: Object.fromEntries(statuses.map((s) => [s.name, s])) }
  }

  /** A VM: { name, platform, cpus?, memory?, disk?, image? (its Sandbox image), os_image?, host?, nested? }. */
  async create(body) {
    const lfs = await this.need()
    const { name, platform, ...rest } = body ?? {}
    if (!name || !platform) throw refuse('InvalidInput', 'a machine needs a name and a platform')
    if (platform === SSH) throw refuse('InvalidInput', 'an ssh host is connected, not created')
    const options = pick(rest, ['cpus', 'memory', 'disk', 'image', 'host', 'nested', 'os_image'])
    // layerfs#533's first table has no os_image: say so rather than send an option it refuses
    if (options.os_image && !this.takes('machine', 'create', 'os_image')) throw refuse('Unsupported', 'this LayerFS chooses the VM’s OS image itself: machine.create takes no os_image')
    return lfs.machine.create(name, platform, options)
  }

  /** An ssh host: { name, host, user?, port?, identity?, root? }. */
  async connect(body) {
    const lfs = await this.need()
    const { name, host, ...rest } = body ?? {}
    if (!name || !host) throw refuse('InvalidInput', 'an ssh machine needs a name and a host')
    return lfs.machine.connect(name, host, pick(rest, ['user', 'port', 'identity', 'known_hosts', 'root']))
  }

  /** Removes a VM or disconnects an ssh host; LayerFS refuses InUse while it holds Stores or running Sandboxes. */
  async remove(name) {
    const lfs = await this.need()
    if (BUILT_IN.has(name)) throw refuse('InvalidInput', `${name} is built in and can't be removed`)
    const m = list((await lfs.machine.list()).machines).find((x) => x.name === name)
    if (!m) throw refuse('NotFound', `no machine named ${name}`)
    return m.platform === SSH ? lfs.machine.disconnect(name) : lfs.machine.remove(name)
  }

  /** A built-in's settings ({ image, docker, wsl }) or a VM's size ({ cpus, memory }). */
  async update(name, body) {
    const lfs = await this.need()
    return lfs.machine.update(name, pick(body ?? {}, ['cpus', 'memory', 'image', 'docker', 'wsl']))
  }

  /** Moves a sqlite Store to `machine`. */
  async moveStore(store, machine) {
    const lfs = await this.need()
    if (!store || !machine) throw refuse('InvalidInput', 'a move needs a Store and a machine')
    return lfs.store.move(store, machine)
  }
}

/** The options a call takes, without empty ones. */
function pick(body, keys) {
  const out = {}
  for (const key of keys) if (body[key] !== undefined && body[key] !== null && body[key] !== '') out[key] = body[key]
  return out
}
