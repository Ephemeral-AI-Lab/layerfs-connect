// Real Pi sessions and tools against a deterministic local provider. The model
// picks the next call; bash and pi-subagents perform the actual work.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after } from 'node:test'
import { AgentManager } from '../agents/index.js'
import { agentRoute } from '../agents/routes.js'
import { createHostServer, listen } from '../server.js'

// pi-subagents resolves its process-wide artifact root on first import, just
// as one desktop host keeps a single private state directory for its lifetime.
const sharedState = await mkdtemp(join(tmpdir(), 'connect-agent-state-'))
after(() => rm(sharedState, { recursive: true, force: true }))

const content = (value) => typeof value === 'string' ? value : (value ?? []).filter((part) => part.type === 'text').map((part) => part.text).join('\n')
const lastUser = (request) => content(request.messages.findLast((message) => message.role === 'user')?.content)
const hasResult = (request) => request.messages.at(-1)?.role === 'tool'
const bash = (command) => ({ tool: 'bash', args: { command } })

async function sendReply(res, request, answer) {
  const id = randomUUID()
  const chunk = (delta, finish_reason = null) => ({
    id, object: 'chat.completion.chunk', created: 1, model: request.model,
    choices: [{ index: 0, delta, finish_reason }],
  })
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  const delta = answer.tool
    ? { role: 'assistant', tool_calls: [{ index: 0, id: `call_${id}`, type: 'function', function: { name: answer.tool, arguments: JSON.stringify(answer.args) } }] }
    : { role: 'assistant', content: answer.text }
  res.write(`data: ${JSON.stringify(chunk(delta))}\n\n`)
  if (answer.pause) await new Promise((resolve) => setTimeout(resolve, answer.pause))
  res.write(`data: ${JSON.stringify({ ...chunk({}, answer.tool ? 'tool_calls' : 'stop'), usage: { prompt_tokens: 200, completion_tokens: 20, total_tokens: 220 } })}\n\n`)
  res.end('data: [DONE]\n\n')
}

