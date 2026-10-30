import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { DefaultResourceLoader, createAgentSession, createEventBus, SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent'
import { CONNECT_TOOLS, createConnectExtensions, subagentChildren, subagentStopTargets } from '../agents/extensions.js'

test('Pi loads the real subagent extension, limits tools, and gives children the Connect shell environment', async (t) => {
  const state = await mkdtemp(join(tmpdir(), 'connect-extension-test-'))
  const agentDir = join(state, 'pi')
  const previous = { dir: process.env.PI_CODING_AGENT_DIR, temp: process.env.PI_SUBAGENTS_TEMP_ROOT }
  t.after(async () => {
    if (previous.dir === undefined) delete process.env.PI_CODING_AGENT_DIR
    else process.env.PI_CODING_AGENT_DIR = previous.dir
    if (previous.temp === undefined) delete process.env.PI_SUBAGENTS_TEMP_ROOT
    else process.env.PI_SUBAGENTS_TEMP_ROOT = previous.temp
    await rm(state, { recursive: true, force: true })
  })
  const adapter = await createConnectExtensions({ cwd: state, agentDir, runDir: join(state, 'run'), env: { LAYERFS_PROJECT: 'connect-fixture' } })
  const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false } })
  const bus = createEventBus()
  let scriptedRpc
  const eventBus = { ...bus, emit: (channel, value) => {
    if (channel === 'subagents:rpc:v1:request' && scriptedRpc) {
      queueMicrotask(() => bus.emit(`subagents:rpc:v1:reply:${value.requestId}`, { success: true, data: scriptedRpc(value) }))
    } else bus.emit(channel, value)
  } }
  const loader = new DefaultResourceLoader({
    cwd: state, agentDir, settingsManager, eventBus,
    noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
    extensionFactories: adapter.extensionFactories,
  })
  await loader.reload()
  assert.deepEqual(loader.getExtensions().errors, [])
  const { session } = await createAgentSession({
    cwd: state, agentDir, resourceLoader: loader, settingsManager,
    sessionManager: SessionManager.inMemory(state), tools: adapter.tools,
    model: {
      id: 'connect-test', name: 'connect-test', provider: 'openai', api: 'openai-completions',
      baseUrl: 'http://127.0.0.1:1', reasoning: false, input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 8192, maxTokens: 2048,
    },
  })
  t.after(async () => {
    await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' })
    session.dispose()
  })
  const extensionErrors = []
  await session.bindExtensions({ mode: 'print', onError: (error) => extensionErrors.push(error) })
  assert.deepEqual(extensionErrors, [])
  assert.deepEqual(session.getActiveToolNames(), CONNECT_TOOLS)
  const { resolveCurrentSubagentCapabilityCeiling } = await import('pi-subagents/capability-ceiling')
  const ceiling = resolveCurrentSubagentCapabilityCeiling(session.sessionManager.getSessionId())
  assert.deepEqual(ceiling.allowedTools.sort(), ['bash', 'contact_supervisor'])
  assert.deepEqual(ceiling.allowedAgents, ['connect-worker'])
  assert.match(await readFile(join(agentDir, 'agents', 'connect-worker.md'), 'utf8'), /tools: bash\n/)
  assert.deepEqual((await adapter.status()).asyncSnapshot.runs, [])
  assert.deepEqual(await adapter.stopChildren(), { requested: [], pending: [], errors: [] })
  await assert.rejects(adapter.stopChild('missing'), /not available/)

  // Import the exact module the detached child runner loads, then execute its
  // actual Pi bash tool. No model request or user credential is needed.
  const { default: childExtension } = await import(pathToFileURL(adapter.childExtensionPath).href)
  let bash
  childExtension({ registerTool: (tool) => { bash = tool }, on: () => {} })
  const childCwd = join(state, 'child-workspace')
  await mkdir(childCwd)
  const result = await bash.execute('call-7', {
    command: 'printf "%s\\n" "$LAYERFS_PROJECT" "$LAYERFS_TRACE" "$LAYERFS_TRACE_STEP" "$LAYERFS_TRACE_START"; printf child > child.txt; pwd',
  }, undefined, undefined, {
    cwd: childCwd,
    sessionManager: { getSessionId: () => 'child-session', getSessionFile: () => null },
  })
  const output = result.content.filter((part) => part.type === 'text').map((part) => part.text).join('\n')
  assert.match(output, /connect-fixture/)
  assert.ok(output.includes(join(adapter.traceDir, 'child-child-session.jsonl')))
  assert.match(output, /child-child-session:call-7/)
  assert.ok(output.includes(childCwd))
  assert.equal(await readFile(join(childCwd, 'child.txt'), 'utf8'), 'child')
  await assert.rejects(readFile(join(state, 'child.txt')), { code: 'ENOENT' })

  // Substitute the public RPC replies, retaining the real extension event bus.
  // Acceptance alone is insufficient: only run A's observed terminal proof completes Stop.
  const stopped = []
  let observations = 0
  scriptedRpc = ({ method, params }) => {
    if (method === 'stop') { stopped.push(params.id); return { state: 'stopping' } }
    if (params.view === 'fleet') return { asyncSnapshot: { runs: [{ id: 'run-a', state: 'running' }, { id: 'run-b', state: 'running' }] } }
    observations++
    return { details: { lifecycleStatus: { processTerminal: { state: observations > 1 ? 'observed' : 'pending' } } } }
  }
  assert.deepEqual(await adapter.stopChild('run-a:0'), { requested: ['run-a'], pending: [], errors: [] })
  assert.deepEqual(stopped, ['run-a'])
  assert.equal(observations, 2)
  assert.deepEqual(JSON.parse(await readFile(join(state, 'run', 'pending-subagent-stops.json'), 'utf8')), [])
})

