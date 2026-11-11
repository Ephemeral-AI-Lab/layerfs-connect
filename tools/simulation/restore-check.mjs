// Read-only API restoration proof. Only --output is written; no host mutations.
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { dirname, join, resolve } from 'node:path'
import { isDeepStrictEqual } from 'node:util'

const flags = { evidence: [] }
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index], value = process.argv[index + 1]
  if (!key?.startsWith('--') || !value) throw new Error('Expected --name value arguments.')
  if (key === '--evidence') flags.evidence.push(resolve(value))
  else flags[key.slice(2)] = value
}
if (!flags['endpoint-file'] || !flags.evidence.length || !flags.output) throw new Error('Usage: node tools/simulation/restore-check.mjs --endpoint-file /state/host.json --evidence /state/nonmixed-performance-full.json --evidence /state/mixed-performance-full.json --output /evidence/restored-api.json [--project design] [--previous-pid PID]')
const deadline = setTimeout(() => { process.stderr.write('Restore proof reached its 110-second limit. Use --project to narrow the check.\n'); process.exit(1) }, 110000); deadline.unref()
const ensure = (condition, message) => { if (!condition) throw new Error(message) }
const readJson = async path => JSON.parse(await readFile(path, 'utf8'))
const endpoint = await readJson(flags['endpoint-file'])
ensure(!flags['previous-pid'] || String(endpoint.pid) !== flags['previous-pid'], 'The host has not restarted: its PID still matches --previous-pid.')
const api = async path => {
  const response = await fetch(endpoint.url + path, { headers: { authorization: `Bearer ${endpoint.token}` }, signal: AbortSignal.timeout(12000) })
  if (!response.ok) throw new Error(`GET ${path}: HTTP ${response.status}`)
  return response.json()
}
const text = value => typeof value === 'string' ? value : (value ?? []).filter(part => part.type === 'text').map(part => part.text).join('\n')
async function canonical(file) {
  const requests = [], calls = new Map(), results = new Map(); let finalReplies = 0
  const input = createReadStream(file), reader = createInterface({ input, crlfDelay: Infinity })
  try {
    for await (const line of reader) {
      if (!line.trim()) continue
      const entry = JSON.parse(line)
      if (entry.type !== 'message') continue
      const message = entry.message
      if (message.role === 'user') requests.push(text(message.content))
      if (message.role === 'assistant') {
        if (message.stopReason === 'stop') finalReplies++
        for (const call of message.content ?? []) if (call.type === 'toolCall' && call.name === 'bash') calls.set(call.id, call)
      }
      if (message.role === 'toolResult' && message.toolName === 'bash') results.set(message.toolCallId, message)
    }
  } finally { reader.close(); input.destroy() }
  return { requests, calls, results, finalReplies }
}
async function checkMessages({ messages, file, turns, steps, label }) {
  const saved = await canonical(file)
  const requests = messages.filter(message => message.role === 'user').map(message => message.text)
  const expectedRequests = turns.map(turn => turn.request)
  ensure(requests.length > 0 && requests.length <= 10, `${label}: user turn count outside 1..10`)
  ensure(isDeepStrictEqual(requests, expectedRequests), `${label}: restored prompts differ from compiled natural turns`)
  ensure(isDeepStrictEqual(requests, saved.requests), `${label}: restored prompts differ from canonical Pi history`)
  ensure(saved.finalReplies === requests.length, `${label}: canonical request is missing its final assistant reply`)
  const bash = messages.filter(message => message.role === 'tool' && message.toolName === 'bash')
  ensure(bash.length === steps.length && saved.calls.size === steps.length && saved.results.size === steps.length, `${label}: restored or canonical Bash count does not match compiled steps`)
  const expectedSteps = new Set(steps.map(step => step.key)), observedSteps = new Set(); let linkedCalls = 0
  for (const message of bash) {
    const call = saved.calls.get(message.id), receipt = saved.results.get(message.id)
    ensure(call && receipt && !receipt.isError, `${label}: missing successful canonical Bash receipt ${message.id}`)
    ensure(message.status === 'done', `${label}: restored Bash step is still pending or failed`)
    ensure(message.args?.command === call.arguments.command, `${label}: visible Bash command differs from canonical command`)
    ensure(message.text === text(receipt.content), `${label}: visible Bash output differs from canonical output`)
    ensure(isDeepStrictEqual(message.details?.argv, receipt.details?.argv) && isDeepStrictEqual(message.details?.receipt, receipt.details?.receipt), `${label}: actual CLI argv/receipt changed during restoration`)
    const key = message.details?.stepKey
    ensure(expectedSteps.has(key) && !observedSteps.has(key), `${label}: unexpected or duplicate restored step ${key}`)
    observedSteps.add(key); linkedCalls += message.view?.calls?.length ?? 0
  }
  return { userTurns: requests.length, finalReplies: saved.finalReplies, bashSteps: bash.length, linkedCalls, canonicalHistoryMatched: true, compiledTurnsMatched: true }
}
const runs = []
try {
  for (const evidenceFile of flags.evidence) {
    const batch = await readJson(evidenceFile)
    const selected = batch.runs.filter(run => !flags.project || run.template === flags.project)
    ensure(selected.length > 0, `No selected runs in ${evidenceFile}`)
    for (const launched of selected) {
      const directory = launched.directory, manifest = await readJson(join(directory, 'manifest.json')), plan = await readJson(join(directory, 'plan.json')), sessions = await readJson(join(directory, 'sessions.json'))
      const snapshot = await api(`/api/simulations/${launched.id}`)
      ensure(snapshot.state === 'completed' && manifest.status === 'completed', `${batch.mode}/${launched.template}: run is not completed after restoration (${snapshot.state})`)
      const conversations = []
      for (const conversation of plan.conversations) {
        const saved = sessions.conversations[conversation.id]
        ensure(saved?.id && saved.sessionFile, `${launched.template}: missing saved main session`)
        const detail = await api(`/api/agent/sessions/${saved.id}`)
        ensure(detail.project === manifest.projectRef && detail.simulation?.id === launched.id, `${launched.template}/${conversation.id}: restored project/run binding changed`)
        ensure(detail.state === 'idle' && !detail.error && detail.execution?.phase === 'idle', `${launched.template}/${conversation.id}: restored main is not idle`)
        const main = await checkMessages({ messages: detail.messages, file: saved.sessionFile, turns: plan.turns.filter(turn => turn.conversationId === conversation.id && !turn.agentId), steps: plan.steps.filter(step => step.phase === 'conversation' && step.conversationId === conversation.id && !step.agentId), label: `${launched.template}/${conversation.id}/main` })
        const children = []
        const expectedChildren = conversation.subagents.filter(agent => plan.tasks.some(task => task.conversationId === conversation.id && task.agentId === agent.id))
        ensure(detail.children.length === expectedChildren.length && detail.children.length <= 8, `${launched.template}/${conversation.id}: restored child count changed`)
        for (const child of expectedChildren) {
          const savedChild = sessions.subagents[`${conversation.id}/${child.id}`]
          ensure(savedChild?.sessionFile, `${launched.template}/${conversation.id}/${child.id}: no canonical child session`)
          const result = await api(`/api/agent/sessions/${saved.id}/children/${encodeURIComponent(child.id)}`)
          ensure(result.child?.id === child.id && result.child.state === 'completed', `${launched.template}/${conversation.id}/${child.id}: restored child is not completed`)
          const checked = await checkMessages({ messages: result.messages, file: savedChild.sessionFile, turns: plan.turns.filter(turn => turn.conversationId === conversation.id && turn.agentId === child.id), steps: plan.steps.filter(step => step.phase === 'conversation' && step.conversationId === conversation.id && step.agentId === child.id), label: `${launched.template}/${conversation.id}/${child.id}` })
          children.push({ id: child.id, ...checked })
        }
        conversations.push({ id: conversation.id, main, children })
      }
      const row = { mode: batch.mode, template: launched.template, runId: launched.id, project: manifest.projectRef, state: snapshot.state, conversations }
      runs.push(row)
      process.stdout.write(`${batch.mode}/${launched.template}: restored ${conversations.length} conversations, ${conversations.reduce((sum, item) => sum + item.children.length, 0)} children\n`)
    }
  }
  const agents = runs.flatMap(run => run.conversations.flatMap(conversation => [conversation.main, ...conversation.children]))
  const result = { version: 1, checkedAt: new Date().toISOString(), host: { url: endpoint.url, pid: endpoint.pid }, ...(flags['previous-pid'] ? { previousPid: Number(flags['previous-pid']), restartVerified: true } : {}), counts: { runs: runs.length, conversations: runs.reduce((sum, run) => sum + run.conversations.length, 0), children: runs.reduce((sum, run) => sum + run.conversations.reduce((count, conversation) => count + conversation.children.length, 0), 0), bashSteps: agents.reduce((sum, agent) => sum + agent.bashSteps, 0), maxUserTurns: Math.max(...agents.map(agent => agent.userTurns)) }, passed: true, runs }
  await mkdir(dirname(resolve(flags.output)), { recursive: true }); await writeFile(resolve(flags.output), JSON.stringify(result, null, 2) + '\n', { mode: 0o600 })
  process.stdout.write(`PASS: ${result.counts.runs} restored runs, ${result.counts.bashSteps} actual Bash steps; maximum ${result.counts.maxUserTurns} turns per agent.\nEvidence: ${resolve(flags.output)}\n`)
} catch (error) { process.stderr.write(`Restore proof failed: ${error.message}\nNext step: inspect that saved conversation, or retry with --project <template> to narrow the proof.\n`); process.exitCode = 1 }
finally { clearTimeout(deadline) }
