import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionManager } from '@earendil-works/pi-coding-agent'
import { SimulationAgents } from '../simulations/agents.js'
import { SimulationManager } from '../simulations/index.js'
import { executeSimulationBash } from '../simulations/bash.js'
import { compileSimulation } from '../../tools/simulation/compiler.mjs'

function scriptedTask(runtime, args) {
  const { execute, ...input } = args
  const steps = [{ key: `${args.task.id}.step`, argv: ['branch', 'get', 'simulation/project', 'main'] }]
  return runtime.executeTask({ ...input, steps, resolveStep: step => step.argv, executeStep: execute })
}

function state(t) { const dir = mkdtempSync(join(tmpdir(), 'simulation-test-')); t.after(() => rmSync(dir, { recursive: true, force: true })); return dir }

test('real Pi main and child sessions execute tools, delegate and reuse saved history', async t => {
  const dir = state(t), published = [], calls = []
  const runtime = new SimulationAgents({ state: dir, publishSession: async update => published.push(update) })
  t.after(() => runtime.close())
  for (let index = 1; index <= 2; index++) await scriptedTask(runtime, { chatId: 'chat-real', agentId: 'a01-feature', task: { id: `task-${index}`, title: `Task ${index}`, prompt: `Implement task ${index}` }, signal: new AbortController().signal, execute: async () => { calls.push(index); return { task: index, actual: true } } })
  await scriptedTask(runtime, { chatId: 'chat-real', agentId: null, task: { id: 'integrate', title: 'Integrate worker results' }, execute: async () => { calls.push('integrate'); return { integrated: true } } })
  assert.deepEqual(calls, [1, 2, 'integrate'])
  const last = published.at(-1)
  assert.equal(last.children.length, 1)
  const main = SessionManager.open(last.sessionFile).getEntries().filter(entry => entry.type === 'message').map(entry => entry.message)
  assert.equal(main.filter(message => message.role === 'user').length, 1)
  assert.equal(main.filter(message => message.role === 'toolResult' && message.toolName === 'simulation_delegate').length, 2)
  const collected = main.filter(message => message.role === 'toolResult' && message.toolName === 'simulation_collect')
  assert.equal(collected.length, 2)
  assert.equal(collected[1].details.agentId, 'a01-feature')
  assert.deepEqual(collected[1].details.result.final, { task: 2, actual: true })
  const integration = main.findIndex(message => message.role === 'assistant' && message.content.some(part => part.type === 'toolCall' && part.name === 'bash'))
  assert.ok(integration > main.findIndex(message => message === collected[1]), 'Both real worker result handoffs precede integration')
  const child = SessionManager.open(last.children[0].sessionFile).getEntries().filter(entry => entry.type === 'message').map(entry => entry.message)
  assert.equal(child.filter(message => message.role === 'user').length, 1)
  const tools = child.filter(message => message.role === 'toolResult')
  assert.equal(tools.length, 2)
  assert.equal(tools[1].toolName, 'bash')
  assert.deepEqual(tools[1].details.receipt, { task: 2, actual: true })
  assert.match(child.find(message => message.role === 'assistant').content[0].arguments.command, /branch.*get.*simulation\/project/)
})

function fixture(t, overrides = {}) {
  const dir = state(t), chats = [], compiled = compileSimulation({ project: 'design', runId: 'run-test', cycles: 1 })
  const byCommand = new Map(compiled.plan.steps.map(step => [JSON.stringify(step.argv), step]))
  const executed = []
  const manager = new SimulationManager({ state: dir, spec: {}, agents: { createConversation: async input => { const chat = { id: `chat-${chats.length}`, ...input }; chats.push(chat); return chat }, publishSession: async () => {} }, agentRuntime: { executeTask: async ({ execute }) => execute() }, verify: async (_query, _store, _name, receipts) => ({ verified: Object.keys(receipts).length }), execute: async (_spec, argv) => {
    executed.push(argv)
    const exact = byCommand.get(JSON.stringify(argv))
    const expected = exact?.expect ?? (argv[0] === 'branch' && argv[1] === 'publish' ? { kind: 'Added' } : {})
    return { state: 'ready', supports: { sqlite: true }, kind: expected.kind ?? 'Created', head: `head-${executed.length}`, ws: 'box:workspace', exit_code: expected.exitCode, fast_forward: false, overwrote_count: 0 }
  }, ...overrides })
  return { manager, dir, chats, executed, compiled }
}