test('child cards retain stable run/index identity across progress and completion', () => {
  const details = {
    runId: 'run-1',
    results: [{ index: 4, agent: 'connect-worker', task: 'Check the change', exitCode: 0, progress: { status: 'running', recentOutput: ['Looking at files'], currentTool: 'bash' } }],
  }
  const streaming = subagentChildren({ details })
  assert.equal(streaming[0].id, 'run-1:4')
  assert.equal(streaming[0].state, 'running')
  assert.equal(streaming[0].text, 'Looking at files')
  const final = subagentChildren({ details: { ...details, results: [{ ...details.results[0], finalOutput: 'Checked.', sessionFile: '/session/worker.jsonl' }] } }, { final: true })
  assert.equal(final[0].id, streaming[0].id)
  assert.equal(final[0].state, 'completed')
  assert.equal(final[0].text, 'Checked.')
  assert.equal(final[0].sessionFile, '/session/worker.jsonl')
  assert.equal(subagentChildren({ details: { ...details, results: [{ ...details.results[0], stopped: true }] } }, { final: true })[0].state, 'stopped')
})

test('whole-chat stop checks terminal runs too and rejects a truncated inventory', () => {
  const runs = [
    { id: 'running', state: 'running' },
    { id: 'queued', state: 'queued' },
    { id: 'paused', state: 'paused' },
    { id: 'completed', state: 'complete' },
  ]
  const complete = { asyncSnapshot: { runs, omitted: { runs: 0, children: 2, byteLimitExceeded: false } } }
  assert.deepEqual(subagentStopTargets(complete, ['running', 'just-started']), ['running', 'just-started', 'queued', 'paused', 'completed'])
  assert.throws(() => subagentStopTargets({ asyncSnapshot: { runs, omitted: { runs: 5 } } }), /inventory was truncated/)
  assert.throws(() => subagentStopTargets({ asyncSnapshot: { runs, omitted: { runs: 0, byteLimitExceeded: true } } }), /inventory was truncated/)
  assert.throws(() => subagentStopTargets({}), /did not include a background run inventory/)
})
