// Live: project-owned conversations against the pinned LayerFS CLI and daemon,
// in a private disposable home, with a deterministic local model (no paid
// requests). It exercises mounted project chats (boundary saves, tool saves,
// unchanged saves, restore), SDK and CLI operations in a folder chat (mixed
// eligible/ineligible calls, fork from Layer/Commit, merge, publish, failure
// after saved writes), session-branch saves, restart, copy and reconstruction
// on a fresh local index.
//   LAYERFS_CONNECT_LIVE_SESSIONS=1 LAYERFS_CONNECT_CLI=<pinned layerfs> LAYERFS_CONNECT_DAEMON=<pinned daemon> \
//     node --test --test-timeout=600000 host/test/session-live.test.js
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { setTimeout as pause } from 'node:timers/promises'
import test from 'node:test'

const live = process.env.LAYERFS_CONNECT_LIVE_SESSIONS === '1' && process.env.LAYERFS_CONNECT_CLI && process.env.LAYERFS_CONNECT_DAEMON
const CLIENT = pathToFileURL(fileURLToPath(new URL('../runs/scope-client.js', import.meta.url))).href

const text = (value) => typeof value === 'string' ? value : (value ?? []).filter((part) => part.type === 'text').map((part) => part.text).join('\n')

/** A streaming chat-completions model: each user prompt maps to its bash commands, then a final answer. */
function scriptedModel(script) {
  const server = createServer(async (req, res) => {
    let raw = ''
    for await (const part of req) raw += part
    const request = JSON.parse(raw)
    const prompt = text(request.messages.findLast((m) => m.role === 'user')?.content)
    const afterUser = request.messages.slice(request.messages.findLastIndex((m) => m.role === 'user') + 1)
    const done = afterUser.filter((m) => m.role === 'tool').length
    const commands = Object.entries(script).find(([key]) => prompt.includes(key))?.[1] ?? []
    const id = randomUUID()
    const chunk = (delta, finish_reason = null) => `data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: 1, model: request.model, choices: [{ index: 0, delta, finish_reason }] })}\n\n`
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    if (done < commands.length) {
      res.write(chunk({ role: 'assistant', tool_calls: [{ index: 0, id: `call_${id.slice(0, 8)}`, type: 'function', function: { name: 'bash', arguments: JSON.stringify({ command: commands[done] }) } }] }))
      res.end(`${chunk({}, 'tool_calls')}data: [DONE]\n\n`)
    } else res.end(`${chunk({ role: 'assistant', content: `Done: ${prompt.slice(0, 40)}` })}${chunk({}, 'stop')}data: [DONE]\n\n`)
  })
  return server
}

