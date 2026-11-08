// One simulated LayerFS home: its machines, Stores, buckets, projects (with
// their Branches, Commits and files) and Sandboxes, and a handler for each
// call of the table the simulator covers (HANDLERS). Answers and refusals
// have the shapes and codes the real library gives (recorded from LayerFS
// 2.0.0); states are the SDK's words (src/renderer/src/data/states.ts) and
// work in flight shows as an `op` with its phase, as the real one does.
//
// The world is one JSON file, <home>/sim-world.json, written after every
// change: a host restart keeps it, and an op that was in flight at the restart
// is dropped (its entity stays as it was before the op). A missing file is
// made from a preset (seed.js; LAYERFS_SIM_PRESET, default `mac`).
// LAYERFS_SIM_SPEED scales every simulated delay (1 = as written, 0 = none).
// Its platform table keeps LayerFS's ssh and Firecracker rows and calls, as the
// real library has them; Connect's host turns them off (host/machines.js OFF).
//
// Not simulated yet (refused Unsupported): workspace.exec, file.blame,
// file.diff, file.apply. A Workspace mounts its Branch but nothing changes it.
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PRESETS, seedWorld } from './seed.js'

export { PRESETS }

/** A refused call: the real package's error (api/node/src/errors.js). */
export class LayerFSError extends Error {
  constructor(code, message, detail) {
    super(message)
    this.name = 'LayerFSError'
    this.code = code
    this.detail = detail ?? null
  }
}

const refuse = (code, message, detail = null) => new LayerFSError(code, message, detail)

const FILE = 'sim-world.json'
const VERSION = 1
/** project.init limits: the simulator keeps every file in memory. */
const INIT_FILES = 5000
const INIT_BYTES = 64 * 1024 * 1024
/** Lines per file.read window. */
const READ_LINES = 5000
const MiB = 1024 * 1024
const DIR_MODE = 0o755
const FILE_MODE = 0o644
const DEFAULT_MESSAGE = 'Apply filesystem changes'

const hex = (bytes) => randomBytes(bytes).toString('hex')
const commitId = () => `12${hex(33)}`
const layerId = () => `32${hex(33)}`
const branchId = () => `11${hex(16)}`
const rootId = () => hex(32)
const now = () => Date.now()
const clone = (value) => (value === undefined ? undefined : structuredClone(value))

/** The speed every delay is multiplied by. */
const speedOf = () => {
  const v = Number(process.env.LAYERFS_SIM_SPEED ?? 1)
  return Number.isFinite(v) && v >= 0 ? v : 1
}

// ---------- paths and trees ----------
// A tree is { [path]: { type: 'file' | 'dir', blob?, mode, inode } }; `/` is implied.

function checkPath(path) {
  if (typeof path !== 'string' || !path.startsWith('/') || path.includes('\0') || path.split('/').includes('..')) throw refuse('InvalidInput', `${JSON.stringify(path)} is not an absolute path`)
  return path.length > 1 ? path.replace(/\/+$/, '') : path
}
const parentOf = (path) => path.slice(0, path.lastIndexOf('/')) || '/'
const baseName = (path) => path.slice(path.lastIndexOf('/') + 1)
const ROOT_NODE = { type: 'dir', mode: DIR_MODE, inode: 1 }
const nodeAt = (tree, path) => (path === '/' ? ROOT_NODE : tree[path])
const childrenOf = (tree, dir) => Object.keys(tree).filter((p) => p !== dir && parentOf(p) === dir).sort()
const under = (tree, dir) => Object.keys(tree).filter((p) => dir === '/' || p === dir || p.startsWith(`${dir}/`))

