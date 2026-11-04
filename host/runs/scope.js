// A scenario run's scope: what lets several scenarios play on one LayerFS
// project at once. Each run gets
//   a folder     /<run>/ (run = <scenario>_<n>) that holds its fixture
//   a trunk      the Branch that stands for main: <run>.main (the fixture's
//                Commit), then <run>.main.1, .2, … one per publish
//   a namespace  its Branches are <run>.<name>
//   Sandboxes    the script's names (sb1, …) as <run>.<name>.<tag>, unique in
//                the home (<run> is unique in its project only), made on the
//                run's machine (Sandboxes follow the Store)
// The scripts stay as written. Every agent's bash call finds the scope in
// LAYERFS_CONNECT_SCOPE: the `layerfs` command (cli-shim.mjs) and the
// `layerfs` package (scope-client.js) rewrite each call's 2.0 arguments
// before the native library gets it. LayerFS 2.0's own folder scope is not
// used underneath: it refuses Sandbox and Commit calls, which scenarios make,
// and its namespace has no trunks (§9 Q12):
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

/**
 * `timeout` where the Sandbox has none: a macOS native Sandbox runs this
 * Mac's own processes, and macOS has no `timeout`. perl's alarm survives the
 * exec and ends the command (exit 142, not GNU's 124).
 */
const TIMEOUT = `command -v timeout >/dev/null 2>&1 || timeout() { perl -e 'alarm shift; exec @ARGV or exit 127' "$@"; }`

/** `cd` into the run's folder first; a missing folder fails the command. */
export const inRunFolder = (run, command) => (typeof command === 'string' ? `${TIMEOUT}\ncd ${run} || exit 97\n${command}` : command)

export class Scope {
  /** The scope in `dir`, as the engine made it. */
  static open(dir) {
    const { run, project, machine = null, tag = null } = JSON.parse(readFileSync(join(dir, 'scope.json'), 'utf8'))
    return new Scope(dir, run, project, machine, tag)
  }

