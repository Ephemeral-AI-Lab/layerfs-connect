// Spike: one live pi agent (pi-agent.js) on a demo's LayerFS project, no UI.
// The project is reset from the demo's fixture as a replay does, then root is
// a PiAgent with the demo's prompt (or --prompt) and only the bash tool. It
// prints each call as it ends (its LayerFS segments and traced calls), the
// model's text, usage, and what Sandboxes the agent left open.
//   node --import ./host/resolve-layerfs.js host/pi-spike.js [demo] [--prompt <text>] [--model <provider/id>] [--thinking <level>]
// Without --model it runs on the default model of Settings → Models; keys come from
// there (<state>/pi/auth.json) or the environment (ANTHROPIC_API_KEY, OPENAI_API_KEY, …);
// --model faux needs none: pi's offline test provider plays a short fixed tour.
// Records go to <state>/pi-spike/<runId>/ (run.json, traces/, pi/<session>.jsonl),
// not <state>/runs, so the app's session lists stay as they were. The demo's
// project is reset all the same.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compileScenario } from '../tools/lib/scenario.mjs'
import { missing, openRuntime, resolveSpec, withProjectEnv } from './config.js'
import { PiAgent } from './runs/pi-agent.js'
import { Run } from './runs/run.js'

const SCENARIOS = fileURLToPath(new URL('../scenarios/', import.meta.url))
/** The model when --model is not given: the first provider whose key is set. */
const DEFAULTS = [
  ['ANTHROPIC_API_KEY', 'anthropic/claude-sonnet-5-5'],
  ['OPENAI_API_KEY', 'openai/gpt-5.5'],
]

const argv = process.argv.slice(2)
const option = (name) => {
  const at = argv.indexOf(name)
  if (at < 0) return undefined
  const [, value] = argv.splice(at, 2)
  return value
}
const promptArg = option('--prompt')
// no --model: the default chosen in Settings → Models, else the first provider whose key is in the environment
const saved = (() => {
  try {
    return JSON.parse(readFileSync(join(resolveSpec().state, 'pi', 'connect.json'), 'utf8'))
  } catch {
    return {}
  }
})()
const modelArg = option('--model') ?? (saved.provider && saved.model ? `${saved.provider}/${saved.model}` : DEFAULTS.find(([key]) => process.env[key])?.[1])
const thinking = option('--thinking') ?? saved.thinking ?? 'medium'
const id = argv[0] ?? 'tour'
const die = (message) => {
  console.error(`pi-spike: ${message}`)
  process.exit(2)
}

if (!modelArg) die(`no model: set ${DEFAULTS.map(([k]) => k).join(' or ')}, or pass --model <provider/id>`)
const file = join(SCENARIOS, id, 'scenario.json')
if (!existsSync(file)) die(`no demo named ${id}`)
const raw = JSON.parse(readFileSync(file, 'utf8'))
const scenario = compileScenario(raw, { name: id, folder: join(SCENARIOS, id), where: file })
if (scenario.sessions) die(`${id} is a scenario of several sessions; pick one of one session`)
const prompt = promptArg ?? raw.prompt
if (!prompt) die(`${id} has no prompt; pass --prompt`)

const base = resolveSpec()
const gaps = missing(base)
if (gaps.length) die(`LayerFS is not configured: set ${gaps.join(' and ')}`)
const spec = { ...base, runs: join(base.state, 'pi-spike') }

// pi's own files (auth.json, models.json) live under Connect's state, never ~/.pi
const { ModelRuntime } = await import('@earendil-works/pi-coding-agent')
const piDir = join(base.state, 'pi')
const modelRuntime = await ModelRuntime.create({ authPath: join(piDir, 'auth.json'), modelsPath: join(piDir, 'models.json') })
if (modelArg === 'faux') await fauxModel(modelRuntime)
const [provider, ...rest] = modelArg === 'faux' ? ['faux', 'faux-1'] : modelArg.split('/')
const model = modelRuntime.getModel(provider, rest.join('/'))
if (!model) die(`no model ${modelArg}; ${provider} has: ${modelRuntime.getModels(provider).map((m) => m.id).join(' ') || 'nothing'}`)
const auth = provider === 'faux' ? { configured: true, source: 'none (offline)' } : modelRuntime.getProviderAuthStatus(provider)
if (!auth.configured) die(`no credentials for ${provider}`)

/**
 * --model faux: pi's offline test provider answers with fixed messages, so
 * pi's loop, the bash tool, tracing and the record run with no model account.
 * The calls are a short tour: read main, fork, write a page, build and commit
 * in a Workspace, publish.
 */
async function fauxModel(runtime) {
  const { fauxProvider, fauxAssistantMessage: say, fauxToolCall: call, fauxText: text } = await import('@earendil-works/pi-ai')
  const faux = fauxProvider()
  runtime.registerNativeProvider(faux.provider)
  const bash = (description, command, before) => say([...(before ? [text(before)] : []), call('bash', { description, command })], { stopReason: 'toolUse' })
  faux.setResponses([
    bash('List the project root on main', 'layerfs fs list main / --text', 'I will look at the project first.'),
    bash('Fork feature-home from main', 'layerfs branch fork feature-home'),
    bash('Add the about page on feature-home', `printf '%s\\n' 'export default function About() {' '  return <h1>About us</h1>' '}' | layerfs fs write feature-home /app/about/page.tsx -m 'Add the about page'`),
    bash(
      'Install, build and commit in a Workspace',
      [
        'set -e',
        'S=$(layerfs sandbox create | jq -r .sandbox)',
        'WS=$(layerfs workspace mount "$S" feature-home | jq -r .ws)',
        'layerfs workspace exec "$WS" \'sh install.sh && sh build.sh\' --stream',
        'layerfs workspace commit "$WS" -m "Build the site"',
        'layerfs workspace unmount "$WS"',
        'layerfs sandbox close "$S"',
      ].join('\n'),
      'Now the build, in a Sandbox.',
    ),
    bash('Publish feature-home to main', 'layerfs branch publish feature-home'),
    say('Forked feature-home, added /app/about/page.tsx, built it in a Workspace and committed, then published feature-home to main.'),
  ])
}