/** A glob as a RegExp: `**` any folders, `*` within one name, `?` one character. */
function globRegex(pattern) {
  let out = ''
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]
    if (c === '*' && pattern[i + 1] === '*') {
      out += pattern[i + 2] === '/' ? '(?:.*/)?' : '.*'
      i += pattern[i + 2] === '/' ? 2 : 1
    } else if (c === '*') out += '[^/]*'
    else if (c === '?') out += '[^/]'
    else out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${out}$`)
}

/** Pages of `items`: `{ items, has_more, next_page_pos }`. */
function paged(items, { page_size = 1000, page_pos = 0 } = {}, extra = {}) {
  const pos = Math.max(0, Number(page_pos) || 0)
  const size = Math.max(1, Math.min(1000, Number(page_size) || 1000))
  const slice = items.slice(pos, pos + size)
  const more = pos + size < items.length
  return { ...extra, items: slice, has_more: more, next_page_pos: more ? pos + size : null }
}

// ---------- the world ----------

const worlds = new Map()

/** The world of `home`, opened once per process. */
export function worldOf(home) {
  if (!home) throw refuse('InvalidInput', 'the simulator needs a home folder (LAYERFS_HOME)')
  let world = worlds.get(home)
  if (!world) {
    world = World.open(home)
    worlds.set(home, world)
  }
  return world
}

/** Writes every open world now. */
export function closeWorlds() {
  for (const world of worlds.values()) world.flush()
}

export class World {
  constructor(file, data) {
    this.file = file
    this.data = data
    this.timer = null
  }

  static open(home) {
    mkdirSync(home, { recursive: true, mode: 0o700 })
    const file = join(home, FILE)
    let data = null
    if (existsSync(file)) {
      try {
        data = JSON.parse(readFileSync(file, 'utf8'))
        if (data?.version !== VERSION) data = null
      } catch {
        data = null
      }
    }
    const world = new World(file, data ?? { version: VERSION })
    if (data) world.settle()
    else world.seed(process.env.LAYERFS_SIM_PRESET || 'mac')
    return world
  }

  /** A fresh world from `preset`. */
  seed(preset) {
    if (!PRESETS[preset]) throw refuse('InvalidInput', `no simulated world named ${preset} (${Object.keys(PRESETS).join(', ')})`)
    this.data = { version: VERSION, preset, created: now(), machines: {}, stores: {}, buckets: {}, projects: {}, sandboxes: {}, blobs: {} }
    seedWorld(this, preset)
    this.flush()
  }

  /** Replaces the world with `preset`'s (the current one's when not named). */
  reset(preset = this.data.preset) {
    this.seed(preset)
    return this.info()
  }

  info() {
    const d = this.data
    return { preset: d.preset, presets: Object.entries(PRESETS).map(([name, p]) => ({ name, label: p.label, description: p.description })), speed: speedOf(), file: this.file, machines: Object.keys(d.machines).length, stores: Object.keys(d.stores).length, projects: Object.keys(d.projects).length }
  }

  /** Drops ops a restart interrupted: each entity stays as it was before its op. */
  settle() {
    const d = this.data
    for (const group of [d.machines, d.stores, d.sandboxes]) {
      for (const [name, rec] of Object.entries(group)) {
        if (!rec.op) continue
        if (rec.op.name === 'machine.create' || rec.op.name === 'machine.connect' || rec.op.name === 'sandbox.create') delete group[name]
        else rec.op = null
      }
    }
    for (const m of Object.values(d.machines)) if (m.state === 'creating' || m.state === 'removing') m.state = 'stopped'
    for (const s of Object.values(d.sandboxes)) if (s.state === 'creating' || s.state === 'closing') s.state = 'running'
  }

  save() {
    if (this.timer) return
    this.timer = setTimeout(() => this.flush(), 150)
    this.timer.unref?.()
  }

  flush() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    writeFileSync(`${this.file}.tmp`, JSON.stringify(this.data), { mode: 0o600 })
    renameSync(`${this.file}.tmp`, this.file)
  }

  wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms * speedOf()))
  }

  /** Runs `name`'s handler; answers a copy, so a caller never holds the world's records. */
  async call(name, args, on) {
    const handler = HANDLERS[name]
    if (!handler) throw refuse('Unsupported', `${name} is not simulated yet: switch Connect to Real LayerFS for it`, { call: name })
    const answer = await handler(this, args, on ?? {})
    this.save()
    return clone(answer)
  }

  // ---------- blobs ----------

  putBlob(bytes) {
    const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(String(bytes), 'utf8')
    const hash = createHash('sha256').update(buf).digest('hex')
    this.data.blobs[hash] ??= { size: buf.length, data: buf.toString('base64') }
    return hash
  }

  blob(hash) {
    const b = this.data.blobs[hash]
    return b ? Buffer.from(b.data, 'base64') : Buffer.alloc(0)
  }

  sizeOf(node) {
    return node?.type === 'file' ? (this.data.blobs[node.blob]?.size ?? 0) : 0
  }

  // ---------- records ----------

  machine(name) {
    const m = this.data.machines[name]
    if (!m) throw refuse('NotFound', `no machine named ${name}`)
    return m
  }

  store(name) {
    const s = this.data.stores[name]
    if (!s) throw refuse('NotFound', `no Store named ${name}`)
    return s
  }

  project(key) {
    const p = this.data.projects[key]
    if (!p) throw refuse('NoSuchProject', `no project ${key}`)
    return p
  }

  sandbox(name) {
    const s = this.data.sandboxes[name]
    if (!s) throw refuse('NoSuchSandbox', `no Sandbox named ${name}; \`sandbox.create(project, name, machine)\` starts one`)
    return s
  }

  bucket(name) {
    const b = this.data.buckets[name]
    if (!b) throw refuse('NotFound', `no bucket named ${name}`)
    return b
  }

  isUp(m) {
    return !!m && (m.state === 'running' || m.state === 'ready')
  }

  projectsOf(store) {
    return Object.values(this.data.projects).filter((p) => p.store === store)
  }

  sandboxesOf(filter) {
    return Object.values(this.data.sandboxes).filter(filter)
  }

  /** A Store's state, as store.list and store.status derive it. */
  storeState(s) {
    if (s.op) return 'busy'
    if (s.kind === 'sqlite' && !this.isUp(this.data.machines[s.machine])) return 'down'
    if (this.storeSandboxes(s.name).some((b) => b.state === 'running')) return 'in_use'
    return 'idle'
  }

  storeSandboxes(store) {
    return this.sandboxesOf((b) => b.project?.startsWith(`${store}/`))
  }

  /** The Store bytes a Store's file would hold: a base, and every file it keeps. */
  storeBytes(s) {
    const seen = new Set()
    let bytes = 212_992
    for (const p of this.projectsOf(s.name)) {
      for (const tree of [...Object.values(p.layers).map((l) => l.tree), ...Object.values(p.commits).map((c) => c.tree)]) {
        for (const node of Object.values(tree)) {
          if (node.type === 'file' && !seen.has(node.blob)) {
            seen.add(node.blob)
            bytes += this.sizeOf(node) + 96
          }
        }
        bytes += 64 * Object.keys(tree).length
      }
    }
    return Math.ceil(bytes / 4096) * 4096
  }

  /** Refuses a Store call while the Store is busy or down, as the real Store does. */
  usable(storeName) {
    const s = this.store(storeName)
    if (s.op) throw refuse('Busy', `store ${s.name} is busy: ${s.op.name} (${s.op.phase}) holds it`, { entity: { kind: 'store', name: s.name }, phase: s.op.phase, op: s.op.id })
    if (s.kind === 'sqlite') {
      const m = this.data.machines[s.machine]
      if (!this.isUp(m)) throw refuse('Unavailable', `store ${s.name} is down: machine ${s.machine} is ${m?.state ?? 'missing'}; start it with \`layerfs machine start ${s.machine}\``, { entity: { kind: 'store', name: s.name } })
    }
    return s
  }

  /** A project's record for a call that reads or writes its Store. */
  projectData(key) {
    const p = this.project(key)
    this.usable(p.store)
    return p
  }

  /** Runs `phases` ([{ phase, ms, bytes? }]) as `rec`'s op, telling `on_progress` each step. */
  async runOp(kind, rec, name, phases, on_progress) {
    if (rec.op) throw refuse('Busy', `${kind} ${rec.name} is busy: ${rec.op.name} (${rec.op.phase}) holds it`, { entity: { kind, name: rec.name }, phase: rec.op.phase, op: rec.op.id })
    rec.op = { id: randomUUID(), name, phase: phases[0]?.phase ?? '', started: now(), uncertain: false }
    this.save()
    try {
      for (const step of phases) {
        rec.op.phase = step.phase
        this.save()
        if (step.bytes) {
          const total = step.bytes
          const steps = Math.max(1, Math.min(12, Math.ceil(total / (8 * MiB))))
          for (let i = 1; i <= steps; i++) {
            await this.wait(step.ms / steps)
            on_progress?.({ phase: step.phase, done: Math.min(total, Math.round((total * i) / steps)), total })
          }
        } else {
          on_progress?.({ phase: step.phase, done: null, total: null })
          await this.wait(step.ms)
        }
        if (step.fail) throw step.fail
      }
    } finally {
      rec.op = null
      this.save()
    }
  }

  // ---------- views ----------

  machineView(m) {
    const d = this.data
    const out = {
      name: m.name,
      platform: m.platform,
      backend: m.backend,
      supports: { sqlite: true, postgresql_sandbox: true, reason: null },
      state: m.state,
      cpus: m.cpus ?? null,
      memory: m.memory ?? null,
      disk: m.disk ?? null,
      stores: Object.values(d.stores).filter((s) => s.kind === 'sqlite' && s.machine === m.name).map((s) => s.name).sort(),
      sandboxes: Object.values(d.sandboxes).filter((b) => b.machine === m.name).map((b) => b.name).sort(),
    }
    for (const key of ['image', 'host', 'nested', 'docker', 'wsl', 'error', 'ssh']) if (m[key] !== undefined && m[key] !== null) out[key] = m[key]
    return out
  }

  storeRecord(s) {
    const out = { name: s.name, kind: s.kind, machine: s.kind === 'sqlite' ? s.machine : null, profile: s.profile ?? 'disposable', created: s.created }
    if (s.kind === 'sqlite') out.sqlite = '3.53.2'
    if (s.kind === 'postgresql') Object.assign(out, { url: s.url, password: s.password, ...(s.synchronous_commit ? { synchronous_commit: s.synchronous_commit } : {}) })
    out.projects = this.projectsOf(s.name).map((p) => p.name).sort()
    if (Object.keys(s.backups ?? {}).length) out.backups = s.backups
    if (s.op) out.op = s.op
    return out
  }

  projectRecord(p) {
    const s = this.data.stores[p.store]
    return { project: p.key, store: p.store, name: p.name, kind: s?.kind ?? 'sqlite', machine: s?.kind === 'sqlite' ? s.machine : null, created: p.created }
  }

  sandboxView(b) {
    const m = this.data.machines[b.machine]
    const state = b.state === 'running' && !this.isUp(m) ? 'gone' : b.state
    return { name: b.name, project: b.project, machine: b.machine, state, backend: b.backend, route: b.route, image: b.image ?? null, runtime: b.runtime ?? null, op: b.op ?? null }
  }

  // ---------- projects, Branches, Commits ----------

  /** A new project record with `tree` as its first Layer. */
  addProject(storeName, name, tree, created = now()) {
    const key = `${storeName}/${name}`
    const layer = layerId()
    const p = { key, store: storeName, name, created, inode: 2, layers: { [layer]: { tree, root: rootId(), parent: null, created } }, branches: { main: { name: 'main', id: null, base: layer, head: null } }, commits: {} }
    for (const node of Object.values(tree)) p.inode = Math.max(p.inode, (node.inode ?? 0) + 1)
    this.data.projects[key] = p
    this.touch(storeName)
    return p
  }

  /** A tree from `files` ({ path: text | Buffer }) and `dirs`; folders are made for every parent. */
  treeOf(p, files, dirs = []) {
    const tree = {}
    const dir = (path) => {
      if (path === '/' || tree[path]) return
      dir(parentOf(path))
      tree[path] = { type: 'dir', mode: DIR_MODE, inode: p.inode++ }
    }
    for (const d of dirs) dir(checkPath(d))
    for (const [path, content] of Object.entries(files)) {
      const at = checkPath(path)
      dir(parentOf(at))
      tree[at] = { type: 'file', blob: this.putBlob(content), mode: FILE_MODE, inode: p.inode++ }
    }
    return tree
  }

  branch(p, name) {
    const b = p.branches[name]
    if (!b) throw refuse('NoSuchBranch', `Branch ${name} does not exist`)
    return b
  }

  /** The tree a Branch (or one of its Commits) shows, with its snapshot label and root. */
  snapshot(p, branchName, commit = null) {
    const b = this.branch(p, branchName)
    if (commit) {
      const c = p.commits[commit] ?? (p.layers[commit] ? { tree: p.layers[commit].tree, root: p.layers[commit].root } : null)
      if (!c) throw refuse('NoSuchCommit', `no Commit ${commit} in ${p.key}`)
      return { tree: c.tree, label: `${branchName}@${commit.slice(2, 14)}`, root: c.root }
    }
    const at = b.head ?? b.base
    const source = b.head ? p.commits[b.head] : p.layers[b.base]
    return { tree: source.tree, label: `${branchName}@${at.slice(2, 14)}`, root: source.root }
  }

  /** Commits `tree` on side Branch `branchName`: `{ kind: 'Committed', branch, head, commit }`. */
  commitTree(p, branchName, tree, message, { via = 'fs', time = now(), second = null } = {}) {
    if (branchName === 'main') throw refuse('ReadOnly', 'main changes only through publish')
    const b = this.branch(p, branchName)
    const before = this.snapshot(p, branchName).tree
    const changed = diffTrees(before, tree).length
    const logical = Object.values(tree).reduce((n, node) => n + this.sizeOf(node), 0)
    const id = commitId()
    const record = { id, branch: branchName, parent: b.head, second_parent: second, base: b.base, root: rootId(), via, message: message || DEFAULT_MESSAGE, merged_from: null, time, logical, new_canonical: 600 + 90 * changed, new_stored: 300 + 30 * changed, new_metadata: 250 + 40 * changed, displaced: null, lww: [], lww_truncated: false }
    p.commits[id] = { ...record, tree }
    b.head = id
    this.touch(p.store)
    return { kind: 'Committed', branch: branchName, head: id, commit: record }
  }

  /** Marks a Store changed (its backups' state reads it). */
  touch(storeName) {
    const s = this.data.stores[storeName]
    if (s) s.changed = now()
  }

  commitRecord(c) {
    const { tree, ...record } = c
    return record
  }

  /** A Branch's Commits, newest first, following parents (into the Branch it was forked from, as commit.list does). */
  chain(p, b) {
    const out = []
    for (let id = b.head; id && p.commits[id]; id = p.commits[id].parent) out.push({ ...this.commitRecord(p.commits[id]), branch: b.name })
    return out
  }

  /** One change to a side Branch's tree: `edit(tree)` changes a copy, then it is committed. */
  change(args, edit) {
    const p = this.projectData(args.project)
    if (args.branch === 'main') throw refuse('ReadOnly', 'main changes only through publish')
    const tree = { ...this.snapshot(p, args.branch).tree }
    edit(tree, p)
    return this.commitTree(p, args.branch, tree, args.message)
  }

  doctor() {
    const d = this.data
    const findings = []
    for (const m of Object.values(d.machines)) {
      if (m.state === 'failed') findings.push({ severity: 'error', entity: { kind: 'machine', name: m.name }, message: `machine ${m.name} failed${m.error ? `: ${m.error}` : ''}`, fix: `layerfs machine remove ${m.name}` })
      if (m.state === 'unresolved') findings.push({ severity: 'error', entity: { kind: 'machine', name: m.name }, message: `machine ${m.name} is unresolved: an operation on it did not finish`, fix: `layerfs machine ${m.platform === 'ssh' ? 'disconnect' : 'remove'} ${m.name}` })
    }
    for (const s of Object.values(d.stores)) {
      if (s.kind === 'sqlite' && !this.isUp(d.machines[s.machine])) findings.push({ severity: 'warning', entity: { kind: 'store', name: s.name }, message: `store ${s.name} is down: machine ${s.machine} is not running`, fix: `layerfs machine start ${s.machine}` })
    }
    for (const b of Object.values(d.sandboxes)) {
      if (b.state === 'unresolved') findings.push({ severity: 'error', entity: { kind: 'sandbox', name: b.name }, message: `sandbox ${b.name} is unresolved`, fix: `layerfs sandbox close ${b.name}` })
    }
    return { ok: !findings.some((f) => f.severity === 'error'), findings }
  }
}