test('simulation creates fresh project-bound conversations after setup and persists verified receipts', async t => {
  const f = fixture(t)
  await f.manager.start({ project: 'design', runId: 'run-test', cycles: 1 })
  const result = await f.manager.settled('run-test')
  assert.equal(result.status, 'completed', result.error)
  assert.equal(f.chats.length, 1)
  assert.equal(f.chats[0].project, f.compiled.manifest.projectRef)
  const journal = readFileSync(join(result.directory, 'journal.jsonl'), 'utf8').trim().split('\n').map(JSON.parse)
  assert.equal(journal.filter(event => event.type === 'step.completed').length, f.compiled.plan.steps.length)
  assert.equal(new Set(journal.filter(event => event.type === 'step.started').map(event => event.step)).size, f.compiled.plan.steps.length)
  assert.equal(result.resources.store.status, 'created')
  assert.deepEqual(result.resources.branches.map(branch => branch.name).sort(), [...f.compiled.expectations.branches].sort())
  assert.ok(result.resources.branches.every(branch => branch.owned && branch.status === 'retained'))
})

test('failed mutation is attempted once, blocks dependent tasks and retains evidence', async t => {
  let attempts = 0
  const f = fixture(t, { execute: async () => { attempts++; throw Object.assign(new Error('Lost process result; effects unknown.'), { transport: 'transport-unknown' }) } })
  await f.manager.start({ project: 'design', runId: 'run-test', cycles: 1 })
  const result = await f.manager.settled('run-test')
  assert.equal(result.status, 'failed')
  assert.equal(attempts, 1)
  assert.equal(f.chats.length, 0)
  const rows = readFileSync(join(result.directory, 'journal.jsonl'), 'utf8')
  assert.match(rows, /"replayAllowed":false/)
  const reopened = new SimulationManager({ state: f.dir, spec: {}, agents: {}, agentRuntime: {} })
  assert.equal(reopened.get('run-test').status, 'failed')
})

test('stop terminates the active CLI attempt and never starts another setup step', async t => {
  let notify, attempts = 0
  const started = new Promise(resolve => { notify = resolve })
  const f = fixture(t, { execute: async (_spec, _argv, options) => new Promise((_resolve, reject) => { attempts++; options.onSpawn({ kill: () => reject(new Error('Terminated')) }); notify() }) })
  await f.manager.start({ project: 'design', runId: 'run-test', cycles: 1 }); await started
  const result = await f.manager.stop('run-test')
  assert.equal(result.status, 'stopped')
  assert.equal(attempts, 1)
})

test('two children run concurrently beneath one genuine reused main conversation', async t => {
  const dir = state(t), published = [], runtime = new SimulationAgents({ state: dir, publishSession: async update => published.push(update) })
  t.after(() => runtime.close())
  let release, started = 0, ready
  const bothStarted = new Promise(resolve => { ready = resolve })
  const gate = new Promise(resolve => { release = resolve })
  const work = ['a01-feature', 'a02-review'].map(agentId => scriptedTask(runtime, { chatId: 'parallel-chat', agentId, task: { id: agentId, title: agentId }, execute: async () => { if (++started === 2) ready(); await gate; return { confirmed: agentId } } }))
  await bothStarted
  assert.equal(started, 2); release(); await Promise.all(work)
  assert.equal(runtime.sessions.size, 3)
  const last = published.at(-1)
  assert.equal(last.children.length, 2)
  assert.equal(SessionManager.open(last.sessionFile).getEntries().filter(entry => entry.type === 'message' && entry.message.role === 'user').length, 1)
})

