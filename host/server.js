// The host's HTTP API (README.md, "HTTP API"): routes, the bearer token,
// CORS and the event stream. It holds no LayerFS state of its own: project
// routes go to `projects` (projects.js) and demo and run routes to `runs`
// (the RunManager of runs/), which may be missing; then those routes answer
// 503 with the reason it did not load.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'
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
  NoSuchProcess: 404,
  Busy: 409,
  Conflict: 409,
  Exists: 409,
  NameTaken: 409,
  MountsActive: 409,
  NotComparable: 409,
  // layerfs#509: one link per Store
  Linked: 409,
  NotLinked: 409,
  InUse: 409,
  NoSuchStore: 404,
  NoSuchRemote: 404,
  // a remote's failures (pull, load, files)
  NoSuchFile: 404,
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
  const body = JSON.stringify(value)
  res.writeHead(status, { ...CORS, 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) })
  res.end(body)
}

/** The status and { code, message } an error answers. */
export function errorAnswer(error) {
  const code = typeof error?.code === 'string' ? error.code : 'failed'
  const status = Number.isInteger(error?.status) ? error.status : (STATUS[code] ?? 500)
  return { status, body: { code, message: error?.message ?? String(error) } }
}

/**
 * The request handler.
 * @param {object} deps
 * @param {string} deps.token the bearer token every route needs
 * @param {object} deps.projects projects.js's Projects (or a stand-in)
 * @param {() => object | null} deps.runs the RunManager, null while it is missing
 * @param {() => object | null} [deps.agents] the interactive Pi AgentManager
 * @param {() => string | null} [deps.runsError] why the RunManager is missing
 * @param {object} [deps.storage] storage.js's Storage: Stores, remotes, publish/push/pull/send/load/unlink, PostgreSQL (absent: those routes 404)
 * @param {object} [deps.models] models.js's Models: the model providers (absent: those routes 404)
 * @param {number} [deps.heartbeatMs]
 * @param {(line: string) => void} [deps.log]
 */
