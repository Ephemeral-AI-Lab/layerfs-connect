// Exercise the packaged host with a local model: no real provider or credentials.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { setTimeout as pause } from 'node:timers/promises'

const app = resolve(process.argv[2] ?? (() => { throw new Error('Usage: node tools/smoke-package.mjs <app>') })())
const resources = join(app, 'Contents', 'Resources')
const backend = join(resources, 'backend')
const bin = join(resources, 'runtime', 'bin')
const temp = await mkdtemp(join(tmpdir(), 'connect-package-'))
const work = join(temp, 'work')
await mkdir(work)
let child
let logs = ''
let requests = 0
const server = createServer(async (req, res) => {
  let body = ''
  for await (const data of req) body += data
  const request = JSON.parse(body)
  requests++
  const content = (value) => typeof value === 'string' ? value : (value ?? []).map((v) => v.text ?? '').join('')
  const user = content(request.messages.findLast((message) => message.role === 'user')?.content)
  const done = request.messages.at(-1)?.role === 'tool'
  let delta
  if (done) delta = { role: 'assistant', content: 'PACKAGED_DONE' }
  else if (user.includes('DELEGATE')) delta = {
    role: 'assistant', tool_calls: [{ index: 0, id: `call_${requests}`, type: 'function', function: {
      name: 'subagent', arguments: JSON.stringify({ agent: 'connect-worker', task: 'CHILD_TASK', async: false }),
    } }],
  }
  else delta = {
    role: 'assistant', tool_calls: [{ index: 0, id: `call_${requests}`, type: 'function', function: {
      name: 'bash', arguments: JSON.stringify({ command: user.includes('CHILD_TASK')
        ? "printf 'child-ok' > child.txt; cat child.txt" : "printf 'parent-ok' > parent.txt; cat parent.txt" }),
    } }],
  }
  const chunk = (value, finish_reason = null) => ({ id: `reply_${requests}`, object: 'chat.completion.chunk', created: 1, model: request.model, choices: [{ index: 0, delta: value, finish_reason }] })
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  res.write(`data: ${JSON.stringify(chunk(delta))}\n\n`)
  res.write(`data: ${JSON.stringify({ ...chunk({}, delta.tool_calls ? 'tool_calls' : 'stop'), usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } })}\n\n`)
  res.end('data: [DONE]\n\n')
})
try {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  child = spawn(join(bin, 'node'), [join(backend, 'host', 'main.js'), '--state', join(temp, 'state')], {
    cwd: temp,
    env: {
      ...process.env, HOME: temp, PATH: `${bin}:/usr/bin:/bin:/usr/sbin:/sbin`,
      LAYERFS_CONNECT_MODE: 'sim', LAYERFS_CONNECT_STATE: join(temp, 'state'),
      LAYERFS_CONNECT_CLI: join(bin, 'layerfs'), LAYERFS_CONNECT_DAEMON: join(bin, 'layerfs-daemon'),
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  child.stderr.on('data', (data) => { logs += data })
  const ready = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Packaged host did not start: ${logs}`)), 30_000)
    const lines = createInterface({ input: child.stdout })
    lines.once('line', (line) => { clearTimeout(timer); resolve(JSON.parse(line)) })
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Host exited ${code}: ${logs}`)) })
    child.once('error', (error) => { clearTimeout(timer); reject(error) })
  })
  assert.equal(ready.ready, true)
  const call = async (path, body) => {
    const response = await fetch(`${ready.url}/api/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { authorization: `Bearer ${ready.token}`, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(30_000),
    })
    const value = await response.json()
    assert.ok(response.ok, `${path}: ${JSON.stringify(value)}`)
    return value
  }
  for (const path of ['status', 'machines', 'storage', 'agent/capabilities']) await call(path)
  await call('agent/models', {
    provider: 'package-test', modelId: 'local-model', api: 'openai-completions',
    baseUrl: `http://127.0.0.1:${server.address().port}/v1`, apiKey: 'local-test-only',
  })
  for (const task of ['BASH_TASK', 'DELEGATE']) {
    const chat = await call('agent/sessions', { cwd: work, permissionMode: 'full' })
    await call(`agent/sessions/${chat.id}/message`, { text: task })
    const deadline = Date.now() + 45_000
    let detail
    do {
      detail = await call(`agent/sessions/${chat.id}`)
      if (detail.state !== 'running') break
      await pause(100)
    } while (Date.now() < deadline)
    assert.equal(detail.state, 'idle', JSON.stringify({ task, error: detail.error, phase: detail.execution?.phase }))
    assert.equal(detail.messages.filter((m) => m.role === 'assistant').at(-1)?.text, 'PACKAGED_DONE')
  }
  assert.equal(await readFile(join(work, 'parent.txt'), 'utf8'), 'parent-ok')
  assert.equal(await readFile(join(work, 'child.txt'), 'utf8'), 'child-ok')
  const exit = once(child, 'exit')
  child.stdin.end()
  const [code] = await Promise.race([exit, pause(15_000).then(() => { throw new Error('Host did not stop when its parent closed stdin') })])
  assert.equal(code, 0)
  console.log(`PASS: packaged host APIs, Pi streaming, bash, subagent execution and clean shutdown (${requests} local model calls).`)
} finally {
  child?.kill()
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
  await rm(temp, { recursive: true, force: true })
}
