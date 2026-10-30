// Real Pi tools and subagents use the real approval broker. Only the provider
// response is deterministic, so approval tests can inspect actual file effects.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after } from 'node:test'
import { AgentManager } from '../agents/index.js'
import { createHostServer, listen } from '../server.js'

const sharedState = await mkdtemp(join(tmpdir(), 'connect-permissions-state-'))
after(() => rm(sharedState, { recursive: true, force: true }))
const content = (value) => typeof value === 'string' ? value : (value ?? []).filter((part) => part.type === 'text').map((part) => part.text).join('\n')
const lastUser = (request) => content(request.messages.findLast((message) => message.role === 'user')?.content)
const hasResult = (request) => request.messages.at(-1)?.role === 'tool'
const toolNames = (request) => (request.tools ?? []).map((tool) => tool.function?.name ?? tool.name)
const finalText = (chat) => chat.messages.filter((message) => message.role === 'assistant').at(-1)?.text
const bash = (command) => ({ tool: 'bash', args: { command } })
const pending = (chat) => chat.approvals.findLast((approval) => approval.status === 'pending')

function reply(res, request, answer) {
  const id = randomUUID()
  const chunk = (delta, finish_reason = null) => ({
    id, object: 'chat.completion.chunk', created: 1, model: request.model,
    choices: [{ index: 0, delta, finish_reason }],
  })
  const delta = answer.tool
    ? { role: 'assistant', tool_calls: [{ index: 0, id: `call_${id}`, type: 'function', function: { name: answer.tool, arguments: JSON.stringify(answer.args) } }] }
    : { role: 'assistant', content: answer.text }
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  res.write(`data: ${JSON.stringify(chunk(delta))}\n\n`)
  res.write(`data: ${JSON.stringify({ ...chunk({}, answer.tool ? 'tool_calls' : 'stop'), usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } })}\n\n`)
  res.end('data: [DONE]\n\n')
}

async function fixture(t, respond) {
  const cwd = await mkdtemp(join(tmpdir(), 'connect-permissions-work-'))
  const requests = []
  const server = createServer(async (req, res) => {
    try {
      let body = ''
      for await (const part of req) body += part
      const request = JSON.parse(body)
      requests.push(request)
      reply(res, request, await respond(request))
    } catch (error) {
      res.writeHead(500, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { message: error.message } }))
    }
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  let manager = await AgentManager.create({ state: sharedState, defaultCwd: cwd })
  await manager.models.configure({
    provider: 'permission-fixture', modelId: 'permission-agent', api: 'openai-completions',
    baseUrl: `http://127.0.0.1:${server.address().port}/v1`, apiKey: 'local-permission-fixture-key',
  })
  t.after(async () => {
    await manager.close()
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
    await rm(cwd, { recursive: true, force: true })
  })
  return {
    get manager() { return manager },
    cwd, requests,
    async restart(beforeOpen) {
      await manager.close()
      await beforeOpen?.()
      manager = await AgentManager.create({ state: sharedState, defaultCwd: cwd })
    },
  }
}

async function waitFor(manager, id, predicate, timeoutMs = 15_000) {
  if (predicate(manager.detail(id))) return manager.detail(id)
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
    const timer = setTimeout(() => finish(new Error(`Permission flow did not settle: ${JSON.stringify(manager.detail(id))}`)), timeoutMs)
    manager.on('event', check)
    check()
  })
}

const settled = (manager, id) => waitFor(manager, id, (chat) => chat.state !== 'running')

