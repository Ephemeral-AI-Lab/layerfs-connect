// Opt-in: real Docker/LayerFS + Pi + pi-subagents, in a private disposable home.
// CONNECT_REAL_LAYERFS=1 node --import ./host/resolve-layerfs.js --test host/test/agent-layerfs-real.test.js
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as pause } from 'node:timers/promises'
import test from 'node:test'
import { DefaultResourceLoader } from '@earendil-works/pi-coding-agent'
import { AgentManager } from '../agents/index.js'
import { AgentWorkspaces } from '../agents/workspaces.js'

const content = (value) => typeof value === 'string' ? value : (value ?? []).filter((part) => part.type === 'text').map((part) => part.text).join('\n')

test('real LayerFS isolates Pi and child bash, saves history, resumes and stops actual commands', {
  skip: process.env.CONNECT_REAL_LAYERFS !== '1', timeout: 180_000,
}, async (t) => {
  const { openRuntime, readSettings, resolveSpec, writeSettings } = await import('../config.js')
  const { Projects } = await import('../projects.js')
  const state = await mkdtemp(join(tmpdir(), 'connect-layerfs-real-'))
  const source = join(state, 'source')
  await mkdir(source)
  await writeFile(join(source, 'seed.txt'), 'imported seed\n')
  await writeFile(join(source, 'AGENTS.md'), 'Use bash to work on files in this project.\n')
  const settings = readSettings(join(homedir(), '.layerfs-connect'))
  writeSettings(state, { ...settings, containerPrefix: `lcw-${process.pid}-` })
  const spec = resolveSpec(state)
  const projects = new Projects({ spec, log: () => {} })
  const runtime = await openRuntime(spec)
  const name = `workspace-test-${process.pid}`
  let manager
  let madeProject = false
  const requests = []
  const server = createServer(async (req, res) => {
    let raw = ''
    for await (const chunk of req) raw += chunk
    const request = JSON.parse(raw)
    requests.push(request)
    const prompt = content(request.messages.findLast((message) => message.role === 'user')?.content)
    const hasTool = request.messages.at(-1)?.role === 'tool'
    let answer = { text: 'Completed workspace task.' }
    if (!hasTool) {
      if (prompt.includes('CHILD_WRITE')) answer = { tool: 'bash', args: { command: 'cat root.txt; printf child > child.txt' } }
      else if (prompt.includes('DELEGATE')) answer = { tool: 'subagent', args: { agent: 'connect-worker', task: 'CHILD_WRITE', async: false } }
      else if (prompt.includes('WRITE_ROOT')) answer = { tool: 'bash', args: { command: 'pwd; cat seed.txt; printf root > root.txt; echo ROOT_WRITTEN' } }
      else if (prompt.includes('LONG_COMMAND')) answer = { tool: 'bash', args: { command: 'printf started > partial.txt; echo RUNNING_IN_WORKSPACE; sleep 20; printf late > must-not-exist.txt' } }
      else if (prompt.includes('RESUME')) answer = { tool: 'bash', args: { command: 'cat root.txt child.txt; echo RESUMED' } }
      else if (prompt.includes('NONZERO')) answer = { tool: 'bash', args: { command: 'printf failure-saved > failure.txt; exit 7' } }
      else if (prompt.includes('WRITE_EDITED')) answer = { tool: 'bash', args: { command: 'test ! -e root.txt && test ! -e child.txt && printf edited > edited.txt; cat seed.txt' } }
      else if (prompt.includes('QUEUE_PARENT')) answer = { tool: 'bash', args: { command: 'printf before > queue-parent.txt; sleep 1; printf after > queue-parent.txt' } }
      else if (prompt.includes('QUEUED_WRITE')) answer = { tool: 'bash', args: { command: 'printf queued > queued-child.txt' } }
      else if (prompt.includes('DEFAULT_TIMEOUT')) answer = { tool: 'bash', args: { command: 'printf partial > timeout-partial.txt; echo TIMEOUT_STARTED; sleep 3; printf late > timeout-late.txt' } }
    }
    const id = randomUUID()
    const frame = (delta, finish_reason = null) => ({ id, object: 'chat.completion.chunk', created: 1, model: request.model, choices: [{ index: 0, delta, finish_reason }] })
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.write(`data: ${JSON.stringify(frame(answer.tool ? { role: 'assistant', tool_calls: [{ index: 0, id: `call_${id}`, type: 'function', function: { name: answer.tool, arguments: JSON.stringify(answer.args) } }] } : { role: 'assistant', content: answer.text }))}\n\n`)
    res.end(`data: ${JSON.stringify({ ...frame({}, answer.tool ? 'tool_calls' : 'stop'), usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } })}\n\ndata: [DONE]\n\n`)
  })
  t.after(async () => {
    const failures = []
    const clean = async (action) => { try { await action() } catch (error) { failures.push(error) } }
    await clean(() => manager?.close())
    await clean(() => projects.close())
    if (madeProject) await clean(() => runtime.project.remove(name, { confirm: name, stopSandboxes: true }))
    await clean(() => runtime.close())
    if (spec.worker) await clean(() => runtime.platform.docker(runtime.settings, ['rm', '-f', `${spec.prefix}worker`]))
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
    if (!failures.length) await rm(state, { recursive: true, force: true })
    if (failures.length) throw new AggregateError(failures, `Test cleanup failed; state retained at ${state}`)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  let job = await projects.create({ name, source })
  madeProject = true
  while (!job.ended) { await pause(100); job = await projects.init(job.id) }
  assert.equal(job.step, 'done', job.error?.message)
  const open = async () => {
    manager = await AgentManager.create({ state, defaultCwd: source, projectEnvironment: (project) => projects.record(project), projectWorkspaces: new AgentWorkspaces({ projects }) })
    await manager.models.configure({ provider: 'workspace-fixture', modelId: 'fixture-model', api: 'openai-completions', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, apiKey: 'local-fixture-key' })
  }
  const wait = async (id, predicate) => {
    for (let i = 0; i < 600; i++) {
      const current = manager.detail(id)
      if (predicate(current)) return current
      await pause(50)
    }
    throw new Error(`Session timeout: ${JSON.stringify(manager.detail(id))}`)
  }
  const settled = (id) => wait(id, (session) => session.state !== 'running')
  await open()
  const instruction = 'Connect harness integration instructions.'
  const chat = await manager.create({ project: name, permissionMode: 'full', limits: { instructions: instruction } })
  await manager.message(chat.id, { text: 'WRITE_ROOT' })
  const first = await settled(chat.id)
  assert.equal(first.state, 'idle', first.error)
  assert.equal(first.workspace.state, 'ready', first.workspace.error)
  assert.ok(first.workspace.commitCount > 0)
  // Exercise actual Linux output paging and UTF-8 boundaries without Pi's display truncation.
  const output = []
  await manager.executeWorkspace(chat.id, { command: "for ((i=0;i<50000;i++)); do printf '雪'; done", agent: 'root', toolCallId: 'large-output' }, { onData: (bytes) => output.push(bytes) })
  assert.deepEqual(Buffer.concat(output), Buffer.from('雪'.repeat(50000)))
  assert.equal((await projects.file(name, first.workspace.branch, '/root.txt')).text, 'root')
  assert.equal(existsSync(join(source, 'root.txt')), false)
  await assert.rejects(projects.file(name, 'main', '/root.txt'), { code: 'NoSuchPath' })
  await manager.message(chat.id, { text: 'DELEGATE' })
  const children = await settled(chat.id)
  assert.equal(children.state, 'idle', children.error)
  assert.ok(children.children.some((child) => child.agent === 'connect-worker' && child.state === 'completed'))
  assert.equal((await projects.file(name, first.workspace.branch, '/child.txt')).text, 'child')
  assert.equal(existsSync(join(source, 'child.txt')), false)
  assert.ok((await readdir(join(state, 'chats', chat.id, 'tool-output'))).length >= 2, 'Root and child output artifacts share the owning conversation.')
  const rootTool = children.messages.find((message) => message.toolName === 'bash' && String(message.args?.command).includes('ROOT_WRITTEN'))
  const outputArtifact = rootTool.outputArtifact ?? rootTool.details?.outputArtifact
  assert.ok(outputArtifact?.id)
  assert.match((await manager.output(chat.id, outputArtifact.id)).text, /ROOT_WRITTEN/)
  await manager.message(chat.id, { text: 'NONZERO' })
  await settled(chat.id)
  assert.equal((await projects.file(name, first.workspace.branch, '/failure.txt')).text, 'failure-saved')
  await manager.message(chat.id, { text: 'LONG_COMMAND' })
  await wait(chat.id, (session) => session.messages.some((message) => message.status === 'running' && message.text.includes('RUNNING_IN_WORKSPACE')))
  const stopped = await manager.stop(chat.id)
  assert.equal(stopped.workspace.state, 'closed', stopped.workspace.error)
  assert.equal((await projects.file(name, first.workspace.branch, '/partial.txt')).text, 'started')
  await assert.rejects(projects.file(name, first.workspace.branch, '/must-not-exist.txt'), { code: 'NoSuchPath' })
  await manager.message(chat.id, { text: 'RESUME immediately after Stop' })
  const continued = await settled(chat.id)
  assert.equal(continued.state, 'idle', continued.error)
  assert.equal(continued.workspace.state, 'ready', continued.workspace.error)
  assert.equal(continued.workspace.branch, first.workspace.branch)
  await manager.close()
  await open()
  await manager.message(chat.id, { text: 'RESUME' })
  const resumed = await settled(chat.id)
  assert.equal(resumed.state, 'idle', resumed.error)
  assert.equal(resumed.workspace.branch, first.workspace.branch)
  assert.ok(resumed.messages.some((message) => message.role === 'tool' && message.text.includes('RESUMED')))
  const second = await manager.create({ project: name, permissionMode: 'full' })
  assert.notEqual(second.workspace.branch, first.workspace.branch)
  await manager.executeWorkspace(second.id, { command: 'test ! -e root.txt && cat seed.txt && printf other > second.txt', agent: 'root', toolCallId: 'isolated-second' }, {})
  assert.equal((await projects.file(name, second.workspace.branch, '/second.txt')).text, 'other')
  await assert.rejects(projects.file(name, first.workspace.branch, '/second.txt'), { code: 'NoSuchPath' })
  assert.ok(requests.every((request) => !(request.tools ?? []).some((tool) => ['read', 'write', 'edit'].includes(tool.function?.name))))
  assert.equal(await readFile(join(source, 'seed.txt'), 'utf8'), 'imported seed\n')
  assert.ok((await projects.commits(name, first.workspace.branch)).length >= 4)

  // Conversation history uses real Pi entry IDs and immutable LayerFS checkpoints.
  const original = manager.detail(chat.id)
  const firstTurn = original.messages.find((message) => message.role === 'user' && message.text === 'WRITE_ROOT')
  const failedTurn = original.messages.find((message) => message.role === 'user' && message.text === 'NONZERO')
  assert.ok(firstTurn.entryId && firstTurn.canRestore)
  assert.ok(failedTurn.entryId && failedTurn.canRestore)
  const beforeCopyRequests = requests.length
  const duplicate = (await manager.fork(chat.id, {})).session
  assert.equal(requests.length, beforeCopyRequests, 'Copying history does not send a model request.')
  assert.notEqual(duplicate.id, chat.id)
  assert.notEqual(duplicate.workspace.branch, original.workspace.branch)
  assert.equal((await projects.file(name, duplicate.workspace.branch, '/root.txt')).text, 'root')
  assert.equal((await projects.file(name, duplicate.workspace.branch, '/child.txt')).text, 'child')
  assert.equal((await projects.file(name, duplicate.workspace.branch, '/failure.txt')).text, 'failure-saved')
  assert.equal(duplicate.limits.instructions, instruction)
  assert.match((await manager.output(duplicate.id, outputArtifact.id)).text, /ROOT_WRITTEN/)
  await manager.executeWorkspace(duplicate.id, { command: 'printf copy > copy-only.txt', agent: 'root', toolCallId: 'copy-isolated' }, {})
  await assert.rejects(projects.file(name, original.workspace.branch, '/copy-only.txt'), { code: 'NoSuchPath' })

  const beforeFailed = await manager.fork(duplicate.id, { entryId: failedTurn.entryId })
  assert.equal(beforeFailed.draft, 'NONZERO')
  assert.equal(beforeFailed.session.messages.some((message) => message.role === 'user' && message.text === 'NONZERO'), false)
  assert.equal((await projects.file(name, beforeFailed.session.workspace.branch, '/child.txt')).text, 'child')
  await assert.rejects(projects.file(name, beforeFailed.session.workspace.branch, '/failure.txt'), { code: 'NoSuchPath' })

  const reverted = await manager.rollback(chat.id, { entryId: failedTurn.entryId })
  assert.equal(reverted.draft, 'NONZERO')
  assert.notEqual(reverted.session.workspace.branch, original.workspace.branch)
  assert.equal(reverted.session.messages.some((message) => message.role === 'user' && message.text === 'NONZERO'), false)
  assert.equal((await projects.file(name, reverted.session.workspace.branch, '/root.txt')).text, 'root')
  assert.equal((await projects.file(name, reverted.session.workspace.branch, '/child.txt')).text, 'child')
  await assert.rejects(projects.file(name, reverted.session.workspace.branch, '/failure.txt'), { code: 'NoSuchPath' })
  assert.equal((await projects.file(name, original.workspace.branch, '/failure.txt')).text, 'failure-saved', 'The abandoned branch stays intact.')

  // Editing the very first turn restores the initial immutable Layer, before any Commit.
  await manager.edit(chat.id, { entryId: firstTurn.entryId, text: 'WRITE_EDITED' })
  const edited = await settled(chat.id)
  assert.equal(edited.state, 'idle', edited.error)
  assert.equal(edited.messages.some((message) => message.role === 'user' && message.text === 'WRITE_ROOT'), false)
  assert.equal(edited.messages.some((message) => message.role === 'user' && message.text === 'WRITE_EDITED'), true)
  assert.equal((await projects.file(name, edited.workspace.branch, '/edited.txt')).text, 'edited')
  await assert.rejects(projects.file(name, edited.workspace.branch, '/root.txt'), { code: 'NoSuchPath' })
  assert.equal((await projects.file(name, duplicate.workspace.branch, '/root.txt')).text, 'root')

  const editedEntry = edited.messages.find((message) => message.role === 'user' && message.text === 'WRITE_EDITED').entryId
  const editedBranch = edited.workspace.branch
  await manager.close()
  await open()
  const restoredHistory = manager.detail(chat.id)
  assert.equal(restoredHistory.workspace.branch, editedBranch)
  assert.equal(restoredHistory.messages.find((message) => message.role === 'user' && message.text === 'WRITE_EDITED').entryId, editedEntry)
  assert.equal(restoredHistory.messages.some((message) => message.role === 'user' && message.text === 'NONZERO'), false)

  // Queued and steering user messages get their own checkpoint when actually consumed.
  for (const mode of ['followUp', 'steer']) {
    await manager.message(chat.id, { text: `QUEUE_PARENT ${mode}` })
    await wait(chat.id, (session) => session.messages.some((message) => message.role === 'tool' && message.status === 'running' && String(message.args?.command).includes('queue-parent.txt')))
    await manager.message(chat.id, { text: `QUEUED_WRITE ${mode}`, mode })
    const queued = await wait(chat.id, (session) => session.state !== 'running' && session.messages.some((message) => message.role === 'user' && message.text === `QUEUED_WRITE ${mode}`))
    assert.equal(queued.state, 'idle', queued.error)
    const target = queued.messages.find((message) => message.role === 'user' && message.text === `QUEUED_WRITE ${mode}`)
    assert.ok(target.entryId && target.canRestore)
    assert.equal((await projects.file(name, queued.workspace.branch, '/queued-child.txt')).text, 'queued')
    const point = await manager.rollback(chat.id, { entryId: target.entryId })
    assert.equal((await projects.file(name, point.session.workspace.branch, '/queue-parent.txt')).text, 'after')
    await assert.rejects(projects.file(name, point.session.workspace.branch, '/queued-child.txt'), { code: 'NoSuchPath' })
  }

  await manager.updateLimits(chat.id, { bashTimeoutSeconds: 1 })
  await manager.message(chat.id, { text: 'DEFAULT_TIMEOUT' })
  const timedOut = await settled(chat.id)
  assert.ok(timedOut.messages.some((message) => message.role === 'tool' && message.status === 'error' && /timed out|timeout/i.test(message.text)))
  assert.equal((await projects.file(name, timedOut.workspace.branch, '/timeout-partial.txt')).text, 'partial')
  await assert.rejects(projects.file(name, timedOut.workspace.branch, '/timeout-late.txt'), { code: 'NoSuchPath' })
  const toolsBeforeContinue = timedOut.messages.filter((message) => message.role === 'tool').length
  await manager.continue(chat.id)
  const continuedFromState = await settled(chat.id)
  assert.equal(continuedFromState.state, 'idle', continuedFromState.error)
  assert.equal(continuedFromState.messages.filter((message) => message.role === 'tool').length, toolsBeforeContinue, 'Continue does not replay completed commands.')
  assert.ok(continuedFromState.usage.totalTokens > 0)
  await manager.update(chat.id, { title: 'Harness restored conversation', archived: true })
  assert.equal(manager.detail(chat.id).workspace.state, 'closed')
  await assert.rejects(manager.message(chat.id, { text: 'Blocked while archived' }), /Restore/)
  await manager.update(chat.id, { archived: false })
  assert.equal(manager.detail(chat.id).title, 'Harness restored conversation')

  // Native images and text-file metadata remain editable after a copy and restart.
  await manager.models.saveProvider({ id: 'workspace-fixture', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, api: 'openai-completions', models: [{ id: 'fixture-model', input: ['text', 'image'] }] })
  const attached = await manager.create({ project: name, permissionMode: 'full', limits: { instructions: instruction } })
  const attachments = [
    { id: 'text-fixture', name: 'note.txt', mimeType: 'text/plain', data: Buffer.from('Attachment integration text.').toString('base64') },
    { id: 'image-fixture', name: 'icon.png', mimeType: 'image/png', data: (await readFile(new URL('../../resources/icon.png', import.meta.url))).toString('base64') },
  ]
  await manager.message(attached.id, { text: 'ATTACHMENTS_ROUNDTRIP', attachments })
  const attachmentResult = await settled(attached.id)
  assert.equal(attachmentResult.state, 'idle', attachmentResult.error)
  const attachedMessage = attachmentResult.messages.find((message) => message.role === 'user')
  assert.equal(attachedMessage.text, 'ATTACHMENTS_ROUNDTRIP')
  assert.equal(attachedMessage.attachments.length, 2)
  const nativeRequest = requests.findLast((request) => content(request.messages.findLast((message) => message.role === 'user')?.content).includes('ATTACHMENTS_ROUNDTRIP'))
  assert.ok(nativeRequest.messages.at(-1).content.some((part) => part.type === 'image_url'))
  assert.match(content(nativeRequest.messages.at(-1).content), /Attachment integration text\./)
  const attachmentCopy = (await manager.fork(attached.id)).session
  assert.equal(attachmentCopy.messages.find((message) => message.role === 'user').attachments.length, 2)
  await manager.close()
  await open()
  assert.equal(manager.detail(attachmentCopy.id).messages.find((message) => message.role === 'user').attachments.length, 2)
  assert.ok(requests.every((request) => request.messages.filter((message) => ['system', 'developer'].includes(message.role)).some((message) => content(message.content).includes('Use bash to work on files in this project.'))), 'Every root and child request receives the actual LayerFS AGENTS.md.')
  assert.ok(requests.every((request) => request.messages.filter((message) => ['system', 'developer'].includes(message.role)).some((message) => content(message.content).includes(instruction))), 'Conversation instructions also reach children and copies.')

  // Native plugin session controls must keep the same real project file state.
  const originalReload = DefaultResourceLoader.prototype.reload
  let nativeStarts = 0
  DefaultResourceLoader.prototype.reload = async function (...args) {
    const factories = this.extensionFactories
    this.extensionFactories = [...factories, { name: 'real-native-session-fixture', factory: (pi) => {
      pi.on('session_start', () => { nativeStarts++ })
      pi.registerCommand('native-new', { handler: async (_args, ctx) => {
        await ctx.newSession({ withSession: async (fresh) => {
          await fresh.sendMessage({ customType: 'real-native-new', content: 'Native session ready', display: true })
        } })
      } })
      pi.registerCommand('native-reload', { handler: async (_args, ctx) => { await ctx.reload() } })
    } }]
    try { return await originalReload.apply(this, args) }
    finally { this.extensionFactories = factories }
  }
  try {
    const requestCount = requests.length
    const before = manager.detail(chat.id)
    const native = await manager.message(chat.id, { text: '/native-new' })
    assert.notEqual(native.id, chat.id)
    assert.notEqual(native.workspace.branch, before.workspace.branch)
    assert.equal(native.project, name)
    assert.equal(manager.detail(chat.id).workspace.state, 'closed')
    assert.equal(native.messages.filter((message) => message.role === 'user').length, 0)
    assert.ok(native.messages.some((message) => message.text === 'Native session ready'))
    assert.equal((await projects.file(name, native.workspace.branch, '/timeout-partial.txt')).text, 'partial')
    await assert.rejects(projects.file(name, 'main', '/timeout-partial.txt'), { code: 'NoSuchPath' })
    const starts = nativeStarts
    const file = manager.record(native.id).sessionFile
    const reloaded = await manager.message(native.id, { text: '/native-reload' })
    assert.equal(reloaded.id, native.id)
    assert.equal(reloaded.workspace.branch, native.workspace.branch)
    assert.equal(manager.record(native.id).sessionFile, file)
    assert.equal(nativeStarts, starts + 1)
    assert.equal(requests.length, requestCount, 'Native control commands do not call the model.')
  } finally { DefaultResourceLoader.prototype.reload = originalReload }
})
