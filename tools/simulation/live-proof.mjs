#!/usr/bin/env node
// Bounded proof steps: start, status, audit. Runs and evidence are always retained.
import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { dirname, join, resolve } from 'node:path'
import { auditLifecycleAdmission } from './lifecycle-audit.mjs'
import { SIMULATION_PROFILES, validateSimulationPackage, renderSimulationCommand } from './compiler.mjs'

const deadline = setTimeout(() => { process.stderr.write('Proof command reached its 110-second limit. Evidence is retained; use --project to narrow the audit and retry.\n'); process.exit(1) }, 110000)
deadline.unref()

const [command, ...args] = process.argv.slice(2), flags = {}
for (let index = 0; index < args.length; index += 2) {
  if (!args[index].startsWith('--') || !args[index + 1]) throw new Error('Expected --name value arguments.')
  flags[args[index].slice(2)] = args[index + 1]
}
if (!['start', 'status', 'audit'].includes(command) || !flags['endpoint-file'] || !flags.evidence) throw new Error('Usage: node tools/simulation/live-proof.mjs start|status|audit --endpoint-file /state/host.json --evidence /evidence/batch.json [--mode filesystem|mixed] [--machines JSON] [--project website]')
const endpointFile = resolve(flags['endpoint-file']), evidenceFile = resolve(flags.evidence)
const endpoint = JSON.parse(await readFile(endpointFile, 'utf8'))
const api = async (method, path, body) => {
  const response = await fetch(endpoint.url + path, { method, signal: AbortSignal.timeout(12000), headers: { authorization: `Bearer ${endpoint.token}`, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })
  const result = await response.json()
  if (!response.ok) throw new Error(`${method} ${path}: ${result.message ?? response.status}`)
  return result
}
const save = async value => { await mkdir(dirname(evidenceFile), { recursive: true }); await writeFile(evidenceFile, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 }) }
const terminal = value => ['completed', 'failed', 'stopped', 'interrupted'].includes(value)
const readJson = async path => JSON.parse(await readFile(path, 'utf8'))
async function* lines(path) {
  const stream = createReadStream(path)
  const reader = createInterface({ input: stream, crlfDelay: Infinity })
  try { for await (const line of reader) if (line.trim()) yield JSON.parse(line) }
  finally { reader.close(); stream.destroy() }
}
const ensure = (condition, reason) => { if (!condition) throw new Error(`Proof failed: ${reason}`) }