test('live: project-owned conversations, operations and reconstruction', { skip: !live && 'set LAYERFS_CONNECT_LIVE_SESSIONS=1 with pinned LAYERFS_CONNECT_CLI and LAYERFS_CONNECT_DAEMON' }, async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'lfc-sessions-live-'))
  const cli = process.env.LAYERFS_CONNECT_CLI
  const home = join(root, 'home')
  mkdirSync(home, { mode: 0o700 })
  const { client } = await import('../cli/calls.js')
  const lfs = client({ cli, home })
  const { AgentManager } = await import('../agents/index.js')
  const { AgentWorkspaces } = await import('../agents/workspaces.js')
  const { agentRoute } = await import('../agents/routes.js')
  const managers = []
  let model
  t.after(async () => {
    for (const m of managers) await m.close().catch(() => {})
    model?.closeAllConnections()
    await new Promise((r) => model ? model.close(r) : r())
    // owned disposable resources: this test's Sandboxes and home only
    try {
      for (const s of (await lfs.sandbox.list('live/p')).items ?? []) await lfs.sandbox.close(s.name, { force: true }).catch(() => {})
    } catch { /* already gone */ }
    if (process.env.LAYERFS_CONNECT_LIVE_KEEP !== '1') rmSync(root, { recursive: true, force: true })
    else console.log(`kept ${root}`)
  })
  await lfs.machine.update('native', { daemon: process.env.LAYERFS_CONNECT_DAEMON })
  await lfs.store.create('live')
  const src = join(root, 'src')
  mkdirSync(src)
  writeFileSync(join(src, 'README.md'), 'project\n')
  await lfs.project.init('live/p', src)
  const P = 'live/p'

  const sdk = join(root, 'sdk.mjs')
  writeFileSync(sdk, `import lfs from ${JSON.stringify(CLIENT)}
const P = process.env.LAYERFS_CONNECT_PROJECT
await lfs.branch.fork(P, 'sdk-a', 'main')
await lfs.file.write(P, 'sdk-a', '/a.txt', 'one\\n')
await lfs.file.write(P, 'sdk-a', '/a.txt', 'one\\n')
await lfs.file.read(P, 'sdk-a', '/a.txt')
await lfs.file.apply(P, 'sdk-a', [{ op: 'write', path: '/b.txt', content: 'b' }, { op: 'mkdir', path: '/d' }, { op: 'write', path: '/d/c.txt', content: 'c' }])
const head = (await lfs.branch.get(P, 'sdk-a')).head
await lfs.branch.fork(P, 'sdk-b', 'sdk-a', head)
await lfs.file.write(P, 'sdk-b', '/e.txt', 'e')
await lfs.branch.fork(P, 'sdk-c', 'main')
await lfs.file.write(P, 'sdk-c', '/f.txt', 'f')
await lfs.branch.merge(P, 'sdk-m', 'sdk-b', 'sdk-c')
await lfs.branch.publish(P, 'sdk-m')
console.log('wrote everything, failing now')
process.exit(1)
`)
  model = scriptedModel({
    'write one': ['printf one > one.txt && cat one.txt'],
    'same again': ['printf one > one.txt'],
    // SDK and CLI calls made by a command inside the native mounted Sandbox (script kept outside the Workspace)
    'sdk in mount': [`printf '%s\\n' "import lfs from 'layerfs'" "const P = process.env.LAYERFS_CONNECT_PROJECT" "await lfs.branch.fork(P, 'mount-sdk', 'main')" "await lfs.file.write(P, 'mount-sdk', '/m.txt', 'm')" > ${JSON.stringify(join(root, 'mount-sdk.mjs'))} && node ${JSON.stringify(join(root, 'mount-sdk.mjs'))} && layerfs branch get "$LAYERFS_CONNECT_PROJECT" mount-sdk > /dev/null`],
    'use the sdk': [`node ${JSON.stringify(sdk)}`, `printf cli | layerfs file write ${P} sdk-a /cli.txt`, 'layerfs branch list live/p > /dev/null'],
  })
  await new Promise((r) => model.listen(0, '127.0.0.1', r))
  const port = model.address().port

  const projects = { lfs, record: async (key) => ({ project: key, kind: 'sqlite', machine: 'native' }) }
  const open = async (state) => {
    const m = await AgentManager.create({ state, defaultCwd: root, projectEnvironment: async () => ({}), shellEnv: (key) => ({ LAYERFS_HOME: home, LAYERFS_CONNECT_CLI: cli, LAYERFS_CONNECT_PROJECT: key }), projectWorkspaces: new AgentWorkspaces({ projects }) })
    await m.models.configure({ provider: 'live-fixture', modelId: 'scripted', api: 'openai-completions', baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: 'local-fixture-key' })
    managers.push(m)
    return m
  }
  const settle = async (m, id) => {
    for (let i = 0; i < 1200; i++) {
      const s = m.detail(id)
      if (s.state !== 'running') return s
      await pause(50)
    }
    throw new Error('did not settle')
  }
  const stateA = join(root, 'connect-a')
  let a = await open(stateA)

  // 1. a new project chat is mounted by default; its first boundary is the branch's base Layer
  const chat = await a.create({ project: P, permissionMode: 'full' })
  assert.equal(a.record(chat.id).runs, 'mount')
  await a.message(chat.id, { text: 'write one' })
  let s = await settle(a, chat.id)
  assert.equal(s.state, 'idle', s.error)
  await a.message(chat.id, { text: 'same again' })
  s = await settle(a, chat.id)
  assert.equal(s.state, 'idle', s.error)
  const ops = a.operations(chat.id, { limit: 1000 }).items
  const by = (method, cause) => ops.filter((o) => o.method === method && (!cause || o.cause === cause))
  assert.deepEqual(by('branch.fork')[0].checkpoints.map((l) => [l.effect, l.ref.version_kind, l.ref.branch_id]), [['referenced', 'Layer', `chat-${chat.id}`]])
  const boundaries = by('workspace.commit', 'session_boundary')
  assert.equal(boundaries.length, 2)
  assert.deepEqual(boundaries[0].checkpoints.map((l) => [l.effect, l.ref.version_kind]), [['unchanged', 'Layer']])
  const toolSaves = by('workspace.commit', 'tool')
  assert.deepEqual(toolSaves.map((o) => o.checkpoints.map((l) => `${l.effect}:${l.ref.version_kind}`)), [['created:Commit'], ['unchanged:Commit']])
  assert.equal(toolSaves[0].checkpoints[0].ref.commit_id, toolSaves[1].checkpoints[0].ref.commit_id, 'an unchanged save references the existing Commit')
  assert.equal(boundaries[1].checkpoints[0].ref.commit_id, toolSaves[0].checkpoints[0].ref.commit_id)
  for (const o of [...toolSaves, ...by('workspace.exec')]) assert.ok(o.tool_call_id && o.agent_id === 'root' && o.entry_id, `${o.method} keeps its tool, agent and entry`)
  const toolMessage = s.messages.find((m) => m.role === 'tool' && m.operations)
  assert.deepEqual([toolMessage.operations.count, toolMessage.operations.links], [2, 1])
  // the boundary binding lives in Pi's entry with its typed reference
  const record = a.record(chat.id)
  const pi = readFileSync(record.sessionFile, 'utf8').split('\n').filter(Boolean).map(JSON.parse)
  const marks = pi.filter((e) => e.customType === 'connect.user-checkpoint')
  assert.equal(marks[1].data.checkpoint.workspace_ref.commit_id, toolSaves[0].checkpoints[0].ref.commit_id)

  // 1b. a command in the native mounted Sandbox uses Connect's pinned CLI and package: its calls are the tool's operations
  await a.message(chat.id, { text: 'sdk in mount' })
  s = await settle(a, chat.id)
  assert.equal(s.state, 'idle', s.error)
  const inMount = a.operations(chat.id, { limit: 1000 }).items.filter((o) => o.origin === 'sdk' || o.origin === 'cli')
  assert.deepEqual(inMount.map((o) => [o.origin, o.method, o.checkpoints.map((l) => `${l.effect}:${l.ref.version_kind}`).join()]), [['sdk', 'branch.fork', 'referenced:Layer'], ['sdk', 'file.write', 'created:Commit'], ['cli', 'branch.get', '']])
  const mountExec = a.operations(chat.id, { method: 'workspace.exec', limit: 10 }).items.at(-1)
  assert.ok(inMount.every((o) => o.tool_call_id === mountExec.tool_call_id && o.agent_id === 'root'), 'in-Sandbox calls belong to the tool that ran them')
  assert.deepEqual(a.operations(chat.id, { limit: 1 }).coverage.gaps.filter((g) => g.scope === 'sandbox-sdk'), [], 'a native Sandbox has no instrumentation gap')
  assert.equal((await lfs.branch.commits(P, `chat-${chat.id}`, { page_size: 50 })).items.length, 1, 'the script outside the Workspace added no Workspace changes')

  // 2. saved to the project's session branch
  const saved = await a.persistence(chat.id, 'save')
  assert.equal(saved.state, 'saved', JSON.stringify(saved))
  const branch = await lfs.branch.get(P, `connect.session.${chat.id}`)
  assert.ok(branch.head)

  // 3. SDK + CLI operations in a folder chat; the script fails after its saved writes
  const folder = await a.create({ project: P, runs: 'folder', permissionMode: 'full', cwd: root })
  await a.message(folder.id, { text: 'use the sdk' })
  const fs = await settle(a, folder.id)
  assert.equal(fs.state, 'idle', fs.error)
  await a.persistence(folder.id, 'save')
  const fops = a.operations(folder.id, { limit: 1000 }).items
  const sdkOps = fops.filter((o) => o.origin === 'sdk')
  assert.deepEqual(sdkOps.map((o) => o.method), ['branch.fork', 'file.write', 'file.write', 'file.read', 'file.apply', 'branch.get', 'branch.fork', 'file.write', 'branch.fork', 'file.write', 'branch.merge', 'branch.publish'])
  assert.deepEqual(sdkOps.map((o) => o.checkpoints.map((l) => `${l.effect}:${l.ref.version_kind}`).join(',')), ['referenced:Layer', 'created:Commit', 'unchanged:Commit', '', 'created:Commit', '', 'referenced:Commit', 'created:Commit', 'referenced:Layer', 'created:Commit', 'created:Commit', 'published:Layer'])
  const merge = sdkOps.find((o) => o.method === 'branch.merge')
  assert.equal(merge.inputs.length, 2, 'merge sources resolved through branch.get_commit')
  assert.ok(merge.inputs.every((r) => r.version_kind === 'Commit'))
  const publish = sdkOps.find((o) => o.method === 'branch.publish')
  assert.deepEqual([publish.inputs[0].branch_id, publish.inputs[0].version_kind, publish.checkpoints[0].ref.branch_id], ['sdk-m', 'Commit', 'main'])
  const cliOps = fops.filter((o) => o.origin === 'cli')
  assert.deepEqual(cliOps.map((o) => [o.method, o.checkpoints.length]), [['file.write', 1], ['branch.list', 0]])
  assert.equal(new Set(fops.map((o) => o.operation_id)).size, fops.length, 'no operation is counted twice')
  const toolCalls = new Set(sdkOps.map((o) => o.tool_call_id))
  assert.equal(toolCalls.size, 1)
  const failedTool = a.detail(folder.id).messages.find((m) => m.role === 'tool' && m.operations?.count === 12)
  assert.ok(failedTool, 'the failed tool keeps its twelve operations')

  // 4. History lookups: the published Layer's producer and the merge Commit's referencing operations
  const links = a.versionLinks(P, publish.checkpoints[0].ref.commit_id)
  assert.deepEqual(links.producers.map((r) => [r.operation_id, r.effect]), [[publish.operation_id, 'published']])

  // 5. restore before the second message: a new code branch forked from that boundary's saved reference
  const users = a.detail(chat.id).messages.filter((m) => m.role === 'user')
  await agentRoute(a, 'POST', ['sessions', chat.id, 'rollback'], { entryId: users[1].entryId })
  const restoreFork = a.operations(chat.id, { method: 'branch.fork', limit: 10 }).items.at(-1)
  assert.equal(restoreFork.cause, 'session_boundary')
  assert.deepEqual(restoreFork.inputs.map((r) => r.commit_id), [boundaries[1].checkpoints[0].ref.commit_id])
  assert.equal(restoreFork.execution_context.restore.entry_id, users[1].entryId)

  // 6. copy: inherited operations keep the source's identities
  const copied = await a.fork(chat.id, {})
  const copyOps = a.operations(copied.session.id, { limit: 1000 })
  assert.ok(copyOps.items.some((o) => o.inherited_from === chat.id && o.session_id === chat.id))
  await a.persistence(chat.id, 'save')

  // 7. restart: the durable journal, its operations and save state survive
  const running = a.operations(chat.id, { limit: 1000 }).items.map((o) => [o.operation_id, o.status])
  await a.close()
  a = await open(stateA)
  const reopened = a.operations(chat.id, { limit: 1000 }).items
  assert.deepEqual(reopened.slice(0, running.length).map((o) => [o.operation_id, o.status]), running)
  // closing released the Workspace: its own lifecycle save, unmount and Sandbox close, each recorded
  assert.deepEqual(reopened.slice(running.length).map((o) => [o.method, o.cause, o.status]), [['workspace.commit', 'lifecycle', 'succeeded'], ['workspace.unmount', 'lifecycle', 'succeeded'], ['sandbox.close', 'lifecycle', 'succeeded']])
  { const st = await a.persistence(chat.id); assert.equal(st.state, 'saved', JSON.stringify(st)) }
  const before = reopened.map((o) => [o.operation_id, o.status])

  // 8. a fresh Connect home with no local chat state rebuilds it from the project alone
  const b = await open(join(root, 'connect-b'))
  const found = await b.portableSessions(P)
  assert.ok(found.some((f) => f.session_id === chat.id && f.valid && !f.local))
  const imported = await b.importSession({ project: P, sessionId: chat.id })
  assert.deepEqual(imported.missingArtifacts, [])
  assert.deepEqual(b.operations(chat.id, { limit: 1000 }).items.map((o) => [o.operation_id, o.status]), before)
  assert.equal(readFileSync(b.record(chat.id).sessionFile, 'utf8'), readFileSync(a.record(chat.id).sessionFile, 'utf8'))
  assert.deepEqual(b.detail(chat.id).messages.filter((m) => m.role === 'user').map((m) => m.entryId), a.detail(chat.id).messages.filter((m) => m.role === 'user').map((m) => m.entryId))
  // a different project name needs an explicit binding; identical names elsewhere are not joined
  await assert.rejects(b.importSession({ project: P, sessionId: chat.id }), /already/)
  console.log(JSON.stringify({ root, chat: chat.id, folder: folder.id, operations: before.length, folderOperations: fops.length }))
})

