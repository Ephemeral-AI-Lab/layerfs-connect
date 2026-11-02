// The engine without LayerFS: the real Run, agents and tools on small
// scenarios whose bash steps are plain shell. A step that "calls LayerFS"
// appends the trace line the SDK would write to $LAYERFS_TRACE, labelled with
// $LAYERFS_TRACE_STEP, so the expect checks read real files. Init is skipped.
// Run: node --test host/test/runs.test.js
import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { compileScenario } from '../../tools/lib/scenario.mjs'
import { RunManager } from '../runs/index.js'
import { Launch, Run } from '../runs/run.js'

const root = mkdtempSync(join(tmpdir(), 'lfc-runs-test-'))
after(() => rmSync(root, { recursive: true, force: true }))
const spec = { state: root, home: join(root, 'home'), runs: join(root, 'runs'), image: 'sha256:' + '0'.repeat(64), bundle: null, daemon: '/x/layerfs-daemon', docker: '/var/run/docker.sock', prefix: 'lfc-test-', worker: false, think: false }
mkdirSync(spec.runs, { recursive: true })

/** A trace line for the current step, as the SDK writes it. */
const trace = (method, kind, ok = true) =>
  `printf '%s\\n' "{\\"layerfs_trace\\":1,\\"id\\":\\"t$RANDOM\\",\\"step\\":\\"$LAYERFS_TRACE_STEP\\",\\"method\\":\\"${method}\\",\\"start\\":\\"2026-10-27T00:00:00Z\\",\\"ms\\":1,\\"ok\\":${ok}${ok ? `,\\"kind\\":\\"${kind}\\"` : `,\\"code\\":\\"${kind}\\"`}}" >> "$LAYERFS_TRACE"`

let n = 0
/** Plays `agents` (scenario.json form) to the end: { run, events }. */
async function play(agents, { tags = ['cli', 'multi-agent'], stopAfter = null } = {}) {
  const id = `t${++n}`
  const folder = join(root, 'scenarios', id)
  mkdirSync(folder, { recursive: true })
  const raw = { type: 'layerfs-scenario', version: 3, title: id, tags, agents }
  const scenario = compileScenario(raw, { name: id, folder })
  const events = []
  const run = new Run({
    spec,
    demo: { id, folder, scenario },
    record: { id: `${id}-run`, demo: id, project: `${id}-1`, state: 'starting', started: Date.now() },
    emit: (e) => events.push(e),
    loadSeed: async () => null,
    loadChecks: async () => null,
  })
  run.init = async () => {}
  const playing = run.play()
  if (stopAfter !== null) setTimeout(() => run.stop(), stopAfter)
  await playing
  return { run, events, detail: run.detail() }
}

const bash = (command, extra = {}) => ({ bash: { description: extra.description ?? command.slice(0, 30), command, ...(extra.args ?? {}) }, ...extra.step })

test('only started agents are listed: a subagent never started stays out of the run and its events', async () => {
  const { detail, events } = await play({
    root: [bash('exit 1'), { subagent: { description: 'b', prompt: 'You are b.' } }, { reply: 'Waiting.', until: ['b'] }, bash('echo end')],
    b: [{ reply: 'b: ready.' }],
  })
  assert.equal(detail.state, 'failed')
  assert.deepEqual(detail.agents.map((a) => a.name), ['root'])
  assert.ok(!events.some((e) => e.type === 'agent' && e.agent.name === 'b'))
  // the scenario's total still counts b's steps
  assert.ok(detail.of > detail.agents[0].of)
})

test('a placeholder with no value fails the step', async () => {
  const { detail } = await play({ root: [bash('echo {{sandbox}}')] }, { tags: ['cli', 'sandbox'] })
  assert.equal(detail.state, 'failed')
  assert.match(detail.error, /has seen no value for \{\{sandbox\}\}/)
})

test('a run still playing at a restart reads as failed (interrupted)', () => {
  const dir = join(spec.runs, 'old-run')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'run.json'), JSON.stringify({ id: 'old-run', demo: 'tour', project: 'tour-9', state: 'running', started: 1, ended: null, error: null, done: 1, of: 3, phase: null, agents: [{ name: 'root', parent: null, state: 'running', done: 1, of: 3 }], steps: [{ agent: 'root', index: 1, state: 'running', started: 2, ended: null, calls: [], checks: [] }], messages: [], captured: {}, checks: [] }))
  const runs = new RunManager({ spec, scenarios: join(root, 'none') })
  const r = runs.run('old-run')
  assert.equal(r.state, 'failed')
  assert.match(r.error, /^interrupted/)
  assert.equal(r.steps[0].state, 'stopped')
  assert.equal(r.agents[0].state, 'stopped')
  assert.equal(runs.runs('tour')[0].id, 'old-run')
  assert.deepEqual(runs.demos(), [])
})