if (command === 'start') {
  const mode = flags.mode ?? 'filesystem'
  if (!['filesystem', 'mixed'].includes(mode)) throw new Error('Mode must be filesystem or mixed.')
  try { await stat(evidenceFile); throw new Error('Evidence file already exists; use a new batch file.') } catch (error) { if (error.code !== 'ENOENT') throw error }
  const defaults = { design: 'native', billing: 'docker', sdk: 'demo-build', evaluation: 'demo-research', embeddings: 'demo-research', compiler: 'demo-build', gateway: 'docker', website: 'native' }
  const machines = { ...defaults, ...(flags.machines ? JSON.parse(flags.machines) : {}) }
  const projects = flags.project ? [flags.project] : Object.keys(SIMULATION_PROFILES)
  for (const project of projects) if (!SIMULATION_PROFILES[project]) throw new Error(`Unknown project ${project}`)
  const proof = { version: 1, endpointFile, mode, startedAt: new Date().toISOString(), runs: [] }
  // Save every successful launch immediately; a later launch refusal never loses IDs.
  await save(proof)
  for (const project of projects) {
    const run = await api('POST', '/api/simulations', { project, machine: machines[project], mixed: mode === 'mixed' })
    proof.runs.push({ template: project, id: run.id, project: run.project, store: run.store, machine: machines[project], directory: run.directory })
    await save(proof)
    process.stdout.write(`${project}: ${run.id} ${run.project}\n`)
  }
  process.stdout.write(`Started ${proof.runs.length} independent runs; retained evidence: ${evidenceFile}\n`)
} else {
  const proof = await readJson(evidenceFile), selected = proof.runs.filter(run => !flags.project || run.template === flags.project)
  ensure(selected.length > 0, 'no selected runs')
  const snapshots = await Promise.all(selected.map(run => api('GET', `/api/simulations/${run.id}`)))
  proof.checkedAt = new Date().toISOString()
  proof.snapshots = { ...proof.snapshots, ...Object.fromEntries(snapshots.map(run => [run.id, run])) }
  await save(proof)
  if (command === 'status') {
    for (const run of snapshots) process.stdout.write(`${run.template}: ${run.state} ${run.progress?.completed ?? 0}/${run.progress?.total ?? '?'}${run.error ? ` ${run.error}` : ''}\n`)
    process.stdout.write(`${snapshots.filter(run => terminal(run.state)).length}/${snapshots.length} terminal\n`)
  } else {
    for (const run of snapshots) ensure(run.state === 'completed', `${run.template} is ${run.state}: ${run.error ?? ''}`)
    const audit = [], wanted = new Map(), events = [], binarySources = new Map()
    for (const snapshot of snapshots) {
      const directory = snapshot.directory, manifest = await readJson(join(directory, 'manifest.json')), plan = await readJson(join(directory, 'plan.json')), sessions = await readJson(join(directory, 'sessions.json')), resources = await readJson(join(directory, 'resources.json'))
      await validateSimulationPackage(directory)
      const sourceFiles = Object.entries(manifest.hashes).filter(([path]) => path.startsWith('setup/source/'))
      const packageIdentity = { algorithm: 'sha256', manifestHashes: createHash('sha256').update(JSON.stringify(manifest.hashes)).digest('hex'), sourceFiles: sourceFiles.length, importedSource: createHash('sha256').update(JSON.stringify(sourceFiles)).digest('hex') }
      const verification = await readJson(join(directory, 'verification/result.json'))
      ensure(verification.project === manifest.projectRef, `${manifest.project}: verification project binding`)
      ensure(Object.keys(sessions.conversations).length === plan.conversations.length && plan.conversations.length <= 8, `${manifest.project}: conversation count`)
      const journalEntries = []
      const completed = new Map(), started = new Map(), tasks = new Set(), planByKey = new Map(plan.steps.map(step => [step.key, step]))
      for await (const event of lines(join(directory, 'journal.jsonl'))) {
        journalEntries.push(event)
        if (event.type === 'step.started') { ensure(!started.has(event.step), `${manifest.project}: duplicate attempt of ${event.step}`); started.set(event.step, event) }
        if (event.type === 'step.completed') { ensure(!completed.has(event.step), `${manifest.project}: duplicate receipt for ${event.step}`); completed.set(event.step, event) }
        if (event.type === 'task.completed') tasks.add(event.task)
      }
      const lifecycleAdmission = manifest.mixed ? auditLifecycleAdmission(journalEntries) : null
      if (manifest.mixed) ensure(lifecycleAdmission.checkedWorkspaceCalls > 0 && lifecycleAdmission.checkedSandboxCount > 0, `${manifest.project}: missing measured lifecycle admission evidence`)
      ensure(tasks.size === plan.tasks.length, `${manifest.project}: tasks incomplete`)
      ensure(plan.steps.every(step => completed.has(step.key)), `${manifest.project}: planned operations incomplete`)
      ensure(started.size === completed.size, `${manifest.project}: uncertain operations remain`)
      for (const [key, event] of completed) {
        ensure(event.activity?.id, `${manifest.project}: ${key} lacks CLI capture ID`)
        ensure(!wanted.has(event.activity.id), `${manifest.project}: duplicate CLI capture identity`)
        wanted.set(event.activity.id, { runId: manifest.runId, key, expectsInput: planByKey.get(key)?.input !== undefined, stages: new Set() })
      }
      ensure(resources.workspaces.length === (manifest.mixed ? 48 * manifest.cycles : 0), `${manifest.project}: workspace lifecycle count mismatch`)
      ensure(resources.workspaces.every(item => item.status === 'unmounted'), `${manifest.project}: mounted workspace remains`)
      let reused = 0, children = 0, collectedResults = 0, bashStepsVerified = 0
      const agentTurns = {}
      const verifyBashTranscript = (messages, expectedKeys, label) => {
        const calls = new Map(), confirmed = new Set()
        for (const message of messages) {
          if (message.role === 'assistant') for (const part of message.content ?? []) if (part.type === 'toolCall' && part.name === 'bash') {
            ensure(!calls.has(part.id), `${label}: duplicate bash tool call`)
            calls.set(part.id, part.arguments.command)
          }
          if (message.role !== 'toolResult' || message.toolName !== 'bash') continue
          const details = message.details, key = details?.stepKey, step = planByKey.get(key)
          ensure(!message.isError && expectedKeys.has(key) && !confirmed.has(key), `${label}: invalid/duplicate bash result ${key}`)
          ensure(step && details.taskId === step.taskId && details.scriptPath === step.scriptPath && details.exitCode === 0, `${label}: bash assignment identity/exit mismatch`)
          const actual = started.get(key)?.argv
          ensure(isDeepStrictEqual(details.argv, actual), `${label}: bash argv differs from CLI journal`)
          ensure(calls.get(message.toolCallId) === renderSimulationCommand(step, actual), `${label}: bash tool does not contain exact explicit CLI command`)
          ensure(isDeepStrictEqual(details.receipt, completed.get(key)?.result), `${label}: bash receipt differs from actual CLI result`)
          confirmed.add(key)
        }
        ensure(confirmed.size === expectedKeys.size && calls.size === confirmed.size, `${label}: planned bash steps are missing from real transcript`)
        bashStepsVerified += confirmed.size
      }
      for (const conversation of plan.conversations) {
        const saved = sessions.conversations[conversation.id]
        ensure(saved.project === manifest.projectRef && saved.sessionFile, `${manifest.project}: missing project-bound transcript`)
        let parentTurns = 0
        const parentMessages = []
        const collected = new Map()
        for await (const row of lines(saved.sessionFile)) {
          if (row.type !== 'message') continue
          parentMessages.push(row.message)
          if (row.message?.role === 'user') parentTurns++
          if (row.message?.role === 'toolResult' && row.message.toolName === 'simulation_collect') {
            const details = row.message.details
            ensure(!row.message.isError && details?.taskId && !collected.has(details.taskId), `${manifest.project}: invalid or duplicate worker collection`)
            collected.set(details.taskId, details)
          }
        }
        const conversationTasks = plan.tasks.filter(task => task.conversationId === conversation.id)
        const delegated = conversationTasks.filter(task => task.agentId)
        ensure(parentTurns >= 1 && parentTurns <= 10, `${manifest.project}: main agent exceeds ten-turn budget (${parentTurns})`)
        const expectedParentTurns = plan.turns.filter(turn => turn.conversationId === conversation.id && turn.agentId === null)
        ensure(parentTurns === expectedParentTurns.length, `${manifest.project}: main natural request count differs from compiled turns`)
        const actualParentRequests = parentMessages.filter(message => message.role === 'user').map(message => message.content).map(content => typeof content === 'string' ? content : content.filter(part => part.type === 'text').map(part => part.text).join(''))
        ensure(isDeepStrictEqual(actualParentRequests, expectedParentTurns.map(turn => turn.request)), `${manifest.project}: main user requests differ from compiled natural prompts`)
        agentTurns[`${conversation.id}/main`] = parentTurns
        verifyBashTranscript(parentMessages, new Set(conversationTasks.filter(task => !task.agentId).flatMap(task => task.stepKeys)), `${manifest.project}/${conversation.id}/main`)
        ensure(collected.size === delegated.length, `${manifest.project}: missing genuine collected worker results`)
        for (const task of delegated) {
          const details = collected.get(task.id), last = completed.get(task.stepKeys.at(-1))
          ensure(details?.sessionFile === sessions.subagents[`${conversation.id}/${task.agentId}`]?.sessionFile, `${manifest.project}: collected child session identity mismatch`)
          ensure(details?.agentId === task.agentId && details.result?.taskId === task.id && details.result.commands === task.stepKeys.length, `${manifest.project}: collection assignment identity mismatch`)
          ensure(isDeepStrictEqual(details.result.final, last.result), `${manifest.project}: collected worker result differs from actual CLI receipt`)
          collectedResults++
        }
        const nested = Object.entries(sessions.subagents).filter(([key]) => key.startsWith(conversation.id + '/'))
        ensure(nested.length <= 8, `${manifest.project}: subagent ceiling exceeded`)
        for (const [key, child] of nested) {
          children++
          const agentId = key.slice(conversation.id.length + 1), assignments = plan.tasks.filter(task => task.conversationId === conversation.id && task.agentId === agentId)
          let turns = 0, parent = null
          const childMessages = []
          for await (const row of lines(child.sessionFile)) { if (row.type === 'session') parent = row.parentSession; if (row.type === 'message') { childMessages.push(row.message); if (row.message?.role === 'user') turns++ } }
          ensure(parent === saved.sessionFile, `${manifest.project}: ${key} parent transcript mismatch`)
          ensure(turns >= 1 && turns <= 10, `${manifest.project}: ${key} exceeds ten-turn budget (${turns})`)
          const expectedChildTurns = plan.turns.filter(turn => turn.conversationId === conversation.id && turn.agentId === agentId)
          ensure(turns === expectedChildTurns.length, `${manifest.project}: ${key} natural request count differs from compiled turns`)
          const actualChildRequests = childMessages.filter(message => message.role === 'user').map(message => message.content).map(content => typeof content === 'string' ? content : content.filter(part => part.type === 'text').map(part => part.text).join(''))
          ensure(isDeepStrictEqual(actualChildRequests, expectedChildTurns.map(turn => turn.request)), `${manifest.project}: ${key} user requests differ from compiled natural prompts`)
          agentTurns[key] = turns
          verifyBashTranscript(childMessages, new Set(assignments.flatMap(task => task.stepKeys)), `${manifest.project}/${key}`)
          if (assignments.length > 1) reused++
        }
      }
      ensure(reused > 0, `${manifest.project}: no reused child session proved`)
      audit.push({ id: manifest.runId, template: manifest.project, project: manifest.projectRef, store: manifest.store, plannedCommands: plan.steps.length, completedCommands: completed.size, conversations: plan.conversations.length, children, reusedChildren: reused, collectedResults, bashStepsVerified, agentTurns, maxAgentTurns: Math.max(...Object.values(agentTurns)), turnLimitVerified: true, packageIdentity, ...(lifecycleAdmission ?? {}), verification, workspaceSessions: resources.workspaces.length })
    }
    // Scan local capture shards once, retaining metadata only. Do not export tokens or command contents.
    const captureDirectory = join(dirname(endpointFile), 'logs/cli')
    for (const name of await readdir(captureDirectory)) {
      if (!/^activity-.*\.ndjson$/.test(name)) continue
      for await (const event of lines(join(captureDirectory, name))) {
        const expected = wanted.get(event.invocationId)
        if (!expected) continue
        ensure(!expected.stages.has(event.type) || event.type === 'cli.progress', `${expected.key}: duplicate ${event.type} capture`)
        expected.stages.add(event.type)
        if (event.type === 'cli.queued' && expected.expectsInput) ensure(event.data.stdin && event.data.stdin.truncated === false, `${expected.key}: missing or truncated CLI input capture`)
        if (event.type === 'cli.started') { ensure(event.data.identity?.commit, `${expected.key}: missing CLI source identity`); binarySources.set(event.data.identity.commit, event.data.identity); events.push({ at: event.data.started, delta: 1, runId: expected.runId }) }
        if (event.type === 'cli.finished') { ensure(event.data.status === 'success', `${expected.key}: CLI capture failed`); ensure(event.data.stdout !== undefined && event.data.stderr !== undefined, `${expected.key}: missing captured CLI output`); ensure(event.data.stdout.truncated === false && event.data.stderr.truncated === false, `${expected.key}: truncated CLI output capture`); events.push({ at: event.data.ended, delta: -1, runId: expected.runId }) }
      }
    }
    for (const expected of wanted.values()) for (const stage of ['cli.queued', 'cli.started', 'cli.finished']) ensure(expected.stages.has(stage), `${expected.key}: missing ${stage} capture`)
    events.sort((a, b) => a.at - b.at || a.delta - b.delta)
    let active = 0, peak = 0, overlap = false
    const perRun = new Map()
    for (const event of events) { active += event.delta; peak = Math.max(peak, active); perRun.set(event.runId, (perRun.get(event.runId) ?? 0) + event.delta); if ([...perRun.values()].filter(value => value > 0).length > 1) overlap = true }
    ensure(peak <= 12, `global CLI ceiling exceeded: ${peak}`)
    ensure(new Set(audit.map(run => run.store)).size === audit.length && new Set(audit.map(run => run.project)).size === audit.length, 'runs share a Store or project')
    if (selected.length > 1) ensure(overlap, 'no actual CLI overlap between runs')
    proof.audits = { ...proof.audits, ...Object.fromEntries(audit.map(run => [run.id, run])) }
    proof.binarySources = [...binarySources.values()]
    proof.concurrency = { peak, simultaneousRunsProved: overlap, selectedRuns: selected.length }
    await save(proof)
    process.stdout.write(JSON.stringify({ passed: true, runs: audit.length, captureInvocations: wanted.size, peak, simultaneousRunsProved: overlap, evidence: evidenceFile }, null, 2) + '\n')
  }
}