// Store movement: a pushed Store keeps its session branches and saved refs; a
// fresh Connect home rebuilds the conversation reading through the target machine.
//   ... LAYERFS_CONNECT_LIVE_DOCKER=1 (needs Docker and LAYERFS_BUNDLE for the built-in docker machine)
test('live: a Store pushed to another machine rebuilds the conversation with unchanged references', { skip: (!live || process.env.LAYERFS_CONNECT_LIVE_DOCKER !== '1') && 'set LAYERFS_CONNECT_LIVE_DOCKER=1 with Docker and LAYERFS_BUNDLE' }, async (t) => {
  const { execFileSync } = await import('node:child_process')
  const root = mkdtempSync(join(tmpdir(), 'lfc-sessions-move-'))
  const cli = process.env.LAYERFS_CONNECT_CLI
  const home = join(root, 'home')
  mkdirSync(home, { mode: 0o700 })
  const { client } = await import('../cli/calls.js')
  const { AgentManager } = await import('../agents/index.js')
  const { AgentWorkspaces } = await import('../agents/workspaces.js')
  const lfs = client({ cli, home })
  const containers = () => new Set(execFileSync('docker', ['ps', '-a', '--format', '{{.Names}}'], { encoding: 'utf8' }).split('\n').filter(Boolean))
  const before = containers()
  const managers = []
  const model = scriptedModel({ 'write one': ['printf one > one.txt'] })
  await new Promise((r) => model.listen(0, '127.0.0.1', r))
  t.after(async () => {
    for (const m of managers) await m.close().catch(() => {})
    model.closeAllConnections()
    await new Promise((r) => model.close(r))
    await lfs.machine.stop('docker').catch(() => {})
    // only the container this test's home started
    for (const name of containers()) if (!before.has(name) && /^lfs-[0-9a-f]+-docker$/.test(name)) execFileSync('docker', ['rm', '-f', name])
    rmSync(root, { recursive: true, force: true })
  })
  const open = async (state) => {
    const projects = { lfs, record: async (key) => ({ project: key, kind: 'sqlite', machine: 'native' }) }
    const m = await AgentManager.create({ state, defaultCwd: root, projectEnvironment: async () => ({}), shellEnv: (key) => ({ LAYERFS_HOME: home, LAYERFS_CONNECT_CLI: cli, LAYERFS_CONNECT_PROJECT: key }), projectWorkspaces: new AgentWorkspaces({ projects }) })
    await m.models.configure({ provider: 'live-fixture', modelId: 'scripted', api: 'openai-completions', baseUrl: `http://127.0.0.1:${model.address().port}/v1`, apiKey: 'local-fixture-key' })
    managers.push(m)
    return m
  }
  await lfs.machine.update('native', { daemon: process.env.LAYERFS_CONNECT_DAEMON })
  await lfs.store.create('mv')
  mkdirSync(join(root, 'src'))
  writeFileSync(join(root, 'src', 'README.md'), 'move\n')
  await lfs.project.init('mv/p', join(root, 'src'))
  const a = await open(join(root, 'connect-a'))
  const chat = await a.create({ project: 'mv/p', permissionMode: 'full' })
  await a.message(chat.id, { text: 'write one' })
  for (let i = 0; i < 600 && a.detail(chat.id).state === 'running'; i++) await pause(50)
  await a.close()
  assert.equal(a.sessions.status(a.record(chat.id)).state, 'saved')
  const ops = a.operations(chat.id, { limit: 1000 }).items.map((o) => [o.operation_id, o.status, o.checkpoints.map((l) => l.ref)])
  const piA = readFileSync(a.record(chat.id).sessionFile, 'utf8')

  await lfs.machine.start('docker')
  const moved = await lfs.store.push('mv', 'docker')
  assert.equal(moved.to, 'docker')
  assert.equal((await lfs.store.get('mv')).machine, 'docker')
  const b = await open(join(root, 'connect-b'))
  const rebuilt = await b.importSession({ project: 'mv/p', sessionId: chat.id })
  assert.deepEqual(rebuilt.missingArtifacts, [])
  assert.deepEqual(b.operations(chat.id, { limit: 1000 }).items.map((o) => [o.operation_id, o.status, o.checkpoints.map((l) => l.ref)]), ops, 'references are unchanged by the move')
  assert.equal(readFileSync(b.record(chat.id).sessionFile, 'utf8'), piA)
  const last = ops.flatMap((o) => o[2]).filter((r) => r.version_kind === 'Commit').at(-1)
  assert.equal((await lfs.branch.get_commit('mv/p', last.branch_id, last.commit_id)).ref.id, last.commit_id, 'the moved Store admits the saved version')
  console.log(JSON.stringify({ root, chat: chat.id, moved }))
})

