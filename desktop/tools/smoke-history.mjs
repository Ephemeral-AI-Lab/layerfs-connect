// Interaction proof for the shared Git-style History graph. No model or LayerFS writes.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const preview = process.argv[2] ?? 'http://127.0.0.1:1025/'
const profile = await mkdtemp(join(tmpdir(), 'connect-history-'))
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
  const navigate = async hash => { await send('Page.navigate', { url: `${preview}?mac=1${hash}` }); try { await until(() => evaluate('!!document.querySelector(".history-view, .history-empty")'), hash) } catch(e) { console.error('Page diagnostics:', await evaluate('document.body.innerText.slice(0,3000)'), errors); throw e } }
  await send('Page.enable'); await send('Runtime.enable')
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    const fetchOriginal=window.fetch;
    const child={id:'writer:0',runId:'writer',agent:'writer',state:'completed',conversation:true,task:'Write notes',turns:1,toolCount:1};
    const chat={id:'history-paged',title:'Paged history fixture',cwd:'/example',project:'fixture/app',created:0,updated:1,state:'idle',provider:'scenario',modelId:null,error:null,messages:[],queued:[],approvals:[],children:[child],contextUsage:null};
    const main={name:'main',head:'layer',base:'layer',forkedFrom:null};
    const branch={name:'work',head:'old-commit',base:'layer',forkedFrom:'layer'};
    const childBranch={name:'child-work',head:'child-commit',base:'layer',forkedFrom:'layer'};
    const commit={id:'old-commit',branch:'work',message:'Old checkpoint',at:1,parent:null};
    const childCommit={id:'child-commit',branch:'child-work',message:'Child checkpoint',at:2,parent:null};
    const write=id=>({kind:'file',method:'file.write',status:'ok',outcome:'written',commit:id,branch:id==='old-commit'?'work':'child-work',path:'/notes',checkpoint:id==='old-commit'?17:999});
    const rows=Array.from({length:680},(_,i)=>({id:'row-'+i,callId:'call-'+i,kind:'tool',tool:'bash',turn:1,step:i,title:'Step '+i,text:'echo sample',status:'ok',start:i,ms:1,...(i===30?{callId:'old-call',writes:[write('old-commit')],checkpoints:[17]}:{})}));
    const childRows=[{id:'child-row',callId:'child-call',kind:'tool',tool:'bash',turn:1,step:1,title:'Write child notes',text:'write notes',status:'ok',start:1,ms:1,writes:[write('child-commit')],checkpoints:[999]}];
    window.fetch=(input,options={})=>{
      const u=new URL(typeof input==='string'?input:input.url,location.href); const path=decodeURIComponent(u.pathname); const q=u.searchParams; let value;
      if(path==='/api/agent/sessions/history-paged')value=chat;
      else if(path==='/api/agent/sessions/history-unlinked')value={...chat,id:'history-unlinked',project:null};
      else if(path==='/api/agent/sessions/history-empty')value={...chat,id:'history-empty',project:'empty/app'};
      else if(path==='/api/agent/sessions/history-error')value={...chat,id:'history-error',project:'failure/app'};
      else if(path==='/api/agent/sessions/history-paged/trace'||path==='/api/agent/sessions/history-paged/children/writer:0/trace'){
        const list=path.includes('/children/')?childRows:rows; const before=Number(q.get('before')??list.length);const from=Math.max(0,before-Number(q.get('limit')??300));value={agent:'main',kind:'replay',total:list.length,from,records:list.slice(from,before),agents:[],checkpoints:list===rows?1:1};
      } else if(path==='/api/projects/fixture/app/history'){
        if(!q.has('branch'))value={branches:[main,branch,childBranch],next:null};
        else if(q.has('commit')){const item=q.get('commit')==='old-commit'?commit:childCommit;value={item,changes:[],nextChanges:null};}
        else {const item=q.get('branch')==='work'?commit:childCommit;value={items:[item],head:item.id,next:null};}
      } else if(path==='/api/projects/empty/app/history')value={branches:[],next:null};
      else if(path==='/api/projects/failure/app/history')return Promise.resolve(new Response(JSON.stringify({message:'History fixture unavailable'}),{status:503}));
      if(value!==undefined)return Promise.resolve(new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}}));
      return fetchOriginal(input,options);
    };
  ` })
  await size(1280,820)
  await navigate('#/chat/history-paged/history?branch=work&commit=old-commit')
  await until(()=>evaluate('!!document.querySelector(".history-trace-link")'), 'old source found across trace pages')
  await click('.history-trace-link')
  await until(()=>evaluate(`!!document.querySelector('[data-checkpoint="17"]')`),'Trace automatically pages to old write')
  assert.match(await text('[data-checkpoint="17"]'),/#17/)
  await navigate('#/chat/history-paged/history?branch=child-work&commit=child-commit')
  await until(()=>evaluate('document.querySelector(".history-trace-link")?.getAttribute("href").includes("writer%3A0/trace")'),'child producing agent resolved')
  await click('.history-trace-link')
  await until(()=>evaluate(`location.hash.includes('writer%3A0/trace') && !!document.querySelector('[data-checkpoint="999"]')`),'correct child Trace opens')
  await navigate('#/chat/history-empty/history')
  await until(()=>evaluate('document.querySelector(".history-empty")?.textContent.includes("No history yet")'),'empty project history')
  await navigate('#/chat/history-error/history')
  await until(()=>evaluate('document.querySelector(".history-error")?.textContent.includes("History fixture unavailable")'),'history error surfaced')
  await send('Page.navigate',{url:`${preview}#/chat/history-unlinked/history`})
  await until(()=>evaluate('document.querySelector("main")?.textContent.includes("No LayerFS project linked")'),'unlinked history state')
  assert.deepEqual(errors, [], 'browser console and runtime errors')
  console.log('PASS History: paging/provenance fixtures, parent and child Trace links, empty/error/unlinked states, browser console.')
} finally {
  socket?.close()
  chrome.kill('SIGTERM')
  await pause(300)
  await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200})
}