test('ask waits, approves once, rejects, and cancels on stop without blocking the next turn', { timeout: 30_000 }, async (t) => {
  const f = await fixture(t, (request) => {
    if (hasResult(request)) return { text: 'COMMAND_COMPLETE' }
    const file = lastUser(request).includes('REJECT') ? 'rejected.txt'
      : lastUser(request).includes('STOP') ? 'stopped.txt'
        : lastUser(request).includes('NEXT') ? 'next.txt' : 'approved.txt'
    return bash(`printf permission > ${file}`)
  })
  const chat = await f.manager.create({ permissionMode: 'ask' })
  assert.equal(chat.permissionMode, 'ask')
  await f.manager.message(chat.id, { text: 'APPROVE_ONE' })
  let waiting = await waitFor(f.manager, chat.id, (detail) => Boolean(pending(detail)))
  const approval = pending(waiting)
  assert.equal(approval.agent, 'root')
  assert.equal(approval.cwd, f.cwd)
  assert.equal(existsSync(join(f.cwd, 'approved.txt')), false)
  f.manager.permissions.decide(chat.id, approval.id, 'approve')
  let done = await settled(f.manager, chat.id)
  assert.equal(await readFile(join(f.cwd, 'approved.txt'), 'utf8'), 'permission')
  assert.equal(done.permissionMode, 'ask')
  assert.equal(done.approvals.at(-1).source, 'user')

  await f.manager.message(chat.id, { text: 'REJECT_ONE' })
  waiting = await waitFor(f.manager, chat.id, (detail) => Boolean(pending(detail)))
  assert.equal(existsSync(join(f.cwd, 'rejected.txt')), false)
  f.manager.permissions.decide(chat.id, pending(waiting).id, 'reject')
  done = await settled(f.manager, chat.id)
  assert.equal(done.approvals.at(-1).status, 'rejected')
  assert.equal(existsSync(join(f.cwd, 'rejected.txt')), false)

  await f.manager.message(chat.id, { text: 'STOP_ONE' })
  waiting = await waitFor(f.manager, chat.id, (detail) => Boolean(pending(detail)))
  const cancelledId = pending(waiting).id
  const stopped = await f.manager.stop(chat.id)
  assert.equal(stopped.state, 'idle')
  assert.equal(stopped.approvals.find((entry) => entry.id === cancelledId).status, 'cancelled')
  assert.equal(existsSync(join(f.cwd, 'stopped.txt')), false)
  assert.throws(() => f.manager.permissions.decide(chat.id, cancelledId, 'approve'), { status: 409 })

  await f.manager.message(chat.id, { text: 'NEXT_TURN' })
  waiting = await waitFor(f.manager, chat.id, (detail) => Boolean(pending(detail)))
  f.manager.permissions.decide(chat.id, pending(waiting).id, 'approve')
  await settled(f.manager, chat.id)
  assert.equal(await readFile(join(f.cwd, 'next.txt'), 'utf8'), 'permission')
})

for (const legacyMode of ['ask', 'auto', undefined]) {
  test(`restart upgrades ${legacyMode ?? 'missing'} policy to full and cancels stale approvals without replaying commands`, { timeout: 30_000 }, async (t) => {
    const f = await fixture(t, (request) => {
      if (hasResult(request)) return { text: 'RESTART_PERMISSION_DONE' }
      return bash(lastUser(request).includes('AFTER_RESTART') ? 'printf after > after-restart.txt' : 'printf before > before-restart.txt')
    })
    const chat = await f.manager.create({ permissionMode: 'ask' })
    await f.manager.message(chat.id, { text: 'WAIT_BEFORE_RESTART' })
    const waiting = await waitFor(f.manager, chat.id, (detail) => Boolean(pending(detail)))
    const oldId = pending(waiting).id
    const interruptedReviewId = randomUUID()
    await f.restart(async () => {
      const file = join(sharedState, 'chats', chat.id, 'chat.json')
      const saved = JSON.parse(await readFile(file, 'utf8'))
      assert.equal(saved.approvals.find((approval) => approval.id === oldId).status, 'cancelled')
      assert.equal(existsSync(join(f.cwd, 'before-restart.txt')), false)
      // Recreate what a crashed process can leave behind: pending/reviewing rows
      // without any in-memory waiter. Neither may become an executable approval.
      const old = saved.approvals.find((approval) => approval.id === oldId)
      old.status = 'pending'
      delete old.decidedAt
      saved.approvals.push({ ...old, id: interruptedReviewId, toolCallId: 'interrupted-review', status: 'reviewing' })
      if (legacyMode === undefined) delete saved.permissionMode
      else saved.permissionMode = legacyMode
      saved.state = 'running'
      await writeFile(file, JSON.stringify(saved))
    })
    const restored = f.manager.detail(chat.id)
    assert.equal(restored.permissionMode, 'full')
    const persisted = JSON.parse(await readFile(join(sharedState, 'chats', chat.id, 'chat.json'), 'utf8'))
    assert.equal(persisted.permissionMode, 'full', 'The upgrade is saved before the conversation is opened.')
    for (const id of [oldId, interruptedReviewId]) {
      assert.equal(restored.approvals.find((approval) => approval.id === id).status, 'cancelled')
      assert.throws(() => f.manager.permissions.decide(chat.id, id, 'approve'), { status: 409 })
    }
    await f.manager.message(chat.id, { text: 'AFTER_RESTART' })
    const done = await settled(f.manager, chat.id)
    assert.equal(done.approvals.length, 2, 'New commands execute directly without creating another approval.')
    assert.equal(await readFile(join(f.cwd, 'after-restart.txt'), 'utf8'), 'after')
    assert.equal(existsSync(join(f.cwd, 'before-restart.txt')), false)
    await f.restart()
    assert.equal(f.manager.detail(chat.id).permissionMode, 'full')
    assert.ok(f.manager.detail(chat.id).approvals.every((approval) => !['pending', 'reviewing'].includes(approval.status)))
  })
}

