// The Connect host's entry (README.md, "Process protocol"):
//   node --import ./host/resolve-layerfs.js host/main.js [--state <dir>] [--port <n>]
// It resolves Connect's settings, opens the LayerFS runtime, starts the
// home's worker in the background when it can and it is not running (a
// failed start is reported in status, the host keeps serving), loads the
// demo engine (runs/) and serves HTTP on 127.0.0.1. Once it listens it
// prints one line on stdout, {"ready":true,"url","token"}, or
// {"ready":false,"error"} and exits 1. Logs go to stderr. It exits when
// stdin closes or on SIGTERM, closing the runtime first; it never stops the
// worker. While it serves, <state>/host.json (owner-only) holds the same
// url and token and its pid, so tools on this machine can drive the running
// app's host (tools/connect-run.mjs); it is removed at exit.
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { APP, openRuntime, resolveSpec } from './config.js'
import { AgentManager } from './agents/index.js'
import { Projects } from './projects.js'
import { AgentWorkspaces } from './agents/workspaces.js'
import { createHostServer, listen, newToken } from './server.js'
import { Storage } from './storage.js'

/** How long shutdown may take before the process exits anyway. */
const CLOSE_MS = 30_000

const log = (line) => process.stderr.write(`${line}\n`)
// Once the app has quit, its end of these pipes is gone: a write must not end
// the shutdown that closes the runs' Sandboxes.
for (const stream of [process.stdout, process.stderr]) stream.on('error', () => {})

/** `--state <dir>` and `--port <n>` (also `--name=value`). */
function parseArgs(argv) {
  const options = {}
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = argv[i].split(/=(.*)/s, 2)
    if (flag !== '--state' && flag !== '--port') throw new Error(`unknown argument ${argv[i]}`)
    const value = inline ?? argv[++i]
    if (value === undefined) throw new Error(`${flag} needs a value`)
    options[flag.slice(2)] = value
  }
  if (options.port !== undefined && !/^\d+$/.test(options.port)) throw new Error('--port must be a whole number')
  return { state: options.state, port: options.port === undefined ? 0 : Number(options.port) }
}

/** The RunManager, or why it did not load. Loaded lazily: the engine may be absent. */
async function loadRuns(spec, projects) {
  try {
    const { RunManager } = await import('./runs/index.js')
    return { runs: new RunManager({ spec, scenarios: join(APP, 'scenarios'), beforeRemove: (name) => projects.forget(name) }), error: null }
  } catch (error) {
    log(`[host] the demo engine did not load: ${error?.code === 'ERR_MODULE_NOT_FOUND' ? error.message : (error?.stack ?? error)}`)
    return { runs: null, error: error?.message ?? String(error) }
  }
}

/** True when host.json names another process that is still alive. */
function liveOwner(file) {
  try {
    const { pid } = JSON.parse(readFileSync(file, 'utf8'))
    if (pid === process.pid) return false
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM: the process exists but this one may not signal it (another user, a sandbox)
    return error?.code === 'EPERM'
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const spec = args.state ? resolveSpec(args.state) : resolveSpec()
  const runtime = await openRuntime(spec)
  const engine = { runs: null, error: 'loading' }
  const projects = new Projects({ spec, runs: () => engine.runs, log })
  const storage = new Storage({ spec, projects, log })
  // a PostgreSQL Store's projects are read with their connection's URL, which only storage.js holds
  projects.postgresql = (store) => storage.urlForStore(store)
  // and so are runs' clients and agents' bash calls (config.js notePostgresql)
  spec.postgresqlUrl = (store) => storage.urlForStore(store)
  // the project list shows each project's Store sync state and copy providers from the Storage view
  projects.storeJoin = () => storage.projectJoin()
  // a session's project is a project key: its name, or `store/name` in a shared Store (layerfs#506)
  const agents = await AgentManager.create({ state: spec.state, projectEnvironment: (key) => projects.recordOf(key), projectWorkspaces: new AgentWorkspaces({ projects }) })
  const token = newToken()
  const server = createHostServer({ token, projects, storage, agents: () => agents, runs: () => engine.runs, runsError: () => engine.error, log })

  const endpoint = join(spec.state, 'host.json')
  let owned = false
  let closing = null
  const shutdown = (why) => {
    closing ??= (async () => {
      log(`[host] closing (${why})`)
      setTimeout(() => {
        log('[host] shutdown took too long; exiting')
        process.exit(1)
      }, CLOSE_MS).unref()
      await new Promise((resolve) => server.close(() => resolve()))
      storage.close()
      let clean = true
      await agents.close().catch((error) => {
        clean = false
        log(`[host] closing agents: ${error.message}`)
      })
      await Promise.resolve()
        .then(() => engine.runs?.close?.())
        .catch((error) => log(`[host] closing the engine: ${error?.message ?? error}`))
      await projects.close()
      await runtime.close().catch((error) => log(`[host] closing the runtime: ${error?.message ?? error}`))
      if (owned) rmSync(endpoint, { force: true })
      process.exit(clean ? 0 : 1)
    })()
    return closing
  }
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.stdin.on('end', () => void shutdown('stdin closed'))
  process.stdin.on('close', () => void shutdown('stdin closed'))
  process.stdin.resume()

  Object.assign(engine, await loadRuns(spec, projects))
  void projects.ensureWorker()
  const url = await listen(server, args.port)
  // a second host (another app window on the same state) leaves the first one's file alone
  if (!liveOwner(endpoint)) {
    writeFileSync(endpoint, JSON.stringify({ url, token, pid: process.pid }), { mode: 0o600 })
    owned = true
  }
  process.stdout.write(`${JSON.stringify({ ready: true, url, token })}\n`)
  log(`[host] listening on ${url} (state ${spec.state}, ${spec.worker ? 'worker' : 'in-process'} Store calls)`)
}

main().catch((error) => {
  log(`[host] did not start: ${error?.stack ?? error}`)
  process.stdout.write(`${JSON.stringify({ ready: false, error: error?.message ?? String(error) })}\n`)
  process.exit(1)
})