// A project chat whose Sandbox is a container runs its bash on this host, as the
// simulations' CLI scripts do, and drives its Workspace with the recorded CLI.
test('live: a Docker-Sandbox chat runs bash on the host; its layerfs CLI calls and the save are recorded', { skip: (!live || process.env.LAYERFS_CONNECT_LIVE_DOCKER !== '1') && 'set LAYERFS_CONNECT_LIVE_DOCKER=1 with Docker and LAYERFS_BUNDLE' }, async (t) => {
  const { execFileSync } = await import('node:child_process')
  const root = mkdtempSync(join(tmpdir(), 'lfc-sessions-hostshell-'))
  const cli = process.env.LAYERFS_CONNECT_CLI
  const home = join(root, 'home')
  mkdirSync(home, { mode: 0o700 })
  const { client } = await import('../cli/calls.js')
  const { AgentManager } = await import('../agents/index.js')
  const { AgentWorkspaces } = await import('../agents/workspaces.js')
  const lfs = client({ cli, home })
  const containers = () => new Set(execFileSync('docker', ['ps', '-a', '--format', '{{.Names}}'], { encoding: 'utf8' }).split('\n').filter(Boolean))
  const before = containers()
  const model = scriptedModel({
    'edit in docker': [`pwd > /dev/null && layerfs workspace exec "$LAYERFS_CONNECT_WS" 'printf docker > d.txt && uname -s' --stream && layerfs file read "$LAYERFS_CONNECT_PROJECT" "$LAYERFS_CONNECT_BRANCH" /README.md > /dev/null`],
  })
  await new Promise((r) => model.listen(0, '127.0.0.1', r))
  let m
  t.after(async () => {
    await m?.close().catch(() => {})
    model.closeAllConnections()
    await new Promise((r) => model.close(r))
    await lfs.machine.stop('docker').catch(() => {})
    for (const name of containers()) if (!before.has(name) && /^lfs-[0-9a-f]+-/.test(name)) execFileSync('docker', ['rm', '-f', name])
    rmSync(root, { recursive: true, force: true })
  })
  await lfs.machine.update('native', { daemon: process.env.LAYERFS_CONNECT_DAEMON })
  await lfs.store.create('hs')
  mkdirSync(join(root, 'src'))
  writeFileSync(join(root, 'src', 'README.md'), 'host shell\n')
  await lfs.project.init('hs/p', join(root, 'src'))
  await lfs.machine.start('docker')
  await lfs.store.push('hs', 'docker')
  const projects = { lfs, record: async (key) => ({ project: key, kind: 'sqlite', machine: 'docker' }) }
  m = await AgentManager.create({ state: join(root, 'connect'), defaultCwd: root, projectEnvironment: async () => ({}), shellEnv: (key) => ({ LAYERFS_HOME: home, LAYERFS_CONNECT_CLI: cli, LAYERFS_CONNECT_PROJECT: key }), projectWorkspaces: new AgentWorkspaces({ projects }) })
  await m.models.configure({ provider: 'live-fixture', modelId: 'scripted', api: 'openai-completions', baseUrl: `http://127.0.0.1:${model.address().port}/v1`, apiKey: 'local-fixture-key' })
  const chat = await m.create({ project: 'hs/p', permissionMode: 'full' })
  await m.message(chat.id, { text: 'edit in docker' })
  let s
  for (let i = 0; i < 1200 && (s = m.detail(chat.id)).state === 'running'; i++) await pause(50)
  assert.equal(s.state, 'idle', s.error)
  assert.notEqual(m.record(chat.id).workspace.runtime, 'native')
  const tool = s.messages.find((x) => x.role === 'tool')
  assert.match(tool.text, /Linux/, 'the command reached the Workspace in the Linux Sandbox')
  const ops = m.operations(chat.id, { limit: 1000 })
  const mine = ops.items.filter((o) => o.tool_call_id === tool.id)
  assert.deepEqual(mine.map((o) => [o.origin, o.method]), [['cli', 'workspace.exec'], ['cli', 'file.read'], ['host', 'workspace.commit']])
  assert.deepEqual(mine.at(-1).checkpoints.map((l) => `${l.effect}:${l.ref.version_kind}`), ['created:Commit'], 'the save captured the change made through the CLI')
  assert.deepEqual(ops.coverage.gaps.filter((g) => g.scope === 'sandbox-sdk'), [])
  assert.equal((await lfs.file.read('hs/p', `chat-${chat.id}`, '/d.txt')).text, 'docker')
  console.log(JSON.stringify({ root, chat: chat.id, runtime: m.record(chat.id).workspace.runtime }))
})

