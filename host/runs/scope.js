// A scenario run's scope: what lets several scenarios play on one LayerFS
// project at once. Each run gets
//   a folder     /<run>/ (run = <scenario>_<n>) that holds its fixture
//   a trunk      the Branch that stands for main: <run>.main (the fixture's
//                Commit), then <run>.main.1, .2, … one per publish
//   a namespace  its Branches are <run>.<name>
//   Sandboxes    numbered 1, 2, … for the run alone, whatever numbers the
//                project gives them
// The scripts stay as written. Every agent's bash call loads the scope
// (resolve-layerfs.js, when LAYERFS_CONNECT_SCOPE names this folder), and it
// rewrites each LayerFS call before the SDK traces and sends it:
//   paths        /app/page.tsx -> /<run>/app/page.tsx (fs.* paths, fs.apply
//                changes, a glob or grep's folder); /.lww stays at the root,
//                since LayerFS reads only that one, with its rules moved under
//                the folder
//   refs         main -> the current trunk; a Branch name -> <run>.<name>;
//                Commit and Layer ids as they are
//   commands     workspace.exec and process.start run in /<run>/ (cd first)
//   publish      branch.publish B [commit] -> branch.fork <run>.main.<k+1>
//                from B (or the Commit); the trunk moves only when it worked
//   Sandboxes    the run's number -> the project's; project.list_sandboxes
//                and process.list list the run's only
// Answers come back as the script knows the project: its Sandbox numbers,
// Branch names without <run>. (a trunk as main) and paths without /<run>, so
// a script that compares a name it wrote still finds it. The trace shows the
// calls as sent and answered: real paths, Branches and Sandboxes.
//
// State lives in files, since each bash call is its own process and a run's
// agents call at once:
//   scope.json        { run, project }
//   trunk.json        { k, branch }: written whole through a rename
//   trunks/<k>        a claimed publish number (mkdir is atomic)
//   sandboxes/<n>     the run's Sandbox n: the project's number (created exclusively)
//   mounts/<sandbox>@<path>  the Branch a Workspace of the run's was mounted on:
//                     sandbox.list_workspaces names a Workspace's Branch only
//                     among the project's first 64 Branches (LayerFS's
//                     operator/inspect.rs reads one page of 64), and a project
//                     every scenario plays on has more, so a null is filled
//                     from here (Ephemeral-AI-Lab/layerfs#480)
//   ffs/<branch>      a merge `x main` that fast-forwarded onto the trunk:
//                     the trunk head the new Branch starts from. main was a
//                     Layer, so such a Branch's own Commits started there; on
//                     a trunk it reaches the trunk's whole history, and the
//                     order check stops there (checks/history.js)
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const SCOPE_ENV = 'LAYERFS_CONNECT_SCOPE'

/** A Commit or Layer id: hex, as LayerFS prints them (a Branch name is never this long and plain). */
const ID = /^[0-9a-f]{40,}$/
/**
 * Where a Sandbox number the run does not have (never had, or closed) is
 * sent: the highest number LayerFS takes (1 to 9999), which it refuses with
 * NoSuchSandbox as it would the run's closed one. Sandboxes take the lowest
 * free number, so no project reaches it.
 */
const UNKNOWN_SANDBOX = '9999'

/** /<run> + path, once: a path already under the folder is left as it is. */
export function inFolder(run, path) {
  if (typeof path !== 'string' || !path.startsWith('/')) return path
  const root = `/${run}`
  if (path === root || path.startsWith(`${root}/`)) return path
  if (path === '/.lww') return path
  return path === '/' ? root : `${root}${path}`
}

/**
 * A /.lww written by the run, as the root /.lww that keeps its meaning with
 * the files under /<run>/: a pattern with a / (anchored at the root) moves
 * under the folder, and so does an %include'd file. A name alone matches at
 * any depth already.
 */
export function lwwFor(run, text) {
  return String(text)
    .split('\n')
    .map((line) => {
      const t = line.trim()
      if (!t || t.startsWith('#')) return line
      const include = /^%include\s+(.+)$/.exec(t)
      if (include) return `%include ${run}/${include[1].replace(/^\/+/, '')}`
      const neg = t.startsWith('!') ? '!' : ''
      const pattern = neg ? t.slice(1) : t
      // anchored: a / before the end (a trailing / only marks a folder)
      if (!pattern.replace(/\/+$/, '').includes('/')) return line
      return `${neg}/${run}/${pattern.replace(/^\/+/, '')}`
    })
    .join('\n')
}

