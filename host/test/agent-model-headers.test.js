import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { AgentModels } from '../agents/models.js'
import { agentRoute } from '../agents/routes.js'

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'connect-model-headers-'))
  const requests = []
  const server = createServer(async (req, res) => {
    let body = ''
    for await (const part of req) body += part
    const request = { method: req.method, url: req.url, headers: req.headers, body: body ? JSON.parse(body) : null }
    requests.push(request)
    if (req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({ data: [{ id: 'fixture-model' }], models: [{ name: 'models/fixture-model' }] }))
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    for (const choice of [
      { index: 0, delta: { role: 'assistant', content: 'OK' }, finish_reason: null },
      { index: 0, delta: {}, finish_reason: 'stop' },
    ]) res.write(`data: ${JSON.stringify({ id: 'headers-test', object: 'chat.completion.chunk', created: 1, model: request.body.model, choices: [choice] })}\n\n`)
    res.end('data: [DONE]\n\n')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
    await rm(dir, { recursive: true, force: true })
  })
  const models = await AgentModels.create(dir)
  return { dir, requests, models, baseUrl: `http://127.0.0.1:${server.address().port}/v1` }
}

test('saved literal headers reach real model discovery and Pi streaming; custom Authorization overrides automatic auth', async (t) => {
  const { dir, models, baseUrl, requests } = await fixture(t)
  const marker = join(dir, 'must-not-execute')
  const headers = {
    Authorization: 'Bearer explicit-header',
    'X-Command': `!touch ${marker}; printf executed`,
    'X-Template': '${HOME}/$PATH/$$/$!/$(echo shell)',
    'X-Workspace': 'team-alpha',
  }
  const manager = { models, modelsSnapshot: () => models.snapshot() }
  await agentRoute(manager, 'POST', ['providers'], { provider: 'header-provider', baseUrl, apiKey: 'automatic-test-key', headers })
  await models.configure({ provider: 'header-provider', modelId: 'fixture-model' })
  await agentRoute(manager, 'POST', ['models', 'discover'], { provider: 'header-provider' })
  await agentRoute(manager, 'POST', ['models', 'test'], undefined)
  await models.discover({ provider: 'header-provider', apiKey: 'temporary-api-key' })
  assert.deepEqual(requests.map((request) => request.method), ['GET', 'POST', 'GET'])
  for (const request of requests) {
    for (const [name, value] of Object.entries(headers)) assert.equal(request.headers[name.toLowerCase()], value)
  }
  assert.equal(existsSync(marker), false)
  const saved = JSON.parse(await readFile(models.modelsPath, 'utf8')).providers['header-provider'].headers
  assert.ok(saved['x-command'].startsWith('$!'))
  assert.equal(saved['x-template'], '$${HOME}/$$PATH/$$$$/$$!/$$(echo shell)')
  const restored = await AgentModels.create(dir)
  const literal = Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]))
  assert.deepEqual(restored.snapshot().providers.find((provider) => provider.id === 'header-provider').headers, literal)
  await restored.test()
  assert.equal(requests.at(-1).headers['x-template'], headers['X-Template'])
  assert.equal(existsSync(marker), false)
})