test('default full access executes root and child bash without approval or model review', { timeout: 30_000 }, async (t) => {
  const f = await fixture(t, (request) => {
    if (!toolNames(request).includes('subagent')) return hasResult(request) ? { text: 'DEFAULT_CHILD_DONE' } : bash('printf child > default-child.txt')
    const calls = request.messages.flatMap((message) => message.tool_calls ?? []).map((call) => call.function.name)
    if (!calls.includes('bash')) return bash('printf root > default-root.txt')
    if (!calls.includes('subagent')) return { tool: 'subagent', args: { agent: 'connect-worker', task: 'DEFAULT_FULL_CHILD', async: false } }
    return { text: 'DEFAULT_ROOT_DONE' }
  })
  const chat = await f.manager.create()
  assert.equal(chat.permissionMode, 'full')
  await f.manager.message(chat.id, { text: 'DEFAULT_FULL_ROOT_CHILD' })
  const done = await settled(f.manager, chat.id)
  assert.equal(done.state, 'idle', done.error)
  assert.equal(finalText(done), 'DEFAULT_ROOT_DONE')
  assert.equal(await readFile(join(f.cwd, 'default-root.txt'), 'utf8'), 'root')
  assert.equal(await readFile(join(f.cwd, 'default-child.txt'), 'utf8'), 'child')
  assert.deepEqual(done.approvals, [])
  assert.ok(f.requests.every((request) => toolNames(request).length > 0), 'Full access makes no tool-free approval model call.')
})

for (const kind of ['foreground', 'nested', 'background']) {
  test(`${kind} child bash waits on the parent session and switching that session to full releases it`, { timeout: 30_000 }, async (t) => {
    const f = await fixture(t, (request) => {
      const tools = toolNames(request)
      if (!tools.includes('subagent')) return hasResult(request) ? { text: 'WORKER_PERMISSION_DONE' } : bash(`printf ${kind} > ${kind}.txt`)
      if (tools.includes('contact_supervisor')) {
        return hasResult(request) ? { text: 'LEAD_PERMISSION_DONE' } : { tool: 'subagent', args: { agent: 'connect-worker', task: 'NESTED_PERMISSION_WORKER', async: false } }
      }
      const delegated = request.messages.some((message) => message.tool_calls?.some((call) => call.function.name === 'subagent'))
      if (!delegated) return { tool: 'subagent', args: { agent: kind === 'nested' ? 'connect-lead' : 'connect-worker', task: `${kind.toUpperCase()}_PERMISSION_TASK`, async: kind === 'background' } }
      return { text: kind === 'background' && hasResult(request) ? 'ROOT_WAITING' : 'ROOT_PERMISSION_DONE' }
    })
    const chat = await f.manager.create({ permissionMode: 'ask' })
    await f.manager.message(chat.id, { text: `DELEGATE_${kind.toUpperCase()}` })
    const waiting = await waitFor(f.manager, chat.id, (detail) => Boolean(pending(detail)))
    assert.match(pending(waiting).agent, /^child-/)
    assert.equal(pending(waiting).cwd, f.cwd)
    assert.equal(existsSync(join(f.cwd, `${kind}.txt`)), false)
    f.manager.permissions.setMode(chat.id, 'full')
    const done = await waitFor(f.manager, chat.id, (detail) => detail.state === 'idle' && finalText(detail) === 'ROOT_PERMISSION_DONE')
    assert.equal(await readFile(join(f.cwd, `${kind}.txt`), 'utf8'), kind)
    assert.equal(done.approvals.at(-1).status, 'approved')
    assert.equal(done.permissionMode, 'full')
    assert.ok(f.requests.every((request) => !toolNames(request).some((name) => ['read', 'write', 'edit'].includes(name))))
  })
}

