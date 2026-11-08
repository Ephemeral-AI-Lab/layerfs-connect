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
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__copied=[];Object.defineProperty(navigator,'clipboard',{value:{writeText:async value=>{window.__copied.push(value)}}})` })
  const detailSeek = async time => {
    await evaluate(`(() => {const n=document.querySelector('.sd-detail-playback input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(n,${time});n.dispatchEvent(new Event('input',{bubbles:true}));n.dispatchEvent(new Event('change',{bubbles:true}))})()`)
    await until(() => evaluate(`Number(document.querySelector('.sd-detail-playback input').value)===${time} && document.querySelector('.sandbox-detail').dataset.playing==='false'`), `detail seek ${time}`)
  }
  const detailTab = id => click(`.sd-tabs [data-detail-tab="${id}"]`)
  const setInput = async (selector,value) => evaluate(`(() => {const n=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(n,${JSON.stringify(value)});n.dispatchEvent(new Event('input',{bubbles:true}))})()`)
  await size(1280,820)
  await navigate('#/chat/ui-example-chat/sandboxes')
  await seek(9)
  await click('[data-flow-node="sandbox-dev"]')
  await until(() => evaluate('!!document.querySelector(".sandbox-detail")'), 'detail opens')
  assert.match(await text('.sd-header'), /dev.*Running/)
  assert.equal(await evaluate('document.querySelector(".sd-machine a").getAttribute("href")'), '#/machines/docker')
  assert.equal(await evaluate('document.querySelectorAll(".sd-tabs button").length'),2)
  assert.match(await text('.sd-panel'), /Sandbox information/)
  await click('.sd-header-actions .sd-copy')
  assert.equal(await evaluate('window.__copied.at(-1)'), 'example-dev-01')
  await detailTab('workspaces')
  assert.equal(await evaluate('document.querySelectorAll(".sd-workspace-row").length'),2)
  await click('.sd-workspace-row:last-child')
  assert.match(await text('.sd-workspace-inspect'), /dev:review.*Reviewer/s)
  assert.match(await text('.sd-workspace-inspect'), /FUSE.*Linux/s)
  assert.doesNotMatch(await text('.sd-subtabs'), /Files|Changes|Mount details/)
  await detailSeek(15)
  await detailTab('workspaces')
  await click('.sd-workspace-inspect .sd-subtabs button:nth-child(2)')
  await click('.sd-event-row')
  assert.match(await text('.sd-event-expanded'), /exit:0.*2 passed/s)
  await detailTab('overview')
  await click('.sd-header-actions button:last-child')
  assert.match(await text('.sd-footer'), /Sample refreshed at 0:15/)
  for(const [width,height] of [[1280,820],[900,600],[414,820],[375,820],[320,820]]) {
    await size(width,height)
    await evaluate(`document.querySelector('.sandbox-page').style.maxWidth=${JSON.stringify(width<768?`${width}px`:'none')}`)
    await pause(100)
    assert.ok(await evaluate('document.querySelector(".sandbox-page").scrollWidth<=document.querySelector(".sandbox-page").clientWidth+1'),`detail containment at ${width}`)
    if(width>=900){const shot=await send('Page.captureScreenshot',{format:'png'});await writeFile(join(tmpdir(),`sandbox-detail-workspaces-${width}.png`),Buffer.from(shot.data,'base64'))}
  }
  await size(1280,820)
  await evaluate('document.querySelector(".sandbox-page").style.maxWidth="none"')
  await detailTab('overview')
  const overview=await send('Page.captureScreenshot',{format:'png'});await writeFile(join(tmpdir(),'sandbox-detail-overview.png'),Buffer.from(overview.data,'base64'))
  await click('.sd-breadcrumb button')
  await until(() => evaluate('!!document.querySelector(".sb-scrubber")'), 'back restores map')
  assert.equal(await evaluate('document.querySelector(".sb-scrubber input").value'),'9','map position preserved')
  assert.equal(await evaluate('document.querySelector(".sb-box-heading[aria-pressed=true]").dataset.flowNode'),'sandbox-dev')
  assert.equal(await evaluate('document.querySelectorAll(".sb-wire").length'),8,'map wires restored')
  await scenario('busy');await seek(33)
  await click('[data-flow-node="sandbox-checks"]')
  await click('.sd-tabs [data-detail-tab="workspaces"]')
  await click('.sd-workspace-row')
  assert.match(await text('.sd-workspace-inspect'),/Busy.*workspace remains mounted and usable/s)
  await click('.sd-breadcrumb button')
  await scenario('parallel');await seek(33)
  await click('.sb-filters label:last-child input')
  await click('[data-flow-node="sandbox-checks"]')
  assert.match(await text('.sd-header'),/Closed/)
  await click('.sd-tabs [data-detail-tab="workspaces"]')
  await click('.sd-workspace-row')
  assert.match(await text('.sd-workspace-inspect'),/Overlay removed.*committed history preserved/s)
  assert.deepEqual(await evaluate(`window.__sandboxCalls.filter(c=>c.method!=='GET'||c.path.includes('/api/sandboxes')||c.path.includes('/api/workspaces'))`),[],'detail makes no LayerFS mutations')
  assert.deepEqual(errors,[],'browser runtime/console errors')
  console.log('PASS Sandbox detail: two tabs, machine link, workspace details/conditional commands, inline command inspection, refresh, responsive containment, map restoration, refused and closed lifecycle, no host mutations, console.')

} finally {
  socket?.close()
  chrome.kill('SIGTERM')
  await pause(300)
  await rm(profile, {recursive:true,force:true,maxRetries:5,retryDelay:200})
}