async function fixture(t, respond) {
  const dir = await mkdtemp(join(tmpdir(), 'connect-agent-'))
  const state = sharedState
  const cwd = join(dir, 'work')
  await mkdir(cwd)
  const requests = []
  const events = []
  const cleanups = []
  let manager
  const originalAgentDir = process.env.PI_CODING_AGENT_DIR
  const server = createServer(async (req, res) => {
    let data = ''
    for await (const part of req) data += part
    const request = JSON.parse(data)
    requests.push(request)
    try {
      await sendReply(res, request, await respond(request, requests))
    } catch (error) {
      res.writeHead(500, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { message: error.message } }))
    }
  })
  t.after(async () => {
    for (const cleanup of cleanups) await cleanup()
    await manager?.close()
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
    await rm(dir, { recursive: true, force: true })
    if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR
    else process.env.PI_CODING_AGENT_DIR = originalAgentDir
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const open = async () => {
    manager = await AgentManager.create({ state, defaultCwd: cwd })
    manager.on('event', (event) => events.push(structuredClone(event)))
    return manager
  }
  await open()
  await manager.models.configure({ provider: 'connect-e2e', modelId: 'fixture-agent', api: 'openai-completions', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, apiKey: 'local-fixture-key' })
  return {
    cwd, state, requests, events, baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
    cleanup: (callback) => cleanups.push(callback),
    get manager() { return manager },
    async restart() {
      await manager.close()
      return open()
    },
  }
}

async function waitFor(manager, id, predicate, timeoutMs = 15_000) {
  const initial = manager.detail(id)
  if (predicate(initial)) return initial
  return new Promise((resolve, reject) => {
    const finish = (error, value) => {
      clearTimeout(timer)
      manager.off('event', check)
      if (error) reject(error)
      else resolve(value)
    }
    const check = () => {
      const detail = manager.detail(id)
      if (predicate(detail)) finish(null, detail)
    }
    const timer = setTimeout(() => finish(new Error(`Session did not reach expected state: ${JSON.stringify(manager.detail(id))}`)), timeoutMs)
    manager.on('event', check)
    check()
  })
}

const settled = (manager, id) => waitFor(manager, id, (session) => session.state !== 'running')
const toolNames = (request) => (request.tools ?? []).map((tool) => tool.function?.name ?? tool.name).sort()
const finalText = (session) => session.messages.filter((message) => message.role === 'assistant').at(-1)?.text
const parentTools = ['bash', 'bg_wait', 'subagent', 'subagent_supervisor']

test('Pi bash writes and reads files; follow-up and app restart retain the conversation', { timeout: 30_000 }, async (t) => {
  const f = await fixture(t, (request) => {
    if (hasResult(request)) return { text: `Completed: ${content(request.messages.at(-1).content)}` }
    if (lastUser(request).includes('WRITE_FIXTURE')) return bash("printf 'alpha\\n' > hello.txt; cat hello.txt")
    return bash('cat hello.txt')
  })
  const chat = await f.manager.create({ permissionMode: 'full' })
  await f.manager.message(chat.id, { text: 'WRITE_FIXTURE' })
  const first = await settled(f.manager, chat.id)
  assert.equal(first.state, 'idle', first.error)
  assert.equal(await readFile(join(f.cwd, 'hello.txt'), 'utf8'), 'alpha\n')
  assert.match(finalText(first), /alpha/)
  assert.deepEqual([...first.tools].sort(), parentTools)
  assert.ok(first.messages.some((message) => message.toolName === 'bash' && message.status === 'done'))
  await f.manager.message(chat.id, { text: 'READ_FIXTURE' })
  await settled(f.manager, chat.id)
  await f.restart()
  const restored = f.manager.detail(chat.id)
  assert.equal(restored.messages.filter((message) => message.role === 'user').length, 2)
  await f.manager.message(chat.id, { text: 'READ_AFTER_RESTART' })
  const resumed = await settled(f.manager, chat.id)
  assert.equal(resumed.messages.filter((message) => message.role === 'user').length, 3)
  assert.match(finalText(resumed), /alpha/)
  assert.ok(f.requests.every((request) => JSON.stringify(toolNames(request)) === JSON.stringify(parentTools)))
  assert.ok(f.events.some((event) => event.session.messages.some((message) => message.toolName === 'bash' && message.status === 'running')))
})

test('stop cancels a running bash process and the chat accepts another turn', { timeout: 30_000 }, async (t) => {
  const f = await fixture(t, (request) => {
    if (lastUser(request).includes('AFTER_STOP')) return { text: 'Ready again.' }
    if (hasResult(request)) return { text: 'The command ended.' }
    return bash('echo $$ > pid.txt; printf started > started.txt; echo STARTED; sleep 30; printf finished > finished.txt')
  })
  const chat = await f.manager.create({ permissionMode: 'full' })
  await f.manager.message(chat.id, { text: 'LONG_COMMAND' })
  await waitFor(f.manager, chat.id, (session) => session.messages.some((message) => message.toolName === 'bash' && message.status === 'running' && message.text.includes('STARTED')))
  assert.equal(await readFile(join(f.cwd, 'started.txt'), 'utf8'), 'started')
  const pid = Number(await readFile(join(f.cwd, 'pid.txt'), 'utf8'))
  await f.manager.message(chat.id, { text: 'DROP_THIS_QUEUED_MESSAGE' })
  const active = f.manager.live.get(chat.id)
  const stopChildren = active.extensions.stopChildren
  const childrenStopped = Promise.withResolvers()
  const finishStop = Promise.withResolvers()
  active.extensions.stopChildren = async () => {
    const result = await stopChildren()
    childrenStopped.resolve()
    await finishStop.promise
    return result
  }
  const stopping = f.manager.stop(chat.id)
  await childrenStopped.promise
  for (const mode of ['followUp', 'steer']) {
    await assert.rejects(f.manager.message(chat.id, { text: `DURING_STOP_${mode}`, mode }), { status: 409, code: 'stopping' })
  }
  finishStop.resolve()
  const stopped = await stopping
  assert.equal(stopped.state, 'idle')
  assert.equal(existsSync(join(f.cwd, 'finished.txt')), false)
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' })
  assert.ok(!stopped.messages.some((message) => message.text === 'DROP_THIS_QUEUED_MESSAGE'))
  assert.equal(active.session.pendingMessageCount, 0)
  await f.manager.message(chat.id, { text: 'AFTER_STOP' })
  assert.equal(finalText(await settled(f.manager, chat.id)), 'Ready again.')
  assert.ok(f.requests.every((request) => !JSON.stringify(request.messages).includes('DROP_THIS_QUEUED_MESSAGE')))
  assert.ok(f.requests.every((request) => !JSON.stringify(request.messages).includes('DURING_STOP_')))
})

test('a message awaiting model setup cannot restart the session after stop has finished', { timeout: 30_000 }, async (t) => {
  const f = await fixture(t, () => ({ text: 'READY' }))
  const chat = await f.manager.create({ permissionMode: 'full' })
  await f.manager.message(chat.id, { text: 'FIRST' })
  await settled(f.manager, chat.id)
  const active = f.manager.live.get(chat.id)
  const setModel = active.session.setModel.bind(active.session)
  const settingModel = Promise.withResolvers()
  const finishModel = Promise.withResolvers()
  active.session.setModel = async (model) => {
    settingModel.resolve()
    await finishModel.promise
    return setModel(model)
  }
  const message = f.manager.message(chat.id, { text: 'MUST_NOT_START_AFTER_STOP' })
  const rejected = assert.rejects(message, { status: 409, code: 'stopping' })
  await settingModel.promise
  assert.equal((await f.manager.stop(chat.id)).state, 'idle')
  finishModel.resolve()
  await rejected
  assert.equal(f.manager.detail(chat.id).state, 'idle')
  assert.equal(f.manager.detail(chat.id).error, null)
  assert.equal(f.requests.length, 1)
  assert.equal(active.session.pendingMessageCount, 0)
})

test('pi-subagents runs a real child with bash only, returns its output and restores its record', { timeout: 45_000 }, async (t) => {
  const f = await fixture(t, (request) => {
    const prompt = lastUser(request)
    if (prompt.includes('CHILD_WORK_FIXTURE')) {
      if (hasResult(request)) return { text: 'CHILD_FINISHED_FIXTURE' }
      return bash("printf 'child work' > child.txt; cat child.txt")
    }
    if (hasResult(request)) return { text: 'PARENT_FINISHED_FIXTURE' }
    return { tool: 'subagent', args: { agent: 'connect-worker', task: 'CHILD_WORK_FIXTURE', async: false } }
  })
  const chat = await f.manager.create({ permissionMode: 'full' })
  await f.manager.message(chat.id, { text: 'DELEGATE_FIXTURE' })
  const done = await settled(f.manager, chat.id)
  assert.equal(done.state, 'idle', done.error)
  assert.equal(await readFile(join(f.cwd, 'child.txt'), 'utf8'), 'child work')
  const call = done.messages.find((message) => message.toolName === 'subagent')
  assert.equal(call.status, 'done', call.text)
  assert.match(call.text, /CHILD_FINISHED_FIXTURE/)
  assert.equal(finalText(done), 'PARENT_FINISHED_FIXTURE')
  const childRequests = f.requests.filter((request) => lastUser(request).includes('CHILD_WORK_FIXTURE'))
  assert.ok(childRequests.length >= 2)
  assert.ok(childRequests.every((request) => JSON.stringify(toolNames(request)) === JSON.stringify(['bash', 'contact_supervisor'])))
  assert.ok(f.requests.every((request) => !toolNames(request).some((name) => ['read', 'write', 'edit'].includes(name))))
  assert.ok(done.children.some((child) => child.agent === 'connect-worker' && child.text.includes('CHILD_FINISHED_FIXTURE')))
  await f.restart()
  assert.deepEqual(f.manager.detail(chat.id).children, done.children)
})

test('a delegated lead can run a nested bash worker within the same tool boundary', { timeout: 30_000 }, async (t) => {
  const f = await fixture(t, (request) => {
    const tools = toolNames(request)
    if (!tools.includes('subagent')) {
      if (hasResult(request)) return { text: 'WORKER_NESTED_DONE' }
      return bash("printf 'nested worker' > nested.txt; cat nested.txt")
    }
    if (tools.includes('contact_supervisor')) {
      if (hasResult(request)) return { text: 'LEAD_NESTED_DONE' }
      return { tool: 'subagent', args: { agent: 'connect-worker', task: 'NESTED_WORKER', async: false } }
    }
    if (hasResult(request)) return { text: 'ROOT_NESTED_DONE' }
    return { tool: 'subagent', args: { agent: 'connect-lead', task: 'NESTED_LEAD', async: false } }
  })
  const chat = await f.manager.create({ permissionMode: 'full' })
  await f.manager.message(chat.id, { text: 'DELEGATE_NESTED' })
  const done = await settled(f.manager, chat.id)
  assert.equal(done.state, 'idle', done.error)
  assert.equal(await readFile(join(f.cwd, 'nested.txt'), 'utf8'), 'nested worker')
  assert.equal(finalText(done), 'ROOT_NESTED_DONE')
  assert.ok(done.children.some((child) => child.agent === 'connect-lead' && child.text.includes('LEAD_NESTED_DONE')))
  assert.ok(f.requests.some((request) => toolNames(request).includes('contact_supervisor') && toolNames(request).includes('subagent')))
  assert.ok(f.requests.every((request) => !toolNames(request).some((name) => ['read', 'write', 'edit'].includes(name))))
})

test('concurrent sessions keep their streamed messages, tool output and files separate', { timeout: 30_000 }, async (t) => {
  const f = await fixture(t, (request) => {
    const marker = lastUser(request).includes('SESSION_ALPHA') ? 'ALPHA' : 'BETA'
    if (hasResult(request)) return { text: `DONE_${marker}` }
    return bash(`printf '${marker}' > result.txt; cat result.txt`)
  })
  const alphaCwd = join(f.cwd, 'alpha')
  const betaCwd = join(f.cwd, 'beta')
  await Promise.all([mkdir(alphaCwd), mkdir(betaCwd)])
  const [alpha, beta] = await Promise.all([f.manager.create({ cwd: alphaCwd, permissionMode: 'full' }), f.manager.create({ cwd: betaCwd, permissionMode: 'full' })])
  await Promise.all([f.manager.message(alpha.id, { text: 'SESSION_ALPHA' }), f.manager.message(beta.id, { text: 'SESSION_BETA' })])
  const [a, b] = await Promise.all([settled(f.manager, alpha.id), settled(f.manager, beta.id)])
  assert.equal(finalText(a), 'DONE_ALPHA')
  assert.equal(finalText(b), 'DONE_BETA')
  assert.equal(await readFile(join(alphaCwd, 'result.txt'), 'utf8'), 'ALPHA')
  assert.equal(await readFile(join(betaCwd, 'result.txt'), 'utf8'), 'BETA')
  assert.ok(f.events.filter((event) => event.session.id === alpha.id).every((event) => !JSON.stringify(event.session.messages).includes('BETA')))
  assert.ok(f.events.filter((event) => event.session.id === beta.id).every((event) => !JSON.stringify(event.session.messages).includes('ALPHA')))
})

for (const mode of ['followUp', 'steer']) {
  test(`${mode} delivers a message during execution once, without losing the running turn`, { timeout: 30_000 }, async (t) => {
    const f = await fixture(t, (request) => {
      if (lastUser(request).includes('QUEUED_FIXTURE')) return { text: 'QUEUED_DONE' }
      if (hasResult(request)) return { text: 'FIRST_DONE' }
      return bash('echo STARTING; sleep 0.2; echo FIRST_TOOL_DONE')
    })
    const chat = await f.manager.create({ permissionMode: 'full' })
    await f.manager.message(chat.id, { text: 'START_FIRST' })
    await waitFor(f.manager, chat.id, (session) => session.messages.some((message) => message.toolName === 'bash' && message.status === 'running'))
    await f.manager.message(chat.id, { text: 'QUEUED_FIXTURE', mode })
    const done = await waitFor(f.manager, chat.id, (session) => session.state === 'idle' && finalText(session) === 'QUEUED_DONE')
    assert.equal(done.messages.filter((message) => message.role === 'user' && message.text === 'QUEUED_FIXTURE').length, 1)
    assert.ok(done.messages.some((message) => message.toolName === 'bash' && message.text.includes('FIRST_TOOL_DONE')))
    assert.equal(done.messages.some((message) => message.text === 'FIRST_DONE'), mode === 'followUp')
  })
}

test('pending follow-ups stay out of history; removing and steering preserve duplicate IDs and Pi extension messages', { timeout: 30_000 }, async (t) => {
  const started = Promise.withResolvers()
  const release = Promise.withResolvers()
  const f = await fixture(t, async (request) => {
    if (lastUser(request) === 'QUEUE_START') {
      started.resolve()
      await release.promise
    }
    return { text: `DONE_${lastUser(request)}` }
  })
  f.cleanup(() => release.resolve())
  const chat = await f.manager.create({ permissionMode: 'full' })
  await f.manager.message(chat.id, { text: 'QUEUE_START' })
  await started.promise
  const first = (await f.manager.message(chat.id, { text: 'DUPLICATE' })).queued[0]
  const second = (await f.manager.message(chat.id, { text: 'DUPLICATE' })).queued[1]
  const removed = (await f.manager.message(chat.id, { text: 'NEVER_SEND' })).queued[2]
  await f.manager.message(chat.id, { text: 'QUEUE_TAIL' })
  const active = f.manager.live.get(chat.id)
  const modes = [active.session.agent.steeringMode, active.session.agent.followUpMode]
  await active.session.sendCustomMessage({ customType: 'queue-fixture', content: 'EXTENSION_MESSAGE', display: true }, { deliverAs: 'followUp', triggerTurn: true })
  const route = (method, entry, body = {}) => agentRoute(f.manager, method, ['sessions', chat.id, 'queue', entry.id], body)
  await assert.rejects(route('POST', second), { status: 400 })
  const deleted = await route('DELETE', removed)
  assert.ok(!deleted.queued.some((entry) => entry.id === removed.id))
  const promoted = await route('POST', second, { mode: 'steer' })
  assert.deepEqual(promoted.queued.slice(0, 2), [{ ...first, mode: 'followUp' }, { ...second, mode: 'steer' }])
  assert.deepEqual([active.session.agent.steeringMode, active.session.agent.followUpMode], modes)
  assert.deepEqual(promoted.messages.filter((message) => message.role === 'user').map((message) => message.text), ['QUEUE_START'])
  f.manager.save(chat.id)
  const saved = JSON.parse(await readFile(join(f.state, 'chats', chat.id, 'chat.json'), 'utf8'))
  assert.ok(!JSON.stringify(saved.messages).includes('DUPLICATE'))
  assert.equal(Object.hasOwn(saved, 'queued'), false)
  release.resolve()
  const done = await settled(f.manager, chat.id)
  assert.deepEqual(done.queued, [])
  assert.deepEqual(done.messages.filter((message) => message.role === 'user').map((message) => message.text), ['QUEUE_START', 'DUPLICATE', 'DUPLICATE', 'QUEUE_TAIL'])
  assert.ok(done.messages.some((message) => message.text === 'EXTENSION_MESSAGE'))
  assert.ok(f.events.some(({ session }) => session.messages.some((message) => message.role === 'user' && message.text === 'DUPLICATE') && session.queued.some((entry) => entry.id === first.id) && !session.queued.some((entry) => entry.id === second.id)), 'Steering consumes the promoted duplicate before its equal follow-up.')
  assert.ok(f.requests.every((request) => !JSON.stringify(request.messages).includes('NEVER_SEND')))
  assert.deepEqual(f.requests.map(lastUser), ['QUEUE_START', 'DUPLICATE', 'DUPLICATE', 'QUEUE_TAIL', 'EXTENSION_MESSAGE'])
  await assert.rejects(route('DELETE', first), { status: 409 })
})

test('removing one of two equal follow-ups leaves only the other message for Pi', { timeout: 30_000 }, async (t) => {
  const started = Promise.withResolvers()
  const release = Promise.withResolvers()
  const f = await fixture(t, async (request) => {
    if (lastUser(request) === 'WAIT_FOR_REMOVAL') {
      started.resolve()
      await release.promise
    }
    return { text: 'QUEUE_DONE' }
  })
  f.cleanup(() => release.resolve())
  const chat = await f.manager.create({ permissionMode: 'full' })
  await f.manager.message(chat.id, { text: 'WAIT_FOR_REMOVAL' })
  await started.promise
  const first = (await f.manager.message(chat.id, { text: 'SAME_MESSAGE' })).queued[0]
  const second = (await f.manager.message(chat.id, { text: 'SAME_MESSAGE' })).queued[1]
  assert.deepEqual((await f.manager.updateQueued(chat.id, first.id)).queued, [second])
  release.resolve()
  const done = await settled(f.manager, chat.id)
  assert.equal(done.messages.filter((message) => message.text === 'SAME_MESSAGE').length, 1)
  assert.deepEqual(f.requests.map(lastUser), ['WAIT_FOR_REMOVAL', 'SAME_MESSAGE'])
})

test('messages arriving during and just after Pi settlement continue automatically', { timeout: 30_000 }, async (t) => {
  const f = await fixture(t, (request) => ({ text: `DONE_${lastUser(request)}` }))
  const chat = await f.manager.create({ permissionMode: 'full' })
  const active = await f.manager.open(chat.id)
  const runner = active.session.extensionRunner
  const emit = runner.emit.bind(runner)
  let injected = false
  runner.emit = async (event) => {
    if (event.type === 'agent_settled' && !injected) {
      injected = true
      const queued = await f.manager.message(chat.id, { text: 'DURING_SETTLEMENT' })
      assert.equal(queued.queued[0].text, 'DURING_SETTLEMENT')
    }
    return emit(event)
  }
  await f.manager.message(chat.id, { text: 'BEFORE_SETTLEMENT' })
  const done = await settled(f.manager, chat.id)
  assert.equal(finalText(done), 'DONE_DURING_SETTLEMENT')
  assert.deepEqual(done.queued, [])
  await f.manager.message(chat.id, { text: 'AFTER_SETTLEMENT' })
  assert.equal(finalText(await settled(f.manager, chat.id)), 'DONE_AFTER_SETTLEMENT')
  injected = false
  await active.session.sendCustomMessage({ customType: 'queue-fixture', content: 'EXTENSION_WAKE', display: true }, { triggerTurn: true })
  assert.equal(finalText(await settled(f.manager, chat.id)), 'DONE_DURING_SETTLEMENT')
  assert.deepEqual(f.requests.map(lastUser), ['BEFORE_SETTLEMENT', 'DURING_SETTLEMENT', 'AFTER_SETTLEMENT', 'EXTENSION_WAKE', 'DURING_SETTLEMENT'])
})

test('follow-up input interrupts Pi bg_wait while its background child is still running', { timeout: 30_000 }, async (t) => {
  const f = await fixture(t, (request) => {
    if (!toolNames(request).includes('subagent')) return hasResult(request) ? { text: 'WAITING_CHILD_FINISHED' } : bash('echo $$ > wait-child.pid; sleep 30')
    if (lastUser(request) === 'INTERRUPT_WAIT') return { text: 'FOLLOWUP_INTERRUPTED_WAIT' }
    const called = request.messages.flatMap((message) => message.tool_calls ?? []).map((call) => call.function.name)
    if (!called.includes('subagent')) return { tool: 'subagent', args: { agent: 'connect-worker', task: 'WAITING_CHILD', async: true } }
    if (!called.includes('bg_wait')) return { tool: 'bg_wait', args: { all: true } }
    return { text: 'FIRST_WAIT_ENDED' }
  })
  const chat = await f.manager.create({ permissionMode: 'full' })
  await f.manager.message(chat.id, { text: 'START_BACKGROUND_WAIT' })
  await waitFor(f.manager, chat.id, (session) => session.messages.some((message) => message.toolName === 'bg_wait' && message.status === 'running' && message.text))
  const pidFile = join(f.cwd, 'wait-child.pid')
  const deadline = Date.now() + 5000
  while (!existsSync(pidFile) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25))
  assert.ok(existsSync(pidFile), 'The background child must start before testing interruption.')
  const pid = Number(await readFile(pidFile, 'utf8'))
  await f.manager.message(chat.id, { text: 'INTERRUPT_WAIT' })
  const done = await waitFor(f.manager, chat.id, (session) => finalText(session) === 'FOLLOWUP_INTERRUPTED_WAIT', 3000)
  process.kill(pid, 0)
  assert.ok(done.messages.some((message) => message.toolName === 'bg_wait' && message.status === 'done'))
  await f.manager.stop(chat.id)
})

