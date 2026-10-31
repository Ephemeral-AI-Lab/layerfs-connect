import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { ModelRuntime } from '@earendil-works/pi-coding-agent'
import { AgentModels } from '../agents/models.js'
import { agentRoute } from '../agents/routes.js'
import { normalizePrompt } from '../agents/attachments.js'

async function fixture(t, respond = () => ({ data: [{ id: 'first-model' }, { id: 'second-model' }] })) {
  const dir = await mkdtemp(join(tmpdir(), 'connect-model-sync-'))
  const requests = []
  const server = createServer(async (req, res) => {
    let body = ''
    for await (const part of req) body += part
    const request = { url: new URL(req.url, 'http://fixture'), headers: req.headers, method: req.method, body: body && JSON.parse(body) }
    requests.push(request)
    if (req.method === 'POST') {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      for (const choice of [
        { index: 0, delta: { role: 'assistant', content: 'OK' }, finish_reason: null },
        { index: 0, delta: {}, finish_reason: 'stop' },
      ]) res.write(`data: ${JSON.stringify({ id: 'test-reply', object: 'chat.completion.chunk', created: 1, model: request.body.model, choices: [choice] })}\n\n`)
      return res.end('data: [DONE]\n\n')
    }
    const reply = await respond(request)
    res.writeHead(reply.status ?? 200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(reply.body ?? reply))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
    await rm(dir, { recursive: true, force: true })
  })
  return { dir, requests, baseUrl: `http://127.0.0.1:${server.address().port}/v1`, models: await AgentModels.create(dir) }
}

const savedFiles = async (dir) => Object.fromEntries(await Promise.all(
  (await readdir(dir)).filter((name) => name.endsWith('.json')).map(async (name) => [name, await readFile(join(dir, name), 'utf8')]),
))
const settings = (baseUrl, provider = 'sync-fixture') => ({ provider, baseUrl, api: 'openai-completions', apiKey: 'local-sync-test-key' })

test('sync route registers every fetched ID with one reload; restart and real Pi can use the second model', { timeout: 20_000 }, async (t) => {
  const { dir, models, baseUrl, requests } = await fixture(t)
  await models.configure({ ...settings(baseUrl, 'previous-provider'), modelId: 'previous-model', reasoning: true, thinkingLevel: 'high' })
  const selected = { ...models.selected }
  const selectionFile = await readFile(models.selectionPath, 'utf8')
  let reloads = 0
  const reload = models.reload.bind(models)
  models.reload = async (...args) => { reloads++; await reload(...args) }
  const manager = { models, modelsSnapshot: () => ({ ...models.snapshot(), defaultCwd: '/fixture/workspace' }) }
  const result = await agentRoute(manager, 'POST', ['models', 'sync'], settings(baseUrl))
  assert.equal(result.source, 'remote')
  assert.equal(result.models.length, 2)
  assert.equal(reloads, 1)
  assert.equal(result.catalog.defaultCwd, '/fixture/workspace')
  assert.deepEqual(result.catalog.selected, selected)
  assert.deepEqual(result.catalog.models.filter((model) => model.provider === 'sync-fixture').map((model) => model.id), ['first-model', 'second-model'])
  assert.equal(result.catalog.providers.find((provider) => provider.id === 'sync-fixture').hasKey, true)
  assert.equal(JSON.stringify(result).includes('local-sync-test-key'), false)
  assert.equal((await stat(models.authPath)).mode & 0o777, 0o600)
  assert.equal(await readFile(models.selectionPath, 'utf8'), selectionFile)

  await models.sync(settings(baseUrl))
  assert.equal(reloads, 2)
  assert.equal(models.config.providers['sync-fixture'].models.length, 2)
  const restored = await AgentModels.create(dir)
  assert.deepEqual(restored.selected, selected)
  assert.equal(restored.resolve({ provider: 'sync-fixture', modelId: 'second-model' }).baseUrl, baseUrl)
  restored.select({ provider: 'sync-fixture', modelId: 'second-model' })
  assert.deepEqual(await restored.test(), { text: 'OK' })
  const invocation = requests.find((request) => request.method === 'POST')
  assert.equal(invocation.url.pathname, '/v1/chat/completions')
  assert.equal(invocation.body.model, 'second-model')
  assert.equal(invocation.body.stream, true)
  assert.equal(invocation.headers.authorization, 'Bearer local-sync-test-key')
})

