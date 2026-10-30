// Where projects' history lives (layerfs#506, core/docs/issues/506/README.md
// in the layerfs repository): the home's Stores, each holding many projects
// (local SQLite files, PostgreSQL schemas), the remotes (connections to an
// S3 provider's bucket: MinIO, Cloudflare R2) holding SQLite Store files,
// and named PostgreSQL connections. Since layerfs#509 (docs/ui/storage-links.md)
// a SQLite Store links to at most one remote file, and a remote file is
// linked by at most one Store of this home; a connection binds no Store.
//   view                StorageView: what this LayerFS build offers, the Stores,
//                       remotes, connections and running jobs
//   createStore         runtime.store.create(name): an empty local SQLite Store
//   removeStore         runtime.store.remove(name, { confirm: name })
//   addRemote           runtime.remote.add; the keys stay in Connect
//   removeRemote        runtime.remote.remove(name, { confirm: name })
//   publish             runtime.store.start_publish: an unlinked Store to a new file, linked
//   push / pull         runtime.store.start_push / start_pull through the Store's
//                       link (pull replaces the whole Store: { confirm: <store> })
//   send                runtime.store.start_send: a copy to a new, unlinked file
//   load                runtime.store.start_load: a new local Store linked to a file
//   unlink              runtime.store.unlink: the Store becomes local only
//   files               runtime.remote.list_stores: a connection's files, with linkedBy
//   addPostgresql       a named connection; its URL stays in Connect
//   removePostgresql    forgets a connection Connect keeps
//   importPostgresql    runtime.store.start_import_postgresql: a SQLite Store
//                       copied into its own schema, registered as a new Store
//   syncJob             the last sample of a job (runtime.sync.get, every 500 ms
//                       while it runs, storage-checks.js JobSampler)
//   check               POST /api/storage/check: the linked files' HEADs
//                       (runtime.store.check), the PostgreSQL connections'
//                       status (runtime.postgresql.status) and the remotes'
//                       listings (runtime.remote.list_stores), cached in memory
// The view (docs/ui/storage-links.md §5) joins store.list, remote.list,
// the cached checks and the job samples into each link's sync state
// (storage-sync.js), sizes, totals and what the LayerFS build supports. It
// never runs a remote HEAD and never opens a Store: SQLite sizes come from
// store.list (E1) or one stat of every Store's files (docker exec in the
// worker on macOS and Windows), heads only from store.list (E2). A newer
// engine field is used when present and a fallback when not (§10.4).
// Events ('event' on this emitter, forwarded on /api/events): { type: 'sync',
// job } for each changed sample of a running job and its end, { type:
// 'storage' } when the view changed (a check ended, a job ended, a change).
// LayerFS keeps Store and remote definitions in its home with no secret;
// Connect owns the secrets (AGENTS.md: the host owns long-lived credentials)
// in <state>/storage.json, readable by this user only, and passes them per
// call. A LayerFS build without these calls answers available: false with
// the reason, and the page keeps its earlier, single-Store view. Every
// LayerFS call is made once; a refusal passes through with its code.
import { execFile } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { VOLUMES } from './config.js'
import { Checks, JobSampler, timeOf } from './storage-checks.js'
import { linkInfo, storeSync } from './storage-sync.js'

const refuse = (status, code, message) => Object.assign(new Error(message), { status, code })

/** Why a part is missing: the linked LayerFS build predates layerfs#506's API. */
export const NOT_IN_BUILD = 'The LayerFS build Connect uses has no such calls yet (layerfs#506).'

const NAME = /^[a-z0-9][a-z0-9-]{0,31}$/
// S3 bucket names: 3–63 lower-case letters, digits, dots and hyphens, starting and ending with a letter or digit
const BUCKET = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/
const PREFIX = /^[A-Za-z0-9!_.*'()/-]{0,200}$/
/** A Cloudflare account id: 32 lower-case hex digits. */
const ACCOUNT = /^[0-9a-f]{32}$/
/** R2 jurisdictions: none, eu or fedramp. */
const JURISDICTIONS = ['', 'eu', 'fedramp']
const SCHEMA = /^[a-z_][a-z0-9_]{0,62}$/
const SYNC_COMMIT = ['off', 'local', 'remote_write', 'on', 'remote_apply']
const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])
/** The copy providers the page knows (§7.3), in its order. */
export const PROVIDERS = ['minio', 'r2', 's3', 'gcs', 'google-drive', 'folder']
/** What a LayerFS build with remotes but without remote.providers (E8) can add. */
const FALLBACK_PROVIDERS = ['minio', 'r2']
/** A project list joins a view this recent instead of reading one. */
const JOIN_MS = 15_000
/** The one stat of every Store's files may take this long. */
const STAT_MS = 5_000

/** `url` without its password, for display. */
export function redactUrl(url) {
  try {
    const u = new URL(url)
    if (u.password) u.password = '***'
    return u.toString()
  } catch {
    return '(unreadable URL)'
  }
}

/**
 * The address the LayerFS box uses for `address` (an endpoint or a database
 * URL). On macOS and Windows, Store calls run in the home's worker container,
 * where the host's loopback is host.docker.internal; on Linux the address is
 * used as given.
 */
export function reachAs(address, worker) {
  if (!worker) return address
  const u = new URL(address)
  if (!LOOPBACK.has(u.hostname)) return address
  u.hostname = 'host.docker.internal'
  return u.toString().replace(/\/$/, '')
}

