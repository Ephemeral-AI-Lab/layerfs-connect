// The engine without LayerFS: the real Run, agents and tools on small
// scenarios whose bash steps are plain shell. A step that "calls LayerFS"
// appends the trace line the SDK would write to $LAYERFS_TRACE, labelled with
// $LAYERFS_TRACE_STEP, so the expect checks read real files. Init is skipped.
// Run: node --import ./host/resolve-layerfs.js --test host/test/runs.test.js
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

test('one agent: exit, expect from trace lines, commits and placeholders', async () => {
  const { detail } = await play({
    root: [
      bash(`${trace('sandbox.create', 'ok')}\necho '{"sandbox":"7"}'\necho '{"ws":"7:/workspaces/2"}'`, { step: { expect: ['sandbox.create:ok'] } }),
      bash(`${trace('workspace.commit', 'Committed')}\necho '{"kind":"Committed","head":"abc123"}'`, { step: { expect: ['workspace.commit:Committed'], commits: ['first'] } }),
      bash('echo "sandbox={{sandbox}} ws={{ws}} commit={{commit:first}}"'),
      bash('exit 3', { step: { exit: 3 } }),
      { reply: 'All done with {{commit:first}}.' },
    ],
  }, { tags: ['cli', 'publish'] })
  assert.equal(detail.state, 'passed', detail.error)
  assert.equal(detail.done, 5)
  assert.equal(detail.steps[2].stdout, 'sandbox=7 ws=7:/workspaces/2 commit=abc123\n')
  assert.deepEqual(detail.captured, { 'root.sandbox': '7', 'root.ws': '7:/workspaces/2', 'commit:first': 'abc123' })
  assert.equal(detail.steps[0].calls.length, 1)
  assert.equal(detail.steps[0].calls[0].method, 'sandbox.create')
  assert.equal(detail.messages.at(-1).text, 'All done with abc123.')
  assert.ok(detail.steps[1].checks.some((c) => c.name === 'commits' && c.ok))
})

test('a failed expect fails the run at that step; nothing after it runs', async () => {
  const { detail } = await play({
    root: [bash(`${trace('workspace.commit', 'Conflict', false)}`, { step: { expect: ['workspace.commit:Committed'] }, description: 'commit' }), bash('echo never')],
  }, { tags: ['cli', 'conflicts'] })
  assert.equal(detail.state, 'failed')
  assert.match(detail.error, /^root\[0\] \(commit\): expected workspace\.commit:Committed; its LayerFS calls show workspace\.commit:Conflict/)
  assert.equal(detail.steps.length, 1)
  assert.equal(detail.agents[0].state, 'failed')
})

test('an unexpected exit fails; a timeout kills the process group', async () => {
  const a = await play({ root: [bash('echo out; echo err >&2; exit 1')] }, { tags: ['cli', 'merge'] })
  assert.equal(a.detail.state, 'failed')
  assert.match(a.detail.error, /exit 1, the step expects 0/)
  assert.equal(a.detail.steps[0].stderr, 'err\n')
  const began = Date.now()
  const b = await play({ root: [bash('sleep 30 & sleep 30', { args: { timeoutMs: 300 } })] }, { tags: ['cli', 'merge'] })
  assert.equal(b.detail.state, 'failed')
  assert.match(b.detail.error, /timed out after 300ms/)
  assert.ok(Date.now() - began < 10_000)
})

test('subagents: until waits for replies, messages wake children, a reply carries a Commit id', async () => {
  const { detail } = await play({
    root: [
      { subagent: { description: 'a', prompt: 'You are a.' } },
      { subagent: { description: 'b', prompt: 'You are b.' } },
      { reply: 'Waiting for a and b.', until: ['a', 'b'] },
      { send_message: { agent_id: '@b', message: 'Commit something.' } },
      { reply: 'Waiting for b.', until: ['b'] },
      bash('echo "root saw {{commit:b1}}"'),
      { send_message: { agent_id: '@a', message: 'Anything else?' } },
      { reply: 'Waiting for a.', until: ['a'] },
      bash('echo finished'),
    ],
    a: [bash('sleep 0.2; echo a works'), { reply: 'a: ready.' }],
    b: [{ reply: 'b: ready.' }, bash(`echo '{"kind":"Committed","head":"c0ffee"}'`, { step: { commits: ['b1'] } }), { reply: 'b: committed {{commit:b1}}.' }],
  })
  assert.equal(detail.state, 'passed', detail.error)
  const rootStep5 = detail.steps.find((s) => s.agent === 'root' && s.index === 5)
  assert.equal(rootStep5.stdout, 'root saw c0ffee\n')
  // a is done when root writes to it again: it answers "Done." and root goes on
  assert.ok(detail.messages.some((m) => m.from === 'a' && m.to === 'root' && m.text === 'Done.'))
  assert.deepEqual(detail.agents.map((a) => [a.name, a.state, a.done, a.of]), [['root', 'done', 10, 10], ['a', 'done', 2, 2], ['b', 'done', 3, 3]])
  // messages in order: prompts, replies, root's message, b's reply with the id
  const texts = detail.messages.map((m) => `${m.from}>${m.to ?? '-'}`)
  assert.deepEqual(texts.slice(0, 2), ['root>a', 'root>b'])
  assert.ok(detail.messages.some((m) => m.from === 'b' && m.text === 'b: committed c0ffee.'))
})

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

