// server.js over a stand-in projects module and RunManager: auth, CORS,
// routes, errors and the event stream. No LayerFS.
//   node --test host/test/server.test.js
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { after, before, test } from 'node:test'
import { createHostServer, listen, newToken } from '../server.js'

const calls = []
const record =
  (name, answer) =>
  (...args) => {
    calls.push([name, ...args])
    return typeof answer === 'function' ? answer(...args) : answer
  }
const refusal = (code, message) => Object.assign(new Error(message), { code })

const projects = {
  status: record('status', { platform: 'macos', missing: [] }),
  startWorker: record('startWorker', { platform: 'macos', worker: { state: 'running' } }),
  list: record('list', [{ name: 'shop' }]),
  state: record('state', (name) => {
    if (name === 'gone') throw refusal('NoSuchProject', 'no LayerFS project named gone')
    return { project: { name } }
  }),
  commits: record('commits', []),
  listDir: record('listDir', [{ name: 'a', path: '/a', kind: 'file', size: 1 }]),
  file: record('file', () => {
    throw refusal('Binary', 'Binary: not text')
  }),
  remove: record('remove', { removed: true }),
}

class FakeRuns extends EventEmitter {
  demos = () => [{ id: 'tour' }]
  demo = (id) => (id === 'tour' ? { id } : null)
  start = async (id) => {
    if (id === 'boom') throw new Error('engine broke')
    return { id: 'r1', demo: id }
  }
  runs = (demo) => [{ id: 'r1', demo: demo ?? null }]
  run = (id) => (id === 'r1' ? { id } : null)
  stop = (id) => ({ id, state: 'stopped' })
}

const token = newToken()
const runs = new FakeRuns()
let engine = runs
const logs = []
const server = createHostServer({ token, projects, runs: () => engine, runsError: () => 'no runs/index.js', heartbeatMs: 50, log: (l) => logs.push(l) })
let url

before(async () => {
  url = await listen(server, 0)
})
after(() => new Promise((resolve) => server.close(resolve)))

const auth = { authorization: `Bearer ${token}` }
async function call(method, path, headers = auth) {
  const res = await fetch(url + path, { method, headers })
  const text = await res.text()
  return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null }
}

test('the token is 32 random bytes as hex', () => {
  assert.match(token, /^[0-9a-f]{64}$/)
  assert.notEqual(newToken(), token)
})

test('every route needs the bearer token', async () => {
  for (const headers of [{}, { authorization: 'Bearer nope' }, { authorization: token }, { authorization: `Bearer ${token}x` }]) {
    const res = await call('GET', '/api/status', headers)
    assert.equal(res.status, 401)
    assert.equal(res.body.code, 'unauthorized')
  }
  // the token in the query is taken only by the event stream
  assert.equal((await call('GET', `/api/status?token=${token}`, {})).status, 401)
})

test('CORS: any origin, Authorization and Content-Type, OPTIONS answered without a token', async () => {
  const res = await fetch(url + '/api/projects', { method: 'OPTIONS', headers: { origin: 'http://localhost:5173', 'access-control-request-method': 'GET' } })
  assert.equal(res.status, 204)
  assert.equal(res.headers.get('access-control-allow-origin'), '*')
  assert.match(res.headers.get('access-control-allow-headers'), /Authorization/)
  assert.match(res.headers.get('access-control-allow-headers'), /Content-Type/)
  assert.match(res.headers.get('access-control-allow-methods'), /DELETE/)
  const ok = await call('GET', '/api/status')
  assert.equal(ok.headers.get('access-control-allow-origin'), '*')
  const refused = await call('GET', '/api/status', {})
  assert.equal(refused.headers.get('access-control-allow-origin'), '*')
})

test('project routes pass their arguments through', async () => {
  calls.length = 0
  assert.deepEqual((await call('GET', '/api/status')).body, { platform: 'macos', missing: [] })
  assert.equal((await call('POST', '/api/worker/start')).body.worker.state, 'running')
  assert.deepEqual((await call('GET', '/api/projects')).body, [{ name: 'shop' }])
  assert.deepEqual((await call('GET', '/api/projects/shop')).body, { project: { name: 'shop' } })
  assert.deepEqual((await call('GET', '/api/projects/shop/commits?branch=cart&limit=5')).body, [])
  await call('GET', '/api/projects/shop/commits')
  await call('GET', '/api/projects/shop/fs?branch=cart&path=%2Fsrc')
  await call('GET', '/api/projects/shop/fs')
  assert.deepEqual((await call('DELETE', '/api/projects/shop')).body, { removed: true })
  assert.deepEqual(calls, [
    ['status'],
    ['startWorker'],
    ['list'],
    ['state', 'shop'],
    ['commits', 'shop', 'cart', '5'],
    ['commits', 'shop', 'main', null],
    ['listDir', 'shop', 'cart', '/src'],
    ['listDir', 'shop', 'main', '/'],
    ['remove', 'shop'],
  ])
})

