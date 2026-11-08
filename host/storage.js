// Storage on LayerFS 2.0 (docs/layerfs-2.0-integration.md §8 step 5): the
// home's Stores by machine, PostgreSQL Stores, buckets and their backups, and
// the pushes, pulls, backups and restores this host started.
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
//   push              store.push(store, machine, { on_progress, on_spawn }) as a job: a
//                     sqlite Store on native to a machine
//   pull              store.pull(store, { on_progress, on_spawn }) as a job: back to native
//   move              between two machines: pull, then push, as one job with
//                     two halves (#537 U5); a push that fails leaves the Store
//                     on native and the job says so
//   place             the one of push, pull or move that puts a Store on a
//                     machine (Compute's "move a Store here", runs)
//   backup            backup.create(store, bucket, file?, { on_progress, on_spawn }) as a job
//   restore           backup.restore(store, bucket, file?, { on_progress, on_spawn }) as a
//                     job: it installs a new Store on native
// Secrets never pass through Connect: buckets and PostgreSQL Stores take
// env:/file: references, which LayerFS resolves. Connect keeps no secret and
// no storage.json; the bucket names it connected are in <state>/buckets.json
// (names only), since 2.0 has no bucket listing that contacts no bucket
// (§9 Q7). Events ('event', forwarded on /api/events): { type: 'storage-job',
// job } as a job moves, { type: 'storage' } when the view changed.
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { doctorOf, layerfs } from './layerfs.js'
import { JobStore } from './jobs/store.js'
import { failureOutcome, transferSummary } from './jobs/move.js'
import { inspectJob } from './jobs/reconcile.js'

const refuse = (status, code, message) => Object.assign(new Error(message), { status, code })

/** Finished jobs kept in the table. */
const KEEP_JOBS = 30
/** A project list joins a view this recent instead of reading one. */
const JOIN_MS = 15_000

/** A reference LayerFS resolves: env:LAYERFS_… or file:/absolute/path. */
const REFERENCE = /^(env:[A-Za-z_][A-Za-z0-9_]*|file:\/.+)$/

