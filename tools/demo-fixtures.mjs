#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { children } from '../host/cli/spawn.js'
import { stringify } from '../host/cli/json.js'
import { CliDriver, DesktopDriver } from './demo/drivers.mjs'
import { DemoRunner } from './demo/runner.mjs'
import { prepareBuild, buildPreset } from './demo/build.mjs'
import { assertHostIdle } from '../host/demo-presets/admission.js'
import { presets, presetOf } from './demo/presets.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const HELP = `Real CLI-backed LayerFS demo fixtures

  node tools/demo-fixtures.mjs presets
  node tools/demo-fixtures.mjs plan|build|setup|status|verify|reset|teardown|preview [options]

Options:
  --preset NAME      studio (the single project-library preset)
  --state PATH       Private demo state; default ~/.layerfs-connect-demo/<preset>
  --via cli|desktop  CLI adapter (default), or running desktop host operations
  --cli PATH         Absolute pinned LayerFS CLI (or LAYERFS_CONNECT_CLI)
  --daemon PATH      Matching native daemon (or LAYERFS_CONNECT_DAEMON)
  --execution-mode filesystem|mixed  Choose direct writes or mixed workspace commits
  --no-sandboxes     Disable legacy sample sandboxes; Mixed mode manages its own pool
  --json             Print the result as JSON
  --help             Show this help