test('model setup failure clears a follow-up accepted while setup was pending', { timeout: 30_000 }, async (t) => {
  const f = await fixture(t, () => ({ text: 'SETUP_RECOVERED' }))
  const chat = await f.manager.create({ permissionMode: 'full' })
  const active = await f.manager.open(chat.id)
  const setModel = active.session.setModel.bind(active.session)
  const started = Promise.withResolvers()
  const release = Promise.withResolvers()
  active.session.setModel = async () => {
    started.resolve()
    await release.promise
    throw new Error('Fixture setup failed')
  }
  const starting = f.manager.message(chat.id, { text: 'SETUP_WILL_FAIL' })
  const rejected = assert.rejects(starting, /Fixture setup failed/)
  await started.promise
  await f.manager.message(chat.id, { text: 'DROP_AFTER_SETUP_FAILURE' })
  release.resolve()
  await rejected
  assert.deepEqual(f.manager.detail(chat.id).queued, [])
  assert.equal(active.session.agent.hasQueuedMessages(), false)
  active.session.setModel = setModel
  await f.manager.message(chat.id, { text: 'AFTER_SETUP_FAILURE' })
  assert.equal(finalText(await settled(f.manager, chat.id)), 'SETUP_RECOVERED')
  assert.ok(f.requests.every((request) => !JSON.stringify(request.messages).includes('DROP_AFTER_SETUP_FAILURE')))
})

