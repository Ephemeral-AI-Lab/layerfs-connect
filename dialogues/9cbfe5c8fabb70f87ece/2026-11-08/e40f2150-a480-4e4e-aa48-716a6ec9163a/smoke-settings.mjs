// Exercise the packaged Electron UI and its bundled host with isolated state.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as pause } from 'node:timers/promises'

if (!process.argv[2]) throw new Error('Usage: node tools/smoke-settings.mjs <app>')
const appPath = resolve(process.argv[2])
const temp = await mkdtemp(join(tmpdir(), 'connect-settings-ui-'))
const app = spawn(join(appPath, 'Contents/MacOS/LayerFS Connect'), ['--remote-debugging-port=0'], {
  cwd: temp,
  env: { ...process.env, HOME: temp, PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LAYERFS_CONNECT_MODE: 'sim', CAPTURE_PATH: '', CAPTURE_HASH: '' },
  stdio: ['ignore', 'ignore', 'pipe'],
})
const exit = once(app, 'exit')
let socket
let logs = ''
try {
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Electron did not expose its test endpoint: ${logs}`)), 30_000)
    app.once('error', (error) => { clearTimeout(timer); reject(error) })
    app.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Electron exited ${code}: ${logs}`)) })
    app.stderr.on('data', (data) => {
      logs += data
      const match = /DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//.exec(logs)
      if (match) { clearTimeout(timer); resolve(match[1]) }
    })
  })
  let target
  for (let i = 0; i < 100; i++) {
    target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((item) => item.type === 'page')
    if (target) break
    await pause(100)
  }
  assert.ok(target, 'Electron page is available')
  socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }) })
  let id = 0
  const pending = new Map()
  socket.addEventListener('message', (event) => {
    const value = JSON.parse(event.data)
    if (!value.id) return
    const item = pending.get(value.id)
    pending.delete(value.id)
    if (value.error) item.reject(new Error(value.error.message))
    else item.resolve(value.result)
  })
  socket.addEventListener('close', () => { for (const item of pending.values()) item.reject(new Error('Electron closed')); pending.clear() })
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const next = ++id
    pending.set(next, { resolve, reject })
    socket.send(JSON.stringify({ id: next, method, params }))
  })
  const evaluate = async (expression) => {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
    return result.result.value
  }
  const waitFor = async (expression) => {
    for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await pause(100) }
    throw new Error(`Desktop condition failed: ${expression}`)
  }
  const screenshot = async (name) => {
    const result = await call('Page.captureScreenshot', { format: 'png' })
    await writeFile(join(tmpdir(), `layerfs-settings-${name}.png`), Buffer.from(result.data, 'base64'))
  }
  await waitFor(`!!document.querySelector('button[aria-label="Settings"]')`)
  await evaluate(`document.querySelector('button[aria-label="Settings"]').click()`)
  await waitFor(`!!document.querySelector('aside[aria-label="Settings sidebar"]') && !!document.querySelector('form[aria-label="Model connection"]')`)
  for (const section of ['tools', 'agents', 'hooks']) {
    await evaluate(`document.querySelector('a[href="#/settings/${section}"]').click()`)
    await waitFor(`location.hash.endsWith('/settings/${section}') && !!document.querySelector('[aria-label="Pi setup status"]')`)
    assert.match(await evaluate(`document.querySelector('[aria-label="Pi setup status"]').innerText`), /pi-subagents \d+\.\d+\.\d+ installed/)
    if (section === 'tools') {
      assert.equal(await evaluate(`document.querySelector('[role="switch"][aria-label="bash"]').disabled`), true)
      assert.equal(await evaluate(`document.querySelector('[role="switch"][aria-label="pi-subagents"]').getAttribute('aria-checked')`), 'true')
    }
    if (section === 'agents') {
      await evaluate(`{ const worker = [...document.querySelectorAll('article')].find((item) => item.querySelector('h3')?.textContent === 'Worker'); [...worker.querySelectorAll('summary')].find((item) => item.textContent === 'Prompt').click(); }`)
      assert.match(await evaluate(`document.querySelector('article pre').textContent`), /You are a focused worker in LayerFS Connect/)
    }
    if (section === 'hooks') assert.equal(await evaluate(`document.querySelector('[aria-label="LayerFS Connect hooks"] [role="switch"][aria-label="message_start"]').disabled`), true)
    await screenshot(section)
  }
  await evaluate(`document.querySelector('button[aria-label="Settings"]').click()`)
  await waitFor(`!!document.querySelector('aside[aria-label="Workspace sidebar"]')`)
  console.log('PASS: packaged Settings sidebar, Models, Tools, Agents/prompts, Hooks and required-control locks.')
  await call('Browser.close').catch(() => {})
} finally {
  socket?.close()
  if (app.exitCode === null) app.kill()
  await Promise.race([exit, pause(10_000, null, { ref: false })])
  await rm(temp, { recursive: true, force: true })
}