/** The paths that differ between two trees: `{ path, kind, type, before, after, content, identity, metadata, hunks, hunks_omitted }`. */
function diffTrees(a, b) {
  const items = []
  for (const path of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
    const x = a[path]
    const y = b[path]
    if (x && y && x.type === y.type && x.blob === y.blob && x.mode === y.mode) continue
    const kind = !x ? 'Added' : !y ? 'Deleted' : 'Modified'
    const content = !!(x && y && x.blob !== y.blob)
    items.push({ path, kind, type: (y ?? x).type, before: x ? { type: x.type, inode: x.inode } : null, after: y ? { type: y.type, inode: y.inode } : null, content, identity: false, metadata: !!(x && y && (content || x.mode !== y.mode)), hunks: null, hunks_omitted: false })
  }
  return items
}

/** A host folder as files and folders, within the init limits. */
function readFolder(folder) {
  const files = {}
  const dirs = []
  let count = 0
  let bytes = 0
  const walk = (dir, at) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      const path = `${at === '/' ? '' : at}/${entry.name}`
      if (entry.isDirectory()) {
        dirs.push(path)
        walk(full, path)
      } else if (entry.isFile()) {
        const size = lstatSync(full).size
        count += 1
        bytes += size
        if (count > INIT_FILES || bytes > INIT_BYTES) throw refuse('Unsupported', `the simulator imports folders of at most ${INIT_FILES.toLocaleString('en-US')} files and ${INIT_BYTES / MiB} MB; ${folder} is larger`)
        files[path] = readFileSync(full)
      }
    }
  }
  walk(folder, '/')
  return { files, dirs, count, bytes }
}