test('a message sent while the child is ending its turn wakes it', async () => {
  const { detail } = await play({
    root: [{ subagent: { description: 'b', prompt: 'You are b.' } }, { reply: 'Waiting.', until: ['b'] }, { send_message: { agent_id: '@b', message: 'Go on.' } }, { reply: 'Waiting again.', until: ['b'] }, bash('echo end')],
    b: [{ reply: 'b: ready.' }, bash('echo b works'), { reply: 'b: done.' }],
  })
  assert.equal(detail.state, 'passed', detail.error)
})

test('a run no agent can move on fails as stuck', async () => {
  const { detail } = await play({
    root: [{ subagent: { description: 'b', prompt: 'You are b.' } }, { reply: 'Waiting.', until: ['b'] }, bash('echo end')],
    b: [bash('echo b'), { reply: 'b: ready.' }, bash('echo never'), { reply: 'b: never.' }],
  })
  assert.equal(detail.state, 'passed', detail.error)
  const stuck = await play({ root: [{ subagent: { description: 'c', prompt: 'You are c.' } }, { reply: 'Waiting for a message.' }, bash('echo never')], c: [{ reply: 'c here.' }] })
  assert.equal(stuck.detail.state, 'failed')
  assert.match(stuck.detail.error, /^stuck: no agent can go on \(root waits for a message\)/)
})

test('a wait whose children replied already is not said', async () => {
  const { detail } = await play({
    root: [{ subagent: { description: 'quick', prompt: 'You are quick.' } }, bash('sleep 0.3'), { reply: 'Waiting.', until: ['quick'] }, bash('echo on')],
    quick: [{ reply: 'quick: done.' }],
  })
  assert.equal(detail.state, 'passed', detail.error)
  const wait = detail.steps.find((s) => s.agent === 'root' && s.index === 2)
  assert.equal(wait.checks[0].name, 'wait')
  assert.ok(!detail.messages.some((m) => m.text === 'Waiting.'))
})

test('background job: job_output waits, job_list lists, its expect is checked when it ends', async () => {
  const { detail } = await play({
    root: [
      bash(`sleep 0.3; ${trace('backend.daemon.process.start', 'running')}; echo built`, { args: { run_in_background: true }, step: { as: 'build', expect: ['backend.daemon.process.start:running'] } }),
      bash('echo meanwhile'),
      { job_output: { job_id: '@build', wait: true, timeout_ms: 5000 } },
      { job_list: {} },
    ],
  }, { tags: ['cli', 'background'] })
  assert.equal(detail.state, 'passed', detail.error)
  const job = detail.steps.find((s) => s.index === 0)
  assert.equal(job.exitCode, 0)
  assert.ok(job.checks.some((c) => c.name === 'expect' && c.ok))
  assert.equal(job.calls[0].method, 'backend.daemon.process.start')
  const output = detail.steps.find((s) => s.index === 2)
  assert.match(output.output, /^built\n\[status: completed, exit 0\]$/)
  assert.match(detail.steps.find((s) => s.index === 3).output, /^job-1 \[bash\] completed — /)
})

test('a background job whose expect fails fails the run', async () => {
  const { detail } = await play({
    root: [
      bash('echo no calls', { args: { run_in_background: true }, step: { as: 'build', expect: ['backend.daemon.process.start:running'] } }),
      { job_output: { job_id: '@build', wait: true } },
      bash('sleep 1'),
    ],
  }, { tags: ['cli', 'background'] })
  assert.equal(detail.state, 'failed')
  assert.match(detail.error, /background expected backend\.daemon\.process\.start:running/)
})

