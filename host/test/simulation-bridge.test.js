import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentManager } from '../agents/index.js'
import { agentRoute } from '../agents/routes.js'
import { reconcileSimulationChats, simulationChatAdapter } from '../agents/simulation-bridge.js'
import { SimulationAgents } from '../simulations/agents.js'

async function fixture(t) {
  const state = mkdtempSync(join(tmpdir(), 'connect-simulation-bridge-'))
  const originalAgentDir = process.env.PI_CODING_AGENT_DIR
  const requestedProjects = [], managers = []
  const open = async () => {
    const manager = await AgentManager.create({ state, defaultCwd: state, projectEnvironment: async project => { requestedProjects.push(project); return {} } })
    managers.push(manager)
    return manager
  }
  const manager = await open()
  const adapter = simulationChatAdapter(manager)
  const runtime = new SimulationAgents({ state, publishSession: update => adapter.publishSession(update), recorder: (chatId, context) => adapter.recorder(chatId, context) })
  t.after(async () => {
    await runtime.close()
    for (const entry of managers) await entry.close()
    rmSync(state, { recursive: true, force: true })
    if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR
    else process.env.PI_CODING_AGENT_DIR = originalAgentDir
  })
  const chat = await adapter.createConversation({ title: 'Catalog delivery', project: 'simulation-001/website-001', runId: 'simulation-001', conversationId: 'c01-catalog' })
  return { state, manager, adapter, runtime, chat, requestedProjects, open }
}
const task = (id, title = 'Implement catalog search') => ({ id, title, prompt: title, scriptPath: `conversations/c01-catalog/main/scripts/${id}.sh` })
const executeTask = (fixture, { execute, ...input }) => {
  const step = { key: `${input.task.id}.fork`, argv: ['branch', 'fork', 'simulation-001/website-001', `feature-${input.task.id}`, '--from', 'main'], dependsOn: [] }
  const mainTurn = { id: 'catalog-release', request: 'Coordinate the Catalog release objective. Delegate feature changes, collect confirmed results, and integrate only after dependencies finish.' }
  const agentTurn = { id: 'catalog-feature', request: 'Implement the Catalog feature objective. Execute the visible CLI steps in order and report the confirmed saved branch heads.' }
  return fixture.runtime.executeTask({ ...input, mainTurn, agentTurn, steps: [step], resolveStep: step => step.argv, executeStep: execute })
}

test('simulation bridge binds saved main and reusable child transcripts to the independent project', async t => {
  const f = await fixture(t)
  for (let index = 1; index <= 2; index++) await executeTask(f, { chatId: f.chat.id, agentId: 'a01-feature', task: task(`feature-${index}`, `Catalog request ${index}`), execute: async () => ({ kind: 'Forked', head: `confirmed-${index}` }) })
  await f.runtime.finishChat(f.chat.id)
  await f.runtime.publish(f.chat.id, 'idle')
  const detail = await agentRoute(f.manager, 'GET', ['sessions', f.chat.id])
  assert.equal(detail.state, 'idle')
  assert.equal(detail.execution.phase, 'idle')
  assert.equal(detail.project, 'simulation-001/website-001')
  assert.deepEqual(f.requestedProjects, ['simulation-001/website-001'])
  assert.equal(detail.simulation.id, 'simulation-001')
  assert.equal(f.manager.list()[0].project, detail.project)
  assert.equal(detail.children.length, 1, 'Two assignments reuse the same child')
  assert.equal(detail.children[0].conversation, true)
  assert.equal(detail.children[0].state, 'completed')
  const child = await agentRoute(f.manager, 'GET', ['sessions', f.chat.id, 'children', 'a01-feature'])
  const requests = child.messages.filter(message => message.role === 'user')
  assert.equal(requests.length, 1, 'Related assignments continue one persistent worker turn')
  assert.match(requests[0].text, /Implement the Catalog feature objective/)
  assert.equal(child.messages.filter(message => message.role === 'tool').length, 2)
  assert.equal(child.child.turns, 1, 'Displayed simulation turns count requests, not per-step assistant tool messages')
  assert.equal(child.child.toolCount, 2, 'Actual bash tool calls remain independently counted')
  const lastBash = child.messages.filter(message => message.role === 'tool').at(-1)
  assert.equal(lastBash.toolName, 'bash')
  assert.match(lastBash.args.command, /branch/)
  assert.match(lastBash.args.command, /feature-feature-2/)
  assert.deepEqual(lastBash.details.argv, ['branch', 'fork', 'simulation-001/website-001', 'feature-feature-2', '--from', 'main'])
  assert.equal(lastBash.details.receipt.head, 'confirmed-2')
  assert.ok(detail.messages.every(message => !message.canRestore), 'Scripted histories cannot restore checkpoints')
  assert.equal(f.manager.live.size, 0, 'Reading never opens an ordinary model session')
  assert.throws(() => f.manager.childConversation(f.chat.id, 'foreign-child'), { status: 404 })
})

