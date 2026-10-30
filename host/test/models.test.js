// models.js through the host's HTTP API, on pi's real ModelRuntime in a
// temporary state folder: listing, saving a key (never answered back),
// base URL overrides, custom providers, the default model, removal, and
// refusals. No network, no LayerFS.
//   node --test host/test/models.test.js
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { Models } from '../models.js'
import { createHostServer, listen, newToken } from '../server.js'

const state = mkdtempSync(join(tmpdir(), 'connect-models-'))
const token = newToken()
// the host's environment has an OpenAI key and no other provider's (pi reads process.env itself)
for (const k of Object.keys(process.env)) if (/(_API_KEY|_TOKEN|_ACCESS_KEY_ID)$/.test(k)) delete process.env[k]
process.env.OPENAI_API_KEY = 'sk-from-env'
const models = new Models({ state })
const server = createHostServer({ token, projects: {}, models, log: () => {} })
let url

before(async () => {
  url = await listen(server, 0)
})
after(async () => {
  await new Promise((resolve) => server.close(resolve))
  rmSync(state, { recursive: true, force: true })
})

async function call(method, path, body) {
  const res = await fetch(url + path, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  return { status: res.status, body: await res.json() }
}
const listed = (view) => view.providers.filter((p) => p.listed).map((p) => p.id)
const provider = (view, id) => view.providers.find((p) => p.id === id)

test('lists the catalog; a key in the environment lists its provider', async () => {
  const { status, body } = await call('GET', '/api/models')
  assert.equal(status, 200)
  assert.ok(body.providers.length > 20)
  assert.deepEqual(listed(body), ['openai'])
  const openai = provider(body, 'openai')
  assert.deepEqual(openai.envFound, ['OPENAI_API_KEY'])
  assert.equal(openai.source, 'environment')
  assert.ok(openai.models.some((m) => m.id === 'gpt-5.5'))
  assert.deepEqual(provider(body, 'deepseek').envVars, ['DEEPSEEK_API_KEY'])
  assert.equal(body.default, null)
  assert.ok(!body.providers.some((p) => p.id === 'faux'))
})

test('a saved key is stored owner-only and never answered back', async () => {
  const { status, body } = await call('POST', '/api/models/providers/deepseek', { key: 'sk-secret-deepseek' })
  assert.equal(status, 200)
  const deepseek = provider(body, 'deepseek')
  assert.equal(deepseek.credential, 'api_key')
  assert.equal(deepseek.configured, true)
  assert.equal(deepseek.listed, true)
  assert.ok(!JSON.stringify(body).includes('sk-secret-deepseek'))
  const auth = join(state, 'pi', 'auth.json')
  assert.equal(statSync(auth).mode & 0o777, 0o600)
  assert.ok(readFileSync(auth, 'utf8').includes('sk-secret-deepseek'))
})

test('a base URL override goes to models.json; blank restores the default', async () => {
  let { body } = await call('POST', '/api/models/providers/deepseek', { baseUrl: 'https://proxy.example/v1' })
  assert.equal(provider(body, 'deepseek').baseUrl, 'https://proxy.example/v1')
  assert.equal(provider(body, 'deepseek').credential, 'api_key')
  ;({ body } = await call('POST', '/api/models/providers/deepseek', { baseUrl: '' }))
  assert.equal(provider(body, 'deepseek').baseUrl, null)
  const bad = await call('POST', '/api/models/providers/deepseek', { baseUrl: 'ftp://nope' })
  assert.equal(bad.status, 400)
})

test('a provider saved with no key stays listed, waiting for one', async () => {
  const { body } = await call('POST', '/api/models/providers/groq', {})
  const groq = provider(body, 'groq')
  assert.equal(groq.listed, true)
  assert.equal(groq.configured, false)
})

test('a custom provider: its models, its key, and refusals', async () => {
  const { status, body } = await call('POST', '/api/models/custom', {
    id: 'my-gateway',
    name: 'My Gateway',
    api: 'openai-completions',
    baseUrl: 'https://gw.example/v1',
    key: 'sk-gw',
    models: ['m-large', 'm-small'],
  })
  assert.equal(status, 200)
  const gw = provider(body, 'my-gateway')
  assert.equal(gw.custom, true)
  assert.equal(gw.name, 'My Gateway')
  assert.equal(gw.api, 'openai-completions')
  assert.deepEqual(gw.models.map((m) => m.id), ['m-large', 'm-small'])
  assert.equal(gw.configured, true)
  assert.equal((await call('POST', '/api/models/custom', { id: 'openai', api: 'openai-completions', baseUrl: 'https://x.example', models: ['a'] })).status, 409)
  assert.equal((await call('POST', '/api/models/custom', { id: 'Bad_ID', api: 'openai-completions', baseUrl: 'https://x.example', models: ['a'] })).status, 400)
  assert.equal((await call('POST', '/api/models/custom', { id: 'nomodels', api: 'openai-completions', baseUrl: 'https://x.example', models: [] })).status, 400)
  assert.equal((await call('POST', '/api/models/custom', { id: 'badapi', api: 'smoke-signals', baseUrl: 'https://x.example', models: ['a'] })).status, 400)
})

test('the default model: set, checked, cleared with its provider', async () => {
  let { status, body } = await call('POST', '/api/models/default', { provider: 'deepseek', model: provider((await call('GET', '/api/models')).body, 'deepseek').models[0].id, thinking: 'high' })
  assert.equal(status, 200)
  assert.equal(body.default.provider, 'deepseek')
  assert.equal(body.default.thinking, 'high')
  assert.equal(body.default.usable, true)
  assert.equal((await call('POST', '/api/models/default', { provider: 'deepseek', model: 'no-such-model' })).status, 400)
  assert.equal((await call('POST', '/api/models/default', { provider: 'openai', model: 'gpt-5.5', thinking: 'extreme' })).status, 400)
  ;({ status, body } = await call('DELETE', '/api/models/providers/deepseek'))
  assert.equal(status, 200)
  assert.equal(provider(body, 'deepseek').credential, null)
  assert.equal(provider(body, 'deepseek').listed, false)
  assert.equal(body.default, null)
  assert.ok(!readFileSync(join(state, 'pi', 'auth.json'), 'utf8').includes('sk-secret-deepseek'))
})

test('removing a custom provider drops it; unknown ones 404; bodies are JSON objects', async () => {
  const { body } = await call('DELETE', '/api/models/providers/my-gateway')
  assert.equal(provider(body, 'my-gateway'), undefined)
  assert.equal((await call('DELETE', '/api/models/providers/nobody')).status, 404)
  const res = await fetch(`${url}/api/models/default`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: '[1]' })
  assert.equal(res.status, 400)
})