test('a placeholder with no value fails the step', async () => {
  const { detail } = await play({ root: [bash('echo {{sandbox}}')] }, { tags: ['cli', 'sandbox'] })
  assert.equal(detail.state, 'failed')
  assert.match(detail.error, /has seen no value for \{\{sandbox\}\}/)
})

test('stop kills the running step and marks the run and agents stopped', async () => {
  const began = Date.now()
  const { detail } = await play({ root: [bash('sleep 30')] }, { tags: ['cli', 'merge'], stopAfter: 300 })
  assert.equal(detail.state, 'stopped')
  assert.equal(detail.steps[0].state, 'stopped')
  assert.equal(detail.agents[0].state, 'stopped')
  assert.ok(Date.now() - began < 10_000)
})

test('the environment: layerfs shim first on PATH, the resolve hook, LAYERFS_* and the trace label', async () => {
  const { detail, run } = await play({
    root: [bash('echo "$LAYERFS_PROJECT|$LAYERFS_TRACE_STEP|$LAYERFS_TRACE_START|$(basename "$LAYERFS_TRACE")|$NODE_OPTIONS"; command -v layerfs; head -2 "$(command -v layerfs)" | tail -1; pwd')],
  }, { tags: ['cli', 'merge'] })
  assert.equal(detail.state, 'passed', detail.error)
  const [envLine, shimPath, shim, cwd] = detail.steps[0].stdout.trim().split('\n')
  const [project, label, start, file, options] = envLine.split('|')
  assert.deepEqual([project, label, start, file], [`t${n}-1`, 'root:0', '1', 'root.jsonl'])
  assert.match(options, /--import=\/.*\/host\/resolve-layerfs\.js$/)
  assert.equal(shimPath, join(run.bin, 'layerfs'))
  assert.match(shim, /^exec node --import '.*\/host\/resolve-layerfs\.js' '.*\/agent\/cli\/src\/layerfs\.js' "\$@"$/)
  assert.equal(cwd.replace(/^\/private/, ''), run.work.replace(/^\/private/, ''))
  const saved = JSON.parse(readFileSync(join(run.dir, 'run.json'), 'utf8'))
  for (const key of ['demo', 'state', 'error', 'started', 'ended', 'project', 'checks']) assert.ok(key in saved, key)
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

test('sessions: one launch, one Init, every session plays on it at once with its own root', async () => {
  const { details, inits } = await playLaunch({
    one: session('one', 'ann', [bash('sleep 0.3; echo ann'), { reply: 'ann ready.' }]),
    two: session('two', 'bob', [bash('sleep 0.3; echo bob'), { reply: 'bob ready.' }]),
  })
  assert.equal(inits, 1)
  for (const d of details) assert.equal(d.state, 'passed', d.error)
  assert.deepEqual(details.map((d) => d.session), ['one', 'two'])
  assert.deepEqual(details.map((d) => d.agents.map((a) => `${a.name}<${a.parent}`)), [['one<null', 'ann<one'], ['two<null', 'bob<two']])
  assert.equal(details[0].launch, details[1].launch)
  // they overlap: each session's child ran while the other's did
  const [a, b] = details.map((d) => d.steps.find((s) => s.agent !== d.session))
  assert.ok(a.started < b.ended && b.started < a.ended, 'the sessions played at the same time')
  assert.ok(details[0].messages.some((m) => m.from === 'ann' && m.to === 'one' && m.text === 'ann ready.'))
  assert.ok(!details[0].messages.some((m) => ['two', 'bob'].includes(m.from)), 'a session sees only its own messages')
})

test('sessions: one that fails stops the others, and the launch closes its Sandboxes once', async () => {
  const { details, launch } = await playLaunch({
    one: session('one', 'ann', [bash('exit 1', { description: 'fails' }), { reply: 'never.' }]),
    two: session('two', 'bob', [bash('sleep 5'), { reply: 'never either.' }]),
  })
  assert.equal(details[0].state, 'failed')
  assert.match(details[0].error, /ann\[0\] \(fails\)/)
  assert.equal(details[1].state, 'stopped')
  assert.equal(details[1].error, 'stopped: session one failed')
  assert.ok(details[1].ended - details[1].started < 4000, 'bob was killed, not waited for')
  assert.ok(launch.closing, 'the launch closed the project once')
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