test('a failed Pi response clears pending follow-ups before another turn starts', { timeout: 30_000 }, async (t) => {
  const started = Promise.withResolvers()
  const release = Promise.withResolvers()
  const f = await fixture(t, async (request) => {
    if (lastUser(request) === 'FAIL_WITH_QUEUE') {
      started.resolve()
      await release.promise
      throw new Error('Deterministic provider failure')
    }
    return { text: 'RECOVERED_AFTER_FAILURE' }
  })
  f.cleanup(() => release.resolve())
  const chat = await f.manager.create({ permissionMode: 'full' })
  await f.manager.message(chat.id, { text: 'FAIL_WITH_QUEUE' })
  await started.promise
  await f.manager.message(chat.id, { text: 'DROP_ON_FAILURE' })
  release.resolve()
  const failed = await settled(f.manager, chat.id)
  assert.equal(failed.state, 'error')
  assert.deepEqual(failed.queued, [])
  assert.equal(f.manager.live.get(chat.id).session.agent.hasQueuedMessages(), false)
  await f.manager.message(chat.id, { text: 'AFTER_FAILURE' })
  assert.equal(finalText(await settled(f.manager, chat.id)), 'RECOVERED_AFTER_FAILURE')
  assert.ok(f.requests.every((request) => !JSON.stringify(request.messages).includes('DROP_ON_FAILURE')))
})

test('background subagents finish through Pi completion wakes and retain their results', { timeout: 40_000 }, async (t) => {
  const f = await fixture(t, (request) => {
    if (!toolNames(request).includes('subagent')) {
      if (hasResult(request)) return { text: 'ASYNC_CHILD_COMPLETE' }
      return bash("printf 'async child' > async.txt; cat async.txt")
    }
    const delegated = request.messages.some((message) => message.tool_calls?.some((call) => call.function.name === 'subagent'))
    if (!delegated) return { tool: 'subagent', args: { agent: 'connect-worker', task: 'ASYNC_CHILD_TASK', async: true } }
    return { text: hasResult(request) ? 'PARENT_WAITING' : 'ASYNC_PARENT_COMPLETE' }
  })
  const chat = await f.manager.create({ permissionMode: 'full' })
  await f.manager.message(chat.id, { text: 'DELEGATE_ASYNC' })
  const done = await waitFor(f.manager, chat.id, (session) => session.state === 'idle' && finalText(session) === 'ASYNC_PARENT_COMPLETE', 25_000)
  assert.equal(await readFile(join(f.cwd, 'async.txt'), 'utf8'), 'async child')
  assert.ok(done.children.some((child) => child.text?.includes('ASYNC_CHILD_COMPLETE')), JSON.stringify(done.children))
  assert.ok(f.requests.every((request) => !toolNames(request).some((name) => ['read', 'write', 'edit'].includes(name))))
  await f.restart()
  assert.deepEqual(f.manager.detail(chat.id).children, done.children)
})

test('stop terminates the running background child and its bash process', { timeout: 30_000 }, async (t) => {
  const f = await fixture(t, (request) => {
    if (!toolNames(request).includes('subagent')) {
      if (hasResult(request)) return { text: 'The child command ended.' }
      return bash('echo $$ > child-pid.txt; echo STARTED; sleep 30; printf unwanted > child-finished.txt')
    }
    const delegated = request.messages.some((message) => message.tool_calls?.some((call) => call.function.name === 'subagent'))
    return delegated ? { text: 'PARENT_WAITING' } : { tool: 'subagent', args: { agent: 'connect-worker', task: 'CHILD_LONG_TASK', async: true } }
  })
  const chat = await f.manager.create({ permissionMode: 'full' })
  await f.manager.message(chat.id, { text: 'DELEGATE_LONG_ASYNC' })
  const pidFile = join(f.cwd, 'child-pid.txt')
  const deadline = Date.now() + 10_000
  while (!existsSync(pidFile) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25))
  assert.ok(existsSync(pidFile), 'The child must really start before cancellation.')
  const pid = Number(await readFile(pidFile, 'utf8'))
  const stopped = await f.manager.stop(chat.id)
  assert.equal(stopped.state, 'idle', stopped.error)
  assert.equal(stopped.error, null)
  assert.equal(existsSync(join(f.cwd, 'child-finished.txt')), false)
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' })
  assert.ok(stopped.children.every((child) => !['running', 'queued'].includes(child.state)), JSON.stringify(stopped.children))
})