/**
 * The URL the LayerFS box uses for a PostgreSQL server. A server in a
 * container of the same Docker engine, published on the host's loopback, is
 * reached over the default bridge network at the container's own address and
 * port, as the worker and the Sandboxes sit on that network: a round trip
 * there is a fraction of one through host.docker.internal, and every Store
 * call is many round trips. Anything else (no worker, not loopback, no single
 * such container, a worker off the bridge) is reachAs. `docker(args)` runs
 * one docker command and returns its output.
 */
export async function reachPostgresql(url, worker, docker) {
  const via = reachAs(url, worker)
  if (via === url) return url
  try {
    const u = new URL(url)
    const port = u.port || '5432'
    // "<id>\t127.0.0.1:5432->5432/tcp, ..." for every running container
    const listed = (await docker(['ps', '--no-trunc', '--format', '{{.ID}}\t{{.Ports}}'])).split('\n')
    const pattern = new RegExp(`(?:^|, )(?:127\\.0\\.0\\.1|0\\.0\\.0\\.0|\\[?::1?\\]?):${port}->(\\d+)/tcp`)
    const found = listed.map((line) => [line.split('\t')[0], (line.split('\t')[1] ?? '').match(pattern)?.[1]]).filter(([, inside]) => inside)
    if (new Set(found.map(([id]) => id)).size !== 1) return via
    const address = async (id) => JSON.parse(await docker(['inspect', id]))[0]?.NetworkSettings?.Networks?.bridge?.IPAddress
    const [server, inside] = found[0]
    const reached = await address(server)
    if (!reached || !(await address(worker))) return via
    u.hostname = reached
    u.port = inside
    return u.toString()
  } catch {
    return via
  }
}

function text(value, what, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) throw refuse(400, 'InvalidInput', `${what} is not valid`)
  return value
}

