// The Connect host's entry (README.md, "Process protocol"):
//   node host/main.js [--state <dir>] [--port <n>]
// It resolves Connect's state and its LayerFS 2.0 home, makes the one
// LayerFS client (layerfs.js), records the macOS native daemon on the home
// once, loads the demo engine (runs/) and serves HTTP on 127.0.0.1. There
// is no runtime to open and no worker to start: machines start on the first
// call that needs them. Once it listens it prints one line on stdout,
// {"ready":true,"url","token","mode"}, or {"ready":false,"error"} and exits 1. Logs
// go to stderr. It exits when stdin closes or on SIGTERM. While it serves,
// <state>/host.json (owner-only) holds the same url and token and its pid,
// so tools on this machine can drive the running app's host
// (tools/connect-run.mjs); it is removed at exit. LAYERFS_CONNECT_MODE=sim
// runs it on the simulator (config.js, layerfs.js) in its own state folder;
// scenario runs and scenario chats need real LayerFS and are off there.
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dirname } from 'node:path'
import { APP, layerfsEnv, resolveSpec } from './config.js'
import { closeStores, recordNativeDaemon } from './layerfs.js'
import { AgentManager } from './agents/index.js'
import { Projects } from './projects.js'
import { AgentWorkspaces } from './agents/workspaces.js'
import { createHostServer, listen, newToken } from './server.js'
import { Machines } from './machines.js'
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
    return { runs: new RunManager({ spec, scenarios: join(APP, 'scenarios') }), error: null }
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
  // §5: the native machine's daemon, once per home (a value already recorded is kept)
  const daemon = await recordNativeDaemon(spec)
  if (!daemon.recorded && !daemon.kept && daemon.why !== 'not macOS' && spec.mode !== 'sim') log(`[host] the native daemon is not recorded: ${daemon.why}`)
  if (daemon.replaced) log(`[host] the recorded native daemon ${daemon.replaced} is not there; recorded ${spec.daemon}`)
  const engine = { runs: null, error: 'loading' }
  const projects = new Projects({ spec, runs: () => engine.runs, daemon, log })
  const storage = new Storage({ spec, projects, log })
  // the project list shows each project's Store state from the Storage view
  projects.storeJoin = () => storage.projectJoin()
  // a session's project is a project key, `<store>/<project>`
  // a scenario chat plays its script on the scenario engine's folder and scope (agents/scenarios.js)
  const scenarios = spec.mode === 'sim' ? null : await import('./agents/scenarios.js')
    .then(({ AgentScenarios }) => new AgentScenarios({ spec }).ready())
    .catch((error) => {
      log(`[host] scenario chats are off: ${error?.message ?? error}`)
      return null
    })
  // agents' shells get the home, the trace settings and the project key only (§8 step 8), and the native CLI on PATH
  const shellEnv = (key) => ({ ...layerfsEnv(spec), LAYERFS_CONNECT_PROJECT: key, ...(spec.cli ? { PATH: `${dirname(spec.cli)}:${process.env.PATH ?? ''}` } : {}) })
  const agents = await AgentManager.create({ state: spec.state, projectEnvironment: (key) => projects.recordOf(key), shellEnv, projectWorkspaces: new AgentWorkspaces({ projects }), scenarios })
  const token = newToken()
  // Compute's "Move to…" starts a job in Storage's table, so its progress shows there
  const machines = new Machines({ spec, place: (store, machine) => storage.place(store, machine) })
  // sim mode: the world's preset and its reset, which every page then reads again
  const sim = spec.mode === 'sim'
    ? await import('./sim/index.js').then((m) => ({
        info: () => m.info(spec.home),
        reset: (preset) => {
          const done = m.reset(spec.home, preset)
          storage.changed()
          return done
        },
      }))
    : null
  const server = createHostServer({ token, projects, storage, machines, sim, agents: () => agents, runs: () => engine.runs, runsError: () => engine.error, log })

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
      // the Stores this process holds open, so their leases go with it
      try {
        closeStores()
      } catch (error) {
        log(`[host] closing the Stores: ${error?.message ?? error}`)
      }
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

  Object.assign(engine, spec.mode === 'sim' ? { runs: null, error: 'Scenario runs need real LayerFS: switch Connect to Real to play them.' } : await loadRuns(spec, projects))
  const url = await listen(server, args.port)
  // a second host (another app window on the same state) leaves the first one's file alone
  if (!liveOwner(endpoint)) {
    writeFileSync(endpoint, JSON.stringify({ url, token, pid: process.pid }), { mode: 0o600 })
    owned = true
  }
  process.stdout.write(`${JSON.stringify({ ready: true, url, token, mode: spec.mode })}\n`)
  log(`[host] listening on ${url} (${spec.mode === 'sim' ? 'simulated LayerFS, ' : ''}state ${spec.state}, LayerFS home ${spec.home})`)
}

main().catch((error) => {
  log(`[host] did not start: ${error?.stack ?? error}`)
  process.stdout.write(`${JSON.stringify({ ready: false, error: error?.message ?? String(error) })}\n`)
  process.exit(1)
})