test('removing a provider whose key is in the environment hides it until it is added again', async () => {
  let { status, body } = await call('DELETE', '/api/models/providers/openai')
  assert.equal(status, 200)
  assert.equal(provider(body, 'openai').listed, false)
  assert.equal(provider(body, 'openai').configured, false)
  assert.equal(process.env.OPENAI_API_KEY, undefined)
  assert.deepEqual(JSON.parse(readFileSync(join(state, 'pi', 'connect.json'), 'utf8')).hidden, ['openai'])
  // a default set meanwhile keeps the list
  await call('POST', '/api/models/custom', { id: 'gw2', api: 'openai-completions', baseUrl: 'https://gw.example/v1', key: 'sk-gw', models: ['m'] })
  await call('POST', '/api/models/default', { provider: 'gw2', model: 'm' })
  assert.deepEqual(JSON.parse(readFileSync(join(state, 'pi', 'connect.json'), 'utf8')).hidden, ['openai'])
  ;({ body } = await call('POST', '/api/models/providers/openai', {}))
  assert.equal(provider(body, 'openai').configured, true)
  assert.equal(provider(body, 'openai').source, 'environment')
  assert.equal(process.env.OPENAI_API_KEY, 'sk-from-env')
  assert.equal(JSON.parse(readFileSync(join(state, 'pi', 'connect.json'), 'utf8')).hidden, undefined)
  assert.equal(JSON.parse(readFileSync(join(state, 'pi', 'connect.json'), 'utf8')).provider, 'gw2')
})

test('a new host on the same state starts with the hidden key hidden', async () => {
  await call('DELETE', '/api/models/providers/openai')
  process.env.OPENAI_API_KEY = 'sk-from-env'
  const again = new Models({ state })
  const view = await again.view()
  assert.equal(provider(view, 'openai').configured, false)
  assert.equal(process.env.OPENAI_API_KEY, undefined)
})
