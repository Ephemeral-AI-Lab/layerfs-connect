import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { AgentModels } from '../agents/models.js'
import { agentRoute } from '../agents/routes.js'

async function fixture(t, status = 200) {
  const dir = await mkdtemp(join(tmpdir(), 'connect-models-'))
  const requests = []
  const server = createServer(async (req, res) => {
    let body = ''
    for await (const part of req) body += part
    requests.push({ url: req.url, authorization: req.headers.authorization, body: JSON.parse(body) })
    if (status !== 200) {
      res.writeHead(status, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({ error: { message: 'Test provider refused the request.' } }))
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.write(`data: ${JSON.stringify({ id: 'test-reply', object: 'chat.completion.chunk', created: 1, model: 'fixture-model', choices: [{ index: 0, delta: { role: 'assistant', content: 'OK' }, finish_reason: null }] })}\n\n`)
    res.write(`data: ${JSON.stringify({ id: 'test-reply', object: 'chat.completion.chunk', created: 1, model: 'fixture-model', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 4, completion_tokens: 1, total_tokens: 5 } })}\n\n`)
    res.end('data: [DONE]\n\n')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
    await rm(dir, { recursive: true, force: true })
  })
  return { dir, requests, baseUrl: `http://127.0.0.1:${server.address().port}/v1` }
}

test('custom provider survives restart and real Pi sends a streaming authenticated request', { timeout: 20_000 }, async (t) => {
  const { dir, requests, baseUrl } = await fixture(t)
  const models = await AgentModels.create(dir)
  const snapshot = await models.configure({ provider: 'connect-fixture', modelId: 'fixture-model', api: 'openai-completions', baseUrl, apiKey: 'local-test-secret', contextWindow: 64000, maxTokens: 2048 })
  assert.deepEqual(snapshot.selected, { provider: 'connect-fixture', modelId: 'fixture-model', thinkingLevel: 'off' })
  assert.equal(snapshot.providers.find((p) => p.id === 'connect-fixture').hasKey, true)
  assert.equal(JSON.stringify(snapshot).includes('local-test-secret'), false)
  assert.equal((await stat(join(dir, 'auth.json'))).mode & 0o777, 0o600)
  const restored = await AgentModels.create(dir)
  assert.deepEqual(restored.selected, snapshot.selected)
  assert.equal(restored.resolve().contextWindow, 64000)
  assert.deepEqual(await restored.test(), { text: 'OK' })
  assert.equal(requests.length, 1)
  assert.equal(requests[0].url, '/v1/chat/completions')
  assert.equal(requests[0].authorization, 'Bearer local-test-secret')
  assert.equal(requests[0].body.model, 'fixture-model')
  assert.equal(requests[0].body.stream, true)
})

test('model overrides preserve the key and model metadata while provider identities stay separate', { timeout: 20_000 }, async (t) => {
  const { dir, baseUrl } = await fixture(t)
  const models = await AgentModels.create(dir)
  await models.configure({ provider: 'provider-one', modelId: 'shared', api: 'openai-completions', baseUrl, apiKey: 'one-test-key', contextWindow: 32000, reasoning: true })
  await models.configure({ provider: 'provider-two', modelId: 'shared', api: 'openai-completions', baseUrl, apiKey: 'two-test-key', contextWindow: 16000 })
  await models.configure({ provider: 'provider-one', modelId: 'shared', apiKey: '', maxTokens: 4096, thinkingLevel: 'high' })
  assert.equal(models.resolve().reasoning, true)
  assert.equal(models.resolve().contextWindow, 32000)
  assert.equal(models.resolve().maxTokens, 4096)
  assert.equal(models.resolve({ provider: 'provider-two', modelId: 'shared' }).contextWindow, 16000)
  assert.equal(models.runtime.hasConfiguredAuth('provider-one'), true)
  const auth = JSON.parse(await readFile(join(dir, 'auth.json'), 'utf8'))
  assert.equal(auth['provider-one'].key, 'one-test-key')
  await models.removeProvider('provider-one')
  assert.equal(models.selected, null)
  assert.equal(models.runtime.getProvider('provider-one'), undefined)
  assert.equal(JSON.parse(await readFile(join(dir, 'auth.json'), 'utf8'))['provider-one'], undefined)
  assert.equal(models.runtime.hasConfiguredAuth('provider-two'), true)
})

test('connection failures surface directly without retrying the provider', { timeout: 20_000 }, async (t) => {
  const { dir, baseUrl, requests } = await fixture(t, 401)
  const models = await AgentModels.create(dir)
  await assert.rejects(models.test({ provider: 'refused-fixture', modelId: 'fixture-model', api: 'openai-completions', baseUrl, apiKey: 'local-test-secret' }), /Test provider refused/)
  assert.equal(requests.length, 1)
})

test('provider route saves multiple connections without a model or changing the selected model', async (t) => {
  const { dir, baseUrl, requests } = await fixture(t)
  const models = await AgentModels.create(dir)
  const manager = { models, modelsSnapshot: () => ({ ...models.snapshot(), defaultCwd: '/workspace' }) }
  const save = (settings) => agentRoute(manager, 'POST', ['providers'], settings)
  const first = await save({ provider: ' first-provider ', name: 'First provider', baseUrl, apiKey: 'first-test-key' })
  assert.equal(first.defaultCwd, '/workspace')
  assert.equal(first.selected, null)
  assert.equal(first.providers.find((provider) => provider.id === 'first-provider').api, 'openai-completions')
  assert.equal(first.models.filter((model) => model.provider === 'first-provider').length, 0)
  await save({ provider: 'second-provider', baseUrl: `${baseUrl}/second`, api: 'anthropic-messages', apiKey: 'second-test-key' })
  // Even a built-in catalog becoming available must not silently choose a model on restart.
  await save({ provider: 'openai', apiKey: 'builtin-test-key' })
  assert.equal((await AgentModels.create(dir)).selected, null)

  await models.configure({ provider: 'first-provider', modelId: 'first-model', contextWindow: 32000, reasoning: true, thinkingLevel: 'high' })
  await models.configure({ provider: 'first-provider', modelId: 'second-model', maxTokens: 4096 })
  const selected = { ...models.selected }
  const definitions = structuredClone(models.config.providers['first-provider'].models)
  const second = structuredClone(models.config.providers['second-provider'])
  const updated = await save({ provider: 'first-provider', baseUrl: `${baseUrl}/updated`, apiKey: '' })
  assert.deepEqual(updated.selected, selected)
  assert.deepEqual(models.config.providers['first-provider'].models, definitions)
  assert.deepEqual(models.config.providers['second-provider'], second)
  assert.equal(models.runtime.getModel('first-provider', 'first-model').contextWindow, 32000)
  assert.equal(models.runtime.getModel('first-provider', 'second-model').maxTokens, 4096)
  const auth = JSON.parse(await readFile(models.authPath, 'utf8'))
  assert.equal(auth['first-provider'].key, 'first-test-key')
  assert.equal(auth['second-provider'].key, 'second-test-key')
  assert.equal(JSON.stringify(updated).includes('test-key'), false)
  const restored = await AgentModels.create(dir)
  assert.deepEqual(restored.selected, selected)
  assert.equal(restored.resolve().baseUrl, `${baseUrl}/updated`)
  assert.equal(restored.runtime.getModel('first-provider', 'first-model').reasoning, true)
  assert.equal(requests.length, 0)
})

test('provider route rejects invalid connection input before changing saved settings', async (t) => {
  const { dir, baseUrl } = await fixture(t)
  const models = await AgentModels.create(dir)
  const manager = { models, modelsSnapshot: () => models.snapshot() }
  const save = (settings) => agentRoute(manager, 'POST', ['providers'], settings)
  await save({ provider: 'saved-provider', baseUrl, apiKey: 'saved-test-key' })
  const before = models.snapshot()
  const config = await readFile(models.modelsPath, 'utf8')
  const auth = await readFile(models.authPath, 'utf8')
  for (const settings of [
    undefined, null, {}, { provider: '' }, { provider: 1 },
    { provider: 'new-provider' },
    { provider: 'new-provider', api: 1 }, { provider: 'new-provider', apiKey: null },
    { provider: 'new-provider', baseUrl: 'not-a-url' },
    { provider: 'new-provider', baseUrl: 'file:///tmp/model-api' },
    { provider: 'new-provider', baseUrl: 'https://api.example.com/v1?token=secret' },
  ]) await assert.rejects(save(settings), /Provider ID|Invalid provider|API URL/)
  assert.deepEqual(models.snapshot(), before)
  assert.equal(await readFile(models.modelsPath, 'utf8'), config)
  assert.equal(await readFile(models.authPath, 'utf8'), auth)
})

test('a credential-only built-in provider can select a known model and restart without an empty override', async (t) => {
  const { dir } = await fixture(t)
  const models = await AgentModels.create(dir)
  const manager = { models, modelsSnapshot: () => models.snapshot() }
  await agentRoute(manager, 'POST', ['providers'], { provider: 'openai', apiKey: 'builtin-only-test-key' })
  const known = models.runtime.getModels('openai')[0]
  assert.ok(known)
  const selected = await agentRoute(manager, 'POST', ['models'], { provider: 'openai', modelId: known.id, thinkingLevel: 'off' })
  assert.equal(selected.selected.modelId, known.id)
  assert.equal(models.config.providers.openai, undefined)
  assert.equal(JSON.parse(await readFile(models.modelsPath, 'utf8')).providers.openai, undefined)
  const restored = await AgentModels.create(dir)
  assert.deepEqual(restored.selected, selected.selected)
  assert.equal(restored.resolve().id, known.id)
  assert.equal(restored.runtime.hasConfiguredAuth('openai'), true)
  assert.equal(JSON.parse(await readFile(models.authPath, 'utf8')).openai.key, 'builtin-only-test-key')
})

test('deleting a provider removes its models and credentials, preserves others, and survives restart', async (t) => {
  const { dir, baseUrl } = await fixture(t)
  const models = await AgentModels.create(dir)
  const manager = { models, modelsSnapshot: () => ({ ...models.snapshot(), defaultCwd: '/workspace' }) }
  for (const provider of ['first-provider', 'second-provider']) {
    await models.configure({ provider, modelId: 'shared-model', baseUrl, api: 'openai-completions', apiKey: `${provider}-test-key`, contextWindow: 32000 })
  }
  const selected = { ...models.selected }
  const second = structuredClone(models.config.providers['second-provider'])
  const snapshot = await agentRoute(manager, 'DELETE', ['providers', 'first-provider'])
  assert.equal(snapshot.defaultCwd, '/workspace')
  assert.deepEqual(snapshot.selected, selected)
  assert.equal(snapshot.providers.some((provider) => provider.id === 'first-provider'), false)
  assert.equal(snapshot.models.some((model) => model.provider === 'first-provider'), false)
  assert.deepEqual(models.config.providers['second-provider'], second)
  const auth = JSON.parse(await readFile(models.authPath, 'utf8'))
  assert.equal(auth['first-provider'], undefined)
  assert.equal(auth['second-provider'].key, 'second-provider-test-key')
  const restored = await AgentModels.create(dir)
  assert.deepEqual(restored.selected, selected)
  assert.equal(restored.runtime.getProvider('first-provider'), undefined)
  assert.equal(restored.resolve().contextWindow, 32000)

  const cleared = await agentRoute(manager, 'DELETE', ['providers', 'second-provider'])
  assert.equal(cleared.selected, null)
  assert.equal(cleared.models.some((model) => model.provider === 'second-provider'), false)
  assert.equal((await AgentModels.create(dir)).selected, null)
})

test('deleting a built-in provider clears its saved connection and hides it from configured providers', async (t) => {
  const { dir, baseUrl } = await fixture(t)
  const models = await AgentModels.create(dir)
  const manager = { models, modelsSnapshot: () => models.snapshot() }
  await models.configureProvider({ provider: 'openai', baseUrl, apiKey: 'builtin-delete-test-key' })
  const known = models.runtime.getModels('openai')[0]
  await models.configure({ provider: 'openai', modelId: known.id })
  const snapshot = await agentRoute(manager, 'DELETE', ['providers', 'openai'])
  const provider = snapshot.providers.find((provider) => provider.id === 'openai')
  assert.ok(provider, 'Pi keeps the built-in catalog available for future configuration.')
  assert.equal(provider.hasKey, false)
  assert.equal(provider.custom, false)
  assert.equal(snapshot.selected, null)
  assert.equal(JSON.parse(await readFile(models.modelsPath, 'utf8')).providers.openai, undefined)
  assert.equal(JSON.parse(await readFile(models.authPath, 'utf8')).openai, undefined)
  const restored = await AgentModels.create(dir)
  assert.equal(restored.runtime.hasConfiguredAuth('openai'), false)
  assert.equal(restored.selected, null)
})