test('headers update, omit, and explicitly clear across provider/model settings without affecting another provider', async (t) => {
  const { dir, models, baseUrl, requests } = await fixture(t)
  for (const provider of ['first-provider', 'second-provider']) await models.configure({
    provider, modelId: 'fixture-model', baseUrl, api: 'openai-completions', apiKey: `${provider}-key`, headers: { 'X-Provider': provider },
  })
  const second = structuredClone(models.config.providers['second-provider'])
  await models.test({ provider: 'first-provider', modelId: 'fixture-model', headers: { 'X-Updated': '$LITERAL', authorization: 'custom-auth' } })
  assert.equal(requests.at(-1).headers['x-updated'], '$LITERAL')
  assert.equal(requests.at(-1).headers['x-provider'], undefined)
  assert.equal(requests.at(-1).headers.authorization, 'custom-auth')
  await models.configureProvider({ provider: 'first-provider' })
  await models.discover({ provider: 'first-provider' })
  assert.equal(requests.at(-1).headers['x-updated'], '$LITERAL')
  await models.configureProvider({ provider: 'first-provider', headers: {} })
  await models.discover({ provider: 'first-provider' })
  await models.test()
  for (const request of requests.slice(-2)) {
    assert.equal(request.headers['x-updated'], undefined)
    assert.equal(request.headers.authorization, 'Bearer first-provider-key')
  }
  assert.deepEqual(models.config.providers['second-provider'], second)
  const restored = await AgentModels.create(dir)
  assert.deepEqual(restored.snapshot().providers.find((provider) => provider.id === 'first-provider').headers, {})
  assert.deepEqual(restored.snapshot().providers.find((provider) => provider.id === 'second-provider').headers, { 'x-provider': 'second-provider' })
  assert.equal(restored.selected.provider, 'first-provider')
  await restored.discover({ provider: 'second-provider' })
  assert.equal(requests.at(-1).headers['x-provider'], 'second-provider')
})

test('temporary discovery headers replace saved headers and remain read-only, including empty replacements', async (t) => {
  const { models, baseUrl, requests } = await fixture(t)
  await models.configure({ provider: 'header-provider', modelId: 'fixture-model', baseUrl, api: 'openai-completions', apiKey: 'automatic-test-key', headers: { Authorization: 'saved-auth', 'X-Saved': 'saved-value' } })
  const config = await readFile(models.modelsPath, 'utf8')
  await models.discover({ provider: 'header-provider', headers: { Authorization: 'temporary-auth', 'X-Temporary': '!literal' } })
  assert.equal(requests.at(-1).headers.authorization, 'temporary-auth')
  assert.equal(requests.at(-1).headers['x-temporary'], '!literal')
  assert.equal(requests.at(-1).headers['x-saved'], undefined)
  await models.discover({ provider: 'header-provider', headers: {} })
  assert.equal(requests.at(-1).headers.authorization, 'Bearer automatic-test-key')
  assert.equal(requests.at(-1).headers['x-saved'], undefined)
  await models.discover({ provider: 'header-provider', baseUrl: `${baseUrl}/other`, headers: { authorization: 'explicit-other-endpoint' } })
  assert.equal(requests.at(-1).headers.authorization, 'explicit-other-endpoint')
  assert.equal(requests.at(-1).headers['x-saved'], undefined)
  assert.equal(await readFile(models.modelsPath, 'utf8'), config)
  await models.discover({ provider: 'anthropic-headers', baseUrl, api: 'anthropic-messages', apiKey: 'automatic-key', headers: { 'X-Api-Key': 'custom-key', 'Anthropic-Version': 'custom-version' } })
  assert.equal(requests.at(-1).headers['x-api-key'], 'custom-key')
  assert.equal(requests.at(-1).headers['anthropic-version'], 'custom-version')
  await models.discover({ provider: 'google-headers', baseUrl, api: 'google-generative-ai', apiKey: 'automatic-key', headers: { 'X-Goog-Api-Key': 'custom-google-key' } })
  assert.equal(requests.at(-1).headers['x-goog-api-key'], 'custom-google-key')
})

test('model sync stores literal headers for subsequent real Pi requests and preserves them when omitted', async (t) => {
  const { dir, models, baseUrl, requests } = await fixture(t)
  const settings = { provider: 'synced-provider', baseUrl, api: 'openai-completions', apiKey: 'sync-test-key' }
  await models.sync({ ...settings, headers: { Authorization: 'sync-custom-auth', 'X-Sync': '!literal-$ENV' } })
  assert.equal(requests.at(-1).headers.authorization, 'sync-custom-auth')
  await models.sync(settings)
  assert.equal(requests.at(-1).headers['x-sync'], '!literal-$ENV')
  const restored = await AgentModels.create(dir)
  restored.select({ provider: 'synced-provider', modelId: 'fixture-model' })
  await restored.test()
  assert.equal(requests.at(-1).headers['x-sync'], '!literal-$ENV')
  assert.equal(requests.at(-1).headers.authorization, 'sync-custom-auth')
  await restored.sync({ ...settings, headers: {} })
  await restored.test()
  assert.equal(requests.at(-1).headers['x-sync'], undefined)
  assert.equal(requests.at(-1).headers.authorization, 'Bearer sync-test-key')
})

