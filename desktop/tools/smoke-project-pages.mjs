// Storage project navigation and shared feature integration. Uses only the web preview.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const preview = process.argv[2] ?? 'http://127.0.0.1:1025/'
const profile = await mkdtemp(join(tmpdir(), 'connect-projects-'))
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
  const size = (width, height) => send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
  const ready = (selector) => until(() => evaluate(`!!document.querySelector(${JSON.stringify(selector)})`), selector)
  const go = async hash => { await evaluate(`location.hash=${JSON.stringify(hash)}`) }
  const tab = async name => {
    await evaluate(`Array.from(document.querySelectorAll('nav[aria-label="Project"] button')).find(b=>b.textContent===${JSON.stringify(name)}).click()`)
    await until(() => evaluate(`document.querySelector('nav[aria-label="Project"] [aria-current="page"]')?.textContent===${JSON.stringify(name)}`), name)
  }
  await send('Page.enable'); await send('Runtime.enable')
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.__projectCalls=[];
    const originalFetch=window.fetch;
    window.fetch=async(input,options={})=>{
      const path=decodeURIComponent(new URL(typeof input==='string'?input:input.url,location.href).pathname);
      window.__projectCalls.push({path,method:options.method??'GET'});
      if(path==='/api/projects/shop/api' && window.__projectGate) await new Promise(resolve=>{window.__releaseProject=()=>{window.__projectGate=false;resolve()}});
      if(path==='/api/projects/shop/api' && window.__projectError) return new Response(JSON.stringify({code:'Unavailable',message:'Project read unavailable'}),{status:503});
      if(path==='/api/projects/shop/web/history' && window.__emptyHistory) return Response.json({branches:[],next:null});
      if(path==='/api/projects/shop/web/sandboxes' && window.__emptySandboxes) return Response.json([]);
      return originalFetch(input,options);
    }` })
  await size(1280,820)
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  await send('Page.navigate',{url:`${preview}?mac=1#/storage`})
  await ready('[role="button"][aria-label="Open shop/api"]')
  await click('[role="button"][aria-label="Open shop/api"]')
  await ready('nav[aria-label="Project"]')
  assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('nav[aria-label="Project"] button')).map(b=>b.textContent)`),['Files','History','Sandboxes','Storage'])
  await ready('[role="tree"]')
  await click('[role="treeitem"] button')
  await until(() => evaluate(`document.querySelectorAll('[role="treeitem"]').length>4`),'folder expands')
  await evaluate(`Array.from(document.querySelectorAll('[role="treeitem"] button')).find(b=>b.textContent.endsWith('package.json')).click()`)
  await until(() => text('[aria-label="Open files"]').then(t=>t.includes('package.json')),'open package.json')
  await click('[aria-label="Branch"]')
  await ready('[role="option"]')
  await evaluate(`Array.from(document.querySelectorAll('[role="option"]')).find(b=>b.textContent.includes('feature-login')).click()`)
  await until(() => text('[aria-label="Branch"]').then(t=>t.includes('feature-login')),'branch change')
  await tab('History'); await ready('[data-history-node]')
  await evaluate(`Array.from(document.querySelectorAll('[data-history-node]')).find(b=>b.textContent.includes('checkpoints')).dispatchEvent(new MouseEvent('click',{bubbles:true}))`)
  await until(() => text('.history-detail').then(t=>t.includes('Expand 2 checkpoints')),'checkpoint group')
  await click('.history-primary')
  await until(() => text('.history-detail').then(t=>t.includes('Changed paths')),'expanded checkpoint')
  assert.equal(await evaluate('!!document.querySelector(".history-trace-link")'),false,'project history needs no chat')
  assert.deepEqual(await evaluate('window.__projectCalls.filter(c=>c.path.includes("/trace"))'),[],'project history never fetches traces')
  await tab('Sandboxes'); await ready('[data-flow-node="workspace-api-dev:feature-login"]')
  assert.equal(await evaluate('document.querySelectorAll(".sb-scenario, .sb-scrubber").length'),0,'real resources have no simulation controls')
  assert.equal(await evaluate('document.querySelectorAll(".sb-agent").length'),0,'no fabricated agents')
  await click('[data-flow-node="workspace-api-dev:feature-login"]')
  assert.match(await text('.sb-detail'),/\/workspaces\/feature-login/)
  await click('[data-flow-node="sandbox-api-dev"]')
  await ready('.sandbox-detail')
  assert.equal(await evaluate('document.querySelectorAll(".sd-tabs [role=tab]").length'),5,'same sandbox detail navigation as chat')
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Browse files').click()`)
  await ready('[aria-label="Branch"]')
  await until(() => text('[aria-label="Branch"]').then(t=>t.includes('feature-login')),'workspace branch opens in Files')
  for(const [width,height] of [[1280,820],[900,600]]) {
    await size(width,height)
    for(const name of ['Files','History','Sandboxes','Storage']) {
      await tab(name)
      await ready(name==='Files'?'[role="tree"]':name==='History'?'[data-history-node]':name==='Sandboxes'?'.sb-flow':'.store-hero-number')
      assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),`${name} page fits ${width}`)
      if(name==='Storage') {
        assert.match(await text('.vt-page'),/Shared Store on disk/)
        assert.match(await text('.vt-page'),/entire shared Store/)
        assert.ok(await evaluate(`Array.from(document.querySelectorAll('.sc-fade')).every(n=>getComputedStyle(n).opacity==='1')`),'reduced-motion chart stages are visible immediately')
      }
      const shot=await send('Page.captureScreenshot',{format:'png'})
      await writeFile(join(tmpdir(),`project-${name.toLowerCase()}-${width}.png`),Buffer.from(shot.data,'base64'))
    }
  }
  await go('#/storage/shop/web'); await until(() => evaluate('location.hash.endsWith("/web/files")'),'default project route')
  await evaluate('window.__emptyHistory=true;window.__emptySandboxes=true')
  await tab('History'); await until(() => text('.history-view').then(t=>t.includes('No history yet')),'empty history')
  await tab('Sandboxes'); await until(() => text('.sb-no-resources').then(t=>t.includes('No sandbox activity yet')),'empty sandboxes')
  await go('#/storage/shop/web/unknown'); await until(() => text('.vt-page').then(t=>t.includes('This project page does not exist')),'unknown tab')
  await evaluate('window.__projectGate=true')
  await go('#/storage/shop/api/files')
  await until(() => text('.vt-page').then(t=>t.includes('Reading project')),'project loading')
  await evaluate('window.__releaseProject()'); await ready('[role="tree"]')
  await go('#/storage/shop/web/files'); await until(() => evaluate(`document.querySelector('nav[aria-label="Project breadcrumbs"] h1')?.textContent==='web'`),'switch project')
  await evaluate('window.__projectError=true'); await go('#/storage/shop/api/files')
  await until(() => text('[role="alert"]').then(t=>t.includes('Project read unavailable')),'project error')
  await evaluate('window.__projectError=false')
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('Try again')).click()`)
  await ready('[role="tree"]')
  await go('#/storage/shop/api/storage')
  await ready('.store-hero-number')
  await click('nav[aria-label="Project breadcrumbs"] a:nth-of-type(2)')
  await until(() => evaluate('location.hash==="#/storage/shop"'),'Store breadcrumb')
  assert.deepEqual(await evaluate('window.__projectCalls.filter(c=>c.method!=="GET")'),[],'navigation never mutates resources')
  assert.deepEqual(errors,[],'browser runtime and console errors')
  console.log('PASS project pages: Storage entry, four tabs, files/folders/branches, History expansion without chat, real sandbox map, workspace-to-Files, shared Store charts, default/unknown routes, loading/error/retry, empty states, 1280x820 and 900x600, breadcrumbs, no mutations, clean console.')
} finally {
  socket?.close()
  chrome.kill('SIGTERM')
  await pause(300)
  await rm(profile, {recursive:true,force:true,maxRetries:5,retryDelay:200})
}