/** `cd` into the run's folder first; a missing folder fails the command. */
export const inRunFolder = (run, command) => (typeof command === 'string' ? `cd ${run} || exit 97\n${command}` : command)

export class Scope {
  /** The scope in `dir`, as the engine made it. */
  static open(dir) {
    const { run, project } = JSON.parse(readFileSync(join(dir, 'scope.json'), 'utf8'))
    return new Scope(dir, run, project)
  }

  /** Makes a scope's folder: the run's name, its project and its first trunk. */
  static create(dir, { run, project, trunk }) {
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(join(dir, 'trunks'), { recursive: true })
    mkdirSync(join(dir, 'sandboxes'), { recursive: true })
    mkdirSync(join(dir, 'mounts'), { recursive: true })
    mkdirSync(join(dir, 'ffs'), { recursive: true })
    writeFileSync(join(dir, 'scope.json'), JSON.stringify({ run, project }))
    const scope = new Scope(dir, run, project)
    scope.setTrunk(0, trunk)
    return scope
  }

  constructor(dir, run, project) {
    this.dir = dir
    this.run = run
    this.project = project
  }

  // ---------- state ----------

  /** The current trunk: { k, branch }. */
  trunk() {
    return JSON.parse(readFileSync(join(this.dir, 'trunk.json'), 'utf8'))
  }

  setTrunk(k, branch) {
    const file = join(this.dir, 'trunk.json')
    // two publishes at once: the higher number is the newer trunk
    if (existsSync(file) && this.trunk().k > k) return
    writeFileSync(`${file}.${process.pid}.tmp`, JSON.stringify({ k, branch }))
    renameSync(`${file}.${process.pid}.tmp`, file)
  }

  /** Every trunk Branch so far, k ascending: [{ k, branch }]. */
  trunks() {
    const out = [{ k: 0, branch: `${this.run}.main` }]
    for (const k of readdirSync(join(this.dir, 'trunks')).map(Number).filter((k) => k > 0).sort((a, b) => a - b)) out.push({ k, branch: this.trunkName(k) })
    return out
  }

  trunkName(k) {
    return k === 0 ? `${this.run}.main` : `${this.run}.main.${k}`
  }

  claimTrunk() {
    for (let k = this.trunk().k + 1; ; k++) {
      try {
        mkdirSync(join(this.dir, 'trunks', String(k)))
        return k
      } catch (error) {
        if (error.code !== 'EEXIST') throw error
      }
    }
  }

  releaseTrunk(k) {
    try {
      rmdirSync(join(this.dir, 'trunks', String(k)))
    } catch {}
  }

  /** The run's Sandboxes: Map run number -> project number. */
  sandboxes() {
    const out = new Map()
    for (const n of readdirSync(join(this.dir, 'sandboxes'))) {
      try {
        out.set(n, readFileSync(join(this.dir, 'sandboxes', n), 'utf8'))
      } catch {}
    }
    return out
  }

  /** A new Sandbox of the project's: the run's lowest free number. */
  addSandbox(real) {
    for (let n = 1; ; n++) {
      try {
        writeFileSync(join(this.dir, 'sandboxes', String(n)), String(real), { flag: 'wx' })
        return String(n)
      } catch (error) {
        if (error.code !== 'EEXIST') throw error
      }
    }
  }

  dropSandbox(real) {
    for (const [n, r] of this.sandboxes()) if (r === String(real)) unlinkSync(join(this.dir, 'sandboxes', n))
  }

  mountFile(sandbox, path) {
    return join(this.dir, 'mounts', `${sandbox}@${String(path).replaceAll('/', '_')}`)
  }

  /** The Branch the run mounted at `path` of Sandbox `sandbox` (the project's number), or null. */
  mountedBranch(sandbox, path) {
    try {
      return readFileSync(this.mountFile(sandbox, path), 'utf8')
    } catch {
      return null
    }
  }

  realSandbox(n) {
    return this.sandboxes().get(String(n)) ?? UNKNOWN_SANDBOX
  }

  runSandbox(real) {
    for (const [n, r] of this.sandboxes()) if (r === String(real)) return n
    return null
  }

  /** Branches made by a merge with main that fast-forwarded onto the trunk: Map name -> the trunk head they start from. */
  fastForwards() {
    const out = new Map()
    try {
      for (const name of readdirSync(join(this.dir, 'ffs'))) out.set(name, readFileSync(join(this.dir, 'ffs', name), 'utf8'))
    } catch {}
    return out
  }

