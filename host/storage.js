// Storage on LayerFS 2.0 (docs/layerfs-2.0-integration.md §8 step 5): the
// home's Stores by machine, PostgreSQL Stores, buckets and their backups, and
// the moves, backups and restores this host started.
//   view              StorageView: store.list, store.status per Store (it
//                     starts no machine: a Store on a stopped one is `down`),
//                     machine.list for the groups, the buckets and their last
//                     listing, and the job table
//   createStore       store.create(name): a sqlite Store on native
//   removeStore       store.remove(name), `confirm` naming it
//   connectPostgresql store.connect(name, url, { password, synchronous_commit }):
//                     the URL holds no password; `password` is a reference
//   disconnectStore   store.disconnect(name): a PostgreSQL Store
//   connectBucket     backup.connect(name, url, { key, region }): `key` is a
//                     reference (env:LAYERFS_… or file:/absolute/path)
//   disconnectBucket  backup.disconnect(name): every Store's link to it goes
//   listBucket        backup.list(bucket): one call per bucket, its seven states
//   move              store.move(store, machine, { on_progress }) as a job
//   backup            backup.create(store, bucket, file?, { on_progress }) as a job
//   restore           backup.restore(store, bucket, file?, { on_progress }) as a
//                     job: it installs a new Store on native
// Secrets never pass through Connect: buckets and PostgreSQL Stores take
// env:/file: references, which LayerFS resolves. Connect keeps no secret and
// no storage.json; the bucket names it connected are in <state>/buckets.json
// (names only), since 2.0 has no bucket listing that contacts no bucket
// (§9 Q7). Events ('event', forwarded on /api/events): { type: 'storage-job',
// job } as a job moves, { type: 'storage' } when the view changed.
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { layerfs } from './layerfs.js'

const refuse = (status, code, message) => Object.assign(new Error(message), { status, code })

/** Finished jobs kept in the table. */
const KEEP_JOBS = 30
/** A project list joins a view this recent instead of reading one. */
const JOIN_MS = 15_000

/** A reference LayerFS resolves: env:LAYERFS_… or file:/absolute/path. */
const REFERENCE = /^(env:LAYERFS_[A-Z0-9_]+|file:\/.+)$/

function checkReference(value, what) {
  if (typeof value !== 'string' || !REFERENCE.test(value)) throw refuse(400, 'InvalidInput', `${what} must be a reference: env:LAYERFS_<NAME> or file:/absolute/path (Connect never takes the secret itself)`)
}
function checkName(value, what) {
  if (typeof value !== 'string' || !value) throw refuse(400, 'InvalidInput', `${what} needs a name`)
}

/** A URL with no password in it (and, for a bucket, no user either). */
function checkUrl(value, what, { user = true } = {}) {
  let url
  try {
    url = new URL(value)
  } catch {
    throw refuse(400, 'InvalidInput', `${what} is not a URL`)
  }
  if (url.password || (user && url.username)) throw refuse(400, 'InvalidInput', `${what} must not hold a ${user ? 'user or ' : ''}password: give the secret as a reference`)
}

/** A store.list item and its store.status -> StoreRow. */
export function storeRow(s, status, jobs) {
  const file = status?.file
  return {
    name: s.name,
    kind: s.kind ?? 'sqlite',
    machine: s.machine ?? null,
    projects: (s.projects ?? []).map(String),
    created: s.created ?? null,
    size: file?.exists ? { bytes: (file.bytes ?? 0) + (file.wal_bytes ?? 0), file: file.bytes ?? 0, wal: file.wal_bytes ?? 0 } : null,
    state: status?.state ?? 'unknown',
    holders: (status?.holders ?? []).length,
    down: status?.down_reason ?? (status ? null : 'store.status did not answer'),
    links: Object.entries(s.backups ?? {}).map(([bucket, link]) => ({ bucket, file: link.file ?? s.name, last: link.last ? { op: link.last.op, at: link.last.at ?? null, bytes: link.last.bytes ?? null } : null })),
    job: jobs.find((j) => j.store === s.name && !j.ended)?.id ?? null,
  }
}

