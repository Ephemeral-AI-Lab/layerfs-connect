// Run against `pnpm web` or a served desktop production renderer. Owns a
// headless Chrome profile; only its synthetic chat API is intercepted.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const preview = process.argv[2] ?? 'http://127.0.0.1:1025/'
const profile = await mkdtemp(join(tmpdir(), 'connect-agent-navigation-'))
const chrome = spawn(process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu',
  '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
], { stdio: 'ignore' })
let socket
let evaluate
let send
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(read, label) {
  const deadline = Date.now() + 12_000
  do {
    const value = await read()
    if (value) return value
    await pause(40)
  } while (Date.now() < deadline)
  throw new Error(`Timed out: ${label}`)
}

try {
  const port = await until(async () => {
    try { return Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]) }
    catch { return null }
  }, 'Chrome startup')
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
  let sequence = 0
  const pending = new Map()
  socket.onmessage = event => {
    const result = JSON.parse(event.data)
    const waiter = pending.get(result.id)
    if (!waiter) return
    pending.delete(result.id)
    if (result.error) waiter.reject(new Error(result.error.message))
    else waiter.resolve(result.result)
  }
  send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence
    pending.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params }))
  })
  evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
    return result.result.value
  }
  const click = async (selector, text) => {
    const point = await until(() => evaluate(`(() => {
      const node = [...document.querySelectorAll(${JSON.stringify(selector)})].find(node => node.getClientRects().length && (${JSON.stringify(text ?? null)} === null || node.textContent.trim().startsWith(${JSON.stringify(text ?? null)})));
      if (!node) return null;
      node.scrollIntoView({block:'nearest'});
      const rect = node.getBoundingClientRect(); const x=rect.x+rect.width/2,y=rect.y+rect.height/2;
      const hit=document.elementFromPoint(x,y); if(!node.contains(hit)) return null;
      return {x,y};
    })()`), `click ${text ?? selector}`)
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point })
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point })
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point })
  }
  const type = async (selector, text) => {
    await evaluate(`(() => {const node=document.querySelector(${JSON.stringify(selector)});node.focus();node.select()})()`)
    await send('Input.insertText', { text })
  }
  const visible = selector => evaluate(`!![...document.querySelectorAll(${JSON.stringify(selector)})].find(node=>node.getClientRects().length)`)
  const hash = () => evaluate('location.hash')
  const key = async (key, code = key) => {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code })
  }

  await send('Page.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
    const now=Date.now();
    const children=[
      {id:'run:0',agent:'reviewer',state:'completed',task:'Review query handling',text:'REVIEWER_ONLY_RESULT',model:'review-model',tokens:1200},
      {id:'run:1',agent:'tester',state:'running',task:'Check empty queries',text:'TESTER_ONLY_RESULT',model:'test-model',startedAt:now,currentTool:'bash'}
    ];
    const parent={id:'navigation-test',title:'Navigation test',cwd:'/example',project:'ui-example/search',created:now,updated:now,state:'idle',provider:'fixture',modelId:'parent-model',error:null,children,queued:[],approvals:[],contextUsage:null,messages:[{id:'request',role:'user',text:'PARENT_ONLY_REQUEST'},{id:'answer',role:'assistant',text:Array.from({length:70},(_,i)=>'Parent line '+i).join('\\n\\n')}]};
    const original=window.fetch;
    window.__navigationQa={parent,requests:[]};
    window.fetch=async (input,options={})=>{
      const url=new URL(typeof input==='string'?input:input.url,location.href);
      const method=options.method??'GET'; const base='/api/agent/sessions';
      let value;
      if(url.pathname===base && method==='GET') value=[parent];
      else if(url.pathname===base+'/navigation-test') value=parent;
      else if(url.pathname===base+'/navigation-test/message') {
        window.__navigationQa.requests.push({method,path:url.pathname});
        return new Response(JSON.stringify({message:'Unexpected parent prompt'}),{status:409});
      }
      else if(url.pathname.startsWith(base+'/navigation-test/children/')) {
        const parts=url.pathname.slice((base+'/navigation-test/children/').length).split('/');
        const child=children.find(c=>c.id===decodeURIComponent(parts[0]));
        if(!child) return new Response(JSON.stringify({message:'Unknown test child'}),{status:404});
        window.__navigationQa.requests.push({method,path:url.pathname});
        if(parts[1]==='stop') {child.state='stopped';value=parent}
        else if(parts[1]==='trace') value={agent:child.agent,kind:'live',total:1,from:0,checkpoints:0,records:[{id:'tool-'+child.id,callId:'tool-'+child.id,kind:'tool',tool:'bash',turn:1,step:1,title:child.agent+' command',text:'CHILD_COMMAND_'+child.agent,output:child.text,status:'ok',start:now,ms:10}]};
        else value={child,messages:[{id:'task-'+child.id,role:'user',text:child.task},{id:'answer-'+child.id,role:'assistant',text:child.text}]};
      } else return original(input,options);
      return new Response(JSON.stringify(value),{status:200,headers:{'content-type':'application/json'}});
    };
  })()` })
  await send('Page.navigate', { url: `${preview.split('#')[0]}#/chat/navigation-test` })
  await until(() => visible('main textarea'), 'parent conversation')
  const checkTabs = async scope => assert.deepEqual(await evaluate(`[...document.querySelectorAll(${JSON.stringify(`${scope} nav[aria-label="Chat"] button`)})].filter(e=>e.getClientRects().length).map(e=>e.textContent.trim())`), ['Chat', 'Files', 'Sandboxes', 'Trace'])
  const rootTrigger = 'nav[aria-label="Agent hierarchy"] button[aria-haspopup="menu"]'
  await checkTabs('main')
  await type('main textarea', 'PARENT_DRAFT')
  await evaluate(`(() => {const e=document.querySelector('[data-agent-conversation="main"]');e.scrollTop=140;e.dispatchEvent(new Event('scroll'))})()`)
  await click(rootTrigger)
  await click('[role="menuitem"]', 'Review query handlingreviewer · completedreview-model · 1.2k tok')
  await until(async () => (await hash()).includes('/subagents/run%3A0'), 'child opens in main')
  await checkTabs('main')
  await until(() => visible('textarea[placeholder="Read-only delegated run"]'), 'shared child composer')
  assert.equal(await evaluate(`document.querySelector('textarea[placeholder="Read-only delegated run"]').value`), '')
  await type('textarea[placeholder="Read-only delegated run"]', 'CHILD_DRAFT')
  await key('Enter')
  assert.ok(!(await evaluate('window.__navigationQa.requests')).some(r=>r.path.endsWith('/message')))
  await click('main nav[aria-label="Chat"] button', 'Files')
  assert.match(await hash(), /subagents\/run%3A0\/files/)
  await until(() => evaluate(`document.querySelector('main').innerText.includes('LayerFS project files')`), 'child project files')
  await click('main nav[aria-label="Chat"] button', 'Trace')
  await until(() => evaluate(`document.querySelector('main').innerText.includes('reviewer command')`), 'child trace')
  assert.ok(!(await evaluate(`document.querySelector('main').innerText`)).includes('PARENT_ONLY_REQUEST'))
  await click('main nav[aria-label="Chat"] button', 'Chat')
  assert.equal(await evaluate(`document.querySelector('textarea[placeholder="Read-only delegated run"]').value`), 'CHILD_DRAFT')
  await click('nav[aria-label="Agent hierarchy"] button', 'Navigation test')
  await until(() => visible('textarea[placeholder="Reply…"]'), 'parent restored')
  assert.equal(await evaluate(`document.querySelector('textarea[placeholder="Reply…"]').value`), 'PARENT_DRAFT')
  assert.equal(await evaluate(`document.querySelector('[data-agent-conversation="main"]').scrollTop`), 140)
  console.log('PASS inherited tabs, child Trace, separate drafts, parent scroll restoration')

  await click(rootTrigger)
  await click('[role="menuitem"][aria-label="Open reviewer in side panel"]')
  await until(() => visible('aside[aria-label="Subagent side panel"]'), 'side panel')
  await checkTabs('aside[aria-label="Subagent side panel"]')
  await click('main > div nav[aria-label="Chat"] button', 'Files')
  assert.ok((await hash()).includes('aside=run%3A0'))
  const panel='aside[aria-label="Subagent side panel"]'
  await click(`${panel} button[aria-haspopup="menu"]`)
  await click('[role="menuitem"]', 'Check empty queriestester · runningtest-model')
  await until(() => evaluate(`document.querySelector('aside[aria-label="Subagent side panel"]').innerText.includes('TESTER_ONLY_RESULT')`), 'sibling selected in panel')
  assert.ok((await hash()).includes('/files?aside=run%3A1'))
  await click(`${panel} button`, 'Stop')
  await until(() => evaluate(`window.__navigationQa.parent.children[1].state==='stopped'`), 'child stopped')
  assert.equal(await evaluate(`window.__navigationQa.parent.state`), 'idle')
  assert.ok((await evaluate('window.__navigationQa.requests')).some(r=>r.method==='POST'&&r.path.endsWith('/run%3A1/stop')))
  await click(`${panel} button[aria-label="Open subagent in main view"]`)
  await until(async () => (await hash()).includes('/subagents/run%3A1/files'), 'promote child with current view')
  assert.ok(!(await hash()).includes('aside='))
  console.log('PASS side-panel tabs, sibling switching, scoped Stop, promotion')

  await click('nav[aria-label="Agent hierarchy"] button', 'Navigation test')
  await click(rootTrigger)
  await key('Escape')
  await until(() => evaluate('document.activeElement.getAttribute("aria-haspopup")==="menu"'), 'Escape restores trigger focus')
  await key('ArrowDown')
  await until(() => visible('[role="menuitem"]'), 'keyboard opens menu')
  await key('Enter')
  await until(async () => (await hash()).includes('/subagents/run%3A0'), 'keyboard selects child')
  await click(rootTrigger)
  await click('[role="menuitem"][aria-label="Open reviewer in side panel"]')
  await until(() => visible(panel), 'panel opens before resize')
  await send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 760, deviceScaleFactor: 1, mobile: false })
  await until(() => evaluate(`document.querySelector('aside[aria-label="Subagent side panel"]')?.getBoundingClientRect().width>600`), 'narrow desktop inspection')
  await click(`${panel} button[aria-label="Close subagent side panel"]`)
  await until(() => visible('textarea[placeholder="Reply…"]'), 'close reveals parent')
  await until(() => evaluate('document.activeElement.getAttribute("aria-haspopup")==="menu"'), 'panel close restores trigger focus')
  assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'), false)
  console.log('PASS keyboard navigation, focus restoration, narrow desktop layout')
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
  await click(rootTrigger)
  await click('[role="menuitem"][aria-label="Open reviewer in side panel"]')
  await until(() => evaluate('document.querySelector("[role=menu]")===null'), 'catalog closed for screenshot')
  await until(() => visible('aside[aria-label="Subagent side panel"] [data-agent-conversation="run:0"]'), 'child ready for screenshot')
  const screenshot=await send('Page.captureScreenshot', { format:'png' })
  const artifact=join(tmpdir(),'layerfs-agent-navigation.png')
  await writeFile(artifact,Buffer.from(screenshot.data,'base64'))
  console.log(`Screenshot: ${artifact}`)
} catch (error) {
  if (evaluate) console.error(await evaluate(`({url:location.href,text:document.querySelector('main')?.innerText.slice(0,1800)})`).catch(() => 'Browser unavailable'))
  if (send) {
    const shot=await send('Page.captureScreenshot',{format:'png'}).catch(()=>null)
    if(shot) await writeFile(join(tmpdir(),'layerfs-agent-navigation-failure.png'),Buffer.from(shot.data,'base64'))
  }
  throw error
} finally {
  socket?.close()
  chrome.kill('SIGTERM')
  await new Promise(resolve => { if(chrome.exitCode!==null) resolve(); else chrome.once('exit',resolve) })
  await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100})
}
