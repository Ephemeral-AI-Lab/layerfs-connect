// Shared chat and Storage sandbox navigation, detail tabs, refresh, and return state.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const preview = process.argv[2] ?? 'http://127.0.0.1:1025/'
const profile = await mkdtemp(join(tmpdir(), 'connect-sandbox-navigation-'))
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
  const size = (width,height) => send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false})
  const ready = selector => until(()=>evaluate(`!!document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect().width`),selector)
  const tab = async id => { await click(`[data-detail-tab="${id}"]`); await until(()=>evaluate(`document.querySelector('[data-detail-tab="${id}"]').getAttribute('aria-selected')==='true'`),id) }
  await send('Page.enable');await send('Runtime.enable')
  await send('Page.addScriptToEvaluateOnNewDocument',{source:`
    window.__sandboxReads=[];window.__detailMode='ok';
    const originalFetch=window.fetch;
    window.fetch=async(input,options={})=>{
      const u=new URL(typeof input==='string'?input:input.url,location.href);const path=decodeURIComponent(u.pathname);
      window.__sandboxReads.push({path,method:options.method??'GET'});
      if(path==='/api/agent/sessions/navigation-chat')return Response.json({id:'navigation-chat',title:'Host chat',cwd:'/example',project:'shop/api',created:0,updated:0,state:'idle',provider:null,modelId:null,error:null,messages:[],queued:[],approvals:[],children:[],contextUsage:null});
      if(path==='/api/sandboxes/api-dev'){
        if(window.__detailMode==='pending') await new Promise(resolve=>{window.__releaseDetail=()=>{window.__detailMode='ok';resolve()}});
        if(window.__detailMode==='error')return new Response(JSON.stringify({code:'Unavailable',message:'Sandbox detail unavailable'}),{status:503});
        const response=await originalFetch(input,options);const value=await response.json();
        if(window.__detailMode==='wrong-project')value.project='shop/web';
        if(window.__detailMode==='refused'){value.workspaces=[];value.refusal={code:'Busy',message:'Sandbox workspace read is busy'};}
        return Response.json(value,{status:response.status});
      }
      return originalFetch(input,options);
    }`})
  for(const [width,height] of [[1280,820],[900,600]]){
    await size(width,height)
    await send('Page.navigate',{url:`${preview}?mac=1#/storage/shop/api/sandboxes`})
    await ready('[data-flow-node="sandbox-api-dev"]')
    assert.equal(await evaluate('document.querySelectorAll(".sandbox-detail").length'),0,'map is the entry point')
    assert.equal(await evaluate('document.querySelectorAll(".sb-scrubber,.sb-scenario").length'),0,'host data has no playback')
    await click('[data-flow-node="workspace-api-dev:feature-login"]')
    await evaluate('document.querySelector(".sandbox-page").scrollTop=90')
    const before=await evaluate('document.querySelector(".sandbox-page").scrollTop')
    await click('[data-flow-node="sandbox-api-dev"]')
    await ready('.sandbox-detail')
    assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('.sd-tabs button')).map(b=>b.dataset.detailTab)`),['overview','workspaces'])
    assert.match(await text('.sd-header'),/api-dev.*shop\/api/s)
    assert.equal(await evaluate('!!document.querySelector(".sandbox-detail .sd-simulation")'),false,'host observation is not example playback')
    await tab('workspaces');await click('.sd-workspace-row')
    assert.match(await text('.sd-workspace-inspect'),/api-dev:feature-login.*\/workspaces\/feature-login/s)
    assert.equal(await text('.sd-subtabs'),'Details')
    assert.equal(await evaluate('document.querySelectorAll(".sd-file-browser,.sd-change-view").length'),0)
    await tab('overview');assert.match(await text('.sd-panel'),/nfs/);assert.doesNotMatch(await text('.sd-panel'),/ControlReady|in playback|route=fuse/)
    const reads=await evaluate('window.__sandboxReads.filter(r=>r.path==="/api/sandboxes/api-dev").length')
    await click('.sd-header-actions button');await until(()=>evaluate(`window.__sandboxReads.filter(r=>r.path==='/api/sandboxes/api-dev').length>${reads}`),'Refresh reads selected sandbox')
    await click('.sd-breadcrumb button');await ready('[data-flow-node="sandbox-api-dev"]')
    await until(()=>evaluate(`Math.abs(document.querySelector('.sandbox-page').scrollTop-${before})<=1`),'back restores map scroll')
    assert.equal(await evaluate(`document.querySelector('[data-flow-node="sandbox-api-dev"]').getAttribute('aria-pressed')`),'true','back preserves sandbox selection')
    await click('[data-flow-node="sandbox-api-dev"]');await ready('.sandbox-detail')
    assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),'detail stays within window')
    const shot=await send('Page.captureScreenshot',{format:'png'});await writeFile(join(tmpdir(),`project-sandbox-detail-${width}.png`),Buffer.from(shot.data,'base64'))
    await click('.sd-breadcrumb button'); await ready('[data-flow-node="sandbox-api-dev"]')
  }
  await evaluate("window.__detailMode='pending'")
  await click('[data-flow-node="sandbox-api-dev"]');await until(()=>text('[data-project-sandbox-detail]').then(t=>t.includes('Reading sandbox')),'loading detail keeps back navigation')
  await evaluate('window.__releaseDetail()');await ready('.sandbox-detail')
  await click('.sd-breadcrumb button');await evaluate("window.__detailMode='error'")
  await click('[data-flow-node="sandbox-api-dev"]');await until(()=>text('[role="alert"]').then(t=>t.includes('Sandbox detail unavailable')),'detail errors are actionable')
  await evaluate("window.__detailMode='ok'")
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('Try again')).click()`);await ready('.sandbox-detail')
  await click('.sd-breadcrumb button');await evaluate("window.__detailMode='refused'")
  await click('[data-flow-node="sandbox-api-dev"]');await ready('.sandbox-detail')
  assert.match(await text('[data-project-sandbox-detail]'),/Sandbox workspace read is busy/)
  await tab('workspaces');assert.match(await text('.sd-panel'),/Workspace status unavailable|Workspace state unavailable/)
  assert.match(await text('.sd-tabs'),/Workspaces\?/)
  await click('.sd-breadcrumb button');await evaluate("window.__detailMode='wrong-project'")
  await click('[data-flow-node="sandbox-api-dev"]');await until(()=>text('[role="alert"]').then(t=>t.includes('does not belong to shop/api')),'project identity checked')
  await evaluate("window.__detailMode='ok';location.hash='#/chat/navigation-chat/sandboxes'")
  await ready('[data-flow-node="sandbox-api-dev"]');await click('[data-flow-node="sandbox-api-dev"]');await ready('.sandbox-detail')
  assert.equal(await evaluate('document.querySelectorAll(".sd-tabs button").length'),2,'regular chat uses identical detail navigation')
  // Exercise the host-backed standalone adapter using this preview's deterministic records.
  assert.deepEqual(await evaluate('window.__sandboxReads.filter(r=>r.method!=="GET")'),[],'navigation makes no mutations')
  assert.deepEqual(errors,[],'clean browser console')
  console.log('PASS unified sandbox navigation: Storage, regular chat share map/detail/back, both detail tabs, real paths, refresh, return selection/scroll, loading/error/retry, refused reads, project identity, 1280x820 and 900x600, no mutations, console.')
} finally {
  socket?.close()
  chrome.kill('SIGTERM')
  await pause(300)
  await rm(profile, {recursive:true,force:true,maxRetries:5,retryDelay:200})
}
