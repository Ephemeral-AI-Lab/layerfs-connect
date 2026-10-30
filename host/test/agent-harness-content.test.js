import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createServer } from 'node:http'
import { normalizePrompt, promptDetails } from '../agents/attachments.js'
import { readProjectInstructions } from '../agents/context.js'
import { createConnectBashExtension } from '../agents/child-extension.js'
import { connectPrompt } from '../agents/prompt.js'
import { captureToolOutput, readToolOutput } from '../agents/tool-output.js'

const model = { input: ['text', 'image'] }
const attachment = (name, mimeType, text) => ({ id: name, name, mimeType, data: Buffer.from(text).toString('base64') })
async function fixture(t) {
  const path = await mkdtemp(join(tmpdir(), 'connect-harness-content-'))
  t.after(() => rm(path, { recursive: true, force: true }))
  return path
}
function extension(options) {
  const hooks = new Map()
  let tool
  createConnectBashExtension({ env: {}, ...options })({ on: (name, handler) => hooks.set(name, handler), registerTool: (value) => { tool = value } })
  return { hooks, tool }
}

test('attachments keep original text and bytes while images use native Pi content', () => {
  const files = [attachment('config.json', 'application/json', '{"hello":"你好"}'), attachment('screen.png', 'image/png', 'image-fixture')]
  const input = { text: 'Review these', attachments: files }
  const normalized = normalizePrompt(input, model)
  assert.match(normalized.text, /Review these\n\nAttached file "config.json"/)
  assert.match(normalized.text, /<attachment-content>\n\{"hello":"你好"\}\n<\/attachment-content>/)
  assert.deepEqual(normalized.images, [{ type: 'image', data: files[1].data, mimeType: 'image/png' }])
  assert.deepEqual(promptDetails(input, normalized), { connectText: input.text, connectAttachments: normalized.attachments })
  const edit = normalizePrompt({ text: 'Updated request', attachments: normalized.attachments }, model)
  assert.equal(edit.text.match(/<attachment-content>/g).length, 1)
  assert.equal(normalizePrompt({ attachments: [files[1]] }, model).text, '')
})

test('attachments reject unsupported models, binary data, malformed encoding and per-message limits', () => {
  assert.throws(() => normalizePrompt({ attachments: [attachment('a.png', 'image/png', 'a')] }, { input: ['text'] }), /does not support image/)
  assert.throws(() => normalizePrompt({ attachments: [attachment('a.zip', 'application/zip', 'a')] }, model), /Unsupported/)
  assert.throws(() => normalizePrompt({ attachments: [attachment('a.txt', 'text/plain', Buffer.from([0xff]))] }, model), /UTF-8/)
  assert.throws(() => normalizePrompt({ attachments: [attachment('a.txt', 'text/plain', '\0')] }, model), /binary data/)
  assert.throws(() => normalizePrompt({ attachments: [{ ...attachment('a.txt', 'text/plain', 'a'), data: '*bad*' }] }, model), /base64/)
  assert.throws(() => normalizePrompt({ attachments: Array.from({ length: 11 }, () => attachment('a.txt', 'text/plain', 'a')) }, model), /at most 10/)
  assert.throws(() => normalizePrompt({ attachments: [attachment('big.txt', 'text/plain', Buffer.alloc(1024 * 1024 + 1))] }, model), /1 MiB/)
  const bigImage = attachment('big.png', 'image/png', Buffer.alloc(10 * 1024 * 1024))
  assert.throws(() => normalizePrompt({ attachments: [bigImage, bigImage, attachment('one.txt', 'text/plain', '1')] }, model), /20 MiB/)
})

test('local parent and child instructions load before each run in scope order', async (t) => {
  const root = await fixture(t)
  const cwd = join(root, 'nested')
  await mkdir(cwd)
  await writeFile(join(root, 'AGENTS.md'), 'root instruction')
  await writeFile(join(cwd, 'AGENTS.override.md'), 'nested override')
  await writeFile(join(cwd, 'CLAUDE.md'), 'shadowed instruction')
  const files = (await readProjectInstructions(cwd)).filter((file) => file.path.startsWith(root))
  assert.deepEqual(files.map((file) => file.content), ['root instruction', 'nested override'])
  for (const agent of ['root', undefined]) {
    const { hooks } = extension({ cwd, agent, traceDir: join(root, 'traces'), instructions: 'custom request' })
    const result = await hooks.get('before_agent_start')({ systemPrompt: 'base' }, { cwd, abort: () => assert.fail('unexpected abort') })
    assert.match(result.systemPrompt, /root instruction/)
    assert.match(result.systemPrompt, /nested override/)
    assert.match(result.systemPrompt, /custom request/)
    assert.doesNotMatch(result.systemPrompt, /shadowed instruction/)
  }
})

