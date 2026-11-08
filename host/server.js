// The host's HTTP API (README.md, "HTTP API"): routes, the bearer token,
// CORS and the event stream. It holds no LayerFS state of its own: project
// routes go to `projects` (projects.js), Store, bucket, PostgreSQL, push,
// pull, backup and restore routes to `storage` (storage.js), agent routes to the AgentManager
// (agents/routes.js), and demo and run routes to `runs` (the RunManager of
// runs/), which may be missing; then those routes answer 503 with the reason
// it did not load. In sim mode `sim` answers /api/sim (the simulated world's
// preset and the presets it can start from) and /api/sim/reset.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'
import { stringify } from './cli/json.js'
import { agentRoute } from './agents/routes.js'

/** A comment line on every event stream this often, so idle proxies and sockets stay open. */
export const HEARTBEAT_MS = 15_000

/** LayerFS refusal codes and the HTTP status each answers. Anything else is 500. */
const STATUS = {
  InvalidInput: 400,
  IsDirectory: 400,
  NotDirectory: 400,
  NotFile: 400,
  NotText: 400,
  Binary: 400,
  TooLarge: 400,
  NoSuchProject: 404,
  NoSuchPath: 404,
  NoSuchBranch: 404,
  NoSuchCommit: 404,
  NoSuchSandbox: 404,
  NoSuchStore: 404,
  NoSuchWorkspace: 404,
  NoMatch: 400,
  AmbiguousMatch: 400,
  NotFound: 404,
  // the SDK's: an operation holds the entity (detail names it, its phase and op)
  Busy: 409,
  // the SDK's: an operation's outcome was lost; the message names the clearing call
  Unresolved: 409,
  // Connect's own guards (one job per Store on this host, scenario limits)
  ConnectBusy: 409,
  Capacity: 507,
  Unknown: 500,
  Conflict: 409,
  Exists: 409,
  NameTaken: 409,
  HeadMoved: 409,
  Dirty: 409,
  ReadOnly: 409,
  InUse: 409,
  Denied: 403,
  Unavailable: 502,
  Unsupported: 501,
}

/** A random 32-byte token, as hex. */
export const newToken = () => randomBytes(32).toString('hex')

/** An error the routes throw: answered as { code, message } with `status`. */
export const httpError = (status, code, message) => Object.assign(new Error(message), { status, code })

// Hashing both sides gives equal lengths, so the comparison takes the same time whatever was sent
const digest = (text) => createHash('sha256').update(String(text)).digest()
const same = (a, b) => timingSafeEqual(digest(a), digest(b))

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
  'access-control-allow-headers': 'Authorization, Content-Type',
  'access-control-max-age': '600',
}

function send(res, status, value) {
  const body = stringify(value)
  res.writeHead(status, { ...CORS, 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) })
  res.end(body)
}

/**
 * A layout 2 home's conversion refusal (#536 F2): `InUse` whose
 * `detail.related` names what is live with `why` (what ends it). Only that
 * refusal carries `why`.
 */
export const isConversion = (code, detail) => code === 'InUse' && Array.isArray(detail?.related) && detail.related.some((r) => typeof r?.why === 'string')

/**
 * The status and body an error answers: { code, message, detail? } with the
 * SDK's refusal as it came (its text names any status or clearing call;
 * `detail` holds entity, phase, op and related), and `conversion: true` for
 * a layout 2 home's conversion refusal.
 */
export function errorAnswer(error) {
  const code = typeof error?.code === 'string' ? error.code : 'failed'
  const status = Number.isInteger(error?.status) ? error.status : (STATUS[code] ?? 500)
  const detail = error?.detail && typeof error.detail === 'object' ? error.detail : null
  return { status, body: { code, ...(error?.transport ? { transport: error.transport } : {}), message: error?.message ?? String(error), ...(detail ? { detail } : {}), ...(isConversion(code, detail) ? { conversion: true } : {}) } }
}

/**
 * The request handler.
 * @param {object} deps
 * @param {string} deps.token the bearer token every route needs
 * @param {object} deps.projects projects.js's Projects (or a stand-in)
 * @param {() => object | null} deps.runs the RunManager, null while it is missing
 * @param {() => object | null} [deps.agents] the interactive Pi AgentManager
 * @param {() => string | null} [deps.runsError] why the RunManager is missing
 * @param {object} [deps.storage] storage.js's Storage: Stores, buckets, push/pull/move, backup/restore, PostgreSQL, doctor (absent: those routes 404)
 * @param {object} [deps.machines] machines.js's Machines: Compute's machines (absent: those routes 404)
 * @param {object} [deps.sim] in sim mode, the simulated world: { info(), reset(preset) } (absent: those routes 404)
 * @param {number} [deps.heartbeatMs]
 * @param {(line: string) => void} [deps.log]
 */
