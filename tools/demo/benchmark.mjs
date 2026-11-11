/** Private, bounded diagnostic benchmark. Never adopts a preview or Studio home. */
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, createReadStream, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { CliDriver } from './drivers.mjs'
import { DemoRunner } from './runner.mjs'
import { projectHistoryPlan } from './recipe.mjs'

const mutation = argv => ['file', 'branch'].includes(argv?.[0]) && ['write', 'fork', 'merge', 'publish'].includes(argv?.[1])
const serializeError = error => ({ code: error.code ?? 'Failed', message: error.message, stack: error.stack })
const save = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 })

/** Uses recorded child lifetimes, never Promise overlap or queued timestamps. */
export function summarizeInvocations(invocations) {
  const calls = [...invocations].filter(call => Number.isFinite(call.started) && Number.isFinite(call.ended))
  const edges = calls.filter(call => call.ended > call.started).flatMap(call => [[call.started, 1], [call.ended, -1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1])
  let active = 0, peak = 0, previous = edges[0]?.[0]
  const concurrencyMs = {}
  for (const [at, delta] of edges) {
    concurrencyMs[active] = (concurrencyMs[active] ?? 0) + at - previous
    active += delta; peak = Math.max(peak, active); previous = at
  }
  const families = {}
  for (const call of calls) (families[call.family] ??= []).push(call.ended - call.started)
  return {
    count: calls.length, peak, concurrencyMs,
    processMs: calls.reduce((sum, call) => sum + call.ended - call.started, 0),
    wallMs: edges.length ? edges.at(-1)[0] - edges[0][0] : 0,
    families: Object.fromEntries(Object.entries(families).map(([family, times]) => {
      times.sort((a, b) => a - b)
      return [family, { count: times.length, totalMs: times.reduce((a, b) => a + b, 0), p50Ms: times[Math.floor((times.length - 1) * .5)], p95Ms: times[Math.floor((times.length - 1) * .95)] }]
    })),
  }
}

export async function recordedHistory(state, actionId) {
  const calls = new Map()
  for (const file of readdirSync(join(state, 'logs', 'cli')).filter(name => name.endsWith('.ndjson')).sort()) {
    const lines = createInterface({ input: createReadStream(join(state, 'logs', 'cli', file)), crlfDelay: Infinity })
    for await (const line of lines) {
      if (!line) continue
      const event = JSON.parse(line)
      if (event.action?.id !== actionId || !event.invocationId) continue
      if (!calls.has(event.invocationId)) calls.set(event.invocationId, {})
      const call = calls.get(event.invocationId)
      if (event.type === 'cli.queued') Object.assign(call, { mutation: mutation(event.data.argv), family: event.data.argv.slice(0, 2).join('.'), project: event.data.argv[2] })
      if (event.type === 'cli.started') call.started = event.data.started
      if (event.type === 'cli.finished') call.ended = event.data.ended
    }
  }
  const history = [...calls.values()].filter(call => call.mutation)
  return { ...summarizeInvocations(history), queued: history.length, incomplete: history.filter(call => !Number.isFinite(call.started) || !Number.isFinite(call.ended)).length }
}

export async function benchmarkSample({ cli, daemon, scope = 'studio', schedule = 'parallel', concurrency = 8, storeConcurrency = 3, projectConcurrency = 3, cycles = 1, historyBudgetMs = 120000, evidence }) {
  if (!isAbsolute(cli ?? '') || !existsSync(cli)) throw new Error('Benchmark requires an existing absolute pinned CLI path.')
  if (daemon && (!isAbsolute(daemon) || !existsSync(daemon))) throw new Error('Benchmark daemon must be an existing absolute pinned path.')
  if (!['native', 'native-pair', 'studio'].includes(scope)) throw new Error('scope must be native, native-pair or studio')
  if (!['serial', 'parallel'].includes(schedule)) throw new Error('schedule must be serial or parallel')
  for (const [name, value] of Object.entries({ concurrency, storeConcurrency, projectConcurrency, cycles, historyBudgetMs })) if (!Number.isSafeInteger(value) || value < 1) throw new Error(`Invalid ${name}`)
  if (historyBudgetMs > 120000) throw new Error('Pilot history budget cannot exceed 120000 ms; a timeout is a failed diagnostic.')
  if (!evidence) throw new Error('An explicit evidence file is required.')
  // Reserve before creating even a private state: an arm receipt is never reused.
  try { writeFileSync(evidence, '{}\n', { mode: 0o600, flag: 'wx' }) }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error(`Benchmark evidence already exists: ${evidence}. Choose a new named arm; the existing receipt was preserved.`)
    throw error
  }
  const sha256 = file => createHash('sha256').update(readFileSync(file)).digest('hex')
  const sourceFiles = ['benchmark.mjs', 'runner.mjs', 'recipe.mjs', 'dense-recipe.mjs', 'project-verification.mjs', 'history-scheduler.mjs', 'step-journal.mjs', 'drivers.mjs', '../../host/cli/concurrency.js', '../../host/cli/spawn.js', '../../host/activity/recorder.js', '../../host/activity/store.js', '../../host/activity/index.js']
  const sourceIdentity = () => Object.fromEntries(sourceFiles.map(file => [file, existsSync(new URL(file, import.meta.url)) ? sha256(new URL(file, import.meta.url)) : null]))
  const source = sourceIdentity()
  const state = mkdtempSync(join(tmpdir(), 'connect-history-benchmark-'))
  const spec = { cli, daemon, state, home: join(state, 'home-2') }
  const result = { version: 1, fixtureProfile: 'Disposable: fresh private LayerFS home, authored fixture data only; no user Studio resources adopted.', diagnostic: true, numericEligibility: 'INCOMPLETE: OS and worker cache states are uncontrolled. Timing is exploratory; functional verification and cleanup have separate verdicts.', cache: 'Uncontrolled warm host caches; fresh private LayerFS home; no cold-cache or statistical performance claim.', source, binarySha256: { cli: sha256(cli), ...(daemon ? { daemon: sha256(daemon) } : {}) }, linuxBundle: process.env.LAYERFS_BUNDLE, state, cli, daemon, scope, schedule, concurrency, storeConcurrency, projectConcurrency, cycles, historyBudgetMs, started: Date.now(), ok: false }
  const driver = new CliDriver(spec)
  const invoke = driver.invoke.bind(driver)
  let historyStarted, historyEnded, phase = 'preparation', lastLog = 0
  driver.invoke = (argv, options) => {
    if (phase === 'history' && Date.now() - historyStarted >= historyBudgetMs) throw Object.assign(new Error(`History exceeded its declared ${historyBudgetMs} ms budget; no new command admitted. In-flight calls drain before cleanup.`), { code: 'BenchmarkTimeout' })
    return invoke(argv, options)
  }
  const runner = new DemoRunner({ state, preset: 'studio', sandboxes: false, driver, historySchedule: schedule, historyConcurrency: concurrency, historyStoreConcurrency: storeConcurrency, historyProjectConcurrency: projectConcurrency, historyCycles: cycles, report: () => {}, progress: progress => {
    if (progress.tasks?.some(task => task.started) && !historyStarted) { historyStarted = Math.min(...progress.tasks.filter(task => task.started).map(task => task.started)); phase = 'history' }
    if (progress.stage === 'verifying' && historyStarted && !historyEnded) { historyEnded = Date.now(); phase = 'verification' }
    result.progress = progress
    if (Date.now() - lastLog > 10000 || progress.completed === progress.total) { lastLog = Date.now(); save(evidence, result); process.stdout.write(JSON.stringify({ state, schedule, stage: progress.stage, completed: progress.completed, total: progress.total }) + '\n') }
  } })
  if (scope !== 'studio') {
    runner.preset.machines = ['native']
    runner.preset.stores = [{ ...runner.preset.stores[0], projects: scope === 'native' ? ['design'] : ['website', 'design'] }]
  }
  result.expected = runner.preset.stores.flatMap(store => store.projects.map(name => ({ project: `${store.name}/${name}`, machine: store.machine, ...Object.fromEntries(['commands', 'commits', 'layers'].map(key => [key, projectHistoryPlan(name, { density: 'dense', cycles })[key]])) })))
  save(evidence, result)
  try {
    result.setup = await runner.run('setup')
    await runner.activity.flush()
    result.logging = runner.activity.store.diagnostics?.()
    result.verifiedAt = Date.now()
    result.projects = structuredClone(runner.manifest.projects)
    result.capture = structuredClone(runner.manifest.activityCapture)
    result.tasks = structuredClone(runner.historyTasks)
    result.historyMs = Math.max(...result.tasks.map(task => task.ended)) - Math.min(...result.tasks.map(task => task.started))
    result.preparationMs = historyStarted - result.started
    result.verificationMs = result.verifiedAt - Math.max(...result.tasks.map(task => task.ended))
    if (result.historyMs > historyBudgetMs) throw Object.assign(new Error('Completed history exceeded its predeclared wall budget.'), { code: 'BenchmarkTimeout' })
    result.processes = await recordedHistory(state, result.setup.actionId)
    const expectedCommands = result.expected.reduce((sum, project) => sum + project.commands, 0)
    if (result.processes.queued !== expectedCommands || result.processes.count !== expectedCommands || result.processes.incomplete) throw new Error(`History process receipt mismatch: expected ${expectedCommands}, got ${JSON.stringify(result.processes)}`)
    result.functionalVerified = true
    result.ok = true
  } catch (error) { result.error = serializeError(error) }
  finally {
    phase = 'cleanup'; save(evidence, result)
    try { result.cleanup = await runner.run('teardown') } catch (error) { result.cleanupError = serializeError(error); result.ok = false }
    if (!result.cleanup?.cleanup?.verified) result.ok = false
    try {
      result.sourceAfter = sourceIdentity()
      result.sourceStable = JSON.stringify(result.source) === JSON.stringify(result.sourceAfter)
      if (!result.sourceStable) {
        result.ok = false
        result.sourceChanged = sourceFiles.filter(file => result.source[file] !== result.sourceAfter[file])
        result.numericEligibility = 'INCOMPLETE: source identity changed during the diagnostic. Keep this receipt; do not compare its timing as a stable treatment.'
      }
    } catch (error) { result.sourceIdentityError = serializeError(error); result.sourceStable = false; result.ok = false }
    result.ended = Date.now(); save(evidence, result)
  }
  return result
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argument = name => { const index = process.argv.indexOf(`--${name}`); return index < 0 ? undefined : process.argv[index + 1] }
  const number = (name, fallback) => argument(name) === undefined ? fallback : Number(argument(name))
  const result = await benchmarkSample({ cli: argument('cli') ?? process.env.LAYERFS_CONNECT_CLI, daemon: argument('daemon') ?? process.env.LAYERFS_CONNECT_DAEMON, scope: argument('scope') ?? 'studio', schedule: argument('schedule') ?? 'parallel', concurrency: number('concurrency', 8), storeConcurrency: number('store-concurrency', 3), projectConcurrency: number('project-concurrency', 3), cycles: number('cycles', 1), historyBudgetMs: number('history-budget-ms', 120000), evidence: argument('evidence') })
  process.stdout.write(JSON.stringify({ ok: result.ok, state: result.state, historyMs: result.historyMs, processes: result.processes, error: result.error, cleanupVerified: result.cleanup?.cleanup?.verified }) + '\n')
  if (!result.ok) process.exitCode = 1
}
