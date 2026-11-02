import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as pause } from 'node:timers/promises'
import test, { after } from 'node:test'
import { DefaultResourceLoader } from '@earendil-works/pi-coding-agent'
import { loadExtensionFromFactory } from '../../node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js'
import { AgentManager } from '../agents/index.js'

const state = await mkdtemp(join(tmpdir(), 'connect-native-input-state-'))
after(() => rm(state, { recursive: true, force: true }))
const content = (value) => typeof value === 'string' ? value : (value ?? []).filter((part) => part.type === 'text').map((part) => part.text).join('\n')
const lastUser = (request) => content(request.messages.findLast((message) => message.role === 'user')?.content)

async function fixture(t, extension, respond = () => 'Done.') {
  const cwd = await mkdtemp(join(tmpdir(), 'connect-native-input-work-'))
  const requests = []
  const original = DefaultResourceLoader.prototype.reload
  DefaultResourceLoader.prototype.reload = async function (options) {
    await original.call(this, options)
    const result = this.getExtensions()
    result.extensions.push(await loadExtensionFromFactory(extension, cwd, this.eventBus, result.runtime, '<native-input-test>'))
  }
  const server = createServer(async (req, res) => {
    let raw = ''
    for await (const part of req) raw += part
    const request = JSON.parse(raw)
    requests.push(request)
    const answer = await respond(request)
    const id = randomUUID()
    const frame = (delta, finish_reason = null) => ({ id, object: 'chat.completion.chunk', created: 1, model: request.model, choices: [{ index: 0, delta, finish_reason }] })
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.write(`data: ${JSON.stringify(frame({ role: 'assistant', content: answer }))}\n\n`)
    res.end(`data: ${JSON.stringify({ ...frame({}, 'stop'), usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })}\n\ndata: [DONE]\n\n`)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  let manager = await AgentManager.create({ state, defaultCwd: cwd })
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`
  await manager.models.configure({ provider: 'native-input-fixture', modelId: 'fixture', api: 'openai-completions', baseUrl, apiKey: 'local-native-input-key' })
  const cleanup = []
  t.after(async () => {
    for (const finish of cleanup) finish()
    await manager.close()
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
    DefaultResourceLoader.prototype.reload = original
    await rm(cwd, { recursive: true, force: true })
  })
  const wait = async (id, predicate = (session) => session.state !== 'running') => {
    for (let index = 0; index < 1000; index++) {
      const value = manager.detail(id)
      if (predicate(value)) return value
      await pause(10)
    }
    throw new Error(`Native input timed out: ${JSON.stringify(manager.detail(id))}`)
  }
  return { manager, requests, wait, cleanup: (fn) => cleanup.push(fn) }
}

const ui = (input) => ({ input, select: async () => undefined, confirm: async () => false, editor: async () => undefined, custom: async () => undefined })

test('native commands and handled input are accepted without fake user entries; busy commands preserve the model task and queue', async (t) => {
  let commands = 0, handled = 0
  const gate = Promise.withResolvers(), started = Promise.withResolvers()
  const f = await fixture(t, (pi) => {
    pi.registerCommand('local-native', { handler: async () => { commands++; pi.appendEntry('native.local', { commands }) } })
    pi.registerCommand('native-error', { handler: async () => { throw new Error('Local command failed') } })
    pi.on('input', (event) => { if (event.text === 'HANDLED') { handled++; return { action: 'handled' } } })
  }, async (request) => {
    if (lastUser(request) === 'HOLD') { started.resolve(); await gate.promise }
    return 'Finished.'
  })
  f.cleanup(() => gate.resolve())
  const chat = await f.manager.create()
  const command = await f.manager.message(chat.id, { text: '/local-native' })
  assert.equal(command.state, 'idle')
  assert.equal(command.error, null)
  assert.equal(commands, 1)
  assert.equal(command.messages.filter((message) => message.role === 'user').length, 0)
  const intercepted = await f.manager.message(chat.id, { text: 'HANDLED' })
  assert.equal(intercepted.error, null)
  assert.equal(handled, 1)
  assert.equal(f.requests.length, 0)
  await f.manager.message(chat.id, { text: 'HOLD' })
  await started.promise
  const active = f.manager.live.get(chat.id)
  const modelTask = active.task
  await f.manager.message(chat.id, { text: 'NEXT' })
  const busy = await f.manager.message(chat.id, { text: '/local-native' })
  assert.equal(busy.state, 'running')
  assert.equal(active.task, modelTask)
  assert.equal(commands, 2)
  await assert.rejects(f.manager.message(chat.id, { text: '/native-error' }), /Local command failed/)
  assert.equal(active.task, modelTask)
  assert.equal(f.manager.detail(chat.id).queued.length, 1)
  assert.equal(f.manager.detail(chat.id).error, null)
  gate.resolve()
  const result = await f.wait(chat.id)
  assert.equal(result.state, 'idle', result.error)
  assert.deepEqual(f.requests.map(lastUser), ['HOLD', 'NEXT'])
})

test('promoting a queue item respects handled and transform results and retains image input', async (t) => {
  const gate = Promise.withResolvers(), started = Promise.withResolvers()
  const seen = []
  const f = await fixture(t, (pi) => pi.on('input', (event) => {
    seen.push({ text: event.text, mode: event.streamingBehavior, images: event.images?.length ?? 0 })
    if (event.text === 'DROP' && event.streamingBehavior === 'steer') return { action: 'handled' }
    if (event.text === 'IMAGE' && event.streamingBehavior === 'followUp') return { action: 'transform', text: 'PREPARED IMAGE' }
    if (event.text === 'PREPARED IMAGE' && event.streamingBehavior === 'steer') return { action: 'transform', text: 'STEERED IMAGE' }
  }), async (request) => {
    if (lastUser(request) === 'HOLD') { started.resolve(); await gate.promise }
    return 'Done.'
  })
  f.cleanup(() => gate.resolve())
  assert.equal(f.manager.models.snapshot().models.find((model) => model.provider === 'native-input-fixture' && model.id === 'fixture').input, undefined)
  const chat = await f.manager.create()
  await f.manager.message(chat.id, { text: 'HOLD' }); await started.promise
  const drop = await f.manager.message(chat.id, { text: 'DROP' })
  await f.manager.updateQueued(chat.id, drop.queued[0].id, 'steer')
  assert.deepEqual(f.manager.detail(chat.id).queued, [])
  const image = { id: 'native-image', name: 'icon.png', mimeType: 'image/png', data: (await readFile(new URL('../../resources/icon.png', import.meta.url))).toString('base64') }
  const pending = await f.manager.message(chat.id, { text: 'IMAGE', attachments: [image] })
  await f.manager.updateQueued(chat.id, pending.queued[0].id, 'steer')
  assert.ok(seen.some((event) => event.text === 'PREPARED IMAGE' && event.mode === 'steer' && event.images === 1))
  gate.resolve(); await f.wait(chat.id)
  assert.deepEqual(f.requests.map(lastUser), ['HOLD', 'STEERED IMAGE'])
  assert.ok(f.requests.at(-1).messages.at(-1).content.some((part) => part.type === 'image_url'))
  const message = f.manager.detail(chat.id).messages.find((item) => item.role === 'user' && item.text === 'IMAGE')
  assert.equal(message.attachments[0].data, image.data)
})

test('a queued transform awaited past model completion runs once and is not transformed again', async (t) => {
  const hold = Promise.withResolvers(), started = Promise.withResolvers(), transform = Promise.withResolvers(), transforming = Promise.withResolvers()
  let transforms = 0
  const f = await fixture(t, (pi) => pi.on('input', async (event) => {
    if (event.text === 'LATE') { transforms++; transforming.resolve(); await transform.promise; return { action: 'transform', text: 'TRANSFORMED LATE' } }
  }), async (request) => {
    if (lastUser(request) === 'HOLD') { started.resolve(); await hold.promise }
    return 'Done.'
  })
  f.cleanup(() => { hold.resolve(); transform.resolve() })
  const chat = await f.manager.create()
  await f.manager.message(chat.id, { text: 'HOLD' }); await started.promise
  const sending = f.manager.message(chat.id, { text: 'LATE' })
  await transforming.promise
  hold.resolve(); await f.wait(chat.id)
  transform.resolve(); await sending; await f.wait(chat.id)
  assert.equal(transforms, 1)
  assert.deepEqual(f.requests.map(lastUser), ['HOLD', 'TRANSFORMED LATE'])
  assert.equal(f.manager.detail(chat.id).messages.filter((message) => message.role === 'user' && message.text === 'LATE').length, 1)
})

for (const stage of ['input', 'command', 'before_agent_start']) {
  test(`Stop cancels a ${stage} dialog before a model run and ignores a late UI result`, async (t) => {
    const gate = Promise.withResolvers(), entered = Promise.withResolvers()
    let afterDialog = 0, signal
    const f = await fixture(t, (pi) => {
      const wait = async (ctx) => { await ctx.ui.input('Native dialog'); afterDialog++ }
      if (stage === 'command') pi.registerCommand('dialog-native', { handler: async (_args, ctx) => wait(ctx) })
      else if (stage === 'input') pi.on('input', async (event, ctx) => { if (event.text === 'WAIT') await wait(ctx) })
      else pi.on('before_agent_start', async (_event, ctx) => wait(ctx))
    })
    f.cleanup(() => gate.resolve('late'))
    const chat = await f.manager.create()
    const active = await f.manager.open(chat.id)
    await active.session.bindExtensions({ mode: 'rpc', uiContext: ui(async (_title, _placeholder, options) => { signal = options.signal; entered.resolve(); return gate.promise }) })
    const sending = f.manager.message(chat.id, { text: stage === 'command' ? '/dialog-native' : 'WAIT' })
    const rejected = assert.rejects(sending, { code: 'stopping' })
    await entered.promise
    if (stage !== 'before_agent_start') await assert.rejects(f.manager.message(chat.id, { text: 'CONCURRENT' }), /Wait for the plugin operation/)
    const stopping = f.manager.stop(chat.id)
    const stopped = await Promise.race([stopping, pause(1000).then(() => { throw new Error('Stop waited for the UI result') })])
    await rejected
    assert.equal(stopped.state, 'idle')
    assert.equal(signal.aborted, true)
    assert.equal(f.requests.length, 0)
    gate.resolve('late'); await pause(25)
    assert.equal(afterDialog, 0)
    assert.equal(f.requests.length, 0)
    assert.equal(f.manager.detail(chat.id).messages.filter((message) => message.role === 'user').length, 0)
    assert.equal(f.manager.detail(chat.id).error, null)
  })
}

for (const disposition of ['handled', 'transform']) {
  test(`an asynchronous Steer ${disposition} holds the follow-up when the main run settles first`, async (t) => {
    const main = Promise.withResolvers(), started = Promise.withResolvers(), promotion = Promise.withResolvers(), promoting = Promise.withResolvers()
    const f = await fixture(t, (pi) => pi.on('input', async (event) => {
      if (event.text === 'PENDING' && event.streamingBehavior === 'steer') {
        promoting.resolve(); await promotion.promise
        return disposition === 'handled' ? { action: 'handled' } : { action: 'transform', text: 'TRANSFORMED PENDING' }
      }
    }), async (request) => {
      if (lastUser(request) === 'HOLD') { started.resolve(); await main.promise }
      return 'Done.'
    })
    f.cleanup(() => { main.resolve(); promotion.resolve() })
    const chat = await f.manager.create()
    await f.manager.message(chat.id, { text: 'HOLD' }); await started.promise
    const pending = await f.manager.message(chat.id, { text: 'PENDING' })
    const active = f.manager.live.get(chat.id)
    const moving = f.manager.updateQueued(chat.id, pending.queued[0].id, 'steer')
    await promoting.promise
    main.resolve(); await active.task; await pause(25)
    assert.deepEqual(f.requests.map(lastUser), ['HOLD'], 'The original follow-up must remain held while the plugin decides.')
    assert.equal(f.manager.detail(chat.id).queued.length, 1)
    promotion.resolve(); await moving; const result = await f.wait(chat.id)
    assert.equal(result.error, null)
    assert.deepEqual(result.queued, [])
    assert.deepEqual(f.requests.map(lastUser), disposition === 'handled' ? ['HOLD'] : ['HOLD', 'TRANSFORMED PENDING'])
  })
}

test('Stop cancels a pending Steer operation after the model has finished', async (t) => {
  const main = Promise.withResolvers(), started = Promise.withResolvers(), promotion = Promise.withResolvers(), promoting = Promise.withResolvers()
  const f = await fixture(t, (pi) => pi.on('input', async (event) => {
    if (event.text === 'PENDING' && event.streamingBehavior === 'steer') { promoting.resolve(); await promotion.promise; return { action: 'transform', text: 'TOO LATE' } }
  }), async (request) => {
    if (lastUser(request) === 'HOLD') { started.resolve(); await main.promise }
    return 'Done.'
  })
  f.cleanup(() => { main.resolve(); promotion.resolve() })
  const chat = await f.manager.create()
  await f.manager.message(chat.id, { text: 'HOLD' }); await started.promise
  const pending = await f.manager.message(chat.id, { text: 'PENDING' })
  const moving = f.manager.updateQueued(chat.id, pending.queued[0].id, 'steer')
  const rejected = assert.rejects(moving, { code: 'stopping' })
  await promoting.promise
  main.resolve(); await f.manager.live.get(chat.id).task
  const stopping = f.manager.stop(chat.id)
  await rejected
  const result = await f.wait(chat.id)
  assert.equal(result.execution.phase, 'interrupted')
  assert.deepEqual(result.queued, [])
  promotion.resolve(); await stopping; await pause(25)
  assert.deepEqual(f.requests.map(lastUser), ['HOLD'])
})

test('the idle event permits immediate consecutive sends while the previous model lease is finishing', async (t) => {
  const f = await fixture(t, () => {})
  const chat = await f.manager.create()
  for (let index = 0; index < 12; index++) {
    const text = `FAST_${index}`
    const idle = Promise.withResolvers()
    const listener = (event) => {
      if (event.type === 'chat' && event.session.id === chat.id && event.session.state === 'idle' && event.session.messages.some((message) => message.role === 'user' && message.text === text)) {
        f.manager.off('event', listener)
        idle.resolve()
      }
    }
    f.manager.on('event', listener)
    await f.manager.message(chat.id, { text })
    await idle.promise
  }
  assert.deepEqual(f.requests.map(lastUser), Array.from({ length: 12 }, (_, index) => `FAST_${index}`))
  const result = await f.wait(chat.id)
  assert.equal(result.error, null)
  assert.equal(result.state, 'idle')
})

test('a native command can reenter its own pending cleanup without cancelling its lease', async (t) => {
  let manager, id, completed = false
  const f = await fixture(t, (pi) => pi.registerCommand('own-cleanup', { handler: async () => {
    const lease = manager.currentControl(id)
    const first = manager.stop(id)
    assert.equal(manager.stop(id), first)
    await first
    assert.equal(lease.signal.aborted, false)
    completed = true
  } }))
  manager = f.manager
  const chat = await manager.create(); id = chat.id
  const result = await manager.message(id, { text: '/own-cleanup' })
  assert.equal(completed, true)
  assert.equal(result.state, 'idle')
  assert.equal(result.error, null)
  assert.equal(f.requests.length, 0)
})