test('HTTP header validation rejects invalid values before save or discovery and empty built-in overrides remain valid', async (t) => {
  const { models, requests } = await fixture(t)
  await models.configureProvider({ provider: 'openai', apiKey: 'builtin-header-key', headers: {} })
  const known = models.runtime.getModels('openai')[0]
  await models.configure({ provider: 'openai', modelId: known.id, headers: {} })
  const before = await readFile(models.modelsPath, 'utf8')
  for (const headers of [null, [], 'bad', { 'bad key': 'value' }, { 'X-Test': 1 }, { 'X-Test': 'line\nbreak' }, { 'X-Test': '雪' }]) {
    await assert.rejects(models.configureProvider({ provider: 'openai', headers }), /headers/)
    await assert.rejects(models.configure({ provider: 'openai', modelId: known.id, headers }), /headers/)
    await assert.rejects(models.discover({ provider: 'openai', headers }), /headers/)
  }
  assert.equal(await readFile(models.modelsPath, 'utf8'), before)
  assert.equal(requests.length, 0)
})

test('catalog-only sync updates and clears literal headers while preserving native auth, models and selection', async (t) => {
  const { dir, models, baseUrl, requests } = await fixture(t)
  await assert.rejects(models.sync({ provider: 'openai-codex', headers: { 'X-Native': 'unconfigured' } }), /Configure or sign in/)
  assert.equal(models.config.providers['openai-codex'], undefined)
  await models.configure({ provider: 'selected-provider', modelId: 'fixture-model', api: 'openai-completions', baseUrl, apiKey: 'selected-test-key' })
  await models.configureProvider({ provider: 'anthropic', baseUrl, headers: { 'X-Old': 'old-value' } })
  const credentials = JSON.parse(await readFile(models.authPath, 'utf8'))
  credentials.anthropic = { type: 'oauth', access: 'fake-access', refresh: 'fake-refresh', expires: Date.now() + 3600000 }
  await writeFile(models.authPath, JSON.stringify(credentials), { mode: 0o600 })
  await models.reload('anthropic')
  const auth = await readFile(models.authPath, 'utf8')
  const selected = { ...models.selected }
  const modelIds = models.runtime.getModels('anthropic').map((model) => model.id)
  const result = await models.sync({ provider: 'anthropic', headers: { 'X-Native': '!literal-$HOME' }, apiKey: '' })
  assert.equal(result.source, 'catalog')
  assert.deepEqual(models.snapshot().providers.find((provider) => provider.id === 'anthropic').headers, { 'x-native': '!literal-$HOME' })
  assert.equal(models.config.providers.anthropic.models, undefined)
  assert.equal(models.config.providers.anthropic.baseUrl, baseUrl)
  assert.deepEqual(models.runtime.getModels('anthropic').map((model) => model.id), modelIds)
  assert.deepEqual(models.selected, selected)
  assert.equal(await readFile(models.authPath, 'utf8'), auth)
  const restored = await AgentModels.create(dir)
  assert.deepEqual(restored.snapshot().providers.find((provider) => provider.id === 'anthropic').headers, { 'x-native': '!literal-$HOME' })
  const cleared = await restored.sync({ provider: 'anthropic', headers: {} })
  assert.equal(cleared.source, 'catalog')
  const final = await AgentModels.create(dir)
  assert.deepEqual(final.snapshot().providers.find((provider) => provider.id === 'anthropic').headers, {})
  assert.equal(final.runtime.isUsingOAuth('anthropic'), true)
  assert.deepEqual(final.selected, selected)
  assert.equal(await readFile(final.authPath, 'utf8'), auth)
  assert.equal(requests.length, 0)
})