test('independent simultaneous runs share a global CLI ceiling and distinct projects', async t => {
  let active = 0, peak = 0
  const projects = new Set()
  const f = fixture(t, { execute: async (_spec, argv) => {
    active++; peak = Math.max(peak, active)
    if (argv[0] === 'project' && argv[1] === 'init') projects.add(argv[2])
    await new Promise(resolve => setTimeout(resolve, 1))
    active--
    const kinds = { fork: 'Forked', write: 'Committed', merge: 'Merged', publish: 'Added' }
    return { state: 'ready', supports: { sqlite: true }, kind: kinds[argv[1]] ?? 'Created', head: `head-${Math.random()}`, fast_forward: false, overwrote_count: 0 }
  } })
  f.manager.cliLimit = 2
  await Promise.all(['run-test', 'run-second'].map(runId => f.manager.launch({ project: 'design', runId, cycles: 1 })))
  const results = await Promise.all(['run-test', 'run-second'].map(id => f.manager.settled(id)))
  assert.ok(results.every(result => result.status === 'completed'), results.map(result => result.error).join('\n'))
  assert.equal(projects.size, 2)
  assert.equal(peak, 2)
  assert.equal(f.manager.busy(), false)
})

test('stop remains pending until every active task has drained', async t => {
  let release, ready, started = 0, drained = 0
  const gate = new Promise(resolve => { release = resolve })
  const twoStarted = new Promise(resolve => { ready = resolve })
  const f = fixture(t, { agentRuntime: { executeTask: async ({ task, signal }) => {
    if (!task.agentId) return
    if (++started === 2) ready()
    await gate
    drained++; signal.throwIfAborted()
  } } })
  // Two distinct workers in the full profile may execute together; use SDK's first cycle.
  await f.manager.start({ project: 'sdk', runId: 'run-test', cycles: 1 })
  await twoStarted
  let finished = false
  const stopping = f.manager.stop('run-test').then(value => { finished = true; return value })
  await new Promise(resolve => setTimeout(resolve, 10))
  assert.equal(finished, false)
  assert.equal(f.manager.get('run-test').status, 'stopping')
  release()
  const result = await stopping
  assert.equal(result.status, 'stopped')
  assert.equal(drained, 2)
})

test('unknown remote cancellation is retained as interrupted rather than confirmed stopped', async t => {
  let notify, cancellationAttempts = 0
  const started = new Promise(resolve => { notify = resolve })
  const f = fixture(t, { execute: async (_spec, argv, options) => {
    if (argv[0] === 'workspace' && argv[1] === 'exec-cancel') { cancellationAttempts++; return { outcome: 'unknown' } }
    if (argv[0] === 'workspace' && argv[1] === 'exec') return new Promise((_resolve, reject) => { options.onSpawn({ kill: () => reject(new Error('Terminated')) }); notify() })
    const kinds = { fork: 'Forked', write: 'Committed', commit: 'Committed', merge: 'Merged', publish: 'Added', unmount: 'Unmounted' }
    return { state: 'ready', supports: { sqlite: true }, kind: kinds[argv[1]] ?? 'Created', head: 'confirmed-head', ws: 'box:workspace', fast_forward: false, overwrote_count: 0 }
  } })
  await f.manager.start({ project: 'design', runId: 'run-test', cycles: 1, mixed: true }); await started
  const result = await f.manager.stop('run-test')
  assert.equal(result.status, 'interrupted')
  assert.equal(result.cancellationUnconfirmed, true)
  assert.equal(cancellationAttempts, 1)
  assert.match(result.error, /cancellation could not be confirmed/)
  const journal = readFileSync(join(result.directory, 'journal.jsonl'), 'utf8')
  assert.match(journal, /execution.cancel-failed/)
  assert.doesNotMatch(journal, /execution.cancelled/)
})

function gateRun(dir, id = 'gate-run') {
  return { dir, controller: new AbortController(), receipts: {}, completed: new Set(), started: new Set(), sessions: { conversations: {} }, resources: { store: {}, branches: [], sandboxes: [], workspaces: [] }, manifest: { runId: id, project: 'design', projectRef: 'store/project', progress: { completed: 0, total: 10 } } }
}

