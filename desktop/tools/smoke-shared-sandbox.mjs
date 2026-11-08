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
  const detailTab = id => click(`.sd-tabs [data-detail-tab="${id}"]`)
  const direct = async hash => {
    await send('Page.navigate',{url:`${preview}${hash}`})
    await until(() => evaluate(`location.hash===${JSON.stringify(hash)}`),hash)
  }
  await size(1280,820)
  await navigate('#/chat/ui-example-chat/sandboxes')
  await seek(9)
  await click('[data-flow-node="sandbox-dev"]')
  await until(() => evaluate('!!document.querySelector(".sd-open-standalone")'),'embedded detail standalone link')
  assert.match(await text('.sd-breadcrumb'),/Project activity/)
  const embeddedHeader = await text('.sd-header h1')
  await click('.sd-open-standalone')
  await until(() => evaluate('location.hash==="#/machines/docker/sandboxes/dev" && !!document.querySelector("[data-standalone-sandbox] .sandbox-detail")'),'standalone route')
  assert.equal(await text('.sd-header h1'),embeddedHeader,'shared resource identity')
  assert.match(await text('.sd-breadcrumb'),/docker/)
  assert.equal(await evaluate('document.querySelectorAll(".sd-tabs button").length'),2)
  await detailTab('workspaces')
  assert.equal(await evaluate('document.querySelectorAll(".sd-workspace-row").length'),2)
  for(const [width,height] of [[1280,820],[900,600]]) {
    await size(width,height)
    assert.ok(await evaluate('document.querySelector(".sandbox-page").scrollWidth<=document.querySelector(".sandbox-page").clientWidth+1'),`standalone containment ${width}`)
    const shot=await send('Page.captureScreenshot',{format:'png'})
    await writeFile(join(tmpdir(),`sandbox-shared-route-${width}.png`),Buffer.from(shot.data,'base64'))
  }
  await direct('#/machines/native?view=sandboxes')
  await until(() => evaluate(`!!document.querySelector('a[href="#/machines/native/sandboxes/api-dev"]')`),'machine sandbox card')
  await evaluate('document.querySelector("[data-machine-scroll]").scrollTop=100')
  // The click helper scrolls its target into view before clicking. Capture that
  // actual departure position, not the earlier arbitrary scroll offset.
  await evaluate(`document.querySelector('a[href="#/machines/native/sandboxes/api-dev"]').scrollIntoView({block:'nearest'})`)
  const savedScroll = await evaluate('document.querySelector("[data-machine-scroll]").scrollTop')
  await click('a[href="#/machines/native/sandboxes/api-dev"]')
  await until(() => evaluate('!!document.querySelector(".sandbox-detail") && document.querySelector(".sd-header h1").textContent.includes("api-dev")'),'machine record detail')
  assert.match(await text('.sd-breadcrumb'),/native/)
  assert.match(await text('.sd-header'),/shop\/api/)
  assert.match(await text('.sd-panel'),/Sandbox information/)
  assert.doesNotMatch(await text('.sd-panel'),/Reviewer/)
  await detailTab('workspaces')
  await click('.sd-workspace-row')
  assert.match(await text('.sd-workspace-inspect'),/feature-login.*\/workspaces\/feature-login/s)
  assert.match(await text('.sd-workspace-inspect'),/Not reported/)
  await detailTab('overview')
  assert.match(await text('.sd-panel'),/nfs/)
  assert.equal(await evaluate('document.querySelectorAll(".sd-tabs button").length'),2)
  await click('.sd-breadcrumb button')
  await until(() => evaluate('location.hash==="#/machines/native?view=sandboxes" && !!document.querySelector("[data-machine-scroll]")'),'machine return')
  await until(() => evaluate(`Math.abs(document.querySelector('[data-machine-scroll]').scrollTop-${savedScroll})<2`),'machine scroll restored')
  await until(() => evaluate(`document.querySelector('#machine-content-heading')?.textContent.includes('Sandboxes')`),'machine tab restored')
  await direct('#/machines/docker/sandboxes/api-dev')
  await until(() => evaluate('document.querySelector(".sandbox-page")?.textContent.includes("No simulated sandbox found")'),'wrong-machine sandbox refused')
  await direct('#/machines/native/sandboxes/missing-sandbox')
  await until(() => evaluate('document.querySelector(".sandbox-page")?.textContent.includes("No simulated sandbox found")'),'missing sandbox state')
  assert.deepEqual(await evaluate(`window.__sandboxCalls.filter(c=>c.method!=='GET')`),[],'no host mutations')
  assert.deepEqual(errors,[],'browser runtime and console errors')
  console.log('PASS shared Sandbox routes: embedded-to-standalone, two shared tabs, simulated machine-card navigation, truthful missing data, parent identity, machine tab/scroll restoration, invalid routes, desktop sizes, no host mutations, console.')

} finally {
  socket?.close()
  chrome.kill('SIGTERM')
  await pause(300)
  await rm(profile, {recursive:true,force:true,maxRetries:5,retryDelay:200})
}
