import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createConnectExtensions } from '../agents/extensions.js'
import { createConnectBashExtension } from '../agents/child-extension.js'

test('parent and generated child bash tools wait for approval, deny, abort, and reread the connection', { timeout: 10_000 }, async (t) => {
  const state = await mkdtemp(join(tmpdir(), 'connect-approval-tool-'))
  const approvalFile = join(state, 'approval-connection.json')
  const requests = []
  const waiters = []
  const server = createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const request = { url: req.url, authorization: req.headers.authorization, body: JSON.parse(Buffer.concat(chunks).toString()), res }
    const resolve = waiters.shift()
    if (resolve) resolve(request)
    else requests.push(request)
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  t.after(async () => {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
    await rm(state, { recursive: true, force: true })
  })
  const base = `http://127.0.0.1:${server.address().port}`
  const connection = { url: base, token: 'fixture-request-token', sessionId: 'parent-session' }
  await writeFile(approvalFile, JSON.stringify(connection))
  const nextRequest = () => requests.length ? Promise.resolve(requests.shift()) : new Promise((resolve) => waiters.push(resolve))
  const decide = (request, decision, status = 200) => {
    request.res.writeHead(status, { 'content-type': 'application/json' })
    request.res.end(JSON.stringify(decision))
  }
  const context = {
    cwd: state,
    sessionManager: { getSessionId: () => 'child-session', getSessionFile: () => null },
  }
  const capture = (extension) => {
    let tool
    extension({ registerTool: (value) => { tool = value }, on: () => {} })
    return tool
  }
  const parent = capture(createConnectBashExtension({ cwd: state, env: {}, traceDir: join(state, 'traces'), agent: 'root', approvalFile }))
  const adapter = await createConnectExtensions({ cwd: state, agentDir: join(state, 'pi'), runDir: join(state, 'run'), approvalFile })
  const wrapper = await readFile(adapter.childExtensionPath, 'utf8')
  assert.ok(wrapper.includes(JSON.stringify(approvalFile)))
  assert.ok(!wrapper.includes(connection.token))
  assert.ok(!wrapper.includes('approvalMode'))
  const child = capture((await import(pathToFileURL(adapter.childExtensionPath).href)).default)

  const parentWork = parent.execute('parent-call', { command: 'printf approved > approved.txt' }, undefined, undefined, context)
  const pending = await nextRequest()
  await assert.rejects(readFile(join(state, 'approved.txt')), { code: 'ENOENT' })
  assert.equal(pending.url, '/request')
  assert.equal(pending.authorization, 'Bearer fixture-request-token')
  assert.deepEqual(pending.body, { sessionId: 'parent-session', agent: 'root', toolCallId: 'parent-call', command: 'printf approved > approved.txt', cwd: state })
  decide(pending, { approved: true })
  await parentWork
  assert.equal(await readFile(join(state, 'approved.txt'), 'utf8'), 'approved')

  // A child generated before the host's connection changes reads the new file.
  await writeFile(approvalFile, JSON.stringify({ ...connection, url: `${base}/restarted`, token: 'rotated-request-token' }))
  const deniedWork = child.execute('denied-call', { command: 'printf denied > denied.txt' }, undefined, undefined, context)
  const deniedResult = assert.rejects(deniedWork, /Rejected by the user/)
  const denied = await nextRequest()
  assert.equal(denied.url, '/restarted/request')
  assert.equal(denied.authorization, 'Bearer rotated-request-token')
  assert.equal(denied.body.agent, 'child-child-session')
  decide(denied, { approved: false, reason: 'Rejected by the user' })
  await deniedResult
  await assert.rejects(readFile(join(state, 'denied.txt')), { code: 'ENOENT' })

  const childWork = child.execute('child-approved-call', { command: 'printf child-approved > child-approved.txt' }, undefined, undefined, context)
  decide(await nextRequest(), { approved: true })
  await childWork
  assert.equal(await readFile(join(state, 'child-approved.txt'), 'utf8'), 'child-approved')

  const controller = new AbortController()
  const abortedWork = child.execute('aborted-call', { command: 'printf aborted > aborted.txt' }, controller.signal, undefined, context)
  const abortedResult = assert.rejects(abortedWork, { name: 'AbortError' })
  const aborted = await nextRequest()
  controller.abort()
  await abortedResult
  decide(aborted, { approved: true })
  await assert.rejects(readFile(join(state, 'aborted.txt')), { code: 'ENOENT' })

  const errorWork = child.execute('http-error-call', { command: 'printf error > error.txt' }, undefined, undefined, context)
  const errorResult = assert.rejects(errorWork, /not approved/)
  decide(await nextRequest(), { approved: true }, 503)
  await errorResult
  await assert.rejects(readFile(join(state, 'error.txt')), { code: 'ENOENT' })

  await writeFile(approvalFile, '{}')
  await assert.rejects(child.execute('config-error-call', { command: 'printf config > config.txt' }, undefined, undefined, context), /not configured/)
  await assert.rejects(readFile(join(state, 'config.txt')), { code: 'ENOENT' })

  await writeFile(approvalFile, JSON.stringify(connection))
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
  await assert.rejects(child.execute('network-error-call', { command: 'printf network > network.txt' }, undefined, undefined, context), /fetch failed/)
  await assert.rejects(readFile(join(state, 'network.txt')), { code: 'ENOENT' })
})
