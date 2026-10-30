// The host's real LayerFS reads (README.md, "HTTP API"), mapped into the
// types of src/shared/host-api.ts, with project creation and removal.
//   status        runtime.status(), plus the worker start this host made
//   list          runtime.project.list(), each marked with the run that made it
//   create/init   runtime.project.start_init()/get_init(), importing an empty
//                 source or the selected folder, with the runtime's progress;
//                 with `store`, into that existing Store (layerfs#506)
//   state         the Store's facts only, no Sandbox daemon asked:
//                 backend.store.project.get_history() (Branches, Commits,
//                 Layers), project.list_sandboxes() and runtime.sandbox.list()
//                 (each Sandbox's record and container state, no Workspaces),
//                 backend.store.project.get_storage() the Store's totals, and
//                 each Commit record its own added bytes
//   sandboxes     the project's Sandboxes with their mounted Workspaces:
//                 sandbox.list_workspaces per running Sandbox, each with its
//                 own SANDBOX_MS limit; one that does not answer is marked
//                 `reach: busy | unreachable` instead of failing the read
//   commits       branch.list_commits, newest first, and each Commit's changed
//                 paths from branch.diff_commits against its parent
//   listDir/file  fs.list, fs.stat and fs.read
//   remove        runtime.project.delete(name, { confirm: name, store? }), or
//                 project.remove on a LayerFS build from before layerfs#506
//   storeBytes    the Store file's size (with its WAL): stat on Linux, one
//                 stat in the home's worker container on macOS
// Branch, Commit and file reads go through one @layerfs/agent client per
// project, opened after the runtime (so on macOS it uses the home's worker)
// and closed after a quiet minute. Every LayerFS call is made once; a
// refusal passes through with its code.
// Since layerfs#506 a Store holds many projects and a name may be in several
// Stores: a project is found by name and, when needed, its Store (`?store=`),
// and goes by its key (keyOf: `store/name` in a shared Store, else the name).
// A PostgreSQL Store's project is read with its connection's URL, which only
// storage.js holds (this.postgresql, set by main.js).
import { execFile } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import { setTimeout as pause } from 'node:timers/promises'
import { LayerFS } from '@layerfs/agent'
import { LayerFSBackend } from '@layerfs/backend'
import { keyOf, projectRef, storeOf, VOLUMES, missing as missingSettings, openRuntime, withProjectEnv } from './config.js'

export { keyOf }

/** A project's client is closed after this long unused. */
const IDLE_MS = 60_000
/** The SDK's largest page. */
const PAGE = 1000
/** A file larger than this is answered without its text. */
const FILE_MAX = 1024 * 1024
/** A folder with at most this many files gets each file's size (one fs.stat each). */
const STAT_MAX = 200
/** Calls in flight at once for one answer (stats, diffs). */
const WIDTH = 4
/** Commits whose changed paths are kept: a Commit never changes. */
const KEEP_CHANGES = 5000
/** Default and largest Commits per answer. */
const LIMIT = 200

/** How long the Store size may take before it is answered as unknown. */
const SIZE_MS = 5_000

/** Project names, as LayerFS takes them. */
const NAME = /^[a-z0-9](?:[a-z0-9_.-]{0,61}[a-z0-9])?$/
/** Tagged ids: a Layer's first byte is 0x32, a Commit's 0x12. */
const isLayer = (id) => typeof id === 'string' && id.startsWith('32')

const refuse = (status, code, message) => Object.assign(new Error(message), { status, code })

function checkName(name) {
  if (typeof name !== 'string' || !NAME.test(name)) throw refuse(400, 'invalid-input', `${JSON.stringify(name)} is not a project name`)
}
function checkBranch(branch) {
  if (typeof branch !== 'string' || !branch || branch.includes('\0')) throw refuse(400, 'invalid-input', 'branch must be a Branch name, main or a saved id')
}
function checkPath(path) {
  if (typeof path !== 'string' || !path.startsWith('/') || path.includes('\0') || path.split('/').includes('..')) {
    throw refuse(400, 'invalid-input', 'path must be an absolute path')
  }
}

/**
 * Every Branch of the project (project.list_branches, page by page): one page
 * stops short of the size asked (92 of 134 on a crew project), so a single
 * read misses the newest Branches.
 */