test('stopping a background child awaiting approval cancels its command and leaves the parent usable', { timeout: 30_000 }, async (t) => {
  const f = await fixture(t, (request) => {
    if (!toolNames(request).includes('subagent')) return hasResult(request) ? { text: 'CHILD_CANCELLED' } : bash('printf forbidden > background-cancelled.txt')
    if (request.messages.some((message) => message.role === 'user' && content(message.content).includes('CONTINUE_AFTER_CHILD_STOP'))) return { text: 'PARENT_READY_AGAIN' }
    const delegated = request.messages.some((message) => message.tool_calls?.some((call) => call.function.name === 'subagent'))
    return delegated ? { text: 'ROOT_WAITING' } : { tool: 'subagent', args: { agent: 'connect-worker', task: 'CHILD_AWAITS_APPROVAL', async: true } }
  })
  const chat = await f.manager.create({ permissionMode: 'ask' })
  await f.manager.message(chat.id, { text: 'BACKGROUND_APPROVAL_STOP' })
  const waiting = await waitFor(f.manager, chat.id, (detail) => Boolean(pending(detail)))
  assert.match(pending(waiting).agent, /^child-/)
  const stopped = await f.manager.stop(chat.id)
  assert.equal(stopped.state, 'idle')
  assert.equal(stopped.approvals.at(-1).status, 'cancelled')
  assert.equal(existsSync(join(f.cwd, 'background-cancelled.txt')), false)
  await f.manager.message(chat.id, { text: 'CONTINUE_AFTER_CHILD_STOP' })
  const continued = await waitFor(f.manager, chat.id, (detail) => detail.state === 'idle' && finalText(detail) === 'PARENT_READY_AGAIN')
  assert.equal(finalText(continued), 'PARENT_READY_AGAIN')
  assert.equal(continued.messages.filter((message) => message.role === 'user' && message.text === 'CONTINUE_AFTER_CHILD_STOP').length, 1)
  assert.equal(existsSync(join(f.cwd, 'background-cancelled.txt')), false)
})

test('auto uses a separate tool-free reviewer and asks the human on risk or invalid review output', { timeout: 30_000 }, async (t) => {
  const reviews = []
  const f = await fixture(t, (request) => {
    if (toolNames(request).length === 0) {
      const context = JSON.parse(lastUser(request))
      reviews.push({ request, context })
      if (context.proposedCommand.command.includes('invalid-review')) return { text: 'Not a JSON decision.' }
      return { text: JSON.stringify({ decision: context.proposedCommand.command.includes('auto-approved') ? 'approve' : 'ask', reason: 'Fixture review requires the selected decision.' }) }
    }
    if (hasResult(request)) return { text: 'AUTO_COMMAND_COMPLETE' }
    const file = lastUser(request).includes('MANUAL') ? 'manual-review.txt' : lastUser(request).includes('INVALID') ? 'invalid-review.txt' : 'auto-approved.txt'
    return bash(`printf reviewed > ${file}`)
  })
  const chat = await f.manager.create({ permissionMode: 'auto' })
  await f.manager.message(chat.id, { text: 'AUTO_ROUTINE_EDIT' })
  let done = await settled(f.manager, chat.id)
  assert.equal(await readFile(join(f.cwd, 'auto-approved.txt'), 'utf8'), 'reviewed')
  assert.equal(done.approvals.at(-1).status, 'approved')
  assert.equal(done.approvals.at(-1).source, 'model')
  assert.equal(reviews.length, 1)
  assert.equal(reviews[0].context.workspace, f.cwd)
  assert.equal(reviews[0].context.proposedCommand.command, 'printf reviewed > auto-approved.txt')
  assert.ok(reviews[0].context.recentUserInstructions.includes('AUTO_ROUTINE_EDIT'))
  assert.equal(toolNames(reviews[0].request).length, 0)

  await f.manager.message(chat.id, { text: 'AUTO_MANUAL_REVIEW' })
  let waiting = await waitFor(f.manager, chat.id, (detail) => Boolean(pending(detail)))
  assert.match(pending(waiting).reason, /Fixture review/)
  assert.equal(existsSync(join(f.cwd, 'manual-review.txt')), false)
  f.manager.permissions.decide(chat.id, pending(waiting).id, 'approve')
  done = await settled(f.manager, chat.id)
  assert.equal(done.approvals.at(-1).source, 'user')
  assert.equal(await readFile(join(f.cwd, 'manual-review.txt'), 'utf8'), 'reviewed')

  await f.manager.message(chat.id, { text: 'AUTO_INVALID_REVIEW' })
  waiting = await waitFor(f.manager, chat.id, (detail) => Boolean(pending(detail)))
  assert.match(pending(waiting).reason, /invalid JSON/)
  assert.equal(existsSync(join(f.cwd, 'invalid-review.txt')), false)
  f.manager.permissions.decide(chat.id, pending(waiting).id, 'reject')
  await settled(f.manager, chat.id)
  assert.equal(existsSync(join(f.cwd, 'invalid-review.txt')), false)
  assert.equal(reviews.length, 3)
})

