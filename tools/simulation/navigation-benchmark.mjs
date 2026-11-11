// Measure the actual renderer while its host runs real simulations.
import { readFile, writeFile } from 'node:fs/promises'
const flag = name => process.argv[process.argv.indexOf(name) + 1]
const targetId = flag('--target'), endpoint = JSON.parse(await readFile(flag('--host-receipt'), 'utf8'))
const target = (await (await fetch('http://127.0.0.1:18800/json/list')).json()).find(item => item.id === targetId)
if (!target || !/^http:\/\/127\.0\.0\.1:1025\//.test(target.url)) throw new Error('Select an owned Connect preview tab.')
const socket = new WebSocket(target.webSocketDebuggerUrl), pending = new Map(), requests = new Map()
let next = 0
const errors = [], reads = []
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
socket.onmessage = ({ data }) => {
  const message = JSON.parse(data), reply = pending.get(message.id)
  if (reply) { pending.delete(message.id); message.error ? reply.reject(new Error(message.error.message)) : reply.resolve(message.result) }
  const p = message.params
  if (message.method === 'Runtime.exceptionThrown') errors.push(p.exceptionDetails.text)
  if (message.method === 'Network.requestWillBeSent' && p.request.url.startsWith(endpoint.url + '/api/')) requests.set(p.requestId, { path: new URL(p.request.url).pathname, started: p.timestamp })
  if (message.method === 'Network.loadingFinished' && requests.has(p.requestId)) { const r = requests.get(p.requestId); reads.push({ path: r.path, ms: Math.round((p.timestamp - r.started) * 1000), bytes: p.encodedDataLength }); requests.delete(p.requestId) }
}
const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++next; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })) })
const evaluate = async expression => { const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text); return r.result.value }
const report = { at: new Date().toISOString(), host: endpoint.url, target: targetId, pages: [], reads, errors }
try {
  await call('Runtime.enable'); await call('Page.enable'); await call('Network.enable')
  const source = `(() => {const observer = new MutationObserver(() => {const meta = document.querySelector('meta[name="lfs-host"]');if(meta){const old=JSON.parse(meta.content);meta.content=JSON.stringify({...old,url:${JSON.stringify(endpoint.url)},token:${JSON.stringify(endpoint.token)}});observer.disconnect()}});observer.observe(document,{childList:true,subtree:true});window.__navigationLongTasks=[];new PerformanceObserver(list=>window.__navigationLongTasks.push(...list.getEntries().map(e=>({at:e.startTime,ms:e.duration})))).observe({type:'longtask',buffered:true})})()`
  const registration = await call('Page.addScriptToEvaluateOnNewDocument', { source })
  await call('Page.reload')
  for (let attempt = 0; attempt < 100; attempt++) { if (await evaluate(`document.querySelector('main') && JSON.parse(document.querySelector('meta[name="lfs-host"]').content).url===${JSON.stringify(endpoint.url)}`)) break; await new Promise(resolve => setTimeout(resolve, 100)) }
  await call('Page.removeScriptToEvaluateOnNewDocument', { identifier: registration.identifier })
  await call('Emulation.setFocusEmulationEnabled', { enabled: true })
  await call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 820, deviceScaleFactor: 1, mobile: false })
  for (const path of ['/machines', '/storage', '/activity', '/presets', '/settings/models', '/machines', '/storage', '/activity']) {
    const sample = await evaluate(`(async()=>{const start=performance.now();const link=[...document.querySelectorAll('a')].find(a=>a.getAttribute('href')===${JSON.stringify('#' + path)});if(link)link.click();else location.hash=${JSON.stringify('#' + path)};await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const frame=performance.now()-start;const gaps=[];let previous=performance.now();for(let i=0;i<45;i++){await new Promise(requestAnimationFrame);const now=performance.now();gaps.push(now-previous);previous=now}return{path:${JSON.stringify(path)},navigationFrameMs:Math.round(frame),frameGaps:gaps.map(Math.round),heading:document.querySelector('main h1')?.textContent,domNodes:document.querySelectorAll('*').length,loading:[...document.querySelectorAll('[role="status"]')].map(e=>e.textContent)}})()`)
    report.pages.push(sample)
    process.stdout.write(`${path}: ${sample.navigationFrameMs}ms first frame, worst ${Math.max(...sample.frameGaps)}ms\n`)
  }
  report.longTasks = await evaluate('window.__navigationLongTasks')
  await writeFile(flag('--output'), JSON.stringify(report, null, 2) + '\n')
} finally { await call('Emulation.setFocusEmulationEnabled', { enabled: false }).catch(() => {}); await call('Emulation.clearDeviceMetricsOverride').catch(() => {}); socket.close() }