function historyFixture(records) {
  const state = mkdtempSync(join(root, 'history-'))
  const localSpec = { ...spec, state, home: join(state, 'home'), runs: join(state, 'runs') }
  const scenarios = join(state, 'scenarios')
  const folder = join(scenarios, 'tour')
  const raw = { type: 'layerfs-scenario', version: 3, title: 'Tour', tags: ['cli', 'publish'], agents: { root: [{ reply: 'Done.' }] } }
  mkdirSync(folder, { recursive: true })
  writeFileSync(join(folder, 'scenario.json'), JSON.stringify(raw))
  for (const record of records) {
    const dir = join(localSpec.runs, record.id)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'run.json'), JSON.stringify({ demo: 'tour', project: 'tour', state: 'passed', started: 1, ended: 2, agents: [], ...record }))
  }
  const manager = new RunManager({ spec: localSpec, scenarios, beforeRemove: () => assert.fail('deleting history must not remove a project') })
  const events = []
  manager.on('event', (event) => events.push(event))
  return { spec: localSpec, scenarios, folder, raw, manager, events }
}

test('removing saved history deletes only that run and stays removed after close and restart', async () => {
  const f = historyFixture([{ id: 'older', started: 1 }, { id: 'latest', started: 3 }, { id: 'other', demo: 'other', project: 'other' }])
  const project = join(f.spec.home, 'projects', 'tour')
  mkdirSync(project, { recursive: true })
  writeFileSync(join(project, 'sentinel'), 'keep the project, volume and workspace')
  const dir = join(f.spec.runs, 'latest')
  mkdirSync(join(dir, 'traces'), { recursive: true })
  writeFileSync(join(dir, 'traces', 'root.jsonl'), 'saved trace')
  f.manager.records.get('latest').dir = project // the saved path is never a deletion target
  assert.equal(f.manager.demo('tour').latest.id, 'latest')
  assert.deepEqual(await f.manager.remove('latest'), { id: 'latest' })
  assert.equal(existsSync(dir), false)
  assert.equal(f.manager.run('latest'), null)
  assert.equal(f.manager.records.has('latest'), false)
  assert.equal(f.manager.demo('tour').latest.id, 'older')
  assert.equal(f.manager.demo('tour').runs, 1)
  assert.deepEqual(f.events, [{ type: 'run-removed', id: 'latest', demo: 'tour' }])
  assert.equal(readFileSync(join(project, 'sentinel'), 'utf8'), 'keep the project, volume and workspace')
  assert.equal(existsSync(join(f.spec.runs, 'older', 'run.json')), true)
  assert.equal(existsSync(join(f.spec.runs, 'other', 'run.json')), true)
  await f.manager.close()
  const reopened = new RunManager({ spec: f.spec, scenarios: f.scenarios })
  assert.equal(reopened.run('latest'), null)
  await assert.rejects(reopened.remove('latest'), { code: 'NotFound', status: 404 })
  await reopened.remove('older')
  assert.equal(reopened.demo('tour').latest, null)
  assert.equal(reopened.demo('tour').runs, 0)
  await reopened.close()
})

test('starting and running history cannot be deleted, including records owned by another host', async () => {
  const f = historyFixture(['starting', 'running'].map((state) => ({ id: state, state, host: process.ppid })))
  for (const state of ['starting', 'running']) {
    await assert.rejects(f.manager.remove(state), { code: 'Busy', status: 409 })
    assert.equal(existsSync(join(f.spec.runs, state, 'run.json')), true)
    f.manager.live.set(`live-${state}`, { id: `live-${state}`, state })
    await assert.rejects(f.manager.remove(`live-${state}`), { code: 'Busy', status: 409 })
    f.manager.live.delete(`live-${state}`)
  }
  assert.deepEqual(f.events, [])
  await f.manager.close()
})

test('removing a live finished run waits for cleanup and prevents delayed writes or events from reviving it', async () => {
  const f = historyFixture([])
  const scenario = compileScenario(f.raw, { name: 'tour', folder: f.folder })
  const run = new Run({ spec: f.spec, demo: { id: 'tour', folder: f.folder, scenario }, record: { id: 'live-done', demo: 'tour', project: 'tour', state: 'running', started: Date.now() }, emit: (event) => f.manager.emit('event', event), loadSeed: async () => null, loadChecks: async () => null })
  f.manager.live.set(run.id, run)
  let finishCleanup
  run.closeSandboxes = async () => {
    await new Promise((resolve) => { finishCleanup = resolve })
    run.save(true)
  }
  run.stop()
  let removed = false
  const removing = f.manager.remove(run.id).then((value) => { removed = true; return value })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(removed, false)
  assert.equal(existsSync(run.dir), true)
  finishCleanup()
  assert.deepEqual(await removing, { id: run.id })
  assert.equal(f.manager.live.has(run.id), false)
  const eventCount = f.events.length
  // A stopped agent can still settle a pending think/job callback after finished.
  run.agentChanged(run.agents.get('root'))
  run.changed(true)
  run.save()
  run.save(true)
  await new Promise((resolve) => setTimeout(resolve, 350))
  assert.equal(f.events.length, eventCount)
  assert.equal(existsSync(run.dir), false)
  assert.deepEqual(f.events.at(-1), { type: 'run-removed', id: run.id, demo: 'tour' })
  await f.manager.close()
  const reopened = new RunManager({ spec: f.spec, scenarios: f.scenarios })
  assert.equal(reopened.run(run.id), null)
  await reopened.close()
})

