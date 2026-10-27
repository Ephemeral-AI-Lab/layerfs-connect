// Headless: runs one demo through the engine on the real LayerFS and prints
// one line per finished step, then the final checks. Exit 0 only when the
// run passed (for a scenario of several sessions: every session's run).
//   node --import ./host/resolve-layerfs.js host/run-demo.js <demo> [--state <dir>] [--scenarios <dir>]
import { resolveSpec } from './config.js'
import { RunManager } from './runs/index.js'

const argv = process.argv.slice(2)
const option = (name) => {
  const at = argv.indexOf(name)
  if (at < 0) return undefined
  const [, value] = argv.splice(at, 2)
  return value
}
const state = option('--state')
const scenarios = option('--scenarios')
const [id] = argv
if (!id) {
  console.error('usage: run-demo.js <demo> [--state <dir>] [--scenarios <dir>]')
  process.exit(2)
}

const spec = resolveSpec(state)
const runs = new RunManager({ spec, ...(scenarios ? { scenarios } : {}) })
const demo = runs.demo(id)
if (!demo) {
  const errors = runs.loadErrors()
  console.error(errors[id] ? `${id} does not load: ${errors[id]}` : `no demo named ${id}; demos: ${runs.demos().map((d) => d.id).join(', ')}`)
  process.exit(2)
}

let runId = null
let ids = new Set()
const pending = []
runs.on('event', (event) => {
  if (!runId) return pending.push(event)
  show(event)
})
const show = (event) => {
  if (event.type === 'step' && ids.has(event.run) && event.step.state !== 'running') {
    const s = event.step
    const view = demo.script[s.agent]?.[s.index]
    const ms = s.ended && s.started ? s.ended - s.started : 0
    const failed = s.checks?.find((c) => !c.ok)
    console.log(`${s.agent.padEnd(10)} ${String(s.index).padStart(4)}  ${(view?.kind ?? '?').padEnd(9)} ${s.state.padEnd(7)} ${String(ms).padStart(6)} ms  ${view?.description ?? view?.tool ?? ''}${failed ? `  ✗ ${failed.name}: ${failed.detail}` : ''}`)
  }
  if (event.type === 'run' && ids.has(event.run.id) && event.run.state === 'running' && !shown.has(event.run.id)) {
    shown.add(event.run.id)
    console.log(`project ${event.run.project} ready; ${event.run.session ? `session ${event.run.session} ` : ''}playing ${event.run.of} steps`)
  }
}
const shown = new Set()

const started = await runs.start(id)
runId = started.id
const launch = runs.launchOf(runId).map((r) => r.id)
ids = new Set(launch)
for (const e of pending.splice(0)) show(e)
for (const rid of launch) console.log(`run ${rid}: demo ${id}, project ${started.project}`)
process.on('SIGINT', () => runs.stop(runId))
process.on('SIGTERM', () => runs.stop(runId))

await Promise.all(launch.map((rid) => runs.live.get(rid).finished))
const details = launch.map((rid) => runs.run(rid))
for (const detail of details) {
  const who = detail.session ? `${detail.session}: ` : ''
  for (const c of detail.checks) console.log(`${who}check ${c.name}: ${c.ok ? 'ok' : 'FAILED'} ${c.detail}`)
  console.log(`${who}${detail.state}${detail.error ? `: ${detail.error}` : ''} (${detail.done}/${detail.of} steps, ${((detail.ended - detail.started) / 1000).toFixed(1)} s)`)
}
await runs.close()
if (spec.runtime) await (await spec.runtime).close()
process.exit(details.every((d) => d.state === 'passed') ? 0 : 1)
