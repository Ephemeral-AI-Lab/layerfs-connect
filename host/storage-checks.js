// What the Storage page needs beyond store.list, kept by the host in memory
// (docs/ui/storage-redesign.md §4, §5, §8.4):
//   Checks      the last HEAD of each SQLite Store's linked file
//               (runtime.store.check, E3; layerfs#509), each PostgreSQL
//               connection's status and schema sizes (runtime.postgresql.status,
//               E5/E7) and each connection's file listing
//               (runtime.remote.list_stores, E9): at most LIMIT at once, a
//               second ask for the same thing joins the one running
//   JobSampler  every running publish, push, pull, send, load and import read with
//               runtime.sync.get every 500 ms while any runs, with its rate
//               and ETA; each changed sample and each end is reported
// Every LayerFS call here is one attempt: a failed check is recorded as
// failed, never retried. Reading a running job again is a poll, not a retry.
// Nothing here opens a Store. Secrets (keys, URLs) never reach a result:
// messages are scrubbed of them before they are kept.
import { nextRate } from './storage-sync.js'

/** HEADs, listings and PostgreSQL status calls running at once, at most. */
export const LIMIT = 4
/** A thing checked this recently is not checked again for a plain ask (Check now is disabled as long). */
export const FLOOR_MS = 10_000
/** How long an ended job stays listed. */
export const KEEP_ENDED_MS = 10 * 60_000
/** How often running jobs are read. */
export const SAMPLE_MS = 500

/** `text` with every secret in `secrets` replaced by ***. */
export function scrub(text, secrets = []) {
  let out = String(text ?? '')
  for (const s of secrets) if (typeof s === 'string' && s.length >= 3) out = out.split(s).join('***')
  return out
}

/** A refusal or failure as { code, message }, scrubbed. */
export const errorOf = (error, secrets) => ({ code: typeof error?.code === 'string' && error.code ? error.code : 'Failed', message: scrub(error?.message ?? error, secrets) })

/** Below this a number is seconds since the epoch, not ms (ms passed it in 1973). */
const SECONDS_BELOW = 1e11

/**
 * A time LayerFS gave as ms since the epoch, or null. Transfer times (`at`
 * of a push or pull) are ms since layerfs#509 and seconds in records made
 * before; checks and listings (`modified`, `checkedAt`) are ms; ISO strings
 * parse.
 */