function endpointOf(value) {
  if (typeof value !== 'string') throw refuse(400, 'InvalidInput', 'the endpoint is missing')
  let u
  try {
    u = new URL(value)
  } catch {
    throw refuse(400, 'InvalidInput', `the endpoint ${value} is not a URL`)
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw refuse(400, 'InvalidInput', 'the endpoint must start with http:// or https://')
  if (u.pathname !== '/' || u.search || u.username) throw refuse(400, 'InvalidInput', 'the endpoint is a scheme, host and port only, such as http://localhost:9000')
  return `${u.protocol}//${u.host}`
}

function postgresUrl(value) {
  const url = typeof value === 'string' ? value.trim() : ''
  if (!/^postgres(ql)?:\/\//.test(url)) throw refuse(400, 'InvalidInput', 'the URL must start with postgresql://')
  try {
    new URL(url)
  } catch {
    throw refuse(400, 'InvalidInput', 'the URL is not valid')
  }
  return url
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** A link's last push or pull as LayerFS records it -> TransferInfo, or null. */
const transfer = (t) => (t ? { direction: t.direction === 'pull' ? 'pull' : 'push', at: timeOf(t.at), bytes: num(t.bytes), sha256: t.sha256 ?? null, heads: typeof t.heads === 'string' ? t.heads : null } : null)

/** A remote file's name (layerfs#509): the object <prefix>/<file>/store.sqlite. */
const FILE = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,127}$/

/** A Store's file in its volume, as the process that stats it sees it. */
const storeFile = (volume) => `${VOLUMES}/${volume}/_data/global/store.sqlite`

/** host/bucket/prefix of a remote, for display. */
function locationOf(r, endpoint) {
  let host = null
  try {
    host = new URL(endpoint).host || null
  } catch {
    // an R2 remote has no endpoint of its own in Connect
  }
  if (!host && r.provider === 'r2' && r.account) host = `${r.account}${r.jurisdiction ? `.${r.jurisdiction}` : ''}.r2.cloudflarestorage.com`
  return [host ?? r.name, r.bucket, r.prefix].filter(Boolean).join('/')
}

/** host:port and the database of a PostgreSQL URL (no password), or nulls. */
function urlParts(url) {
  try {
    const u = new URL(url)
    return { host: u.host || null, database: decodeURIComponent(u.pathname.replace(/^\/+/, '')) || null }
  } catch {
    return { host: null, database: null }
  }
}

/** A PostgreSQL URL's password, for scrubbing messages. */
function passwordOf(url) {
  try {
    return decodeURIComponent(new URL(url).password) || null
  } catch {
    return null
  }
}

/** A linked file's size: the remote object's (the last check), else the last transfer's. */
function linkBytes(l) {
  if (l.check) return l.check.present ? (l.check.bytes ?? l.last?.bytes ?? null) : null
  return l.last?.bytes ?? null
}

const sum = (values) => values.filter((v) => v !== null).reduce((a, b) => a + b, 0)

/**
 * Sizes of `paths` (path -> bytes; a missing file is absent): stat here when
 * Store calls run in this process (Linux), else one `stat` in the home's
 * worker container, which sees the Docker volumes. Never throws.
 */
export function statFiles(spec, paths, log = () => {}) {
  if (!paths.length) return Promise.resolve(new Map())
  if (!spec.worker) {
    const sizes = new Map()
    for (const p of paths) {
      try {
        sizes.set(p, statSync(p).size)
      } catch {
        // no WAL right after a checkpoint, no -shm while closed
      }
    }
    return Promise.resolve(sizes)
  }
  if (!spec.docker || !spec.prefix) return Promise.resolve(null)
  const docker = spec.docker.startsWith('/') ? `unix://${spec.docker}` : spec.docker
  return new Promise((resolve) => {
    // stat exits 1 when a file is missing; the lines it printed still count
    execFile('docker', ['-H', docker, 'exec', `${spec.prefix}worker`, 'stat', '-c', '%n %s', ...paths], { timeout: STAT_MS }, (error, stdout) => {
      const lines = String(stdout ?? '').split('\n').filter(Boolean)
      if (!lines.length && error) {
        log(`[host] Store sizes: ${error.message.split('\n')[0]}`)
        return resolve(null)
      }
      const sizes = new Map()
      for (const line of lines) {
        const at = line.lastIndexOf(' ')
        if (at > 0) sizes.set(line.slice(0, at), Number(line.slice(at + 1)))
      }
      resolve(sizes)
    })
  })
}

export class Storage extends EventEmitter {
  /**
   * @param {object} options
   * @param {object} options.spec config.js's resolved spec
   * @param {object} options.projects projects.js's Projects (its runtime())
   * @param {(line: string) => void} [options.log]
   * @param {(paths: string[]) => Promise<Map<string, number> | null>} [options.stat] sizes of Store files (statFiles)
   * @param {object} [options.checks] storage-checks.js Checks options
   * @param {object} [options.sampler] storage-checks.js JobSampler options
   */
  constructor({ spec, projects, log = (line) => process.stderr.write(`${line}\n`), stat = null, checks = {}, sampler = {} }) {
    super()
    this.spec = spec
    this.projects = projects
    this.log = log
    this.file = join(spec.state, 'storage.json')
    this.stat = stat ?? ((paths) => statFiles(spec, paths, log))
    this.checks = new Checks(checks)
    this.sampler = new JobSampler({
      get: async (id) => (await this.runtime()).sync.get(id),
      onSample: (job) => this.emit('event', { type: 'sync', job }),
      onEnd: (job, known) => void this.ended(job, known),
      log,
      ...sampler,
    })
    /** { at, view } of the last full view */
    this.last = null
    /** remote.providers()'s answer (E8); false once asked without one */
    this.providerIds = null
    // an 'event' with no listener is fine; an 'error' event is never emitted
  }

  /** Stops sampling jobs (the host is closing). */
  close() {
    this.sampler.stop()
  }

  /** Tells event listeners the view changed. */
  changed() {
    this.emit('event', { type: 'storage' })
  }

  // ---------- Connect's own saved part: remote keys and PostgreSQL URLs ----------

  saved() {
    if (!existsSync(this.file)) return { remotes: {}, postgresql: {}, imports: {} }
    const value = JSON.parse(readFileSync(this.file, 'utf8'))
    // a file from before named connections held one connection, or none
    const pg = value.postgresql && typeof value.postgresql.url === 'string' ? { main: value.postgresql } : (value.postgresql ?? {})
    // imports: PostgreSQL Store -> { store, at, bytes }, the imports this Connect started (the From column without E6)
    return { remotes: value.remotes ?? {}, postgresql: pg, imports: value.imports ?? {} }
  }

  save(value) {
    writeFileSync(`${this.file}.tmp`, JSON.stringify(value, null, 2), { mode: 0o600 })
    renameSync(`${this.file}.tmp`, this.file)
  }

  // ---------- what this LayerFS build offers ----------

  async runtime() {
    return this.projects.runtime()
  }

  static offers(runtime) {
    const store = runtime.store ?? {}
    return {
      stores: typeof store.list === 'function' && typeof store.create === 'function',
      remotes: typeof runtime.remote?.list === 'function' && typeof store.start_publish === 'function',
      postgresql: typeof store.start_import_postgresql === 'function',
    }
  }

  async need(part) {
    const runtime = await this.runtime()
    if (!Storage.offers(runtime)[part]) throw refuse(501, 'Unsupported', NOT_IN_BUILD)
    return runtime
  }

  /**
   * What the linked LayerFS build reports (StorageSupports), from its calls,
   * the fields store.list gave, and calls it answered UnknownMethod or
   * Unsupported (its JS runtime has them, its binding does not).
   */
  supports(runtime, list = []) {
    const sqlite = list.filter((s) => s.kind !== 'postgresql')
    const has = (flag, fn) => typeof fn === 'function' && !this.checks.missing.has(flag)
    return {
      size: sqlite.some((s) => 'bytes' in s && (s.bytes === null || typeof s.bytes === 'object')),
      heads: sqlite.some((s) => 'heads' in s),
      check: has('check', runtime.store?.check),
      progress: this.sampler.progress,
      postgresqlStatus: has('postgresqlStatus', runtime.postgresql?.status),
      listCopies: has('listCopies', runtime.remote?.list_stores),
    }
  }

  /**
   * StorageView (§8.1). Uses the cached checks and job samples; never runs a
   * remote HEAD and opens no Store. `sizes: false` skips the stat fallback
   * (a project list's join needs no size).
   */
  async view({ sizes = true } = {}) {
    const runtime = await this.runtime()
    const offers = Storage.offers(runtime)
    const saved = this.saved()
    const read = async (what, fn) => {
      try {
        return { list: await fn(), error: null }
      } catch (e) {
        const error = e?.message ?? String(e)
        this.log(`[host] ${what}: ${error}`)
        return { list: [], error }
      }
    }
    const stores = offers.stores ? await read('store.list', () => runtime.store.list()) : { list: [], error: NOT_IN_BUILD }
    const remotes = offers.remotes ? await read('remote.list', () => runtime.remote.list()) : { list: [], error: NOT_IN_BUILD }
    const supports = this.supports(runtime, stores.list)
    const remoteBy = new Map(remotes.list.map((r) => [r.name, r]))
    const locations = new Map(remotes.list.map((r) => [r.name, locationOf(r, saved.remotes[r.name]?.endpoint ?? r.endpoint)]))
    const files = sizes ? await this.fallbackSizes(stores.list) : new Map()
    const now = Date.now()
    const ctx = { supports, remoteBy, locations, saved, files, now }
    const list = stores.list.map((s) => this.storeInfo(s, ctx))
    // SQLite: the PostgreSQL Stores imported from each (E6, else Connect's own log)
    for (const s of list) if (s.kind === 'sqlite') s.imports = list.filter((p) => p.kind === 'postgresql' && p.importedFrom?.store === s.name).map((p) => p.name)
    const sqlite = list.filter((s) => s.kind === 'sqlite')
    const pg = list.filter((s) => s.kind === 'postgresql')
    const connections = Object.entries(saved.postgresql).map(([name, c]) => {
      const mine = pg.filter((s) => s.connection === name)
      const known = mine.map((s) => s.size?.bytes ?? null).filter((b) => b !== null)
      return {
        name,
        url: redactUrl(c.url),
        synchronousCommit: c.synchronousCommit,
        stores: mine.map((s) => s.name),
        ...urlParts(c.url),
        health: supports.postgresqlStatus ? this.checks.connectionHealth(name) : { state: 'unknown', at: null, message: null, serverVersion: null, latencyMs: null },
        bytes: known.length ? sum(known) : null,
      }
    })
    const linkedHere = new Map(sqlite.filter((s) => s.link).map((s) => [`${s.link.remote}\0${s.link.file}`, s.name]))
    const remoteList = remotes.list.map((r) => {
      const linked = sqlite.filter((s) => s.link?.remote === r.name)
      const listed = supports.listCopies ? this.checks.listed(r.name) : null
      // linkedBy from this view's Stores, so a link made since the listing shows at once
      const files = listed ? listed.map((f) => ({ file: f.file, bytes: f.bytes, modified: f.modified, linkedBy: linkedHere.get(`${r.name}\0${f.file}`) ?? null })) : null
      const known = (files ?? linked.map((s) => ({ bytes: linkBytes(s.link) }))).map((f) => f.bytes).filter((b) => b !== null)
      return {
        name: r.name,
        provider: r.provider,
        endpoint: saved.remotes[r.name]?.endpoint ?? r.endpoint,
        reachAs: r.endpoint,
        account: r.account ?? null,
        jurisdiction: r.provider === 'r2' ? (r.jurisdiction ?? '') : null,
        bucket: r.bucket,
        prefix: r.prefix ?? '',
        hasSecret: !!saved.remotes[r.name],
        location: locations.get(r.name),
        stores: linked.map((s) => s.name),
        files,
        bytes: files ? sum(known) : !linked.length ? 0 : known.length ? sum(known) : null,
        health: supports.check || supports.listCopies ? this.checks.remoteHealth(r.name) : { state: 'unknown', at: null, message: null },
      }
    })
    const linkedSizes = sqlite.filter((s) => s.link).map((s) => linkBytes(s.link))
    const syncCounts = {}
    for (const s of list) syncCounts[s.sync.state] = (syncCounts[s.sync.state] ?? 0) + 1
    const view = {
      stores: { available: offers.stores, reason: offers.stores ? stores.error : NOT_IN_BUILD, list },
      remotes: { available: offers.remotes, reason: offers.remotes ? remotes.error : NOT_IN_BUILD, list: remoteList },
      postgresql: { available: offers.postgresql, reason: offers.postgresql ? null : NOT_IN_BUILD, connections },
      jobs: typeof runtime.sync?.get === 'function' ? this.sampler.list() : [],
      providers: await this.providers(runtime, offers),
      totals: {
        sqlite: { stores: sqlite.length, bytes: sum(sqlite.map((s) => s.size?.bytes ?? null)), unknown: sqlite.filter((s) => !s.size).length },
        postgresql: { stores: pg.length, connections: connections.length, bytes: sum(pg.map((s) => s.size?.bytes ?? null)), unknown: pg.filter((s) => !s.size).length },
        linked: { stores: linkedSizes.length, bytes: sum(linkedSizes), unknown: linkedSizes.filter((b) => b === null).length },
        sync: syncCounts,
      },
      supports,
      checkedAt: this.checks.checkedAt,
      checking: this.checks.checking,
    }
    if (sizes) this.last = { at: now, view }
    return view
  }

  /**
   * Sizes and open state of SQLite Stores store.list gave none for (E1
   * absent or null): one stat of every such Store's store.sqlite, -wal and
   * -shm. volume -> { file, wal, open, at }, or null when unreadable.
   */
  async fallbackSizes(list) {
    const volumes = list.filter((s) => s.kind !== 'postgresql' && s.volume && !(s.bytes && typeof s.bytes === 'object')).map((s) => s.volume)
    const out = new Map()
    if (!volumes.length) return out
    const paths = volumes.flatMap((v) => [storeFile(v), `${storeFile(v)}-wal`, `${storeFile(v)}-shm`])
    let sizes = null
    try {
      sizes = await this.stat(paths)
    } catch (error) {
      this.log(`[host] Store sizes: ${error?.message ?? error}`)
    }
    const at = Date.now()
    for (const v of volumes) {
      const file = sizes?.get(storeFile(v))
      out.set(v, sizes && typeof file === 'number' ? { file, wal: sizes.get(`${storeFile(v)}-wal`) ?? 0, open: sizes.has(`${storeFile(v)}-shm`), at } : null)
    }
    return out
  }

  /**
   * ProviderInfo[]: remote.providers() (E8, asked once per host process), else MinIO and R2 when the build has remotes.
   * LayerFS answers `{ id, available, reason? }` objects; a bare id string means available.
   */
  async providers(runtime, offers) {
    if (this.providerIds === null && offers.remotes && typeof runtime.remote?.providers === 'function') {
      // one ask: a build whose binding lacks the call answers the fallback from then on
      this.providerIds = false
      try {
        const answer = await runtime.remote.providers()
        if (Array.isArray(answer)) {
          const known = new Map()
          for (const p of answer) {
            if (typeof p === 'string') known.set(p, { available: true, reason: null })
            else if (p && typeof p.id === 'string') known.set(p.id, { available: p.available !== false, reason: typeof p.reason === 'string' ? p.reason : null })
          }
          this.providerIds = known
        }
      } catch (error) {
        this.log(`[host] remote.providers: ${error?.message ?? error}`)
      }
    }
    const known = offers.remotes ? this.providerIds || new Map(FALLBACK_PROVIDERS.map((id) => [id, { available: true, reason: null }])) : new Map()
    return PROVIDERS.map((id) => {
      const p = known.get(id)
      const available = p?.available === true
      return { id, available, reason: available ? null : (p?.reason ?? (offers.remotes ? 'Not in this LayerFS build yet' : NOT_IN_BUILD)) }
    })
  }

  /** A runtime Store record -> StoreInfo; `ctx` from view(). */
  storeInfo(s, ctx) {
    const kind = s.kind === 'postgresql' ? 'postgresql' : 'sqlite'
    let size = null
    let open = null
    if (kind === 'sqlite') {
      const e1 = s.bytes && typeof s.bytes === 'object' ? s.bytes : null
      const file = e1 ? num(e1.file) : null
      if (e1 && file !== null) {
        const wal = num(e1.wal) ?? 0
        size = { bytes: file + wal, file, wal, at: ctx.now }
      } else {
        const found = s.volume ? ctx.files.get(s.volume) : null
        if (found) size = { bytes: found.file + found.wal, file: found.file, wal: found.wal, at: found.at }
        open = found ? found.open : null
      }
      if (typeof s.open === 'boolean') open = s.open
    } else size = s.connection && s.schema ? this.checks.schemaSize(s.connection, s.schema) : null
    const heads = typeof s.heads === 'string' ? s.heads : null
    const raw = kind === 'sqlite' && s.link && typeof s.link.remote === 'string' && typeof s.link.file === 'string' ? s.link : null
    const running = this.sampler.running(s.name)
    const link = raw
      ? linkInfo({
          store: s.name,
          heads,
          headsSupported: ctx.supports.heads,
          link: { remote: raw.remote, file: raw.file, linked: timeOf(raw.linked), last: transfer(raw.last) },
          provider: ctx.remoteBy.get(raw.remote)?.provider ?? null,
          object: `${ctx.locations.get(raw.remote) ?? raw.remote}/${raw.file}/store.sqlite`,
          checks: this.checks.copy(s.name, raw.remote),
          checkSupported: ctx.supports.check,
          hasKeys: !!ctx.saved.remotes[raw.remote],
          job: running && running.kind !== 'import' && running.kind !== 'send' ? running : null,
        })
      : null
    let importedFrom = null
    if (kind === 'postgresql') {
      const e6 = s.importedFrom && typeof s.importedFrom.store === 'string' ? s.importedFrom : null
      const logged = ctx.saved.imports[s.name]
      if (e6) importedFrom = { store: e6.store, at: timeOf(e6.at), bytes: num(e6.bytes) }
      else if (logged && typeof logged.store === 'string') importedFrom = { store: logged.store, at: num(logged.at), bytes: num(logged.bytes) }
    }
    return {
      name: s.name,
      kind,
      volume: s.volume ?? null,
      connection: s.connection ?? null,
      schema: s.schema ?? null,
      synchronousCommit: s.synchronousCommit ?? null,
      link,
      projects: (s.projects ?? []).map((p) => (typeof p === 'string' ? p : p.name)),
      created: timeOf(s.created),
      legacy: !!s.legacy,
      size,
      bytes: size?.bytes ?? null,
      open,
      sync: storeSync({ kind, link, running: !!running && running.kind !== 'send' && running.kind !== 'import' }),
      importedFrom,
      imports: [],
      job: running?.id ?? null,
    }
  }

  /**
   * Store name -> { storeSync, storeProviders, connection } for the project
   * list (ProjectSummary), from a view at most JOIN_MS old, else a view read
   * now without sizes. Null when this LayerFS build has no Stores or the
   * view cannot be read.
   */
  async projectJoin() {
    let view = this.last && Date.now() - this.last.at < JOIN_MS ? this.last.view : null
    if (!view) {
      try {
        view = await this.view({ sizes: false })
      } catch (error) {
        this.log(`[host] the Stores for the project list: ${error?.message ?? error}`)
        return null
      }
    }
    if (!view.stores.available) return null
    return new Map(
      view.stores.list.map((s) => [
        s.name,
        {
          storeSync: s.sync.state,
          storeProviders: s.link?.provider ? [s.link.provider] : [],
          connection: s.connection,
        },
      ]),
    )
  }

  // ---------- checks ----------

  /**
   * POST /api/storage/check { store?, remote?, connection? }: checks the
   * matching Stores' linked files (one HEAD each, at most 4 at once,
   * skipping Stores with a running job or no keys), lists the matching
   * connections' files and checks PostgreSQL connections, then answers the view. An
   * empty body checks everything; a second ask while checks run joins them.
   */
  async check(body = {}) {
    const pick = (value, what) => (value == null || value === '' ? null : text(value, what, NAME))
    const only = { store: pick(body.store, 'the Store name'), remote: pick(body.remote, 'the remote'), connection: pick(body.connection, 'the connection') }
    const runtime = await this.runtime()
    let tasks = []
    try {
      tasks = await this.checkTasks(runtime, only)
    } catch (error) {
      this.log(`[host] storage check: ${error?.message ?? error}`)
    }
    if (tasks.length) {
      await this.checks.run(tasks)
      this.changed()
    }
    return this.view()
  }

  /** The check tasks (storage-checks.js Checks.run) for `only`: { store, remote, connection }, all null for everything. */
  async checkTasks(runtime, only, { jobs = true } = {}) {
    const offers = Storage.offers(runtime)
    const saved = this.saved()
    const all = !only.store && !only.remote && !only.connection
    const list = offers.stores ? await runtime.store.list() : []
    const supports = this.supports(runtime, list)
    const tasks = []
    const keysOf = (remote) => {
      const k = saved.remotes[remote]
      return k ? { credentials: { accessKey: k.accessKey, secretKey: k.secretKey }, secrets: [k.accessKey, k.secretKey] } : null
    }
    if (supports.check && (all || only.store || only.remote)) {
      for (const s of list) {
        if (s.kind === 'postgresql' || !s.link || (only.store && s.name !== only.store)) continue
        if (only.remote && s.link.remote !== only.remote) continue
        if (jobs && this.sampler.running(s.name)) continue
        const keys = keysOf(s.link.remote)
        if (!keys) continue
        tasks.push({ kind: 'copy', store: s.name, remote: s.link.remote, secrets: keys.secrets, call: () => runtime.store.check(s.name, { credentials: keys.credentials }) })
      }
    }
    if (supports.listCopies && (all || (only.remote && !only.store))) {
      const names = only.remote ? [only.remote] : offers.remotes ? (await runtime.remote.list()).map((r) => r.name) : []
      for (const name of names) {
        const keys = keysOf(name)
        if (!keys) continue
        tasks.push({ kind: 'list', remote: name, secrets: keys.secrets, call: () => runtime.remote.list_stores(name, { credentials: keys.credentials }) })
      }
    }
    if (supports.postgresqlStatus) {
      const ofStore = only.store ? list.find((s) => s.name === only.store && s.kind === 'postgresql')?.connection : null
      const names = all ? Object.keys(saved.postgresql) : [only.connection, ofStore].filter(Boolean)
      for (const name of new Set(names)) {
        const pg = saved.postgresql[name]
        if (!pg) continue
        const url = reachAs(pg.url, this.spec.worker)
        const schemas = list.filter((s) => s.kind === 'postgresql' && s.connection === name && s.schema).map((s) => s.schema)
        tasks.push({
          kind: 'connection',
          name,
          secrets: [pg.url, url, passwordOf(pg.url)],
          call: async () => {
            const started = performance.now()
            const answer = await runtime.postgresql.status({ url, schemas })
            return { ...answer, latencyMs: Math.round(performance.now() - started) }
          },
        })
      }
    }
    return tasks
  }

  // ---------- Stores ----------

  async createStore(body = {}) {
    const runtime = await this.need('stores')
    await runtime.store.create(text(body.name, 'the Store name', NAME))
    this.changed()
    return this.view()
  }

  async removeStore(name, body = {}) {
    const runtime = await this.need('stores')
    text(name, 'the Store name', NAME)
    if (body.confirm !== name) throw refuse(400, 'InvalidInput', `removing ${name} deletes every project in it; confirm with the Store's name`)
    await runtime.store.remove(name, { confirm: name })
    this.checks.forgetStore(name)
    const saved = this.saved()
    if (saved.imports[name]) {
      delete saved.imports[name]
      this.save(saved)
    }
    this.changed()
    return this.view()
  }

  // ---------- remotes ----------

  async addRemote(body = {}) {
    const runtime = await this.need('remotes')
    const name = text(body.name, 'the name', NAME)
    if (body.provider !== 'minio' && body.provider !== 'r2') throw refuse(400, 'InvalidInput', 'the provider is minio or r2')
    const r2 = body.provider === 'r2'
    // MinIO: an endpoint as entered; R2: the account id (and jurisdiction), which LayerFS turns into its endpoint
    const endpoint = r2 ? null : endpointOf(body.endpoint)
    const account = r2 ? text(body.account, 'the Cloudflare account id', ACCOUNT) : null
    const jurisdiction = r2 ? (body.jurisdiction ?? '') : null
    if (r2 && !JURISDICTIONS.includes(jurisdiction)) throw refuse(400, 'InvalidInput', 'the jurisdiction is eu, fedramp or none')
    const bucket = text(body.bucket, 'the bucket', BUCKET)
    const prefix = text(body.prefix ?? '', 'the prefix', PREFIX).replace(/^\/+|\/+$/g, '')
    const accessKey = typeof body.accessKey === 'string' ? body.accessKey.trim() : ''
    const secretKey = typeof body.secretKey === 'string' ? body.secretKey : ''
    if (!accessKey || !secretKey) throw refuse(400, 'InvalidInput', 'the access key and the secret key are both needed')
    const saved = this.saved()
    if (saved.remotes[name]) throw refuse(409, 'NameTaken', `a remote named ${name} exists`)
    // LayerFS keeps the definition; a MinIO endpoint it gets is the one the LayerFS box can reach
    if (r2) await runtime.remote.add({ name, provider: 'r2', account, jurisdiction, bucket, prefix })
    else await runtime.remote.add({ name, provider: 'minio', endpoint: reachAs(endpoint, this.spec.worker), bucket, prefix })
    saved.remotes[name] = { accessKey, secretKey, endpoint }
    this.save(saved)
    this.changed()
    return this.view()
  }

  async removeRemote(name) {
    const runtime = await this.need('remotes')
    text(name, 'the name', NAME)
    await runtime.remote.remove(name, { confirm: name })
    const saved = this.saved()
    delete saved.remotes[name]
    this.save(saved)
    this.checks.forgetRemote(name)
    this.changed()
    return this.view()
  }

  credentials(remote) {
    const secret = this.saved().remotes[remote]
    if (!secret) throw refuse(409, 'Conflict', `Connect has no keys for the remote ${remote}; remove it and add it again`)
    return { accessKey: secret.accessKey, secretKey: secret.secretKey }
  }

  /** A remote file's name from a request: `value`, else `fallback`. */
  fileName(value, fallback) {
    return text(value ?? fallback, 'the file name', FILE)
  }

  /** The Store `store`'s link, from store.list; refused NotLinked without one. */
  async linkOf(runtime, store) {
    const found = (await runtime.store.list()).find((s) => s.name === store)
    if (!found) throw refuse(404, 'NoSuchStore', `no Store named ${store}`)
    if (!found.link) throw refuse(409, 'NotLinked', `${store} is linked to no remote file; publish it first`)
    return found.link
  }

  /** Uploads the unlinked Store `store` to a new file `body.file` (default its name) on `body.remote`, linked: SyncJob. */
  async publish(store, body = {}) {
    const runtime = await this.need('remotes')
    text(store, 'the Store name', NAME)
    const remote = text(body.remote, 'the connection', NAME)
    const file = this.fileName(body.file, store)
    const job = await runtime.store.start_publish(store, { remote, file, credentials: this.credentials(remote) })
    this.checks.forgetStore(store)
    return this.track(job, { kind: 'publish', store, target: remote, file, provider: await this.providerOf(runtime, remote) })
  }

  /**
   * Uploads Store `store` (all of its projects) to its link: SyncJob.
   * `body.force: true` replaces a file that changed since the link's last
   * push or pull (LayerFS refuses it with Conflict otherwise).
   */
  async push(store, body = {}) {
    const runtime = await this.need('remotes')
    text(store, 'the Store name', NAME)
    if (body.remote !== undefined) throw refuse(400, 'InvalidInput', 'a push goes to the Store\'s link; it takes no remote')
    if (body.force !== undefined && typeof body.force !== 'boolean') throw refuse(400, 'InvalidInput', 'force is true or false')
    const force = body.force === true
    const link = await this.linkOf(runtime, store)
    const job = await runtime.store.start_push(store, { credentials: this.credentials(link.remote), ...(force ? { force: true } : {}) })
    return this.track(job, { kind: 'push', store, target: link.remote, file: link.file, provider: await this.providerOf(runtime, link.remote), force })
  }

  /** Replaces Store `store` with its linked file: SyncJob. */
  async pull(store, body = {}) {
    const runtime = await this.need('remotes')
    text(store, 'the Store name', NAME)
    if (body.remote !== undefined) throw refuse(400, 'InvalidInput', 'a pull comes from the Store\'s link; it takes no remote')
    if (body.confirm !== store) throw refuse(400, 'InvalidInput', `pull replaces the Store ${store} and every project in it; confirm with the Store's name`)
    const link = await this.linkOf(runtime, store)
    const job = await runtime.store.start_pull(store, { credentials: this.credentials(link.remote), confirm: store })
    return this.track(job, { kind: 'pull', store, target: link.remote, file: link.file, provider: await this.providerOf(runtime, link.remote) })
  }

  /** Uploads a copy of SQLite Store `store` to a new, unlinked file `body.file` on `body.remote`: SyncJob. The Store's link does not change. */
  async send(store, body = {}) {
    const runtime = await this.need('remotes')
    text(store, 'the Store name', NAME)
    const remote = text(body.remote, 'the connection', NAME)
    const file = this.fileName(body.file, `${store}-copy`)
    const job = await runtime.store.start_send(store, { remote, file, credentials: this.credentials(remote) })
    return this.track(job, { kind: 'send', store, target: remote, file, provider: await this.providerOf(runtime, remote) })
  }

  /** A new local Store `body.store` (default the file's name) from the file `body.file` in `remote`, linked to it: SyncJob. */
  async load(remote, body = {}) {
    const runtime = await this.need('remotes')
    text(remote, 'the connection', NAME)
    const file = this.fileName(body.file)
    const store = text(body.store ?? file, 'the new Store name', NAME)
    const job = await runtime.store.start_load(remote, { file, store, credentials: this.credentials(remote) })
    this.checks.forgetStore(store)
    return this.track(job, { kind: 'load', store, target: remote, file, from: file, provider: await this.providerOf(runtime, remote) })
  }

  /** Drops Store `store`'s link; its file stays in the bucket, loadable. Answers the view. */
  async unlink(store, body = {}) {
    const runtime = await this.need('remotes')
    text(store, 'the Store name', NAME)
    if (body.confirm !== store) throw refuse(400, 'InvalidInput', `unlinking ${store} makes it local only; confirm with the Store's name`)
    const answer = await runtime.store.unlink(store, { confirm: store })
    this.checks.forgetStore(store)
    await this.relist(runtime, answer?.remote)
    this.changed()
    return this.view()
  }

  /** GET /api/remotes/:name/files: the connection's files now (runtime.remote.list_stores), with the Store linked to each. */
  async files(remote) {
    const runtime = await this.need('remotes')
    text(remote, 'the connection', NAME)
    await this.relist(runtime, remote, { force: true })
    const view = await this.view({ sizes: false })
    const found = view.remotes.list.find((r) => r.name === remote)
    if (!found) throw refuse(404, 'NoSuchRemote', `no connection named ${remote}`)
    const health = found.health
    if (health.state !== 'ok' && found.files === null) throw refuse(502, health.state === 'denied' ? 'Denied' : 'Unavailable', health.message ?? `${remote} could not be listed`)
    return found.files ?? []
  }

  /** Lists the files of `remote` once (a check task), when Connect has its keys. */
  async relist(runtime, remote, { force = true } = {}) {
    if (!remote) return
    const tasks = (await this.checkTasks(runtime, { store: null, remote, connection: null })).filter((t) => t.kind === 'list')
    await this.checks.run(tasks, { force })
  }

  // ---------- PostgreSQL ----------

  async addPostgresql(body = {}) {
    await this.need('postgresql')
    const name = text(body.name, 'the connection name', NAME)
    const url = postgresUrl(body.url)
    const synchronousCommit = body.synchronousCommit ?? 'off'
    if (!SYNC_COMMIT.includes(synchronousCommit)) throw refuse(400, 'InvalidInput', `synchronous_commit is one of ${SYNC_COMMIT.join(', ')}`)
    const saved = this.saved()
    if (saved.postgresql[name]) throw refuse(409, 'NameTaken', `a connection named ${name} exists`)
    saved.postgresql[name] = { url, synchronousCommit }
    this.save(saved)
    this.changed()
    return this.view()
  }

  async removePostgresql(name) {
    text(name, 'the connection name', NAME)
    const saved = this.saved()
    if (!saved.postgresql[name]) throw refuse(404, 'not-found', `no connection named ${name}`)
    delete saved.postgresql[name]
    this.save(saved)
    this.checks.forgetConnection(name)
    this.changed()
    return this.view()
  }

  /** Copies SQLite Store `store` into a schema of `body.connection`, as the new Store `body.name`: SyncJob. */
  async importPostgresql(store, body = {}) {
    const runtime = await this.need('postgresql')
    text(store, 'the Store name', NAME)
    const connection = text(body.connection, 'the connection', NAME)
    const pg = this.saved().postgresql[connection]
    if (!pg) throw refuse(409, 'Conflict', `no PostgreSQL connection named ${connection}`)
    const name = text(body.name ?? `${store}-pg`, 'the new Store name', NAME)
    const schema = text(body.schema ?? `lfc_${name.replace(/-/g, '_')}`, 'the schema', SCHEMA)
    const job = await runtime.store.start_import_postgresql(store, {
      name,
      connection,
      url: reachAs(pg.url, this.spec.worker),
      schema,
      synchronousCommit: pg.synchronousCommit,
    })
    return this.track(job, { kind: 'import', store, target: `${connection}/${schema}`, from: name, provider: 'postgresql', connection })
  }

  /** The URL (as the Store calls reach it) of the connection holding the PostgreSQL Store `store`: for reading its projects (projects.js). */
  async urlForStore(store) {
    const runtime = await this.projects.runtime()
    const found = (await runtime.store.list()).find((s) => s.name === store && s.kind === 'postgresql')
    if (!found?.connection) throw refuse(404, 'NoSuchStore', `no PostgreSQL Store named ${store}`)
    const pg = this.saved().postgresql[found.connection]
    if (!pg) throw refuse(409, 'Conflict', `Connect has no PostgreSQL connection named ${found.connection}`)
    const worker = this.spec.worker && `${this.spec.prefix}worker`
    return reachPostgresql(pg.url, worker, (args) => runtime.platform.docker(runtime.settings, args))
  }

  connectionFor(connection) {
    const pg = this.saved().postgresql[connection]
    if (!pg) throw refuse(409, 'Conflict', `Connect has no PostgreSQL connection named ${connection}`)
    return { url: reachAs(pg.url, this.spec.worker), synchronousCommit: pg.synchronousCommit }
  }

  // ---------- jobs ----------

  /** The provider of `remote`, from the last view, else remote.list; null when unknown. */
  async providerOf(runtime, remote) {
    const seen = this.last?.view.remotes.list.find((r) => r.name === remote)
    if (seen) return seen.provider
    try {
      return (await runtime.remote.list()).find((r) => r.name === remote)?.provider ?? null
    } catch {
      return null
    }
  }

  /** Follows a job this host started (`known`: kind, store, target, file, from, provider, force): its first SyncJob. */
  track(job, known) {
    const answer = this.sampler.track(job, { from: null, file: null, provider: null, force: false, ...known, started: Date.now() })
    this.changed()
    return answer
  }

  /** SyncJob for `id`: its last sample (read every 500 ms while it runs). */
  async syncJob(id) {
    const runtime = await this.runtime()
    if (typeof runtime.sync?.get !== 'function') throw refuse(501, 'Unsupported', NOT_IN_BUILD)
    const job = this.sampler.job(id)
    if (!job) throw refuse(404, 'not-found', `no sync job ${id}`)
    return job
  }

  /**
   * A job ended: an import that worked is logged (the From column without
   * E6), the Store's linked file (or the connection it filled) is checked
   * once, the connection's files are listed again, and listeners are told
   * the view changed.
   */
  async ended(job, known) {
    try {
      if (job.kind === 'import' && job.step === 'done' && known.from) {
        const saved = this.saved()
        saved.imports[known.from] = { store: known.store, at: job.ended ?? Date.now(), bytes: job.result?.bytes ?? null }
        this.save(saved)
      }
      const runtime = await this.runtime()
      const only = job.kind === 'import' ? { store: null, remote: null, connection: known.connection ?? null } : { store: job.store, remote: null, connection: null }
      if (only.connection || only.store) {
        const tasks = (await this.checkTasks(runtime, only, { jobs: false })).filter((t) => t.kind !== 'list')
        await this.checks.run(tasks, { force: true })
      }
      if (job.kind !== 'import') await this.relist(runtime, known.target)
    } catch (error) {
      this.log(`[host] after the ${job.kind} of ${job.store}: ${error?.message ?? error}`)
    }
    this.changed()
  }
}
