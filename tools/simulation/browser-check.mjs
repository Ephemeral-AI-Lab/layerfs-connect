// Exercise the actual preview composer through an already-running Chrome CDP.
// --launch explicitly starts one real run; otherwise only argument errors/help
// are checked. Never launches or restarts Chrome, Electron or the preview host.
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
const value = (flag, fallback) => { const at = process.argv.indexOf(flag); return at < 0 ? fallback : process.argv[at + 1] }
const port = value('--cdp', '18800')
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const requested = value('--target')
const target = targets.find(t => t.type === 'page' && (requested ? t.id === requested : /^http:\/\/(127\.0\.0\.1|localhost):1025\//.test(t.url)))
assert.ok(target, 'Open the actual Connect web preview in Chrome before running this check.')
assert.match(target.url, /^http:\/\/(127\.0\.0\.1|localhost):1025\//, 'Target must be the Connect preview, not Electron or an unrelated page.')
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject })
let sequence = 0
const waiting = new Map(), exceptions = [], consoleErrors = []
ws.onmessage = event => {
  const message = JSON.parse(event.data)
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') consoleErrors.push(message.params.args.map(arg => arg.value ?? arg.description ?? arg.type).join(' '))
  if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails.text)
  const request = waiting.get(message.id)
  if (request) { waiting.delete(message.id); message.error ? request.reject(new Error(message.error.message)) : request.resolve(message.result) }
}
const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence; waiting.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })) })
const evaluate = async expression => {
  const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text)
  return result.result.value
}
const until = async (expression, label, timeout = 15000) => {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) { const result = await evaluate(expression); if (result) return result; await new Promise(resolve => setTimeout(resolve, 250)) }
  throw new Error(`Timed out waiting for ${label}`)
}
const input = async text => {
  await until(`(() => { const element = document.querySelector('textarea[aria-label="Message"]'); return element && !element.disabled && !!element.getClientRects().length })()`, 'editable composer')
  await evaluate(`(() => { const element = document.querySelector('textarea[aria-label="Message"]'); element.focus(); element.select(); })()`)
  if (text) await call('Input.insertText', { text })
  else {
    await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 })
    await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 })
  }
  // Let React commit the input event before checking its controlled value.
  await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  await until(`document.querySelector('textarea[aria-label="Message"]')?.value === ${JSON.stringify(text)}`, 'composer draft')
}
const send = async () => {
  await until(`(() => { const button = document.querySelector('button[aria-label="Send"]'); return button && !button.disabled })()`, 'enabled Send')
  await evaluate(`document.querySelector('button[aria-label="Send"]').click()`)
}
const report = { target: target.id, started: new Date().toISOString(), checks: [], exceptions, consoleErrors }
try {
  await call('Runtime.enable')
  // Work in this preview's new-chat view; do not touch another tab/session.
  await evaluate(`location.hash = '#/'`)
  await until(`location.hash === '#/' && document.querySelector('h1')?.textContent === 'What should we work on?' && !!document.querySelector('textarea[aria-label="Message"]')`, 'new chat composer')
  const priorDraft = await evaluate(`document.querySelector('textarea[aria-label="Message"]').value`)
  await input('/sim')
  await until(`document.body.innerText.includes('Simulation · run scripted project conversations')`, 'slash-command help')
  report.checks.push('Slash command discovery appears for /sim')
  await input('/simulation --project design --machine native --mixed=invalid')
  await send()
  await until(`document.body.innerText.includes('--mixed accepts true or false.')`, 'invalid boolean error')
  report.checks.push('Invalid boolean is rejected inline without launching a run')
  await input('/simulation --project design --machine native')
  await until(`document.body.innerText.includes('Scripted simulation · fresh SQLite Store · no model required')`, 'valid simulation input committed')
  report.checks.push('Valid command replaces rejected input through trusted Chrome input events')
  if (process.argv.includes('--launch')) {
    const project = value('--project', 'design'), machine = value('--machine', 'native')
    assert.match(project, /^[a-zA-Z0-9_-]+$/); assert.match(machine, /^[a-zA-Z0-9_-]+$/)
    const command = `/simulation --project ${project} --machine ${machine}${process.argv.includes('--mixed') ? ' --mixed' : ''}`
    await input(command)
    await send()
    const sessionHash = await until(`location.hash.startsWith('#/chat/') && !location.hash.startsWith('#/chat/new') ? location.hash : null`, 'saved simulation conversation', 120000)
    report.checks.push(`Command opened saved conversation ${sessionHash}`)
    await until(`document.body.innerText.includes('Stop simulation') || document.body.innerText.includes('Simulation')`, 'simulation status')
    report.checks.push('Run status rendered in actual saved chat')
  } else await input(priorDraft)
  for (const [width, height] of [[1280, 820], [900, 600]]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
    assert.equal(await evaluate('document.documentElement.scrollWidth > innerWidth'), false, `No page overflow at ${width}`)
    report.checks.push(`No page overflow at ${width}x${height}`)
  }
  assert.deepEqual(exceptions, [], 'No browser runtime exceptions')
  assert.deepEqual(consoleErrors, [], 'No browser console errors')
  report.finished = new Date().toISOString()
  const output = value('--output')
  if (output) await writeFile(output, JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report, null, 2))
} finally { await call('Emulation.clearDeviceMetricsOverride').catch(() => {}); ws.close() }
