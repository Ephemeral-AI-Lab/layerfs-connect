import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as pause } from 'node:timers/promises'
import test, { after } from 'node:test'
import { AgentManager } from '../agents/index.js'
import { agentRoute } from '../agents/routes.js'

const state = await mkdtemp(join(tmpdir(), 'connect-runtime-state-'))
after(() => rm(state, { recursive: true, force: true }))
const content = (value) => typeof value === 'string' ? value : (value ?? []).filter((part) => part.type === 'text').map((part) => part.text).join('\n')
const lastUser = (request) => content(request.messages.findLast((message) => message.role === 'user')?.content)
const bash = (command) => ({ tool: 'bash', args: { command } })

async function fixture(t, respond) {
  const dir = await mkdtemp(join(tmpdir(), 'connect-runtime-'))
  const cwd = join(dir, 'work')
  await mkdir(cwd)
  const requests = [], events = []
  const server = createServer(async (req, res) => {
    let raw = ''
    for await (const part of req) raw += part
    const request = JSON.parse(raw)
    requests.push(request)
    const answer = await respond(request, requests)
    if (answer.status) {
      res.writeHead(answer.status, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({ error: { message: answer.error ?? 'Temporarily overloaded' } }))
    }
    const id = randomUUID()
    const frame = (delta, finish_reason = null) => ({ id, object: 'chat.completion.chunk', created: 1, model: request.model, choices: [{ index: 0, delta, finish_reason }] })
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.write(`data: ${JSON.stringify(frame(answer.tool ? { role: 'assistant', tool_calls: [{ index: 0, id: `call_${id}`, type: 'function', function: { name: answer.tool, arguments: JSON.stringify(answer.args) } }] } : { role: 'assistant', content: answer.text ?? 'Done.' }))}\n\n`)
    if (answer.pause) await pause(answer.pause)
    res.end(`data: ${JSON.stringify({ ...frame({}, answer.tool ? 'tool_calls' : 'stop'), usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 } })}\n\ndata: [DONE]\n\n`)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  let manager
  const open = async () => { manager = await AgentManager.create({ state, defaultCwd: cwd }); manager.on('event', (event) => events.push(structuredClone(event))) }
  await open()
  await manager.models.configure({ provider: 'runtime-fixture', modelId: 'fixture-model', api: 'openai-completions', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, apiKey: 'local-runtime-key' })
  const wait = async (id, predicate = (session) => session.state !== 'running') => {
    for (let index = 0; index < 1000; index++) {
      const session = manager.detail(id)
      if (predicate(session)) return session
      await pause(10)
    }
    const current = manager.detail(id)
    throw new Error(`Runtime fixture timed out: ${JSON.stringify({ state: current.state, execution: current.execution, error: current.error, children: current.children, requests: requests.map((request) => ({ prompt: lastUser(request).slice(0, 100), tools: request.tools?.map((tool) => tool.function?.name) })) })}`)
  }
  t.after(async () => { await manager.close(); server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); await rm(dir, { recursive: true, force: true }) })
  return { cwd, requests, events, wait, get manager() { return manager }, restart: async (beforeOpen = async () => {}) => { await manager.close(); await beforeOpen(); await open() } }
}

test('continue preserves completed tools and the original user message after a failed response', async (t) => {
  const f = await fixture(t, (request) => {
    if (lastUser(request).startsWith('Continue the task')) return { text: 'Recovered without repeating work.' }
    if (request.messages.at(-1)?.role === 'tool') return { status: 400, error: 'Response failed after completed tool.' }
    return bash('printf completed >> completed.txt')
  })
  const chat = await f.manager.create({ permissionMode: 'full', limits: { maxRetries: 0 } })
  await f.manager.message(chat.id, { text: 'Complete the work once' })
  const failed = await f.wait(chat.id)
  assert.equal(failed.state, 'error')
  assert.equal(failed.recovery.canContinue, true)
  await agentRoute(f.manager, 'POST', ['sessions', chat.id, 'continue'], {})
  const final = await f.wait(chat.id)
  assert.equal(final.state, 'idle', final.error)
  assert.equal(await readFile(join(f.cwd, 'completed.txt'), 'utf8'), 'completed')
  assert.equal(final.messages.filter((message) => message.role === 'user').length, 1)
  assert.equal(final.messages.filter((message) => message.role === 'tool').length, 1)
  assert.equal(final.execution.phase, 'idle')
  assert.ok(final.usage.totalTokens > 0)
  const usage = final.usage
  await f.restart()
  assert.deepEqual(f.manager.detail(chat.id).usage, usage)
})

test('a context failure before the user entry returns rejection instead of falsely accepting and losing the draft', async (t) => {
  const f = await fixture(t, () => ({ text: 'Accepted after instructions were fixed.' }))
  const chat = await f.manager.create({ permissionMode: 'full' })
  const path = join(f.cwd, 'AGENTS.md')
  await writeFile(path, 'x'.repeat(1024 * 1024 + 1))
  const input = { text: 'Keep this original task until accepted' }
  await assert.rejects(agentRoute(f.manager, 'POST', ['sessions', chat.id, 'message'], input), /instructions exceed/i)
  const failed = await f.wait(chat.id)
  assert.equal(failed.messages.filter((message) => message.role === 'user').length, 0)
  assert.equal(f.requests.length, 0)
  await rm(path)
  await f.manager.message(chat.id, input)
  const final = await f.wait(chat.id)
  assert.equal(final.state, 'idle', final.error)
  assert.equal(final.messages.filter((message) => message.role === 'user').length, 1)
  assert.equal(final.messages.find((message) => message.role === 'user').text, input.text)
})

test('native retries are finite and visible, then recover without leaving the session in error', async (t) => {
  let permanent = false
  const f = await fixture(t, (_request, requests) => permanent || requests.length === 1 ? { status: 503 } : { text: 'Recovered.' })
  const chat = await f.manager.create({ permissionMode: 'full', limits: { maxRetries: 1 } })
  await f.manager.message(chat.id, { text: 'Retry the transient provider failure' })
  const final = await f.wait(chat.id)
  assert.equal(final.state, 'idle', final.error)
  assert.equal(final.error, null)
  assert.equal(f.requests.length, 2)
  assert.ok(f.events.some((event) => event.session.id === chat.id && event.session.execution.phase === 'retrying' && event.session.execution.retryAttempt === 1))
  assert.equal(final.execution.turns, 2)
  permanent = true
  const failed = await f.manager.create({ permissionMode: 'full', limits: { maxRetries: 1 } })
  const before = f.requests.length
  await f.manager.message(failed.id, { text: 'Exhaust one retry' })
  assert.equal((await f.wait(failed.id)).state, 'error')
  assert.equal(f.requests.length - before, 2)
})

test('retry keeps pending input out of the failed request; remove and promote still work and recovered input runs once', async (t) => {
  const arrived = Promise.withResolvers(), gate = Promise.withResolvers()
  const f = await fixture(t, async (_request, requests) => {
    if (requests.length === 1) { arrived.resolve(); await gate.promise; return { status: 503 } }
    return { text: 'Recovered.' }
  })
  const chat = await f.manager.create({ permissionMode: 'full', limits: { maxRetries: 1 } })
  await f.manager.message(chat.id, { text: 'RETRY_ORIGINAL' })
  await arrived.promise
  const before = await f.manager.message(chat.id, { text: 'REMOVE_DURING_RETRY' })
  const removedId = before.queued[0].id
  const queued = await f.manager.message(chat.id, { text: 'PROMOTE_DURING_RETRY' })
  const promotedId = queued.queued[1].id
  gate.resolve()
  await f.wait(chat.id, (session) => session.execution.phase === 'retrying')
  await f.manager.updateQueued(chat.id, removedId)
  await f.manager.updateQueued(chat.id, promotedId, 'steer')
  await f.manager.message(chat.id, { text: 'AFTER_RECOVERY' })
  const final = await f.wait(chat.id)
  assert.equal(final.state, 'idle', final.error)
  assert.deepEqual(f.requests.map(lastUser), ['RETRY_ORIGINAL', 'RETRY_ORIGINAL', 'PROMOTE_DURING_RETRY', 'AFTER_RECOVERY'])
  assert.deepEqual(final.messages.filter((message) => message.role === 'user').map((message) => message.text), ['RETRY_ORIGINAL', 'PROMOTE_DURING_RETRY', 'AFTER_RECOVERY'])
  assert.deepEqual(final.queued, [])
})

test('Stop during retry discards its held queue and later prompts never replay it', async (t) => {
  const f = await fixture(t, (request) => lastUser(request) === 'AFTER_STOP' ? { text: 'Ready.' } : { status: 503 })
  const chat = await f.manager.create({ permissionMode: 'full', limits: { maxRetries: 2 } })
  await f.manager.message(chat.id, { text: 'RETRY_UNTIL_STOP' })
  await f.wait(chat.id, (session) => session.execution.phase === 'retrying')
  await f.manager.message(chat.id, { text: 'DROP_HELD_QUEUE' })
  await f.manager.stop(chat.id)
  assert.equal(f.manager.live.get(chat.id).suspendedQueues, null)
  await f.manager.message(chat.id, { text: 'AFTER_STOP' })
  assert.equal((await f.wait(chat.id)).state, 'idle')
  assert.ok(f.requests.every((request) => !JSON.stringify(request.messages).includes('DROP_HELD_QUEUE')))
})

test('a failed extension-owned completion wake clears held input and settles without a manager-owned task', async (t) => {
  const f = await fixture(t, (request) => lastUser(request) === 'INITIAL_PROMPT' ? { text: 'Ready.' } : { status: 503 })
  const chat = await f.manager.create({ permissionMode: 'full', limits: { maxRetries: 1 } })
  await f.manager.message(chat.id, { text: 'INITIAL_PROMPT' })
  await f.wait(chat.id)
  const active = f.manager.live.get(chat.id)
  const wake = active.session.sendCustomMessage({ customType: 'fixture-completion-wake', content: 'FAIL_WAKE', display: false }, { triggerTurn: true })
  await f.wait(chat.id, (session) => session.execution.phase === 'retrying')
  await f.manager.message(chat.id, { text: 'DO_NOT_RUN_WAKE_QUEUE' })
  await wake
  const final = f.manager.detail(chat.id)
  assert.equal(final.state, 'error')
  assert.equal(final.execution.phase, 'error')
  assert.equal(final.recovery.canContinue, true)
  assert.deepEqual(final.queued, [])
  assert.equal(active.suspendedQueues, null)
  assert.ok(f.requests.every((request) => !JSON.stringify(request.messages).includes('DO_NOT_RUN_WAKE_QUEUE')))
})

test('turn limits stop the full run before another model request and allow an explicit continuation', async (t) => {
  const f = await fixture(t, (request) => lastUser(request).startsWith('Continue the task') ? { text: 'Continued.' } : bash('printf x >> turns.txt'))
  const chat = await f.manager.create({ permissionMode: 'full', limits: { maxTurns: 1, maxRetries: 0 } })
  await f.manager.message(chat.id, { text: 'Loop until stopped by the turn budget' })
  const stopped = await f.wait(chat.id, (session) => session.execution.phase === 'interrupted' && !f.manager.stopping.get(chat.id)?.pending)
  assert.equal(f.requests.length, 1)
  assert.equal(await readFile(join(f.cwd, 'turns.txt'), 'utf8'), 'x')
  assert.match(stopped.execution.reason, /1-turn limit/)
  assert.equal(stopped.execution.turns, 1)
  assert.equal(stopped.recovery.required, false)
  assert.equal(stopped.recovery.canContinue, true)
  await f.manager.continue(chat.id)
  assert.equal((await f.wait(chat.id)).state, 'idle')
})

test('run deadlines stop actual bash before its late write, while default bash timeouts bound individual tools', async (t) => {
  const f = await fixture(t, (request) => request.messages.at(-1)?.role === 'tool' ? { text: 'Command ended.' } : bash('printf partial > partial.txt; echo STARTED; sleep 3; printf late > late.txt'))
  const chat = await f.manager.create({ permissionMode: 'full', limits: { maxRuntimeSeconds: 1, maxRetries: 0 } })
  await f.manager.message(chat.id, { text: 'Check the whole-run deadline' })
  const stopped = await f.wait(chat.id, (session) => session.execution.phase === 'interrupted' && !f.manager.stopping.get(chat.id)?.pending)
  assert.match(stopped.execution.reason, /1-second run limit/)
  assert.equal(await readFile(join(f.cwd, 'partial.txt'), 'utf8'), 'partial')
  assert.equal(existsSync(join(f.cwd, 'late.txt')), false)
  const tool = await f.manager.create({ permissionMode: 'full', limits: { maxRuntimeSeconds: 0, bashTimeoutSeconds: 1, maxRetries: 0 } })
  await f.manager.message(tool.id, { text: 'Check the default command timeout' })
  const final = await f.wait(tool.id)
  assert.equal(final.state, 'idle', final.error)
  assert.ok(final.messages.some((message) => message.role === 'tool' && /timed out|timeout/i.test(message.text)))
  assert.equal(existsSync(join(f.cwd, 'late.txt')), false)
})

test('background children keep the deadline, and a busy Continue request does not stop the worker', async (t) => {
  const f = await fixture(t, (request) => {
    const root = request.tools?.some((tool) => tool.function?.name === 'subagent')
    if (!root) return request.messages.at(-1)?.role === 'tool' ? { text: 'Worker ended.' } : bash('echo $$ > background-pid.txt; sleep 8; printf late > background-late.txt')
    const delegated = request.messages.some((message) => message.tool_calls?.some((call) => call.function.name === 'subagent'))
    return delegated ? { text: 'Parent is ready while the worker runs.' } : { tool: 'subagent', args: { agent: 'connect-worker', task: 'LONG_BACKGROUND_WORKER', async: true } }
  })
  const chat = await f.manager.create({ permissionMode: 'full', limits: { maxRuntimeSeconds: 5, maxRetries: 0 } })
  await f.manager.message(chat.id, { text: 'Start a background worker' })
  await f.wait(chat.id, () => existsSync(join(f.cwd, 'background-pid.txt')))
  const pid = Number(await readFile(join(f.cwd, 'background-pid.txt'), 'utf8'))
  if (f.manager.detail(chat.id).state === 'running') await assert.rejects(f.manager.continue(chat.id), { status: 409 })
  else await f.manager.continue(chat.id)
  assert.doesNotThrow(() => process.kill(pid, 0), 'Continue must not stop a live background child.')
  const stopped = await f.wait(chat.id, (session) => session.execution.phase === 'interrupted' && !f.manager.stopping.get(chat.id)?.pending)
  assert.match(stopped.execution.reason, /5-second run limit/)
  assert.equal(existsSync(join(f.cwd, 'background-late.txt')), false)
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' })
  assert.ok(stopped.children.every((child) => !['running', 'pending', 'queued', 'paused'].includes(child.state)))
})

test('limits update before the first message, persist and copy; archived conversations require restore', async (t) => {
  const f = await fixture(t, () => ({ text: 'Done.' }))
  const chat = await f.manager.create({ permissionMode: 'full' })
  const updated = await agentRoute(f.manager, 'POST', ['sessions', chat.id, 'limits'], { maxTurns: 7, maxRuntimeSeconds: 0, bashTimeoutSeconds: 4, maxRetries: 0, instructions: 'Use the saved project instructions.' })
  assert.equal(updated.limits.maxTurns, 7)
  for (const input of [{ maxTurns: -1 }, { maxRuntimeSeconds: 86401 }, { bashTimeoutSeconds: 0 }, { maxRetries: 6 }, { instructions: 'x'.repeat(32769) }]) await assert.rejects(async () => f.manager.updateLimits(chat.id, input), { status: 400 })
  await f.manager.message(chat.id, { text: 'Use saved run settings' })
  await f.wait(chat.id)
  const copy = await f.manager.fork(chat.id)
  assert.deepEqual(copy.session.limits, updated.limits)
  assert.equal(copy.session.execution.turns, 0)
  assert.equal(copy.session.archived, false)
  const archived = await agentRoute(f.manager, 'POST', ['sessions', chat.id, 'update'], { title: 'Named conversation', archived: true })
  assert.equal(archived.archived, true)
  await assert.rejects(f.manager.message(chat.id, { text: 'Blocked until restored' }), { status: 409 })
  await assert.rejects(f.manager.continue(chat.id), { status: 409 })
  await f.restart()
  assert.equal(f.manager.detail(chat.id).limits.maxTurns, 7)
  await f.manager.update(chat.id, { archived: false })
  await f.manager.continue(chat.id)
  assert.equal((await f.wait(chat.id)).state, 'idle')
})

test('interrupted state is honest after restart and continue first completes its stop obligation', async (t) => {
  const f = await fixture(t, () => ({ text: 'Saved.' }))
  const chat = await f.manager.create({ permissionMode: 'full' })
  await f.manager.message(chat.id, { text: 'Original prompt' })
  await f.wait(chat.id)
  await f.restart(async () => {
    const file = join(state, 'chats', chat.id, 'chat.json')
    const record = JSON.parse(await readFile(file, 'utf8'))
    record.state = 'running'
    await writeFile(file, JSON.stringify(record))
  })
  const interrupted = f.manager.detail(chat.id)
  assert.equal(interrupted.execution.phase, 'interrupted')
  assert.equal(interrupted.recovery.required, true)
  await f.manager.continue(chat.id)
  const final = await f.wait(chat.id)
  assert.equal(final.state, 'idle', final.error)
  assert.equal(final.recovery.required, false)
  assert.equal(final.messages.filter((message) => message.role === 'user').length, 1)
})

test('attachments persist for editing but SSE sends metadata, and copied full output survives source deletion', async (t) => {
  const f = await fixture(t, (request) => request.messages.at(-1)?.role === 'tool' ? { text: 'Output captured.' } : bash("node -e 'process.stdout.write(\"abc\".repeat(30000))'"))
  const chat = await f.manager.create({ permissionMode: 'full' })
  const attachment = { name: 'context.txt', mimeType: 'text/plain', data: Buffer.from('One attached file').toString('base64') }
  await f.manager.message(chat.id, { text: 'Inspect this attachment', attachments: [attachment] })
  const final = await f.wait(chat.id)
  const user = final.messages.find((message) => message.role === 'user')
  assert.equal(user.text, 'Inspect this attachment')
  assert.equal(user.attachments[0].data, attachment.data)
  for (const event of f.events.filter((event) => event.session.id === chat.id)) assert.equal(JSON.stringify(event).includes(attachment.data), false)
  const tool = final.messages.find((message) => message.role === 'tool')
  const artifactId = tool.details.outputArtifact.id
  const copy = await f.manager.fork(chat.id)
  await f.manager.remove(chat.id)
  let output = '', offset = 0, page
  do {
    page = await agentRoute(f.manager, 'GET', ['sessions', copy.session.id, 'output', artifactId], undefined, new URLSearchParams({ offset: String(offset) }))
    output += page.text
    offset = page.nextOffset
  } while (!page.done)
  assert.equal(output, 'abc'.repeat(30000))
})
