// Live sessions (runs/live-run.js, pi-agent.js) through the RunManager, on
// pi's offline faux model: turns, the reply step, a subagent, Stop, a second
// host carrying the conversation on, and the refusals. No network, no
// LayerFS: the project lookup is stood in for, and bash commands write the
// trace lines the SDK would.
//   node --import ./host/resolve-layerfs.js --test host/test/live-sessions.test.js
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { setTimeout as pause } from 'node:timers/promises'
import { RunManager } from '../runs/index.js'
import { LiveRun } from '../runs/live-run.js'

const root = mkdtempSync(join(tmpdir(), 'lfc-live-test-'))
const spec = { state: root, home: join(root, 'home'), runs: join(root, 'runs'), image: 'sha256:' + '0'.repeat(64), bundle: null, daemon: '/x/layerfs-daemon', docker: '/var/run/docker.sock', prefix: 'lfc-test-', worker: false, think: false }
mkdirSync(spec.runs, { recursive: true })
// no LayerFS here: every project asked for is there and Inited
LiveRun.prototype.projectRecord = async function () {
  if (this.project === 'nowhere') throw Object.assign(new Error('no initialized LayerFS project named nowhere'), { code: 'NoSuchProject', status: 404 })
  return { name: this.project, volume: null, image: null, initialized: true }
}

const trace = (method, kind) =>
  `printf '%s\\n' "{\\"layerfs_trace\\":1,\\"id\\":\\"t$RANDOM\\",\\"step\\":\\"$LAYERFS_TRACE_STEP\\",\\"method\\":\\"${method}\\",\\"start\\":\\"2026-10-28T00:00:00Z\\",\\"ms\\":1,\\"ok\\":true,\\"kind\\":\\"${kind}\\"}" >> "$LAYERFS_TRACE"`

let faux, say, call, text, models
const contexts = []
before(async () => {
  const pi = await import('@earendil-works/pi-ai')
  ;({ fauxAssistantMessage: say, fauxToolCall: call, fauxText: text } = pi)
  faux = pi.fauxProvider()
  const { ModelRuntime } = await import('@earendil-works/pi-coding-agent')
  const rt = await ModelRuntime.create({ authPath: join(root, 'auth.json'), modelsPath: join(root, 'models.json') })
  rt.registerNativeProvider(faux.provider)
  models = { agentModel: async () => ({ model: faux.getModel(), modelRuntime: rt, thinkingLevel: 'off' }) }
})
after(() => rmSync(root, { recursive: true, force: true }))

/** A faux response that also records what the model was sent. */
const seen = (message) => (context) => {
  contexts.push(context)
  return message
}
const bash = (description, command, before) => say([...(before ? [text(before)] : []), call('bash', { description, command })], { stopReason: 'toolUse' })

async function until(manager, id, ok, what) {
  for (let i = 0; i < 400; i++) {
    const run = manager.run(id)
    if (ok(run)) return run
    await pause(10)
  }
  throw new Error(`session ${id} never ${what}: ${JSON.stringify(manager.run(id)?.state)}`)
}
const idle = (manager, id) => until(manager, id, (r) => r.state === 'idle', 'went idle')

let manager
let first

test('a turn: bash steps with their LayerFS calls, a subagent, then the reply as a step', async () => {
  manager = new RunManager({ spec, scenarios: join(root, 'scenarios'), models })
  const events = []
  manager.on('event', (e) => events.push(e))
  faux.setResponses([
    bash('Look at main', `${trace('fs.list', 'ok')}\necho listed`, 'Looking first.'),
    say([call('subagent', { name: 'Fix Docs!', task: 'Fix the docs on a docs Branch.' })], { stopReason: 'toolUse' }),
    // the child's turn
    bash('Fork docs', `${trace('branch.fork', 'Forked')}\necho forked`),
    say('Forked docs and fixed the README.'),
    // root again
    seen(say('Looked at main; fix-docs fixed the README on docs.')),
  ])
  const started = await manager.startLive({ project: 'tour', text: 'Look around and fix the docs' })
  assert.equal(started.kind, 'live')
  assert.equal(started.demo, null)
  assert.equal(started.title, 'Look around and fix the docs')
  assert.equal(started.model, `${faux.getModel().provider}/${faux.getModel().id}`)
  first = started.id
  const run = await idle(manager, first)
  assert.equal(run.error, null)
  const rootSteps = run.steps.filter((s) => s.agent === 'root')
  assert.deepEqual(rootSteps.map((s) => s.view.tool), ['bash', 'subagent', 'reply'])
  assert.equal(rootSteps[0].view.say, 'Looking first.')
  assert.deepEqual(rootSteps[0].calls.map((c) => c.method), ['fs.list'])
  assert.equal(rootSteps[0].stdout.trim(), 'listed')
  // the subagent's chip names the child; its result is the child's reply
  assert.equal(rootSteps[1].view.segments[0].detail, 'fix-docs')
  assert.equal(rootSteps[1].output, 'Forked docs and fixed the README.')
  assert.equal(rootSteps[2].output, 'Looked at main; fix-docs fixed the README on docs.')
  const child = run.steps.filter((s) => s.agent === 'fix-docs')
  assert.deepEqual(child.map((s) => s.view.tool), ['bash', 'reply'])
  assert.deepEqual(child[0].calls.map((c) => c.method), ['branch.fork'])
  assert.deepEqual(
    run.agents.map((a) => [a.name, a.parent, a.state]),
    [
      ['root', null, 'idle'],
      ['fix-docs', 'root', 'done'],
    ],
  )
  assert.deepEqual(
    run.messages.map((m) => [m.from, m.to]),
    [
      ['user', 'root'],
      ['root', 'fix-docs'],
      ['fix-docs', 'root'],
    ],
  )
  // the model saw the child's reply as the subagent tool's answer
  assert.ok(JSON.stringify(contexts.at(-1).messages).includes('fix-docs replied'))
  assert.ok(events.some((e) => e.type === 'run' && e.run.state === 'idle'))
  // live sessions do not count against the replays playing
  assert.equal(manager.playing(), 0)
})