test('refusals answer { code, message } with their status', async () => {
  const gone = await call('GET', '/api/projects/gone')
  assert.equal(gone.status, 404)
  assert.deepEqual(gone.body, { code: 'NoSuchProject', message: 'no LayerFS project named gone' })
  const binary = await call('GET', '/api/projects/shop/file?path=/x')
  assert.equal(binary.status, 400)
  assert.equal(binary.body.code, 'Binary')
  const none = await call('GET', '/api/nothing')
  assert.equal(none.status, 404)
  assert.equal(none.body.code, 'not-found')
  assert.equal((await call('PUT', '/api/projects')).status, 404)
  const broke = await call('POST', '/api/demos/boom/runs')
  assert.equal(broke.status, 500)
  assert.deepEqual(broke.body, { code: 'failed', message: 'engine broke' })
  assert.ok(logs.some((l) => l.includes('engine broke')))
})

test('demo and run routes go to the RunManager', async () => {
  assert.deepEqual((await call('GET', '/api/demos')).body, [{ id: 'tour' }])
  assert.deepEqual((await call('GET', '/api/demos/tour')).body, { id: 'tour' })
  assert.equal((await call('GET', '/api/demos/nope')).status, 404)
  assert.deepEqual((await call('POST', '/api/demos/tour/runs')).body, { id: 'r1', demo: 'tour' })
  assert.deepEqual((await call('GET', '/api/runs?demo=tour')).body, [{ id: 'r1', demo: 'tour' }])
  assert.deepEqual((await call('GET', '/api/runs')).body, [{ id: 'r1', demo: null }])
  assert.deepEqual((await call('GET', '/api/runs/r1')).body, { id: 'r1' })
  assert.equal((await call('GET', '/api/runs/r2')).status, 404)
  assert.deepEqual((await call('POST', '/api/runs/r1/stop')).body, { id: 'r1', state: 'stopped' })
})

test('without the engine, demo and run routes answer 503 with the reason', async () => {
  engine = null
  try {
    for (const [method, path] of [['GET', '/api/demos'], ['GET', '/api/demos/tour'], ['POST', '/api/demos/tour/runs'], ['GET', '/api/runs'], ['GET', '/api/runs/r1'], ['POST', '/api/runs/r1/stop']]) {
      const res = await call(method, path)
      assert.equal(res.status, 503, path)
      assert.equal(res.body.code, 'engine-unavailable')
      assert.match(res.body.message, /no runs\/index\.js/)
    }
    // project routes still work
    assert.equal((await call('GET', '/api/projects')).status, 200)
  } finally {
    engine = runs
  }
})

/** Reads an event stream until `enough(text)`; answers the text. */
async function readStream(path, enough, headers = {}) {
  const controller = new AbortController()
  const res = await fetch(url + path, { headers, signal: controller.signal })
  assert.equal(res.status, 200)
  assert.match(res.headers.get('content-type'), /^text\/event-stream/)
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let text = ''
  const deadline = setTimeout(() => controller.abort(), 5000)
  try {
    while (!enough(text)) {
      const { value, done } = await reader.read()
      if (done) break
      text += decoder.decode(value, { stream: true })
      if (text.includes(': connected')) runs.emit('event', { type: 'run', run: { id: 'r1' } })
    }
  } finally {
    clearTimeout(deadline)
    controller.abort()
  }
  return text
}

test('the event stream forwards RunManager events and heartbeats, then cleans up', async () => {
  assert.equal((await call('GET', '/api/events', {})).status, 401)
  assert.equal((await call('GET', '/api/events?token=wrong', {})).status, 401)
  const before = runs.listenerCount('event')
  const text = await readStream(`/api/events?token=${token}`, (t) => t.includes('data: ') && t.includes(': heartbeat'))
  assert.match(text, /^: connected\n\n/)
  assert.ok(text.includes(`data: ${JSON.stringify({ type: 'run', run: { id: 'r1' } })}\n\n`))
  assert.ok(text.includes(': heartbeat\n\n'))
  // the closed stream's listener goes
  for (let i = 0; i < 50 && runs.listenerCount('event') > before; i++) await new Promise((r) => setTimeout(r, 20))
  assert.equal(runs.listenerCount('event'), before)
})

test('the event stream opens without the engine (heartbeats only)', async () => {
  engine = null
  try {
    const text = await readStream(`/api/events?token=${token}`, (t) => t.includes(': heartbeat'))
    assert.ok(!text.includes('data: '))
  } finally {
    engine = runs
  }
})