const PLATFORMS = (() => {
  const vm = (platform, description, extra = []) => ({ platform, how: 'created', backend: 'namespaces', kernel: 'fuse', sqlite: 'worker', postgresql: { store_calls: 'in_process', sandbox: true, reason: null }, ready: true, missing: [], version: null, options: [{ name: 'cpus', kind: 'int' }, { name: 'memory', kind: 'size' }, { name: 'disk', kind: 'size' }, { name: 'image', kind: 'text' }, ...extra], description })
  return [
    { platform: 'native', how: 'built_in', backend: 'native', kernel: 'nfs', sqlite: 'in_process', postgresql: { store_calls: 'in_process', sandbox: true, reason: null }, ready: true, missing: [], version: null, options: [], description: 'this host; Sandboxes run as this user\'s processes, served over loopback NFS' },
    { platform: 'docker', how: 'built_in', backend: 'docker', kernel: 'fuse', sqlite: 'worker', postgresql: { store_calls: 'in_process', sandbox: true, reason: null }, ready: true, missing: [], version: '29.5.2', options: [], description: 'Docker\'s kernel (Docker Desktop\'s VM, or the Linux host); Sandboxes run in Docker containers' },
    { ...vm('apple-container', 'an Apple container VM (Apple silicon); Sandboxes run in Linux namespaces and a cgroup'), version: 'container CLI version 1.6.1' },
    { ...vm('microsandbox', 'a microsandbox microVM (libkrun); Sandboxes run in Linux namespaces and a cgroup'), version: 'msb 0.7.11' },
    { ...vm('lima', 'a Lima VM (vz); Sandboxes run in Linux namespaces and a cgroup', [{ name: 'nested', kind: 'bool' }]), version: 'limactl version 2.2.1' },
    { ...vm('firecracker', 'a Firecracker microVM in a nested lima machine; Sandboxes run in Linux namespaces and a cgroup', [{ name: 'host', kind: 'name' }]), version: 'limactl version 2.2.1' },
    { platform: 'ssh', how: 'connected', backend: 'namespaces', kernel: 'fuse', sqlite: 'worker', postgresql: { store_calls: 'in_process', sandbox: true, reason: null }, ready: true, missing: [], version: 'OpenSSH_10.2p1', options: [{ name: 'user', kind: 'text' }, { name: 'port', kind: 'int' }, { name: 'identity', kind: 'text' }, { name: 'known_hosts', kind: 'text' }, { name: 'root', kind: 'text' }], description: 'a Linux host over ssh; Sandboxes run in Linux namespaces and a cgroup' },
  ]
})()

const NAME = /^[a-z0-9][a-z0-9_-]{0,62}$/
function checkName(name, what) {
  if (typeof name !== 'string' || !NAME.test(name)) throw refuse('InvalidInput', `${what} name ${JSON.stringify(name)} must be lowercase letters, digits, - and _, starting with a letter or digit`)
}
function splitKey(key) {
  const at = String(key ?? '').indexOf('/')
  if (at <= 0) throw refuse('InvalidInput', `${JSON.stringify(key)} is not a project: write it as <store>/<project>`)
  return { store: key.slice(0, at), name: key.slice(at + 1) }
}

/** The world's state the Store's machine shows its running work by. */
const BUILT_IN = new Set(['native', 'docker'])

// ---------- handlers: (world, args, on) -> answer ----------