// A full Store backup carries the project's session branches; a fresh LayerFS
// home restores it and a fresh Connect home rebuilds the conversation. Under a
// different Store name the rebuild needs an explicit origin binding.
//   ... LAYERFS_CONNECT_LIVE_BUCKET_URL=http://127.0.0.1:<port>/<bucket>/<prefix> LAYERFS_BUCKET_LIVEBK_ACCESS_KEY=… LAYERFS_BUCKET_LIVEBK_SECRET_KEY=…
test('live: backup and restore into another home rebuilds the conversation; a renamed Store needs a binding', { skip: (!live || !process.env.LAYERFS_CONNECT_LIVE_BUCKET_URL) && 'set LAYERFS_CONNECT_LIVE_BUCKET_URL and its LAYERFS_BUCKET_LIVEBK_* keys' }, async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'lfc-sessions-backup-'))
  const cli = process.env.LAYERFS_CONNECT_CLI
  const { client } = await import('../cli/calls.js')
  const { AgentManager } = await import('../agents/index.js')
  const { AgentWorkspaces } = await import('../agents/workspaces.js')
  const homes = { a: join(root, 'home-a'), b: join(root, 'home-b') }
  for (const h of Object.values(homes)) mkdirSync(h, { mode: 0o700 })
  const lfsA = client({ cli, home: homes.a }), lfsB = client({ cli, home: homes.b })
  const managers = []
  const model = scriptedModel({ 'write one': ['printf one > one.txt'] })
  await new Promise((r) => model.listen(0, '127.0.0.1', r))
  t.after(async () => {
    for (const m of managers) await m.close().catch(() => {})
    model.closeAllConnections()
    await new Promise((r) => model.close(r))
    for (const l of [lfsA, lfsB]) await l.backup.disconnect('livebk').catch(() => {})
    if (process.env.LAYERFS_CONNECT_LIVE_KEEP !== '1') rmSync(root, { recursive: true, force: true })
    else console.log(`kept ${root}`)
  })
  const open = async (state, lfs, home) => {
    const projects = { lfs, record: async (key) => ({ project: key, kind: 'sqlite', machine: 'native' }) }
    const m = await AgentManager.create({ state, defaultCwd: root, projectEnvironment: async () => ({}), shellEnv: (key) => ({ LAYERFS_HOME: home, LAYERFS_CONNECT_CLI: cli, LAYERFS_CONNECT_PROJECT: key }), projectWorkspaces: new AgentWorkspaces({ projects }) })
    await m.models.configure({ provider: 'live-fixture', modelId: 'scripted', api: 'openai-completions', baseUrl: `http://127.0.0.1:${model.address().port}/v1`, apiKey: 'local-fixture-key' })
    managers.push(m)
    return m
  }
  for (const l of [lfsA, lfsB]) {
    await l.machine.update('native', { daemon: process.env.LAYERFS_CONNECT_DAEMON })
    await l.backup.connect('livebk', process.env.LAYERFS_CONNECT_LIVE_BUCKET_URL, { key: 'env:LAYERFS_BUCKET_LIVEBK' })
  }
  await lfsA.store.create('bk')
  mkdirSync(join(root, 'src'))
  writeFileSync(join(root, 'src', 'README.md'), 'backup\n')
  await lfsA.project.init('bk/p', join(root, 'src'))
  const a = await open(join(root, 'connect-a'), lfsA, homes.a)
  const chat = await a.create({ project: 'bk/p', permissionMode: 'full' })
  await a.message(chat.id, { text: 'write one' })
  for (let i = 0; i < 600 && a.detail(chat.id).state === 'running'; i++) await pause(50)
  assert.equal((await a.persistence(chat.id, 'save')).state, 'saved')
  // closing saves, unmounts and closes the Sandbox, then drains the journal to the project
  await a.close()
  const ops = a.operations(chat.id, { limit: 1000 }).items.map((o) => [o.operation_id, o.status, o.checkpoints.map((l) => l.ref.commit_id)])
  assert.equal(a.sessions.status(a.record(chat.id)).state, 'saved')
  const piA = readFileSync(a.record(chat.id).sessionFile, 'utf8')
  const backup = await lfsA.backup.create('bk', 'livebk', `run-${chat.id.slice(0, 8)}`)
  assert.ok(backup.bytes > 0)

  // another LayerFS home and another Connect home: no local state of the conversation
  const restored = await lfsB.backup.restore('bk', 'livebk', `run-${chat.id.slice(0, 8)}`)
  assert.deepEqual(restored.projects, ['p'])
  const b = await open(join(root, 'connect-b'), lfsB, homes.b)
  const rebuilt = await b.importSession({ project: 'bk/p', sessionId: chat.id })
  assert.deepEqual(rebuilt.missingArtifacts, [])
  assert.deepEqual(b.operations(chat.id, { limit: 1000 }).items.map((o) => [o.operation_id, o.status, o.checkpoints.map((l) => l.ref.commit_id)]), ops)
  assert.equal(readFileSync(b.record(chat.id).sessionFile, 'utf8'), piA)
  // the saved code version a boundary names exists in the restored Store
  const head = ops.flatMap((o) => o[2]).at(-1)
  assert.equal((await lfsB.branch.get_commit('bk/p', `chat-${chat.id}`, head)).ref.id, head)

  // the same backup under another Store name: no implicit join by identical session id or project name
  await lfsB.backup.restore('moved', 'livebk', `run-${chat.id.slice(0, 8)}`)
  const c = await open(join(root, 'connect-c'), lfsB, homes.b)
  await assert.rejects(c.importSession({ project: 'moved/p', sessionId: chat.id }), (e) => e.code === 'BindingRequired')
  const bound = await c.importSession({ project: 'moved/p', sessionId: chat.id, binding: { from: 'bk/p', to: 'moved/p' } })
  assert.deepEqual(bound.binding, { from: 'bk/p', to: 'moved/p' })
  // references keep their origin identities; lookups under the new name go through the binding
  const ref = c.operations(chat.id, { linked: '1', limit: 1000 }).items.at(-1).checkpoints[0].ref
  assert.deepEqual([ref.store_id, ref.project_id], ['bk', 'p'])
  const links = c.versionLinks('moved/p', ref.commit_id)
  assert.ok([...links.producers, ...links.references].every((r) => r.bound_from === 'bk/p') && links.producers.length + links.references.length > 0)
  // saved under the new name, the binding travels in the manifest: a later import there reuses it
  // another installation saved it: an explicit takeover makes this home its owner, then it saves
  await assert.rejects(c.persistence(chat.id, 'save'), (e) => e.code === 'SessionOwnership')
  assert.equal((await c.persistence(chat.id, 'adopt')).state, 'saved')
  const d = await open(join(root, 'connect-d'), lfsB, homes.b)
  const again = await d.importSession({ project: 'moved/p', sessionId: chat.id })
  assert.deepEqual(again.binding, { from: 'bk/p', to: 'moved/p' })
  assert.ok(d.versionLinks('moved/p', ref.commit_id).producers.length + d.versionLinks('moved/p', ref.commit_id).references.length > 0)
  console.log(JSON.stringify({ root, chat: chat.id, backup: { bytes: backup.bytes, sha256: backup.sha256 } }))
})