test('project root and child use authenticated context bridge and abort on failed loading', async (t) => {
  const root = await fixture(t)
  let status = 200
  const requests = []
  const server = createServer(async (req, res) => {
    let body = ''
    for await (const chunk of req) body += chunk
    requests.push({ path: req.url, authorization: req.headers.authorization, body: JSON.parse(body) })
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(status === 200 ? { instructions: [{ path: '/workspaces/1/AGENTS.md', content: 'container instructions' }] } : { message: 'workspace unavailable' }))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve) }))
  const approvalFile = join(root, 'approval.json')
  await writeFile(approvalFile, JSON.stringify({ url: `http://127.0.0.1:${server.address().port}`, token: 'fixture-token', sessionId: 'fixture-session' }))
  const { hooks } = extension({ cwd: root, traceDir: join(root, 'traces'), workspace: true, approvalFile })
  const { hooks: rootHooks } = extension({ cwd: root, agent: 'root', traceDir: join(root, 'traces'), workspace: true, approvalFile })
  let aborted = false
  const ctx = { cwd: root, abort: () => { aborted = true } }
  const childPrompt = (await hooks.get('before_agent_start')({ systemPrompt: 'base' }, ctx)).systemPrompt
  const rootPrompt = (await rootHooks.get('before_agent_start')({ systemPrompt: connectPrompt({ cwd: root, project: 'demo', workspace: { branch: 'chat-demo', path: '/workspaces/1' } }) }, ctx)).systemPrompt
  assert.match(childPrompt, /container instructions/)
  assert.match(childPrompt, /mounted LayerFS FUSE Workspace/)
  assert.match(rootPrompt, /LayerFS project "demo", branch "chat-demo" mounted at "\/workspaces\/1"/)
  assert.match(rootPrompt, /container instructions/)
  assert.equal((rootPrompt.match(/mounted LayerFS FUSE Workspace/g) ?? []).length, 1)
  assert.deepEqual(requests[0], { path: '/context', authorization: 'Bearer fixture-token', body: { sessionId: 'fixture-session' } })
  status = 503
  await assert.rejects(hooks.get('before_agent_start')({ systemPrompt: 'base' }, ctx), /workspace unavailable/)
  assert.equal(aborted, true)
})

test('full output persists outside the project and pages UTF-8 without loss', async (t) => {
  const root = await fixture(t)
  const content = Buffer.from('a'.repeat(65535) + '你好🙂'.repeat(15000))
  const captured = captureToolOutput(root, 'root', 'tool-call', { exec: async (_command, _cwd, { onData }) => { onData(content); return { exitCode: 0 } } })
  await captured.operations.exec('fixture', root, { onData: () => {} })
  const artifact = captured.finish()
  let text = '', offset = 0
  do {
    const page = await readToolOutput(root, artifact.id, offset)
    assert.ok(page.nextOffset - offset <= 65536)
    assert.equal(page.bytes, content.length)
    assert.ok(page.nextOffset > offset)
    text += page.text
    offset = page.nextOffset
  } while (offset < artifact.bytes)
  assert.equal(text, content.toString())
  assert.equal((await readToolOutput(root, artifact.id, offset)).done, true)
  await assert.rejects(readToolOutput(root, '../outside'), /Invalid/)
  await assert.rejects(readToolOutput(root, artifact.id, -1), /Invalid/)
  await assert.rejects(readToolOutput(root, '0'.repeat(64)), { status: 404 })
})

test('real Pi bash defaults to the configured timeout and retains interrupted output', async (t) => {
  const root = await fixture(t)
  const { tool } = extension({ cwd: root, traceDir: join(root, 'traces'), defaultBashTimeoutSeconds: 0.05 })
  const ctx = { cwd: root, sessionManager: { getSessionId: () => 'child', getSessionFile: () => null } }
  const result = await tool.execute('timeout', { command: 'printf before-timeout; sleep 4; printf after-timeout' }, undefined, undefined, ctx)
  assert.equal(result.isError, true)
  assert.match(result.content[0].text, /timed out after 0.05 seconds/)
  const output = await readToolOutput(root, result.details.outputArtifact.id)
  assert.equal(output.text, 'before-timeout')
  const success = await tool.execute('explicit', { command: 'sleep 0.1; printf done', timeout: 2 }, undefined, undefined, ctx)
  assert.equal(success.isError, undefined)
  assert.equal((await readToolOutput(root, success.details.outputArtifact.id)).text, 'done')
  assert.equal(await readFile(join(root, 'tool-output', `${success.details.outputArtifact.id}.log`), 'utf8'), 'done')
})
