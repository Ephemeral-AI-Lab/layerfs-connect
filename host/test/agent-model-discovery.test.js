import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { AgentModels } from '../agents/models.js'
import { agentRoute } from '../agents/routes.js'

async function fixture(t, respond = () => ({ data: [{ id: 'fixture-model' }] })) {
  const dir = await mkdtemp(join(tmpdir(), 'connect-model-discovery-'))
  const requests = []
  const server = createServer((req, res) => {
    const request = { url: new URL(req.url, 'http://fixture'), headers: req.headers, method: req.method }
    requests.push(request)
    const reply = respond(request, requests.length)
    res.writeHead(reply.status ?? 200, { 'content-type': 'application/json', ...reply.headers })
    res.end(JSON.stringify(reply.body ?? reply))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
    await rm(dir, { recursive: true, force: true })
  })
  return { dir, requests, baseUrl: `http://127.0.0.1:${server.address().port}`, models: await AgentModels.create(dir) }
}

const savedFiles = async (dir) => Object.fromEntries(await Promise.all(
  (await readdir(dir)).filter((name) => name.endsWith('.json')).map(async (name) => [name, await readFile(join(dir, name), 'utf8')]),
))

test('discovery route fetches unsaved OpenAI-compatible models without changing configuration or selection', async (t) => {
  const { models, dir, baseUrl, requests } = await fixture(t, (request) => !request.url.searchParams.has('after')
    ? { data: [{ id: 'z-model' }, { id: 'new-reasoning-model' }], has_more: true, last_id: 'new-reasoning-model' }
    : { data: [{ id: 'z-model' }, { id: 'a-model', name: 'A Model', context_length: 32000, max_tokens: 2048, reasoning: true }], has_more: false })
  const before = models.snapshot()
  const files = await savedFiles(dir)
  const result = await agentRoute({ models }, 'POST', ['models', 'discover'], {
    provider: 'unsaved-provider', baseUrl: `${baseUrl}/v1/`, api: 'openai-responses', apiKey: 'temporary-test-key',
  })
  assert.deepEqual(result, {
    source: 'remote',
    models: [
      { id: 'a-model', name: 'A Model', contextWindow: 32000, maxTokens: 2048, reasoning: true },
      { id: 'new-reasoning-model', name: 'new-reasoning-model' },
      { id: 'z-model', name: 'z-model' },
    ],
  })
  assert.equal(requests.length, 2)
  assert.equal(requests[0].url.pathname, '/v1/models')
  assert.equal(requests[1].url.searchParams.get('after'), 'new-reasoning-model')
  assert.equal(requests[1].url.searchParams.has('after_id'), false)
  assert.equal(requests[0].method, 'GET')
  assert.equal(requests[0].headers.authorization, 'Bearer temporary-test-key')
  assert.deepEqual(models.snapshot(), before)
  assert.deepEqual(await savedFiles(dir), files)
  assert.equal(JSON.stringify(result).includes('temporary-test-key'), false)
})

test('image capabilities come only from API metadata; missing and malformed capabilities remain unknown', async (t) => {
  const { models, baseUrl } = await fixture(t, () => ({ data: [
    { id: 'architecture-image', architecture: { input_modalities: ['text', 'image'] } },
    { id: 'modalities-image', input_modalities: ['text', 'image'] },
    { id: 'input-image', input: ['text', 'image'] },
    { id: 'image-supported', capabilities: { image_input: { supported: true } } },
    { id: 'vision-supported', capabilities: { vision: { supported: true } } },
    { id: 'vision-boolean', capabilities: { vision: true } },
    { id: 'modalities-text', input_modalities: ['text'] },
    { id: 'image-unsupported', capabilities: { image_input: { supported: false } } },
    { id: 'vision-unsupported', capabilities: { vision: { supported: false } } },
    { id: 'vision-false', capabilities: { vision: false } },
    { id: 'gpt-4o-vision' },
    { id: 'text-only-model' },
    { id: 'malformed', input: 'image', capabilities: { vision: 'true' } },
    { id: 'empty', input_modalities: [] },
  ] }))
  const result = await models.discover({ provider: 'capabilities-fixture', baseUrl, api: 'openai-completions' })
  const byId = new Map(result.models.map((model) => [model.id, model]))
  for (const id of ['architecture-image', 'modalities-image', 'input-image', 'image-supported', 'vision-supported', 'vision-boolean']) {
    assert.deepEqual(byId.get(id).input, ['text', 'image'], id)
  }
  for (const id of ['modalities-text', 'image-unsupported', 'vision-unsupported', 'vision-false']) {
    assert.deepEqual(byId.get(id).input, ['text'], id)
  }
  for (const id of ['gpt-4o-vision', 'text-only-model', 'malformed', 'empty']) {
    assert.equal(Object.hasOwn(byId.get(id), 'input'), false, id)
  }
})

test('saved credentials stay with their provider and endpoint; explicit keys remain temporary', async (t) => {
  const { models, dir, baseUrl, requests } = await fixture(t)
  await models.configure({ provider: 'provider-one', modelId: 'fixture-model', baseUrl: `${baseUrl}/one`, api: 'openai-completions', apiKey: 'saved-one-key' })
  await models.configure({ provider: 'provider-two', modelId: 'fixture-model', baseUrl: `${baseUrl}/two`, api: 'openai-completions', apiKey: 'saved-two-key' })
  const before = models.snapshot()
  const files = await savedFiles(dir)
  await models.discover({ provider: 'provider-one', baseUrl: `${baseUrl}/one/` })
  await models.discover({ provider: 'provider-two' })
  await models.discover({ provider: 'provider-one', apiKey: 'temporary-key' })
  await assert.rejects(models.discover({ provider: 'provider-one', baseUrl: `${baseUrl}/changed` }), /Enter an API key for the changed API URL/)
  await models.discover({ provider: 'new-provider', baseUrl: `${baseUrl}/new`, api: 'openai-completions' })
  assert.deepEqual(requests.map((request) => request.headers.authorization), ['Bearer saved-one-key', 'Bearer saved-two-key', 'Bearer temporary-key', undefined])
  assert.deepEqual(models.snapshot(), before)
  assert.deepEqual(await savedFiles(dir), files)
})