const HANDLERS = {
  // ----- machines -----
  'machine.list': (w) => ({ machines: Object.values(w.data.machines).sort((a, b) => a.name.localeCompare(b.name)).map((m) => w.machineView(m)) }),
  'machine.platforms': () => ({ host: 'macos', platforms: PLATFORMS }),
  'machine.get': (w, a) => {
    const m = w.machine(a.name)
    return { ...w.machineView(m), ...(m.daemon ? { daemon: m.daemon } : {}) }
  },
  'machine.status': (w, a) => {
    const m = w.machine(a.name)
    const up = w.isUp(m)
    return { name: m.name, platform: m.platform, state: m.state, free_disk: up ? (m.free_disk ?? 41_000_000_000) : null, tool_version: PLATFORMS.find((p) => p.platform === m.platform)?.version ?? null, down_reason: up ? null : m.state === 'failed' ? (m.error ?? 'the machine failed') : `the machine is ${m.state}`, stores: w.machineView(m).stores, op: m.op ?? null }
  },
  'machine.start': async (w, a) => {
    const m = w.machine(a.name)
    if (m.platform === 'native' || m.state === 'running') return { name: m.name, state: m.state }
    if (m.state !== 'stopped') throw refuse('Unavailable', `machine ${m.name} is ${m.state}; it does not start from there (see \`layerfs machine status ${m.name}\`)`, { entity: { kind: 'machine', name: m.name } })
    await w.runOp('machine', m, 'machine.start', [{ phase: 'boot', ms: 2500 }, { phase: 'worker', ms: 1000 }])
    m.state = 'running'
    return { name: m.name, state: m.state }
  },
  'machine.stop': async (w, a) => {
    const m = w.machine(a.name)
    if (m.platform === 'native') throw refuse('Unsupported', 'native is this host: it does not stop')
    if (m.state === 'stopped') return { name: m.name, state: m.state }
    const running = w.sandboxesOf((b) => b.machine === m.name && b.state === 'running')
    if (running.length) throw refuse('InUse', `machine ${m.name} runs Sandboxes ${running.map((b) => b.name).join(', ')}; close them first`, { entity: { kind: 'machine', name: m.name }, related: running.map((b) => ({ kind: 'sandbox', name: b.name })) })
    await w.runOp('machine', m, 'machine.stop', [{ phase: 'stop', ms: 1500 }])
    m.state = 'stopped'
    return { name: m.name, state: m.state }
  },
  'machine.create': async (w, a) => {
    checkName(a.name, 'A machine')
    if (w.data.machines[a.name]) throw refuse('Exists', `a machine named ${a.name} exists`)
    const platform = PLATFORMS.find((p) => p.platform === a.platform)
    if (!platform) throw refuse('InvalidInput', `no platform named ${a.platform}`)
    if (platform.how !== 'created') throw refuse('Unsupported', `${a.platform} machines are ${platform.how === 'connected' ? 'connected, not created' : 'built in'}`)
    const m = { name: a.name, platform: a.platform, backend: platform.backend, state: 'creating', cpus: a.cpus ?? 2, memory: a.memory ?? 4 * 1024 ** 3, disk: a.disk ?? 32 * 1024 ** 3, image: a.image ?? null, host: a.host ?? null, nested: a.nested ?? null, created: now(), op: null }
    w.data.machines[a.name] = m
    try {
      await w.runOp('machine', m, 'machine.create', [{ phase: 'provision', ms: 3000 }, { phase: 'boot', ms: 2000 }, { phase: 'worker', ms: 800 }])
    } catch (error) {
      delete w.data.machines[a.name]
      throw error
    }
    m.state = 'running'
    return w.machineView(m)
  },
  'machine.connect': async (w, a) => {
    checkName(a.name, 'A machine')
    if (w.data.machines[a.name]) throw refuse('Exists', `a machine named ${a.name} exists`)
    const m = { name: a.name, platform: 'ssh', backend: 'namespaces', state: 'creating', cpus: null, memory: null, disk: null, host: a.host, ssh: { host: a.host, user: a.user ?? 'root', port: a.port ?? 22, identity: a.identity ?? null, root: a.root ?? null }, created: now(), op: null }
    w.data.machines[a.name] = m
    try {
      await w.runOp('machine', m, 'machine.connect', [{ phase: 'connect', ms: 1200 }, { phase: 'worker', ms: 800 }])
    } catch (error) {
      delete w.data.machines[a.name]
      throw error
    }
    m.state = 'running'
    return w.machineView(m)
  },
  'machine.remove': async (w, a) => removeMachine(w, a.name, 'machine.remove'),
  'machine.disconnect': async (w, a) => removeMachine(w, a.name, 'machine.disconnect'),
  'machine.update': (w, a) => {
    const m = w.machine(a.name)
    for (const key of ['cpus', 'memory', 'image', 'docker', 'wsl', 'daemon']) if (a[key] !== undefined) m[key] = a[key]
    return w.machineView(m)
  },

  // ----- Stores -----
  'store.list': (w) => ({ items: Object.values(w.data.stores).sort((a, b) => a.name.localeCompare(b.name)).map((s) => ({ ...w.storeRecord(s), state: w.storeState(s) })) }),
  'store.get': (w, a) => w.storeRecord(w.store(a.name)),
  'store.status': (w, a) => {
    const s = w.store(a.name)
    const state = w.storeState(s)
    const holders = w.storeSandboxes(s.name).filter((b) => b.state === 'running').map((b) => ({ kind: 'sandbox', name: b.name }))
    if (s.kind === 'postgresql') return { name: s.name, kind: s.kind, state, holders, op: s.op ?? null, down_reason: null, server: { reachable: s.reachable !== false, serverVersion: '16.4', latencyMs: 3, ...(s.reachable === false ? { unavailable: 'connection refused' } : {}) } }
    const m = w.data.machines[s.machine]
    return { name: s.name, kind: s.kind, state, holders, op: s.op ?? null, down_reason: state === 'down' ? `machine ${s.machine} is ${m?.state ?? 'missing'}` : null, machine: s.machine, file: { exists: true, free: 378_000_000_000, bytes: w.storeBytes(s), wal_bytes: 0 } }
  },
  'store.create': (w, a) => {
    checkName(a.name, 'A Store')
    if (w.data.stores[a.name]) throw refuse('Exists', `a Store named ${a.name} exists`)
    const s = { name: a.name, kind: 'sqlite', machine: 'native', profile: 'disposable', created: now(), backups: {}, op: null }
    w.data.stores[a.name] = s
    return w.storeRecord(s)
  },
  'store.connect': async (w, a) => {
    checkName(a.name, 'A Store')
    if (w.data.stores[a.name]) throw refuse('Exists', `a Store named ${a.name} exists`)
    if (!/^postgres(ql)?:\/\//.test(a.url)) throw refuse('InvalidInput', 'a PostgreSQL Store\'s URL is postgresql://user@host:port/database')
    await w.wait(600)
    const s = { name: a.name, kind: 'postgresql', machine: null, url: a.url, password: a.password ?? null, synchronous_commit: a.synchronous_commit ?? null, profile: 'durable', created: now(), backups: {}, op: null }
    w.data.stores[a.name] = s
    return w.storeRecord(s)
  },
  'store.push': async (w, a, on) => {
    const s = w.store(a.name)
    if (s.kind !== 'sqlite') throw refuse('Unsupported', `${s.name} is a PostgreSQL Store: it is never pushed`)
    if (s.machine !== 'native') throw refuse('InvalidInput', `store ${s.name} is on ${s.machine}: pull it to native first`)
    const m = w.machine(a.machine)
    if (m.name === 'native') throw refuse('InvalidInput', `store ${s.name} is on native already`)
    if (!w.isUp(m)) throw refuse('Unavailable', `store push, check: machine ${m.name} is not running; start it with \`layerfs machine start ${m.name}\``, { phase: 'check' })
    inUse(w, s, 'pushed')
    const bytes = w.storeBytes(s)
    await w.runOp('store', s, 'store.push', [{ phase: 'check', ms: 500 }, { phase: 'send', ms: 2500, bytes }, { phase: 'install', ms: 700 }, { phase: 'record', ms: 300 }], on.on_progress)
    s.machine = m.name
    return { store: s.name, machine: m.name, bytes }
  },
  'store.pull': async (w, a, on) => {
    const s = w.store(a.name)
    if (s.kind !== 'sqlite') throw refuse('Unsupported', `${s.name} is a PostgreSQL Store: it is never pulled`)
    if (s.machine === 'native') throw refuse('InvalidInput', `store ${s.name} is on native already`)
    const m = w.data.machines[s.machine]
    if (!w.isUp(m)) throw refuse('Unavailable', `store pull, check: machine ${s.machine} is not running; start it with \`layerfs machine start ${s.machine}\``, { phase: 'check' })
    inUse(w, s, 'pulled')
    const bytes = w.storeBytes(s)
    await w.runOp('store', s, 'store.pull', [{ phase: 'check', ms: 500 }, { phase: 'send', ms: 2500, bytes }, { phase: 'install', ms: 700 }, { phase: 'record', ms: 300 }], on.on_progress)
    s.machine = 'native'
    return { store: s.name, machine: 'native', bytes }
  },
  'store.remove': async (w, a) => {
    const s = w.store(a.name)
    const records = w.storeSandboxes(s.name)
    if (records.length) throw refuse('InUse', `store ${s.name} has Sandboxes ${records.map((b) => b.name).join(', ')}; close them first`, { entity: { kind: 'store', name: s.name }, related: records.map((b) => ({ kind: 'sandbox', name: b.name })) })
    await w.runOp('store', s, 'store.remove', [{ phase: 'remove', ms: 500 }])
    for (const p of w.projectsOf(s.name)) delete w.data.projects[p.key]
    delete w.data.stores[s.name]
    return { removed: s.name }
  },
  'store.disconnect': (w, a) => {
    const s = w.store(a.name)
    if (s.kind !== 'postgresql') throw refuse('InvalidInput', `store ${s.name} is a sqlite Store: remove it instead`)
    const records = w.storeSandboxes(s.name)
    if (records.length) throw refuse('InUse', `store ${s.name} has Sandboxes ${records.map((b) => b.name).join(', ')}; close them first`, { entity: { kind: 'store', name: s.name }, related: records.map((b) => ({ kind: 'sandbox', name: b.name })) })
    for (const p of w.projectsOf(s.name)) delete w.data.projects[p.key]
    delete w.data.stores[s.name]
    return { disconnected: s.name }
  },

  // ----- buckets and backups -----
  'backup.connect': async (w, a) => {
    checkName(a.name, 'A bucket')
    if (w.data.buckets[a.name]) throw refuse('Exists', `a bucket named ${a.name} exists`)
    await w.wait(500)
    w.data.buckets[a.name] = { name: a.name, url: a.url, key: a.key ?? null, region: a.region ?? null, files: {} }
    return { name: a.name, url: a.url }
  },
  'backup.disconnect': (w, a) => {
    w.bucket(a.name)
    const unlinked = []
    for (const s of Object.values(w.data.stores)) {
      if (s.backups?.[a.name]) {
        delete s.backups[a.name]
        unlinked.push(s.name)
      }
    }
    delete w.data.buckets[a.name]
    return { disconnected: a.name, unlinked }
  },
  'backup.list': async (w, a) => {
    const b = w.bucket(a.bucket)
    await w.wait(400)
    return {
      items: Object.entries(b.files).sort(([x], [y]) => x.localeCompare(y)).map(([file, f]) => {
        const s = w.data.stores[f.store]
        const linked = s?.backups?.[b.name]?.file === file
        const state = !s ? 'missing' : !linked ? 'unlinked' : (s.changed ?? 0) > f.modified ? 'store_changed' : 'current'
        return { bucket: b.name, file, store: f.store, state, bytes: f.bytes, modified: f.modified }
      }),
    }
  },
  'backup.create': async (w, a, on) => {
    const s = w.store(a.store)
    const b = w.bucket(a.bucket)
    const file = a.file ?? s.backups?.[b.name]?.file ?? s.name
    const bytes = w.storeBytes(s)
    await w.runOp('store', s, 'backup.create', [{ phase: 'snapshot', ms: 600 }, { phase: 'upload', ms: 2000, bytes }], on.on_progress)
    const at = now()
    b.files[file] = { store: s.name, bytes, modified: at, projects: w.projectsOf(s.name).map((p) => clone(p)) }
    s.backups ??= {}
    s.backups[b.name] = { file, last: { op: 'create', at, bytes } }
    return { store: s.name, bucket: b.name, file, bytes }
  },
  'backup.restore': async (w, a, on) => {
    if (w.data.stores[a.store]) throw refuse('Exists', `a Store named ${a.store} exists: restore installs a new Store`)
    checkName(a.store, 'A Store')
    const b = w.bucket(a.bucket)
    const file = a.file ?? a.store
    const f = b.files[file]
    if (!f) throw refuse('NotFound', `no file ${file} in bucket ${b.name}`)
    const s = { name: a.store, kind: 'sqlite', machine: 'native', profile: 'disposable', created: now(), backups: {}, op: null }
    w.data.stores[s.name] = s
    try {
      await w.runOp('store', s, 'backup.restore', [{ phase: 'download', ms: 2000, bytes: f.bytes }, { phase: 'install', ms: 700 }], on.on_progress)
    } catch (error) {
      delete w.data.stores[s.name]
      throw error
    }
    for (const p of f.projects) {
      const copy = clone(p)
      copy.store = s.name
      copy.key = `${s.name}/${p.name}`
      w.data.projects[copy.key] = copy
    }
    s.backups[b.name] = { file, last: { op: 'restore', at: now(), bytes: f.bytes } }
    return { store: s.name, bucket: b.name, file, bytes: f.bytes }
  },

  // ----- projects -----
  'project.init': async (w, a, on) => {
    const { store, name } = splitKey(a.project)
    checkName(name, 'A project')
    const s = w.usable(store)
    if (w.data.projects[a.project]) throw refuse('Exists', `project ${name} exists in Store ${store}`)
    let st = null
    try {
      st = lstatSync(a.folder)
    } catch {
      throw refuse('NotFound', `${a.folder} does not exist`)
    }
    if (!st.isDirectory()) throw refuse('InvalidInput', `${a.folder} is not a folder`)
    on.on_progress?.({ phase: 'check', done: null, total: null })
    const read = readFolder(a.folder)
    await w.wait(300 + Math.min(3000, read.count * 2))
    on.on_progress?.({ phase: 'install', done: null, total: null })
    await w.wait(400)
    on.on_progress?.({ phase: 'record', done: null, total: null })
    const p = w.addProject(s.name, name, {})
    const layer = Object.keys(p.layers)[0]
    p.layers[layer].tree = w.treeOf(p, read.files, read.dirs)
    return { ...w.projectRecord(p), layer, root: p.layers[layer].root }
  },
  'project.list': (w, a) => {
    if (a.store) w.store(a.store)
    const items = Object.values(w.data.projects).filter((p) => !a.store || p.store === a.store).sort((x, y) => x.key.localeCompare(y.key)).map((p) => w.projectRecord(p))
    const { has_more, ...page } = paged(items, a)
    return page
  },
  'project.get': (w, a) => w.projectRecord(w.project(a.project)),
  'project.remove': (w, a) => {
    const p = w.project(a.project)
    if (w.data.stores[p.store]?.kind === 'postgresql') throw refuse('Unsupported', `${p.key} is in a PostgreSQL Store: remove it on its server`)
    const records = w.sandboxesOf((b) => b.project === p.key)
    if (records.length) throw refuse('InUse', `project ${p.key} has Sandboxes ${records.map((b) => b.name).join(', ')}; close them first`, { entity: { kind: 'project', name: p.key }, related: records.map((b) => ({ kind: 'sandbox', name: b.name })) })
    delete w.data.projects[p.key]
    w.touch(p.store)
    return { removed: p.key }
  },

  // ----- Branches -----
  'branch.list': (w, a) => {
    const p = w.projectData(a.project)
    return paged(Object.values(p.branches).sort((x, y) => x.name.localeCompare(y.name)).map((b) => ({ ...b })), a)
  },
  'branch.get': (w, a) => ({ ...w.branch(w.projectData(a.project), a.branch) }),
  'branch.fork': (w, a) => {
    const p = w.projectData(a.project)
    checkName(a.name, 'A Branch')
    if (p.branches[a.name]) throw refuse('NameTaken', `Branch ${a.name} already exists`)
    const from = w.branch(p, a.from_branch ?? 'main')
    let head = from.head
    if (a.from_commit) {
      if (!p.commits[a.from_commit]) throw refuse('NoSuchCommit', `no Commit ${a.from_commit} in ${p.key}`)
      head = a.from_commit
    }
    p.branches[a.name] = { name: a.name, id: branchId(), base: from.base, head, forked_from: head ?? from.base }
    w.touch(p.store)
    return { kind: 'Forked', branch: a.name, base: from.base, head }
  },
  'branch.merge': (w, a) => {
    const p = w.projectData(a.project)
    checkName(a.name, 'A Branch')
    if (p.branches[a.name]) throw refuse('NameTaken', `Branch ${a.name} already exists`)
    const left = w.branch(p, a.a)
    const right = w.branch(p, a.b)
    const base = p.layers[left.base].tree
    const ta = w.snapshot(p, left.name).tree
    const tb = w.snapshot(p, right.name).tree
    // three-way by path: a side's change wins over the base; both changing a path differently is a conflict
    const merged = { ...ta }
    const conflicts = []
    for (const change of diffTrees(base, tb)) {
      const mine = ta[change.path]
      const theirs = tb[change.path]
      const changedHere = JSON.stringify(mine ?? null) !== JSON.stringify(base[change.path] ?? null)
      if (changedHere && JSON.stringify(mine ?? null) !== JSON.stringify(theirs ?? null)) conflicts.push({ path: change.path, kind: 'content' })
      else if (theirs) merged[change.path] = theirs
      else delete merged[change.path]
    }
    if (conflicts.length) throw refuse('Conflict', `merging ${right.name} into ${left.name} conflicts on ${conflicts.map((c) => c.path).join(', ')}`, { conflicts })
    p.branches[a.name] = { name: a.name, id: branchId(), base: left.base, head: left.head, forked_from: left.head ?? left.base }
    const done = w.commitTree(p, a.name, merged, a.message ?? `Merge ${right.name} into ${left.name}`, { via: 'merge', second: right.head })
    return { kind: 'Merged', fast_forward: false, branch: a.name, head: done.head, root: done.commit.root, sources: [{ ref: left.name, node: left.head ?? left.base }, { ref: right.name, node: right.head ?? right.base }], merge_base: left.base, conflicts: [], lww: [], conflicts_truncated: false, lww_truncated: false, units: [], units_truncated: false }
  },
  'branch.publish': (w, a) => {
    const p = w.projectData(a.project)
    if (a.branch === 'main') throw refuse('InvalidInput', 'main is published already: publish a side Branch')
    const b = w.branch(p, a.branch)
    const commit = a.commit ?? b.head
    if (!commit) throw refuse('InvalidInput', `Branch ${b.name} has no Commit to publish`)
    const c = p.commits[commit]
    if (!c) throw refuse('NoSuchCommit', `no Commit ${commit} in ${p.key}`)
    const main = p.branches.main
    const id = layerId()
    p.layers[id] = { tree: c.tree, root: c.root, parent: main.base, created: now() }
    const based = main.base
    main.base = id
    w.touch(p.store)
    const logical = Object.values(c.tree).reduce((n, node) => n + w.sizeOf(node), 0)
    return { kind: 'Added', source: { branch: b.name, commit }, published_layer: { overwrote_count: 0, logical, id, parent: based, root: c.root, source_branch: b.name, source_commit: commit }, based_on: based, overwrote_count: 0, overwrote: [], overwrote_has_more: false }
  },
  'branch.diff': (w, a) => {
    const p = w.projectData(a.project)
    const from = w.snapshot(p, a.from_branch)
    const to = w.snapshot(p, a.to_branch)
    return { kind: 'ok', from: { ref: a.from_branch, label: from.label, root: from.root }, to: { ref: a.to_branch, label: to.label, root: to.root }, ...paged(diffTrees(from.tree, to.tree), a), next_cursor: null }
  },

  // ----- Commits -----
  'commit.list': (w, a) => {
    const p = w.projectData(a.project)
    // main is a chain of Layers, not a Branch
    if (a.branch === 'main') throw refuse('NoSuchBranch', 'Branch main does not exist')
    return paged(w.chain(p, w.branch(p, a.branch)), a)
  },
  'commit.get': (w, a) => {
    const p = w.projectData(a.project)
    w.branch(p, a.branch)
    const c = p.commits[a.commit]
    if (!c) throw refuse('NoSuchCommit', `no Commit ${a.commit} in ${p.key}`)
    return { ...w.commitRecord(c), branch: a.branch }
  },
  'commit.diff': (w, a) => {
    const p = w.projectData(a.project)
    const tree = (id) => p.commits[id] ?? (p.layers[id] ? { tree: p.layers[id].tree, root: p.layers[id].root } : null)
    const from = tree(a.from_commit)
    const to = tree(a.to_commit)
    if (!from) throw refuse('NoSuchCommit', `no Commit ${a.from_commit} in ${p.key}`)
    if (!to) throw refuse('NoSuchCommit', `no Commit ${a.to_commit} in ${p.key}`)
    return { kind: 'ok', from: { commit: a.from_commit, root: from.root }, to: { commit: a.to_commit, root: to.root }, ...paged(diffTrees(from.tree, to.tree), a), next_cursor: null }
  },

  // ----- files -----
  'file.list': (w, a) => {
    const p = w.projectData(a.project)
    const snap = w.snapshot(p, a.branch, a.commit)
    const path = checkPath(a.path)
    const node = nodeAt(snap.tree, path)
    if (!node) throw refuse('NoSuchPath', `${path} does not exist at ${snap.label}`, { path })
    if (node.type !== 'dir') throw refuse('NotDirectory', 'expected a directory')
    const items = childrenOf(snap.tree, path).map((child) => ({ name: baseName(child), path: child, type: snap.tree[child].type, inode: snap.tree[child].inode }))
    return { kind: 'ok', snapshot: snap.label, root: snap.root, path, ...paged(items, a) }
  },
  'file.stat': (w, a) => {
    const p = w.projectData(a.project)
    const snap = w.snapshot(p, a.branch, a.commit)
    const path = checkPath(a.path)
    const node = nodeAt(snap.tree, path)
    if (!node) throw refuse('NoSuchPath', `${path} does not exist at ${snap.label}`, { path })
    return { kind: 'ok', snapshot: snap.label, root: snap.root, path, type: node.type, inode: node.inode, size: w.sizeOf(node), mode: node.mode }
  },
  'file.read': (w, a) => {
    const p = w.projectData(a.project)
    const snap = w.snapshot(p, a.branch, a.commit)
    const path = checkPath(a.path)
    const node = nodeAt(snap.tree, path)
    if (!node) throw refuse('NoSuchPath', `${path} does not exist at ${snap.label}`, { path })
    if (node.type === 'dir') throw refuse('IsDirectory', `${path} is a directory`)
    const bytes = w.blob(node.blob)
    const text = bytes.toString('utf8')
    if (bytes.includes(0) || Buffer.from(text, 'utf8').compare(bytes) !== 0) throw refuse('Binary', 'text contains NUL or invalid UTF-8')
    const lines = text.match(/[^\n]*\n|[^\n]+$/g) ?? []
    const start = Math.max(1, Number(a.start_line) || 1)
    const end = Math.min(lines.length, a.end_line ? Number(a.end_line) : start + READ_LINES - 1)
    const window = lines.slice(start - 1, end)
    const next = end < lines.length && !a.end_line ? end + 1 : null
    return { kind: 'ok', snapshot: snap.label, root: snap.root, path, text: window.join(''), start_line: start, end_line: end, line_truncated: false, truncated: next !== null, next_line: next, size: bytes.length }
  },
  'file.glob': (w, a) => {
    const p = w.projectData(a.project)
    const snap = w.snapshot(p, a.branch, a.commit)
    const path = checkPath(a.path)
    const re = globRegex(a.pattern)
    const items = under(snap.tree, path).filter((at) => snap.tree[at].type === 'file' && re.test(path === '/' ? at.slice(1) : at.slice(path.length + 1))).sort()
    return { kind: 'ok', snapshot: snap.label, root: snap.root, path, ...paged(items, a) }
  },
  'file.grep': (w, a) => {
    const p = w.projectData(a.project)
    const snap = w.snapshot(p, a.branch, a.commit)
    const path = checkPath(a.path)
    let re
    try {
      re = new RegExp(a.pattern)
    } catch {
      throw refuse('InvalidInput', `${JSON.stringify(a.pattern)} is not a regular expression`)
    }
    const items = []
    let skipped = 0
    for (const at of under(snap.tree, path).sort()) {
      const node = snap.tree[at]
      if (node.type !== 'file') continue
      const bytes = w.blob(node.blob)
      if (bytes.includes(0)) {
        skipped += 1
        continue
      }
      ;(bytes.toString('utf8').match(/[^\n]*\n|[^\n]+$/g) ?? []).forEach((line, i) => {
        if (re.test(line)) items.push({ path: at, line: i + 1, text: line, line_truncated: false })
      })
    }
    return { kind: 'ok', snapshot: snap.label, root: snap.root, path, ...paged(items, a), skipped }
  },
  'file.write': (w, a) =>
    w.change(a, (tree, p) => {
      const path = checkPath(a.path)
      const parent = nodeAt(tree, parentOf(path))
      if (!parent || parent.type !== 'dir') throw refuse('NoSuchPath', 'Content(PathNotFound)', { index: 0 })
      if (tree[path]?.type === 'dir') throw refuse('IsDirectory', `${path} is a directory`)
      tree[path] = { type: 'file', blob: w.putBlob(a.content ?? ''), mode: a.mode ?? tree[path]?.mode ?? FILE_MODE, inode: tree[path]?.inode ?? p.inode++ }
    }),
  'file.edit': (w, a) =>
    w.change(a, (tree) => {
      const path = checkPath(a.path)
      const node = tree[path]
      if (!node) throw refuse('NoSuchPath', 'Content(PathNotFound)', { index: 0 })
      if (node.type !== 'file') throw refuse('IsDirectory', `${path} is a directory`)
      const text = w.blob(node.blob).toString('utf8')
      const old = String(a.old ?? '')
      const matches = old ? text.split(old).length - 1 : 0
      if (matches === 0) throw refuse('NoMatch', path, { matches: 0, index: 0 })
      if (matches > 1) throw refuse('AmbiguousMatch', path, { matches, index: 0 })
      tree[path] = { ...node, blob: w.putBlob(text.replace(old, () => String(a.new ?? ''))) }
    }),
  'file.rm': (w, a) =>
    w.change(a, (tree) => {
      const path = checkPath(a.path)
      if (path === '/' || !tree[path]) throw refuse('NoSuchPath', 'Content(PathNotFound)', { index: 0 })
      for (const at of under(tree, path)) delete tree[at]
    }),
  'file.mkdir': (w, a) =>
    w.change(a, (tree, p) => {
      const path = checkPath(a.path)
      if (nodeAt(tree, path)) throw refuse('Exists', `${path} exists`)
      const parent = nodeAt(tree, parentOf(path))
      if (!parent || parent.type !== 'dir') throw refuse('NoSuchPath', 'Content(PathNotFound)', { index: 0 })
      tree[path] = { type: 'dir', mode: a.mode ?? DIR_MODE, inode: p.inode++ }
    }),
  'file.mv': (w, a) => w.change(a, (tree, p) => moveOrCopy(tree, p, a, true)),
  'file.cp': (w, a) => w.change(a, (tree, p) => moveOrCopy(tree, p, a, false)),

  // ----- Sandboxes and Workspaces -----
  'sandbox.create': async (w, a) => {
    const p = w.project(a.project)
    checkName(a.name, 'A Sandbox')
    if (w.data.sandboxes[a.name]) throw refuse('Exists', `a Sandbox named ${a.name} exists`)
    const s = w.usable(p.store)
    const m = w.machine(a.machine)
    if (s.kind === 'sqlite' && m.name !== s.machine) throw refuse('Unsupported', `${p.key} is in sqlite Store ${s.name} on ${s.machine}: its Sandboxes run on ${s.machine}`)
    if (!w.isUp(m)) throw refuse('Unavailable', `machine ${m.name} is not running; start it with \`layerfs machine start ${m.name}\``, { entity: { kind: 'machine', name: m.name } })
    const b = { name: a.name, project: p.key, machine: m.name, state: 'creating', backend: m.backend, route: m.platform === 'native' ? 'nfs' : 'fuse', image: m.platform === 'native' ? null : (a.image ?? m.image ?? 'layerfs/sandbox:latest'), runtime: null, created: now(), op: null, workspaces: {} }
    w.data.sandboxes[a.name] = b
    try {
      await w.runOp('sandbox', b, 'sandbox.create', [{ phase: 'start', ms: 1500 }])
    } catch (error) {
      delete w.data.sandboxes[a.name]
      throw error
    }
    b.state = 'running'
    return { ...w.sandboxView(b), sandbox: b.name }
  },
  'sandbox.list': (w, a) => {
    if (a.project) w.project(a.project)
    const items = w.sandboxesOf((b) => !a.project || b.project === a.project).sort((x, y) => x.name.localeCompare(y.name)).map((b) => w.sandboxView(b))
    const { has_more, ...page } = paged(items, a)
    return page
  },
  'sandbox.get': (w, a) => {
    const b = w.sandbox(a.name)
    if (b.state === 'unresolved') throw refuse('Unresolved', `sandbox ${b.name} is unresolved: see \`layerfs sandbox get ${b.name}\`; clear it with \`layerfs sandbox close ${b.name}\``)
    const view = w.sandboxView(b)
    const workspaces = view.state === 'gone' ? [] : Object.values(b.workspaces).map((ws) => ({ name: ws.name, ws: ws.ws, branch: ws.branch, directory: ws.directory, mounted: true, activity: null }))
    const { has_more, ...page } = paged(workspaces, a)
    return { ...view, workspaces: page.items, next_page_pos: page.next_page_pos }
  },
  'sandbox.close': async (w, a) => {
    const b = w.sandbox(a.name)
    await w.runOp('sandbox', b, 'sandbox.close', [{ phase: 'stop', ms: b.state === 'running' ? 1000 : 200 }])
    delete w.data.sandboxes[b.name]
    return { name: b.name, closed: true, unknown: [] }
  },
  'workspace.mount': (w, a) => {
    const b = w.sandbox(a.sandbox)
    if (w.sandboxView(b).state !== 'running') throw refuse('Unavailable', `sandbox ${b.name} is ${w.sandboxView(b).state}`)
    const p = w.projectData(b.project)
    w.branch(p, a.branch)
    const name = a.name ?? a.branch
    if (b.workspaces[name]) throw refuse('Exists', `sandbox ${b.name} has a Workspace named ${name}`)
    const ws = { name, ws: `${b.name}:${name}`, branch: a.branch, directory: `/workspaces/${name}` }
    b.workspaces[name] = ws
    return { ...ws, sandbox: b.name }
  },
  'workspace.status': (w, a) => {
    const { b, ws } = workspaceOf(w, a.ws)
    return { ws: ws.ws, sandbox: b.name, branch: ws.branch, directory: ws.directory, changes: [], dirty: false }
  },
  'workspace.commit': (w, a) => {
    const { ws } = workspaceOf(w, a.ws)
    return { kind: 'Unchanged', branch: ws.branch, ws: ws.ws }
  },
  'workspace.unmount': (w, a) => {
    const { b, ws } = workspaceOf(w, a.ws)
    delete b.workspaces[ws.name]
    return { ws: ws.ws, unmounted: true }
  },
}

function workspaceOf(w, handle) {
  const at = String(handle ?? '').indexOf(':')
  if (at <= 0) throw refuse('InvalidInput', 'a Workspace is named <sandbox>:<name>')
  const b = w.sandbox(handle.slice(0, at))
  const ref = handle.slice(at + 1)
  const ws = b.workspaces[ref] ?? Object.values(b.workspaces).find((x) => x.directory === ref)
  if (!ws) throw refuse('NoSuchWorkspace', `no Workspace ${handle}`)
  return { b, ws }
}

/** Refuses a push or pull while the Store's projects have Sandboxes running. */
function inUse(w, s, verb) {
  const running = w.storeSandboxes(s.name).filter((b) => b.state === 'running')
  if (running.length) throw refuse('InUse', `store ${s.name} can't be ${verb} while Sandboxes ${running.map((b) => b.name).join(', ')} run on it`, { entity: { kind: 'store', name: s.name }, related: running.map((b) => ({ kind: 'sandbox', name: b.name })) })
}

async function removeMachine(w, name, call) {
  const m = w.machine(name)
  if (BUILT_IN.has(m.name)) throw refuse('Unsupported', `${m.name} is built in and can't be removed`)
  if (call === 'machine.remove' && m.platform === 'ssh') throw refuse('InvalidInput', `${m.name} is an ssh host: disconnect it`)
  if (call === 'machine.disconnect' && m.platform !== 'ssh') throw refuse('InvalidInput', `${m.name} is a VM: remove it`)
  const stores = w.machineView(m).stores
  const running = w.sandboxesOf((b) => b.machine === m.name && b.state === 'running')
  if (stores.length || running.length) {
    throw refuse('InUse', `machine ${m.name} holds ${[...stores.map((s) => `Store ${s}`), ...running.map((b) => `Sandbox ${b.name}`)].join(', ')}; move or close them first`, { entity: { kind: 'machine', name: m.name }, related: [...stores.map((s) => ({ kind: 'store', name: s })), ...running.map((b) => ({ kind: 'sandbox', name: b.name }))] })
  }
  m.state = 'removing'
  await w.runOp('machine', m, call, [{ phase: 'remove', ms: m.platform === 'ssh' ? 500 : 2000 }])
  for (const b of w.sandboxesOf((x) => x.machine === m.name)) delete w.data.sandboxes[b.name]
  delete w.data.machines[m.name]
  return { name: m.name, removed: true }
}

function moveOrCopy(tree, p, a, move) {
  const from = checkPath(a.from_path)
  const to = checkPath(a.to_path)
  if (!tree[from]) throw refuse('NoSuchPath', 'Content(PathNotFound)', { index: 0 })
  if (tree[to]) throw refuse('Exists', `${to} exists`)
  const parent = nodeAt(tree, parentOf(to))
  if (!parent || parent.type !== 'dir') throw refuse('NoSuchPath', 'Content(PathNotFound)', { index: 0 })
  for (const at of under(tree, from)) {
    const node = tree[at]
    tree[to + at.slice(from.length)] = move ? node : { ...node, inode: p.inode++ }
    if (move) delete tree[at]
  }
}
