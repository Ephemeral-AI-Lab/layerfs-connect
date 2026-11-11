import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
const flag = name => process.argv[process.argv.indexOf(name) + 1]
const endpoint = JSON.parse(await readFile(flag('--host-receipt'), 'utf8'))
const target = (await (await fetch('http://127.0.0.1:18800/json/list')).json()).find(item => item.id === flag('--target'))
assert.ok(target && /^http:\/\/127\.0\.0\.1:1025\//.test(target.url), 'Select an owned preview tab')
const ws = new WebSocket(target.webSocketDebuggerUrl), pending = new Map(); let next = 0
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject })
ws.onmessage = event => { const m = JSON.parse(event.data), p = pending.get(m.id); if (p) { pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result) } }
const evaluate = expression => new Promise((resolve, reject) => { const id = ++next; pending.set(id, { resolve: r => r.exceptionDetails ? reject(new Error(r.exceptionDetails.text)) : resolve(r.result.value), reject }); ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true } })) })
const rows = () => evaluate(`[...document.querySelectorAll('aside a[href^="#/chat/"]')].filter(a=>a.querySelector('[aria-label="Working"]')).map(a=>a.getAttribute('href'))`)
const progress = async () => (await (await fetch(endpoint.url + '/api/simulations', { headers: { authorization: 'Bearer ' + endpoint.token } })).json()).reduce((n, run) => n + (run.progress?.completed ?? 0), 0)
try {
  const initial = await rows(), before = await progress(), samples = []
  assert.ok(initial.length >= 2, 'At least two real running conversations must be visible')
  for (let i = 0; i < 20; i++) {
    await new Promise(resolve => setTimeout(resolve, 500))
    const current = await rows(), common = new Set(current.filter(id => initial.includes(id)))
    assert.deepEqual(current.filter(id => common.has(id)), initial.filter(id => common.has(id)), 'Running conversations changed relative position')
    samples.push({ at: Date.now(), running: current.length, common: common.size })
  }
  const after = await progress()
  assert.ok(after > before, 'Real CLI progress must advance during the stability check')
  const result = { passed: true, runningAtStart: initial.length, samples: samples.length, durationMs: 10000, confirmedCommandsDuringCheck: after - before, positionChanges: 0 }
  await writeFile(flag('--output'), JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify(result))
} finally { ws.close() }