export class Storage extends EventEmitter {
  /**
   * @param {object} o
   * @param {object} o.spec config.js's spec
   * @param {object} [o.projects] projects.js's Projects (unused here; kept for main.js)
   * @param {(line: string) => void} [o.log]
   * @param {object} [o.client] a LayerFS client (tests pass a stand-in)
   */
  constructor({ spec, log = (line) => process.stderr.write(`${line}\n`), client = null }) {
    super()
    this.spec = spec
    this.log = log
    this.lfs = client ?? layerfs(spec)
    /** job id -> StorageJob */
    this.jobs = new Map()
    /** bucket name -> { at, items, error } (its last backup.list) */
    this.listings = new Map()
    this.lastView = null
    this.bucketsFile = join(spec.state, 'buckets.json')
  }

  changed() {
    this.lastView = null
    this.emit('event', { type: 'storage' })
  }

  /** The bucket names this host connected (names only). */
  knownBuckets() {
    try {
      return existsSync(this.bucketsFile) ? JSON.parse(readFileSync(this.bucketsFile, 'utf8')).filter((n) => typeof n === 'string') : []
    } catch {
      return []
    }
  }

  saveBuckets(names) {
    writeFileSync(`${this.bucketsFile}.tmp`, JSON.stringify([...new Set(names)].sort()), { mode: 0o600 })
    renameSync(`${this.bucketsFile}.tmp`, this.bucketsFile)
  }

  /** StorageView. */
  async view() {
    const [listed, machines] = await Promise.all([this.lfs.store.list(), this.lfs.machine.list()])
    const items = listed.items ?? []
    const statuses = await Promise.all(items.map((s) => this.lfs.store.status(s.name).catch((error) => (this.log(`[storage] store.status ${s.name}: ${error?.message ?? error}`), null))))
    const jobs = this.jobList()
    const stores = items.map((s, i) => storeRow(s, statuses[i], jobs))
    const names = new Set([...this.knownBuckets(), ...stores.flatMap((s) => s.links.map((l) => l.bucket))])
    const buckets = [...names].sort().map((name) => {
      const listing = this.listings.get(name)
      return { name, listed: listing?.at ?? null, files: listing?.items ?? null, error: listing?.error ?? null, stores: stores.filter((s) => s.links.some((l) => l.bucket === name)).map((s) => s.name) }
    })
    const view = {
      machines: (machines.machines ?? []).map((m) => ({ name: m.name, platform: m.platform, state: m.state ?? null })),
      stores,
      buckets,
      jobs,
      at: Date.now(),
    }
    this.lastView = view
    return view
  }

  /** Store name -> { state, machine } for the project list: a recent view, else a new one. */
  async projectJoin() {
    const view = this.lastView && Date.now() - this.lastView.at < JOIN_MS ? this.lastView : await this.view()
    return new Map(view.stores.map((s) => [s.name, { state: s.state, machine: s.machine }]))
  }

  // ---------- Stores ----------

  async createStore({ name } = {}) {
    checkName(name, 'A Store')
    await this.lfs.store.create(name)
    this.changed()
    return this.view()
  }

  async removeStore(name, { confirm } = {}) {
    if (confirm !== name) throw refuse(400, 'InvalidInput', `type the Store's name (${name}) to remove it and every project in it`)
    await this.lfs.store.remove(name)
    this.changed()
    return this.view()
  }

  /** A PostgreSQL database as a Store: { name, url (no password), password (a reference), synchronousCommit? }. */
  async connectPostgresql({ name, url, password, synchronousCommit } = {}) {
    checkName(name, 'A PostgreSQL Store')
    checkUrl(url, 'The database URL', { user: false })
    checkReference(password, 'The password')
    await this.lfs.store.connect(name, url, { password, ...(synchronousCommit ? { synchronous_commit: synchronousCommit } : {}) })
    this.changed()
    return this.view()
  }

  async disconnectStore(name) {
    await this.lfs.store.disconnect(name)
    this.changed()
    return this.view()
  }

  // ---------- buckets ----------

  /** An r2 or MinIO bucket: { name, url, key (a reference), region? }. */
  async connectBucket({ name, url, key, region } = {}) {
    checkName(name, 'A bucket')
    if (typeof url !== 'string' || !/^(https?:\/\/|r2:\/\/)/.test(url)) throw refuse(400, 'InvalidInput', 'A bucket URL is http(s)://<host>/<bucket>/<prefix> (MinIO) or r2://<account>/<bucket>/<prefix>')
    if (!url.startsWith('r2://')) checkUrl(url, 'The bucket URL')
    checkReference(key, 'The key')
    await this.lfs.backup.connect(name, url, { key, ...(region ? { region } : {}) })
    this.saveBuckets([...this.knownBuckets(), name])
    this.changed()
    return this.view()
  }

