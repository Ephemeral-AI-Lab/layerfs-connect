// The host's project reads and changes on LayerFS 2.0 (README.md, "HTTP API";
// docs/layerfs-2.0-integration.md §7), mapped into src/shared/host-api.ts.
// Every project is `<store>/<project>` and every call names it; there is one
// client (layerfs.js) and nothing to open or close.
//   status        the linked LayerFS, the home, its machines and Stores
//   list          project.list(), each marked with the run that made it
//   create/init   project.init(key, folder, { on_progress }) into an existing
//                 Store; Connect keeps its own table of the Inits it started
//   state         branch.list, commit.list per Branch, sandbox.list and
//                 store.status: the Store's facts, no Sandbox asked
//   sandboxes     sandbox.list with each Sandbox's Workspaces (sandbox.get)
//   createSandbox sandbox.create(key, name, machine, { image })
//   closeSandbox  sandbox.close(name, { force })
//   commits       commit.list, newest first, each Commit's changed paths from
//                 commit.diff against its parent
//   listDir/file  file.list, file.stat and file.read
//   remove        project.remove (InUse while any Sandbox record exists)
// Every LayerFS call is made once; a refusal passes through with its code.
// What 2.0 cannot answer yet is left out and named (§9): main's Layers (only
// its newest is known), a first Commit's changes, and the Store's totals
// (summed from the Commits read instead, marked partial).
import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { keyOf, projectRef } from './config.js'
import { layerfs, linkedVersion, pages, PAGE, VIEW_WAIT_MS, workspacesOf } from './layerfs.js'

export { keyOf }

/** A file larger than this is answered without its text. */
const FILE_MAX = 1024 * 1024
/** A folder with at most this many files gets each file's size (one file.stat each). */
const STAT_MAX = 200
/** Calls in flight at once for one answer (stats, diffs). */
const WIDTH = 4
/** Commits whose changed paths are kept: a Commit never changes. */
const KEEP_CHANGES = 5000
/** Default and largest Commits per answer. */
const LIMIT = 200
/** Init jobs kept after they end. */
const KEEP_INITS = 50

/** Tagged ids: a Layer's first byte is 0x32. */
const isLayer = (id) => typeof id === 'string' && id.startsWith('32')

const refuse = (status, code, message) => Object.assign(new Error(message), { status, code })

function checkBranch(branch) {
  if (typeof branch !== 'string' || !branch || branch.includes('\0')) throw refuse(400, 'InvalidInput', 'branch must be a Branch name, main or a saved id')
}
function checkPath(path) {
  if (typeof path !== 'string' || !path.startsWith('/') || path.includes('\0') || path.split('/').includes('..')) {
    throw refuse(400, 'InvalidInput', 'path must be an absolute path')
  }
}