test('a built-in provider key is never reused for an entered custom URL', async (t) => {
  const { models, baseUrl, requests } = await fixture(t)
  await models.saveProvider({ id: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: 'built-in-saved-key' })
  await assert.rejects(models.discover({ provider: 'openai', baseUrl }), /Enter an API key for the changed API URL/)
  assert.equal(requests.length, 0)
  await models.discover({ provider: 'openai', baseUrl, apiKey: 'custom-test-key' })
  assert.equal(requests[0].headers.authorization, 'Bearer custom-test-key')
})

test('Anthropic discovery uses versioned paths, API key headers and cursor pagination', async (t) => {
  const { models, baseUrl, requests } = await fixture(t, (_, page) => page === 1
    ? { data: [{ id: 'claude-first', display_name: 'Claude First', max_input_tokens: 200000, max_tokens: 64000, capabilities: { thinking: { supported: true } } }], has_more: true, last_id: 'claude-first' }
    : { data: [{ id: 'claude-second' }], has_more: false })
  const result = await models.discover({ provider: 'anthropic-fixture', api: 'anthropic-messages', baseUrl, apiKey: 'anthropic-test-key' })
  assert.equal(requests[0].url.pathname, '/v1/models')
  assert.equal(requests[0].headers['x-api-key'], 'anthropic-test-key')
  assert.equal(requests[0].headers['anthropic-version'], '2023-06-01')
  assert.equal(requests[0].headers.authorization, undefined)
  assert.equal(requests[1].url.searchParams.get('after_id'), 'claude-first')
  assert.deepEqual(result.models[0], { id: 'claude-first', name: 'Claude First', reasoning: true, contextWindow: 200000, maxTokens: 64000 })
  assert.equal(result.models.length, 2)
})

test('Gemini discovery follows page tokens and returns only content-generation models', async (t) => {
  const { models, baseUrl, requests } = await fixture(t, (_, page) => page === 1
    ? { models: [
      { name: 'models/gemini-first', displayName: 'Gemini First', inputTokenLimit: 1000000, outputTokenLimit: 8192, supportedGenerationMethods: ['generateContent'] },
      { name: 'models/embedding-only', supportedGenerationMethods: ['embedContent'] },
    ], nextPageToken: 'next-page' }
    : { models: [{ name: 'models/gemini-second', supportedGenerationMethods: ['generateContent'], thinking: false }] })
  const result = await models.discover({ provider: 'gemini-fixture', api: 'google-generative-ai', baseUrl: `${baseUrl}/v1beta/`, apiKey: 'gemini-test-key' })
  assert.equal(requests[0].url.pathname, '/v1beta/models')
  assert.equal(requests[0].headers['x-goog-api-key'], 'gemini-test-key')
  assert.equal(requests[0].url.searchParams.has('key'), false)
  assert.equal(requests[1].url.searchParams.get('pageToken'), 'next-page')
  assert.deepEqual(result.models, [
    { id: 'gemini-first', name: 'Gemini First', contextWindow: 1000000, maxTokens: 8192 },
    { id: 'gemini-second', name: 'gemini-second', reasoning: false },
  ])
})

test('provider failures and malformed responses surface without echoing secrets or falling back to catalogs', async (t) => {
  const { models, baseUrl, requests } = await fixture(t, (_, page) => page === 1
    ? { status: 401, body: { error: { message: 'secret-test-key was refused' } } }
    : { unexpected: 'secret-test-key' })
  const config = { provider: 'openai', baseUrl, apiKey: 'secret-test-key' }
  await assert.rejects(models.discover(config), (error) => /HTTP 401/.test(error.message) && !error.message.includes('secret-test-key'))
  await assert.rejects(models.discover(config), /invalid model list/)
  assert.equal(requests.length, 2)
  await assert.rejects(models.discover({ ...config, apiKey: 'secret-test-key\ninvalid' }), (error) => /invalid characters/.test(error.message) && !error.message.includes('secret-test-key'))
  assert.equal(requests.length, 2)
})

test('redirects never forward the entered credentials', async (t) => {
  const destination = await fixture(t)
  const origin = await fixture(t, () => ({ status: 307, headers: { location: `${destination.baseUrl}/models` }, body: {} }))
  await assert.rejects(origin.models.discover({ provider: 'custom', api: 'openai-completions', baseUrl: origin.baseUrl, apiKey: 'redirect-test-key' }), /redirects are not followed/)
  assert.equal(origin.requests.length, 1)
  assert.equal(destination.requests.length, 0)
})

test('unsupported native protocols return an explicitly marked catalog', async (t) => {
  const { models, requests } = await fixture(t)
  const result = await models.discover({ provider: 'openai-codex' })
  assert.equal(result.source, 'catalog')
  assert.ok(result.models.length > 0)
  assert.equal(requests.length, 0)
  await assert.rejects(models.discover({ provider: 'unknown-provider', api: 'unsupported' }), /does not support automatic model discovery/)
})
