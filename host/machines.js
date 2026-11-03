// Compute's machines (LayerFS 2.0, layerfs#533): `GET /api/machines` and the
// calls the Compute page makes. A LayerFS 2.0 home's compute is a set of
// machines: `native` and `docker` built in, VMs it creates (apple-container,
// microsandbox, lima, firecracker) and ssh hosts it connects. A machine holds
// sqlite Stores; a project's Sandboxes run on its Store's machine. Power is
// manual (#535 D11): a machine runs between machine.start and machine.stop,
// and no call starts one on demand.
//
// The view (MachinesView, src/shared/host-api.ts) is machine.list() as the
// SDK answers it (each machine's `state` and `supports`, never guessed here),
// with store.list() and sandbox.list() (their items carry `state` and `op`),
// and machine.status() of the machines that run or hold an operation (free
// disk, `op`): one read for the page, and none of it starts a machine.
// Every call goes through the host's one client (layerfs.js).
import { table } from 'layerfs'
import { layerfs, linkedVersion, pages } from './layerfs.js'

const BUILT_IN = new Set(['native', 'docker'])
const SSH = 'ssh'
/** States whose machine.status says something the list does not: free disk, or the op that holds it. */
const ASK_STATUS = new Set(['running', 'creating', 'removing', 'unresolved', 'failed', 'unknown'])

const refuse = (code, message) => Object.assign(new Error(message), { code })

const list = (value) => (Array.isArray(value) ? value : Array.isArray(value?.items) ? value.items : [])
const text = (value) => (typeof value === 'string' && value ? value : null)
const count = (value) => (typeof value === 'number' ? value : Array.isArray(value) ? value.length : 0)
const num = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null)

/** One machine.list() entry, as the page reads it. */
export function machineOf(m) {
  return {
    name: String(m.name),
    platform: String(m.platform),
    backend: text(m.backend),
    // the SDK's state, as it is (#537 U4)
    state: text(m.state) ?? 'unknown',
    ...(m.supports && typeof m.supports === 'object' ? { supports: { sqlite: m.supports.sqlite !== false, postgresql_sandbox: m.supports.postgresql_sandbox === true, reason: text(m.supports.reason) } } : {}),
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

/** An SDK `op` ({ id, name, phase, started, uncertain }), or null. */
export const opOf = (o) => (o && typeof o === 'object' && typeof o.name === 'string' ? { id: String(o.id ?? ''), name: o.name, phase: text(o.phase) ?? '', started: num(o.started), uncertain: o.uncertain === true } : null)

/** One store.list() item, when it is a sqlite Store on a machine. */
export function storeOf(s) {
  const machine = text(s.machine)
  if (!machine) return null
  return { name: String(s.name), machine, projects: count(s.projects), size: num(s.size ?? s.bytes), state: text(s.state) ?? 'unknown', op: opOf(s.op) }
}

/** One sandbox.list() item. */
export function sandboxOf(b) {
  return { name: String(b.name ?? b.sandbox), machine: text(b.machine), project: text(b.project), workspaces: count(b.workspaces), state: text(b.state) ?? 'unknown', op: opOf(b.op), backend: text(b.backend), route: text(b.route) }
}

/** One machine.status() answer (the reason is `down_reason`). */
export const statusOf = (s) => ({ name: String(s.name), state: text(s.state), freeDisk: num(s.free_disk), toolVersion: text(s.tool_version), down: text(s.down_reason ?? s.why_down), op: opOf(s.op) })

/**
 * The machines view and its calls.
 * @param {object} options
 * @param {object} options.spec config.js's resolved spec (its `home`)
 * @param {object} [options.client] a LayerFS client (tests pass a stand-in)
 * @param {object[]} [options.calls] the call table (tests pass a stand-in)
 * @param {() => string | null} [options.version] the linked LayerFS's version
 * @param {(store: string, machine: string) => Promise<object>} [options.place] puts a Store on a machine as a job in the host's table (storage.js place: push, pull, or pull then push)
 */
export class Machines {
  constructor({ spec, client = null, calls = table, version = linkedVersion, place = null }) {
    this.spec = spec
    this.lfs = client ?? layerfs(spec)
    this.table = calls
    this.version = version
    this.place = place
  }

  /** Whether the linked call `family.call` takes option `name`. */
  takes(family, call, name) {
    return this.table.some((c) => c.family === family && c.call === call && (c.options ?? []).some((o) => o.name === name))
  }

  async need() {
    return this.lfs
  }

  /** MachinesView. */
  async view() {
    const lfs = this.lfs
    const listed = await lfs.machine.list()
    const machines = list(listed.machines).map(machineOf)
    const [stores, sandboxes, statuses] = await Promise.all([
      lfs.store.list().then((r) => list(r).map(storeOf).filter(Boolean), () => []),
      pages((p) => lfs.sandbox.list(p)).then((r) => r.map(sandboxOf), () => []),
      // starts nothing; asked only where it adds the free disk or the op (a stopped machine's says only that it is stopped)
      Promise.all(machines.filter((m) => m.platform !== 'native' && ASK_STATUS.has(m.state)).map((m) => lfs.machine.status(m.name).then(statusOf, (e) => ({ name: m.name, state: null, freeDisk: null, toolVersion: null, down: e?.message ?? String(e), op: null })))),
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

  /** Puts a sqlite Store on `machine`: a job in the host's table (its progress shows on Storage). */
  async moveStore(store, machine) {
    if (!store || !machine) throw refuse('InvalidInput', 'name the Store and the machine')
    if (!this.place) throw refuse('Unsupported', 'this host has no Storage job table to push or pull with')
    return this.place(store, machine)
  }
}

/** The options a call takes, without empty ones. */
function pick(body, keys) {
  const out = {}
  for (const key of keys) if (body[key] !== undefined && body[key] !== null && body[key] !== '') out[key] = body[key]
  return out
}
