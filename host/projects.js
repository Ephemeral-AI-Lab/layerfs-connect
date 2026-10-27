// The host's real LayerFS reads (README.md, "HTTP API"), mapped into the
// types of src/shared/host-api.ts, and project removal.
//   status        runtime.status(), plus the worker start this host made
//   list          runtime.project.list(), each marked with the run that made it
//   state         runtime.project.get_state(name): Branches, Commits, Layers and
//                 the running Sandboxes' Workspaces, one read that starts no
//                 Sandbox; runtime.sandbox.list() adds each container's state
//   commits       branch.list_commits, newest first, and each Commit's changed
//                 paths from branch.diff_commits against its parent
//   listDir/file  fs.list, fs.stat and fs.read
//   remove        runtime.project.remove(name, { confirm: name })
//   storeBytes    the Store file's size (with its WAL): stat on Linux, one
//                 stat in the home's worker container on macOS
// Branch, Commit and file reads go through one @layerfs/agent client per
// project, opened after the runtime (so on macOS it uses the home's worker)
// and closed after a quiet minute. Every LayerFS call is made once; a
// refusal passes through with its code.
import { execFile } from 'node:child_process'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { LayerFS } from '@layerfs/agent'
import { LayerFSBackend } from '@layerfs/backend'
import { VOLUMES, missing as missingSettings, openRuntime, withProjectEnv } from './config.js'

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

  /** At startup: starts the worker when this platform has one, its settings are complete and it is not running. Never throws. */
  async ensureWorker() {
    if (!this.spec.worker || missingSettings(this.spec).length) return
    try {
      const { worker } = await (await this.runtime()).status()
      if (worker?.state === 'running') return
      this.log(`[host] starting the worker ${worker?.name ?? ''} (${worker?.state ?? 'unknown'})`)
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
        for (const r of manager.runs()) if (r?.project && !made.has(r.project)) made.set(r.project, { demo: r.demo ?? null, run: r.id ?? null })
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
        if (typeof r?.project === 'string' && !made.has(r.project)) made.set(r.project, { demo: r.demo ?? null, run: r.id ?? folder.name })
      } catch {
        // a run folder without a readable record made no project we can name
      }
    }
    return made
  }

  summary(p, made) {
    const by = made.get(p.name)
    return { name: p.name, volume: p.volume ?? null, source: p.source ?? null, created: p.created ?? null, initialized: !!p.initialized, demo: by?.demo ?? null, run: by?.run ?? null }
  }

  /** ProjectSummary[]. */
  async list() {
    const made = this.madeBy()
    return (await (await this.runtime()).project.list()).map((p) => this.summary(p, made))
  }

  /** The runtime's record of `name`; 404 when this home has no such project. */
  async record(name) {
    checkName(name)
    const found = (await (await this.runtime()).project.list()).find((p) => p.name === name)
    if (!found) throw refuse(404, 'NoSuchProject', `no LayerFS project named ${name}`)
    return found
  }

  /** ProjectState: one get_state read, Branch Commit counts and the containers' states. */
  async state(name) {
    const record = await this.record(name)
    const runtime = await this.runtime()
    const [st, containers] = await Promise.all([
      runtime.project.get_state(name),
      runtime.sandbox.list().catch((error) => {
        this.log(`[host] sandbox.list: ${error?.message ?? error}`)
        return []
      }),
    ])
    const byId = new Map((st.commits ?? []).map((c) => [c.id, c]))
    const branches = await this.branchInfos(name, st, byId)
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
    const store = { path: record.volume ? storeFile(record.volume) : null, bytes: await this.storeBytes(record.volume) }
    return {
      project: this.summary(record, this.madeBy()),
      branches,
      layers,
      sandboxes: sandboxInfos(name, st, containers),
      last: newest ? commitInfo(newest) : null,
      commits: byId.size,
      store,
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
  async branchInfos(name, st, byId) {
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
      await this.use(name, async ({ layerfs }) => {
        for (const b of cut) {
          for (let pos = 0; pos !== null; ) {
            const page = await layerfs.branch.list_commits(b.name, PAGE, pos)
            for (const c of page.items) if (!byId.has(c.id)) byId.set(c.id, c)
            pos = page.hasMore ? (page.nextPagePos ?? pos + page.items.length) : null
          }
          counts.set(b.name, own(b))
        }
      })
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
  async commits(name, branch, limitText) {
    checkName(name)
    checkBranch(branch)
    const limit = limitText == null || limitText === '' ? LIMIT : Number(limitText)
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > PAGE) throw refuse(400, 'invalid-input', `limit must be a whole number from 1 to ${PAGE}`)
    await this.record(name)
    // main moves only by publish: its history is the Layers in the project's state
    if (branch === 'main') return []
    return this.use(name, async (client) => {
      // list_commits walks first parents past the fork into the parent Branch's
      // Commits (labelled with this Branch); keep this Branch's own, as BranchInfo.commits counts them
      const forks = await client.layerfs.project.list_branches(PAGE, 0)
      const fork = forks.items.find((b) => b.name === branch)?.forkedFrom ?? null
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
    })
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
  async listDir(name, branch, path) {
    checkName(name)
    checkBranch(branch)
    checkPath(path)
    await this.record(name)
    return this.use(name, async ({ layerfs }) => {
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
  async file(name, branch, path) {
    checkName(name)
    checkBranch(branch)
    checkPath(path)
    await this.record(name)
    return this.use(name, async ({ layerfs }) => {
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

  /** Removes the project through the runtime (its Sandboxes must have closed): `{ removed: true }`. */
  async remove(name) {
    await this.record(name)
    await this.forget(name)
    await (await this.runtime()).project.remove(name, { confirm: name, stopSandboxes: false })
    return { removed: true }
  }

  // ---------- clients ----------

  /** Opens `name`'s client: the runtime first, then LayerFS.open with the project's LAYERFS_* settings. */
  async open(name) {
    const runtime = await this.runtime()
    const record = (await runtime.project.list()).find((p) => p.name === name && p.initialized)
    if (!record) throw refuse(404, 'NoSuchProject', `no initialized LayerFS project named ${name}`)
    // LayerFS.open reads the environment before its first await
    const layerfs = await withProjectEnv(this.spec, record, () => LayerFS.open(name))
    return { layerfs, backend: LayerFSBackend.of(layerfs) }
  }

  /** Runs `fn(client)` with the project's open client, opened once and closed after IDLE_MS unused. */
  async use(name, fn) {
    let held = this.clients.get(name)
    if (!held) {
      held = { opening: this.open(name), users: 0, timer: null }
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

/** SandboxInfo[]: get_state's running and gone Sandboxes, with their containers' states, and containers of the project neither lists. */
function sandboxInfos(project, st, containers) {
  const mine = new Map(containers.filter((c) => c.project === project && c.sandbox != null).map((c) => [String(c.sandbox), c]))
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