test('sandbox lifecycle admission prevents detached-but-retained records crossing fresh workspace calls', { timeout: 5000 }, async t => {
  let release, detaching = false, attempted = []
  const detached = new Promise(resolve => { release = resolve })
  const f = fixture(t, { execute: async (_spec, argv) => {
    attempted.push(argv)
    if (argv[0] === 'workspace' && argv[1] === 'unmount') { detaching = true; await detached; detaching = false; return { kind: 'Unmounted' } }
    const sandbox = argv[1] === 'mount' ? argv[2] : argv[2]?.split(':')[0]
    if (argv[0] === 'workspace' && sandbox === 'shared' && detaching) throw Object.assign(new Error('saved Workspace is no longer mounted'), { code: 'NotMounted' })
    return { kind: 'ok', ws: 'shared:new' }
  } })
  const run = gateRun(f.dir)
  const unmount = f.manager.command(run, { key: 'unmount', argv: ['workspace', 'unmount', 'shared:old'] })
  await new Promise(resolve => setImmediate(resolve))
  const mount = f.manager.command(run, { key: 'mount', argv: ['workspace', 'mount', 'shared', 'feature', '--name', 'new'] })
  const peerExec = f.manager.command(run, { key: 'peer-exec', argv: ['workspace', 'exec', 'shared:peer', 'true'] })
  await Promise.all([
    f.manager.command(run, { key: 'other-box', argv: ['workspace', 'exec', 'independent:worker', 'true'] }),
    f.manager.command(run, { key: 'file', argv: ['file', 'write', 'store/project', 'feature', '/a'] }),
  ])
  assert.equal(attempted[0][2], 'shared:old')
  assert.deepEqual(attempted.slice(1).map(argv => argv[2]).sort(), ['independent:worker', 'store/project'])
  assert.equal(f.manager.cliActive, 1, 'Lifecycle waiters must not occupy global CLI slots')
  release(); await Promise.all([unmount, mount, peerExec])
  assert.deepEqual(attempted.slice(-2).map(argv => argv[2]), ['shared', 'shared:peer'])
  assert.equal(attempted.length, 5, 'Every CLI call has exactly one attempt')
  assert.equal(f.manager.workspaceGate.lanes.size, 0)
})

test('independent workspace exec calls share sandbox admission and run concurrently', { timeout: 5000 }, async t => {
  let release, ready, active = 0, peak = 0
  const gate = new Promise(resolve => { release = resolve }), both = new Promise(resolve => { ready = resolve })
  const f = fixture(t, { execute: async () => { active++; peak = Math.max(peak, active); if (active === 2) ready(); await gate; active--; return { kind: 'exit:0' } } })
  const run = gateRun(f.dir)
  const work = ['a', 'b'].map(name => f.manager.command(run, { key: name, argv: ['workspace', 'exec', `shared:${name}`, 'true'] }))
  await both; release(); await Promise.all(work)
  assert.equal(peak, 2)
  assert.equal(f.manager.workspaceGate.lanes.size, 0)
})

test('aborted lifecycle waiters never dispatch; explicit cancellation bypasses lifecycle admission', { timeout: 5000 }, async t => {
  let release
  const gate = new Promise(resolve => { release = resolve }), attempted = []
  const f = fixture(t, { execute: async (_spec, argv) => { attempted.push(argv); if (argv[1] === 'unmount') await gate; return { kind: 'ok', outcome: 'ended' } } })
  const holder = gateRun(f.dir, 'holder'), queued = gateRun(f.dir, 'queued')
  const unmount = f.manager.command(holder, { key: 'unmount', argv: ['workspace', 'unmount', 'shared:old'] })
  await new Promise(resolve => setImmediate(resolve))
  const mount = f.manager.command(queued, { key: 'mount', argv: ['workspace', 'mount', 'shared', 'feature'] })
  queued.controller.abort(new Error('Queued simulation stopped'))
  await assert.rejects(mount, /Queued simulation stopped/)
  await f.manager.command(holder, { key: 'cancel', argv: ['workspace', 'exec-cancel', 'shared:peer', 'exec-id'] })
  assert.deepEqual(attempted.map(argv => argv[1]), ['unmount', 'exec-cancel'])
  release(); await unmount
  assert.equal(f.manager.workspaceGate.lanes.size, 0)
})

test('failed lifecycle and shared operations release their sandbox admission', async t => {
  const f = fixture(t), signal = new AbortController().signal
  for (const exclusive of [true, false]) {
    await assert.rejects(f.manager.workspaceGate.run('shared', exclusive, signal, async () => { throw new Error('CLI refusal') }), /CLI refusal/)
    assert.equal(f.manager.workspaceGate.lanes.size, 0)
  }
  assert.equal(await f.manager.workspaceGate.run('shared', true, signal, async () => 'admitted'), 'admitted')
  assert.equal(f.manager.workspaceGate.lanes.size, 0)
})