test('simulation bash CLI calls are recorded as cli operations of their tool, with typed links, in main and child agents', async t => {
  const f = await fixture(t)
  const project = 'simulation-001/website-001', head = (c) => c.repeat(40)
  const steps = [
    { key: 's.fork', argv: ['branch', 'fork', project, 'feature-a', 'main'], result: { kind: 'Forked', branch: 'feature-a', head: head('a') } },
    { key: 's.write', argv: ['file', 'write', project, 'feature-a', '/a.txt', '--message', 'add a'], input: 'hello', result: { kind: 'Committed', branch: 'feature-a', head: head('b') } },
    { key: 's.mount', argv: ['workspace', 'mount', 'box', 'feature-a'], result: { ws: 'box:feature-a', branch: 'feature-a' } },
    { key: 's.exec', argv: ['workspace', 'exec', 'box:feature-a', 'true'], result: { exit_code: 0 } },
    { key: 's.commit', argv: ['workspace', 'commit', 'box:feature-a', '--message', 'ws'], result: { kind: 'Committed', head: head('c') } },
    { key: 's.unmount', argv: ['workspace', 'unmount', 'box:feature-a'], result: {} },
    { key: 's.read', argv: ['file', 'read', project, 'feature-a', '/a.txt'], result: { content: 'hello' } },
  ]
  const receipts = {}
  const mountFacts = (step, value) => step.argv[1] === 'mount' ? (value?.ws ? { project, branch: value.branch } : null) : receipts['s.mount'] ? { project, branch: receipts['s.mount'].branch } : null
  for (const agentId of [null, 'a01-feature']) {
    for (const key of Object.keys(receipts)) delete receipts[key]
    await f.runtime.executeTask({ chatId: f.chat.id, agentId, task: task(`ops-${agentId ?? 'main'}`), steps, resolveStep: step => step.argv, project, mountFacts,
      executeStep: async step => { receipts[step.key] = step.result; return step.result },
      mainTurn: { id: 'main-turn', request: 'Coordinate.' }, agentTurn: { id: 'child-turn', request: 'Implement.' } })
  }
  await f.runtime.finishChat(f.chat.id)
  await f.runtime.publish(f.chat.id, 'idle')
  const page = await agentRoute(f.manager, 'GET', ['sessions', f.chat.id, 'operations'], undefined, new URLSearchParams())
  const ops = page.items
  assert.equal(ops.length, steps.length * 2, 'one operation per CLI call, main and child')
  assert.ok(ops.every(o => o.origin === 'cli' && o.cause === 'tool' && o.status === 'succeeded' && o.tool_call_id && o.entry_id), 'each is a cli call of its bash tool, with its entry')
  const by = (agent) => Object.fromEntries(ops.filter(o => (agent ? o.agent_id.startsWith('child-') : o.agent_id === 'root')).map(o => [o.method, o]))
  for (const agent of [false, true]) {
    const m = by(agent)
    assert.deepEqual(m['branch.fork'].checkpoints.map(l => [l.effect, l.ref.branch_id, l.ref.commit_id, l.ref.version_kind]), [['referenced', 'feature-a', head('a'), 'Commit']])
    assert.deepEqual(m['file.write'].checkpoints.map(l => [l.effect, l.ref.commit_id]), [['created', head('b')]])
    assert.equal(m['file.write'].arguments.content_bytes, 5, 'stdin content is a body, measured not shown')
    assert.deepEqual(m['workspace.commit'].checkpoints.map(l => [l.effect, l.ref.store_id, l.ref.project_id, l.ref.branch_id, l.ref.commit_id]), [['created', 'simulation-001', 'website-001', 'feature-a', head('c')]])
    for (const method of ['workspace.mount', 'workspace.exec', 'workspace.unmount', 'file.read']) assert.deepEqual(m[method].checkpoints, [], `${method} carries no link`)
  }
  const detail = f.manager.detail(f.chat.id)
  const rootTools = detail.messages.filter(message => message.role === 'tool' && message.toolName === 'bash')
  assert.equal(rootTools.length, steps.length)
  assert.ok(rootTools.every(message => message.operations?.count === 1), 'each root bash step shows its one operation')
  assert.equal(rootTools.reduce((n, m) => n + m.operations.links, 0), 3)
  const child = f.manager.childConversation(f.chat.id, 'a01-feature')
  const childTools = child.messages.filter(message => message.role === 'tool' && message.toolName === 'bash')
  assert.equal(childTools.length, steps.length)
  assert.ok(childTools.every(message => message.operations?.count === 1), 'each child bash step shows its one operation')
  assert.equal(detail.persistence.portable, false)
  assert.equal(detail.persistence.local_only, 'simulation')
  await assert.rejects(agentRoute(f.manager, 'POST', ['sessions', f.chat.id, 'persistence'], { action: 'save' }), { status: 409 })
  const links = f.manager.versionLinks(project, head('c'))
  assert.equal(links.producers.length, 2, 'History finds both producing workspace commits')
})