build resets the whole selected environment, verifies cleanup, then builds the preset.
setup is additive; reset clears previous CLI Activity, recreates owned stores/projects
and keeps VMs warm. Reset is captured as a fresh action.
teardown also removes owned VMs. Neither command deletes the home or logs.
preview starts the actual renderer on fixed port 1025; it never kills another server.
--via desktop uses existing host routes for management and CLI for history/reads.
`

export function parseArgs(argv, env = process.env) {
  const result = { command: argv[0] ?? 'help', preset: 'studio', via: 'cli', sandboxes: false, executionMode: 'filesystem' }
  for (let i = 1; i < argv.length; i++) {
    const [key, inline] = argv[i].split(/=(.*)/s, 2)
    if (key === '--no-sandboxes') { result.sandboxes = false; continue }
    if (key === '--json') { result.json = true; continue }
    if (key === '--help') { result.command = 'help'; continue }
    if (!['--preset', '--state', '--via', '--cli', '--daemon', '--execution-mode'].includes(key)) throw new Error(`Unknown option ${key}`)
    const value = inline ?? argv[++i]
    if (!value || value.startsWith('--')) throw new Error(`${key} needs a value`)
    result[key === '--execution-mode' ? 'executionMode' : key.slice(2)] = value
  }
  if (result.command === '--help' || result.command === '-h') result.command = 'help'
  if (!['help', 'presets', 'plan', 'build', 'setup', 'status', 'verify', 'reset', 'teardown', 'preview'].includes(result.command)) throw new Error(`Unknown command ${result.command}. Use --help.`)
  if (!['cli', 'desktop'].includes(result.via)) throw new Error('--via must be cli or desktop')
  if (!['filesystem', 'mixed'].includes(result.executionMode)) throw new Error('--execution-mode must be filesystem or mixed')
  presetOf(result.preset)
  result.state = resolve(result.state || env.LAYERFS_DEMO_STATE || join(homedir(), '.layerfs-connect-demo', result.preset))
  return result
}

function runtime(options) {
  const local = {}
  // Only explicitly configured binary paths, never the ordinary preview's state.
  try {
    for (const line of readFileSync(join(ROOT, 'desktop', '.env.local'), 'utf8').split('\n')) {
      const match = /^(LAYERFS_CONNECT_CLI|LAYERFS_CONNECT_DAEMON)=(.*)$/.exec(line.trim())
      if (match) local[match[1]] = match[2].replace(/^['"]|['"]$/g, '')
    }
  } catch (error) { if (error.code !== 'ENOENT') throw error }
  const cli = options.cli || process.env.LAYERFS_CONNECT_CLI || local.LAYERFS_CONNECT_CLI
  let daemon = options.daemon || process.env.LAYERFS_CONNECT_DAEMON || local.LAYERFS_CONNECT_DAEMON
  if (!daemon && cli && existsSync(join(dirname(cli), 'layerfs-daemon'))) daemon = join(dirname(cli), 'layerfs-daemon')
  if (cli && !isAbsolute(cli)) throw new Error('The LayerFS CLI must be an explicitly configured absolute path.')
  if (daemon && (!isAbsolute(daemon) || !existsSync(daemon))) throw new Error('The configured LayerFS daemon must be an existing absolute path.')
  return { state: options.state, home: join(options.state, 'home-2'), cli, daemon }
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv)
  if (options.command === 'help') { console.log(HELP); return }
  if (options.command === 'presets') {
    console.log(options.json ? stringify(presets) : Object.entries(presets).map(([name, value]) => `${name.padEnd(9)} ${value.description}`).join('\n'))
    return
  }
  const spec = runtime(options)
  const report = options.json ? line => process.stderr.write(`${line}\n`) : console.log
  const driver = new (options.via === 'desktop' ? DesktopDriver : CliDriver)(spec, report)
  const runner = new DemoRunner({ ...options, driver, report })
  if (options.command === 'plan') {
    console.log(stringify({ ...runner.plan(), via: options.via, cli: spec.cli ?? null, daemon: spec.daemon ?? null, note: 'Plan only. No CLI calls or resource creation have occurred.' }))
    return
  }
  if (!spec.cli) throw new Error('Configure an absolute LAYERFS_CONNECT_CLI, --cli, or desktop/.env.local before executing a preset.')
  if (options.command === 'preview' && options.via !== 'cli') throw new Error('preview starts the host; use --via desktop on setup/reset after it is running.')
  let result
  if (options.command === 'build') {
    if (options.via !== 'cli') throw new Error('build requires --via cli so reset and setup use the same direct CLI workflow.')
    const progress = value => report(`${value.stage}: ${value.label}${value.total === null ? '' : ` (${value.completed}/${value.total})`}`)
    const plan = await prepareBuild({ spec, preset: options.preset, driver, sandboxes: options.sandboxes, executionMode: options.executionMode, report, progress })
    result = await buildPreset({ spec, preset: options.preset, driver, sandboxes: options.sandboxes, executionMode: options.executionMode, expectedPlan: plan.signature, assertIdle: () => assertHostIdle(spec.state), report, progress })
  } else result = await runner.run(options.command)
  if (options.command === 'preview') {
    report(`Preview state: ${options.state}\nOpen http://127.0.0.1:1025/#/machines and CLI Activity.`)
    const child = spawn('pnpm', ['--dir', 'desktop', 'web'], { cwd: ROOT, stdio: 'inherit', env: { ...process.env, LFS_STATE: options.state, LAYERFS_CONNECT_STATE: options.state, LAYERFS_CONNECT_CLI: spec.cli, ...(spec.daemon ? { LAYERFS_CONNECT_DAEMON: spec.daemon } : {}) } })
    const stop = () => child.kill('SIGTERM')
    process.once('SIGINT', stop); process.once('SIGTERM', stop)
    await new Promise((resolveExit, reject) => { child.once('error', reject); child.once('exit', code => { process.exitCode = code ?? 1; resolveExit() }) })
    process.off('SIGINT', stop); process.off('SIGTERM', stop)
    return
  }
  if (options.json) console.log(stringify(result))
  else {
    report(`\n${options.command} completed: ${options.preset}\nState: ${result.state}\nHome: ${result.home}\nCLI Activity action: ${result.actionId}\n${result.activityUrl}\n(The preview must use this same state directory.)`)
    if (options.command === 'status') report(stringify({ resources: result.resources, ownership: result.ownership, pending: result.pending, activityCaptured: result.activityCaptured }))
  }
  return result
}

if (process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url) {
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
    process.exitCode = 130
    for (const { child } of children.values()) child.kill('SIGTERM')
  })
  main().catch(error => {
    console.error(`${error.code ? `${error.code}: ` : ''}${error.message}\nNo mutation was automatically retried. Run status with the same --preset and --state; inspect incomplete operations before continuing.`)
    process.exitCode ||= 1
  })
}