export function timeOf(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value < SECONDS_BELOW ? value * 1000 : value
  if (typeof value === 'string') {
    const t = Date.parse(value)
    return Number.isNaN(t) ? null : t
  }
  return null
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const str = (v) => (typeof v === 'string' && v ? v : null)
/** Codes that mean the linked LayerFS build lacks the call (its JS has it, its binding does not). */
export const NOT_IN_BINDING = new Set(['UnknownMethod', 'Unsupported'])
/** The StorageSupports flag each task kind needs. */
export const FEATURE = { copy: 'check', connection: 'postgresqlStatus', list: 'listCopies' }
/** A failed check's error code that means the keys or the user were refused. */
const DENIED = /denied|forbidden|unauthori[sz]ed|auth|permission|password/i

/** Runs at most `limit` functions at once, in the order asked. */
export class Limiter {
  constructor(limit = LIMIT) {
    this.limit = limit
    this.active = 0
    this.queue = []
  }

  run(fn) {
    return new Promise((resolve, reject) => {
      this.queue.push({ fn, resolve, reject })
      this.next()
    })
  }

  next() {
    while (this.active < this.limit && this.queue.length) {
      const { fn, resolve, reject } = this.queue.shift()
      this.active++
      Promise.resolve()
        .then(fn)
        .then(resolve, reject)
        .finally(() => {
          this.active--
          this.next()
        })
    }
  }
}

export class Checks {
  /**
   * @param {object} [options]
   * @param {number} [options.limit] calls at once
   * @param {number} [options.floorMs] a plain ask skips what was checked this recently
   * @param {() => number} [options.now]
   */
  constructor({ limit = LIMIT, floorMs = FLOOR_MS, now = Date.now } = {}) {
    /** StorageSupports flags whose call this LayerFS build answered UnknownMethod or Unsupported */
    this.missing = new Set()
    this.limiter = new Limiter(limit)
    this.floorMs = floorMs
    this.now = now
    /** `store\0remote` -> { check, failedCheck } of the Store's linked file */
    this.copies = new Map()
    /** connection -> { status: { at, serverVersion, latencyMs, schemas }, failed: { at, error } } */
    this.connections = new Map()
    /** remote -> { at, error } of the latest call against it (a check or a listing) */
    this.remotes = new Map()
    /** remote -> { at, list } */
    this.listings = new Map()
    /** task key -> its promise, while it runs */
    this.inFlight = new Map()
    /** The newest finished check, of any kind. */
    this.checkedAt = null
  }

  /** Checks running now. */
  get checking() {
    return this.inFlight.size
  }

  /** The cache of one copy: { check, failedCheck, inFlight }. */
  copy(store, remote) {
    const kept = this.copies.get(`${store}\0${remote}`)
    return { check: kept?.check ?? null, failedCheck: kept?.failedCheck ?? null, inFlight: this.inFlight.has(`copy:${store}\0${remote}`) }
  }

  /** Health of a remote: the latest check or listing against it. */
  remoteHealth(remote) {
    const latest = this.remotes.get(remote)
    const running = [...this.inFlight.keys()].some((k) => (k.startsWith('copy:') && k.endsWith(`\0${remote}`)) || k === `list:${remote}`)
    if (!latest) return { state: running ? 'checking' : 'unknown', at: null, message: null }
    if (!latest.error) return { state: 'ok', at: latest.at, message: null }
    return { state: DENIED.test(latest.error.code) ? 'denied' : 'unreachable', at: latest.at, message: latest.error.message }
  }

  /** The files in a connection's bucket (E9): [{ file, bytes, modified, sha256, linkedBy }], or null. */
  listed(remote) {
    return this.listings.get(remote)?.list ?? null
  }

  /** Health of a PostgreSQL connection, with the server version and round trip. */
  connectionHealth(name) {
    const kept = this.connections.get(name)
    const running = this.inFlight.has(`pg:${name}`)
    const latest = kept?.failed && (!kept.status || kept.failed.at >= kept.status.at) ? { at: kept.failed.at, error: kept.failed.error } : kept?.status ? { at: kept.status.at, error: null } : null
    if (!latest) return { state: running ? 'checking' : 'unknown', at: null, message: null, serverVersion: null, latencyMs: null }
    if (latest.error) return { state: DENIED.test(latest.error.code) ? 'denied' : 'unreachable', at: latest.at, message: latest.error.message, serverVersion: null, latencyMs: null }
    return { state: 'ok', at: latest.at, message: null, serverVersion: kept.status.serverVersion, latencyMs: kept.status.latencyMs }
  }

  /** A PostgreSQL Store's schema size from its connection's last status (StoreSize), or null when unknown or unreachable now. */
  schemaSize(connection, schema) {
    const kept = this.connections.get(connection)
    if (!kept?.status || (kept.failed && kept.failed.at >= kept.status.at)) return null
    const bytes = num(kept.status.schemas?.[schema])
    return bytes === null ? null : { bytes, file: null, wal: null, at: kept.status.at }
  }

  forgetStore(store) {
    for (const key of [...this.copies.keys()]) if (key.startsWith(`${store}\0`)) this.copies.delete(key)
  }

  forgetRemote(remote) {
    for (const key of [...this.copies.keys()]) if (key.endsWith(`\0${remote}`)) this.copies.delete(key)
    this.remotes.delete(remote)
    this.listings.delete(remote)
  }

  forgetConnection(name) {
    this.connections.delete(name)
  }

  /**
   * Runs `tasks`, each { kind: 'copy', store, remote, call } (call answers
   * runtime.store.check's result for the Store's linked file),
   * { kind: 'connection', name, call } (call answers { serverVersion,
   * schemas, latencyMs }) or { kind: 'list', remote, call } (call answers
   * runtime.remote.list_stores's result). A
   * task already running is joined; one finished less than floorMs ago is
   * skipped unless `force`. `secrets` are scrubbed from failure messages.
   * Answers when all have ended; a failed task is recorded, never thrown.
   */
  async run(tasks, { force = false } = {}) {
    const keyOf = (t) => (t.kind === 'copy' ? `copy:${t.store}\0${t.remote}` : t.kind === 'connection' ? `pg:${t.name}` : `${t.kind}:${t.remote}`)
    const waits = []
    for (const task of tasks) {
      const key = keyOf(task)
      const running = this.inFlight.get(key)
      if (running) {
        waits.push(running)
        continue
      }
      if (!force && this.now() - (this.lastAt(task) ?? -Infinity) < this.floorMs) continue
      const pending = this.limiter
        .run(() => this.once(task))
        .finally(() => this.inFlight.delete(key))
      this.inFlight.set(key, pending)
      waits.push(pending)
    }
    await Promise.all(waits)
  }

  lastAt(task) {
    if (task.kind === 'copy') {
      const kept = this.copies.get(`${task.store}\0${task.remote}`)
      return Math.max(kept?.check?.at ?? -Infinity, kept?.failedCheck?.at ?? -Infinity)
    }
    if (task.kind === 'connection') {
      const kept = this.connections.get(task.name)
      return Math.max(kept?.status?.at ?? -Infinity, kept?.failed?.at ?? -Infinity)
    }
    if (task.kind === 'list') return this.listings.get(task.remote)?.at ?? null
    return this.remotes.get(task.remote)?.at ?? null
  }

  /** One task, one call; its outcome recorded. */
  async once(task) {
    const secrets = task.secrets ?? []
    let answer
    let error = null
    try {
      answer = await task.call()
    } catch (e) {
      error = errorOf(e, secrets)
    }
    // the build lacks the call: the feature is off for this process, and nothing about the remote is learned
    if (error && NOT_IN_BINDING.has(error.code)) {
      this.missing.add(FEATURE[task.kind])
      return
    }
    const at = this.now()
    this.checkedAt = Math.max(this.checkedAt ?? 0, at)
    if (task.kind === 'copy') {
      const key = `${task.store}\0${task.remote}`
      const kept = this.copies.get(key) ?? { check: null, failedCheck: null }
      if (error) kept.failedCheck = { at, present: false, bytes: null, sha256: null, heads: null, modified: null, error }
      else {
        kept.check = { at, present: !!answer?.present, bytes: num(answer?.bytes), sha256: str(answer?.sha256), heads: str(answer?.heads), modified: timeOf(answer?.modified), error: null }
        kept.failedCheck = null
      }
      this.copies.set(key, kept)
      this.remotes.set(task.remote, { at, error })
    } else if (task.kind === 'connection') {
      const kept = this.connections.get(task.name) ?? { status: null, failed: null }
      if (error) kept.failed = { at, error }
      else {
        const schemas = {}
        for (const [schema, bytes] of Object.entries(answer?.schemas ?? {})) if (num(bytes) !== null) schemas[schema] = bytes
        kept.status = { at, serverVersion: str(answer?.serverVersion), latencyMs: num(answer?.latencyMs), schemas }
        kept.failed = null
      }
      this.connections.set(task.name, kept)
    } else {
      if (task.kind === 'list' && !error && Array.isArray(answer)) {
        const list = answer
          .filter((c) => typeof c?.file === 'string')
          .map((c) => ({ file: c.file, bytes: num(c.bytes), modified: timeOf(c.modified), sha256: str(c.sha256), linkedBy: str(c.linkedBy) }))
          .sort((a, b) => a.file.localeCompare(b.file))
        this.listings.set(task.remote, { at, list })
      }
      this.remotes.set(task.remote, { at, error })
    }
  }
}

// ---------- jobs ----------

/** A pieces record ({ done, of }) LayerFS gave, or null. */
const piecesOf = (p) => (p && num(p.done) !== null && num(p.of) !== null ? { done: p.done, of: p.of } : null)

/**
 * A runtime sync job -> SyncJob (§8.1). `known` is what the host recorded
 * when it started the job ({ kind, store, target, from, provider, force,
 * started }); `rate` is nextRate's { rate, eta }.
 */
export function toSyncJob(job, known, rate = { rate: null, eta: null }) {
  const step = job.step === 'done' || job.step === 'failed' ? job.step : 'running'
  const error = job.error ? (typeof job.error === 'string' ? { code: 'Failed', message: job.error } : { code: job.error.code || 'Failed', message: job.error.message ?? String(job.error) }) : null
  const transfer = job.result?.transfer
  return {
    id: job.id,
    kind: known.kind,
    store: known.store,
    target: known.target,
    file: known.file ?? null,
    from: known.from ?? null,
    provider: known.provider ?? null,
    force: !!known.force,
    step,
    phase: str(job.phase),
    bytes: num(job.bytes),
    total: num(job.total),
    pieces: piecesOf(job.pieces),
    rate: step === 'running' ? rate.rate : null,
    eta: step === 'running' ? rate.eta : null,
    cancellable: false,
    error,
    result: step === 'done' ? { bytes: num(transfer?.bytes) ?? num(job.bytes), sha256: str(transfer?.sha256) } : null,
    started: num(job.started) ?? known.started,
    ended: num(job.ended),
  }
}

/** The fields a page sees change: a sample with none of them changed is not sent again. */
const SHOWN = ['step', 'phase', 'bytes', 'total', 'rate', 'eta', 'ended']
const changed = (a, b) => !a || SHOWN.some((k) => a[k] !== b[k]) || JSON.stringify(a.pieces) !== JSON.stringify(b.pieces) || JSON.stringify(a.error) !== JSON.stringify(b.error)

export class JobSampler {
  /**
   * @param {object} options
   * @param {(id: string) => Promise<object | null>} options.get runtime.sync.get
   * @param {(job: object) => void} [options.onSample] a running job's changed sample
   * @param {(job: object, known: object) => void} [options.onEnd] a job's end (once)
   * @param {number} [options.intervalMs]
   * @param {number} [options.keepMs]
   * @param {() => number} [options.now]
   * @param {(line: string) => void} [options.log]
   */
  constructor({ get, onSample = () => {}, onEnd = () => {}, intervalMs = SAMPLE_MS, keepMs = KEEP_ENDED_MS, now = Date.now, log = () => {} }) {
    Object.assign(this, { get, onSample, onEnd, intervalMs, keepMs, now, log })
    /** id -> { known, last, rate } */
    this.jobs = new Map()
    this.timer = null
    this.ticking = null
    /** The LayerFS build reports phases while a job runs (E4). */
    this.progress = false
  }

  /** Starts following `job` (the start call's answer): its first SyncJob. */
  track(job, known) {
    const entry = { known: { ...known, started: num(job.started) ?? known.started ?? this.now() }, last: null, rate: null }
    this.jobs.set(job.id, entry)
    this.take(job.id, entry, job)
    this.schedule()
    return entry.last
  }

  /** The last SyncJob of `id`, or null when this host does not follow it. */
  job(id) {
    return this.jobs.get(id)?.last ?? null
  }

  /** Every followed job: running first, then ended ones newest first; ended ones older than keepMs dropped. */
  list() {
    const now = this.now()
    for (const [id, e] of this.jobs) if (e.last && e.last.ended !== null && now - e.last.ended > this.keepMs) this.jobs.delete(id)
    const all = [...this.jobs.values()].map((e) => e.last)
    return [...all.filter((j) => j.step === 'running'), ...all.filter((j) => j.step !== 'running').sort((a, b) => (b.ended ?? 0) - (a.ended ?? 0))]
  }

  /** The running job on Store `store` (and remote `target`, when given), or null. */
  running(store, target = undefined) {
    for (const { last } of this.jobs.values()) if (last?.step === 'running' && last.store === store && (target === undefined || last.target === target)) return last
    return null
  }

  /** One sample of every running job. */
  tick() {
    this.ticking ??= (async () => {
      for (const [id, entry] of this.jobs) {
        if (entry.last?.step !== 'running') continue
        let raw
        try {
          raw = await this.get(id)
        } catch (error) {
          this.log(`[host] sync.get ${id}: ${error?.message ?? error}`)
          continue
        }
        // LayerFS no longer knows a job it ran: its outcome is unknown
        this.take(id, entry, raw ?? { ...entry.last, step: 'failed', error: { code: 'Unknown', message: 'LayerFS no longer has this job; its outcome is unknown' }, ended: this.now() })
      }
    })().finally(() => {
      this.ticking = null
      this.schedule()
    })
    return this.ticking
  }

  take(id, entry, raw) {
    if (raw.step === 'running' && raw.phase !== undefined) this.progress = true
    const next = nextRate(entry.rate, { phase: raw.phase ?? null, bytes: raw.bytes, total: raw.total, running: (raw.step ?? 'running') === 'running' }, this.now())
    entry.rate = next.state
    const job = toSyncJob({ ...raw, id }, entry.known, next)
    const before = entry.last
    entry.last = job
    if (!before) return
    if (job.step !== 'running' && before.step === 'running') {
      this.onSample(job)
      this.onEnd(job, entry.known)
    } else if (job.step === 'running' && changed(before, job)) this.onSample(job)
  }

  schedule() {
    const running = [...this.jobs.values()].some((e) => e.last?.step === 'running')
    if (running && !this.timer) {
      this.timer = setInterval(() => void this.tick(), this.intervalMs)
      this.timer.unref?.()
    } else if (!running && this.timer) this.stop()
  }

  stop() {
    clearInterval(this.timer)
    this.timer = null
  }
}