test('HTTP model configuration, chat routes and SSE expose real Pi execution and restored history', { timeout: 30_000 }, async (t) => {
  const f = await fixture(t, (request) => hasResult(request) ? { text: 'HTTP_COMPLETE', pause: 100 } : bash("printf 'through http' > http.txt; cat http.txt"))
  const token = 'test-local-host-token'
  const host = createHostServer({ token, projects: {}, agents: () => f.manager })
  const url = await listen(host)
  t.after(() => new Promise((resolve) => host.close(resolve)))
  const call = async (path, method = 'GET', body) => {
    const response = await fetch(`${url}/api/agent/${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const answer = await response.json()
    assert.equal(response.status, 200, JSON.stringify(answer))
    return answer
  }
  const config = await call('models', 'POST', { provider: 'connect-e2e', modelId: 'fixture-agent', api: 'openai-completions', baseUrl: f.baseUrl, apiKey: 'http-test-secret' })
  assert.equal(config.selected.modelId, 'fixture-agent')
  assert.equal(JSON.stringify(config).includes('http-test-secret'), false)
  const stream = await fetch(`${url}/api/events?token=${token}`, { signal: AbortSignal.timeout(15_000) })
  assert.equal(stream.status, 200)
  const reader = stream.body.getReader()
  const received = []
  const completion = (async () => {
    const decoder = new TextDecoder()
    let pending = ''
    while (true) {
      const { value, done } = await reader.read()
      if (done) throw new Error('Event stream ended before the chat completed.')
      pending += decoder.decode(value, { stream: true })
      const frames = pending.split('\n\n')
      pending = frames.pop()
      for (const frame of frames) {
        const data = frame.split('\n').find((line) => line.startsWith('data: '))
        if (!data) continue
        const event = JSON.parse(data.slice(6))
        received.push(event)
        if (event.type === 'chat' && event.session.state === 'idle' && finalText(event.session) === 'HTTP_COMPLETE') return event.session
      }
    }
  })()
  const chat = await call('sessions', 'POST', { cwd: f.cwd, permissionMode: 'full' })
  await call(`sessions/${chat.id}/message`, 'POST', { text: 'HTTP_FIXTURE' })
  const completed = await completion
  await reader.cancel()
  assert.equal(completed.id, chat.id)
  assert.ok(received.some((event) => event.type === 'chat' && event.session.state === 'running'))
  assert.ok(received.some((event) => event.type === 'chat' && event.session.messages.some((message) => message.role === 'assistant' && message.status === 'running' && message.text === 'HTTP_COMPLETE')))
  assert.ok(received.some((event) => event.type === 'chat' && event.session.messages.some((message) => message.toolName === 'bash' && message.status === 'done')))
  assert.equal(await readFile(join(f.cwd, 'http.txt'), 'utf8'), 'through http')
  await f.restart()
  const restored = await call(`sessions/${chat.id}`)
  assert.equal(finalText(restored), 'HTTP_COMPLETE')
  assert.ok((await call('sessions')).some((entry) => entry.id === chat.id))
})

test('manual compaction persists a real Pi summary and the next turn receives that context', { timeout: 30_000 }, async (t) => {
  const summary = 'COMPACTION_FIXTURE_SUMMARY: the earlier task chose alpha.'
  const f = await fixture(t, (request) => {
    if (!request.tools?.length) return { text: summary }
    if (lastUser(request).includes('FIRST_CONTEXT')) return { text: 'The selected value is alpha.' }
    if (lastUser(request).includes('RECENT_CONTEXT')) return { text: 'Recent evidence. '.repeat(6000) }
    return { text: 'CONTINUED_AFTER_COMPACTION' }
  })
  const chat = await f.manager.create({ permissionMode: 'full' })
  await f.manager.message(chat.id, { text: 'FIRST_CONTEXT' })
  const first = await settled(f.manager, chat.id)
  assert.equal(finalText(first), 'The selected value is alpha.')
  assert.ok(first.contextUsage.tokens > 0)
  assert.deepEqual(first.contextUsage, f.manager.live.get(chat.id).session.getContextUsage())
  await f.manager.message(chat.id, { text: 'RECENT_CONTEXT' })
  const recent = finalText(await settled(f.manager, chat.id))
  assert.ok(recent.length > 80_000, JSON.stringify({ text: recent.slice(0, 100), length: recent.length, requests: f.requests.map((request) => ({ user: lastUser(request).slice(0, 400), tools: toolNames(request) })) }))
  const compacted = await f.manager.compact(chat.id)
  assert.ok(compacted.messages.some((message) => message.role === 'assistant' && message.text.includes(`### Compacted context\n\n${summary}`)))
  assert.deepEqual(compacted.contextUsage, { tokens: null, contextWindow: first.contextUsage.contextWindow, percent: null })
  const record = JSON.parse(await readFile(join(f.state, 'chats', chat.id, 'chat.json'), 'utf8'))
  assert.equal(Object.hasOwn(record, 'contextUsage'), false, 'Context usage must be computed from the live Pi projection, not persisted.')
  const entries = (await readFile(record.sessionFile, 'utf8')).trim().split('\n').map((line) => JSON.parse(line))
  assert.ok(entries.some((entry) => entry.type === 'compaction' && entry.summary.includes(summary)))
  await f.restart()
  assert.ok(f.manager.detail(chat.id).messages.some((message) => message.text.includes(summary)))
  assert.equal(f.manager.detail(chat.id).contextUsage, null, 'An unopened restored session has unknown context usage.')
  await f.manager.open(chat.id)
  assert.deepEqual(f.manager.detail(chat.id).contextUsage, compacted.contextUsage)
  await f.manager.message(chat.id, { text: 'CONTINUE_CONTEXT' })
  const continued = await settled(f.manager, chat.id)
  assert.equal(finalText(continued), 'CONTINUED_AFTER_COMPACTION')
  assert.ok(continued.contextUsage.tokens > 0)
  assert.deepEqual(continued.contextUsage, f.manager.live.get(chat.id).session.getContextUsage())
  assert.ok(JSON.stringify(f.requests.at(-1).messages).includes(summary))
})

test('a failed session can be deleted after restarting without reopening its missing model', { timeout: 30_000 }, async (t) => {
  const f = await fixture(t, () => ({ text: 'Unused provider reply.' }))
  const chat = await f.manager.create({ provider: 'missing-provider', modelId: 'missing-model', permissionMode: 'full' })
  await assert.rejects(f.manager.message(chat.id, { text: 'START_FAILED_SESSION' }), /Unknown model/)
  assert.equal(f.manager.detail(chat.id).state, 'error')
  await f.restart()
  const restored = f.manager.detail(chat.id)
  assert.equal(restored.state, 'error')
  assert.match(restored.error, /Unknown model/)
  assert.deepEqual(await f.manager.remove(chat.id), { id: chat.id })
  assert.ok(!f.manager.list().some((record) => record.id === chat.id))
  assert.equal(existsSync(join(f.state, 'chats', chat.id)), false)
  assert.equal(f.requests.length, 0)
})

test('completed history can be stopped and deleted after its provider is removed and the app restarts', { timeout: 30_000 }, async (t) => {
  const f = await fixture(t, () => ({ text: 'COMPLETED_HISTORY' }))
  const chat = await f.manager.create({ permissionMode: 'full' })
  await f.manager.message(chat.id, { text: 'FINISH_THIS_CHAT' })
  assert.equal(finalText(await settled(f.manager, chat.id)), 'COMPLETED_HISTORY')
  await f.restart()
  await f.manager.models.removeProvider('connect-e2e')
  await f.restart()
  assert.throws(() => f.manager.models.resolve(f.manager.record(chat.id)), /Unknown model/)
  assert.ok(f.manager.record(chat.id).sessionFile)
  assert.equal((await f.manager.stop(chat.id)).state, 'idle')
  assert.equal(f.manager.live.has(chat.id), false)
  assert.deepEqual(await f.manager.remove(chat.id), { id: chat.id })
  assert.equal(existsSync(join(f.state, 'chats', chat.id)), false)
  assert.equal(f.requests.length, 1)
})

test('deleting a session blocks new messages through extension shutdown and preserves workspace files', { timeout: 30_000 }, async (t) => {
  const f = await fixture(t, () => ({ text: 'COMPLETED_HISTORY' }))
  const chat = await f.manager.create({ permissionMode: 'full' })
  await f.manager.message(chat.id, { text: 'FINISH_THIS_CHAT' })
  await settled(f.manager, chat.id)
  const workspaceFile = join(f.cwd, 'keep.txt')
  await writeFile(workspaceFile, 'Keep this project file.')
  const active = f.manager.live.get(chat.id)
  const runner = active.session.extensionRunner
  const emit = runner.emit.bind(runner)
  const shutdownStarted = Promise.withResolvers()
  const finishShutdown = Promise.withResolvers()
  let promptCalls = 0
  const prompt = active.session.prompt.bind(active.session)
  active.session.prompt = (...args) => { promptCalls++; return prompt(...args) }
  runner.emit = async (event) => {
    if (event.type === 'session_shutdown') {
      shutdownStarted.resolve()
      await finishShutdown.promise
    }
    return emit(event)
  }
  const deleting = f.manager.remove(chat.id)
  try {
    await shutdownStarted.promise
    for (const mode of [undefined, 'followUp', 'steer']) {
      await assert.rejects(f.manager.message(chat.id, { text: 'MUST_NOT_START_DURING_DELETE', mode }), { status: 409, code: 'stopping' })
    }
    await assert.rejects(f.manager.remove(chat.id), { status: 409, message: 'The session is being deleted.' })
    const stopping = f.manager.stopping.get(chat.id)
    assert.equal(f.manager.stop(chat.id), stopping.task, 'Repeated stop must reuse the deletion stop barrier.')
    assert.equal((await f.manager.stop(chat.id)).state, 'idle')
    assert.equal(promptCalls, 0)
    assert.equal(f.requests.length, 1)
  } finally {
    finishShutdown.resolve()
    await deleting
    runner.emit = emit
    active.session.prompt = prompt
  }
  assert.equal(existsSync(join(f.state, 'chats', chat.id)), false)
  assert.equal(await readFile(workspaceFile, 'utf8'), 'Keep this project file.')
})

test('a message awaiting model setup cannot restart a deleted session', { timeout: 30_000 }, async (t) => {
  const f = await fixture(t, () => ({ text: 'COMPLETED_HISTORY' }))
  const chat = await f.manager.create({ permissionMode: 'full' })
  await f.manager.message(chat.id, { text: 'FINISH_THIS_CHAT' })
  await settled(f.manager, chat.id)
  const active = f.manager.live.get(chat.id)
  const settingModel = Promise.withResolvers()
  const finishModel = Promise.withResolvers()
  active.session.setModel = async () => {
    settingModel.resolve()
    await finishModel.promise
  }
  let promptCalls = 0
  active.session.prompt = async () => { promptCalls++ }
  const message = f.manager.message(chat.id, { text: 'MUST_NOT_START_AFTER_DELETE' })
  const rejected = assert.rejects(message, { status: 409, code: 'stopping' })
  try {
    await settingModel.promise
    assert.deepEqual(await f.manager.remove(chat.id), { id: chat.id })
  } finally {
    finishModel.resolve()
    await rejected
  }
  assert.equal(promptCalls, 0)
  assert.equal(f.requests.length, 1)
  assert.equal(existsSync(join(f.state, 'chats', chat.id)), false)
})

test('a failed deletion releases its shutdown barrier so the session can continue and deletion can retry', { timeout: 30_000 }, async (t) => {
  const f = await fixture(t, () => ({ text: 'COMPLETED_HISTORY' }))
  const chat = await f.manager.create({ permissionMode: 'full' })
  await f.manager.message(chat.id, { text: 'FINISH_THIS_CHAT' })
  await settled(f.manager, chat.id)
  const runner = f.manager.live.get(chat.id).session.extensionRunner
  const emit = runner.emit.bind(runner)
  runner.emit = async (event) => {
    if (event.type === 'session_shutdown') throw new Error('Fixture shutdown failed.')
    return emit(event)
  }
  try {
    await assert.rejects(f.manager.remove(chat.id), /Fixture shutdown failed/)
    assert.ok(existsSync(join(f.state, 'chats', chat.id)))
    await f.manager.message(chat.id, { text: 'CONTINUE_AFTER_DELETE_FAILURE' })
    assert.equal(finalText(await settled(f.manager, chat.id)), 'COMPLETED_HISTORY')
    assert.equal(f.requests.length, 2)
  } finally {
    runner.emit = emit
  }
  assert.deepEqual(await f.manager.remove(chat.id), { id: chat.id })
  assert.equal(existsSync(join(f.state, 'chats', chat.id)), false)
})

test('deleting a session retains its history and recovery obligation when child termination is unconfirmed', { timeout: 30_000 }, async (t) => {
  const f = await fixture(t, () => ({ text: 'COMPLETED_PARENT' }))
  const chat = await f.manager.create({ permissionMode: 'full' })
  await f.manager.message(chat.id, { text: 'FINISH_PARENT' })
  await settled(f.manager, chat.id)
  const extensions = f.manager.live.get(chat.id).extensions
  const stopChildren = extensions.stopChildren
  extensions.stopChildren = async () => ({ requested: ['unobserved-child'], pending: ['unobserved-child'], errors: [] })
  try {
    await assert.rejects(f.manager.remove(chat.id), { status: 409, message: 'Subagent stop incomplete: unobserved-child' })
    const saved = JSON.parse(await readFile(join(f.state, 'chats', chat.id, 'chat.json'), 'utf8'))
    assert.equal(saved.needsStop, true)
    assert.equal(saved.state, 'error')
    assert.ok(saved.messages.some((message) => message.text === 'COMPLETED_PARENT'))
    assert.equal('needsStop' in f.manager.detail(chat.id), false)
  } finally {
    extensions.stopChildren = stopChildren
  }
  assert.deepEqual(await f.manager.remove(chat.id), { id: chat.id })
  assert.equal(existsSync(join(f.state, 'chats', chat.id)), false)
})

for (const recovery of ['interrupted parent without child cards', 'paused child card']) {
  test(`restart stops orphan processes and retains unconfirmed history with ${recovery}`, { timeout: 45_000 }, async (t) => {
    const f = await fixture(t, (request) => {
      if (!toolNames(request).includes('subagent')) {
        if (hasResult(request)) return { text: 'ORPHAN_CHILD_STOPPED' }
        return bash('echo $$ > orphan-pid.txt; echo $PPID > orphan-writer-pid.txt; sleep 30 & echo $! > orphan-sleep-pid.txt; wait; printf unwanted > orphan-finished.txt')
      }
      const delegated = request.messages.some((message) => message.tool_calls?.some((call) => call.function.name === 'subagent'))
      return delegated ? { text: 'ORPHAN_PARENT_WAITING' } : { tool: 'subagent', args: { agent: 'connect-worker', task: 'ORPHAN_LONG_TASK', async: true } }
    })
    const source = `
      import { AgentManager } from ${JSON.stringify(new URL('../agents/index.js', import.meta.url).href)};
      const manager = await AgentManager.create(${JSON.stringify({ state: f.state, defaultCwd: f.cwd })});
      const chat = await manager.create({ permissionMode: 'full' });
      await manager.message(chat.id, { text: 'ORPHAN_ASYNC_TASK' });
      process.send({ id: chat.id });
      setInterval(() => {}, 1000);
    `
    const host = spawn(process.execPath, ['--input-type=module', '-e', source], { cwd: f.cwd, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] })
    let hostErrors = ''
    host.stderr.on('data', (data) => { hostErrors += data })
    let pid
    let sleepPid
    let writerPid
    let runnerPid
    let chatId
    f.cleanup(async () => {
      if (host.exitCode === null && host.signalCode === null) host.kill('SIGKILL')
      for (const childPid of [pid, sleepPid, writerPid, runnerPid].filter(Boolean)) {
        try { process.kill(childPid, 'SIGKILL') } catch (error) { if (error.code !== 'ESRCH') throw error }
      }
      // This is fixture disposal only. The application must retain the record
      // because Pi cannot reconstruct a crashed launcher's close observation.
      const active = f.manager.live.get(chatId)
      if (active) {
        await active.childRefresh
        await active.session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' })
        active.session.dispose()
        f.manager.live.delete(chatId)
      }
      if (chatId) {
        f.manager.permissions.forget(chatId)
        f.manager.records.delete(chatId)
        await rm(join(f.state, 'chats', chatId), { recursive: true, force: true })
      }
    })
    const [chat] = await Promise.race([
      once(host, 'message'),
      once(host, 'exit').then(() => { throw new Error(`Fixture host exited: ${hostErrors}`) }),
    ])
    chatId = chat.id
    const pidFile = join(f.cwd, 'orphan-pid.txt')
    const sleepPidFile = join(f.cwd, 'orphan-sleep-pid.txt')
    const deadline = Date.now() + 10_000
    while (!existsSync(sleepPidFile) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25))
    assert.ok(existsSync(sleepPidFile), `The detached child must start before its host crashes. ${hostErrors}`)
    pid = Number(await readFile(pidFile, 'utf8'))
    sleepPid = Number(await readFile(sleepPidFile, 'utf8'))
    writerPid = Number(await readFile(join(f.cwd, 'orphan-writer-pid.txt'), 'utf8'))
    process.kill(pid, 0)
    const hostExited = once(host, 'exit')
    host.kill('SIGKILL')
    await hostExited
    process.kill(pid, 0)

    const file = join(f.state, 'chats', chat.id, 'chat.json')
    const saved = JSON.parse(await readFile(file, 'utf8'))
    const runId = saved.children[0]?.runId
    assert.ok(runId)
    const run = JSON.parse(await readFile(join(f.state, 'pi', 'subagents', 'async-subagent-runs', runId, 'status.json'), 'utf8'))
    runnerPid = run.pid
    assert.ok(Number.isInteger(runnerPid) && runnerPid > 0)
    if (recovery.startsWith('interrupted')) {
      saved.state = 'running'
      saved.children = []
    } else {
      assert.ok(saved.children.length)
      saved.state = 'idle'
      saved.children = saved.children.map((child) => ({ ...child, state: 'paused' }))
    }
    await writeFile(file, JSON.stringify(saved))
    await f.restart()
    const restored = f.manager.detail(chat.id)
    assert.equal(restored.state, 'idle')
    assert.equal('needsStop' in restored, false)
    if (recovery.startsWith('interrupted')) {
      f.manager.save(chat.id)
      assert.equal(JSON.parse(await readFile(file, 'utf8')).needsStop, true)
    }
    await assert.rejects(f.manager.stop(chat.id), { status: 409, message: `Subagent stop incomplete: ${runId}` })
    const stopped = f.manager.detail(chat.id)
    assert.match(stopped.error, /Subagent stop incomplete/)
    assert.equal(stopped.state, 'error')
    for (const childPid of [pid, sleepPid, writerPid, runnerPid]) {
      assert.throws(() => process.kill(childPid, 0), { code: 'ESRCH' }, `Fixture process ${childPid} must actually exit.`)
    }
    assert.equal(existsSync(join(f.cwd, 'orphan-finished.txt')), false)
    assert.ok(stopped.children.every((child) => !['running', 'queued', 'pending', 'paused'].includes(child.state)))
    assert.equal(JSON.parse(await readFile(file, 'utf8')).needsStop, true)
    await assert.rejects(f.manager.remove(chat.id), { status: 409, message: `Subagent stop incomplete: ${runId}` })
    assert.ok(existsSync(file), 'Unconfirmed process exit must keep the conversation available for recovery.')
  })
}

