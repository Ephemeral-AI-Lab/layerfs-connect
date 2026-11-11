// Interaction proof that a completed /simulation run's conversations record every compiled
// CLI call as a `cli` operation of its bash tool, matching the run's own journal and
// verification, in the real preview: the journal cross-check, then Chat step -> saved-version
// link -> History producer -> Trace inspector, the Operations view's badge and paging, at
// 1280x820 and 900x600, with console errors and horizontal overflow checked.
//   node desktop/tools/smoke-simulation-operations.mjs <run id> [preview url]
// The run must be completed in the preview home (docs/specs/chat-session-store-record.md).
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const [runId, preview = 'http://127.0.0.1:1025/'] = process.argv.slice(2)
if (!runId) throw new Error('usage: smoke-simulation-operations.mjs <run id> [preview url]')
const ELIGIBLE = new Set(['file.write', 'file.apply', 'workspace.commit', 'branch.fork', 'branch.merge', 'branch.publish'])
const html = await (await fetch(preview)).text()
const meta = JSON.parse(html.match(/name="lfs-host" content="([^"]+)"/)[1].replaceAll('&quot;', '"').replaceAll('&lt;', '<').replaceAll('&amp;', '&'))
const api = async (path) => (await fetch(meta.url + path, { headers: { authorization: `Bearer ${meta.token}` } })).json()
const report = []

// 1. the run's confirmed receipts against each conversation's recorded operations
const run = await api(`/api/simulations/${runId}`)
assert.equal(run.state, 'completed', 'the run completed')
const rows = (await readFile(join(run.directory, 'journal.jsonl'), 'utf8')).trim().split('\n').map((l) => JSON.parse(l))
const started = new Map(rows.filter((r) => r.type === 'step.started').map((r) => [r.step, r]))
const done = rows.filter((r) => r.type === 'step.completed' && !/^(setup|verification)\./.test(r.step))
let commits = 0, publications = 0
const chats = Object.values(run.sessions.conversations).map((c) => c.id)
for (const id of chats) {
  const expected = done.filter((r) => run.sessions.conversations[started.get(r.step).conversationId].id === id)
  let items = [], before = null
  do { const p = await api(`/api/agent/sessions/${id}/operations?limit=1000${before != null ? `&before=${before}` : ''}`); items = [...p.items, ...items]; before = p.from } while (before > 0)
  assert.equal(items.length, expected.length, `${id}: one operation per compiled CLI call`)
  assert.ok(items.every((o) => o.origin === 'cli' && o.cause === 'tool' && o.tool_call_id && o.status === 'succeeded' && !o.unresolved), `${id}: cli operations of their bash tools, all resolved`)
  assert.ok(items.every((o) => ELIGIBLE.has(o.method) || !o.checkpoints.length), `${id}: only eligible calls carry links`)
  const linked = new Set(items.flatMap((o) => o.checkpoints.map((l) => `${o.method}:${l.ref.commit_id}`)))
  for (const r of expected) {
    const s = started.get(r.step), m = `${s.argv[0]}.${s.argv[1]}`
    const version = m === 'branch.publish' ? r.result.published_layer?.id : r.result.head
    if (ELIGIBLE.has(m) && version) assert.ok(linked.has(`${m}:${version}`), `${id}: ${r.step} links its receipt's version`)
  }
  commits += items.filter((o) => o.checkpoints.some((l) => l.effect === 'created')).length
  publications += items.filter((o) => o.method === 'branch.publish' && o.checkpoints[0]?.effect === 'published').length
}
assert.equal(commits, run.verification.commits, 'recorded Commits match the run verification')
assert.equal(publications, run.verification.publications, 'recorded publications match the run verification')
report.push(`journal: ${chats.length} conversations, ${done.length} CLI calls recorded; ${commits} Commits and ${publications} publications match the run's verification`)