function checkReference(value, what) {
  if (typeof value !== 'string' || !REFERENCE.test(value)) throw refuse(400, 'InvalidInput', `${what} must be a reference: env:LAYERFS_<NAME> or file:/absolute/path (Connect never takes the secret itself)`)
}
function checkName(value, what) {
  if (typeof value !== 'string' || !/^[a-z0-9](?:[a-z0-9_.-]{0,61}[a-z0-9])?$/.test(value)) throw refuse(400, 'InvalidInput', `${what} needs a lowercase name (maximum 63 characters), starting and ending with a letter or number`)
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

/** A bucket URL from its parts: MinIO `<endpoint>/<bucket>/<prefix>`, R2 `r2://<account>/<bucket>/<prefix>[?jurisdiction=…]`. */
export function bucketUrl({ provider, endpoint, account, jurisdiction, bucket, prefix } = {}) {
  const path = [bucket, ...(prefix ? [String(prefix).replace(/^\/+|\/+$/g, '')] : [])].filter(Boolean).join('/')
  if (!bucket) throw refuse(400, 'InvalidInput', 'Name the bucket')
  if (provider === 'r2') {
    if (!/^[0-9a-f]{32}$/.test(account ?? '')) throw refuse(400, 'InvalidInput', 'A Cloudflare account id is 32 lowercase hex digits')
    return `r2://${account}/${path}${jurisdiction ? `?jurisdiction=${jurisdiction}` : ''}`
  }
  if (provider === 'minio') {
    if (!/^https?:\/\//.test(endpoint ?? '')) throw refuse(400, 'InvalidInput', 'A MinIO endpoint is http(s)://host:port')
    return `${String(endpoint).replace(/\/+$/, '')}/${path}`
  }
  throw refuse(400, 'InvalidInput', 'Choose MinIO or Cloudflare R2')
}

/** A PostgreSQL URL as `user@host:port/db`, never its password or parameters; null when it does not parse. */
function pgTarget(url) {
  try {
    const u = new URL(url)
    return `${u.username ? `${decodeURIComponent(u.username)}@` : ''}${u.host}${u.pathname}`
  } catch {
    return null
  }
}

/** A PostgreSQL Store's server: its record's URL (no password) and what store.status's `server` answered. */
function pgServer(s, server) {
  const reached = typeof server?.reachable === 'boolean' ? server.reachable : null
  return {
    target: typeof s.url === 'string' ? pgTarget(s.url) : null,
    reachable: reached,
    version: reached ? (server.server_version ?? null) : null,
    latencyMs: reached ? (server.latency_ms ?? null) : null,
    error: server?.unavailable ?? server?.error?.message ?? null,
  }
}

/** A store.list item and its store.status -> StoreRow. */
export function storeRow(s, status, jobs) {
  const op = s.op ?? status?.op ?? null
  const file = status?.file
  return {
    name: s.name,
    kind: s.kind ?? 'sqlite',
    machine: s.machine ?? null,
    projects: (s.projects ?? []).map(String),
    created: s.created ?? null,
    size: file?.exists ? { bytes: (file.bytes ?? 0) + (file.wal_bytes ?? 0), file: file.bytes ?? 0, wal: file.wal_bytes ?? 0 } : null,
    // the SDK's state: store.list's item, derived as store.status derives it (#537 U4)
    state: s.state ?? status?.state ?? 'unknown',
    op: op && typeof op === 'object' ? { id: String(op.id ?? ''), name: String(op.name ?? ''), phase: op.phase ?? '', started: op.started ?? null, uncertain: op.uncertain === true } : null,
    holders: (status?.holders ?? []).length,
    down: status?.down_reason ?? (status ? null : 'store.status did not answer'),
    links: Object.entries(s.backups ?? {}).map(([bucket, link]) => ({ bucket, file: link.file ?? s.name, last: link.last ? { op: link.last.op, at: link.last.at ?? null, bytes: link.last.bytes ?? null } : null })),
    job: jobs.find((j) => j.store === s.name && !j.ended)?.id ?? null,
    postgresql: s.kind === 'postgresql' ? pgServer(s, status?.server) : null,
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
  constructor({ spec, log = (line) => process.stderr.write(`${line}\n`), client = null, doctor = null }) {
    super()
    this.spec = spec
    this.log = log
    this.lfs = client ?? layerfs(spec)
    this.doctorCall = doctor ?? (() => doctorOf(spec))
    /** job id -> StorageJob */
    this.jobStore = new JobStore(spec.state)
    this.jobs = this.jobStore.jobs
    /** bucket name -> { at, items, error } (its last backup.list) */
    this.listings = new Map()
    this.lastView = null
    this.bucketsFile = join(spec.state, 'buckets.json')
    this.reconciled = Promise.resolve().then(async () => {
      for (const job of this.jobs.values()) if (job.outcome === 'interrupted') {
        try { await this.inspect(job.id) } catch (error) { job.reconcileError = { code: error.code ?? 'Failed', message: error.message }; this.jobStore.save() }
      }
    })
  }

  /**
   * What `layerfs doctor` finds in the home (#537 §5 "Needs attention"):
   * `{ ok, findings: [{ severity, entity: { kind, name }, message, fix }], at }`.
   * Report-only; read when the Storage page asks, never on a timer.
   */
  async doctor() {
    const report = await this.doctorCall()
    const findings = (report?.findings ?? []).map((f) => ({
      severity: f?.severity === 'error' ? 'error' : 'warning',
      entity: f?.entity && typeof f.entity === 'object' ? { kind: String(f.entity.kind ?? ''), name: String(f.entity.name ?? '') } : null,
      message: String(f?.message ?? ''),
      fix: typeof f?.fix === 'string' && f.fix ? f.fix : null,
    }))
    return { ok: report?.ok !== false && !findings.some((f) => f.severity === 'error'), findings, at: Date.now() }
  }

  changed() {
    this.lastView = null
    this.emit('event', { type: 'storage' })
  }

  /** The buckets this host connected: [{ name, provider }] (no secret). */
  bucketRecords() {
    try {
      const raw = existsSync(this.bucketsFile) ? JSON.parse(readFileSync(this.bucketsFile, 'utf8')) : []
      return raw.map((b) => (typeof b === 'string' ? { name: b, provider: null } : b)).filter((b) => typeof b?.name === 'string')
    } catch {
      return []
    }
  }

  knownBuckets() {
    return this.bucketRecords().map((b) => b.name)
  }

  saveBuckets(records) {
    const byName = new Map(records.map((b) => (typeof b === 'string' ? [b, { name: b, provider: null }] : [b.name, b])))
    writeFileSync(`${this.bucketsFile}.tmp`, JSON.stringify([...byName.values()].sort((a, b) => a.name.localeCompare(b.name))), { mode: 0o600 })
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
      return { name, keys: this.bucketRecords().find((b) => b.name === name)?.keys ?? null, key: this.bucketRecords().find((b) => b.name === name)?.key ?? null, url: this.bucketRecords().find((b) => b.name === name)?.url ?? null, region: this.bucketRecords().find((b) => b.name === name)?.region ?? null, provider: this.bucketRecords().find((b) => b.name === name)?.provider ?? null, listed: listing?.at ?? null, files: listing?.items ?? null, error: listing?.error ?? null, stores: stores.filter((s) => s.links.some((l) => l.bucket === name)).map((s) => s.name) }
    })
    const view = {
      machines: (machines.machines ?? []).map((m) => ({ name: m.name, platform: m.platform, state: m.state ?? null, supports: m.supports ?? null })),
      stores,
      buckets,
      jobs,
      at: Date.now(),
    }
    this.lastView = view
    return view
  }

  /** Store name -> { state, op, machine, down } for the project list: a recent view, else a new one. */
  async projectJoin() {
    const view = this.lastView && Date.now() - this.lastView.at < JOIN_MS ? this.lastView : await this.view()
    return new Map(view.stores.map((s) => [s.name, { state: s.state, op: s.op, machine: s.machine, down: s.down }]))
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

  /** The owner-only key file Connect writes for bucket `name` (spec §4: LayerFS gets its file: reference). */
  keyFile(name) {
    return join(this.spec.state, 'secrets', `bucket-${String(name).replace(/[^a-z0-9_.-]/gi, '-')}.key`)
  }

  /**
   * An r2 or MinIO bucket. The URL is given whole ({ url }) or built from its
   * parts: MinIO { provider: 'minio', endpoint, bucket, prefix? }, R2
   * { provider: 'r2', account, jurisdiction?, bucket, prefix? }. The key is
   * a reference ({ key: env:LAYERFS_… or file:/abs }) or the two keys
   * ({ accessKey, secretKey }), which Connect writes to an owner-only file
   * under <state>/secrets and passes as that file's reference: the keys
   * never go into the URL, storage records or the home.
   */
  async connectBucket(input = {}) {
    const { name, region } = input
    checkName(name, 'A bucket')
    const url = input.url ?? bucketUrl(input)
    if (typeof url !== 'string' || !/^(https?:\/\/|r2:\/\/)/.test(url)) throw refuse(400, 'InvalidInput', 'A bucket URL is http(s)://<host>/<bucket>/<prefix> (MinIO) or r2://<account>/<bucket>/<prefix>')
    if (!url.startsWith('r2://')) checkUrl(url, 'The bucket URL')
    let key = input.key
    let written = null
    if (input.accessKey !== undefined || input.secretKey !== undefined) {
      const [access, secret] = [input.accessKey, input.secretKey].map((v) => (typeof v === 'string' ? v.trim() : ''))
      if (!access || !secret || /\s/.test(access + secret)) throw refuse(400, 'InvalidInput', 'Give both the access key and the secret key (no spaces)')
      written = this.keyFile(name)
      if (existsSync(written)) throw refuse(409, 'Exists', 'Saved keys already exist for this bucket; use Replace keys')
      mkdirSync(join(this.spec.state, 'secrets'), { recursive: true, mode: 0o700 })
      chmodSync(join(this.spec.state, 'secrets'), 0o700)
      writeFileSync(written, `access_key=${access}\nsecret_key=${secret}\n`, { mode: 0o600 })
      chmodSync(written, 0o600)
      key = `file:${written}`
    }
    checkReference(key, 'The key')
    try {
      const answer = await this.lfs.backup.connect(name, url, { key, ...(region ? { region } : {}) })
      input.connected = { url: answer.url ?? url, region: answer.region ?? region ?? null }
    } catch (error) {
      if (written) rmSync(written, { force: true })
      throw error
    }
    this.saveBuckets([...this.bucketRecords(), { name, provider: input.provider ?? (url.startsWith('r2://') ? 'r2' : 'minio'), keys: written ? 'saved' : 'reference', key: written ? null : key, url: input.connected?.url ?? url, region: input.connected?.region ?? null }])
    this.changed()
    return this.view()
  }

  /** Drops the bucket; LayerFS drops every Store's link to it too. Answers which Stores lost theirs. */
  async disconnectBucket(name) {
    const done = await this.lfs.backup.disconnect(name)
    // the key file Connect wrote for it, if any
    rmSync(this.keyFile(name), { force: true })
    this.saveBuckets(this.bucketRecords().filter((b) => b.name !== name))
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

  /**
   * Starts LayerFS work with on_progress as a job; answers the job at once.
   * `run(on_progress, step)` may make more than one call: `step(half)` marks
   * the half a move is in.
   */
  start(kind, store, target, file, run, from = null) {
    if ([...this.jobs.values()].some((j) => j.store === store && !j.ended)) throw refuse(409, 'ConnectBusy', `this Connect is already running a job on ${store}; wait for it to end`)
    const job = { id: randomUUID(), kind, store, target, from, file: file ?? null, started: Date.now(), ended: null, half: null, phase: null, phases: [], outcome: null, pid: null, observation: null, summary: null, done: null, total: null, error: null, result: null }
    this.jobs.set(job.id, job)
    while (this.jobs.size > KEEP_JOBS) {
      const oldest = [...this.jobs.values()].find((j) => j.ended)
      if (!oldest) break
      this.jobs.delete(oldest.id)
    }
    const emit = () => { this.jobStore.save(); this.emit('event', { type: 'storage-job', job: { ...job } }) }
    const on_progress = (p) => {
      // a new phase changes the Store's op in store.list: the view is read again (not on every byte step)
      if (typeof p?.phase === 'string' && p.phase !== job.phase) {
        job.phase = p.phase
        job.phases.push({ phase: p.phase, half: job.half, at: Date.now() })
        this.changed()
      }
      // push and pull give bytes only while sending (#536 §10b), in 8 MiB steps
      job.done = typeof p?.done === 'number' ? p.done : null
      job.total = typeof p?.total === 'number' && p.total > 0 ? p.total : null
      emit()
    }
    const step = (half, from = undefined) => {
      if (from !== undefined) job.from = from
      Object.assign(job, { half, phase: null, done: null, total: null })
      emit()
      // between a move's halves the Store is on native: the view follows
      this.changed()
    }
    this.jobStore.save()
    let running
    try { running = run(on_progress, step, (pid) => { job.pid = pid; emit() }) } catch (error) { running = Promise.reject(error) }
    Promise.resolve(running)
      .then(
        (result) => { job.result = result ?? null; job.outcome = 'succeeded' },
        (error) => {
          // the SDK's refusal as it came: its code and text, the phase it stopped in, and its detail (entity, op, related)
          job.phase = error?.detail?.phase ?? job.phase
          job.outcome = failureOutcome(error, job.phase)
          job.error = { transport: error?.transport ?? null, code: error?.code ?? 'Failed', message: error?.message ?? String(error), phase: error?.detail?.phase ?? job.phase, detail: error?.detail ?? null, ...(error?.note ? { note: error.note } : {}) }
          this.log(`[storage] ${kind} ${store}: ${error?.code ?? ''} ${error?.message ?? error}`)
        },
      )
      .finally(() => {
        job.ended = Date.now()
        job.summary = transferSummary(job)
        emit()
        // the bucket's listing changed with a backup or restore
        if (kind === 'backup' || kind === 'restore') void this.listBucket(target).catch(() => {})
        this.changed()
      })
    emit()
    this.changed()
    return { ...job }
  }

  /** store.push(store, machine): a sqlite Store on native to `machine`. */
  push(store, machine) {
    checkName(store, 'A push')
    checkName(machine, 'A push')
    return this.start('push', store, machine, null, (on_progress, step, on_spawn) => this.lfs.store.push(store, machine, { on_progress, on_spawn }))
  }

  /** store.pull(store): a sqlite Store on a machine back to native. */
  async pull(store) {
    checkName(store, 'A pull')
    // the machine it comes from (store.get reads the record; it starts nothing): the job row reads "<store> ← <machine>"
    const from = (await this.lfs.store.get(store))?.machine ?? null
    return this.start('pull', store, 'native', null, (on_progress, step, on_spawn) => this.lfs.store.pull(store, { on_progress, on_spawn }), from)
  }

  /**
   * A Store on one machine to another: pull, then push, two operations (U5).
   * When the push half fails the Store stays on native; the error's `note`
   * says so (`pulled`).
   */
  move(store, machine) {
    checkName(store, 'A move')
    checkName(machine, 'A move')
    return this.start('move', store, machine, null, async (on_progress, step, on_spawn) => {
      const source = await this.lfs.store.get(store)
      step('pull', source.machine ?? null)
      await this.lfs.store.pull(store, { on_progress, on_spawn })
      step('push')
      try {
        return await this.lfs.store.push(store, machine, { on_progress, on_spawn })
      } catch (error) {
        if (failureOutcome(error, error?.detail?.phase) === 'failed' && error?.detail?.phase !== 'retire') error.note = 'pulled'
        throw error
      }
    })
  }

  /** Puts sqlite Store `store` on `machine`: a push from native, a pull to native, else a move. */
  async place(store, machine) {
    checkName(store, 'A Store')
    checkName(machine, 'A machine')
    const record = await this.lfs.store.get(store)
    if (record.kind && record.kind !== 'sqlite') throw refuse(400, 'InvalidInput', `${store} is a PostgreSQL Store; it is never pushed or pulled`)
    if (record.machine === machine) throw refuse(400, 'InvalidInput', `${store} is on ${machine} already`)
    if (machine === 'native') return this.pull(store)
    if (record.machine === 'native') return this.push(store, machine)
    return this.move(store, machine)
  }

  /** backup.create(store, bucket, file?). */
  backup(store, { bucket, file } = {}) {
    checkName(store, 'A backup')
    checkName(bucket, 'A backup')
    return this.start('backup', store, bucket, file, (on_progress, step, on_spawn) => this.lfs.backup.create(store, bucket, file || undefined, { on_progress, on_spawn }))
  }

  /** backup.restore(store, bucket, file?): a new Store `store` on native. */
  restore({ store, bucket, file } = {}) {
    checkName(store, 'A restore')
    checkName(bucket, 'A restore')
    return this.start('restore', store, bucket, file, (on_progress, step, on_spawn) => this.lfs.backup.restore(store, bucket, file || undefined, { on_progress, on_spawn }))
  }

  async inspect(id) {
    const job = this.jobs.get(id)
    if (!job || !job.ended) throw refuse(409, 'ConnectBusy', 'Wait for a completed job before inspecting recovery')
    job.observation = await inspectJob(this.lfs, job)
    if (job.observation.value?.state === 'unresolved') job.outcome = 'unknown'
    else if (job.observation.value?.state === 'idle' && job.error?.transport === 'transport-unknown' && !['install', 'record'].includes(job.phase)) job.outcome = 'interrupted'
    job.summary = transferSummary(job)
    this.jobStore.save()
    return { ...job }
  }

  async retry(id) {
    const old = this.jobs.get(id)
    if (!old?.observation?.action) throw refuse(409, 'InspectRequired', 'Inspect the current Store before choosing recovery')
    const job = await this.inspect(id)
    if (!job.observation.action) throw refuse(409, 'RecoveryUnavailable', 'The fresh observation does not permit this recovery')
    if (job.observation.direction === 'pull') return this.pull(job.store)
    return this.push(job.store, job.target)
  }

  async replaceBucketKeys(name, input) {
    const record = this.bucketRecords().find(b => b.name === name)
    if (!record) throw refuse(404, 'NotFound', 'No saved bucket with this name')
    if (record.keys !== 'saved') throw refuse(400, 'InvalidInput', 'This bucket uses an external secret reference; update that reference instead')
    const access = input?.accessKey?.trim(), secret = input?.secretKey?.trim()
    if (!access || !secret || /\s/.test(access + secret)) throw refuse(400, 'InvalidInput', 'Give both keys without spaces')
    mkdirSync(join(this.spec.state, 'secrets'), { recursive: true, mode: 0o700 })
    writeFileSync(this.keyFile(name), `access_key=${access}\nsecret_key=${secret}\n`, { mode: 0o600 })
    chmodSync(this.keyFile(name), 0o600)
    await this.listBucket(name)
    return this.view()
  }

  close() { this.jobStore.save() }
}