test('capabilities group tools and hooks by extension and match a live chat', { timeout: 30_000 }, async (t) => {
  const f = await fixture(t, () => ({ text: 'ok' }))
  const chat = await f.manager.create({ permissionMode: 'full' })
  const configured = f.manager.capabilities(chat.id)
  assert.equal(configured.live, false)
  await f.manager.open(chat.id)
  const live = f.manager.capabilities()
  assert.equal(live.live, true)
  // pi-subagents loads as an extension of its own; the run guard stays hidden
  assert.deepEqual(live.extensions.map((extension) => [extension.id, extension.enabled]), [['layerfs-connect', true], ['pi-subagents', true]])
  assert.deepEqual(live.extensions.map((extension) => extension.tools), [['bash'], ['subagent', 'bg_wait', 'subagent_supervisor', 'contact_supervisor']])
  assert.ok(live.extensions[0].version && live.extensions[1].version)
  // the configured view (no chat open) says what a live chat reports
  for (const id of ['layerfs-connect', 'pi-subagents']) {
    assert.deepEqual(live.hooks.filter((hook) => hook.extension === id).map((hook) => hook.event).sort(), configured.hooks.filter((hook) => hook.extension === id).map((hook) => hook.event).sort(), id)
  }
  for (const tool of live.tools.filter((tool) => tool.parameters.length)) {
    assert.deepEqual(tool.parameters, configured.tools.find((item) => item.name === tool.name).parameters, tool.name)
  }
  assert.ok(live.hooks.every((hook) => hook.enabled))
  // only the project-instructions hook has a switch; the rest switch with their extension
  assert.deepEqual(live.hooks.filter((hook) => !hook.locked).map((hook) => hook.id), ['layerfs-connect:before_agent_start'])
  assert.equal(live.tools.find((tool) => tool.name === 'bash').locked.startsWith('Required'), true)
})

