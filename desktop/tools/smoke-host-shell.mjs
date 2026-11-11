// Interaction proof for a project chat whose Sandbox is a container: its bash
// ran on the host and drove the Workspace with the recorded LayerFS CLI. Chat
// shows the tool's operations and its save's link; Trace shows them with no
// coverage gap; at 1280x820 and 900x600, with console errors checked.
//   node desktop/tools/smoke-host-shell.mjs <chat id> [preview url]
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const [chat, preview = 'http://127.0.0.1:1025/'] = process.argv.slice(2)
const profile = await mkdtemp(join(tmpdir(), 'connect-hostshell-'))
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' })
const pause = (ms) => new Promise((r) => setTimeout(r, ms))
async function until(read, label, ms = 20000) {
  const deadline = Date.now() + ms
  do { const v = await read(); if (v) return v; await pause(100) } while (Date.now() < deadline)
  throw new Error(`Timed out: ${label}`)
}
const report = []
let socket, pageText = async () => ''
try {
  const port = await until(async () => { try { return Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]) } catch { return null } }, 'Chrome startup')
  socket = new WebSocket((await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page').webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
  let sequence = 0
  const pending = new Map(), errors = []
  socket.onmessage = (event) => {
    const r = JSON.parse(event.data)
    if (r.method === 'Runtime.exceptionThrown') errors.push(r.params.exceptionDetails.exception?.description ?? r.params.exceptionDetails.text)
    if (r.method === 'Runtime.consoleAPICalled' && r.params.type === 'error') errors.push(r.params.args.map((a) => a.value ?? a.description).join(' '))
    const w = pending.get(r.id)
    if (!w) return
    pending.delete(r.id)
    r.error ? w.reject(new Error(r.error.message)) : w.resolve(r.result)
  }
  const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })) })
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
    return r.result.value
  }
  pageText = () => evaluate('location.hash + "\\n" + document.body.innerText.slice(0, 1500)')
  const click = async (selector, text = '') => {
    const point = await until(() => evaluate(`(() => { const n = [...document.querySelectorAll(${JSON.stringify(selector)})].find(e => e.textContent.includes(${JSON.stringify(text)})); if (!n) return null; n.scrollIntoView({block:'center'}); const r = n.getBoundingClientRect(); return r.width && r.height ? {x:r.x+r.width/2,y:r.y+r.height/2} : null })()`), `${selector} ${text}`)
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point })
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point })
  }
  const has = (selector, text = '', ms) => until(() => evaluate(`[...document.querySelectorAll(${JSON.stringify(selector)})].some(e => e.textContent.includes(${JSON.stringify(text)}))`), `${selector} ${text}`, ms)
  const overflow = () => evaluate('document.documentElement.scrollWidth - window.innerWidth')
  await send('Page.enable'); await send('Runtime.enable')
  for (const [width, height] of [[1280, 820], [900, 600]]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
    await send('Page.navigate', { url: `${preview}?mac=1#/chat/${chat}` }); await pause(500)
    // the same hash keeps the page: a block opened at the previous size stays open
    await send('Page.reload'); await pause(800)
    await click('button[aria-expanded="false"]', 'LayerFS operations')
    await has('button[aria-expanded]', '3 ops · 1 link')
    await click('button[aria-expanded="false"]', '3 ops · 1 link')
    await has('[aria-label="LayerFS operations"] [role="listitem"]', 'workspace.exec')
    await has('[aria-label="LayerFS operations"] [role="listitem"]', 'file.read')
    await has('[aria-label="LayerFS operations"] a[href*="/history?"]', 'Created Commit')
    assert.ok(await overflow() <= 0, 'no horizontal overflow in Chat')
    report.push(`${width}x${height}: Chat step of the host bash — 3 ops (CLI workspace.exec, CLI file.read, save) · 1 link`)
    await send('Page.navigate', { url: `${preview}?mac=1#/chat/${chat}/trace` }); await pause(500)
    await click('[role="tab"]', 'Operations')
    await has('p', 'operation')
    await click('[aria-label="LayerFS operations"] button', 'workspace.exec')
    await has('section[aria-label="Operation workspace.exec"] header', '· cli · tool')
    assert.equal(await evaluate(`[...document.querySelectorAll('[role="note"]')].some(n => n.textContent.includes('Coverage'))`), false, 'no coverage gap')
    assert.ok(await overflow() <= 0, 'no horizontal overflow in Trace')
    report.push(`${width}x${height}: Trace — the agent's workspace.exec is a cli operation of its tool; no coverage gap`)
  }
  assert.deepEqual(errors, [], `console errors: ${errors.join('\n')}`)
  report.push('console: no errors or exceptions')
  console.log(report.join('\n'))
} catch (error) {
  console.error(report.join('\n'))
  try { console.error('Page text:', await pageText()) } catch { /* the page is gone */ }
  throw error
} finally {
  socket?.close()
  const exited = new Promise((r) => chrome.once('exit', r))
  chrome.kill()
  await exited
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