test('switching auto to ask cancels the old review; switching to full releases the pending command once', { timeout: 30_000 }, async (t) => {
  let completeReview
  let markReviewStarted
  const reviewStarted = new Promise((resolve) => { markReviewStarted = resolve })
  const f = await fixture(t, async (request) => {
    if (toolNames(request).length === 0) {
      markReviewStarted()
      return new Promise((resolve) => { completeReview = () => resolve({ text: JSON.stringify({ decision: 'approve', reason: 'Late automatic approval.' }) }) })
    }
    return hasResult(request) ? { text: 'MODE_SWITCH_DONE' } : bash('printf once >> mode-switch.txt')
  })
  const chat = await f.manager.create({ permissionMode: 'auto' })
  await f.manager.message(chat.id, { text: 'CHANGE_MODE_DURING_REVIEW' })
  await reviewStarted
  assert.equal(f.manager.detail(chat.id).approvals.at(-1).status, 'reviewing')
  f.manager.permissions.setMode(chat.id, 'ask')
  completeReview()
  await new Promise((resolve) => setTimeout(resolve, 25))
  assert.equal(f.manager.detail(chat.id).approvals.at(-1).status, 'pending')
  assert.equal(existsSync(join(f.cwd, 'mode-switch.txt')), false)
  f.manager.permissions.setMode(chat.id, 'full')
  const done = await settled(f.manager, chat.id)
  assert.equal(finalText(done), 'MODE_SWITCH_DONE')
  assert.equal(done.approvals.at(-1).source, 'user')
  assert.equal(await readFile(join(f.cwd, 'mode-switch.txt'), 'utf8'), 'once')
})

test('a child request token cannot decide approvals or change another session', { timeout: 30_000 }, async (t) => {
  const f = await fixture(t, (request) => hasResult(request) ? { text: 'API_APPROVAL_DONE' } : bash('printf api-approved > api.txt'))
  const chat = await f.manager.create({ permissionMode: 'ask' })
  await f.manager.message(chat.id, { text: 'API_APPROVAL_TASK' })
  const waiting = await waitFor(f.manager, chat.id, (detail) => Boolean(pending(detail)))
  const approval = pending(waiting)
  const connection = JSON.parse(await readFile(join(sharedState, 'chats', chat.id, 'approval-connection.json'), 'utf8'))
  const token = 'desktop-test-token'
  const host = createHostServer({ token, projects: {}, runs: () => null, agents: () => f.manager })
  const url = await listen(host)
  t.after(async () => { host.closeAllConnections(); await new Promise((resolve) => host.close(resolve)) })
  const target = `${url}/api/agent/sessions/${chat.id}/approvals/${approval.id}`
  let response = await fetch(target, { method: 'POST', headers: { authorization: `Bearer ${connection.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ decision: 'approve' }) })
  assert.equal(response.status, 401)
  assert.equal(existsSync(join(f.cwd, 'api.txt')), false)
  response = await fetch(`${connection.url}/decide`, { method: 'POST', headers: { authorization: `Bearer ${connection.token}` } })
  assert.equal(response.status, 404)
  response = await fetch(`${connection.url}/request`, {
    method: 'POST', headers: { authorization: `Bearer ${connection.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: 'different-session', agent: 'root', toolCallId: 'forged', command: 'echo unrelated', cwd: f.cwd }),
  })
  assert.equal(response.status, 403)
  response = await fetch(target, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ decision: 'approve' }) })
  assert.equal(response.status, 200)
  await settled(f.manager, chat.id)
  assert.equal(await readFile(join(f.cwd, 'api.txt'), 'utf8'), 'api-approved')
})