test('extension and tool switches change what the model is offered, and refuse unsafe changes', { timeout: 45_000 }, async (t) => {
  const f = await fixture(t, () => ({ text: 'ok' }))
  const chat = await f.manager.create({ permissionMode: 'full' })
  const offered = async (text) => {
    const before = f.requests.length
    await f.manager.message(chat.id, { text })
    const done = await settled(f.manager, chat.id)
    assert.equal(done.state, 'idle', done.error)
    return toolNames(f.requests[before])
  }
  assert.deepEqual(await offered('ALL_ON'), parentTools)

  const rejects = (change, pattern) => assert.rejects(f.manager.setCapability(change), (error) => error.status === 409 && pattern.test(error.message))
  await rejects({ kind: 'extension', id: 'layerfs-connect', enabled: false }, /cannot be turned off/)
  await rejects({ kind: 'tool', id: 'bash', enabled: false }, /Required/)

  // a working chat blocks every change
  f.manager.record(chat.id).state = 'running'
  await rejects({ kind: 'tool', id: 'bg_wait', enabled: false }, /Wait for/)
  f.manager.record(chat.id).state = 'idle'

  await f.manager.setCapability({ kind: 'tool', id: 'bg_wait', enabled: false })
  assert.equal(f.manager.live.has(chat.id), false, 'the idle chat closed its Pi session')
  assert.deepEqual(await offered('NO_BG_WAIT'), ['bash', 'subagent', 'subagent_supervisor'])

  await f.manager.setCapability({ kind: 'tool', id: 'subagent', enabled: false })
  assert.deepEqual(await offered('NO_SUBAGENT'), ['bash'])
  await rejects({ kind: 'tool', id: 'subagent_supervisor', enabled: false }, /Turns on with subagent/)
  await f.manager.setCapability({ kind: 'tool', id: 'subagent', enabled: true })

  const off = await f.manager.setCapability({ kind: 'extension', id: 'pi-subagents', enabled: false })
  assert.deepEqual(off.tools.filter((tool) => tool.enabled).map((tool) => tool.name), ['bash'])
  assert.ok(off.hooks.filter((hook) => hook.extension === 'pi-subagents').every((hook) => !hook.enabled))
  assert.deepEqual(await offered('NO_PI_SUBAGENTS'), ['bash'])
  assert.deepEqual(f.manager.capabilities().extensions.map((extension) => extension.id), ['layerfs-connect', 'pi-subagents'])
  assert.match(f.requests.at(-1).messages.find((message) => message.role === 'system')?.content ?? '', /tool is `bash`\./)
  await rejects({ kind: 'tool', id: 'subagent', enabled: true }, /Turns on with pi-subagents/)

  // the setup survives a restart; turning it back on restores the remembered tool choices
  await f.restart()
  assert.equal(f.manager.capabilities().extensions[1].enabled, false)
  await f.manager.setCapability({ kind: 'extension', id: 'pi-subagents', enabled: true })
  assert.deepEqual(await offered('BACK_ON'), ['bash', 'subagent', 'subagent_supervisor'])
  await f.manager.setCapability({ kind: 'tool', id: 'bg_wait', enabled: true })
  assert.deepEqual(await offered('ALL_BACK'), parentTools)
  assert.deepEqual(await f.manager.remove(chat.id), { id: chat.id })
})

test('a subagent’s numbers and conversation come from its own session file', { timeout: 45_000 }, async (t) => {
  const f = await fixture(t, (request) => {
    const prompt = lastUser(request)
    if (prompt.includes('CHILD_CONVERSATION_FIXTURE')) {
      if (hasResult(request)) return { text: 'CHILD_SAID_DONE' }
      return bash("printf 'from child' > child-conv.txt")
    }
    if (hasResult(request)) return { text: 'PARENT_DONE' }
    return { tool: 'subagent', args: { agent: 'connect-worker', task: 'CHILD_CONVERSATION_FIXTURE', async: false } }
  })
  const chat = await f.manager.create({ permissionMode: 'full' })
  await f.manager.message(chat.id, { text: 'DELEGATE_CONVERSATION' })
  const done = await settled(f.manager, chat.id)
  assert.equal(done.state, 'idle', done.error)
  const child = done.children.find((item) => item.agent === 'connect-worker')
  assert.ok(child, JSON.stringify(done.children))
  assert.equal(child.task, 'CHILD_CONVERSATION_FIXTURE')
  assert.equal(child.conversation, true)
  assert.equal(child.turns, 2)
  assert.equal(child.toolCount, 1)
  assert.ok(child.tokens > 0)
  assert.ok(child.startedAt <= child.endedAt)

  const { child: same, messages } = await agentRoute(f.manager, 'GET', ['sessions', chat.id, 'children', child.id])
  assert.equal(same.id, child.id)
  assert.match(messages.find((message) => message.role === 'user').text, /CHILD_CONVERSATION_FIXTURE/)
  assert.ok(messages.some((message) => message.role === 'tool' && message.toolName === 'bash' && message.status === 'done'))
  assert.equal(messages.filter((message) => message.role === 'assistant').at(-1).text, 'CHILD_SAID_DONE')

  assert.throws(() => f.manager.childConversation(chat.id, 'not-a-child'), (error) => error.status === 404)
  await f.restart()
  assert.equal(f.manager.detail(chat.id).children.find((item) => item.id === child.id).turns, 2)
  // a session file outside the chat's folder is never read
  f.manager.record(chat.id).children = f.manager.record(chat.id).children.map((item) => ({ ...item, sessionFile: '/etc/hosts' }))
  assert.deepEqual(f.manager.childConversation(chat.id, child.id).messages, [])
  assert.equal(f.manager.detail(chat.id).children.find((item) => item.id === child.id).conversation, false)
})

