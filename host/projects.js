// The host's real LayerFS reads (README.md, "HTTP API"), mapped into the
// types of src/shared/host-api.ts, and project removal.
//   status        runtime.status(), plus the worker start this host made
//   list          runtime.project.list(), each marked with the run that made it
//   state         runtime.project.get_state(name): Branches, Commits, Layers and
//                 the running Sandboxes' Workspaces, one read that starts no
//                 Sandbox; runtime.sandbox.list() adds each container's state;
//                 backend.store.project.get_storage() the Store's totals, and
//                 each Commit record its own added bytes
//   commits       branch.list_commits, newest first, and each Commit's changed
//                 paths from branch.diff_commits against its parent
//   listDir/file  fs.list, fs.stat and fs.read
//   create        runtime.project.start_init(name, folder): a new project from
//                 a folder, or from an empty one Connect keeps; its Init job
//                 is read with initJob (runtime.project.get_init)
//   remove        runtime.project.delete(name, { confirm: name })
//   storeBytes    the Store file's size (with its WAL): stat on Linux, one
//                 stat in the home's worker container on macOS
// Branch, Commit and file reads go through one @layerfs/agent client per
// project, opened after the runtime (so on macOS it uses the home's worker)
// and closed after a quiet minute. Every LayerFS call is made once; a
// refusal passes through with its code.
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { LayerFS } from '@layerfs/agent'
import { LayerFSBackend } from '@layerfs/backend'
import { keyOf, storeOf, VOLUMES, missing as missingSettings, openRuntime, withProjectEnv } from './config.js'

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

  /**
   * Starts a new project: Init (runtime.project.start_init, which runs
   * LayerFS's project.init where the Store lives) from `folder`, an absolute
   * directory, or from an empty folder when none is given. Answers the Init
   * job at once; initJob(id) follows it. Init imports a copy: the folder is
   * never linked to the project.
   */
  async create(body = {}) {
    const { name } = body
    checkName(name)
    let folder = body.folder ?? null
    if (folder === null || folder === '') folder = this.emptySource()
    else if (typeof folder !== 'string' || !isAbsolute(folder)) throw refuse(400, 'invalid-input', 'the folder is an absolute path')
    // layerfs#506: Init into an existing Store when `store` names one; else into a new Store, as before
    const options = {}
    if (body.store != null) {
      checkName(body.store)
      options.store = body.store
    }
    const runtime = await this.runtime()
    return initView(await runtime.project.start_init(name, folder, options), folder === this.emptySource())
  }

  /** An Init job started by create: its step and counts; 404 once the runtime has dropped it. */
  async initJob(id) {
    if (typeof id !== 'string' || !id) throw refuse(400, 'invalid-input', 'an Init job id')
    const job = await (await this.runtime()).project.get_init(id)
    if (!job) throw refuse(404, 'not-found', `no Init job ${id}`)
    return initView(job, job.source === this.emptySource())
  }

  /** The empty folder an empty project is Inited from: <state>/empty-project, made empty again each time. */
  emptySource() {
    const dir = join(this.spec.state, 'empty-project')
    if (!existsSync(dir) || readdirSync(dir).length) {
      rmSync(dir, { recursive: true, force: true })
      mkdirSync(dir, { recursive: true })
    }
    return dir
  }

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
    const joined = join ? (join.get(storeOf(p)) ?? { storeSync: null, storeProviders: [], connection: p.connection ?? null }) : null
    return {
      name: p.name,
      volume: p.volume ?? null,
      source: p.source ?? null,
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

  /**
   * One project's state read at a time: a poll while one runs shares it.
   * get_state asks every mounted Workspace's daemon for its overlay storage,
   * which a large Workspace takes minutes to scan; a read the page gave up on
   * (STATE_MS) still runs in the daemon, so starting another per poll piled
   * scans onto its connections until the agents' own calls waited forever.
   */
  oneRead(record, read) {
    this.reading ??= new Map()
    const key = keyOf(record)
    let pending = this.reading.get(key)
    if (!pending) {
      pending = read().finally(() => this.reading.delete(key))
      this.reading.set(key, pending)
    }
    return pending
  }

  /** ProjectState: one get_state read, Branch Commit counts and the containers' states. */
  async state(name, store = null) {
    const record = await this.record(name, store)
    const runtime = await this.runtime()
    const read = () =>
      record.kind === 'postgresql'
        ? this.postgresqlUrl(record.store).then((url) => readState(runtime, name, record.store, url))
        : readState(runtime, name, record.shared ? record.store : null)
    const [st, containers] = await Promise.all([
      // a Sandbox whose daemon stopped answering would hold the read forever: the page gets an error instead
      withinMs(this.oneRead(record, read), STATE_MS, `reading ${name}'s state`),
      runtime.sandbox.list().catch((error) => {
        this.log(`[host] sandbox.list: ${error?.message ?? error}`)
        return []
      }),
    ])
    // get_state lists 64 Branches at most (moreBranches): History needs them all
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
      sandboxes: sandboxInfos(record, st, containers),
      last: newest ? commitInfo(newest) : null,
      commits: byId.size,
      store: file,
      storage: totals && storeStats(totals, st, branches, byId),
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

  /** BranchInfo[] from a get_state answer; Branches whose Commits it cut short are listed (branch.list_commits) to count them. */
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

  /** Removes the project through the runtime (its Sandboxes must have closed): `{ removed: true }`. A PostgreSQL Store's project needs its connection's URL. */
  async remove(name, store = null) {
    const record = await this.record(name, store)
    await this.forget(keyOf(record))
    const options = { confirm: name, stopSandboxes: false }
    if (record.shared) options.store = record.store
    if (record.kind === 'postgresql') options.url = await this.postgresqlUrl(record.store)
    await (await this.runtime()).project.delete(name, options)
    return { removed: true }
  }

  // ---------- clients ----------

  /**
   * Opens the client of `record` (a runtime project record): LayerFS.open
   * with the project's LAYERFS_* settings. A project of a PostgreSQL Store
   * also gets its connection's URL (LAYERFS_STORE_POSTGRESQL), which only
   * Connect holds.
   */
  async open(record) {
    await this.runtime()
    if (!record.initialized) throw refuse(404, 'NoSuchProject', `no initialized LayerFS project named ${record.name}`)
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

  /** Runs `fn(client)` with the open client of `record` (by keyOf), opened once and closed after IDLE_MS unused. */
  async use(record, fn) {
    const name = keyOf(record)
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

  /** Closes every client (the runtime is the caller's). */
  async close() {
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

/** SandboxInfo[]: get_state's running and gone Sandboxes, with their containers' states, and containers of the project neither lists. */
function sandboxInfos(record, st, containers) {
  const store = record.shared ? record.store : null
  const mine = new Map(containers.filter((c) => c.project === record.name && (c.store ?? null) === store && c.sandbox != null).map((c) => [String(c.sandbox), c]))
  const seen = new Set()
  const workspace = (id) => (w) => {
    const path = w.path ?? w.directory
    const branch = typeof w.branch === 'string' ? w.branch : (w.branch?.name ?? '')
    return { ws: `${id}:${path}`, branch, path }
  }
  const info = (s, fallback, workspaces) => {
    const id = String(s.id)
    seen.add(id)
    const c = mine.get(id)
    return { id, name: s.name ?? c?.name ?? id, state: c?.state ?? fallback, image: s.image ?? c?.image ?? null, workspaces }
  }
  const out = [
    ...(st.sandboxes ?? []).map((s) => info(s, 'running', (s.workspaces ?? []).filter((w) => w.mounted !== false && (w.path ?? w.directory)).map(workspace(String(s.id))))),
    ...(st.gone ?? []).map((s) => info(s, 'gone', [])),
  ]
  for (const [id, c] of mine) if (!seen.has(id)) out.push({ id, name: c.name, state: c.state, image: c.image ?? null, workspaces: [] })
  return out
}

/** An Init job as the app shows it (InitJob in src/shared/host-api.ts). */
function initView(job, empty) {
  const { id, name, source, started, step, scanned, totals, imported, error, ended } = job
  return { id, name, source: empty ? null : source, started, step, scanned: scanned ?? null, totals: totals ?? null, imported: imported ?? null, error: error ?? null, ended: ended ?? null }
}

/** How long a project state read may take before the page is told so. */
const STATE_MS = 45_000
/** Reads of a project's state before a vanished Workspace or Sandbox fails it. */
const STATE_TRIES = 5

/**
 * A read refused because a Workspace or Sandbox went away while it was read:
 * get_state lists the Workspaces, then reads each one, and on a project where
 * scenarios play they mount and unmount every second.
 */
const vanished = (error) => /Workspace path absent|UnexpectedEof|NoSuchWorkspace|NoSuchSandbox/.test(`${error?.code ?? ''} ${error?.message ?? ''}`)

/** runtime.project.get_state (of the shared Store `store` when given), read again (up to STATE_TRIES) when what it read went away meanwhile. */
export async function readState(runtime, name, store = null, url = null) {
  for (let attempt = 1; ; attempt++) {
    try {
      // a PostgreSQL Store's project is read with its connection's URL, for this call only (layerfs#506 d)
      return await (store ? runtime.project.get_state(name, undefined, { store, ...(url ? { url } : {}) }) : runtime.project.get_state(name))
    } catch (error) {
      if (attempt >= STATE_TRIES || !vanished(error)) throw error
      await new Promise((resolve) => setTimeout(resolve, 50 * attempt))
    }
  }
}

/** `promise`, or a 504 Timeout refusal after `ms`. */
function withinMs(promise, ms, what) {
  let timer
  const late = new Promise((_, reject) => {
    timer = setTimeout(() => reject(refuse(504, 'Timeout', `${what}: no answer in ${ms / 1000} s (a Sandbox's daemon may not be answering)`)), ms)
  })
  return Promise.race([promise, late]).finally(() => clearTimeout(timer))
}