/** Runs `fn` over `items`, `width` at a time. */
async function each(items, width, fn) {
  let next = 0
  const lane = async () => {
    while (next < items.length) {
      const index = next++
      await fn(items[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(width, items.length) }, lane))
}

/** Sets `key` as the newest entry of `map`, dropping the oldest past `most`. */
function keep(map, key, value, most) {
  map.delete(key)
  map.set(key, value)
  while (map.size > most) map.delete(map.keys().next().value)
}

/** A 2.0 Commit record -> CommitInfo. */
export const commitInfo = (c, branch) => ({
  id: c.id,
  branch: c.branch ?? branch ?? '',
  message: c.message ?? '',
  at: typeof c.time === 'number' ? c.time : null,
  parent: c.parent ?? null,
  merged: c.second_parent ?? null,
  kind: c.via ?? null,
})

/** An SDK `op` ({ id, name, phase, started, uncertain }), or null. */
export const opOf = (o) => (o && typeof o === 'object' && typeof o.name === 'string' ? { id: String(o.id ?? ''), name: o.name, phase: o.phase ?? '', started: o.started ?? null, uncertain: o.uncertain === true } : null)

/** A LayerFS refusal as the UI shows it: code, the SDK's text, and its detail (entity, phase, op, related). */
export const refusalOf = (error) => ({ code: error?.code ?? 'Failed', message: error?.message ?? String(error), detail: error?.detail ?? null })

/** Refusals a Store's operation gives every Store call: the page still renders what the home's records say. */
export const STORE_REFUSALS = new Set(['Busy', 'Unresolved', 'Unavailable'])

/** A sandbox.list/get record (and its Workspaces, when read) -> SandboxInfo. States are the SDK's (#537 U4). */
export function sandboxInfo(s, workspaces = null) {
  return {
    id: String(s.name),
    name: String(s.name),
    state: s.state ?? 'unknown',
    op: opOf(s.op),
    backend: s.backend ?? null,
    route: s.route ?? null,
    project: s.project ?? null,
    image: s.image ?? null,
    machine: s.machine ?? null,
    runtime: s.runtime ?? null,
    ...(s.platform ? { platform: s.platform } : {}),
    workspaces: (workspaces ?? [])
      .filter((w) => w.mounted !== false && w.directory)
      .map((w) => ({ ws: w.ws ?? `${s.name}:${w.name ?? w.directory}`, name: w.name ?? null, branch: w.branch ?? '', path: w.directory, activity: w.activity ?? null })),
    ...(workspaces ? {} : { unread: true }),
  }
}

export class Projects {
  /**
   * @param {object} options
   * @param {object} options.spec config.js's resolved spec
   * @param {() => object | null} [options.runs] the RunManager, when loaded
   * @param {object} [options.daemon] what main.js's native daemon record did
   * @param {(line: string) => void} [options.log]
   * @param {object} [options.client] a LayerFS client (tests pass a stand-in)
   */
  constructor({ spec, runs = () => null, daemon = null, log = (line) => process.stderr.write(`${line}\n`), client = null }) {
    this.spec = spec
    this.runs = runs
    this.daemon = daemon
    this.log = log
    this.lfs = client ?? layerfs(spec)
    /** Commit id -> its changed paths, or null when LayerFS cannot compare it */
    this.changes = new Map()
    /** Init job id -> ProjectInitJob: the Inits this host started (2.0 keeps no job registry) */
    this.inits = new Map()
    this.creations = new Map()
    this.emptySources = join(spec.state, 'project-sources')
  }

  // ---------- status ----------

  /** HostStatus: the linked LayerFS, the home and what it holds. */
  async status() {
    const [machines, stores] = await Promise.all([this.lfs.machine.list(), this.lfs.store.list()])
    const platform = process.platform === 'darwin' ? 'macos' : process.platform === 'win32' ? 'windows' : 'linux'
    return {
      platform,
      layerfs: linkedVersion(),
      settings: { state: this.spec.state, home: this.spec.home, cli: this.spec.cli },
      daemon: this.daemon ? { recorded: !!(this.daemon.recorded || this.daemon.kept), why: this.daemon.why ?? null } : null,
      machines: (machines.machines ?? []).map((m) => ({ name: m.name, platform: m.platform, state: m.state ?? null })),
      stores: (stores.items ?? []).length,
    }
  }

  // ---------- projects ----------

  /** project key -> { demo, run }: the runs that made projects. */
  madeBy() {
    const made = new Map()
    const manager = this.runs()
    if (manager) {
      try {
        for (const r of manager.runs()) if (r?.project && r.kind !== 'live' && !made.has(r.project)) made.set(r.project, { demo: r.demo ?? null, run: r.id ?? null })
        return made
      } catch (error) {
        this.log(`[host] runs(): ${error?.message ?? error}; reading run.json files instead`)
      }
    }
    let folders = []
    try {
      folders = readdirSync(this.spec.runs, { withFileTypes: true }).filter((d) => d.isDirectory())
    } catch {
      return made
    }
    for (const folder of folders) {
      try {
        const r = JSON.parse(readFileSync(join(this.spec.runs, folder.name, 'run.json'), 'utf8'))
        if (typeof r?.project === 'string' && r.kind !== 'live' && !made.has(r.project)) made.set(r.project, { demo: r.demo ?? null, run: r.id ?? folder.name })
      } catch {
        // a run folder without a readable record made no project we can name
      }
    }
    return made
  }

  /** ProjectSummary of a project.list/get record. `join` (Store name -> { storeState }) adds the Store's state. */
  summary(p, made, join = null) {
    const key = keyOf(p)
    const by = made.get(key)
    return {
      name: p.name,
      key,
      store: p.store,
      kind: p.kind ?? null,
      machine: p.machine ?? null,
      created: p.created ?? null,
      demo: by?.demo ?? null,
      run: by?.run ?? null,
      ...(join ? { storeState: join.get(p.store)?.state ?? null, storeOp: join.get(p.store)?.op ?? null } : {}),
    }
  }

  /**
   * Starts an Init of `<store>/<name>` from a folder or an empty source, into
   * the existing Store `store` (2.0 never makes a Store at Init). Answers the
   * job; Init goes on while the window that asked stops polling.
   */
  async create(input) {
    const { name, source, store } = input ?? {}
    if (typeof store !== 'string' || !store) throw refuse(400, 'InvalidInput', 'Choose the Store the project goes into.')
    const { key } = projectRef(`${store}/${name}`)
    if ([...this.inits.values()].some((j) => j.name === key && !j.ended)) throw refuse(409, 'Exists', `${key} is being created`)
    if (source !== undefined && (typeof source !== 'string' || !isAbsolute(source) || source.includes('\0') || !statSync(source, { throwIfNoEntry: false })?.isDirectory())) {
      throw refuse(400, 'InvalidInput', 'Choose an existing absolute source folder.')
    }
    let emptySource
    if (source === undefined) {
      mkdirSync(this.emptySources, { recursive: true, mode: 0o700 })
      emptySource = mkdtempSync(join(this.emptySources, 'empty-'))
    }
    const job = { id: randomUUID(), name: key, source: source ?? null, started: Date.now(), ended: null, step: 'scan', progress: null, project: null, error: null }
    keep(this.inits, job.id, job, KEEP_INITS)
    const on_progress = (p) => {
      if (typeof p?.step === 'string') job.step = p.step
      job.progress = { entries: p?.entries ?? 0, files: p?.files ?? 0, bytes: p?.bytes ?? 0 }
    }
    const completion = this.lfs.project
      .init(key, source ?? emptySource, { on_progress })
      .then(
        (made) => Object.assign(job, { step: 'done', project: this.summary(made, new Map()) }),
        (error) => {
          Object.assign(job, { step: 'failed', error: { code: error?.code ?? 'Failed', message: error?.message ?? String(error) } })
          this.log(`[host] creating ${key}: ${error?.message ?? error}`)
        },
      )
      .finally(() => {
        job.ended = Date.now()
        if (emptySource) rmSync(emptySource, { recursive: true, force: true })
        this.creations.delete(job.id)
      })
    this.creations.set(job.id, completion)
    return { ...job }
  }

  /** One of this host's Init jobs. */
  async init(id) {
    const job = this.inits.get(id)
    if (!job) throw refuse(404, 'NotFound', 'The project creation task is no longer available. Refresh Projects to check its result.')
    return { ...job }
  }

  /** The Inits this host started, newest first. */
  initJobs() {
    return [...this.inits.values()].reverse().map((j) => ({ ...j }))
  }

  /** ProjectSummary[]. */
  async list() {
    const made = this.madeBy()
    const records = await pages((p) => this.lfs.project.list(p))
    // set by the host (storage.js projectJoin); a failure leaves the field out
    const join = this.storeJoin ? await this.storeJoin().catch(() => null) : null
    return records.map((p) => this.summary(p, made, join))
  }

  /** project.get of a key. */
  record(key) {
    return this.lfs.project.get(projectRef(key).key)
  }

  /** Same as record: the agents' name for it. */
  recordOf(key) {
    return this.record(key)
  }

  /**
   * ProjectState from the Store alone: its Branches, their Commits, its
   * Sandbox records and the Store file's size. No Sandbox is asked. While its
   * Store is busy (a push or pull) or unresolved, Store calls are refused
   * (Busy, Unresolved); while it is down none is made (U3): the page then gets what the
   * home's records say (project.get, sandbox.list, store.status), the
   * Store's state and op, and the refusal in `refusal`, with no Branches.
   */
  async state(key) {
    const record = await this.record(key)
    const project = keyOf(record)
    // store.status first: on a stopped machine no Store call is made (U3); the banner offers Start
    const status = await this.lfs.store.status(record.store).catch(() => null)
    const down = status?.state === 'down'
    const [listed, sandboxes] = await Promise.all([
      down
        ? { refused: null }
        : pages((p) => this.lfs.branch.list(project, p)).catch((error) => {
            if (STORE_REFUSALS.has(error?.code)) return { refused: refusalOf(error) }
            throw error
          }),
      pages((p) => this.lfs.sandbox.list(project, p)).catch((error) => (this.log(`[host] sandbox.list of ${project}: ${error?.message ?? error}`), [])),
    ])
    const storeFacts = { storeState: status?.state ?? null, storeOp: opOf(status?.op), storeDown: status?.down_reason ?? null }
    if (!Array.isArray(listed)) {
      return {
        project: { ...this.summary(record, this.madeBy()), ...storeFacts, refusal: listed.refused },
        branches: [],
        layers: [],
        sandboxes: sandboxes.map((s) => sandboxInfo(s)),
        last: null,
        commits: 0,
        store: { path: null, bytes: status?.file?.exists ? (status.file.bytes ?? 0) + (status.file.wal_bytes ?? 0) : null },
        storage: null,
      }
    }
    const byId = new Map()
    await each(listed.filter((b) => b.name !== 'main'), WIDTH, async (b) => {
      for (const c of await this.ownCommits(project, b, PAGE)) byId.set(c.id, c)
    })
    const branches = branchInfos(listed, byId)
    const main = listed.find((b) => b.name === 'main')
    let newest = null
    for (const c of byId.values()) if (typeof c.time === 'number' && (!newest || c.time > newest.time)) newest = c
    const file = status?.file
    return {
      project: { ...this.summary(record, this.madeBy()), ...storeFacts },
      branches,
      // 2.0 lists none of main's Layers but its newest (§9 Q3)
      layers: main?.base ? [{ id: main.base, message: '', at: null, from: null }] : [],
      sandboxes: sandboxes.map((s) => sandboxInfo(s)),
      last: newest ? commitInfo(newest) : null,
      commits: byId.size,
      store: { path: null, bytes: file?.exists ? (file.bytes ?? 0) + (file.wal_bytes ?? 0) : null },
      // the Store's totals have no 2.0 call (§9 Q4): summed from the Commits read
      storage: commitStats(byId, file),
    }
  }

  /** SandboxInfo[] with each Sandbox's Workspaces (sandbox.get, one each). */
  async sandboxes(key) {
    const { key: project } = projectRef(key)
    const listed = await pages((p) => this.lfs.sandbox.list(project, p))
    return Promise.all(
      listed.map(async (s) => {
        // a Sandbox its machine no longer runs answers `state: "gone"` with no Workspaces; a refusal is shown as it came
        try {
          return sandboxInfo(s, await workspacesOf(this.lfs, s.name, { wait: VIEW_WAIT_MS }))
        } catch (error) {
          return { ...sandboxInfo(s), refusal: refusalOf(error) }
        }
      }),
    )
  }

  /**
   * A new Sandbox of the project: `{ name, machine?, image? }`. A sqlite
   * project's Sandboxes run on its Store's machine (another is Unsupported);
   * a PostgreSQL project's on any machine whose `supports.postgresql_sandbox`
   * is true, `machine` naming it (native when none is named); sandbox.create
   * refuses another with the reason.
   */
  async createSandbox(key, body = {}) {
    const record = await this.record(key)
    const { name, image } = body ?? {}
    if (typeof name !== 'string' || !name) throw refuse(400, 'InvalidInput', 'A Sandbox needs a name.')
    const machine = record.kind === 'postgresql' ? (body.machine ?? 'native') : record.machine
    return this.lfs.sandbox.create(keyOf(record), name, machine, image ? { image } : {})
  }

  /** One Sandbox with its Workspaces (sandbox.get): the top-level Sandboxes table's opened row. */
  async sandbox(name) {
    if (typeof name !== 'string' || !name) throw refuse(400, 'InvalidInput', 'Name the Sandbox.')
    const workspaces = await workspacesOf(this.lfs, name)
    const record = await this.lfs.sandbox.get(name, { page_size: 1, page_pos: 0 })
    return sandboxInfo({ ...record, name }, workspaces)
  }

  /**
   * Mounts a Workspace in Sandbox `name`: `{ branch, fork?, name? }`. Only
   * side Branches are mounted (owner D14: mounting main is refused), so
   * `fork: true` first forks `branch` from main. `name` names the Workspace
   * (its handle is then `<sandbox>:<name>`). Answers workspace.mount's result.
   */
  async mount(sandbox, { branch, fork = false, name } = {}) {
    if (typeof sandbox !== 'string' || !sandbox) throw refuse(400, 'InvalidInput', 'Name the Sandbox.')
    checkBranch(branch)
    if (branch === 'main') throw refuse(400, 'InvalidInput', 'Only side Branches are mounted: fork a Branch from main and mount that.')
    if (fork) {
      const { project } = await this.lfs.sandbox.get(sandbox, { page_size: 1, page_pos: 0 })
      await this.lfs.branch.fork(project, branch, 'main')
    }
    return this.lfs.workspace.mount(sandbox, branch, name ? { name } : {})
  }

  /** workspace.unmount(ws, { discard }): refused while it has changes unless discarded. */
  async unmount(ws, { discard = false } = {}) {
    if (typeof ws !== 'string' || !ws.includes(':')) throw refuse(400, 'InvalidInput', 'A Workspace is named <sandbox>:<name or path>.')
    return this.lfs.workspace.unmount(ws, discard ? { discard: true } : {})
  }

  /** sandbox.close(name, { force }); answers its result, with the `unknown` Workspaces a forced close left. */
  async closeSandbox(name, { force = false } = {}) {
    if (typeof name !== 'string' || !name) throw refuse(400, 'InvalidInput', 'Name the Sandbox to close.')
    return this.lfs.sandbox.close(name, force ? { force: true } : {})
  }

  /** CommitInfo[] of `branch`, newest first, each with its changed paths when LayerFS can compare it with its parent. */
  async commits(key, branch, limitText) {
    checkBranch(branch)
    const limit = limitText == null || limitText === '' ? LIMIT : Number(limitText)
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > PAGE) throw refuse(400, 'InvalidInput', `limit must be a whole number from 1 to ${PAGE}`)
    const { key: project } = projectRef(key)
    // main is a chain of Layers, not a Branch: commit.list refuses it
    if (branch === 'main') return []
    const b = await this.lfs.branch.get(project, branch)
    return this.withChanges(project, branch, await this.ownCommits(project, b, limit))
  }

  /** `{ [branch]: CommitInfo[] }` for several Branches (main's are []); a Branch gone since the caller saw it is left out. */
  async branchCommits(key, branches) {
    const { key: project } = projectRef(key)
    if (!Array.isArray(branches) || branches.length === 0) return {}
    if (branches.length > PAGE) throw refuse(400, 'InvalidInput', `at most ${PAGE} Branches at once`)
    for (const b of branches) checkBranch(b)
    const wanted = [...new Set(branches)]
    const out = Object.fromEntries(wanted.filter((b) => b === 'main').map((b) => [b, []]))
    const listed = new Map((await pages((p) => this.lfs.branch.list(project, p))).map((b) => [b.name, b]))
    await each(wanted.filter((b) => b !== 'main' && listed.has(b)), WIDTH, async (branch) => {
      try {
        out[branch] = await this.withChanges(project, branch, await this.ownCommits(project, listed.get(branch), LIMIT))
      } catch (error) {
        if (error?.code !== 'NoSuchBranch') throw error
      }
    })
    return out
  }

  /** A Branch's own Commits (records), newest first: commit.list stops at the fork. */
  async ownCommits(project, branch, limit) {
    const own = []
    for (let pos = 0; pos !== null && own.length < limit; ) {
      const page = await this.lfs.commit.list(project, branch.name, { page_size: Math.min(PAGE, limit), page_pos: pos })
      for (const c of page.items) {
        if (c.id === branch.forked_from || own.length >= limit) return own
        own.push(c)
      }
      pos = page.next_page_pos ?? null
    }
    return own
  }

  /** CommitInfo[] of records, each with its changed paths. */
  async withChanges(project, branch, records) {
    const commits = records.map((c) => commitInfo(c, branch))
    await each(records, WIDTH, async (c, index) => {
      const changes = await this.changesOf(project, c)
      if (changes) commits[index].changes = changes
    })
    return commits
  }

  /**
   * One Commit's changed paths: commit.diff from its parent. A Branch's first
   * Commit has no parent Commit and 2.0 cannot diff a Layer with a Commit
   * (§9 Q3), so its changes are left out. A failed diff is logged.
   */
  async changesOf(project, c) {
    if (this.changes.has(c.id)) return this.changes.get(c.id)
    if (!c.parent) return null
    try {
      const items = []
      for (let cursor = null, pos = 0; ; ) {
        const page = await this.lfs.commit.diff(project, c.parent, c.id, { paths_only: true, page_size: PAGE, ...(cursor ? { cursor } : { page_pos: pos }) })
        items.push(...page.items.map(({ path, kind }) => ({ path, kind: String(kind).toLowerCase() })))
        if (page.next_cursor) cursor = page.next_cursor
        else if (page.next_page_pos != null) pos = page.next_page_pos
        else break
      }
      keep(this.changes, c.id, items, KEEP_CHANGES)
      return items
    } catch (error) {
      this.log(`[host] changes of ${c.id}: ${error?.message ?? error}`)
      return null
    }
  }

  /** FsEntry[] of one folder; files get their size when the folder has at most STAT_MAX. */
  async listDir(key, branch, path) {
    checkBranch(branch)
    checkPath(path)
    const { key: project } = projectRef(key)
    const items = await pages((p) => this.lfs.file.list(project, branch, path, p))
    const entries = items.map((i) => ({ name: i.name, path: i.path, kind: i.type ?? 'file', size: typeof i.size === 'number' ? i.size : null, mode: i.mode ?? null }))
    const files = entries.filter((e) => e.kind === 'file' && e.size === null)
    if (files.length <= STAT_MAX) {
      await each(files, WIDTH, async (e) => {
        const stat = await this.lfs.file.stat(project, branch, e.path)
        e.size = typeof stat.size === 'number' ? stat.size : null
        if (typeof stat.mode === 'number') e.mode = stat.mode
      })
    }
    return entries
  }

  /** `{ path, size, binary, text }`: text null when binary or over FILE_MAX; `truncated` when a line was too long to read whole. */
  async file(key, branch, path) {
    checkBranch(branch)
    checkPath(path)
    const { key: project } = projectRef(key)
    const stat = await this.lfs.file.stat(project, branch, path)
    if (stat.type === 'dir') throw refuse(400, 'IsDirectory', `${path} is a folder`)
    const size = typeof stat.size === 'number' ? stat.size : null
    if (size !== null && size > FILE_MAX) return { path, size, binary: false, text: null }
    let text = ''
    let truncated = false
    try {
      for (let line = 1; line !== null; ) {
        const window = await this.lfs.file.read(project, branch, path, { start_line: line })
        text += window.text ?? ''
        truncated ||= !!window.line_truncated
        line = window.next_line ?? null
      }
    } catch (error) {
      if (error?.code === 'Binary') return { path, size, binary: true, text: null }
      throw error
    }
    return { path, size: size ?? Buffer.byteLength(text), binary: false, text, ...(truncated ? { truncated } : {}) }
  }

  /**
   * project.remove: refused InUse while any of its Sandbox records exists
   * (close them first: closeSandboxes), Unsupported for a PostgreSQL project.
   */
  async remove(key) {
    const { key: project } = projectRef(key)
    await this.lfs.project.remove(project)
    return { removed: true }
  }

  /** Closes every Sandbox of the project (`force` passes on); answers each close. */
  async closeSandboxes(key, { force = false } = {}) {
    const { key: project } = projectRef(key)
    const listed = await pages((p) => this.lfs.sandbox.list(project, p))
    const out = []
    for (const s of listed) out.push(await this.closeSandbox(s.name, { force }))
    return out
  }

  /** Lets active Inits finish. */
  async close() {
    await Promise.all(this.creations.values())
  }
}