test('simulation routes block model mutations and delegate parent/child Stop to the owning run', async t => {
  const f = await fixture(t), stopped = []
  f.manager.simulations = {
    get: () => ({ state: 'running' }),
    stop: async id => { stopped.push(id); await f.adapter.publishSession({ chatId: f.chat.id, state: 'idle' }); return { state: 'stopped' } },
  }
  for (const [method, suffix, body] of [
    ['POST', ['message'], { text: 'Use a paid model' }], ['POST', ['continue'], {}],
    ['POST', ['compact'], {}], ['POST', ['rollback'], {}], ['POST', ['fork'], {}],
    ['POST', ['permissions'], { mode: 'full' }], ['DELETE', [], {}],
  ]) await assert.rejects(agentRoute(f.manager, method, ['sessions', f.chat.id, ...suffix], body), { status: 409, code: 'ConnectBusy' })
  await assert.rejects(f.manager.open(f.chat.id), { status: 409 })
  assert.equal(f.manager.live.size, 0)
  const renamed = await agentRoute(f.manager, 'POST', ['sessions', f.chat.id, 'update'], { title: 'Catalog release' })
  assert.equal(renamed.title, 'Catalog release')
  await agentRoute(f.manager, 'POST', ['sessions', f.chat.id, 'stop'], {})
  await agentRoute(f.manager, 'POST', ['sessions', f.chat.id, 'children', 'a01-feature', 'stop'], {})
  assert.deepEqual(stopped, ['simulation-001', 'simulation-001'])
})