export function createHandler(deps) {
  const { token, projects, storage = null, machines = null, doctor = null, sim = null, runs = () => null, agents = () => null, runsError = () => null, heartbeatMs = HEARTBEAT_MS, log = (line) => process.stderr.write(`${line}\n`) } = deps
  const streams = new Set()

  /** The RunManager, or a 503 naming why it is not there. */
  const engine = () => {
    const manager = runs()
    if (!manager) throw httpError(503, 'engine-unavailable', `the demo engine did not load: ${runsError() ?? 'not loaded yet'}`)
    return manager
  }
  const found = (value, what) => {
    if (value == null) throw httpError(404, 'not-found', `no ${what}`)
    return value
  }

  /** method + path segments -> the answer, or undefined when no route matches. */
  async function route(method, parts, query, body) {
    const [api, group, id, sub, ...rest] = parts
    if (api === 'api' && group === 'agent') {
      const manager = agents()
      if (!manager) throw httpError(503, 'agent-unavailable', 'The agent runtime has not started.')
      return agentRoute(manager, method, parts.slice(2), body, query)
    }
    if (api !== 'api' || rest.length) return undefined
    if (doctor && group === 'doctor-jobs' && !sub) {
      if (!id && method === 'POST') return doctor.launch(body ?? {})
      if (!id && method === 'GET') return doctor.list()
      if (id && method === 'GET') return doctor.get(id)
    }
    // Stores, buckets and the moves, backups and restores this host started (storage.js)
    if (storage) {
      if (group === 'storage' && !id && method === 'GET') return storage.view()
      // lists the buckets' files again (backup.list, one call per bucket): { bucket? }, empty for all
      if (group === 'storage' && id === 'check' && !sub && method === 'POST') return storage.check(body ?? {})
      if (group === 'stores') {
        if (!id && method === 'POST') return storage.createStore(body ?? {})
        // a PostgreSQL database: { name, url, password (a reference), synchronousCommit? }
        if (id === 'postgresql' && !sub && method === 'POST') return storage.connectPostgresql(body ?? {})
        if (id && sub === 'stats' && method === 'GET') return projects.storeStats(id)
        if (id && !sub && method === 'DELETE') return storage.removeStore(id, { confirm: query.get('confirm') })
        if (id && sub === 'disconnect' && method === 'POST') return storage.disconnectStore(id)
        // a sqlite Store on native to a machine: { machine }
        if (id && sub === 'push' && method === 'POST') return storage.push(id, body?.machine)
        // a sqlite Store on a machine back to native
        if (id && sub === 'pull' && method === 'POST') return storage.pull(id)
        // between two machines, pull then push in one job: { machine }
        if (id && sub === 'move' && method === 'POST') return storage.move(id, body?.machine)
        // { bucket, file? }
        if (id && sub === 'backup' && method === 'POST') return storage.backup(id, body ?? {})
        return undefined
      }
      if (group === 'buckets') {
        // { name, url, key (a reference), region? }
        if (!id && method === 'POST') return storage.connectBucket(body ?? {})
        if (id && !sub && method === 'DELETE') return storage.disconnectBucket(id)
        if (id && sub === 'files' && method === 'GET') return storage.listBucket(id)
        if (id && sub === 'keys' && method === 'POST') return storage.replaceBucketKeys(id, body)
        // { store (the new Store's name), file? }: installs on native
        if (id && sub === 'restore' && method === 'POST') return storage.restore({ ...(body ?? {}), bucket: id })
        return undefined
      }
      if (group === 'storage-jobs' && id && !sub && method === 'GET') return storage.job(id)
      if (group === 'storage-jobs' && id && sub === 'inspect' && method === 'POST') return storage.inspect(id)
      if (group === 'storage-jobs' && id && sub === 'retry' && method === 'POST') return storage.retry(id)
      // layerfs doctor: report-only, starts nothing (#537 §8.7)
      if (group === 'doctor' && !id && method === 'GET') return storage.doctor()
    }
    // Compute's machines. Power is manual (#535 D11): start and stop are their own calls, and no read starts one
    if (machines && group === 'platforms' && !id && method === 'GET') return machines.platforms()
    if (machines && group === 'machines') {
      if (!id && !sub && method === 'GET') return machines.view()
      if (id && sub === 'inspect' && method === 'GET') return machines.inspect(id)
      if (id && sub === 'start' && method === 'POST') return machines.start(id)
      if (id && sub === 'stop' && method === 'POST') return machines.stop(id)
      if (!id && !sub && method === 'POST') return machines.create(body)
      if (id && !sub && method === 'DELETE') return machines.remove(id)
      if (id && sub === 'update' && method === 'POST') return machines.update(id, body)
      // puts a sqlite Store here (push, pull, or pull then push): { store }
      if (id && sub === 'stores' && method === 'POST') return machines.moveStore(body?.store, id)
    }
    if (group === 'status' && !id && method === 'GET') return projects.status()
    // the simulated world (sim mode only): its preset, and a fresh copy of one
    if (sim && group === 'sim' && !id && method === 'GET') return sim.info()
    if (sim && group === 'sim' && id === 'reset' && !sub && method === 'POST') return sim.reset(body?.preset)
    // `id` is a project key, `<store>/<project>`, sent as one encoded segment
    if (group === 'projects') {
      if (!id) {
        if (method === 'GET') return projects.list()
        if (method === 'POST') return projects.create(body)
        return undefined
      }
      if (!sub && method === 'GET') return projects.state(id)
      if (!sub && method === 'DELETE') {
        const manager = agents()
        return manager ? manager.removeProject(id, () => projects.remove(id)) : projects.remove(id)
      }
      // a new Sandbox: { name, image?, machine? (PostgreSQL projects only) }
      if (sub === 'sandboxes' && method === 'POST') return projects.createSandbox(id, body ?? {})
      // closes every Sandbox of the project: { force? }
      if (sub === 'close-sandboxes' && method === 'POST') return projects.closeSandboxes(id, { force: body?.force === true })
      if (method !== 'GET') return undefined
      const branch = query.get('branch') ?? 'main'
      if (sub === 'history') return projects.history(id, query)
      if (sub === 'branches') return projects.branches(id, query)
      if (sub === 'file-query') return projects.fileQuery(id, query)
      if (sub === 'stats') return projects.projectStats(id, query)
      if (sub === 'commits') return projects.commits(id, branch, query.get('limit'))
      // several Branches' Commits in one call: ?branch=a&branch=b
      if (sub === 'branch-commits') return projects.branchCommits(id, query.getAll('branch'))
      // the Sandboxes with their Workspaces (sandbox.get each)
      if (sub === 'sandboxes') return projects.sandboxes(id)
      if (sub === 'fs') return projects.listDir(id, branch, query.get('path') ?? '/', query.get('pin'), query.get('pos') ?? 0)
      if (sub === 'file') return projects.file(id, branch, query.get('path'), query.get('pin'), query.get('line') ?? 1)
      return undefined
    }
    // sandbox.close(name, { force }): ?force=1
    if (group === 'sandboxes' && id && !sub && method === 'DELETE') return projects.closeSandbox(id, { force: query.get('force') === '1' })
    // one Sandbox with its Workspaces (sandbox.get)
    if (group === 'sandboxes' && id && !sub && method === 'GET') return projects.sandbox(id)
    // a Workspace in it: { branch, fork?, name? } (only side Branches are mounted, D14)
    if (group === 'sandboxes' && id && sub === 'workspaces' && method === 'POST') return projects.mount(id, body ?? {})
    // workspace.unmount: ?discard=1
    if (group === 'workspaces' && id && sub === 'status' && method === 'GET') return projects.lfs.workspace.status(id)
    if (group === 'workspaces' && id && !sub && method === 'DELETE') return projects.unmount(id, { discard: query.get('discard') === '1' })
    if (group === 'project-inits' && !id && method === 'GET') return projects.initJobs()
    if (group === 'project-inits' && id && !sub && method === 'GET') return projects.init(id)
    if (group === 'demos') {
      if (!id && method === 'GET') return engine().demos()
      if (id && !sub && method === 'GET') return found(engine().demo(id), `demo ${id}`)
      // every scenario at once, each in its own folder of the project: { project }
      if (id === 'all' && sub === 'runs' && method === 'POST') return engine().startAll({ project: body?.project ?? null })
      // one scenario in a folder of its own on a project that is there: { project } (a project key)
      if (id && sub === 'runs' && method === 'POST') return engine().start(id, { project: body?.project ?? null, machine: body?.machine ?? null })
      return undefined
    }
    if (group === 'runs') {
      if (!id && method === 'GET') return engine().runs(query.get('demo') || undefined)
      if (id && !sub && method === 'GET') return found(engine().run(id), `run ${id}`)
      if (id && !sub && method === 'DELETE') return engine().remove(id)
      if (id && sub === 'trace' && method === 'GET') return engine().trace(id, { agent: query.get('agent'), before: query.get('before'), limit: query.get('limit') ?? undefined })
      if (id && sub === 'stop' && method === 'POST') return engine().stop(id)
      return undefined
    }
    return undefined
  }

  /**
   * The event stream: one `data:` line per HostEvent (the RunManager's
   * RunEvents, the AgentManager's chat events, and storage.js's
   * { type: 'sync', job } and { type: 'storage' }), a comment heartbeat,
   * cleaned up on close.
   */
  function events(req, res) {
    res.writeHead(200, { ...CORS, 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive' })
    res.write(': connected\n\n')
    const manager = runs()
    const agentManager = agents()
    const forward = (event) => res.write(`data: ${stringify(event)}\n\n`)
    manager?.on('event', forward)
    agentManager?.on('event', forward)
    storage?.on?.('event', forward)
    doctor?.on?.('event', forward)
    const beat = setInterval(() => res.write(': heartbeat\n\n'), heartbeatMs)
    const stream = { res, close: () => res.end() }
    streams.add(stream)
    const done = () => {
      clearInterval(beat)
      manager?.off('event', forward)
      agentManager?.off('event', forward)
      storage?.off?.('event', forward)
      doctor?.off?.('event', forward)
      streams.delete(stream)
    }
    req.on('close', done)
    res.on('close', done)
  }

  async function handle(req, res) {
    const method = req.method ?? 'GET'
    if (method === 'OPTIONS') {
      res.writeHead(204, CORS)
      return res.end()
    }
    let url
    try {
      url = new URL(req.url ?? '/', 'http://127.0.0.1')
    } catch {
      return send(res, 400, { code: 'invalid-input', message: 'bad request URL' })
    }
    let parts
    try {
      parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
    } catch {
      return send(res, 400, { code: 'invalid-input', message: 'bad path encoding' })
    }
    const isEvents = parts.length === 2 && parts[0] === 'api' && parts[1] === 'events'
    const header = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1]
    const given = isEvents ? (url.searchParams.get('token') ?? header) : header
    if (!given || !same(given, token)) return send(res, 401, { code: 'unauthorized', message: 'a valid bearer token is required' })
    if (isEvents) {
      if (method !== 'GET') return send(res, 405, { code: 'method-not-allowed', message: `${method} ${url.pathname}` })
      return events(req, res)
    }
    try {
      let body = {}
      if (method === 'POST') {
        const chunks = []
        for await (const chunk of req) chunks.push(chunk)
        if (chunks.length) {
          try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) }
          catch { throw httpError(400, 'invalid-input', 'Invalid JSON request body.') }
        }
      }
      const answer = await route(method, parts, url.searchParams, body)
      if (answer === undefined) return send(res, 404, { code: 'not-found', message: `no route ${method} ${url.pathname}` })
      send(res, 200, answer)
    } catch (error) {
      const { status, body } = errorAnswer(error)
      if (status >= 500 && status !== 503) log(`${method} ${url.pathname}: ${error?.stack ?? body.message}`)
      if (!res.headersSent) send(res, status, body)
      else res.end()
    }
  }

  handle.closeStreams = () => {
    for (const stream of [...streams]) stream.close()
  }
  return handle
}

/** An http.Server for `deps` (see createHandler); `close()` also ends open event streams. */
export function createHostServer(deps) {
  const handle = createHandler(deps)
  const server = createServer((req, res) => void handle(req, res))
  const close = server.close.bind(server)
  server.close = (callback) => {
    handle.closeStreams()
    const result = close(callback)
    server.closeIdleConnections?.()
    return result
  }
  return server
}

/** Listens on 127.0.0.1:`port` (0: any free port); answers the base URL. */
export function listen(server, port = 0) {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject)
      resolve(`http://127.0.0.1:${server.address().port}`)
    })
  })
}