// 2. the browser
const chat = chats[0]
const profile = await mkdtemp(join(tmpdir(), 'connect-simulation-ops-'))
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' })
const pause = (ms) => new Promise((r) => setTimeout(r, ms))
async function until(read, label, ms = 30000) {
  const deadline = Date.now() + ms
  do { const v = await read(); if (v) return v; await pause(100) } while (Date.now() < deadline)
  throw new Error(`Timed out: ${label}`)
}
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
  // clicks the last visible element matching `selector` whose text includes `text`, with real mouse events
  const click = async (selector, text = '') => {
    const texts = [text].flat()
    const point = await until(() => evaluate(`(() => { const n = [...document.querySelectorAll(${JSON.stringify(selector)})].filter(e => e.getClientRects().length && ${JSON.stringify(texts)}.every(t => e.textContent.includes(t))).at(-1); if (!n) return null; n.scrollIntoView({block:'center'}); const r = n.getBoundingClientRect(); return r.width && r.height ? {x:r.x+r.width/2,y:r.y+r.height/2} : null })()`), `${selector} ${text}`)
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point })
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point })
  }
  const has = (selector, text = '', ms) => until(() => evaluate(`[...document.querySelectorAll(${JSON.stringify(selector)})].some(e => e.getClientRects().length && e.textContent.includes(${JSON.stringify(text)}))`), `${selector} ${text}`, ms)
  const overflow = () => evaluate('document.documentElement.scrollWidth - window.innerWidth')
  const hash = () => evaluate('location.hash')
  await send('Page.enable'); await send('Runtime.enable')
  for (const [width, height] of [[1280, 820], [900, 600]]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
    await send('Page.navigate', { url: `${preview}?mac=1#/chat/${chat}` }); await pause(500)
    await send('Page.reload'); await pause(800)
    // a completed turn's work block, its newest write step, its link chip
    await has('button[aria-expanded]', 'LayerFS operations')
    if (!(await evaluate(`[...document.querySelectorAll('button[aria-expanded="true"]')].some(e => e.textContent.includes('LayerFS operations'))`))) await click('button[aria-expanded="false"]', 'LayerFS operations')
    await click('button[aria-expanded="false"]', ['write', '1 op · 1 link'])
    await has('[aria-label="LayerFS operations"] [role="listitem"]', '')
    assert.ok(await overflow() <= 0, 'no horizontal overflow in Chat')
    await click('[aria-label="LayerFS operations"] a[href*="/history?"]', 'Commit')
    await until(async () => (await hash()).includes('/history?commit='), 'History at the exact version')
    await has('aside.history-detail', 'Produced by', 45000)
    assert.match(await evaluate(`document.querySelector('aside.history-detail').innerText`), /Produced by\s+\S+ (created|published) it/)
    assert.ok(await overflow() <= 0, 'no horizontal overflow in History')
    report.push(`${width}x${height}: Chat step (1 op · 1 link) -> History shows the producing operation`)
    await click('.history-ops a', '')
    await until(async () => (await hash()).includes('/trace?op='), 'Trace at the operation')
    await has('section[aria-label^="Operation "] header', '· cli · tool')
    for (const tab of ['Result', 'Inputs', 'Arguments', 'Receipt', 'Execution']) { await click('section[aria-label^="Operation "] button', tab); await pause(150) }
    await has('span', 'Recorded locally (simulation run)')
    assert.equal(await evaluate(`[...document.querySelectorAll('[role="note"]')].some(n => n.textContent.includes('Coverage'))`), false, 'no coverage gap')
    report.push(`${width}x${height}: History producer -> Trace inspector (cli · tool; all tabs); badge Recorded locally (simulation run)`)
    // Operations view: paging back keeps one contiguous range
    await send('Page.navigate', { url: `${preview}?mac=1#/chat/${chat}/trace` }); await pause(500)
    await click('[role="tab"]', 'Operations')
    await click('button', 'Load earlier (')
    // rows of the Operations view itself (a focused tool row elsewhere has its own list)
    const rows = `[...(document.querySelector('select[aria-label="Agent"]').closest('.flex-col')?.querySelectorAll('[aria-label="LayerFS operations"] [role="listitem"][data-operation]') ?? [])].map(e => e.dataset.operation)`
    await until(async () => (await evaluate(rows)).length > 100, 'the paged-back range')
    const ids = await evaluate(rows)
    assert.ok(ids.length > 100 && new Set(ids).size === ids.length, `Load earlier extends the rows without repeats (${ids.length} rows, ${new Set(ids).size} distinct)`)
    assert.ok(await overflow() <= 0, 'no horizontal overflow in Operations')
    report.push(`${width}x${height}: Operations view — Load earlier shows ${ids.length} distinct rows`)
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
