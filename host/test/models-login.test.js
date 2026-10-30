// Subscription sign-in through the host's HTTP API: models.js's login
// sessions over a stand-in for pi's runtime whose login() plays the
// openai-codex flow (choose a method; the browser way shows a URL and also
// takes a pasted redirect URL; the device way shows a code and waits).
// No network, no browser.
//   node --test host/test/models-login.test.js
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { setTimeout as pause } from 'node:timers/promises'
import { Models } from '../models.js'
import { createHostServer, listen, newToken } from '../server.js'

const state = mkdtempSync(join(tmpdir(), 'connect-login-'))
const token = newToken()
const opened = []
const models = new Models({ state }, process.env, { openUrl: (url) => opened.push(url) })

/** The device flow waits on this; the test settles it as OpenAI would. */
let deviceApproved
const stored = []
const fakeRuntime = {
  getProvider: (id) => (id === 'openai-codex' ? { id, auth: { oauth: { name: 'OpenAI (ChatGPT Plus/Pro)' } } } : id === 'deepseek' ? { id, auth: { apiKey: {} } } : undefined),
  async login(id, kind, interaction, options) {
    assert.equal(kind, 'oauth')
    assert.equal(options.agentName, 'LayerFS Connect')
    assert.match(options.getDeviceId(), /^[0-9a-f-]{36}$/)
    const method = await interaction.prompt({
      type: 'select',
      message: 'Select OpenAI Codex login method:',
      options: [
        { id: 'browser', label: 'Browser login (default)' },
        { id: 'device_code', label: 'Device code login (headless)' },
      ],
    })
    if (method === 'device_code') {
      interaction.notify({ type: 'device_code', userCode: 'ABCD-1234', verificationUri: 'https://auth.openai.com/codex/device', expiresInSeconds: 900 })
      await new Promise((resolve, reject) => {
        deviceApproved = resolve
        interaction.signal.addEventListener('abort', () => reject(new Error('aborted')))
      })
    } else {
      interaction.notify({ type: 'auth_url', url: 'https://auth.openai.com/oauth/authorize?x=1', instructions: 'A browser window should open.' })
      const pasted = await interaction.prompt({ type: 'manual_code', message: 'Paste the redirect URL', placeholder: 'http://localhost:1455/auth/callback' })
      if (!pasted.includes('code=')) throw new Error('Missing authorization code')
    }
    stored.push(id)
  },
}

const server = createHostServer({ token, projects: {}, models, log: () => {} })
let url
before(async () => {
  models.rt = Promise.resolve(fakeRuntime)
  models.reload = () => {}
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
/** Polls a sign-in until `ok` holds, as the dialog does. */
async function until(id, ok) {
  for (let i = 0; i < 100; i++) {
    const { body } = await call('GET', `/api/models/logins/${id}`)
    if (ok(body)) return body
    await pause(10)
  }
  throw new Error(`sign-in ${id} never reached the state`)
}

test('the browser way: choose it, open the page, paste the redirect URL, done', async () => {
  const { status, body: started } = await call('POST', '/api/models/providers/openai-codex/login')
  assert.equal(status, 200)
  let login = await until(started.id, (l) => l.prompt?.type === 'select')
  assert.deepEqual(login.prompt.options.map((o) => o.id), ['browser', 'device_code'])
  assert.equal((await call('POST', `/api/models/logins/${login.id}/respond`, { value: 'carrier-pigeon' })).status, 400)
  await call('POST', `/api/models/logins/${login.id}/respond`, { value: 'browser' })
  login = await until(login.id, (l) => l.step?.type === 'auth_url' && l.prompt?.type === 'manual_code')
  assert.equal(login.state, 'waiting')
  assert.equal((await call('POST', `/api/models/logins/${login.id}/open`)).status, 200)
  assert.deepEqual(opened, ['https://auth.openai.com/oauth/authorize?x=1'])
  await call('POST', `/api/models/logins/${login.id}/respond`, { value: 'http://localhost:1455/auth/callback?code=abc&state=s' })
  login = await until(login.id, (l) => l.state === 'done')
  assert.equal(login.prompt, null)
  assert.deepEqual(stored, ['openai-codex'])
})

test('the device way: shows the code and its page, finishes when approved', async () => {
  const { body: started } = await call('POST', '/api/models/providers/openai-codex/login')
  await until(started.id, (l) => l.prompt?.type === 'select')
  await call('POST', `/api/models/logins/${started.id}/respond`, { value: 'device_code' })
  let login = await until(started.id, (l) => l.step?.type === 'device_code')
  assert.equal(login.step.userCode, 'ABCD-1234')
  assert.equal(login.step.verificationUri, 'https://auth.openai.com/codex/device')
  assert.ok(login.step.expires > Date.now())
  assert.equal((await call('POST', `/api/models/logins/${login.id}/respond`, { value: 'x' })).status, 409)
  deviceApproved()
  login = await until(login.id, (l) => l.state === 'done')
  assert.deepEqual(stored, ['openai-codex', 'openai-codex'])
})

test('cancelling ends the sign-in and pi`s flow; a new one cancels the old', async () => {
  const { body: first } = await call('POST', '/api/models/providers/openai-codex/login')
  await until(first.id, (l) => l.prompt?.type === 'select')
  const { body: second } = await call('POST', '/api/models/providers/openai-codex/login')
  assert.equal((await until(first.id, (l) => l.state === 'cancelled')).prompt, null)
  const { body: cancelled } = await call('POST', `/api/models/logins/${second.id}/cancel`)
  assert.equal(cancelled.state, 'cancelled')
  assert.equal(stored.length, 2)
})

test('refusals: no sign-in for a key provider, unknown ones, nothing to open yet', async () => {
  assert.equal((await call('POST', '/api/models/providers/deepseek/login')).status, 400)
  assert.equal((await call('POST', '/api/models/providers/nobody/login')).status, 404)
  assert.equal((await call('GET', '/api/models/logins/nope')).status, 404)
  const { body: login } = await call('POST', '/api/models/providers/openai-codex/login')
  await until(login.id, (l) => l.prompt?.type === 'select')
  assert.equal((await call('POST', `/api/models/logins/${login.id}/open`)).status, 409)
  await call('POST', `/api/models/logins/${login.id}/cancel`)
})