  // ---------- names ----------

  /** A ref the run names: main -> the trunk, a Branch -> <run>.<name>, an id as it is. */
  ref(name) {
    if (name === undefined || name === null || name === 'main') return this.trunk().branch
    if (typeof name !== 'string' || ID.test(name) || name.startsWith(`${this.run}.`)) return name
    return `${this.run}.${name}`
  }

  /** A new Branch's name. */
  name(name) {
    return typeof name !== 'string' || name.startsWith(`${this.run}.`) ? name : `${this.run}.${name}`
  }

  // ---------- calls ----------

  /**
   * One call of the run's: `send(op, args)` makes the real call (traced) and
   * answers its value or throws its refusal. Calls on another project pass.
   */
  async call(op, args, send) {
    if (!args || args.project !== this.project) return send(op, args)
    if (op === 'branch.publish') return this.publish(args, send)
    const sent = this.args(op, args)
    const value = await send(op, sent)
    if (op === 'branch.merge' && (args.with === 'main' || args.with == null) && value?.fastForward && typeof value.head === 'string') {
      mkdirSync(join(this.dir, 'ffs'), { recursive: true })
      writeFileSync(join(this.dir, 'ffs', sent.name), value.head)
    }
    return this.answer(op, sent, value)
  }

  /** publish B [commit] -> a fork of the next trunk from it; the trunk moves when the fork worked. */
  async publish(args, send) {
    const { branch, commit, ...rest } = args
    const from = commit ?? this.ref(branch)
    const k = this.claimTrunk()
    let value
    try {
      value = await send('branch.fork', { ...rest, name: this.trunkName(k), from })
    } catch (error) {
      this.releaseTrunk(k)
      throw error
    }
    this.setTrunk(k, this.trunkName(k))
    return this.unmap(value)
  }

  /** The call's arguments in the run's folder, namespace and Sandboxes. */
  args(op, args) {
    const a = { ...args }
    const path = (key) => {
      if (key in a) a[key] = inFolder(this.run, a[key])
    }
    const sandbox = () => {
      if (typeof a.sandbox === 'string') a.sandbox = this.realSandbox(a.sandbox)
    }
    switch (op) {
      case 'branch.fork':
        a.name = this.name(a.name)
        a.from = this.ref(a.from)
        break
      case 'branch.merge':
        a.branch = this.ref(a.branch)
        a.with = this.ref(a.with)
        a.name = this.name(a.name)
        break
      case 'branch.list_commits':
        a.branch = this.ref(a.branch)
        break
      case 'branch.diff_branches':
      case 'branch.diff_commits':
        a.from = this.ref(a.from)
        a.to = this.ref(a.to)
        break
      case 'fs.diff_files':
        a.branch = this.ref(a.branch)
        for (const side of ['left', 'right']) if (a[side]) a[side] = { ...a[side], commit: this.ref(a[side].commit), path: inFolder(this.run, a[side].path) }
        break
      case 'fs.glob':
      case 'fs.grep':
        a.branch = this.ref(a.branch)
        a.path = inFolder(this.run, a.path ?? '/')
        break
      case 'fs.cp':
      case 'fs.mv':
        a.branch = this.ref(a.branch)
        path('from')
        path('to')
        break
      case 'fs.apply':
        a.branch = this.ref(a.branch)
        // a /.lww written goes to the root, where LayerFS reads it, and as written into the folder, with the run's other files
        if (Array.isArray(a.changes)) a.changes = a.changes.flatMap((c) => (c?.op === 'write' && c.path === '/.lww' ? [this.change(c), { ...c, path: `/${this.run}/.lww` }] : [this.change(c)]))
        break
      case 'workspace.mount':
        sandbox()
        a.branch = this.ref(a.branch)
        break
      case 'workspace.exec':
      case 'backend.daemon.process.start':
        sandbox()
        a.command = inRunFolder(this.run, a.command)
        break
      default:
        if (op.startsWith('fs.')) {
          a.branch = this.ref(a.branch)
          path('path')
          if (a.path === '/.lww' && (op === 'fs.write' || op === 'fs.edit')) Object.assign(a, this.lwwBody(a))
        } else {
          sandbox()
          if (op.startsWith('backend.store.') && typeof a.branch === 'string') a.branch = this.ref(a.branch)
        }
    }
    return a
  }

