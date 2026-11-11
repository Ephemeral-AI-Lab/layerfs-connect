// Interaction proof for saved-conversation import with an explicit binding,
// ownership takeover and its divergence refusal, and in-Sandbox operations, in
// the real preview with real fixtures (docs/specs/chat-session-store-record.md):
//   SMOKE_CLI=<layerfs> SMOKE_HOME=<preview home> node desktop/tools/smoke-session-ownership.mjs \
//     <renamed project> <conversation saved only there> <conflicted chat id> <its project>
// The conflicted chat's session branch must name another installation as owner
// with a cursor at its own saved cursor; the script later makes it diverge.
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const [renamed, importedChat, conflictChat, conflictProject, preview = 'http://127.0.0.1:1025/'] = process.argv.slice(2)
const profile = await mkdtemp(join(tmpdir(), 'connect-ownership-'))
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' })
const pause = (ms) => new Promise((r) => setTimeout(r, ms))
async function until(read, label, ms = 20000) {
  const deadline = Date.now() + ms
  do { const v = await read(); if (v) return v; await pause(100) } while (Date.now() < deadline)
  throw new Error(`Timed out: ${label}`)
}
/** Another installation's manifest on the conflicted chat's session branch (a fixture write through the CLI). */
function foreignManifest(lastSeq) {
  const branch = `connect.session.${conflictChat}`
  const env = { ...process.env, LAYERFS_HOME: process.env.SMOKE_HOME }
  const read = JSON.parse(execFileSync(process.env.SMOKE_CLI, ['file', 'read', conflictProject, branch, '/.connect/session/manifest.json'], { env, encoding: 'utf8' }))
  const manifest = JSON.parse(read.text)
  Object.assign(manifest, { owner: { instance_id: 'other-installation' }, last_seq: lastSeq })
  execFileSync(process.env.SMOKE_CLI, ['file', 'apply', conflictProject, branch, '--message', 'fixture: another installation'], { env, input: JSON.stringify([{ op: 'write', path: '/.connect/session/manifest.json', content: `${JSON.stringify(manifest, null, 2)}\n` }]) })
}
/** The host API (SMOKE_HOST = the preview's {url, token} JSON), standing in for the activity that triggers a save. */
const host = JSON.parse(await readFile(process.env.SMOKE_HOST, 'utf8'))
// a refused save answers 409, or the conflict it already recorded
const refused = (r) => r.status === 409 || r.body.state === 'conflict'
const persistence = async (action) => {
  const r = await fetch(`${host.url}/api/agent/sessions/${conflictChat}/persistence`, { method: action ? 'POST' : 'GET', headers: { authorization: `Bearer ${host.token}`, 'content-type': 'application/json' }, body: action ? JSON.stringify({ action }) : undefined })
  return { status: r.status, body: await r.json() }
}
const report = []
let socket, pageText = async () => ''
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
    // expected refusals are shown in the page; only unexpected console errors fail
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
    const point = await until(() => evaluate(`(() => { const n = [...document.querySelectorAll(${JSON.stringify(selector)})].find(e => e.textContent.includes(${JSON.stringify(text)}) && !e.disabled); if (!n) return null; n.scrollIntoView({block:'center'}); const r = n.getBoundingClientRect(); return r.width && r.height ? {x:r.x+r.width/2,y:r.y+r.height/2} : null })()`), `${selector} ${text}`)
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point })
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point })
  }
  const has = (selector, text = '', ms) => until(() => evaluate(`[...document.querySelectorAll(${JSON.stringify(selector)})].some(e => e.textContent.includes(${JSON.stringify(text)}))`), `${selector} ${text}`, ms)
  const overflow = () => evaluate('document.documentElement.scrollWidth - window.innerWidth')
  const navigate = async (h) => { await send('Page.navigate', { url: `${preview}?mac=1${h}` }); await pause(500) }
  await send('Page.enable'); await send('Runtime.enable')

  // 1. import under a renamed Store: refused without a binding, then imported through the binding form
  // (SMOKE_IMPORTED=1 when an earlier run already imported it)
  if (process.env.SMOKE_IMPORTED !== '1') {
  await send('Emulation.setDeviceMetricsOverride', { width: 900, height: 600, deviceScaleFactor: 1, mobile: false })
  await navigate(`#/?project=${encodeURIComponent(renamed)}`)
  await click('button', 'Find conversations saved in this project')
  await has('section[aria-label="Saved conversations"] li', `saved as ${conflictProject}`, 45000)
  await click('section[aria-label="Saved conversations"] li button', 'Import')
  await has('section[aria-label="Saved conversations"] form', 'This conversation was saved as')
  const origin = await evaluate(`document.querySelector('input[aria-label="Saved origin project"]').value`)
  assert.equal(origin, conflictProject, 'the binding form starts from the saved origin')
  assert.ok(await overflow() <= 0, 'no horizontal overflow with the binding form')
  report.push(`900x600: Import of a conversation saved as ${origin} under ${renamed} asks for an explicit binding`)
  await click('section[aria-label="Saved conversations"] form button[type="submit"]', 'Import with this binding')
  await until(async () => (await evaluate('location.hash')).includes(`/chat/${importedChat}`), 'imported chat opens', 45000)
  report.push('900x600: Import with this binding rebuilds the conversation and opens it')
  }

  // 2. the imported native mounted chat's in-Sandbox SDK and CLI calls, in Trace with no coverage gap
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 820, deviceScaleFactor: 1, mobile: false })
  await navigate(`#/chat/${importedChat}/trace`)
  await click('[role="tab"]', 'Operations')
  await until(() => evaluate(`!!document.querySelector('select[aria-label="Operation"]')`), 'operation filter rendered')
  await has('span', 'Saved to project', 45000)
  report.push('1280x820: the imported chat saves to its project under the binding (Saved to project)')
  await evaluate(`(() => { const s = document.querySelector('select[aria-label="Operation"]'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, 'branch.fork'); s.dispatchEvent(new Event('change', { bubbles: true })) })()`)
  await until(() => evaluate(`(() => { const rows = [...document.querySelectorAll('[aria-label="LayerFS operations"] [role="listitem"]')]; return rows.length >= 2 && rows.every(r => r.textContent.includes('branch.fork')) })()`), 'host and in-Sandbox forks')
  // the conversation's host fork and at least one in-Sandbox SDK fork: open them in turn until the inspector names an sdk tool call
  const forks = await evaluate(`document.querySelectorAll('[aria-label="LayerFS operations"] [role="listitem"]').length`)
  for (let i = forks; i >= 1; i--) {
    await click(`[aria-label="LayerFS operations"] [role="listitem"]:nth-child(${i}) button`, 'branch.fork')
    await has('section[aria-label="Operation branch.fork"] header', '· ')
    if (await evaluate(`document.querySelector('section[aria-label="Operation branch.fork"] header').textContent.includes('· sdk · tool')`)) break
  }
  await has('section[aria-label="Operation branch.fork"] header', '· sdk · tool')
  await has('section[aria-label="Operation branch.fork"]', 'Store / Project')
  assert.equal(await evaluate(`[...document.querySelectorAll('[role="note"]')].some(n => n.textContent.includes('Coverage'))`), false, 'a native Sandbox shows no coverage gap')
  report.push('1280x820: imported chat — in-Sandbox SDK branch.fork recorded as the tool’s operation (origin sdk), no coverage gap; refs keep origin names')

  // 3. another installation owns the branch at this conversation's own cursor: conflict -> Take over ownership -> saved
  const own = (await persistence()).body.saved_through
  foreignManifest(own)
  assert.ok(refused(await persistence('save')), 'a save meets the other owner and is refused')
  await navigate(`#/chat/${conflictChat}/trace`)
  await has('span', 'Ownership conflict')
  await click('button', 'Take over ownership')
  await has('span', 'Saved to project', 45000)
  report.push('1280x820: Ownership conflict -> Take over ownership -> Saved to project')

  // 4. another installation saved history this one lacks: takeover is refused with the reason, nothing combined
  foreignManifest((await persistence()).body.saved_through + 1000)
  assert.ok(refused(await persistence('save')))
  await navigate(`#/chat/${conflictChat}/trace`)
  await has('span', 'Ownership conflict', 45000)
  await click('button', 'Take over ownership')
  await has('[role="alert"]', 'holds history this conversation does not have', 45000)
  await has('span', 'Ownership conflict')
  assert.ok(await overflow() <= 0, 'no horizontal overflow with the refusal')
  report.push('1280x820: diverged branch — Take over refused with “holds history this conversation does not have”; still in conflict')

  const unexpected = errors.filter((e) => !/409|SessionDiverged|SessionOwnership/.test(e))
  assert.deepEqual(unexpected, [], `console errors: ${unexpected.join('\n')}`)
  report.push(`console: no unexpected errors (${errors.length - unexpected.length} expected 409 refusals logged)`)
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