const bytesOf = (n) => (typeof n === 'number' && n > 0 ? n : 0)

/**
 * StoreStats summed over the Commits read (each record's logical, new_canonical,
 * new_stored, new_metadata), marked partial: 2.0 has no Store totals, so Init,
 * main's Layers and history before these Commits are not counted. Null with no Commit.
 */
export function commitStats(byId, file) {
  const commits = [...byId.values()]
    .map((c) => ({ ...commitInfo(c), logical: bytesOf(c.logical), canonical: bytesOf(c.new_canonical), stored: bytesOf(c.new_stored), metadata: bytesOf(c.new_metadata) }))
    .sort((a, b) => (a.at ?? 0) - (b.at ?? 0))
  if (!commits.length) return null
  const sum = (key) => commits.reduce((a, c) => a + c[key], 0)
  const [logical, canonical, stored] = [sum('logical'), sum('canonical'), sum('stored')]
  return {
    partial: true,
    logical,
    canonical,
    stored,
    metadata: sum('metadata'),
    file: file?.exists ? bytesOf(file.bytes) : 0,
    free: 0,
    dedupe: canonical > 0 ? logical / canonical : null,
    compression: stored > 0 ? canonical / stored : null,
    init: null,
    main: null,
    commits: commits.map(({ id, branch, message, at, kind, logical, canonical, stored }) => ({ id, branch, message, at, kind, logical, canonical, stored })),
  }
}

/** BranchInfo[] from branch.list records and the Commits read (by id). */
export function branchInfos(listed, byId) {
  const merges = [...byId.values()].filter((c) => c.via === 'merge')
  return listed.map((b) => {
    if (b.name === 'main') return { name: 'main', head: b.base ?? null, parent: null, forkedFrom: null, state: 'open', commits: 0 }
    const head = b.head ?? null
    const parent = b.forked_from ? (isLayer(b.forked_from) ? 'main' : (byId.get(b.forked_from)?.branch ?? null)) : null
    let commits = 0
    for (const c of byId.values()) if (c.branch === b.name) commits++
    // which Branches were published has no 2.0 read (§9 Q3): a Branch is open or merged
    const merged = !!head && merges.some((c) => c.branch !== b.name && (c.parent === head || c.second_parent === head || c.merged_from === head))
    return { name: b.name, head: head ?? b.base ?? null, parent, forkedFrom: b.forked_from ?? null, state: merged ? 'merged' : 'open', commits }
  })
}