const started = Date.now()
const record = { id: `${id}-pi-${started.toString(36)}`, demo: id, project: id, state: 'starting', started, live: true, prompt, model: modelArg }
const ms = (s) => (s.ended && s.started ? s.ended - s.started : 0)
const short = (text, n = 110) => {
  const one = String(text ?? '').replace(/\s+/g, ' ').trim()
  return one.length > n ? `${one.slice(0, n - 1)}…` : one
}

const run = new Run({
  spec,
  demo: { id, folder: join(SCENARIOS, id), scenario: { ...scenario, agents: { root: [] }, parents: [], root: 'root' } },
  record,
  emit: (event) => show(event),
  loadSeed: async () => (scenario.seed ? import('./seed.js') : null),
  loadChecks: async () => null,
})
const root = new PiAgent(run, 'root', {
  prompt,
  model,
  modelRuntime,
  thinkingLevel: thinking,
  onEvent: (e) => {
    if (e.type === 'message_end' && e.message.role === 'assistant') {
      const text = e.message.content.filter((c) => c.type === 'text').map((c) => c.text).join('').trim()
      if (text) console.log(`  model: ${short(text, 300)}`)
      if (e.message.stopReason === 'error') console.log(`  model error: ${e.message.errorMessage}`)
    }
    if (e.type === 'tool_execution_start') console.log(`  → ${e.toolName}: ${short(e.args?.description || e.args?.command)}`)
    if (e.type === 'auto_retry_start') console.log(`  retrying the model request: ${short(e.errorMessage ?? '')}`)
    if (e.type === 'compaction_start') console.log(`  compacting the context (${e.reason})`)
  },
})
run.agents.set('root', root)

function show(event) {
  if (event.type === 'run' && event.run.phase) console.log(`[${event.run.phase}]`)
  if (event.type === 'step' && event.step.state !== 'running') {
    const s = event.step
    const v = s.view ?? {}
    const lf = (v.segments ?? []).filter((g) => g.kind !== 'local').map((g) => `${g.kind}/${g.form}`)
    const calls = s.calls.map((c) => `${c.method}${c.ok === false ? `✗${c.code ?? ''}` : ''}`)
    console.log(`  ${String(s.index).padStart(3)} ${s.state.padEnd(7)} exit ${String(s.exitCode).padEnd(4)} ${String(ms(s)).padStart(6)} ms  kind ${v.kind ?? '?'}  segments [${lf.join(' ')}]  traced [${calls.join(' ')}]`)
  }
}

console.log(`run ${record.id}: demo ${id}, project ${id}, model ${modelArg} (key from ${auth.source}${auth.label ? ` ${auth.label}` : ''}), thinking ${thinking}`)
console.log(`prompt: ${short(prompt, 300)}`)
const stop = () => {
  console.log('stopping…')
  run.stop()
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)

await run.play()

// what the agent left open, before the sweep closes it
let leftOpen = '?'
try {
  await openRuntime(spec)
  const { LayerFS } = await import('@layerfs/agent')
  const lf = await withProjectEnv(spec, { name: run.project, volume: run.volume, image: run.image }, () => LayerFS.open(run.project))
  try {
    const { items } = await lf.project.list_sandboxes(1000, 0)
    leftOpen = items.length ? items.map((s) => `Sandbox ${s.sandbox} (${s.workspaces ?? '?'} Workspaces)`).join(', ') : 'nothing'
  } finally {
    await lf.close()
  }
} catch (error) {
  leftOpen = `could not list: ${error.message}`
}
if (run.state === 'passed') await run.closeSandboxes().catch((e) => console.error(`closing Sandboxes: ${e.message}`))

const detail = run.detail()
const traced = detail.steps.reduce((n, s) => n + s.calls.length, 0)
const u = root.usage
console.log('')
console.log(`reply: ${detail.messages.at(-1)?.text ?? '(none)'}`)
console.log('')
console.log(`${detail.state}${detail.error ? `: ${detail.error}` : ''}`)
console.log(`${detail.steps.length} bash calls, ${traced} traced LayerFS calls, ${((detail.ended - detail.started) / 1000).toFixed(1)} s`)
console.log(`usage: ${u.turns} model turns, ${u.input} in / ${u.output} out / ${u.cacheRead} cache read, $${u.cost.toFixed(4)}`)
console.log(`left open by the agent: ${leftOpen}`)
console.log(`record: ${run.dir}`)
console.log(`pi session: ${root.sessionFile ?? '(none)'}`)
if (spec.runtime) await (await spec.runtime).close()
process.exit(detail.state === 'passed' ? 0 : 1)
