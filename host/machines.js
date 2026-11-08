// Compute's machines (LayerFS 2.0, layerfs#533): `GET /api/machines` and the
// calls the Compute page makes. A LayerFS 2.0 home's compute is a set of
// machines: `native` and `docker` built in, and VMs it creates
// (apple-container, microsandbox, lima). LayerFS's ssh hosts and Firecracker
// machines are turned off in Connect (OFF): machine.platforms leaves them out
// and machine.create refuses them. A machine holds
// sqlite Stores; a project's Sandboxes run on its Store's machine. Power is
// manual (#535 D11): a machine runs between machine.start and machine.stop,
// and no call starts one on demand.
//
// The view (MachinesView, src/shared/host-api.ts) is machine.list() as the
// SDK answers it (each machine's `state` and `supports`, never guessed here),
// with store.list() and sandbox.list() (their items carry `state` and `op`;
// each Sandbox's Workspace count is its sandbox.get),
// and machine.status() of the machines that run or hold an operation (free
// disk, `op`): one read for the page, and none of it starts a machine.
// Every call goes through the host's one client (layerfs.js).
import { layerfs, linkedVersion, pages, VIEW_WAIT_MS, workspacesOf } from './layerfs.js'

const BUILT_IN = new Set(['native', 'docker'])
/** Platforms LayerFS has that Connect turns off: not offered, not created or connected. */
export const OFF = new Set(['ssh', 'firecracker'])
/** Create options only Firecracker used (a nested Lima machine hosts it): not offered either. */
const OFF_OPTIONS = new Set(['nested', 'host'])
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
    ...(text(m.docker) ? { docker: m.docker } : {}),
    ...(text(m.wsl) ? { wsl: m.wsl } : {}),
    ...(text(m.error) ? { error: m.error } : {}),
  }
}

/** One machine.platforms row, as the SDK answers it (the support table's facts, this host's readiness, the create options). */
export const platformOf = (p) => ({
  platform: String(p.platform),
  how: String(p.how ?? ''),
  backend: text(p.backend),
  kernel: text(p.kernel),
  sqlite: text(p.sqlite),
  postgresql: { store_calls: String(p.postgresql?.store_calls ?? ''), sandbox: p.postgresql?.sandbox === true, reason: text(p.postgresql?.reason) },
  ready: p.ready === true,
  missing: list(p.missing).map(String),
  version: text(p.version),
  options: list(p.options).map((o) => ({ name: String(o.name), kind: String(o.kind) })),
  description: String(p.description ?? ''),
})

/** An SDK `op` ({ id, name, phase, started, uncertain }), or null. */
export const opOf = (o) => (o && typeof o === 'object' && typeof o.name === 'string' ? { id: String(o.id ?? ''), name: o.name, phase: text(o.phase) ?? '', started: num(o.started), uncertain: o.uncertain === true } : null)

/** One store.list() item, when it is a sqlite Store on a machine. */
export function storeOf(s) {
  const machine = text(s.machine)
  if (!machine) return null
  return { name: String(s.name), machine, projects: count(s.projects), names: Array.isArray(s.projects) ? s.projects.map(String) : [], size: num(s.size ?? s.bytes), state: text(s.state) ?? 'unknown', op: opOf(s.op) }
}

/** One store.list() item, when it is a PostgreSQL Store (on no machine: Sandboxes reach its database). */
export function pgStoreOf(s) {
  if (s.kind !== 'postgresql') return null
  return { name: String(s.name), projects: count(s.projects), names: Array.isArray(s.projects) ? s.projects.map(String) : [], state: text(s.state) ?? 'unknown', op: opOf(s.op) }
}

/** One sandbox.list() item. */
export function sandboxOf(b) {
  return { name: String(b.name ?? b.sandbox), machine: text(b.machine), project: text(b.project), workspaces: b.workspaces === undefined ? null : count(b.workspaces), state: text(b.state) ?? 'unknown', op: opOf(b.op), backend: text(b.backend), route: text(b.route), image: text(b.image) }
}

/** One machine.status() answer (the reason is `down_reason`). */
export const statusOf = (s) => ({ name: String(s.name), state: text(s.state), freeDisk: num(s.free_disk), toolVersion: text(s.tool_version), down: text(s.down_reason ?? s.why_down), op: opOf(s.op) })

/**
 * The machines view and its calls.
 * @param {object} options
 * @param {object} options.spec config.js's resolved spec (its `home`)
 * @param {object} [options.client] a LayerFS client (tests pass a stand-in)
 * @param {() => string | null} [options.version] the linked LayerFS's version
 * @param {(store: string, machine: string) => Promise<object>} [options.place] puts a Store on a machine as a job in the host's table (storage.js place: push, pull, or pull then push)
 */