  change(c) {
    if (!c || typeof c !== 'object') return c
    const out = { ...c }
    for (const key of ['path', 'from', 'to']) if (key in out) out[key] = inFolder(this.run, out[key])
    if (out.path === '/.lww' && out.op === 'write') Object.assign(out, this.lwwBody(out))
    return out
  }

  lwwBody(a) {
    const out = {}
    if (typeof a.content === 'string') out.content = lwwFor(this.run, a.content)
    if (typeof a.newText === 'string') out.newText = lwwFor(this.run, a.newText)
    return out
  }

  /** The call's value as the run sees it: its own Sandbox numbers, its own Sandboxes and processes listed. */
  answer(op, args, value) {
    if (!value || typeof value !== 'object') return value
    if (op === 'sandbox.create' && typeof value.sandbox === 'string') return { ...value, sandbox: this.addSandbox(value.sandbox) }
    if (op === 'sandbox.close') this.dropSandbox(args.sandbox)
    if (op === 'workspace.mount' && typeof value.path === 'string') {
      mkdirSync(join(this.dir, 'mounts'), { recursive: true })
      writeFileSync(this.mountFile(value.sandbox ?? args.sandbox, value.path), String(args.branch))
    }
    if (op === 'workspace.unmount') rmSync(this.mountFile(args.sandbox, args.path), { force: true })
    // the binding's answer: { workspaces: [{ directory, branch, … }] }, which the SDK makes into items
    if (op === 'sandbox.list_workspaces' && Array.isArray(value.workspaces)) {
      const named = (w) => (w.branch == null ? this.mountedBranch(args.sandbox, w.directory) : null)
      value = { ...value, workspaces: value.workspaces.map((w) => (named(w) ? { ...w, branch: named(w) } : w)) }
    }
    if ((op === 'project.list_sandboxes' || op === 'backend.daemon.process.list') && Array.isArray(value.items)) {
      const mine = new Set(this.sandboxes().values())
      value = { ...value, items: value.items.filter((i) => mine.has(String(i.sandbox))) }
    }
    return this.unmap(value)
  }

  /** A Branch name as the run's scripts know it: <run>.x -> x, a trunk -> main. */
  ownName(name) {
    if (typeof name !== 'string' || !name.startsWith(`${this.run}.`)) return name
    return /^main(\.\d+)?$/.test(name.slice(this.run.length + 1)) ? 'main' : name.slice(this.run.length + 1)
  }

  /** A path as the run's scripts know it: /<run>/x -> /x. */
  ownPath(path) {
    const root = `/${this.run}`
    if (typeof path !== 'string') return path
    return path === root ? '/' : path.startsWith(`${root}/`) ? path.slice(root.length) : path
  }

  /** An answer as the run's scripts know the project: its Sandbox numbers, Branch names and paths. */
  unmap(value) {
    const numbers = new Map([...this.sandboxes()].map(([n, r]) => [r, n]))
    const walk = (v) => {
      if (Array.isArray(v)) return v.map(walk)
      if (!v || typeof v !== 'object' || Buffer.isBuffer(v) || ArrayBuffer.isView(v)) return v
      const out = {}
      for (const [k, x] of Object.entries(v)) {
        if (typeof x !== 'string') out[k] = walk(x)
        else if (k === 'sandbox') out[k] = numbers.get(x) ?? x
        else if (k === 'branch' || k === 'ref' || k === 'name') out[k] = this.ownName(x)
        else if (k === 'path') out[k] = this.ownPath(x)
        else out[k] = x
      }
      return out
    }
    return walk(value)
  }
}

/** An expect code as a scoped run's trace shows it: a publish is the fork of the next trunk. */
export const scopedCode = (code) => (/^branch\.publish:/.test(code) ? 'branch.fork:Forked' : code)

/** A compiled scenario (tools/lib/scenario.mjs) as a scoped run plays it: its expects as scopedCode reads them. */
export function scopedScenario(scenario) {
  const agents = Object.fromEntries(Object.entries(scenario.agents).map(([name, steps]) => [name, steps.map((s) => (s.expect ? { ...s, expect: s.expect.map(scopedCode) } : s))]))
  return {
    ...scenario,
    agents,
    sessions: scenario.sessions?.map((s) => ({ ...s, scenario: scopedScenario(s.scenario) })) ?? null,
  }
}
