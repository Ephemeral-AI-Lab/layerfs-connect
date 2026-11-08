// Browser interaction proof for the local Sandbox simulation. No model or LayerFS calls.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const preview = process.argv[2] ?? 'http://127.0.0.1:1025/'
const profile = await mkdtemp(join(tmpdir(), 'connect-sandbox-'))
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' })
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(read, label) {
  const deadline = Date.now() + 12000
  do { const value = await read(); if (value) return value; await pause(50) } while (Date.now() < deadline)
  throw new Error(`Timed out: ${label}`)
}
let socket
try {
  const port = await until(async () => { try { return Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]) } catch { return null } }, 'Chrome startup')
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  socket = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
  let sequence = 0
  const pending = new Map(), errors = []
  socket.onmessage = event => {
    const result = JSON.parse(event.data)
    if (result.method === 'Runtime.exceptionThrown') errors.push(result.params.exceptionDetails.exception?.description ?? result.params.exceptionDetails.text)
    if (result.method === 'Runtime.consoleAPICalled' && result.params.type === 'error') errors.push(result.params.args.map(a => a.value ?? a.description).join(' '))
    const waiter = pending.get(result.id)
    if (!waiter) return
    pending.delete(result.id)
    result.error ? waiter.reject(new Error(result.error.message)) : waiter.resolve(result.result)
  }
  const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })) })
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
    return result.result.value
  }
  const click = async selector => {
    const point = await until(() => evaluate(`(() => { const n = document.querySelector(${JSON.stringify(selector)}); if (!n) return null; n.scrollIntoView({block:'nearest'}); const r = n.getBoundingClientRect(); return r.width && r.height ? {x:r.x+r.width/2,y:r.y+r.height/2} : null })()`), selector)
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point })
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point })
  }
  const text = selector => evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? ''`)
  const seek = async time => {
    await evaluate(`(() => { const n = document.querySelector('.sb-scrubber input'); const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(n, ${time}); n.dispatchEvent(new Event('input', {bubbles:true})); n.dispatchEvent(new Event('change', {bubbles:true})) })()`)
    await until(() => evaluate(`Math.abs(Number(document.querySelector('.sb-scrubber input').value)-${time}) < .05 && document.querySelector('.sandbox-page').dataset.playing === 'false'`), `seek ${time}`)
  }
  const scenario = async id => {
    await evaluate(`(() => { const n=document.querySelector('.sb-scenario select'); n.value=${JSON.stringify(id)}; n.dispatchEvent(new Event('change',{bubbles:true})) })()`)
    await until(() => evaluate(`document.querySelector('.sb-scenario select').value === ${JSON.stringify(id)}`), `scenario ${id}`)
  }
  const navigate = async hash => { await send('Page.navigate', { url: `${preview}${hash}` }); await until(() => evaluate('!!document.querySelector(".sandbox-page, .sandbox-empty")'), hash) }
  const size = (width, height) => send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
  await send('Page.enable'); await send('Runtime.enable')
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__sandboxCalls=[];const originalFetch=window.fetch;window.fetch=(input,options={})=>{const path=typeof input==='string'?input:input.url;window.__sandboxCalls.push({path,method:options.method??'GET'});if(path.endsWith('/api/agent/sessions/sandbox-unlinked'))return Promise.resolve(new Response(JSON.stringify({id:'sandbox-unlinked',title:'Unlinked chat',cwd:'/example',project:null,created:0,updated:0,state:'idle',provider:null,modelId:null,error:null,messages:[],queued:[],approvals:[],children:[],contextUsage:null}),{headers:{'Content-Type':'application/json'}}));return originalFetch(input,options)}` })
  await size(1280, 820)
  await navigate('#/chat/ui-example-chat/sandboxes')
  await seek(9)
  assert.match(await text('.sb-facts'), /2 main agents.*3 subagents/)
  assert.equal(await evaluate('document.querySelectorAll(".sb-agent").length'), 5)
  assert.equal(await evaluate('document.querySelectorAll(".sb-workspace").length'), 3)
  assert.equal(await evaluate('document.querySelectorAll(".sb-wire").length'), 8)
  assert.match(await text('[data-flow-node="workspace-dev:review"]'), /Executing.*npm test/)
  const stopped = await evaluate('document.querySelector(".sb-scrubber input").value')
  await pause(300)
  assert.equal(await evaluate('document.querySelector(".sb-scrubber input").value'), stopped, 'pause freezes playback')
  await click('.sb-controls button')
  await until(() => evaluate(`Number(document.querySelector('.sb-scrubber input').value)>${Number(stopped) + .1}`), 'play advances time')
  await seek(9)
  await click('[data-flow-node="workspace-dev:review"]')
  assert.match(await text('.sb-inspector'), /dev:review.*Used by Reviewer/s)
  assert.equal(await evaluate('document.querySelectorAll(".sb-agent[data-dim=true]").length'), 4, 'selection isolates actual users')
  await click('.sb-inspector header button')
  await click('.sb-group-heading button')
  assert.equal(await evaluate('document.querySelectorAll(".sb-agent").length'), 4, 'fold hides subagent')
  assert.ok(await evaluate('document.querySelectorAll(".sb-wire").length >= 7'), 'fold reroutes edges')
  await click('.sb-group-heading button')
  await click('.sb-filters input')
  assert.equal(await evaluate('document.querySelectorAll(".sb-agent").length'), 2, 'This chat filters agent groups')
  await click('.sb-filters input')
  await scenario('shared'); await seek(9)
  assert.equal(await evaluate('document.querySelectorAll(".sb-workspace").length'), 2)
  await click('[data-flow-node="workspace-dev:search"]')
  assert.match(await text('.sb-detail'), /Main agent, Reviewer/)
  await scenario('conflict'); await seek(21)
  await click('[data-flow-node="workspace-checks:tests"]')
  assert.match(await text('.sb-inspector'), /workspace.commit/)
  await click('.sb-event-list > button')
  assert.match(await text('.sb-event-detail'), /Conflict.*No commit published/s)
  await scenario('busy'); await seek(27)
  assert.match(await text('[data-flow-node="workspace-checks:tests"]'), /Busy/)
  await seek(33)
  assert.match(await text('.sb-event-list'), /sandbox.close/)
  await click('.sb-event-list > button')
  assert.match(await text('.sb-event-detail'), /MountsActive/)
  await scenario('parallel'); await seek(33)
  assert.equal(await evaluate('document.querySelectorAll(".sb-workspace").length'), 2, 'successful unmount removes workspace')
  await click('.sb-filters label:last-child input')
  assert.equal(await evaluate('document.querySelectorAll(".sb-workspace").length'), 3, 'recent resources restores historical workspace')
  assert.match(await text('[data-flow-node="workspace-checks:tests"]'), /Unmounted/)
  await scenario('empty')
  assert.match(await text('.sb-no-resources'), /No sandbox activity yet/)
  assert.ok(await evaluate('document.querySelector(".sb-controls button").disabled'))
  await scenario('parallel'); await seek(9)
  await click('.sb-controls button[aria-label="Replay simulation"]')
  await until(() => evaluate('Number(document.querySelector(".sb-scrubber input").value)<2'), 'replay resets')
  await seek(9)
  for (const [width, height] of [[1280,820], [900,600], [768,800], [414,820], [375,820], [320,820]]) {
    await size(width,height)
    // The desktop shell intentionally has a 400px main minimum plus a sidebar.
    // Constrain just the new view to verify its layout below supported window sizes.
    await evaluate(`document.querySelector('.sandbox-page').style.maxWidth=${JSON.stringify(width < 768 ? `${width}px` : 'none')}`)
    await pause(100)
    if (width >= 768) assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'), `no page overflow at ${width}`)
    assert.ok(await evaluate('document.querySelector(".sandbox-page").scrollWidth<=document.querySelector(".sandbox-page").clientWidth+1'), `no sandbox overflow at ${width}`)
    if (width===1280 || width===900) {
      const screenshot = await send('Page.captureScreenshot', { format:'png' })
      await writeFile(join(tmpdir(), `sandbox-${width}.png`), Buffer.from(screenshot.data, 'base64'))
    }
  }
  await size(1280,820)
  await navigate('#/chat/ui-example-chat/subagents/example-review%3A0/sandboxes')
  assert.match(await text('.sb-inspector'), /Reviewer/)
  await navigate('#/chat/ui-example-chat/sandboxes?aside=example-review%3A0')
  await until(() => evaluate(`!!document.querySelector('aside[aria-label="Subagent side panel"]')`), 'side panel')
  await evaluate(`document.querySelector('aside[aria-label="Subagent side panel"] nav[aria-label="Chat"]').querySelectorAll('button')[2].click()`)
  await until(() => evaluate('document.querySelectorAll(".sandbox-page").length===2'), 'shared Sandbox side panel')
  assert.ok(await evaluate(`document.querySelector('aside[aria-label="Subagent side panel"] .sandbox-page').scrollWidth<=document.querySelector('aside[aria-label="Subagent side panel"] .sandbox-page').clientWidth+1`))
  assert.deepEqual(await evaluate(`window.__sandboxCalls.filter(c=>c.method!=="GET" || c.path.includes('/api/sandboxes') || c.path.includes('/api/workspaces'))`), [], 'simulation never mutates host resources')
  await send('Emulation.setEmulatedMedia', { features: [{name:'prefers-reduced-motion',value:'reduce'}] })
  await navigate('#/chat/ui-example-chat/sandboxes')
  assert.equal(await evaluate('document.querySelector(".sandbox-page").dataset.playing'), 'false', 'reduced motion starts paused')
  await navigate('#/chat/sandbox-unlinked/sandboxes')
  assert.match(await text('.sandbox-empty'), /No LayerFS project linked/)
  assert.deepEqual(errors, [], 'browser console and runtime errors')
  console.log('PASS Sandbox: playback, replay, selection, folds, scope, shared users, conflict, unmount/close refusals, recent resources, empty/unlinked states, child and side-panel routes, reduced motion, no host mutations, responsive widths, browser console.')
} finally {
  socket?.close()
  chrome.kill('SIGTERM')
  await pause(300)
  await rm(profile, {recursive:true,force:true,maxRetries:5,retryDelay:200})
}