export class Machines {
  constructor({ spec, client = null, version = linkedVersion, place = null }) {
    this.spec = spec
    this.lfs = client ?? layerfs(spec)
    this.version = version
    this.place = place
  }

  async need() {
    return this.lfs
  }

  /** MachinesView. */
  async view() {
    const lfs = this.lfs
    const listed = await lfs.machine.list()
    const machines = list(listed.machines).map(machineOf)
    const [platforms, listedStores, sandboxes, statuses] = await Promise.all([
      this.platforms().then((p) => p.platforms, () => []),
      lfs.store.list().then(list, () => []),
      // sandbox.list items carry no Workspaces: each one's count is its sandbox.get (a record read; null when refused)
      pages((p) => lfs.sandbox.list(p)).then(
        (r) => Promise.all(r.map(sandboxOf).map((b) => workspacesOf(lfs, b.name, { wait: VIEW_WAIT_MS }).then((w) => ({ ...b, workspaces: w.length }), () => ({ ...b, workspaces: null })))),
        () => [],
      ),
      // starts nothing; asked only where it adds the free disk or the op (a stopped machine's says only that it is stopped)
      Promise.all(machines.filter((m) => m.platform !== 'native' && ASK_STATUS.has(m.state)).map((m) => lfs.machine.status(m.name).then(statusOf, (e) => ({ name: m.name, state: null, freeDisk: null, toolVersion: null, down: e?.message ?? String(e), op: null })))),
    ])
    const stores = listedStores.map(storeOf).filter(Boolean)
    const postgresql = listedStores.map(pgStoreOf).filter(Boolean)
    return { available: true, layerfs: this.version(), machines, platforms, stores, postgresql, sandboxes, status: Object.fromEntries(statuses.map((s) => [s.name, s])) }
  }

  /** machine.platforms(): each platform on this host but the ones Connect turns off; starts nothing (PlatformsView). */
  async platforms() {
    const answer = await this.lfs.machine.platforms()
    const rows = list(answer.platforms).map(platformOf).filter((p) => !OFF.has(p.platform))
    return { host: String(answer.host ?? ''), platforms: rows.map((p) => ({ ...p, options: p.options.filter((o) => !OFF_OPTIONS.has(o.name)) })) }
  }

  /** machine.start(name): a stopped machine and its worker, waited for; native and a running one answer at once. */
  async start(name) {
    if (!name) throw refuse('InvalidInput', 'name the machine to start')
    return (await this.need()).machine.start(name)
  }

  /** machine.stop(name): refused InUse while Sandboxes run on it (`detail.related` names them). */
  async stop(name) {
    if (!name) throw refuse('InvalidInput', 'name the machine to stop')
    return (await this.need()).machine.stop(name)
  }

  /** The options `platform` declares for machine.create (machine.platforms), or null when unknown. */
  async declared(platform) {
    const row = (await this.platforms().catch(() => null))?.platforms.find((p) => p.platform === platform)
    return row ? row.options.map((o) => o.name) : null
  }

  /** A VM: { name, platform, cpus?, memory?, disk?, image? (its Sandbox image), os_image? }. */
  async create(body) {
    const lfs = await this.need()
    const { name, platform, ...rest } = body ?? {}
    if (!name || !platform) throw refuse('InvalidInput', 'a machine needs a name and a platform')
    if (OFF.has(platform)) throw refuse('Unsupported', `${platform} machines are turned off in Connect`)
    // the options this platform declares (machine.platforms); one it does not take is refused here, not sent
    const declared = (await this.declared(platform)) ?? ['cpus', 'memory', 'disk', 'image']
    const given = pick(rest, Object.keys(rest))
    const extra = Object.keys(given).filter((k) => !declared.includes(k))
    if (extra.length) throw refuse('InvalidInput', `${platform} takes no ${extra.join(', ')} (its options: ${declared.join(', ') || 'none'})`)
    return lfs.machine.create(name, platform, given)
  }

  /**
   * Removes a VM; LayerFS refuses InUse while it holds Stores or running
   * Sandboxes. An ssh machine a home already had is disconnected, so it can
   * still be cleared away.
   */
  async remove(name) {
    const lfs = await this.need()
    if (BUILT_IN.has(name)) throw refuse('InvalidInput', `${name} is built in and can't be removed`)
    const m = list((await lfs.machine.list()).machines).find((x) => x.name === name)
    if (!m) throw refuse('NotFound', `no machine named ${name}`)
    return m.platform === 'ssh' ? lfs.machine.disconnect(name) : lfs.machine.remove(name)
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