test('many assignments stay within two natural completed request turns per reusable agent', { timeout: 20000 }, async t => {
  const runtime = new SimulationAgents({ state: state(t) }); t.after(() => runtime.close())
  for (let turn = 1; turn <= 2; turn++) {
    for (let task = 1; task <= 6; task++) {
      const id = `release-${turn}-task-${task}`
      await scriptedTask(runtime, { chatId: 'natural-turns', agentId: 'a01-feature', task: { id, title: `Inspect release ${turn} branch ${task}` }, mainTurn: { id: `release-${turn}`, request: `Coordinate the six branch inspections for release ${turn}.` }, agentTurn: { id: `release-${turn}`, request: `Inspect the six related branches for release ${turn} and return their saved heads.` }, execute: async () => ({ head: `confirmed-${turn}-${task}` }) })
    }
    await runtime.finishTurn('natural-turns', 'a01-feature', `release-${turn}`)
    await runtime.finishTurn('natural-turns', null, `release-${turn}`)
  }
  for (const agentId of ['main', 'a01-feature']) {
    const entry = runtime.sessions.get(`natural-turns/${agentId}`)
    const messages = SessionManager.open(entry.session.sessionFile).getEntries().filter(entry => entry.type === 'message').map(entry => entry.message)
    assert.equal(messages.filter(message => message.role === 'user').length, 2)
    assert.equal(messages.filter(message => message.role === 'assistant' && message.stopReason === 'stop').length, 2)
    const results = messages.filter(message => message.role === 'toolResult')
    assert.equal(results.length, agentId === 'main' ? 24 : 12)
    assert.equal(results.filter(result => result.toolName === 'simulation_task').length, 0)
    assert.match(messages.filter(message => message.role === 'assistant' && message.stopReason === 'stop').at(-1).content[0].text, /Completed.*release 2/)
  }
})

test('explicit shell preserves quoted argv and stdin while the host validates the single CLI invocation', async t => {
  const runtime = new SimulationAgents({ state: state(t) }); t.after(() => runtime.close())
  const step = { key: 'quoted.write', argv: ['file', 'write', 'store/project', 'feature', '/file with spaces'], input: "literal 'quotes', $HOME, `echo unsafe`\nsecond line\n" }
  let calls = 0
  await runtime.executeTask({ chatId: 'quoted-shell', task: { id: 'quoted', title: 'Write the exact requested content', scriptPath: 'main/scripts/quoted.sh' }, steps: [step], resolveStep: step => step.argv, executeStep: async actual => { assert.equal(actual, step); calls++; return { kind: 'Committed', head: 'saved-head' } } })
  await runtime.finishChat('quoted-shell')
  const entry = runtime.sessions.get('quoted-shell/main')
  const messages = SessionManager.open(entry.session.sessionFile).getEntries().filter(entry => entry.type === 'message').map(entry => entry.message)
  const result = messages.find(message => message.role === 'toolResult' && message.toolName === 'bash')
  assert.equal(calls, 1)
  assert.deepEqual(result.details.argv, step.argv)
  assert.equal(result.details.stepKey, step.key)
  assert.equal(result.details.exitCode, 0)
  assert.match(result.content[0].text, /saved-head/)
})

test('a failed real bash CLI invocation is saved as an error without replay or invented success', async t => {
  const runtime = new SimulationAgents({ state: state(t) }); t.after(() => runtime.close())
  let attempts = 0
  await assert.rejects(scriptedTask(runtime, { chatId: 'failed-shell', task: { id: 'failed', title: 'Read the requested branch' }, execute: async () => { attempts++; throw new Error('CLI result unavailable; inspect effects') } }), /CLI result unavailable/)
  const entry = runtime.sessions.get('failed-shell/main')
  const messages = SessionManager.open(entry.session.sessionFile).getEntries().filter(entry => entry.type === 'message').map(entry => entry.message)
  const result = messages.find(message => message.role === 'toolResult' && message.toolName === 'bash')
  assert.equal(result.isError, true)
  assert.match(result.content[0].text, /CLI result unavailable/)
  assert.equal(attempts, 1)
})

