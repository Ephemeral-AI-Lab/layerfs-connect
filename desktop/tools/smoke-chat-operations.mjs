// Interaction proof for recorded LayerFS operations in the real preview:
// Chat step summary -> saved-version link -> History producer -> Trace
// operation inspector, the Trace Operations view and its filters, reload,
// at 1280x820 and 900x600, with console errors and horizontal overflow checked.
//   node desktop/tools/smoke-chat-operations.mjs <mounted chat id> <sdk chat id> [preview url]
// Both chats must already exist in the preview home (real chats; see docs/specs/chat-session-store-record.md).
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const [mountedChat, sdkChat, preview = 'http://127.0.0.1:1025/'] = process.argv.slice(2)
if (!mountedChat || !sdkChat) throw new Error('usage: smoke-chat-operations.mjs <mounted chat id> <sdk chat id> [preview url]')
const profile = await mkdtemp(join(tmpdir(), 'connect-operations-'))
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' })
const pause = (ms) => new Promise((r) => setTimeout(r, ms))
async function until(read, label, ms = 15000) {
  const deadline = Date.now() + ms
  do { const v = await read(); if (v) return v; await pause(80) } while (Date.now() < deadline)
  throw new Error(`Timed out: ${label}`)
}
const report = []
let socket
let evaluateText = async () => ''
try {
  const port = await until(async () => { try { return Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]) } catch { return null } }, 'Chrome startup')
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  socket = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl)
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
  // clicks the first element matching `selector` whose text includes `text`, with real mouse events
  const click = async (selector, text = '') => {
    const point = await until(() => evaluate(`(() => { const n = [...document.querySelectorAll(${JSON.stringify(selector)})].find(e => e.textContent.includes(${JSON.stringify(text)})); if (!n) return null; n.scrollIntoView({block:'center'}); const r = n.getBoundingClientRect(); return r.width && r.height ? {x:r.x+r.width/2,y:r.y+r.height/2} : null })()`), `${selector} ${text}`)
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point })
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point })
  }
  const has = (selector, text = '') => until(() => evaluate(`[...document.querySelectorAll(${JSON.stringify(selector)})].some(e => e.textContent.includes(${JSON.stringify(text)}))`), `${selector} ${text}`)
  const hash = () => evaluate('location.hash')
  const overflow = () => evaluate('document.documentElement.scrollWidth - window.innerWidth')
  const navigate = async (h) => { await send('Page.navigate', { url: `${preview}?mac=1${h}` }); await pause(400) }
  await send('Page.enable'); await send('Runtime.enable')
  evaluateText = () => evaluate('location.hash + "\\n" + document.body.innerText.slice(0, 1500)')

  // optional: IMPORT_PROJECT=<store/project> — the mounted chat exists only in the project; rebuild it from the new-chat page
  if (process.env.IMPORT_PROJECT) {
    await send('Emulation.setDeviceMetricsOverride', { width: 900, height: 600, deviceScaleFactor: 1, mobile: false })
    await navigate(`#/?project=${encodeURIComponent(process.env.IMPORT_PROJECT)}`)
    await click('button', 'Find conversations saved in this project')
    // discovery pages branches and reads each verified manifest through the CLI
    await until(() => evaluate(`[...document.querySelectorAll('section[aria-label="Saved conversations"] li')].some(e => e.textContent.includes(${JSON.stringify(mountedChat.slice(0, 10))}))`), 'saved conversation listed', 45000)
    assert.ok(await overflow() <= 0, 'no horizontal page overflow on the new-chat page')
    await click('section[aria-label="Saved conversations"] li button', 'Import')
    await until(async () => (await hash()).includes(`/chat/${mountedChat}`), 'imported chat route')
    await has('button[aria-expanded]', 'LayerFS operations')
    report.push('900x600: new-chat page finds the project’s saved conversation, Import rebuilds and opens it')
  }

  for (const [width, height] of [[1280, 820], [900, 600]]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
    // Chat: the mounted chat's first bash step reads as its operations, open it and follow a saved-version link
    await navigate(`#/chat/${mountedChat}`)
    await click('button[aria-expanded="false"]', 'LayerFS operations')
    await has('button[aria-expanded]', 'ops ·')
    await click('button[aria-expanded="false"]', 'ops ·')
    await has('[aria-label="LayerFS operations"] [role="listitem"]', 'workspace.commit')
    const chip = await evaluate(`[...document.querySelectorAll('[aria-label="LayerFS operations"] a[href*="/history?"]')].map(a => a.textContent)`)
    assert.ok(chip.some((t) => t.includes('Created Commit')), `a created Commit link: ${chip}`)
    assert.ok(await overflow() <= 0, 'no horizontal page overflow in Chat')
    await click('[aria-label="LayerFS operations"] a[href*="/history?"]', 'Created Commit')
    await until(async () => (await hash()).includes('/history?commit='), 'History route')
    await has('.history-detail h4', 'Produced by')
    await has('.history-ops a', 'workspace.commit created it')
    assert.ok(await overflow() <= 0, 'no horizontal page overflow in History')
    if (process.env.SMOKE_SHOTS) await writeFile(join(process.env.SMOKE_SHOTS, `history-producer-${width}x${height}.png`), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'))
    report.push(`${width}x${height}: Chat step -> History version shows its producing operation`)
    // History -> Trace: the producing operation opens focused, with its inspector
    await click('.history-ops a', 'workspace.commit created it')
    await until(async () => (await hash()).includes('/trace?op='), 'Trace route')
    await has('section[aria-label="Operation workspace.commit"]', 'Store / Project')
    await click('section[aria-label="Operation workspace.commit"] [role="tab"]', 'Execution')
    await has('section[aria-label="Operation workspace.commit"] pre', 'correlation_token')
    report.push(`${width}x${height}: History producer -> Trace operation inspector (Result, Execution tabs)`)

    // Trace Operations view of the SDK chat: counts, filters and a merge's typed inputs
    await navigate(`#/chat/${sdkChat}/trace`)
    await click('[role="tab"]', 'Operations')
    await has('p', '14 operations')
    await has('p', '11 saved-version links')
    await click('label', 'With saved-version links')
    await until(() => evaluate(`document.querySelectorAll('[aria-label="LayerFS operations"] [role="listitem"]').length === 11`), 'linked filter')
    await click('label', 'With saved-version links')
    await evaluate(`(() => { const s = document.querySelector('select[aria-label="Operation"]'); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(s, 'branch.merge'); s.dispatchEvent(new Event('change', { bubbles: true })) })()`)
    await until(() => evaluate(`document.querySelectorAll('[aria-label="LayerFS operations"] [role="listitem"]').length === 1`), 'operation filter')
    await click('[aria-label="LayerFS operations"] button', 'branch.merge')
    await click('section[aria-label="Operation branch.merge"] [role="tab"]', 'Inputs')
    const inputs = await until(() => evaluate(`(() => { const s = document.querySelector('section[aria-label="Operation branch.merge"]'); const t = s?.textContent ?? ''; return (t.match(/Commit[0-9a-f]{66}/g) ?? []).length >= 2 ? t : null })()`), 'merge inputs')
    assert.ok(inputs.includes('sdk-b') && inputs.includes('sdk-c'), 'both merge sources are typed inputs')
    assert.ok(await overflow() <= 0, 'no horizontal page overflow in Trace')
    // optional visual evidence: SMOKE_SHOTS=<dir>
    if (process.env.SMOKE_SHOTS) await writeFile(join(process.env.SMOKE_SHOTS, `trace-operations-${width}x${height}.png`), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'))
    report.push(`${width}x${height}: Trace Operations view — 14 operations, 11 links, linked/method filters, merge inputs`)
    // the SDK tool failed after its writes: its row keeps every operation
    await click('[role="tab"]', 'Conversation')
    await has('span', '12 ops · 10 links')
    report.push(`${width}x${height}: failed SDK tool row keeps 12 operations and 10 links (the CLI tool holds the 11th)`)
  }
  // reload preserves the evidence; persistence is shown
  await send('Page.reload')
  await pause(800)
  await has('span', 'Saved to project')
  report.push('reload: Trace shows the journal saved to the project')
  assert.deepEqual(errors, [], `console errors: ${errors.join('\n')}`)
  report.push('console: no errors or exceptions')
  console.log(report.join('\n'))
} catch (error) {
  console.error(report.join('\n'))
  try { console.error('Page text:', await evaluateText()) } catch { /* the page is gone */ }
  throw error
} finally {
  socket?.close()
  const exited = new Promise((r) => chrome.once('exit', r))
  chrome.kill()
  await exited
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