async function listBranches(layerfs) {
  const all = []
  for (let pos = 0; pos !== null; ) {
    const page = await layerfs.project.list_branches(PAGE, pos)
    all.push(...page.items)
    pos = page.hasMore && page.items.length ? (page.nextPagePos ?? pos + page.items.length) : null
  }
  return all
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

/** A project's Store file in its volume. */
const storeFile = (volume) => `${VOLUMES}/${volume}/_data/global/store.sqlite`

/** A Commit as the SDK shows it -> CommitInfo. */
const commitInfo = (c, branch) => ({
  id: c.id,
  branch: c.branch ?? branch ?? '',
  message: c.message ?? '',
  at: typeof c.time === 'number' ? c.time : null,
  parent: c.parent ?? null,
  merged: c.secondParent ?? null,
  kind: c.via ?? null,
})

export class Projects {
  /**
   * @param {object} options
   * @param {object} options.spec config.js's resolved spec
   * @param {() => object | null} [options.runs] the RunManager, when loaded
   * @param {(line: string) => void} [options.log]
   */
  constructor({ spec, runs = () => null, log = (line) => process.stderr.write(`${line}\n`) }) {
    this.spec = spec
    this.runs = runs
    this.log = log
    /** name -> { opening: Promise<{ layerfs, backend }>, users, timer } */
    this.clients = new Map()
    /** Commit id -> its changed paths, or null when LayerFS cannot compare it */
    this.changes = new Map()
    /** The worker start in progress, and the last one's failure. */
    this.starting = null
    this.startError = null
    this.initializing = new Set()
    this.creations = new Map()
    this.emptySources = join(spec.state, 'project-sources')
  }

  runtime() {
    return openRuntime(this.spec)
  }

  // ---------- status and the worker ----------

  /** HostStatus. */
  async status() {
    const s = await (await this.runtime()).status()
    let worker = null
    if (s.worker) {
      const w = s.worker
      let error = w.error ?? null
      if (!error && w.state === 'running' && w.answering === false) error = 'the worker runs but does not answer'
      if (!error && w.expected && w.build && w.build !== w.expected) error = `the worker runs ${w.build}; the settings name ${w.expected}`
      if (!error && w.state !== 'running' && this.startError) error = this.startError
      worker = { name: w.name, state: this.starting && w.state !== 'running' ? 'starting' : w.state, build: w.build ?? null, error }
    }
    const docker = { level: s.docker?.level ?? 'down', version: s.docker?.version ?? null, error: s.docker?.error ?? null }
    const { spec } = this
    return {
      platform: s.platform,
      missing: s.missing ?? missingSettings(spec),
      docker,
      worker,
      disk: { home: s.disk?.home ?? null, volumes: s.disk?.volumes ?? null },
      settings: { state: spec.state, home: spec.home, image: spec.image, bundle: spec.bundle, containerPrefix: spec.prefix, docker: spec.docker },
    }
  }

  /** Starts the home's worker (one start at a time), then answers HostStatus. */
  async startWorker() {
    const runtime = await this.runtime()
    this.starting ??= runtime.worker.start().then(
      () => {
        this.startError = null
      },
      (error) => {
        this.startError = error?.message ?? String(error)
        throw error
      },
    ).finally(() => {
      this.starting = null
    })
    await this.starting
    return this.status()
  }

  /** At startup: starts the worker when this platform has one, its settings are complete and it is not running, or runs another build. Never throws. */
  async ensureWorker() {
    if (!this.spec.worker || missingSettings(this.spec).length) return
    try {
      const { worker } = await (await this.runtime()).status()
      // a running worker of another build (the bundle setting changed) cannot
      // see this bundle's daemon, so every Sandbox create fails; start replaces it
      const stale = worker?.state === 'running' && !!worker.expected && worker.build !== worker.expected
      if (worker?.state === 'running' && !stale) return
      this.log(stale ? `[host] replacing the worker ${worker.name}: it runs ${worker.build}, the bundle is ${worker.expected}` : `[host] starting the worker ${worker?.name ?? ''} (${worker?.state ?? 'unknown'})`)
      await this.startWorker()
      this.log('[host] the worker is ready')
    } catch (error) {
      this.startError ??= error?.message ?? String(error)
      this.log(`[host] the worker did not start: ${this.startError}`)
    }
  }

  // ---------- projects ----------

  /** project name -> { demo, run }: the runs that made projects. */
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

  /**
   * ProjectSummary. `join` (Store name -> { storeSync, storeProviders,
   * connection }, from storage.js's view) adds the Store's sync state, copy
   * providers and PostgreSQL connection; without it they are left out.
   */
  summary(p, made, join = null) {
    // runs name their project by key: a project of a shared Store is not the run's same-named one (layerfs#506)
    const by = made.get(keyOf(p))
    const source = p.source && dirname(p.source) !== this.emptySources ? p.source : null
    const joined = join ? (join.get(storeOf(p)) ?? { storeSync: null, storeProviders: [], connection: p.connection ?? null }) : null
    return {
      name: p.name,
      volume: p.volume ?? null,
      source,
      created: p.created ?? null,
      initialized: !!p.initialized,
      demo: by?.demo ?? null,
      run: by?.run ?? null,
      // layerfs#506: the Store that holds the project (a build before it has one Store per project, unnamed)
      store: typeof p.store === 'string' ? p.store : (p.store?.name ?? null),
      kind: p.kind ?? null,
      shared: !!p.shared,
      key: keyOf(p),
      ...(joined ? { storeSync: joined.storeSync, storeProviders: joined.storeProviders, connection: joined.connection } : {}),
    }
  }

  /**
   * Starts a real Init, either from a supplied folder or an empty source.
   * With `store` (layerfs#506) the project goes into that existing Store;
   * without it, into a new Store of its own, as before.
   */
  async create(input) {
    const { name, source, store = null } = input ?? {}
    checkName(name)
    if (store !== null) checkName(store)
    const key = store === null ? name : `${store}/${name}`
    if (this.initializing.has(key)) throw refuse(409, 'Exists', `a LayerFS project named ${name} is being created${store === null ? '' : ` in Store ${store}`}`)
    if (source !== undefined && (typeof source !== 'string' || !isAbsolute(source) || source.includes('\0') || !statSync(source, { throwIfNoEntry: false })?.isDirectory())) {
      throw refuse(400, 'InvalidInput', 'Choose an existing absolute source folder.')
    }
    this.initializing.add(key)
    let emptySource
    try {
      const runtime = await this.runtime()
      if (source === undefined) {
        mkdirSync(this.emptySources, { recursive: true, mode: 0o700 })
        emptySource = mkdtempSync(join(this.emptySources, 'empty-'))
      }
      const job = await (store === null ? runtime.project.start_init(name, source ?? emptySource) : runtime.project.start_init(name, source ?? emptySource, { store }))
      // Init continues even when the requesting window is no longer polling.
      const completion = this.finishInit(runtime, job, emptySource).catch((error) => {
        this.log(`[host] creating ${name}: ${error.message}`)
      }).finally(() => {
        this.initializing.delete(key)
        this.creations.delete(job.id)
      })
      this.creations.set(job.id, completion)
      return this.initSummary(job)
    } catch (error) {
      this.initializing.delete(key)
      if (emptySource) rmSync(emptySource, { recursive: true, force: true })
      throw error
    }
  }

  async finishInit(runtime, job, emptySource) {
    while (!job.ended) {
      await pause(250)
      const current = await runtime.project.get_init(job.id)
      if (!current) throw refuse(404, 'NoSuchInit', 'The project creation task is no longer available.')
      job = current
    }
    // Only remove our generated source after Init has actually stopped reading it.
    if (emptySource) rmSync(emptySource, { recursive: true, force: true })
  }

  initSummary(job) {
    return {
      ...job,
      source: job.source && dirname(job.source) !== this.emptySources ? job.source : null,
      project: job.project ? this.summary({ ...job.project, initialized: true }, new Map()) : null,
    }
  }

  /** Reads the runtime's job; polling never restarts a failed Init. */
  async init(id) {
    const job = await (await this.runtime()).project.get_init(id)
    if (!job) throw refuse(404, 'NoSuchInit', 'The project creation task is no longer available. Refresh Projects to check its result.')
    return this.initSummary(job)
  }

  /** ProjectSummary[]. */
  async list() {
    const made = this.madeBy()
    const records = await (await this.runtime()).project.list()
    // set by the host (storage.js projectJoin): never opens a Store; a failure leaves the fields out
    const join = this.storeJoin ? await this.storeJoin().catch(() => null) : null
    return records.map((p) => this.summary(p, made, join))
  }

  /**
   * The runtime's record of `name`, of the Store `store` when given; 404
   * when this home has no such project. Since layerfs#506 a name may be in
   * several Stores: then the Store must be named (400 AmbiguousProject).
   */
  async record(name, store = null) {
    checkName(name)
    if (store != null && store !== '') checkName(store)
    else store = null
    const found = (await (await this.runtime()).project.list()).filter((p) => p.name === name && (store === null || storeOf(p) === store))
    if (!found.length) throw refuse(404, 'NoSuchProject', `no LayerFS project named ${name}${store ? ` in Store ${store}` : ''}`)
    if (found.length > 1) throw refuse(400, 'AmbiguousProject', `project ${name} is in Stores ${found.map(storeOf).join(', ')}: name its Store`)
    return found[0]
  }

  /** The record of a project key (ProjectSummary.key): `store/name`, or a bare name. */
  recordOf(key) {
    const ref = projectRef(String(key))
    return this.record(ref.name, ref.store)
  }

  /**
   * One read of `record` at a time: a poll while one runs shares it. A read
   * the page gave up on still runs, so starting another per poll would pile
   * calls onto the same connections. `kind` keeps the history read and the
   * Sandboxes read apart.
   */
  oneRead(record, read, kind = 'state') {
    this.reading ??= new Map()
    const key = `${kind}:${keyOf(record)}`
    let pending = this.reading.get(key)
    if (!pending) {
      pending = read().finally(() => this.reading.delete(key))
      this.reading.set(key, pending)
    }
    return pending
  }

  /**
   * ProjectState from the Store alone: its history, Branch Commit counts, its
   * totals, and its Sandboxes from their records and containers. No Sandbox
   * daemon is asked, so a busy or restarted Sandbox never slows or fails it;
   * their Workspaces come from sandboxes().
   */
  async state(name, store = null) {
    const record = await this.record(name, store)
    const runtime = await this.runtime()
    const [st, listed, containers] = await Promise.all([
      withinMs(this.oneRead(record, () => this.use(record, ({ backend }) => backend.store.project.get_history())), STATE_MS, `reading ${name}'s history`),
      this.listSandboxes(record),
      this.containers(runtime),
    ])
    // get_history lists 64 Branches at most (moreBranches): History needs them all
    if (st.moreBranches) {
      const seen = new Set((st.branches ?? []).map((b) => b.name))
      const rest = (await this.use(record, ({ layerfs }) => listBranches(layerfs))).filter((b) => !seen.has(b.name))
      st.branches = [...(st.branches ?? []), ...rest.map(({ name, head, base, forkedFrom }) => ({ name, head, base, forkedFrom }))]
    }
    const byId = new Map((st.commits ?? []).map((c) => [c.id, c]))
    const branches = await this.branchInfos(record, st, byId)
    const layers = (st.layers ?? []).map((l) => {
      const source = l.sourceCommit ? byId.get(l.sourceCommit) : null
      return {
        id: l.id,
        message: source?.message ?? (l.parent ? '' : 'Init'),
        at: typeof source?.time === 'number' ? source.time : null,
        from: l.sourceBranch ?? null,
      }
    })
    let newest = null
    for (const c of byId.values()) if (typeof c.time === 'number' && (!newest || c.time > newest.time)) newest = c
    const [bytes, totals] = await Promise.all([this.storeBytes(record.volume), this.storeTotals(record)])
    const file = { path: record.volume ? storeFile(record.volume) : null, bytes }
    return {
      project: this.summary(record, this.madeBy()),
      branches,
      layers,
      sandboxes: sandboxInfos(record, listed, containers),
      last: newest ? commitInfo(newest) : null,
      commits: byId.size,
      store: file,
      storage: totals && storeStats(totals, st, branches, byId),
    }
  }

  /** SandboxInfo[] with each running Sandbox's mounted Workspaces, each Sandbox asked on its own (sandboxRead). */
  async sandboxes(name, store = null) {
    const record = await this.record(name, store)
    const runtime = await this.runtime()
    const [listed, containers] = await Promise.all([this.listSandboxes(record), this.containers(runtime)])
    const mine = containersOf(record, containers)
    const reads = await Promise.all(listed.map((s) => this.sandboxRead(record, String(s.id), mine.get(String(s.id)))))
    return sandboxInfos(record, listed, containers, reads)
  }

  /** The project's Sandbox records (project.list_sandboxes, one page), or none (logged) when the Store cannot answer. */
  async listSandboxes(record) {
    try {
      const page = await this.use(record, ({ layerfs }) => layerfs.project.list_sandboxes(1000, 0))
      return page.items.map(({ sandbox, ...rest }) => ({ id: sandbox, ...rest }))
    } catch (error) {
      this.log(`[host] list_sandboxes of ${keyOf(record)}: ${error?.message ?? error}`)
      return []
    }
  }

  /** runtime.sandbox.list(), or none (logged) when Docker cannot answer. */
  containers(runtime) {
    return runtime.sandbox.list().catch((error) => {
      this.log(`[host] sandbox.list: ${error?.message ?? error}`)
      return []
    })
  }

  /**
   * One Sandbox's mounted Workspaces: `{ workspaces }`, `{ gone: true }`, or
   * `{ reach, detail }` when its daemon did not answer within SANDBOX_MS
   * (`busy`) or refused (`unreachable`). A Sandbox whose container is not
   * running is not asked. A call still in flight is shared, not repeated, and
   * a Sandbox that did not answer is not asked again for SANDBOX_REST_MS.
   */
  async sandboxRead(record, id, container) {
    if (!container) return { gone: true }
    if (!container.running) return { workspaces: [] }
    this.sandboxReads ??= new Map()
    this.sandboxRests ??= new Map()
    const key = `${keyOf(record)}#${id}`
    const rest = this.sandboxRests.get(key)
    if (rest && rest.until > Date.now()) return rest.answer
    let pending = this.sandboxReads.get(key)
    if (!pending) {
      pending = this.use(record, ({ layerfs }) => layerfs.sandbox.list_workspaces(id, 1000, 0)).finally(() => this.sandboxReads.delete(key))
      this.sandboxReads.set(key, pending)
    }
    try {
      const page = await withinMs(pending, SANDBOX_MS, `Sandbox ${id}`)
      this.sandboxRests.delete(key)
      return { workspaces: page.items }
    } catch (error) {
      if (error?.code === 'NoSuchSandbox') return { gone: true }
      const busy = error?.code === 'Timeout' || error?.code === 'Busy'
      // the reason is at the end of a daemon's refusal, after the request it echoes
      const message = String(error?.message ?? error)
      const answer = { reach: busy ? 'busy' : 'unreachable', detail: `${error?.code ?? 'Failed'}: ${message.length > 300 ? `…${message.slice(-300)}` : message}`, workspaces: [] }
      // only a daemon that did not answer rests: one that refused at once is asked again next read
      if (busy) this.sandboxRests.set(key, { until: Date.now() + SANDBOX_REST_MS, answer })
      this.log(`[host] Sandbox ${id} of ${keyOf(record)}: ${error?.code ?? ''} ${answer.detail}`)
      return answer
    }
  }

  /** backend.store.project.get_storage, or null (logged) when the Store cannot answer. */
  async storeTotals(record) {
    try {
      return await this.use(record, ({ backend }) => backend.store.project.get_storage())
    } catch (error) {
      this.log(`[host] Store totals of ${keyOf(record)}: ${error?.message ?? error}`)
      return null
    }
  }

  /**
   * The Store file's bytes, its WAL included, or null when it cannot be read
   * (no volume, a platform whose worker is not a container here). One stat.
   */
  async storeBytes(volume) {
    if (!volume) return null
    const files = [storeFile(volume), `${storeFile(volume)}-wal`]
    if (!this.spec.worker) {
      let n = null
      for (const f of files) {
        try {
          n = (n ?? 0) + statSync(f).size
        } catch {
          // no WAL right after a checkpoint; no Store at all reads as unknown
        }
      }
      return n
    }
    const docker = this.spec.docker.startsWith('/') ? `unix://${this.spec.docker}` : this.spec.docker
    const args = ['-H', docker, 'exec', `${this.spec.prefix}worker`, 'stat', '-c', '%s', ...files]
    return new Promise((resolve) => {
      // stat exits 1 when the WAL is missing; the sizes it printed still count
      execFile('docker', args, { timeout: SIZE_MS }, (error, stdout) => {
        const sizes = String(stdout ?? '').split('\n').filter(Boolean).map(Number)
        resolve(sizes.length ? sizes.reduce((a, b) => a + b, 0) : (error && this.log(`[host] Store size of ${volume}: ${error.message.split('\n')[0]}`), null))
      })
    })
  }

  /** BranchInfo[] from a get_history answer; Branches whose Commits it cut short are listed (branch.list_commits) to count them. */
  async branchInfos(record, st, byId) {
    const list = st.branches ?? []
    const own = (b) => {
      let n = 0
      for (let id = b.head; id && id !== b.forkedFrom; ) {
        const c = byId.get(id)
        if (!c) return null
        n++
        id = c.parent
      }
      return n
    }
    const counts = new Map(list.map((b) => [b.name, own(b)]))
    const cut = list.filter((b) => counts.get(b.name) === null)
    if (cut.length) {
      await this.use(record, async ({ layerfs }) => {
        await each(cut, WIDTH, async (b) => {
          for (let pos = 0; pos !== null; ) {
            const page = await layerfs.branch.list_commits(b.name, PAGE, pos)
            for (const c of page.items) if (!byId.has(c.id)) byId.set(c.id, c)
            pos = page.hasMore ? (page.nextPagePos ?? pos + page.items.length) : null
          }
        })
      })
      for (const b of cut) counts.set(b.name, own(b))
    }
    const published = new Set((st.layers ?? []).map((l) => l.sourceBranch).filter(Boolean))
    const merges = [...byId.values()].filter((c) => c.via === 'merge')
    return list.map((b) => {
      const head = b.head ?? null
      let parent = null
      if (b.name !== 'main' && b.forkedFrom) parent = isLayer(b.forkedFrom) ? 'main' : (byId.get(b.forkedFrom)?.branch ?? null)
      let state = 'open'
      if (published.has(b.name)) state = 'published'
      else if (head && merges.some((c) => c.branch !== b.name && (c.parent === head || c.secondParent === head || c.mergedFrom === head))) state = 'merged'
      return { name: b.name, head: head ?? b.base ?? null, parent, forkedFrom: b.forkedFrom ?? null, state, commits: counts.get(b.name) ?? 0 }
    })
  }

  /** CommitInfo[] of `branch`, newest first, each with its changed paths when LayerFS can compare it with its parent. */
  async commits(name, branch, limitText, store = null) {
    checkName(name)
    checkBranch(branch)
    const limit = limitText == null || limitText === '' ? LIMIT : Number(limitText)
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > PAGE) throw refuse(400, 'invalid-input', `limit must be a whole number from 1 to ${PAGE}`)
    const record = await this.record(name, store)
    // main moves only by publish: its history is the Layers in the project's state
    if (branch === 'main') return []
    return this.use(record, async (client) => {
      const forks = await listBranches(client.layerfs)
      return this.ownCommits(client, branch, limit, forks.find((b) => b.name === branch)?.forkedFrom ?? null)
    })
  }

  /**
   * The Commits of several Branches in one call, `{ [branch]: CommitInfo[] }`
   * as commits() gives each (main's are []): History reads every Branch at
   * once. A Branch gone since the caller saw it is left out.
   */
  async branchCommits(name, branches, store = null) {
    checkName(name)
    if (!Array.isArray(branches) || branches.length === 0) return {}
    if (branches.length > PAGE) throw refuse(400, 'invalid-input', `at most ${PAGE} Branches at once`)
    for (const b of branches) checkBranch(b)
    const record = await this.record(name, store)
    const wanted = [...new Set(branches)]
    const out = Object.fromEntries(wanted.filter((b) => b === 'main').map((b) => [b, []]))
    const rest = wanted.filter((b) => b !== 'main')
    if (!rest.length) return out
    return this.use(record, async (client) => {
      const forks = new Map((await listBranches(client.layerfs)).map((b) => [b.name, b.forkedFrom ?? null]))
      await each(rest, WIDTH, async (branch) => {
        if (!forks.has(branch)) return
        try {
          out[branch] = await this.ownCommits(client, branch, LIMIT, forks.get(branch))
        } catch (error) {
          // removed between the list and its read
          if (error?.code !== 'NoSuchBranch') throw error
        }
      })
      return out
    })
  }

  /** `branch`'s own Commits, newest first, with their changed paths. */
  async ownCommits(client, branch, limit, fork) {
    // list_commits walks first parents past the fork into the parent Branch's
    // Commits (labelled with this Branch); keep this Branch's own, as BranchInfo.commits counts them
    const page = await client.layerfs.branch.list_commits(branch, limit, 0)
    const own = []
    for (const c of page.items) {
      if (c.id === fork) break
      own.push(c)
    }
    const commits = own.map((c) => ({ ...commitInfo(c, branch), changes: undefined }))
    await each(own, WIDTH, async (c, index) => {
      const changes = await this.changesOf(client, c)
      if (changes) commits[index].changes = changes
    })
    return commits
  }

  /**
   * One Commit's changed paths: branch.diff_commits from its parent. A first
   * Commit is compared with its base Layer's same-tree Commit
   * (backend.store.project.get_comparable); Init's Layer has none, so such
   * a Commit has no changes here. A failed diff is logged and left out.
   */
  async changesOf(client, c) {
    if (this.changes.has(c.id)) return this.changes.get(c.id)
    try {
      let from = c.parent
      let root = null
      if (!from) {
        try {
          const found = await client.backend.store.project.get_comparable(c.base)
          from = found.commit
          root = found.exact ? null : found.root
        } catch (error) {
          if (error?.code !== 'NotComparable') throw error
          keep(this.changes, c.id, null, KEEP_CHANGES)
          return null
        }
      }
      const page = await client.layerfs.branch.diff_commits(from, c.id, PAGE, 0, { hunks: false })
      const changes = root && page.from?.root !== root ? null : page.items.map(({ path, kind }) => ({ path, kind }))
      keep(this.changes, c.id, changes, KEEP_CHANGES)
      return changes
    } catch (error) {
      this.log(`[host] changes of ${c.id}: ${error?.message ?? error}`)
      return null
    }
  }

  /** FsEntry[] of one folder, every page of it; files get their size when the folder has at most STAT_MAX. */
  async listDir(name, branch, path, store = null) {
    checkName(name)
    checkBranch(branch)
    checkPath(path)
    const record = await this.record(name, store)
    return this.use(record, async ({ layerfs }) => {
      const items = []
      for (let pos = 0; pos !== null; ) {
        const page = await layerfs.fs.list(branch, path, PAGE, pos)
        items.push(...page.items)
        pos = page.hasMore ? (page.nextPagePos ?? pos + page.items.length) : null
      }
      const entries = items.map((i) => ({ name: i.name, path: i.path, kind: i.type ?? 'file', size: typeof i.size === 'number' ? i.size : null, mode: i.mode ?? null }))
      const files = entries.filter((e) => e.kind === 'file' && e.size === null)
      if (files.length <= STAT_MAX) {
        await each(files, WIDTH, async (e) => {
          const stat = await layerfs.fs.stat(branch, e.path)
          e.size = typeof stat.size === 'number' ? stat.size : null
          if (typeof stat.mode === 'number') e.mode = stat.mode
        })
      }
      return entries
    })
  }

  /** `{ path, size, binary, text }`: text null when binary or over FILE_MAX; `truncated` when a line was too long to read whole. */
  async file(name, branch, path, store = null) {
    checkName(name)
    checkBranch(branch)
    checkPath(path)
    const record = await this.record(name, store)
    return this.use(record, async ({ layerfs }) => {
      const stat = await layerfs.fs.stat(branch, path)
      if (stat.type === 'dir') throw refuse(400, 'IsDirectory', `${path} is a folder`)
      const size = typeof stat.size === 'number' ? stat.size : null
      let text = ''
      let truncated = false
      try {
        for (let line = 1; line !== null; ) {
          const window = await layerfs.fs.read(branch, path, line)
          if (size !== null && size > FILE_MAX) return { path, size, binary: false, text: null }
          text += window.text ?? ''
          truncated ||= !!window.lineTruncated
          line = window.nextLine ?? null
        }
      } catch (error) {
        if (error?.code === 'Binary') return { path, size, binary: true, text: null }
        throw error
      }
      return { path, size: size ?? Buffer.byteLength(text), binary: false, text, ...(truncated ? { truncated } : {}) }
    })
  }

  /**
   * Removes the project through the runtime (its Sandboxes must have closed):
   * `{ removed: true }`. runtime.project.delete names the Store of a shared
   * Store's project, and a PostgreSQL Store's project needs its connection's
   * URL; a LayerFS build from before layerfs#506 has project.remove instead.
   */
  async remove(name, store = null) {
    const record = await this.record(name, store)
    await this.forget(keyOf(record))
    const runtime = await this.runtime()
    const options = { confirm: name, stopSandboxes: false }
    if (record.shared) options.store = record.store
    if (record.kind === 'postgresql') options.url = await this.postgresqlUrl(record.store)
    if (typeof runtime.project.delete === 'function') await runtime.project.delete(name, options)
    else await runtime.project.remove(name, options)
    return { removed: true }
  }

  // ---------- clients ----------

  /**
   * Opens a project's client: LayerFS.open with the project's LAYERFS_*
   * settings. `target` is a runtime project record, or a project key (a
   * name, or `store/name`) whose record is read first. A project of a
   * PostgreSQL Store also gets its connection's URL
   * (LAYERFS_STORE_POSTGRESQL), which only Connect holds.
   */
  async open(target) {
    await this.runtime()
    const record = typeof target === 'string' ? await this.recordOf(target) : target
    if (!record?.initialized) throw refuse(404, 'NoSuchProject', `no initialized LayerFS project named ${typeof target === 'string' ? target : target?.name}`)
    const extra = record.kind === 'postgresql' ? { LAYERFS_STORE_PATH: `postgresql:${record.store}`, LAYERFS_STORE_POSTGRESQL: JSON.stringify({ url: await this.postgresqlUrl(record.store) }) } : {}
    // LayerFS.open reads the environment before its first await
    const layerfs = await withProjectEnv(this.spec, record, () => LayerFS.open(record.name), extra)
    return { layerfs, backend: LayerFSBackend.of(layerfs) }
  }

  /** The URL of the connection holding the PostgreSQL Store `store`, as the Store calls reach it; set by the host (storage.js). */
  async postgresqlUrl(store) {
    if (!this.postgresql) throw refuse(501, 'Unsupported', `the PostgreSQL Store ${store} needs its connection, which this host does not hold`)
    return this.postgresql(store)
  }

  /** Runs `fn(client)` with the open client of `record` (a record, by keyOf, or a project key), opened once and closed after IDLE_MS unused. */
  async use(record, fn) {
    const name = typeof record === 'string' ? record : keyOf(record)
    let held = this.clients.get(name)
    if (!held) {
      held = { opening: this.open(record), users: 0, timer: null }
      this.clients.set(name, held)
      const opened = held
      held.opening.catch(() => {
        if (this.clients.get(name) === opened) this.clients.delete(name)
      })
    }
    clearTimeout(held.timer)
    held.users++
    try {
      return await fn(await held.opening)
    } finally {
      if (--held.users === 0 && this.clients.get(name) === held) {
        held.timer = setTimeout(() => void this.forget(name), IDLE_MS)
        held.timer.unref?.()
      }
    }
  }

  /** Closes the project's client now, if it has one. */
  async forget(name) {
    const held = this.clients.get(name)
    if (!held) return
    this.clients.delete(name)
    clearTimeout(held.timer)
    const client = await held.opening.catch(() => null)
    await client?.layerfs.close().catch((error) => this.log(`[host] closing ${name}: ${error?.message ?? error}`))
  }

  /** Lets active Inits finish, then closes every client (the runtime is the caller's). */
  async close() {
    await Promise.all(this.creations.values())
    await Promise.all([...this.clients.keys()].map((name) => this.forget(name)))
  }
}

