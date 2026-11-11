#!/usr/bin/env node
// Read-only restart/restore proof on the existing actual preview tab. No run
// launches, model messages, resource mutations, Chrome or host process control.
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
const option = (name, fallback) => { const i = process.argv.indexOf(name); return i < 0 ? fallback : process.argv[i + 1] }
const receipt = option('--host-receipt')
assert.ok(receipt, 'Pass the fresh private host.json with --host-receipt.')
const endpoint = JSON.parse(await readFile(receipt, 'utf8'))
assert.match(endpoint.url, /^http:\/\/(127\.0\.0\.1|localhost):\d+$/)
const chatId = option('--chat', '274967a3-183a-42c7-af0a-23d28d267d6b')
const targetId = option('--target', '8759D72EC2A022C01261AF4ACBD80DB1')
const directory = option('--output-dir', '/tmp/simulation-bash-restored-ui')
const tabs = await (await fetch(`http://127.0.0.1:${option('--cdp', '18800')}/json/list`)).json()
const target = tabs.find(tab => tab.id === targetId && tab.type === 'page')
assert.ok(target, 'Use the existing simulation-ui tab.')
assert.match(target.url, /^http:\/\/(127\.0\.0\.1|localhost):1025\//)
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject })
let sequence = 0, preload
const pending = new Map(), exceptions = [], consoleErrors = [], writes = []
ws.onmessage = event => {
  const message = JSON.parse(event.data)
  if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails.text)
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') consoleErrors.push(message.params.args.map(arg => arg.value ?? arg.description ?? arg.type).join(' '))
  if (message.method === 'Network.requestWillBeSent') {
    const { url, method } = message.params.request
    if (url.startsWith(endpoint.url + '/api/') && !['GET', 'OPTIONS'].includes(method)) writes.push({ method, path: new URL(url).pathname })
  }
  const request = pending.get(message.id)
  if (request) { pending.delete(message.id); message.error ? request.reject(new Error(message.error.message)) : request.resolve(message.result) }
}
const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })) })
const evaluate = async expression => {
  const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
  return result.result.value
}
const wait = async (expression, label, timeout = 90000) => {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) { const result = await evaluate(expression); if (result) return result; await new Promise(resolve => setTimeout(resolve, 350)) }
  throw new Error(`Timed out waiting for ${label}`)
}
const api = path => evaluate(`(async()=>{const m=JSON.parse(document.querySelector('meta[name="lfs-host"]').content);const r=await fetch(m.url+${JSON.stringify(path)},{headers:{authorization:'Bearer '+m.token}});if(!r.ok)throw new Error('Read failed '+r.status);return r.json()})()`)
const screenshot = async name => { const image = await call('Page.captureScreenshot', { format: 'png' }); await writeFile(join(directory, name), Buffer.from(image.data, 'base64')) }
const report = { startedAt: new Date().toISOString(), chatId, host: endpoint.url, checks: [], exceptions, consoleErrors, writes }
function transcript(label, detail) {
  const users = detail.messages.filter(message => message.role === 'user')
  assert.ok(users.length > 0 && users.length <= 10, `${label}: 1–10 natural request turns`)
  assert.ok(users.every(message => message.text?.length > 40 && !message.text.startsWith('Complete the related simulation objectives assigned to this ')), `${label}: preserved natural requests`)
  assert.ok(detail.messages.some(message => message.role === 'assistant' && message.text?.length), `${label}: saved assistant reply`)
  const bash = detail.messages.filter(message => message.toolName === 'bash')
  assert.ok(bash.length > 0 && bash.every(message => message.status === 'done'), `${label}: saved successful Bash steps`)
  const step = bash.at(-1)
  assert.ok(step.details?.receipt && step.details.argv?.length && step.args?.command && step.args?.scriptPath, `${label}: genuine persisted command, receipt and script path`)
  return { turns: users.length, bashSteps: bash.length, step: { id: step.id, command: step.args.command, scriptPath: step.args.scriptPath, receiptKind: step.details.receipt.kind } }
}
try {
  await mkdir(directory, { recursive: true })
  await call('Page.enable'); await call('Runtime.enable'); await call('Network.enable')
  await call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 820, deviceScaleFactor: 1, mobile: false })
  const source = `(()=>{const update=()=>{const m=document.querySelector('meta[name="lfs-host"]');if(!m)return;const original=JSON.parse(m.content);if(original.url===${JSON.stringify(endpoint.url)}&&original.token===${JSON.stringify(endpoint.token)})return;m.content=JSON.stringify({...original,url:${JSON.stringify(endpoint.url)},token:${JSON.stringify(endpoint.token)}})};const observer=new MutationObserver(update);observer.observe(document,{subtree:true,childList:true,attributes:true,attributeFilter:['content']});update();window.__simulationRestoreMeta=observer})()`
  preload = (await call('Page.addScriptToEvaluateOnNewDocument', { source })).identifier
  // Force a new document: reloading immediately after a hash-only navigation
  // can race that navigation and reopen the preceding child route.
  await call('Page.navigate', { url: `http://127.0.0.1:1025/?mac=1&simulation_restore=${Date.now()}#/chat/${encodeURIComponent(chatId)}` })
  await wait(`JSON.parse(document.querySelector('meta[name="lfs-host"]')?.content??'{}').url===${JSON.stringify(endpoint.url)} && !!document.querySelector('[data-agent-conversation="main"]')?.getClientRects().length`, 'restored main conversation on fresh host')
  await evaluate('window.__simulationRestoreMeta?.disconnect()')
  await call('Page.removeScriptToEvaluateOnNewDocument', { identifier: preload }); preload = null
  const path = `/api/agent/sessions/${encodeURIComponent(chatId)}`
  const detail = await api(path), run = await api(`/api/simulations/${encodeURIComponent(detail.simulation.id)}`)
  assert.equal(run.state, 'completed'); assert.equal(run.project, detail.project)
  assert.equal(run.mixed, true); assert.equal(detail.state, 'idle')
  assert.ok(run.resources.workspaces.length > 0 && run.resources.workspaces.every(workspace => workspace.status === 'unmounted'))
  report.runId = run.id; report.project = run.project; report.progress = run.progress; report.workspaceSessions = run.resources.workspaces.length
  report.main = transcript('main', detail)
  const base = `#/chat/${encodeURIComponent(chatId)}`
  await evaluate(`location.hash=${JSON.stringify(base + '?at=' + encodeURIComponent(report.main.step.id))}`)
  await wait(`document.querySelector('main')?.innerText.includes(${JSON.stringify(report.main.step.command.split('\n')[0])})`, 'restored main Bash command')
  report.checks.push('Completed saved main conversation restores natural prompts, replies and genuine successful Bash details')
  await screenshot('restored-main-1280x820.png')
  await evaluate(`(()=>{const a=[...document.querySelectorAll('main a')].find(a=>a.textContent.trim()==='Open in Trace'&&a.getAttribute('href')?.includes(${JSON.stringify(encodeURIComponent(report.main.step.id))}));if(!a)throw new Error('Saved main Bash Trace link missing');a.click()})()`)
  await wait(`location.hash.includes('/trace?at=') && !!document.querySelector('input[aria-label="Search the trace"]') && document.querySelectorAll('main section').length>0 && document.querySelector('main')?.innerText.includes(${JSON.stringify(report.main.step.command.split('\n')[0])}) && !document.querySelector('main [role="alert"]') && !document.querySelector('main')?.innerText.includes('The linked Trace step is no longer available.')`, 'restored saved Trace rows')
  report.checks.push('Saved main Bash opens its actual restored Trace view')
  await screenshot('restored-trace-1280x820.png')
  const child = detail.children.find(child => child.conversation)
  assert.ok(child, 'saved reusable child exists')
  const childDetail = await api(`${path}/children/${encodeURIComponent(child.id)}`)
  report.childId = child.id; report.child = transcript('child', childDetail)
  assert.equal(childDetail.child.turns, report.child.turns)
  await evaluate(`location.hash=${JSON.stringify(base + '/subagents/' + encodeURIComponent(child.id) + '?at=' + encodeURIComponent(report.child.step.id))}`)
  await wait(`!!document.querySelector('[data-agent-conversation=${JSON.stringify(child.id)}]')?.getClientRects().length && document.querySelector('main')?.innerText.includes(${JSON.stringify(report.child.step.command.split('\n')[0])})`, 'restored child Bash command')
  assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'), false)
  report.checks.push('Saved reusable child restores natural prompts, reply, turn count and genuine successful Bash details')
  await screenshot('restored-child-1280x820.png')
  assert.deepEqual(exceptions, []); assert.deepEqual(consoleErrors, []); assert.deepEqual(writes, [])
  report.checks.push('Read-only browser restore sends no host API writes and records zero browser errors')
  report.finishedAt = new Date().toISOString()
  await writeFile(join(directory, 'restore.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report, null, 2))
} catch (error) {
  report.error = error.message
  await writeFile(join(directory, 'restore-partial.json'), JSON.stringify(report, null, 2) + '\n')
  throw error
} finally {
  if (preload) await call('Page.removeScriptToEvaluateOnNewDocument', { identifier: preload }).catch(() => {})
  await evaluate('window.__simulationRestoreMeta?.disconnect()').catch(() => {})
  await call('Emulation.clearDeviceMetricsOverride').catch(() => {})
  ws.close()
}