export function createHandler(deps) {
  const { token, projects, storage = null, models = null, runs = () => null, agents = () => null, runsError = () => null, heartbeatMs = HEARTBEAT_MS, log = (line) => process.stderr.write(`${line}\n`) } = deps
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
      return agentRoute(manager, method, parts.slice(2), body ?? {}, query)
    }
    if (api !== 'api') return undefined
    if (group === 'models' && models && parts.length === 5) {
      const action = rest[0]
      if (id === 'providers' && action === 'login' && method === 'POST') return models.startLogin(sub)
      if (id === 'logins' && method === 'POST' && action === 'respond') return models.respondLogin(sub, body)
      if (id === 'logins' && method === 'POST' && action === 'cancel') return models.cancelLogin(sub)
      if (id === 'logins' && method === 'POST' && action === 'open') return models.openLogin(sub)
      return undefined
    }
    if (rest.length) return undefined
    if (group === 'models' && models) {
      if (id === 'logins' && sub && method === 'GET') return models.loginView(sub)
      if (!id && method === 'GET') return models.view()
      if (id === 'providers' && sub && method === 'POST') return models.saveProvider(sub, body)
      if (id === 'providers' && sub && method === 'DELETE') return models.removeProvider(sub)
      if (id === 'custom' && !sub && method === 'POST') return models.saveCustom(body)
      if (id === 'default' && !sub && method === 'POST') return models.setDefault(body)
      return undefined
    }
    // layerfs#506: Stores (each holding many projects), remotes and PostgreSQL connections
    if (storage) {
      if (group === 'storage' && !id && method === 'GET') return storage.view()
      // re-reads the linked files' remote state, the connections' files and status: { store?, remote?, connection? }, empty for all
      if (group === 'storage' && id === 'check' && !sub && method === 'POST') return storage.check(body ?? {})
      if (group === 'stores') {
        if (!id && method === 'POST') return storage.createStore(body ?? {})
        if (id && !sub && method === 'DELETE') return storage.removeStore(id, { confirm: query.get('confirm') })
        // layerfs#509: one link per Store
        if (id && method === 'POST' && sub === 'publish') return storage.publish(id, body ?? {})
        if (id && method === 'POST' && sub === 'push') return storage.push(id, body ?? {})
        if (id && method === 'POST' && sub === 'pull') return storage.pull(id, body ?? {})
        if (id && method === 'POST' && sub === 'send') return storage.send(id, body ?? {})
        if (id && method === 'POST' && sub === 'unlink') return storage.unlink(id, body ?? {})
        if (id && method === 'POST' && sub === 'import-postgresql') return storage.importPostgresql(id, body ?? {})
        return undefined
      }
      if (group === 'remotes') {
        if (!id && method === 'POST') return storage.addRemote(body ?? {})
        if (id && !sub && method === 'DELETE') return storage.removeRemote(id)
        if (id && sub === 'files' && method === 'GET') return storage.files(id)
        if (id && sub === 'load' && method === 'POST') return storage.load(id, body ?? {})
        return undefined
      }
      if (group === 'postgresql') {
        if (!id && method === 'POST') return storage.addPostgresql(body ?? {})
        if (id && !sub && method === 'DELETE') return storage.removePostgresql(id)
        return undefined
      }
      if (group === 'sync-jobs' && id && !sub && method === 'GET') return storage.syncJob(id)
    }
    if (group === 'status' && !id && method === 'GET') return projects.status()
    if (group === 'worker' && id === 'start' && !sub && method === 'POST') return projects.startWorker()
    if (group === 'inits' && id && !sub && method === 'GET') return projects.initJob(id)
    if (group === 'projects') {
      if (!id) return method === 'GET' ? projects.list() : method === 'POST' ? projects.create(body ?? {}) : undefined
      // layerfs#506: ?store= names the Store when the project's name is in several
      const store = query.get('store') || null
      if (!sub && method === 'GET') return projects.state(id, store)
      if (!sub && method === 'DELETE') {
        // a project's chats release their Workspaces before the project goes
        const manager = agents()
        return manager ? manager.removeProject(id, () => projects.remove(id, store)) : projects.remove(id, store)
      }
      if (method !== 'GET') return undefined
      const branch = query.get('branch') ?? 'main'
      if (sub === 'commits') return projects.commits(id, branch, query.get('limit'), store)
      // several Branches' Commits in one call: ?branch=a&branch=b
      if (sub === 'branch-commits') return projects.branchCommits(id, query.getAll('branch'), store)
      if (sub === 'fs') return projects.listDir(id, branch, query.get('path') ?? '/', store)
      if (sub === 'file') return projects.file(id, branch, query.get('path'), store)
      return undefined
    }
    if (group === 'demos') {
      if (!id && method === 'GET') return engine().demos()
      if (id && !sub && method === 'GET') return found(engine().demo(id), `demo ${id}`)
      // every scenario at once, each in its own folder of the project
      if (id === 'all' && sub === 'runs' && method === 'POST') return engine().startAll({ project: body?.project ?? null })
      if (id && sub === 'runs' && method === 'POST') return engine().start(id, { project: body?.project ?? null })
      return undefined
    }
    if (group === 'sessions' && !id && method === 'POST') return engine().startLive(body ?? {})
    if (group === 'runs') {
      if (!id && method === 'GET') return engine().runs(query.get('demo') || undefined)
      if (id && !sub && method === 'GET') return found(engine().run(id), `run ${id}`)
      if (id && !sub && method === 'DELETE') return engine().remove(id)
      if (id && sub === 'trace' && method === 'GET') return engine().trace(id, { agent: query.get('agent'), before: query.get('before'), limit: query.get('limit') ?? undefined })
      if (id && sub === 'stop' && method === 'POST') return engine().stop(id)
      if (id && sub === 'messages' && method === 'POST') return engine().say(id, body ?? {})
      return undefined
    }
    return undefined
  }

  /**
   * The event stream: one `data:` line per HostEvent (the RunManager's
   * RunEvents, and storage.js's { type: 'sync', job } and { type: 'storage' }),
   * a comment heartbeat, cleaned up on close.
   */
  function events(req, res) {
    res.writeHead(200, { ...CORS, 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive' })
    res.write(': connected\n\n')
    const manager = runs()
    const agentManager = agents()
    const forward = (event) => res.write(`data: ${JSON.stringify(event)}\n\n`)
    manager?.on('event', forward)
    storage?.on?.('event', forward)
    agentManager?.on('event', forward)
    const beat = setInterval(() => res.write(': heartbeat\n\n'), heartbeatMs)
    const stream = { res, close: () => res.end() }
    streams.add(stream)
    const done = () => {
      clearInterval(beat)
      manager?.off('event', forward)
      storage?.off?.('event', forward)
      agentManager?.off('event', forward)
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
      const body = method === 'POST' ? await readBody(req, parts[1] === 'agent' ? AGENT_BODY_MAX : BODY_MAX) : undefined
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

/** Most a request body may hold. */
const BODY_MAX = 64 * 1024
/** Agent messages carry attachments: at most 20 MiB of files, sent as base64. */
const AGENT_BODY_MAX = 28 * 1024 * 1024

/** A POST's JSON body (an object), or undefined when it sent none. */
async function readBody(req, max = BODY_MAX) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > max) throw httpError(413, 'too-large', `a request body holds at most ${max} bytes`)
    chunks.push(chunk)
  }
  if (!size) return undefined
  let value
  try {
    value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw httpError(400, 'invalid-input', 'the request body is not JSON')
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw httpError(400, 'invalid-input', 'the request body is a JSON object')
  return value
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