test('the next message is the next turn, with the conversation so far', async () => {
  faux.setResponses([seen(say('It was the README.'))])
  await manager.say(first, { text: 'What did you fix?' })
  const run = await idle(manager, first)
  assert.equal(run.steps.at(-1).output, 'It was the README.')
  assert.ok(JSON.stringify(contexts.at(-1).messages).includes('Look around and fix the docs'))
  await assert.rejects(manager.say(first, { text: '  ' }), { code: 'InvalidInput' })
})

test('Stop ends the turn, not the session; a busy session refuses a message', async () => {
  faux.setResponses([bash('Wait a long time', 'sleep 30')])
  await manager.say(first, { text: 'Wait for a while' })
  await until(manager, first, (r) => r.steps.some((s) => s.state === 'running' && s.view?.tool === 'bash'), 'started its command')
  await assert.rejects(manager.say(first, { text: 'hurry' }), { code: 'Busy' })
  const stoppedAt = Date.now()
  const after = await manager.stop(first)
  assert.equal(after.state, 'idle')
  assert.ok(Date.now() - stoppedAt < 5000)
  const run = manager.run(first)
  assert.equal(run.error, null)
  assert.equal(run.steps.at(-1).state, 'stopped')
  assert.equal(run.agents.find((a) => a.name === 'root').state, 'idle')
})

test('another host carries the conversation on; step labels keep counting', async () => {
  await manager.close()
  const before = manager.run(first)
  const again = new RunManager({ spec, scenarios: join(root, 'scenarios'), models })
  assert.equal(again.run(first).state, 'idle')
  faux.setResponses([seen(say('Still here.'))])
  await again.say(first, { text: 'Are you there?' })
  const run = await idle(again, first)
  const labels = run.steps.map((s) => `${s.agent}:${s.index}`)
  assert.equal(new Set(labels).size, labels.length)
  assert.equal(run.steps.length, before.steps.length + 1)
  assert.ok(JSON.stringify(contexts.at(-1).messages).includes('What did you fix?'))
  // the earlier subagent is listed still
  assert.ok(run.agents.some((a) => a.name === 'fix-docs'))
  await again.close()
})

test('a scenario plays beside a working agent: only a missing project, a bad name or an unknown scenario is refused', async () => {
  const folder = join(root, 'scenarios', 'hello')
  mkdirSync(folder, { recursive: true })
  writeFileSync(join(folder, 'scenario.json'), JSON.stringify({ type: 'layerfs-scenario', version: 3, title: 'Hello', tags: ['cli', 'publish'], fixture: '.', agents: { root: [{ reply: 'hi' }] } }))
  const m = new RunManager({ spec, scenarios: join(root, 'scenarios'), models })
  faux.setResponses([bash('Wait a long time', 'sleep 30')])
  const { id } = await m.startLive({ project: 'shop', text: 'Wait' })
  await until(m, id, (r) => r.steps.some((s) => s.state === 'running'), 'started its command')
  // the agent's work is no reason to refuse (the scenario gets a folder of its own); only the project's absence is
  await assert.rejects(m.start('hello', { project: 'shop' }), { code: 'NotFound', message: /no LayerFS project named shop/ })
  await assert.rejects(m.start('hello'), { code: 'InvalidInput' })
  await assert.rejects(m.start('hello', { project: 'Not A Name' }), { code: 'InvalidInput' })
  await assert.rejects(m.start('nope', { project: 'shop' }), { code: 'NotFound' })
  await assert.rejects(m.startAll({ project: 'shop' }), { code: 'NotFound' })
  await m.stop(id)
  await m.close()
})

test('refusals: a missing project, a bad name, no such session, a replay is not a session', async () => {
  const m = new RunManager({ spec, scenarios: join(root, 'scenarios'), models })
  await assert.rejects(m.startLive({ project: 'nowhere' }), { code: 'NoSuchProject' })
  await assert.rejects(m.startLive({ project: 'Bad Name' }), { code: 'InvalidInput' })
  await assert.rejects(m.say('nope', { text: 'hi' }), { code: 'NotFound' })
  await assert.rejects(new RunManager({ spec, scenarios: join(root, 'scenarios') }).startLive({ project: 'tour' }), { code: 'NotConfigured' })
  await m.close()
})