  /** Drops the bucket; LayerFS drops every Store's link to it too. Answers which Stores lost theirs. */
  async disconnectBucket(name) {
    const done = await this.lfs.backup.disconnect(name)
    this.saveBuckets(this.knownBuckets().filter((n) => n !== name))
    this.listings.delete(name)
    this.changed()
    return { unlinked: done.unlinked ?? [], view: await this.view() }
  }

  /** backup.list(bucket): its files with their states, kept as the bucket's last listing. */
  async listBucket(name) {
    checkName(name, 'A bucket')
    try {
      const listed = await this.lfs.backup.list(name)
      const items = (listed.items ?? []).map((i) => ({ file: i.file, store: i.store ?? null, state: i.state, bytes: i.bytes ?? null, modified: i.modified ?? null, reason: i.reason ?? null }))
      this.listings.set(name, { at: Date.now(), items, error: null })
    } catch (error) {
      this.listings.set(name, { at: Date.now(), items: this.listings.get(name)?.items ?? null, error: { code: error?.code ?? 'Failed', message: error?.message ?? String(error) } })
    }
    this.changed()
    return this.listings.get(name)
  }

  /** Lists every bucket (`only`: one), each on its own call. */
  async check({ bucket } = {}) {
    const view = await this.view()
    const names = bucket ? [bucket] : view.buckets.map((b) => b.name)
    await Promise.all(names.map((n) => this.listBucket(n)))
    return this.view()
  }

  // ---------- jobs ----------

  jobList() {
    return [...this.jobs.values()].reverse().map((j) => ({ ...j }))
  }

  job(id) {
    const job = this.jobs.get(id)
    if (!job) throw refuse(404, 'NotFound', 'no such job: it ended long ago or another host started it')
    return { ...job }
  }

  /** Starts one LayerFS call with on_progress as a job; answers the job at once. */
  start(kind, store, target, file, run) {
    if ([...this.jobs.values()].some((j) => j.store === store && !j.ended)) throw refuse(409, 'Busy', `a job of this host is running on ${store}`)
    const job = { id: randomUUID(), kind, store, target, file: file ?? null, started: Date.now(), ended: null, phase: null, done: null, total: null, error: null, result: null }
    this.jobs.set(job.id, job)
    while (this.jobs.size > KEEP_JOBS) {
      const oldest = [...this.jobs.values()].find((j) => j.ended)
      if (!oldest) break
      this.jobs.delete(oldest.id)
    }
    const emit = () => this.emit('event', { type: 'storage-job', job: { ...job } })
    const on_progress = (p) => {
      if (typeof p?.phase === 'string') job.phase = p.phase
      job.done = typeof p?.done === 'number' ? p.done : null
      job.total = typeof p?.total === 'number' && p.total > 0 ? p.total : null
      emit()
    }
    run(on_progress)
      .then(
        (result) => (job.result = result ?? null),
        (error) => {
          // a refusal names the phase it stopped in; Unknown means both copies were kept
          job.error = { code: error?.code ?? 'Failed', message: error?.message ?? String(error), phase: error?.detail?.phase ?? job.phase }
          this.log(`[storage] ${kind} ${store}: ${error?.code ?? ''} ${error?.message ?? error}`)
        },
      )
      .finally(() => {
        job.ended = Date.now()
        emit()
        // the bucket's listing changed with a backup or restore
        if (kind !== 'move') void this.listBucket(target).catch(() => {})
        this.changed()
      })
    emit()
    this.changed()
    return { ...job }
  }

  /** store.move(store, machine): an idle sqlite Store to any machine. */
  move(store, machine) {
    checkName(store, 'A move')
    checkName(machine, 'A move')
    return this.start('move', store, machine, null, (on_progress) => this.lfs.store.move(store, machine, { on_progress }))
  }

  /** backup.create(store, bucket, file?). */
  backup(store, { bucket, file } = {}) {
    checkName(store, 'A backup')
    checkName(bucket, 'A backup')
    return this.start('backup', store, bucket, file, (on_progress) => this.lfs.backup.create(store, bucket, file || undefined, { on_progress }))
  }

  /** backup.restore(store, bucket, file?): a new Store `store` on native. */
  restore({ store, bucket, file } = {}) {
    checkName(store, 'A restore')
    checkName(bucket, 'A restore')
    return this.start('restore', store, bucket, file, (on_progress) => this.lfs.backup.restore(store, bucket, file || undefined, { on_progress }))
  }

  close() {}
}
