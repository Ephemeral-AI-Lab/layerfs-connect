import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ApprovalService } from '../agents/permissions.js'
import { createConnectBashExtension } from '../agents/child-extension.js'
import { createConnectExtensions } from '../agents/extensions.js'
import { createWorkspaceBashOperations } from '../agents/workspace-bash.js'

const command = { sessionId: 'a', agent: 'root', toolCallId: 'call-1', command: 'printf workspace', cwd: '/host/control' }

async function fixture(t, executeWorkspace, mode = 'full') {
  const state = await mkdtemp(join(tmpdir(), 'connect-workspace-bash-'))
  const record = { id: 'a', permissionMode: mode, approvals: [] }
  const approval = Promise.withResolvers()
  const manager = {
    record: (id) => { assert.equal(id, 'a'); return record },
    detail: () => record,
    changed: () => { if (record.approvals.at(-1)?.status === 'pending') approval.resolve(record.approvals.at(-1)) },
    workspaceDirectory: async (id) => { assert.equal(id, 'a'); return '/workspaces/7' },
    executeWorkspace,
  }
  const service = await new ApprovalService(manager).start()
  const approvalFile = service.connection('a', state)
  const connection = JSON.parse(await readFile(approvalFile, 'utf8'))
  t.after(async () => {
    service.server.closeAllConnections()
    await service.close()
    await rm(state, { recursive: true, force: true })
  })
  const post = (input = command, options = {}) => fetch(`${connection.url}/execute`, {
    method: 'POST',
    headers: { authorization: `Bearer ${connection.token}`, 'content-type': 'application/json' },
    body: JSON.stringify(input),
    ...options,
  })
  return { state, record, approval, service, manager, approvalFile, post }
}

test('workspace execution waits for approval at the actual mount and passes only command inputs', { timeout: 10_000 }, async (t) => {
  let executed = false
  const f = await fixture(t, async (id, input, { onData }) => {
    executed = true
    assert.equal(id, 'a')
    assert.deepEqual(input, { agent: 'root', toolCallId: 'call-1', command: 'printf workspace', cwd: '/workspaces/7', timeout: 30 })
    await onData(Buffer.from('你好\n'))
    return { exitCode: 3 }
  }, 'ask')
  const response = f.post({ ...command, timeout: 30, env: { SECRET: 'must-not-cross' }, sandbox: 'untrusted' })
  const pending = await f.approval.promise
  assert.equal(pending.cwd, '/workspaces/7')
  assert.equal(executed, false)
  f.service.decide('a', pending.id, 'approve')
  const result = await response
  assert.equal(result.headers.get('content-type'), 'application/x-ndjson')
  assert.deepEqual((await result.text()).trim().split('\n').map(JSON.parse), [
    { type: 'data', data: Buffer.from('你好\n').toString('base64') },
    { type: 'exit', exitCode: 3 },
  ])
})

test('rejection, wrong session, invalid timeout and invalid token never dispatch a workspace command', { timeout: 10_000 }, async (t) => {
  const f = await fixture(t, () => assert.fail('Denied command executed'), 'ask')
  const response = f.post()
  f.service.decide('a', (await f.approval.promise).id, 'reject')
  assert.equal((await response).status, 403)
  assert.equal((await f.post({ ...command, sessionId: 'another-session' })).status, 403)
  assert.equal((await f.post({ ...command, timeout: 0 })).status, 400)
  assert.equal((await f.post(command, { headers: { authorization: 'Bearer invalid' } })).status, 401)
  f.service.cancelSession('a')
  f.record.permissionMode = 'full'
  assert.equal((await f.post()).status, 403)
})

test('stopping a session waits for the executor to settle and sends an error instead of a successful exit', { timeout: 10_000 }, async (t) => {
  const started = Promise.withResolvers()
  const cancelled = Promise.withResolvers()
  const confirmed = Promise.withResolvers()
  const f = await fixture(t, async (_id, _input, { signal }) => {
    signal.addEventListener('abort', () => cancelled.resolve(), { once: true })
    started.resolve()
    await confirmed.promise
    throw new Error('aborted')
  })
  const response = await f.post()
  await started.promise
  const result = response.text()
  f.service.cancelSession('a')
  await cancelled.promise
  assert.equal(f.service.executions.size, 1)
  confirmed.resolve()
  assert.deepEqual((await result).trim().split('\n').map(JSON.parse), [{ type: 'error', message: 'aborted' }])
  assert.equal(f.service.executions.size, 0)
})

test('an HTTP disconnect aborts the actual execution signal', { timeout: 10_000 }, async (t) => {
  const cancelled = Promise.withResolvers()
  const f = await fixture(t, async (_id, _input, { signal }) => {
    await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }))
    cancelled.resolve()
    throw new Error('aborted')
  })
  const controller = new AbortController()
  const response = await f.post(command, { signal: controller.signal })
  const result = assert.rejects(response.text(), { name: 'AbortError' })
  controller.abort()
  await cancelled.promise
  await result
})