test('turning leads off stops chats from starting connect-lead, and back on allows it', { timeout: 60_000 }, async (t) => {
  const f = await fixture(t, (request) => {
    const tools = toolNames(request)
    if (!tools.includes('subagent')) {
      if (hasResult(request)) return { text: 'WORKER_DONE' }
      return bash("printf 'lead worker' > lead.txt")
    }
    if (tools.includes('contact_supervisor')) {
      if (hasResult(request)) return { text: 'LEAD_DONE' }
      return { tool: 'subagent', args: { agent: 'connect-worker', task: 'LEAD_WORKER', async: false } }
    }
    if (hasResult(request)) return { text: 'ROOT_DONE' }
    return { tool: 'subagent', args: { agent: 'connect-lead', task: 'START_A_LEAD', async: false } }
  })
  const chat = await f.manager.create({ permissionMode: 'full' })
  await assert.rejects(f.manager.setCapability({ kind: 'agent', id: 'main', enabled: false }), (error) => error.status === 409)
  await assert.rejects(f.manager.setCapability({ kind: 'agent', id: 'worker', enabled: false }), (error) => error.status === 409)
  const off = await f.manager.setCapability({ kind: 'agent', id: 'lead', enabled: false })
  assert.deepEqual(off.agents.map((agent) => [agent.id, agent.enabled]), [['main', true], ['worker', true], ['lead', false]])

  await f.manager.message(chat.id, { text: 'TRY_A_LEAD' })
  const refused = await settled(f.manager, chat.id)
  assert.equal(refused.state, 'idle', refused.error)
  assert.ok(!refused.children.some((child) => child.agent === 'connect-lead' && child.state === 'completed'), JSON.stringify(refused.children))
  assert.equal(existsSync(join(f.cwd, 'lead.txt')), false)

  await f.manager.setCapability({ kind: 'agent', id: 'lead', enabled: true })
  await f.manager.message(chat.id, { text: 'TRY_A_LEAD_AGAIN' })
  const allowed = await settled(f.manager, chat.id)
  assert.equal(allowed.state, 'idle', allowed.error)
  assert.ok(allowed.children.some((child) => child.agent === 'connect-lead' && child.text?.includes('LEAD_DONE')), JSON.stringify(allowed.children))
  assert.equal(await readFile(join(f.cwd, 'lead.txt'), 'utf8'), 'lead worker')
})

const systemText = (request) => request.messages.filter((message) => ['system', 'developer'].includes(message.role)).map((message) => content(message.content)).join('\n')

test('per-agent tool and hook switches reach each agent, and global ones reach all of them', { timeout: 90_000 }, async (t) => {
  // the main agent starts a lead, which starts a worker; each agent is told apart by its system prompt
  const f = await fixture(t, (request) => {
    const system = systemText(request)
    if (system.includes('You are a focused worker in LayerFS Connect.')) return hasResult(request) || lastUser(request).includes('NO_TOOL') ? { text: 'WORKER_DONE' } : bash('true')
    if (system.includes('You are a team lead in LayerFS Connect.')) {
      if (hasResult(request)) return { text: 'LEAD_DONE' }
      return { tool: 'subagent', args: { agent: 'connect-worker', task: 'NO_TOOL work', async: false } }
    }
    if (hasResult(request)) return { text: 'MAIN_DONE' }
    return { tool: 'subagent', args: { agent: 'connect-lead', task: 'LEAD_TASK', async: false } }
  })
  await writeFile(join(f.cwd, 'AGENTS.md'), 'PROJECT_RULE_MARKER\n')
  const chat = await f.manager.create({ permissionMode: 'full' })
  const run = async (text) => {
    const before = f.requests.length
    await f.manager.message(chat.id, { text })
    const done = await settled(f.manager, chat.id)
    assert.equal(done.state, 'idle', done.error)
    const seen = {}
    for (const request of f.requests.slice(before)) {
      const system = systemText(request)
      const agent = system.includes('You are a focused worker') ? 'worker' : system.includes('You are a team lead') ? 'lead' : 'main'
      seen[agent] ??= { tools: toolNames(request), rules: system.includes('PROJECT_RULE_MARKER') }
    }
    return seen
  }
  const all = await run('ALL_ON')
  assert.deepEqual(all.main, { tools: parentTools, rules: true })
  assert.deepEqual(all.lead, { tools: ['bash', 'bg_wait', 'contact_supervisor', 'subagent', 'subagent_supervisor'], rules: true })
  assert.deepEqual(all.worker, { tools: ['bash', 'contact_supervisor'], rules: true })

  // per agent: only that agent changes
  await f.manager.setCapability({ kind: 'tool', id: 'bg_wait', agent: 'main', enabled: false })
  await f.manager.setCapability({ kind: 'tool', id: 'contact_supervisor', agent: 'worker', enabled: false })
  await f.manager.setCapability({ kind: 'hook', id: 'layerfs-connect:before_agent_start', agent: 'worker', enabled: false })
  const own = await run('PER_AGENT')
  assert.deepEqual(own.main, { tools: ['bash', 'subagent', 'subagent_supervisor'], rules: true })
  assert.deepEqual(own.lead, { tools: ['bash', 'bg_wait', 'contact_supervisor', 'subagent', 'subagent_supervisor'], rules: true })
  assert.deepEqual(own.worker, { tools: ['bash'], rules: false })

  // global: every agent changes, and per-agent switches wait under it
  await f.manager.setCapability({ kind: 'tool', id: 'subagent_supervisor', enabled: false })
  await f.manager.setCapability({ kind: 'hook', id: 'layerfs-connect:before_agent_start', enabled: false })
  await assert.rejects(f.manager.setCapability({ kind: 'tool', id: 'subagent_supervisor', agent: 'lead', enabled: true }), (error) => error.status === 409 && /Off for all agents/.test(error.message))
  await assert.rejects(f.manager.setCapability({ kind: 'hook', id: 'layerfs-connect:before_agent_start', agent: 'main', enabled: true }), (error) => error.status === 409 && /Off for all agents/.test(error.message))
  await assert.rejects(f.manager.setCapability({ kind: 'hook', id: 'layerfs-connect:message_start', enabled: false }), (error) => error.status === 409 && /rollback/.test(error.message))
  await assert.rejects(f.manager.setCapability({ kind: 'hook', id: 'pi-subagents:input', enabled: false }), (error) => error.status === 409)
  const global = await run('GLOBAL')
  assert.deepEqual(global.main, { tools: ['bash', 'subagent'], rules: false })
  assert.deepEqual(global.lead, { tools: ['bash', 'bg_wait', 'contact_supervisor', 'subagent'], rules: false })
  assert.deepEqual(global.worker, { tools: ['bash'], rules: false })

  const catalog = f.manager.capabilities()
  assert.deepEqual(catalog.tools.find((tool) => tool.name === 'bg_wait').offFor, ['main'])
  assert.equal(catalog.hooks.find((hook) => hook.id === 'layerfs-connect:before_agent_start').enabled, false)
  assert.equal(catalog.agents.find((agent) => agent.id === 'worker').tools.find((tool) => tool.name === 'contact_supervisor').enabled, false)
})