test('restart reconciliation preserves projected Pi histories and stops active children without model recovery', async t => {
  const f = await fixture(t)
  await executeTask(f, { chatId: f.chat.id, agentId: 'a01-feature', task: task('feature-1'), execute: async () => ({ head: 'confirmed-head' }) })
  await f.runtime.finishChat(f.chat.id)
  await f.runtime.publish(f.chat.id, 'idle')
  const before = f.manager.detail(f.chat.id)
  const file = join(f.state, 'chats', f.chat.id, 'chat.json')
  const persisted = JSON.parse(readFileSync(file, 'utf8'))
  persisted.state = 'running'
  persisted.children[0].state = 'running'
  writeFileSync(file, JSON.stringify(persisted))
  const restored = await f.open()
  restored.simulations = { get: () => ({ state: 'interrupted', error: 'Host stopped during simulation.' }) }
  reconcileSimulationChats(restored, restored.simulations)
  const after = restored.detail(f.chat.id)
  assert.equal(after.state, 'error')
  assert.equal(after.error, 'Host stopped during simulation.')
  assert.equal(after.execution.phase, 'error')
  assert.equal(after.recovery.required, false)
  assert.equal(after.children[0].state, 'stopped')
  assert.deepEqual(after.messages.map(message => [message.role, message.text]), before.messages.map(message => [message.role, message.text]))
  assert.ok(after.messages.every(message => !message.canRestore))
  const child = await agentRoute(restored, 'GET', ['sessions', f.chat.id, 'children', 'a01-feature'])
  assert.equal(child.messages.find(message => message.role === 'tool').details.receipt.head, 'confirmed-head')
  await assert.rejects(restored.open(f.chat.id), { status: 409 })
  assert.equal(restored.live.size, 0)
})

test('real pending main and child tools project as running until confirmed receipts arrive', async t => {
  const f = await fixture(t)
  for (const agentId of [null, 'a01-feature']) {
    let release, started
    const running = new Promise(resolve => { started = resolve })
    const gate = new Promise(resolve => { release = resolve })
    const read = () => agentId ? f.manager.childConversation(f.chat.id, agentId) : f.manager.detail(f.chat.id)
    const tool = () => read().messages.filter(message => message.role === 'tool' && message.toolName === 'bash').at(-1)
    const work = executeTask(f, { chatId: f.chat.id, agentId, task: task(`pending-${agentId ?? 'main'}`), execute: async () => { started(); await gate; return { head: 'confirmed-after-wait' } } })
    await running
    // The real Pi tool_start event has fired; publish its current saved projection.
    await f.runtime.publish(f.chat.id)
    try {
      assert.equal(tool().status, 'running', `${agentId ?? 'main'} missing receipt during execution is pending, not an error`)
    } finally { release(); await work }
    assert.equal(tool().status, 'done')
    assert.equal(tool().details.receipt.head, 'confirmed-after-wait')
  }
})

test('unopened planned conversations remain idle when an earlier real scripted conversation fails', async t => {
  const f = await fixture(t)
  const future = await f.adapter.createConversation({ title: 'Future release', project: 'simulation-001/website-001', runId: 'simulation-001', conversationId: 'c02-future' })
  const failed = new Error('Confirmed CLI failure before later objective starts.')
  await assert.rejects(executeTask(f, { chatId: f.chat.id, task: task('failed-before-future'), execute: async () => { throw failed } }), /Confirmed CLI failure/)
  // Match the runner's final publication for every planned conversation.
  for (const chatId of [f.chat.id, future.id]) await f.runtime.publish(chatId, 'idle', failed.message)
  const active = f.manager.detail(f.chat.id)
  assert.equal(active.state, 'error')
  assert.equal(active.execution.phase, 'error')
  assert.equal(active.error, failed.message)
  const unopened = f.manager.detail(future.id)
  assert.equal(unopened.state, 'idle', 'A planned objective with no Pi execution must not stay running after failure')
  assert.equal(unopened.execution.phase, 'idle')
  assert.equal(unopened.execution.startedAt, null)
  assert.equal(unopened.messages.length, 0)
  assert.equal(f.manager.record(future.id).sessionFile, null)
  assert.equal(f.runtime.sessions.has(`${future.id}/main`), false)
  assert.equal(f.manager.setupBusy().length, 0, 'Terminal run cannot leave model/settings busy through unopened objectives')
})