const count = (n) => (typeof n === 'number' && Number.isFinite(n) ? n : 0)

/** StoreStats: get_storage's totals, main's newest Layer, and each Commit's added bytes (its record's statistics). */
function storeStats(t, st, branches, byId) {
  const head = branches.find((b) => b.name === 'main')?.head
  const layer = (st.layers ?? []).find((l) => l.id === head)
  const commits = [...byId.values()]
    .map((c) => ({
      id: c.id,
      branch: c.branch ?? '',
      message: c.message ?? '',
      at: typeof c.time === 'number' ? c.time : null,
      kind: c.via ?? null,
      logical: count(c.logical),
      canonical: count(c.newCanonical),
      stored: count(c.newStored),
    }))
    .sort((a, b) => (a.at ?? 0) - (b.at ?? 0))
  return {
    logical: count(t.logical),
    canonical: count(t.canonical),
    stored: count(t.stored),
    metadata: count(t.metadata),
    file: count(t.file),
    free: count(t.free),
    dedupe: typeof t.dedupe === 'number' ? t.dedupe : null,
    compression: typeof t.compression === 'number' ? t.compression : null,
    init: t.init ? { files: count(t.init.files), bytes: count(t.init.bytes), stored: count(t.init.stored), millis: count(t.init.millis) } : null,
    main: typeof layer?.logical === 'number' ? layer.logical : null,
    commits,
  }
}

