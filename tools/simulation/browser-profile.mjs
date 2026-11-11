// Read-only renderer measurements on an existing real preview tab. Does not
// navigate, type, start runs, change host settings or bring a window forward.
import { writeFile } from 'node:fs/promises'
const option = (name, fallback) => { const i = process.argv.indexOf(name); return i < 0 ? fallback : process.argv[i + 1] }
const targetId = option('--target', '8759D72EC2A022C01261AF4ACBD80DB1')
const targets = await (await fetch(`http://127.0.0.1:${option('--cdp', '18800')}/json/list`)).json()
const target = targets.find(tab => tab.id === targetId)
if (!target || !/^http:\/\/(localhost|127\.0\.0\.1):1025\//.test(target.url)) throw new Error('Select the actual preview tab.')
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject })
let sequence = 0
const pending = new Map()
ws.onmessage = e => { const m = JSON.parse(e.data), p = pending.get(m.id); if (p) { pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result) } }
const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })) })
const evaluate = async expression => { const r = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text); return r.result.value }
try {
  await call('Performance.enable')
  const metrics = async () => Object.fromEntries((await call('Performance.getMetrics')).metrics.map(m => [m.name, m.value]))
  const start = await metrics(), startedAt = Date.now()
  await evaluate(`(()=>{window.__simulationProfile?.observer.disconnect();const state={start:performance.now(),tasks:[]};state.observer=new PerformanceObserver(list=>{for(const entry of list.getEntries())if(entry.startTime>=state.start)state.tasks.push({start:entry.startTime,duration:entry.duration})});state.observer.observe({type:'longtask',buffered:true});window.__simulationProfile=state})()`)
  const duration = Math.min(30000, Math.max(1000, Number(option('--duration-ms', '15000'))))
  await new Promise(resolve => setTimeout(resolve, duration))
  const end = await metrics()
  const state = await evaluate(`(()=>{const p=window.__simulationProfile;p.observer.disconnect();return{url:location.href,visibility:document.visibilityState,domNodes:document.querySelectorAll('*').length,bashRows:[...document.querySelectorAll('button')].filter(b=>b.classList.contains('group/step')).length,longTasks:p.tasks,resourceCount:performance.getEntriesByType('resource').filter(r=>r.initiatorType==='fetch'||r.initiatorType==='xmlhttprequest').length}})()`)
  const report = { startedAt: new Date(startedAt).toISOString(), elapsedMs: Date.now() - startedAt, ...state, delta: Object.fromEntries(['ScriptDuration', 'TaskDuration', 'LayoutDuration', 'RecalcStyleDuration', 'LayoutCount', 'RecalcStyleCount'].map(name => [name, end[name] - start[name]])), heapBytes: end.JSHeapUsedSize, nodes: end.Nodes }
  const output = option('--output')
  if (output) await writeFile(output, JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report, null, 2))
} finally { await call('Performance.disable').catch(() => {}); ws.close() }