test('shell shim refuses argv drift before any CLI mutation is admitted', async t => {
  const dir = state(t); let attempts = 0
  await assert.rejects(executeSimulationBash({ command: '"$LAYERFS_CONNECT_CLI" file rm store/project feature /wrong', argv: ['branch', 'get', 'store/project', 'main'], stepKey: 'read', cwd: dir, execute: async () => { attempts++; return {} } }), /does not match its compiled/)
  assert.equal(attempts, 0)
})

test('aborting a genuine shell drains the active host invocation before returning', async t => {
  const dir = state(t), controller = new AbortController(); let notify, drained = false
  const started = new Promise(resolve => { notify = resolve })
  const work = executeSimulationBash({ command: '"$LAYERFS_CONNECT_CLI" workspace exec box:worker true', argv: ['workspace', 'exec', 'box:worker', 'true'], stepKey: 'exec', cwd: dir, signal: controller.signal, execute: async () => {
    notify()
    await new Promise((_resolve, reject) => controller.signal.addEventListener('abort', () => { drained = true; reject(new Error('Actual CLI stopped')) }, { once: true }))
  } })
  await started; controller.abort(new Error('Stop requested'))
  await assert.rejects(work, /Stop requested/)
  assert.equal(drained, true)
})

test('a saved agent cannot accept an eleventh user turn', async t => {
  const runtime = new SimulationAgents({ state: state(t) }); t.after(() => runtime.close())
  const entry = await runtime.session('turn-ceiling')
  for (let index = 1; index <= 10; index++) {
    await runtime.enqueue(entry, { task: { id: `receipt-${index}`, title: `Receive confirmed result ${index}` }, collect: true, turn: { id: `turn-${index}`, request: `Review confirmed result ${index}.` }, execute: async () => ({ confirmed: index }) })
    await runtime.finishTurn('turn-ceiling', null, `turn-${index}`)
  }
  await assert.rejects(runtime.enqueue(entry, { task: { id: 'receipt-11', title: 'Extra result' }, collect: true, turn: { id: 'turn-11', request: 'Review an extra result.' }, execute: async () => ({ confirmed: 11 }) }), /ten-turn limit/)
  const messages = SessionManager.open(entry.session.sessionFile).getEntries().filter(entry => entry.type === 'message').map(entry => entry.message)
  assert.equal(messages.filter(message => message.role === 'user').length, 10)
})

test('manager assigns compiled natural turns and closes each only after all objective tasks finish', async t => {
  const compiled = compileSimulation({ project: 'design', runId: 'run-test', cycles: 2 }), completed = new Set(), closed = []
  const f = fixture(t, { execute: async (_spec, argv) => ({ state: 'ready', supports: { sqlite: true }, kind: ({ fork: 'Forked', write: 'Committed', merge: 'Merged', publish: 'Added' })[argv[1]] ?? 'Created', head: `confirmed-${completed.size}`, fast_forward: false, overwrote_count: 0 }), agentRuntime: {
    executeTask: async ({ task, mainTurn, agentTurn, execute }) => {
      assert.ok(mainTurn.taskIds.includes(task.id))
      if (task.agentId) assert.ok(agentTurn.taskIds.includes(task.id))
      const result = await execute(); completed.add(task.id); return result
    },
    finishTurn: async (chatId, agentId, turnId) => {
      const conversationId = f.chats.find(chat => chat.id === chatId).conversationId
      const group = compiled.plan.turns.find(turn => turn.conversationId === conversationId && turn.agentId === agentId && turn.id === turnId)
      assert.ok(group, 'The closing turn belongs to the compiled agent')
      assert.ok(group.taskIds.every(id => completed.has(id)), 'A final reply must wait for every task and collected result in its objective')
      closed.push(`${conversationId}/${agentId ?? 'main'}/${turnId}`)
    },
  } })
  await f.manager.start({ project: 'design', runId: 'run-test', cycles: 2 })
  const result = await f.manager.settled('run-test')
  assert.equal(result.status, 'completed', result.error)
  assert.equal(closed.length, compiled.plan.turns.length)
  assert.equal(new Set(closed).size, closed.length)
})