/** The project's Sandbox containers by Sandbox number. */
function containersOf(record, containers) {
  const store = record.shared ? record.store : null
  return new Map(containers.filter((c) => c.project === record.name && (c.store ?? null) === store && c.sandbox != null).map((c) => [String(c.sandbox), c]))
}

/**
 * SandboxInfo[]: the project's Sandbox records with their containers' states,
 * then containers of the project no record lists. With `reads` (sandboxRead
 * per record) each also has its mounted Workspaces, or `reach` when its daemon
 * did not answer; without, the Workspaces are not read.
 */
function sandboxInfos(record, listed, containers, reads = null) {
  const mine = containersOf(record, containers)
  const seen = new Set()
  const workspace = (id) => (w) => {
    const path = w.path ?? w.directory
    const branch = typeof w.branch === 'string' ? w.branch : (w.branch?.name ?? '')
    return { ws: `${id}:${path}`, branch, path }
  }
  const out = listed.map((s, i) => {
    const id = String(s.id)
    seen.add(id)
    const c = mine.get(id)
    const read = reads?.[i]
    const info = { id, name: s.name ?? c?.name ?? id, state: read?.gone || !c ? 'gone' : c.state, image: s.image ?? c?.image ?? null, workspaces: [] }
    if (read?.workspaces) info.workspaces = read.workspaces.filter((w) => w.mounted !== false && (w.path ?? w.directory)).map(workspace(id))
    if (read?.reach) Object.assign(info, { reach: read.reach, detail: read.detail })
    return info
  })
  for (const [id, c] of mine) if (!seen.has(id)) out.push({ id, name: c.name, state: c.state, image: c.image ?? null, workspaces: [] })
  return out
}

/** How long the Store's history read may take before the page is told so. */
const STATE_MS = 45_000
/** How long one Sandbox's daemon may take to list its Workspaces before the Sandbox shows as busy. */
const SANDBOX_MS = 4_000
/** How long a Sandbox that did not answer is left alone before it is asked again. */
const SANDBOX_REST_MS = 10_000

/** `promise`, or a 504 Timeout refusal after `ms`. */
function withinMs(promise, ms, what) {
  let timer
  const late = new Promise((_, reject) => {
    timer = setTimeout(() => reject(refuse(504, 'Timeout', `${what}: no answer in ${ms / 1000} s (the Store may be busy)`)), ms)
  })
  return Promise.race([promise, late]).finally(() => clearTimeout(timer))
}
