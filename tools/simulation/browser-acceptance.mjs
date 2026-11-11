// Acceptance on the actual preview and a caller-selected private real host.
// Requires --launch and --host-receipt. Opens no browser/application and never
// stops runs. The only mutation is one slash-command simulation launch.
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
const option = (name, fallback) => { const index = process.argv.indexOf(name); return index < 0 ? fallback : process.argv[index + 1] }
assert.ok(process.argv.includes('--launch') || option('--resume-chat'), 'Pass --launch to start one run or --resume-chat <id> to inspect an existing run.')
const receiptPath = option('--host-receipt')
assert.ok(receiptPath, 'Pass the private proof host.json with --host-receipt.')
const endpoint = JSON.parse(await readFile(receiptPath, 'utf8'))
assert.match(endpoint.url, /^http:\/\/(127\.0\.0\.1|localhost):\d+$/)
const targetId = option('--target', '8759D72EC2A022C01261AF4ACBD80DB1')
const tabs = await (await fetch(`http://127.0.0.1:${option('--cdp', '18800')}/json/list`)).json()
const target = tabs.find(tab => tab.id === targetId && tab.type === 'page')
assert.ok(target, 'Use the existing simulation-ui browser tab.')
assert.match(target.url, /^http:\/\/(127\.0\.0\.1|localhost):1025\//)
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject })
let sequence = 0
const requests = new Map(), exceptions = [], consoleErrors = []
ws.onmessage = event => {
  const message = JSON.parse(event.data)
  if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails.text)
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') consoleErrors.push(message.params.args.map(arg => arg.value ?? arg.description ?? arg.type).join(' '))
  const request = requests.get(message.id)
  if (request) { requests.delete(message.id); message.error ? request.reject(new Error(message.error.message)) : request.resolve(message.result) }
}
const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence; requests.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })) })
const evaluate = async expression => {
  const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text)
  return result.result.value
}
const wait = async (read, label, timeout = 180000) => {
  const end = Date.now() + timeout
  while (Date.now() < end) { const value = await read(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 500)) }
  throw new Error(`Timed out waiting for ${label}`)
}
const dom = (expression, label, timeout) => wait(() => evaluate(expression), label, timeout)
const frames = () => evaluate('new Promise(resolve => { setTimeout(resolve, 150); requestAnimationFrame(() => requestAnimationFrame(resolve)) })')
const api = path => evaluate(`(async()=>{const m=JSON.parse(document.querySelector('meta[name="lfs-host"]').content);const response=await fetch(m.url+${JSON.stringify(path)},{headers:{authorization:'Bearer '+m.token}});if(!response.ok)throw new Error('Read failed '+response.status+' '+${JSON.stringify(path)});return response.json()})()`)
const visibleButton = (label, prefix = false) => evaluate(`(()=>{const b=[...document.querySelectorAll('main button')].find(b=>b.getClientRects().length && ${prefix ? 'b.textContent.trim().startsWith' : 'b.textContent.trim() ==='}${prefix ? `(${JSON.stringify(label)})` : ` ${JSON.stringify(label)}`});if(!b)throw new Error('Button missing '+${JSON.stringify(label)});b.click()})()`)
const directory = option('--output-dir', '/tmp/simulation-browser-acceptance')
const report = { started: new Date().toISOString(), host: endpoint.url, target: targetId, checks: [], exceptions, consoleErrors }
let preload
try {
  await mkdir(directory, { recursive: true })
  await call('Page.enable'); await call('Runtime.enable')
  const source = `(()=>{const update=()=>{const m=document.querySelector('meta[name="lfs-host"]');if(!m)return;const original=JSON.parse(m.content);if(original.url===${JSON.stringify(endpoint.url)}&&original.token===${JSON.stringify(endpoint.token)})return;m.content=JSON.stringify({...original,url:${JSON.stringify(endpoint.url)},token:${JSON.stringify(endpoint.token)}})};const observer=new MutationObserver(update);observer.observe(document,{subtree:true,childList:true,attributes:true,attributeFilter:['content']});update();window.__simulationAcceptanceMeta=observer})()`
  preload = (await call('Page.addScriptToEvaluateOnNewDocument', { source })).identifier
  await call('Page.navigate', { url: 'http://127.0.0.1:1025/?mac=1#/' })
  // A hash-only navigation does not create a document or execute preload.
  await call('Page.reload')
  await dom(`JSON.parse(document.querySelector('meta[name="lfs-host"]')?.content??'{}').url===${JSON.stringify(endpoint.url)} && document.querySelector('h1')?.textContent==='What should we work on?'`, 'new chat on selected host')
  await evaluate('window.__simulationAcceptanceMeta?.disconnect()')
  await call('Page.removeScriptToEvaluateOnNewDocument', { identifier: preload }); preload = null
  exceptions.length = 0; consoleErrors.length = 0
  const project = option('--project', 'design'), machine = option('--machine', 'native')
  assert.equal(project, 'design', 'This acceptance flow checks the design preset README.')
  assert.match(machine, /^[a-zA-Z0-9_-]+$/)
  const mixed = !process.argv.includes('--filesystem')
  const command = `/simulation --project ${project} --machine ${machine}${mixed ? ' --mixed' : ''}`
  let chatId = option('--resume-chat')
  if (!chatId) {
    await dom(`!!document.querySelector('textarea[aria-label="Message"]')?.getClientRects().length`, 'new chat composer');
    await evaluate(`(()=>{const e=document.querySelector('textarea[aria-label="Message"]');e.focus();e.select()})()`)
    await call('Input.insertText', { text: command }); await frames()
    await dom(`document.querySelector('textarea[aria-label="Message"]')?.value===${JSON.stringify(command)} && !document.querySelector('button[aria-label="Send"]')?.disabled`, 'ready slash command')
    await evaluate(`document.querySelector('button[aria-label="Send"]').click()`)
    chatId = await dom(`location.hash.startsWith('#/chat/') ? location.hash.slice(7).split('/')[0].split('?')[0] : null`, 'saved conversation')
  } else {
    await evaluate(`location.hash=${JSON.stringify('#/chat/' + encodeURIComponent(chatId))}`)
    await dom(`!!document.querySelector('[data-agent-conversation="main"]')?.getClientRects().length`, 'existing conversation')
  }
  const sessionPath = `/api/agent/sessions/${encodeURIComponent(chatId)}`, base = `#/chat/${encodeURIComponent(chatId)}`
  report.chatId = chatId
  let detail = await api(sessionPath)
  report.runId = detail.simulation.id; report.project = detail.project
  report.checks.push(option('--resume-chat') ? 'Reopened a saved conversation from the existing slash-launch run' : 'Actual slash command created and opened a fresh saved project conversation')
  const pending = await wait(async () => {
    detail = await api(sessionPath)
    if (detail.error) throw new Error(detail.error)
    const bash = detail.messages.find(message => message.role === 'tool' && message.toolName === 'bash' && message.status === 'running')
    return bash && { id: bash.id, command: bash.args.command, scriptPath: bash.args.scriptPath }
  }, 'genuine main pending bash')
  assert.match(pending.command, /LAYERFS_CONNECT_CLI|layerfs/)
  report.pendingBash = pending
  await wait(async () => (await api(sessionPath)).messages.find(message => message.id === pending.id && message.status === 'done'), 'same bash result persisted')
  report.checks.push('Same genuine bash tool moved from running to done with explicit CLI command')
  // The long foundation turn provides real saved steps for the viewing limit.
  await dom(`!![...document.querySelectorAll('[data-agent-conversation="main"] button')].find(b=>b.textContent.trim().startsWith('Show earlier '))`, 'live earlier-step reveal')
  const before = await evaluate(`[...document.querySelector('[data-agent-conversation="main"]').querySelectorAll('button')].filter(button=>button.classList.contains('group/step')).length`)
  await visibleButton('Show earlier ', true); await frames()
  const after = await evaluate(`[...document.querySelector('[data-agent-conversation="main"]').querySelectorAll('button')].filter(button=>button.classList.contains('group/step')).length`)
  assert.ok(after > before, 'Earlier step control reveals actual additional command rows')
  report.checks.push(`Live earlier-step control increased rendered command rows from ${before} to ${after}`)
  // Focus an old genuine call outside the newest live steps.
  detail = await api(sessionPath)
  const old = detail.messages.find(message => message.role === 'tool' && message.toolName === 'bash')
  await evaluate(`location.hash=${JSON.stringify(base + '?at=' + encodeURIComponent(old.id))}`)
  await dom(`document.querySelector('main')?.innerText.includes(${JSON.stringify(old.args.command.split('\n')[0])})`, 'focused old bash command')
  await dom(`!![...document.querySelectorAll('main a')].find(a=>a.textContent.trim()==='Open in Trace'&&a.getAttribute('href')?.includes(${JSON.stringify(encodeURIComponent(old.id))}))`, 'focused call Trace link')
  await evaluate(`(()=>{const a=[...document.querySelectorAll('main a')].find(a=>a.textContent.trim()==='Open in Trace'&&a.getAttribute('href')?.includes(${JSON.stringify(encodeURIComponent(old.id))}));a.click()})()`)
  await dom(`location.hash.includes('/trace?at=') && !!document.querySelector('input[aria-label="Search the trace"]')`, 'Trace navigation')
  report.checks.push('Old call remains visible under Trace focus and Open in Trace navigates with its real tool ID')
  await evaluate(`location.hash=${JSON.stringify(base)}`)
  detail = await wait(async () => { const next = await api(sessionPath); return next.children?.some(child => child.conversation) && next }, 'saved child session')
  const child = detail.children.find(child => child.conversation), childPath = `${sessionPath}/children/${encodeURIComponent(child.id)}`
  const childView = `${base}/subagents/${encodeURIComponent(child.id)}`
  await evaluate(`location.hash=${JSON.stringify(childView)}`)
  await dom(`!!document.querySelector('[data-agent-conversation=${JSON.stringify(child.id)}]')?.getClientRects().length`, 'visible child transcript')
  const childData = await wait(async () => { const value = await api(childPath); return value.messages.some(message => message.toolName === 'bash' && message.status === 'done') && value }, 'child genuine bash receipt')
  for (const [name, messages] of [['main', detail.messages], ['child', childData.messages]]) {
    const users = messages.filter(message => message.role === 'user')
    assert.ok(users.length > 0 && users.length <= 10, `${name} has 1–10 natural user turns`)
    assert.ok(users.every(message => message.text.length > 40 && !message.text.startsWith('Complete the related simulation objectives assigned to this ')), `${name} requests are actual objective prompts`)
    report[`${name}Turns`] = users.length
  }
  assert.equal(childData.child.turns, childData.messages.filter(message => message.role === 'user').length)
  assert.ok(childData.messages.filter(message => message.toolName === 'bash').every(message => message.status !== 'error'))
  report.checks.push('Main and reusable child have natural objective prompts, <=10 request turns, and real successful bash receipts')
  const childBash = childData.messages.find(message => message.toolName === 'bash')
  assert.ok(childBash.details?.receipt && childBash.details.argv?.length)
  report.childBash = { command: childBash.args.command, scriptPath: childBash.args.scriptPath, receipt: childBash.details.receipt }
  for (const [width, height] of [[1280, 820], [900, 600]]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }); await frames()
    await evaluate(`(()=>{const e=document.querySelector('[data-agent-conversation=${JSON.stringify(child.id)}]');if(e)e.scrollTop=e.scrollHeight})()`); await frames()
    assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'), false)
    const screenshot = await call('Page.captureScreenshot', { format: 'png' })
    await writeFile(join(directory, `child-${width}x${height}.png`), Buffer.from(screenshot.data, 'base64'))
  }
  if (process.argv.includes('--profile')) {
    const measured = await promisify(execFile)(process.execPath, [fileURLToPath(new URL('./browser-profile.mjs', import.meta.url)), '--target', targetId, '--output', join(directory, 'chat-profile.json')])
    report.profile = JSON.parse(measured.stdout)
  }
  await visibleButton('Files')
  await dom(`document.querySelector('main')?.innerText.includes('LayerFS project files · read-only') && document.querySelector('main')?.innerText.includes('README.md')`, 'real project Files')
  await dom(`document.querySelector('main')?.innerText.includes('# Field Notes design kit')`, 'actual saved README text')
  report.checks.push('Files displays actual saved README content')
  await visibleButton('History')
  await dom(`document.querySelectorAll('main [data-history-node]').length > 0 && !!document.querySelector('main [data-branch-tag="main"]')`, 'actual saved History')
  report.history = await evaluate(`document.querySelector('main').innerText.slice(-1800)`)
  report.checks.push('History displays actual saved checkpoints and branches')
  const run = await wait(async () => { const next = await api(`/api/simulations/${encodeURIComponent(report.runId)}`); if (['failed', 'interrupted', 'stopped'].includes(next.state)) throw new Error(next.error ?? next.state); return (!mixed || next.resources.workspaces.length > 0) && next }, mixed ? 'real Mixed workspace receipts' : 'current filesystem run resources')
  report.run = { id: run.id, state: run.state, project: run.project, mixed: run.mixed, progress: run.progress, workspaces: run.resources.workspaces.length, unmounted: run.resources.workspaces.filter(workspace => workspace.status === 'unmounted').length }
  assert.equal(report.run.project, report.project)
  assert.ok(!['failed', 'interrupted', 'stopped'].includes(run.state), run.error)
  assert.equal(report.run.mixed, mixed)
  if (mixed) assert.ok(report.run.workspaces > 0, 'Real Mixed workspaces were created')
  else assert.equal(report.run.workspaces, 0, 'Filesystem simulation does not create workspaces')
  assert.deepEqual(exceptions, []); assert.deepEqual(consoleErrors, [])
  report.finished = new Date().toISOString()
  await writeFile(join(directory, 'acceptance.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report, null, 2))
} catch (error) {
  report.error = error.message
  await writeFile(join(directory, 'acceptance-partial.json'), JSON.stringify(report, null, 2) + '\n')
  throw error
} finally {
  if (preload) await call('Page.removeScriptToEvaluateOnNewDocument', { identifier: preload }).catch(() => {})
  await evaluate('window.__simulationAcceptanceMeta?.disconnect()').catch(() => {})
  await call('Emulation.clearDeviceMetricsOverride').catch(() => {})
  ws.close()
}