test('removal waits for the startup sweep before removing its record', async () => {
  const f = historyFixture([{ id: 'sweeping', state: 'failed' }])
  await f.manager.sweeping
  let finishSweep
  f.manager.sweeping = new Promise((resolve) => { finishSweep = resolve }).then(() => {
    writeFileSync(join(f.spec.runs, 'sweeping', 'run.json'), JSON.stringify(f.manager.records.get('sweeping')))
  })
  const removing = f.manager.remove('sweeping')
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(existsSync(join(f.spec.runs, 'sweeping')), true)
  finishSweep()
  await removing
  await f.manager.close()
  assert.equal(existsSync(join(f.spec.runs, 'sweeping')), false)
})

test('a filesystem removal failure retains the record and emits no success event', async (t) => {
  // a run folder the removal cannot empty (read-only, so its run.json cannot be unlinked);
  // a file in place of the runs folder no longer fails: Node 24's rmSync with force ignores ENOTDIR
  if (process.getuid?.() === 0) return t.skip('root removes read-only folders')
  const f = historyFixture([{ id: 'retry' }])
  const folder = join(f.spec.runs, 'retry')
  chmodSync(folder, 0o500)
  try {
    await assert.rejects(f.manager.remove('retry'), (error) => ['EACCES', 'EPERM', 'ENOTEMPTY'].includes(error.code))
  } finally {
    chmodSync(folder, 0o700)
  }
  assert.equal(f.manager.run('retry').id, 'retry')
  assert.deepEqual(f.events, [])
  assert.equal(existsSync(join(folder, 'run.json')), true)
  await f.manager.remove('retry')
  await f.manager.close()
})

test('a malformed saved run id cannot delete outside the runs directory', async () => {
  const f = historyFixture([{ id: 'malformed' }])
  mkdirSync(f.spec.home, { recursive: true })
  writeFileSync(join(f.spec.home, 'sentinel'), 'keep')
  const record = f.manager.records.get('malformed')
  record.id = '../home'
  f.manager.records.set(record.id, record)
  await assert.rejects(f.manager.remove(record.id), { code: 'InvalidInput', status: 400 })
  assert.equal(readFileSync(join(f.spec.home, 'sentinel'), 'utf8'), 'keep')
  assert.deepEqual(f.events, [])
  await f.manager.close()
})

/** Plays a scenario of sessions (`sessions`, scenario.json form) as one launch, as RunManager.start does; Init skipped. */
async function playLaunch(sessions) {
  const id = `t${++n}`
  const folder = join(root, 'scenarios', id)
  mkdirSync(folder, { recursive: true })
  const raw = { type: 'layerfs-scenario', version: 3, title: id, tags: ['cli', 'multi-agent'], sessions }
  const scenario = compileScenario(raw, { name: id, folder })
  const launch = new Launch(`${id}-launch`)
  const started = Date.now()
  const runs = []
  const events = []
  scenario.sessions.forEach((s, i) => {
    const record = { id: `${launch.id}-${s.name}`, demo: id, project: `${id}-1`, replay: i + 1, session: s.name, launch: launch.id, state: 'starting', started }
    runs.push(new Run({ spec, demo: { id, folder, scenario: s.scenario }, record, emit: (e) => events.push(e), loadSeed: async () => null, loadChecks: async () => null, launch, after: runs[0] ?? null }))
  })
  let inits = 0
  runs[0].init = async () => {
    inits++
    // the others are still waiting for this Init
    assert.ok(runs.slice(1).every((r) => r.state === 'starting'))
  }
  await Promise.all(runs.map((r) => r.play()))
  return { runs, details: runs.map((r) => r.detail()), inits, launch }
}

const session = (lead, child, childSteps) => ({
  prompt: `Session ${lead}.`,
  agents: {
    [lead]: [{ subagent: { description: child, prompt: `Do the ${child} part.` } }, { reply: `${child} works.`, until: [child] }, bash(`echo ${lead} merged`), { reply: `${lead} is done.` }],
    [child]: childSteps,
  },
})

test('sessions: three, one fails: each other one names it as the cause', async () => {
  const { details } = await playLaunch({
    one: session('one', 'ann', [bash('exit 1', { description: 'fails' }), { reply: 'never.' }]),
    two: session('two', 'bob', [bash('sleep 5'), { reply: 'never either.' }]),
    six: session('six', 'cat', [bash('sleep 5'), { reply: 'nor this.' }]),
  })
  assert.deepEqual(details.map((d) => d.state), ['failed', 'stopped', 'stopped'])
  assert.deepEqual(details.slice(1).map((d) => d.error), ['stopped: session one failed', 'stopped: session one failed'])
})

test('sessions: a launch counts once against the runs playing at once', () => {
  const runs = new RunManager({ spec, scenarios: join(root, 'none') })
  runs.live.set('a', { state: 'running', launch: 'L' })
  runs.live.set('b', { state: 'running', launch: 'L' })
  runs.live.set('c', { state: 'running', launch: null, id: 'c' })
  assert.equal(runs.playing(), 2)
})