  /**
   * Makes a scope's folder: the run's name, its project (its key), its first
   * trunk, the machine its Sandboxes run on, and a tag of its own: the run's
   * name is unique in its project only, Sandbox names in the whole home.
   */
  static create(dir, { run, project, trunk, machine = null }) {
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(join(dir, 'trunks'), { recursive: true })
    mkdirSync(join(dir, 'sandboxes'), { recursive: true })
    mkdirSync(join(dir, 'mounts'), { recursive: true })
    mkdirSync(join(dir, 'ffs'), { recursive: true })
    const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 4)}`
    writeFileSync(join(dir, 'scope.json'), JSON.stringify({ run, project, ...(machine ? { machine } : {}), tag }))
    const scope = new Scope(dir, run, project, machine, tag)
    scope.setTrunk(0, trunk)
    return scope
  }

  constructor(dir, run, project, machine = null, tag = null) {
    this.dir = dir
    this.run = run
    this.project = project
    this.machine = machine
    /** Null in a scope made before tags: its Sandboxes keep `<run>.<name>`. */
    this.tag = tag
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

  /** The run's Sandboxes: Map the script's name -> the real name (unique in the home). */
  sandboxes() {
    const out = new Map()
    for (const n of readdirSync(join(this.dir, 'sandboxes'))) {
      try {
        out.set(n, readFileSync(join(this.dir, 'sandboxes', n), 'utf8'))
      } catch {}
    }
    return out
  }

  /** The real name of the script's Sandbox `name`: `<run>.<name>.<tag>`, recorded once; a real name passes as it is. */
  realSandbox(name) {
    if (typeof name !== 'string') return name
    const known = this.sandboxes()
    if ([...known.values()].includes(name)) return name
    if (known.has(name)) return known.get(name)
    const end = this.tag ? `.${this.tag}` : ''
    const real = `${`${this.run}.${name}`.toLowerCase().replace(/[^a-z0-9_.-]/g, '-').slice(0, 63 - end.length)}${end}`
    try {
      writeFileSync(join(this.dir, 'sandboxes', name), real, { flag: 'wx' })
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
    }
    return this.sandboxes().get(name) ?? real
  }

  /** A `ws` handle `<sandbox>:<path>` with the real Sandbox name. */
  realWs(ws) {
    if (typeof ws !== 'string' || !ws.includes(':')) return ws
    const at = ws.indexOf(':')
    return `${this.realSandbox(ws.slice(0, at))}${ws.slice(at)}`
  }

  dropSandbox(real) {
    for (const [n, r] of this.sandboxes()) if (r === String(real)) unlinkSync(join(this.dir, 'sandboxes', n))
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
   * One call of the run's, by its 2.0 name (`family.call`) and named
   * arguments: `send(op, args)` makes the real call and answers its value or
   * throws its refusal. Calls on another project pass.
   */
  async call(op, args, send) {
    if (!args || (args.project !== undefined && args.project !== this.project)) return send(op, args)
    if (op === 'branch.publish') return this.publish(args, send)
    const sent = this.args(op, args)
    const value = await send(op, sent)
    if (op === 'branch.merge' && (args.a === 'main' || args.b === 'main') && value?.fast_forward && typeof value.head === 'string') {
      mkdirSync(join(this.dir, 'ffs'), { recursive: true })
      writeFileSync(join(this.dir, 'ffs', sent.name), value.head)
    }
    if (op === 'sandbox.close') this.dropSandbox(sent.name)
    return this.unmap(op === 'sandbox.list' && Array.isArray(value?.items) ? { ...value, items: value.items.filter((i) => [...this.sandboxes().values()].includes(i.name)) } : value)
  }

  /** publish B [commit] -> a fork of the next trunk from it; the trunk moves when the fork worked. */
  async publish(args, send) {
    const { branch, commit, project } = args
    const k = this.claimTrunk()
    let value
    try {
      value = await send('branch.fork', { project, name: this.trunkName(k), from_branch: this.ref(branch), ...(commit ? { from_commit: commit } : {}) })
    } catch (error) {
      this.releaseTrunk(k)
      throw error
    }
    this.setTrunk(k, this.trunkName(k))
    return this.unmap(value)
  }

  /** The call's named arguments in the run's folder, namespace and Sandboxes. */
  args(op, args) {
    const a = { ...args }
    for (const key of ['branch', 'from_branch', 'to_branch', 'left_branch', 'right_branch', 'a', 'b']) if (key in a) a[key] = this.ref(a[key])
    if (op === 'branch.fork' || op === 'branch.merge') a.name = this.name(a.name)
    for (const key of ['path', 'from_path', 'to_path', 'left_path', 'right_path']) if (key in a) a[key] = inFolder(this.run, a[key])
    if ((op === 'file.glob' || op === 'file.grep') && !('path' in a)) a.path = `/${this.run}`
    if (op === 'file.apply' && Array.isArray(a.changes)) a.changes = this.changes(a.changes)
    if ((op === 'file.write' || op === 'file.edit') && a.path === '/.lww') Object.assign(a, this.lwwBody(a))
    if (op.startsWith('sandbox.') || op === 'workspace.mount') {
      if (op === 'sandbox.create') a.name = this.realSandbox(a.name)
      else if ('name' in a) a.name = this.realSandbox(a.name)
      if ('sandbox' in a) a.sandbox = this.realSandbox(a.sandbox)
      // Sandboxes follow the Store: a run's are made on its machine
      if (op === 'sandbox.create' && this.machine) a.machine = this.machine
    }
    if ('ws' in a) a.ws = this.realWs(a.ws)
    if (op === 'workspace.exec') a.command = inRunFolder(this.run, a.command)
    return a
  }

  /** A file.apply's changes in the folder; a root /.lww write also keeps its copy under the folder. */
  changes(list) {
    return list.flatMap((c) => (c?.op === 'write' && c.path === '/.lww' ? [this.change(c), { ...c, path: `/${this.run}/.lww` }] : [this.change(c)]))
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
    if (typeof a.new === 'string') out.new = lwwFor(this.run, a.new)
    return out
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

  /** An answer as the run's scripts know the project: Branch names and paths (Sandboxes keep their real names, which the scope also takes). */
  unmap(value) {
    const numbers = new Map()
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