test('stopping one conversation leaves another conversation workspace command running', { timeout: 10_000 }, async (t) => {
  const tasks = new Map(['a', 'b'].map((id) => [id, { finished: Promise.withResolvers(), signal: null }]))
  const f = await fixture(t, async (id, _input, { signal }) => {
    const task = tasks.get(id)
    task.signal = signal
    signal.addEventListener('abort', () => task.finished.resolve(), { once: true })
    await task.finished.promise
    signal.throwIfAborted()
    return { exitCode: 0 }
  })
  const records = new Map([['a', f.record], ['b', { id: 'b', permissionMode: 'full', approvals: [] }]])
  f.manager.record = (id) => records.get(id)
  f.manager.workspaceDirectory = async (id) => `/workspaces/${id}`
  const connection = JSON.parse(await readFile(f.service.connection('b', f.state), 'utf8'))
  const first = await f.post()
  const second = await f.post({ ...command, sessionId: 'b' }, { headers: { authorization: `Bearer ${connection.token}` } })
  f.service.cancelSession('a')
  assert.equal(tasks.get('a').signal.aborted, true)
  assert.equal(tasks.get('b').signal.aborted, false)
  assert.equal(JSON.parse((await first.text()).trim()).type, 'error')
  tasks.get('b').finished.resolve()
  assert.deepEqual(JSON.parse((await second.text()).trim()), { type: 'exit', exitCode: 0 })
})

test('parent and generated child use the workspace transport and never run the command locally', { timeout: 15_000 }, async (t) => {
  const calls = []
  const f = await fixture(t, async (_id, input, { onData }) => {
    calls.push(input)
    await onData(Buffer.from('remote only\n'))
    return { exitCode: 0 }
  })
  const capture = (extension) => {
    let tool
    extension({ registerTool: (registered) => { tool = registered }, on: () => {} })
    return tool
  }
  const root = capture(createConnectBashExtension({ cwd: f.state, env: {}, traceDir: join(f.state, 'traces'), agent: 'root', approvalFile: f.approvalFile, workspace: true }))
  const adapter = await createConnectExtensions({ cwd: f.state, agentDir: join(f.state, 'pi'), runDir: join(f.state, 'run'), approvalFile: f.approvalFile, workspace: true })
  const child = capture((await import(pathToFileURL(adapter.childExtensionPath).href)).default)
  const ctx = { cwd: f.state, sessionManager: { getSessionId: () => 'nested-child', getSessionFile: () => null } }
  for (const [name, tool] of [['parent', root], ['child', child]]) {
    const result = await tool.execute(name, { command: 'printf local > local-marker.txt', timeout: 5 }, undefined, undefined, ctx)
    assert.match(result.content[0].text, /remote only/)
  }
  assert.deepEqual(calls.map((call) => call.agent), ['root', 'child-nested-child'])
  assert.ok(calls.every((call) => call.cwd === '/workspaces/7'))
  await assert.rejects(readFile(join(f.state, 'local-marker.txt')), { code: 'ENOENT' })
  await writeFile(f.approvalFile, '{}')
  await assert.rejects(child.execute('missing-host', { command: 'touch local-marker.txt' }, undefined, undefined, ctx), /not configured/)
  await assert.rejects(readFile(join(f.state, 'local-marker.txt')), { code: 'ENOENT' })
})

test('workspace transport decodes split frames and refuses a stream without terminal proof', { timeout: 10_000 }, async (t) => {
  const state = await mkdtemp(join(tmpdir(), 'connect-workspace-stream-'))
  const server = createServer(async (req, res) => {
    for await (const _ of req) { /* Consume the request before responding. */ }
    res.writeHead(200, { 'content-type': 'application/x-ndjson' })
    const frame = JSON.stringify({ type: 'data', data: Buffer.from('streamed').toString('base64') }) + '\n'
    res.write(frame.slice(0, 13))
    res.end(frame.slice(13))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
    await rm(state, { recursive: true, force: true })
  })
  const approvalFile = join(state, 'connection.json')
  await writeFile(approvalFile, JSON.stringify({ url: `http://127.0.0.1:${server.address().port}`, token: 'fixture', sessionId: 'a' }))
  const output = []
  const operations = createWorkspaceBashOperations({ approvalFile, agent: 'root', toolCallId: 'stream' })
  await assert.rejects(operations.exec('pwd', state, { onData: (data) => output.push(data) }), /before command completion was confirmed/)
  assert.equal(Buffer.concat(output).toString(), 'streamed')
})