test('API image capabilities survive restart and provider edits, and unknown models send real Pi images', { timeout: 20_000 }, async (t) => {
  let advertised = [
    { id: 'image-model', architecture: { input_modalities: ['text', 'image'] } },
    { id: 'text-model', capabilities: { image_input: { supported: false } } },
    { id: 'unknown-model' },
  ]
  const { dir, models, baseUrl, requests } = await fixture(t, () => ({ data: advertised }))
  await models.sync(settings(baseUrl))
  const restored = await AgentModels.create(dir)
  const expected = new Map([
    ['image-model', ['text', 'image']], ['text-model', ['text']], ['unknown-model', undefined],
  ])
  const checkCapabilities = (current) => {
    const snapshot = current.snapshot()
    const provider = snapshot.providers.find((provider) => provider.id === 'sync-fixture')
    for (const [id, input] of expected) {
      assert.deepEqual(snapshot.models.find((model) => model.provider === provider.id && model.id === id).input, input, id)
      assert.deepEqual(provider.savedModels.find((model) => model.id === id).input, input, id)
      assert.deepEqual(current.resolve({ provider: provider.id, modelId: id }).input, input ?? ['text', 'image'], id)
    }
  }
  checkCapabilities(restored)
  await restored.configureProvider({ provider: 'sync-fixture', models: advertised.map(({ id }) => ({ id, name: `Edited ${id}` })) })
  checkCapabilities(restored)
  checkCapabilities(await AgentModels.create(dir))

  // A child agent creates its own Pi runtime from these files, bypassing AgentModels.resolve.
  const runtime = await ModelRuntime.create({ authPath: restored.authPath, modelsPath: restored.modelsPath, allowModelNetwork: false })
  const image = { id: 'pixel', name: 'pixel.png', mimeType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR1kAAAAASUVORK5CYII=' }
  for (const id of ['image-model', 'unknown-model']) {
    const model = runtime.getModel('sync-fixture', id)
    const prompt = normalizePrompt({ text: 'Describe this image.', attachments: [image] }, model)
    const reply = await runtime.completeSimple(model, { messages: [{ role: 'user', content: [{ type: 'text', text: prompt.text }, ...prompt.images], timestamp: Date.now() }] }, { maxTokens: 16, maxRetries: 0 })
    assert.equal(reply.stopReason, 'stop', reply.errorMessage)
    const wire = requests.findLast((request) => request.method === 'POST').body.messages.findLast((message) => message.role === 'user')
    assert.ok(wire.content.some((part) => part.type === 'image_url' && part.image_url.url === `data:image/png;base64,${image.data}`), id)
  }
  assert.throws(() => normalizePrompt({ attachments: [image] }, runtime.getModel('sync-fixture', 'text-model')), /does not support image/)

  // New API metadata replaces previous results; omitted capabilities become unknown again.
  advertised = [{ id: 'image-model', input: ['text'] }, { id: 'text-model' }, { id: 'unknown-model', capabilities: { vision: true } }]
  await restored.sync(settings(baseUrl))
  expected.set('image-model', ['text'])
  expected.set('text-model', undefined)
  expected.set('unknown-model', ['text', 'image'])
  checkCapabilities(await AgentModels.create(dir))

  // The settings editor also refreshes capabilities through discovery + save.
  await restored.configureProvider({
    provider: 'sync-fixture',
    models: restored.snapshot().providers.find((provider) => provider.id === 'sync-fixture').savedModels
      .map((model) => model.id === 'image-model' ? { ...model, input: [] } : model),
  })
  expected.set('image-model', undefined)
  checkCapabilities(await AgentModels.create(dir))
})

test('legacy text defaults and manual input overrides cannot override API image capabilities', async (t) => {
  const { dir, models, baseUrl } = await fixture(t, () => ({ data: [
    { id: 'legacy-model' },
    { id: 'image-model', input_modalities: ['text', 'image'] },
    { id: 'text-model', input_modalities: ['text'] },
  ] }))
  await models.configure({ ...settings(baseUrl), modelId: 'legacy-model' })
  const old = JSON.parse(await readFile(models.modelsPath, 'utf8'))
  old.providers['sync-fixture'].models = [
    { id: 'legacy-model', input: ['text'] },
    { id: 'image-model', input: ['text'] },
    { id: 'text-model', input: ['text', 'image'] },
  ]
  old.providers['sync-fixture'].modelOverrides = {
    'image-model': { input: ['text'], maxTokens: 2048 },
    'text-model': { input: ['text', 'image'], maxTokens: 4096 },
  }
  await writeFile(models.modelsPath, JSON.stringify(old))
  const upgraded = await AgentModels.create(dir)
  assert.equal(upgraded.snapshot().models.find((model) => model.provider === 'sync-fixture' && model.id === 'legacy-model').input, undefined)
  assert.deepEqual(upgraded.resolve({ provider: 'sync-fixture', modelId: 'legacy-model' }).input, ['text', 'image'])
  await upgraded.sync(settings(baseUrl))
  const restored = await AgentModels.create(dir)
  const definition = (id) => restored.config.providers['sync-fixture'].models.find((model) => model.id === id)
  assert.equal(definition('legacy-model').apiInput, undefined)
  assert.deepEqual(definition('legacy-model').input, ['text', 'image'])
  assert.deepEqual(definition('image-model').apiInput, ['text', 'image'])
  assert.deepEqual(definition('text-model').apiInput, ['text'])
  assert.deepEqual(restored.resolve({ provider: 'sync-fixture', modelId: 'image-model' }).input, ['text', 'image'])
  assert.deepEqual(restored.resolve({ provider: 'sync-fixture', modelId: 'text-model' }).input, ['text'])
  assert.equal(restored.resolve({ provider: 'sync-fixture', modelId: 'image-model' }).maxTokens, 2048)
  assert.equal(restored.resolve({ provider: 'sync-fixture', modelId: 'text-model' }).maxTokens, 4096)
})

test('sync preserves manual IDs, explicit model overrides, unrelated providers and saved credentials', async (t) => {
  const { dir, models, baseUrl } = await fixture(t, () => ({ data: [
    { id: 'manual-model', name: 'Remote name', context_length: 8000, max_tokens: 1000, reasoning: false },
    { id: 'new-model', context_length: 64000, max_tokens: 4000, reasoning: true },
    { id: 'new-model', context_length: 64000, max_tokens: 4000, reasoning: true },
  ] }))
  await models.saveProvider({ id: 'sync-fixture', ...settings(baseUrl), models: [
    { id: 'manual-model', name: 'Manual name', contextWindow: 32000, input: ['text', 'image'] },
    { id: 'manual-only' },
  ] })
  await models.configure({ provider: 'sync-fixture', modelId: 'manual-model', maxTokens: 2000, reasoning: true, thinkingLevel: 'high' })
  await models.configure({ ...settings(baseUrl, 'unrelated-provider'), modelId: 'unrelated-model' })
  const unrelated = structuredClone(models.config.providers['unrelated-provider'])
  const overrides = structuredClone(models.config.providers['sync-fixture'].modelOverrides)
  const auth = await readFile(models.authPath, 'utf8')
  const selected = { ...models.selected }
  await models.sync({ provider: 'sync-fixture', apiKey: '' })
  assert.deepEqual(models.selected, selected)
  assert.deepEqual(models.config.providers['unrelated-provider'], unrelated)
  assert.deepEqual(models.config.providers['sync-fixture'].modelOverrides, overrides)
  assert.equal(await readFile(models.authPath, 'utf8'), auth)
  const restored = await AgentModels.create(dir)
  const manual = restored.resolve({ provider: 'sync-fixture', modelId: 'manual-model' })
  assert.equal(manual.name, 'Manual name')
  assert.equal(manual.contextWindow, 32000)
  assert.equal(manual.maxTokens, 2000)
  assert.equal(manual.reasoning, true)
  assert.deepEqual(manual.input, ['text', 'image'])
  assert.ok(restored.resolve({ provider: 'sync-fixture', modelId: 'manual-only' }))
  assert.equal(restored.resolve({ provider: 'sync-fixture', modelId: 'new-model' }).maxTokens, 4000)
  assert.equal(restored.config.providers['sync-fixture'].models.length, 3)
})

test('empty, malformed and failed discovery leave persisted config, auth and selection untouched', async (t) => {
  const { dir, models, baseUrl } = await fixture(t, (request) => {
    if (request.url.pathname.startsWith('/empty')) return { data: [] }
    if (request.url.pathname.startsWith('/denied')) return { status: 401, body: { error: 'secret must not leak' } }
    return { unexpected: 'invalid response' }
  })
  await models.configure({ ...settings(baseUrl), modelId: 'manual-model' })
  const before = models.snapshot()
  const files = await savedFiles(dir)
  const origin = new URL(baseUrl).origin
  const result = await models.sync(settings(`${origin}/empty`))
  assert.deepEqual(result.models, [])
  await assert.rejects(models.sync(settings(`${origin}/denied`)), /HTTP 401/)
  await assert.rejects(models.sync(settings(`${origin}/malformed`)), /invalid model list/)
  assert.deepEqual(models.snapshot(), before)
  assert.deepEqual(await savedFiles(dir), files)
})

test('malformed optional metadata is ignored and Google empty IDs never enter Pi configuration', async (t) => {
  const { models, baseUrl } = await fixture(t, () => ({ models: [
    { name: 'models/' },
    { name: 'models/valid-model', displayName: {}, inputTokenLimit: -5, outputTokenLimit: 'invalid', thinking: 'invalid' },
  ] }))
  const result = await models.sync({ ...settings(baseUrl), api: 'google-generative-ai' })
  assert.deepEqual(result.models, [{ id: 'valid-model', name: 'valid-model' }])
  const model = models.resolve({ provider: 'sync-fixture', modelId: 'valid-model' })
  assert.equal(model.api, 'google-generative-ai')
  assert.ok(model.contextWindow > 0)
  assert.ok(model.maxTokens > 0)
})

test('a failed Pi reload rolls back the provider, credentials and in-memory catalog', async (t) => {
  const { dir, models, baseUrl } = await fixture(t)
  await models.configure({ ...settings(baseUrl), modelId: 'manual-model' })
  const before = models.snapshot()
  const files = await savedFiles(dir)
  const reload = models.reload.bind(models)
  let fail = true
  models.reload = async (...args) => {
    await reload(...args)
    if (fail) { fail = false; throw new Error('Simulated reload failure') }
  }
  await assert.rejects(models.sync({ ...settings(baseUrl), apiKey: 'replacement-test-key' }), /Simulated reload failure/)
  assert.deepEqual(models.snapshot(), before)
  assert.deepEqual(await savedFiles(dir), files)
  const restored = await AgentModels.create(dir)
  assert.equal(restored.runtime.getModel('sync-fixture', 'second-model'), undefined)
  assert.equal(restored.resolve().id, 'manual-model')
})

test('catalog-only sync preserves OAuth/native settings and rejects hidden unconfigured providers', async (t) => {
  const { dir, models, baseUrl, requests } = await fixture(t)
  await assert.rejects(models.sync({ provider: 'openai-codex' }), /Configure or sign in/)
  await models.saveProvider({ id: 'anthropic', baseUrl })
  await writeFile(models.authPath, JSON.stringify({ anthropic: { type: 'oauth', access: 'fake-oauth-access', refresh: 'fake-oauth-refresh', expires: Date.now() + 3600000 } }), { mode: 0o600 })
  await models.reload('anthropic')
  assert.equal(models.runtime.isUsingOAuth('anthropic'), true)
  const files = await savedFiles(dir)
  const before = models.snapshot()
  const result = await models.sync({ provider: 'anthropic', baseUrl: 'https://unsaved.example', api: 'openai-completions' })
  assert.equal(result.source, 'catalog')
  assert.ok(result.models.length > 0)
  assert.equal(requests.length, 0)
  assert.deepEqual(await savedFiles(dir), files)
  assert.deepEqual(models.snapshot(), before)
})

test('a slower superseded sync cannot overwrite a newer endpoint or key', async (t) => {
  let release
  let observed
  const gate = new Promise((resolve) => { release = resolve })
  const arrived = new Promise((resolve) => { observed = resolve })
  const { dir, models, baseUrl } = await fixture(t, async (request) => {
    if (request.url.pathname.startsWith('/slow')) { observed(); await gate }
    return { data: [{ id: request.url.pathname.startsWith('/slow') ? 'old-model' : 'new-model' }] }
  })
  const origin = new URL(baseUrl).origin
  const slow = models.sync(settings(`${origin}/slow`))
  await arrived
  await models.sync({ ...settings(`${origin}/fast`), apiKey: 'newer-test-key' })
  release()
  await assert.rejects(slow, /replaced by a newer request/)
  const restored = await AgentModels.create(dir)
  assert.equal(restored.config.providers['sync-fixture'].baseUrl, `${origin}/fast`)
  assert.deepEqual(restored.config.providers['sync-fixture'].models.map((model) => model.id), ['new-model'])
  assert.equal(JSON.parse(await readFile(models.authPath, 'utf8'))['sync-fixture'].key, 'newer-test-key')
})

test('deleting a provider invalidates an older model fetch so it cannot restore configuration or credentials', async (t) => {
  const gate = Promise.withResolvers()
  const arrived = Promise.withResolvers()
  const { dir, models, baseUrl } = await fixture(t, async () => {
    arrived.resolve()
    await gate.promise
    return { data: [{ id: 'must-not-return' }] }
  })
  await models.configure({ ...settings(baseUrl), modelId: 'saved-model' })
  const sync = models.sync({ ...settings(baseUrl), apiKey: 'old-sync-test-key' })
  await arrived.promise
  const manager = { models, modelsSnapshot: () => models.snapshot() }
  const deleted = await agentRoute(manager, 'DELETE', ['providers', 'sync-fixture'])
  assert.equal(deleted.selected, null)
  gate.resolve()
  await assert.rejects(sync, /replaced by a newer request/)
  for (const current of [models, await AgentModels.create(dir)]) {
    assert.equal(current.config.providers['sync-fixture'], undefined)
    assert.equal(current.runtime.getProvider('sync-fixture'), undefined)
    assert.equal(current.selected, null)
  }
  assert.equal(JSON.parse(await readFile(models.authPath, 'utf8'))['sync-fixture'], undefined)
})

test('simultaneous syncs for separate providers persist both catalogs', async (t) => {
  const { dir, models, baseUrl } = await fixture(t)
  await Promise.all([models.sync(settings(baseUrl, 'first-provider')), models.sync(settings(baseUrl, 'second-provider'))])
  const restored = await AgentModels.create(dir)
  for (const provider of ['first-provider', 'second-provider']) {
    assert.equal(restored.config.providers[provider].models.length, 2)
    assert.equal(restored.resolve({ provider, modelId: 'second-model' }).api, 'openai-completions')
    assert.equal(restored.runtime.hasConfiguredAuth(provider), true)
  }
})

test('manual model configuration during a sync reload preserves both fetched models and manual limits', async (t) => {
  const { dir, models, baseUrl } = await fixture(t)
  await models.configure({ ...settings(baseUrl), modelId: 'manual-model' })
  let release
  let observed
  const gate = new Promise((resolve) => { release = resolve })
  const arrived = new Promise((resolve) => { observed = resolve })
  const reload = models.reload.bind(models)
  let pause = true
  models.reload = async (...args) => {
    await reload(...args)
    if (pause) { pause = false; observed(); await gate }
  }
  const syncing = models.sync(settings(baseUrl))
  await arrived
  const configuring = models.configure({ provider: 'sync-fixture', modelId: 'manual-model', maxTokens: 2000, reasoning: true, thinkingLevel: 'high' })
  const duringReload = JSON.parse(await readFile(models.modelsPath, 'utf8'))
  release()
  await Promise.all([syncing, configuring])
  assert.ok(duringReload.providers['sync-fixture'].models.some((model) => model.id === 'second-model'))
  for (const current of [models, await AgentModels.create(dir)]) {
    assert.ok(current.runtime.getModel('sync-fixture', 'second-model'))
    assert.equal(current.resolve().id, 'manual-model')
    assert.equal(current.resolve().maxTokens, 2000)
    assert.equal(current.resolve().reasoning, true)
    assert.equal(current.selected.thinkingLevel, 'high')
    assert.equal(current.config.providers['sync-fixture'].modelOverrides['manual-model'].maxTokens, 2000)
  }
})
