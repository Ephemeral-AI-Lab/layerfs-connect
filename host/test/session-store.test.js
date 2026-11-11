// Project-owned conversation journals (host/sessions/*): operation receipts,
// typed saved-version links, the local write-ahead journal, session-branch
// saves with lost-reply reconciliation, and reconstruction on a fresh index.
//   node --test host/test/session-store.test.js
import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { CANONICAL, normalize } from '../sessions/operations.js'
import { MAX_LINE, SessionJournal, fold } from '../sessions/journal.js'
import { OperationRecorder, OPERATION_ENV, OPS_ENV, CONTEXT_ENV, recorderFromEnv } from '../sessions/recorder.js'
import { SessionStore, discoverSessions, loadSession, reconstructSession, sessionBranch, writeNativeFiles } from '../sessions/store.js'
import { fakeLayerfs } from './support/fake-session-lfs.js'
import { ConversationSessions, toolOperations } from '../sessions/index.js'

const P = 'probe/p'
// Receipt shapes recorded from the pinned CLI (58c548b) in a disposable home.
const LAYER0 = '32c555f3642f6367df219b55560ed11755a9ec7bb5b6c690123cc6d6af375f2ffc'
const C1 = '124fbb02f3b595a211f6d9016cd57646e1cac90626e18d4a00182cca646b7aff29'
const C2 = '1298c6eab70cad892c8b353ea66aae7ba910dd011d98a88393f60ea204b65e3210'
const C3 = '12dabb2135541e9532f8e15bce79fe04d259e67608270722c34c2f25fa80f54626'
const L1 = '3292ab8bc3061ff01115d7661b99a64ebea3837037d6900d0c6cab7ed97fa046f5'
const ref = (branch, commit, kind) => ({ store_id: 'probe', project_id: 'p', branch_id: branch, commit_id: commit, version_kind: kind })
const tmp = (t) => { const d = mkdtempSync(join(tmpdir(), 'session-store-')); t.after(() => rmSync(d, { recursive: true, force: true })); return d }

function journalRecorder(journal, context) {
  return new OperationRecorder({ origin: 'sdk', context: { session_id: journal.sessionId, ...context }, write: (events) => journal.appendEvents(events), artifact: (b) => journal.artifact(b) })
}

test('only the explicit supported-call table can link versions; reads and exec never do', () => {
  assert.deepEqual(Object.keys(CANONICAL).filter((m) => m.startsWith('file.')).sort(), ['file.apply', 'file.cp', 'file.edit', 'file.mkdir', 'file.mv', 'file.rm', 'file.write'])
  for (const method of ['file.read', 'file.stat', 'workspace.exec', 'workspace.mount', 'sandbox.create', 'project.init', 'branch.get', 'file.write_extra']) {
    const r = normalize({ method, args: { project: P, branch: 'feat' }, value: { kind: 'Committed', branch: 'feat', head: C1 } })
    assert.deepEqual([r.canonical, r.checkpoints], [null, []], method)
  }
})

test('writes: Committed creates; UpToDate references the existing Commit as unchanged; a refusal has none; a lost reply stays unknown', () => {
  const created = normalize({ method: 'file.write', args: { project: P, branch: 'feat', path: '/b.txt' }, value: { kind: 'Committed', branch: 'feat', head: C1, commit: { id: C1 } } })
  assert.deepEqual(created.checkpoints, [{ ref: ref('feat', C1, 'Commit'), effect: 'created' }])
  const same = normalize({ method: 'file.write', args: { project: P, branch: 'feat' }, value: { kind: 'UpToDate', branch: 'feat', head: C1, root: 'r' } })
  assert.deepEqual(same.checkpoints, [{ ref: ref('feat', C1, 'Commit'), effect: 'unchanged' }])
  const refused = normalize({ method: 'file.write', args: { project: P, branch: 'main' }, error: { code: 'ReadOnly', transport: 'refusal' } })
  assert.deepEqual([refused.status, refused.checkpoints, refused.unresolved], ['failed', [], null])
  const lost = normalize({ method: 'file.apply', args: { project: P, branch: 'feat' }, error: { code: 'Unknown', transport: 'transport-unknown' } })
  assert.equal(lost.status, 'unknown')
  assert.deepEqual(lost.checkpoints, [])
  assert.match(lost.unresolved, /reconcile/)
})

test('workspace.commit needs confirmed mount facts; an unchanged empty branch links its base Layer only when confirmed', () => {
  const value = { kind: 'Committed', head: '127b', commit: { id: '127b', branch: null } }
  assert.match(normalize({ method: 'workspace.commit', args: { ws: 'sb:w1' }, value }).unresolved, /mount facts/)
  assert.deepEqual(normalize({ method: 'workspace.commit', args: { ws: 'sb:w1' }, value, mount: { project: P, branch: 'feat' } }).checkpoints, [{ ref: ref('feat', '127b', 'Commit'), effect: 'created' }])
  const empty = { kind: 'UpToDate', head: null, root: 'r' }
  assert.match(normalize({ method: 'workspace.commit', args: { ws: 'sb:w2' }, value: empty, mount: { project: P, branch: 'e2' } }).unresolved, /base Layer/)
  assert.deepEqual(normalize({ method: 'workspace.commit', args: { ws: 'sb:w2' }, value: empty, mount: { project: P, branch: 'e2', base_layer: L1 } }).checkpoints, [{ ref: ref('e2', L1, 'Layer'), effect: 'unchanged' }])
})

test('fork references its starting Layer or Commit; merge keeps sources and fast-forward reuse; publish links source Commit to main Layer', () => {
  const fromLayer = normalize({ method: 'branch.fork', args: { project: P, name: 'feat', from_branch: 'main' }, value: { kind: 'Forked', branch: 'feat', base: LAYER0, head: null } })
  assert.deepEqual(fromLayer.checkpoints, [{ ref: ref('feat', LAYER0, 'Layer'), effect: 'referenced' }])
  assert.deepEqual(fromLayer.inputs, [ref('main', LAYER0, 'Layer')])
  const fromCommit = normalize({ method: 'branch.fork', args: { project: P, name: 'retry', from_branch: 'feat', from_commit: C1 }, value: { kind: 'Forked', branch: 'retry', base: LAYER0, head: C1 } })
  assert.deepEqual(fromCommit.checkpoints, [{ ref: ref('retry', C1, 'Commit'), effect: 'referenced' }])
  // an id's admitting branch is not from_branch; only a confirmed saved reference names it
  assert.deepEqual(fromCommit.inputs, [])
  const restored = normalize({ method: 'branch.fork', args: { project: P, name: 'chat-r', from_branch: 'main', from_commit: C1 }, value: { kind: 'Forked', branch: 'chat-r', base: LAYER0, head: C1 }, mount: { inputs: [ref('feat', C1, 'Commit'), ref('feat', C2, 'Commit')] } })
  assert.deepEqual(restored.inputs, [ref('feat', C1, 'Commit')])
  const ff = normalize({ method: 'branch.merge', args: { project: P, name: 'm1', a: 'feat', b: 'main' }, value: { kind: 'Merged', fast_forward: true, branch: 'm1', head: C1, sources: [{ ref: 'feat', node: C1 }, { ref: 'main', node: LAYER0 }] } })
  assert.deepEqual(ff.checkpoints, [{ ref: ref('m1', C1, 'Commit'), effect: 'referenced' }])
  assert.deepEqual(ff.inputs, [ref('feat', C1, 'Commit'), ref('main', LAYER0, 'Layer')])
  const merged = normalize({ method: 'branch.merge', args: { project: P, name: 'm2', a: 'feat', b: 'empty' }, value: { kind: 'Merged', fast_forward: false, branch: 'm2', head: C3, sources: [{ ref: 'feat', node: C1 }, { ref: 'empty', node: C2 }] } })
  assert.deepEqual(merged.checkpoints, [{ ref: ref('m2', C3, 'Commit'), effect: 'created' }])
  // a side branch's node is a Commit or its base Layer: resolved later through branch.get_commit, never guessed
  assert.deepEqual(merged.pending.map((p) => [p.branch, p.commit]), [['feat', C1], ['empty', C2]])
  const added = normalize({ method: 'branch.publish', args: { project: P, branch: 'feat' }, value: { kind: 'Added', source: { branch: 'feat', commit: C1 }, published_layer: { id: L1, source_commit: C1 } } })
  assert.deepEqual(added.checkpoints, [{ ref: ref('main', L1, 'Layer'), effect: 'published' }])
  assert.deepEqual(added.inputs, [ref('feat', C1, 'Commit')])
  const again = normalize({ method: 'branch.publish', args: { project: P, branch: 'feat' }, value: { kind: 'UpToDate', layer: L1 } })
  assert.deepEqual(again.checkpoints, [{ ref: ref('main', L1, 'Layer'), effect: 'unchanged' }])
})

test('one SDK tool: twenty calls are twenty operations, file.apply is one, and earlier receipts survive the tool failing', async (t) => {
  const journal = new SessionJournal(tmp(t), 's1')
  const rec = journalRecorder(journal, { agent_id: 'root', tool_call_id: 'call-1', entry_id: 'e1' })
  const answers = {
    'file.read': () => ({ kind: 'ok', text: 'x' }),
    'file.apply': () => ({ kind: 'Committed', branch: 'feat', head: C1 }),
    'file.write': () => ({ kind: 'UpToDate', branch: 'feat', head: C1 }),
  }
  const run = async () => {
    for (let i = 0; i < 18; i++) await rec.record('file.read', { project: P, branch: 'feat', path: `/f${i}` }, answers['file.read'])
    await rec.record('file.apply', { project: P, branch: 'feat', changes: Array.from({ length: 40 }, (_, i) => ({ op: 'write', path: `/g${i}`, content: 'x' })) }, answers['file.apply'])
    await rec.record('file.write', { project: P, branch: 'feat', path: '/g1', content: 'x' }, answers['file.write'])
    throw new Error('script exited 1')
  }
  await assert.rejects(run, /exited 1/)
  // restart: a new journal object reads the same durable log
  const ops = [...new SessionJournal(journal.chatDir, 's1').fold().operations.values()]
  assert.equal(ops.length, 20)
  assert.equal(ops.filter((o) => o.checkpoints.length).length, 2)
  const apply = ops.find((o) => o.method === 'file.apply')
  assert.deepEqual([apply.checkpoints.length, apply.arguments.changes_count, apply.tool_call_id, apply.entry_id], [1, 40, 'call-1', 'e1'])
  assert.ok(apply.arguments_artifact, 'exact typed input is kept as an artifact')
  assert.equal(JSON.parse(journal.readArtifact(apply.arguments_artifact)).changes.length, 40)
  const unchanged = ops.find((o) => o.method === 'file.write')
  assert.deepEqual(unchanged.checkpoints.map((l) => l.effect), ['unchanged'])
})

test('concurrent tools keep their own context; a nested CLI under an owned SDK call is not counted twice', async (t) => {
  const dir = tmp(t)
  const journal = new SessionJournal(dir, 's1')
  const a = journalRecorder(journal, { agent_id: 'root', tool_call_id: 'a' })
  const b = journalRecorder(journal, { agent_id: 'child-x', tool_call_id: 'b' })
  const slow = (ms, v) => () => new Promise((r) => setTimeout(() => r(v), ms))
  await Promise.all([
    a.record('file.write', { project: P, branch: 'x' }, slow(30, { kind: 'Committed', branch: 'x', head: C1 })),
    b.record('file.write', { project: P, branch: 'y' }, slow(5, { kind: 'Committed', branch: 'y', head: C2 })),
  ])
  const ops = [...journal.fold().operations.values()]
  assert.deepEqual(ops.map((o) => [o.agent_id, o.tool_call_id, o.checkpoints[0].ref.branch_id]).sort(), [['child-x', 'b', 'y'], ['root', 'a', 'x']])
  // a process environment names the journal; an owned invocation is not recorded again
  const env = { [OPS_ENV]: join(dir, 'journal', 'ops'), [CONTEXT_ENV]: JSON.stringify({ session_id: 's1', agent_id: 'root', tool_call_id: 'c' }) }
  assert.ok(recorderFromEnv(env, 'cli'))
  assert.equal(recorderFromEnv({ ...env, [OPERATION_ENV]: 'op-outer' }, 'cli'), null)
  await recorderFromEnv(env, 'cli').record('branch.fork', { project: P, name: 'n', from_branch: 'main' }, async () => ({ kind: 'Forked', branch: 'n', base: LAYER0, head: null }))
  const ingested = [...journal.fold().operations.values()].find((o) => o.tool_call_id === 'c')
  assert.deepEqual([ingested.origin, ingested.checkpoints[0].ref.version_kind], ['cli', 'Layer'])
})

test('a workspace.commit observed in a tool process resolves its branch from the confirmed mount receipt in the same journal', async (t) => {
  const journal = new SessionJournal(tmp(t), 's1')
  const rec = journalRecorder(journal, { agent_id: 'root', tool_call_id: 't' })
  await rec.record('sandbox.create', { project: P, name: 'sb', machine: 'native' }, async () => ({ name: 'sb', project: P }))
  await rec.record('workspace.mount', { sandbox: 'sb', branch: 'feat' }, async () => ({ kind: 'Mounted', ws: 'sb:w1', branch: 'feat', base_layer: LAYER0, path: '/x/1', name: 'w1' }))
  await rec.record('workspace.commit', { ws: 'sb:w1' }, async () => ({ kind: 'Committed', head: C1, commit: { id: C1, branch: null } }))
  await rec.record('workspace.commit', { ws: 'sb:w1' }, async () => ({ kind: 'UpToDate', head: C1 }))
  await rec.record('workspace.commit', { ws: 'sb:other' }, async () => ({ kind: 'Committed', head: C2 }))
  const commits = [...journal.fold().operations.values()].filter((o) => o.method === 'workspace.commit')
  assert.deepEqual(commits.map((o) => o.checkpoints.map((l) => `${l.ref.branch_id}:${l.effect}`)), [['feat:created'], ['feat:unchanged'], []])
  assert.match(commits[2].unresolved, /mount facts/)
})

test('journal disk failure: a required boundary intent refuses dispatch; a tool call goes on with an explicit gap', async () => {
  let dispatched = 0
  const failing = new OperationRecorder({ origin: 'host', write: () => { throw new Error('ENOSPC') }, onJournalError: () => { failing.gap = true } })
  await assert.rejects(failing.record('workspace.commit', { ws: 'a:b' }, async () => { dispatched++ }, { required: true }), (e) => e.code === 'JournalUnavailable')
  assert.equal(dispatched, 0)
  await failing.record('file.write', { project: P, branch: 'x' }, async () => { dispatched++ })
  assert.deepEqual([dispatched, failing.gap], [1, true])
})

test('a large event spills to an artifact and folds back; no line exceeds the read window bound', (t) => {
  const journal = new SessionJournal(tmp(t), 's1')
  journal.append('conversation.meta', { meta: { title: 'x'.repeat(MAX_LINE * 2) } })
  for (const line of readFileSync(journal.pendingFile, 'utf8').trimEnd().split('\n')) assert.ok(Buffer.byteLength(line) <= MAX_LINE)
  assert.equal(journal.fold().meta.title.length, MAX_LINE * 2)
})

test('Pi files are captured line by line; a rewrite starts a new generation', (t) => {
  const dir = tmp(t)
  const journal = new SessionJournal(dir, 's1')
  const file = join(dir, 'session.jsonl')
  writeFileSync(file, '{"type":"session","id":"pi-1"}\n{"type":"message","id":"u1","parentId":null}\n{"partial":')
  assert.equal(journal.capturePi(file, 'root'), 2)
  writeFileSync(file, '{"type":"session","id":"pi-1"}\n{"type":"message","id":"u1","parentId":null}\n{"type":"message","id":"a1","parentId":"u1"}\n')
  assert.equal(journal.capturePi(file, 'root'), 1)
  // a clone rewrites the file with a new header (same size here)
  writeFileSync(file, '{"type":"session","id":"pi-2"}\n{"type":"message","id":"u1","parentId":null}\n{"type":"message","id":"a1","parentId":"u1"}\n')
  assert.equal(journal.capturePi(file, 'root'), 3)
  let pi = journal.fold().pi.get('session.jsonl')
  assert.deepEqual([pi.generation, pi.lines.map((l) => l.id)], [1, ['pi-2', 'u1', 'a1']])
  // a same-size change in the middle, with header and last line untouched, is a rewrite too
  writeFileSync(file, '{"type":"session","id":"pi-2"}\n{"type":"message","id":"u9","parentId":null}\n{"type":"message","id":"a1","parentId":"u1"}\n')
  assert.equal(journal.capturePi(file, 'root'), 3)
  pi = journal.fold().pi.get('session.jsonl')
  assert.deepEqual([pi.generation, pi.lines.map((l) => l.id)], [2, ['pi-2', 'u9', 'a1']])
  assert.equal(journal.capturePi(file, 'root'), 0, 'an unchanged file captures nothing')
})

test('session branch: bounded segments, lost publication reply reconciled without replay, restart, ownership conflict', async (t) => {
  const dir = tmp(t)
  const lfs = fakeLayerfs()
  const store = new SessionStore({ lfs, instanceId: 'me' })
  const journal = new SessionJournal(dir, 'sess-1')
  for (let i = 0; i < 1200; i++) journal.append('conversation.meta', { meta: { title: `t${i}` } })
  const status = await store.flush(journal, P)
  assert.deepEqual([status.state, status.saved_through], ['saved', 1200])
  const branch = lfs.branches.get(sessionBranch('sess-1'))
  assert.equal([...branch.files.keys()].filter((p) => p.includes('/segments/')).length, 3)
  // a save that applied and lost its reply
  journal.append('conversation.meta', { meta: { title: 'after' } })
  lfs.faults.push({ call: 'file.apply', kind: 'lose' })
  await assert.rejects(store.flush(journal, P), /complete result/)
  assert.equal(journal.status().state, 'save-unknown')
  // restart between stages: a new journal and store read the durable state
  const reopened = new SessionJournal(dir, 'sess-1')
  const applies = lfs.calls.filter((c) => c[0] === 'file.apply').length
  const after = await new SessionStore({ lfs, instanceId: 'me' }).flush(reopened, P)
  assert.deepEqual([after.state, after.saved_through], ['saved', 1201])
  assert.equal(lfs.calls.filter((c) => c[0] === 'file.apply').length, applies, 'the applied segment was found, not written again')
  // a definite refusal: nothing applied, state failed, a later save writes it once
  reopened.append('conversation.meta', { meta: { title: 'x' } })
  lfs.faults.push({ call: 'file.apply', kind: 'refuse' })
  await assert.rejects(store.flush(reopened, P), /refused/)
  assert.equal(reopened.status().state, 'failed')
  assert.equal((await store.flush(reopened, P)).state, 'saved')
  // another owner wrote the branch: refuse to publish divergent history
  await lfs.file.apply(P, sessionBranch('sess-1'), [{ op: 'write', path: '/.connect/session/manifest.json', content: JSON.stringify({ schema: 'connect.session/1', session_id: 'sess-1', owner: { instance_id: 'other' }, last_seq: 9 }) }], { message: 'foreign' })
  reopened.append('conversation.meta', { meta: { title: 'y' } })
  await assert.rejects(store.flush(reopened, P), (e) => e.code === 'SessionOwnership')
  assert.equal(reopened.status().state, 'conflict')
})

test('a writer between the head check and the save is detected from the receipt parent; takeover is explicit and refuses divergence', async (t) => {
  const dir = tmp(t)
  const lfs = fakeLayerfs()
  const mine = new SessionStore({ lfs, instanceId: 'me' })
  const journal = new SessionJournal(join(dir, 'a'), 'sess-3')
  journal.append('conversation.meta', { meta: { title: 'one' } })
  await mine.flush(journal, P)
  journal.append('conversation.meta', { meta: { title: 'two' } })
  lfs.faults.push({ call: 'file.apply', kind: 'race', parent: 'someone-else' })
  await assert.rejects(mine.flush(journal, P), (e) => e.code === 'SessionOwnership')
  assert.equal(journal.status().state, 'conflict')
  await assert.rejects(mine.adopt(journal, P), (e) => e.code === 'SessionDiverged')
  // another installation imports the saved journal, then takes over explicitly; the first owner is refused
  const other = new SessionStore({ lfs, instanceId: 'host-b' })
  const saved = await loadSession(lfs, P, sessionBranch('sess-3'))
  await reconstructSession(saved, join(dir, 'b'), { store: { project: P, branch: sessionBranch('sess-3'), head: lfs.branches.get(sessionBranch('sess-3')).head } })
  const imported = new SessionJournal(join(dir, 'b'), 'sess-3')
  imported.append('conversation.meta', { meta: { title: 'three' } })
  await assert.rejects(other.flush(imported, P), (e) => e.code === 'SessionOwnership')
  assert.equal((await other.adopt(imported, P)).state, 'local')
  assert.equal((await other.flush(imported, P)).state, 'saved')
  const first = new SessionJournal(join(dir, 'c'), 'sess-3')
  first.state.store = { project: P, branch: sessionBranch('sess-3'), head: 'old' }
  first.state.saved_through = 1
  first.append('conversation.meta', { meta: { title: 'stale' } })
  await assert.rejects(mine.flush(first, P), (e) => e.code === 'SessionOwnership')
  await assert.rejects(mine.adopt(first, P), (e) => e.code === 'SessionDiverged')
})

test('portable reconstruction: discovered, verified and rebuilt on a fresh local folder with native Pi files and artifacts', async (t) => {
  const dir = tmp(t)
  const lfs = fakeLayerfs()
  const journal = new SessionJournal(join(dir, 'a'), 'sess-2')
  const pi = join(dir, 'a', 'pi.jsonl')
  const huge = 'y'.repeat(100 * 1024)
  writeFileSync(pi, `${JSON.stringify({ type: 'session', id: 'pi-2' })}\n${JSON.stringify({ type: 'message', id: 'a1', message: { role: 'assistant', content: huge } })}\n`)
  mkdirSync(join(dir, 'a', 'tool-output'))
  writeFileSync(join(dir, 'a', 'tool-output', `${'a'.repeat(64)}.log`), 'output\u0000bytes')
  journal.capturePi(pi, 'root')
  journal.captureOutputs()
  const rec = journalRecorder(journal, { agent_id: 'root', tool_call_id: 'c1' })
  await rec.record('file.write', { project: P, branch: 'feat' }, async () => ({ kind: 'Committed', branch: 'feat', head: C1 }))
  journal.append('conversation.meta', { meta: { title: 'Portable', project: P } })
  await new SessionStore({ lfs, instanceId: 'me' }).flush(journal, P)
  // another home: discover, load and rebuild with no local state
  const found = await discoverSessions(lfs, P)
  assert.deepEqual(found.map((f) => [f.session_id, f.valid]), [['sess-2', true]])
  const saved = await loadSession(lfs, P, found[0].branch)
  const target = join(dir, 'b')
  const { missing } = await reconstructSession(saved, target, { store: { project: P, branch: found[0].branch } })
  assert.deepEqual(missing, [])
  const rebuilt = new SessionJournal(target, 'sess-2')
  const folded = rebuilt.fold()
  writeNativeFiles(folded, target, (id) => rebuilt.readArtifact(id))
  assert.equal(readFileSync(join(target, 'pi.jsonl'), 'utf8'), readFileSync(pi, 'utf8'))
  assert.equal(readFileSync(join(target, 'tool-output', `${'a'.repeat(64)}.log`), 'utf8'), 'output\u0000bytes')
  assert.equal(folded.meta.title, 'Portable')
  assert.deepEqual([...folded.operations.values()][0].checkpoints[0].ref, ref('feat', C1, 'Commit'))
  assert.equal(rebuilt.status().state, 'saved')
})

test('lost Workspace commit reply: reconciled by its correlation token, never replayed; without evidence it stays unknown', async (t) => {
  const dir = tmp(t)
  const commits = []
  let dispatched = 0
  const lfs = { ...fakeLayerfs(), branch: { ...fakeLayerfs().branch, commits: async () => ({ items: commits }) } }
  const sessions = new ConversationSessions({ dir, state: dir, lfs: () => lfs })
  const record = { id: 'chat-1', project: P, scenario: { id: 'x' } } // a scenario chat is not saved to the project
  mkdirSync(join(dir, 'chat-1'))
  sessions.ensure(record)
  const rec = sessions.recorder('chat-1', { agent_id: 'root', tool_call_id: 't1' })
  const lose = async (id) => { dispatched++; commits.push({ id: C1, message: `[connect-op:${id}] Bash root t1 (exit 0)` }); throw Object.assign(new Error('lost'), { code: 'Unknown', transport: 'transport-unknown' }) }
  const token = (id) => `[connect-op:${id}]`
  const a = 'op-00000000-0000-0000-0000-00000000000a'
  const b = 'op-00000000-0000-0000-0000-00000000000b'
  for (const id of [a, b]) await assert.rejects(rec.record('workspace.commit', { ws: 'sb:w' }, id === a ? lose : async () => { dispatched++; throw Object.assign(new Error('lost'), { code: 'Unknown', transport: 'transport-unknown' }) }, { operationId: id, execution: { correlation_token: token(id), mount: { project: P, branch: 'chat' } } }))
  let ops = sessions.operations(record, {}).items
  assert.deepEqual(ops.map((o) => [o.status, o.checkpoints.length]), [['unknown', 0], ['unknown', 0]])
  const result = await sessions.reconcile(record)
  assert.equal(dispatched, 2, 'reconciliation reads history; it never dispatches again')
  assert.deepEqual(result.operations.map((o) => o.resolved), [true, false])
  // the status answered is the one every view reads (Trace's badge keeps its project facts)
  assert.deepEqual([result.status.portable, result.status.local_only], [false, 'scenario'])
  ops = sessions.operations(record, {}).items
  assert.deepEqual(ops.map((o) => [o.status, o.checkpoints.map((l) => `${l.effect}:${l.ref.branch_id}:${l.ref.commit_id}`)]), [['succeeded', [`created:chat:${C1}`]], ['unknown', []]])
  assert.equal(sessions.operations(record, { linked: '1' }).items.length, 1)
})

test('an unchanged write on a branch without Commits links its base Layer only while the branch still has no head', async (t) => {
  const dir = tmp(t)
  mkdirSync(join(dir, 'w'))
  const heads = { empty: { head: null, base: LAYER0 }, moved: { head: C1, base: LAYER0 } }
  const lfs = { branch: { get: async (_p, b) => heads[b] } }
  const sessions = new ConversationSessions({ dir, state: dir, lfs: () => lfs })
  const record = { id: 'w', project: P }
  sessions.ensure(record)
  const rec = sessions.recorder('w', { agent_id: 'root', tool_call_id: 't' })
  for (const b of ['empty', 'moved']) await rec.record('file.write', { project: P, branch: b, path: '/a' }, async () => ({ kind: 'UpToDate', branch: b, head: null, root: 'r' }))
  await sessions.resolvePendingKinds(record)
  const [empty, moved] = sessions.operations(record, {}).items
  assert.deepEqual(empty.checkpoints, [{ ref: ref('empty', LAYER0, 'Layer'), effect: 'unchanged' }])
  assert.equal(empty.unresolved, null)
  assert.deepEqual(moved.checkpoints, [])
  assert.match(moved.unresolved, /base Layer/)
})

test('a save includes the reconciliation of its merge sources’ kinds: nothing is left pending after it', async (t) => {
  const dir = tmp(t)
  mkdirSync(join(dir, 'm'))
  const base = fakeLayerfs()
  const lfs = { ...base, branch: { ...base.branch, get_commit: async (_p, _b, commit) => ({ ref: { id: commit, kind: 'Commit' } }) } }
  const sessions = new ConversationSessions({ dir, state: dir, lfs: () => lfs })
  const record = { id: 'm', project: P }
  sessions.ensure(record)
  await sessions.recorder('m', { agent_id: 'root', tool_call_id: 't' }).record('branch.merge', { project: P, name: 'm2', a: 'feat', b: 'other' }, async () => ({ kind: 'Merged', fast_forward: false, branch: 'm2', head: C3, sources: [{ ref: 'feat', node: C1 }, { ref: 'other', node: C2 }] }))
  const status = await sessions.flush(record)
  assert.deepEqual([status.state, status.pending], ['saved', 0])
  assert.deepEqual(sessions.operations(record, {}).items[0].inputs, [ref('feat', C1, 'Commit'), ref('other', C2, 'Commit')])
})

test('older local chats are saved to their projects one at a time, scenario and folder-only chats are not', async (t) => {
  const dir = tmp(t)
  const lfs = fakeLayerfs()
  for (const id of ['old-1', 'old-2', 'scen', 'local']) mkdirSync(join(dir, id))
  const sessions = new ConversationSessions({ dir, state: dir, lfs: () => lfs })
  const records = [{ id: 'old-1', project: P, sessionFile: 'x' }, { id: 'old-2', project: P, sessionFile: 'y' }, { id: 'scen', project: P, scenario: {} }, { id: 'local', project: null }]
  for (const r of records) sessions.ensure(r)
  const results = await sessions.migrate(records, { delay: 0, spacing: 0 })
  assert.deepEqual(results.map((r) => [r.id, r.status.state]), [['old-1', 'saved'], ['old-2', 'saved']])
  assert.ok(lfs.branches.has(sessionBranch('old-1')) && lfs.branches.has(sessionBranch('old-2')) && !lfs.branches.has(sessionBranch('scen')))
  assert.deepEqual(await sessions.migrate(records, { delay: 0, spacing: 0 }), [], 'already saved conversations are not queued again')
  // an event recorded after the save (an orphaned intent settled at load) queues it again
  sessions.journal('old-1').append('operation.reconciled', { operation_id: 'op-x', status: 'unknown' })
  assert.deepEqual((await sessions.migrate(records, { delay: 0, spacing: 0 })).map((r) => [r.id, r.status.state, r.status.pending]), [['old-1', 'saved', 0]])
})

test('restart: an intent whose recording process is gone is unknown, not running or succeeded', async (t) => {
  const dir = tmp(t)
  mkdirSync(join(dir, 'c'))
  const journal = new SessionJournal(join(dir, 'c'), 'c')
  journal.append('operation.intent', { operation_id: 'op-dead', operation: { method: 'file.write', arguments: { project: P, branch: 'x' }, execution_context: { pid: 2 ** 22 + 7, recorder: 'gone' } } })
  const sessions = new ConversationSessions({ dir, state: dir })
  sessions.ensure({ id: 'c' })
  const [op] = sessions.operations({ id: 'c' }, {}).items
  assert.deepEqual([op.status, op.checkpoints], ['unknown', []])
  assert.match(op.reconciliation[0].note, /ended before a receipt/)
})

test('a simulation conversation records cli operations locally and still resolves its merge sources’ kinds, without saving or capturing Pi files', async (t) => {
  const dir = tmp(t)
  mkdirSync(join(dir, 'sim'))
  const reads = []
  const lfs = { branch: { get_commit: async (_p, branch, commit) => { reads.push(branch); return { ref: { id: commit, kind: branch === 'empty' ? 'Layer' : 'Commit' } } } }, file: { apply: async () => { throw new Error('a simulation journal is never saved') } } }
  const sessions = new ConversationSessions({ dir, state: dir, lfs: () => lfs })
  const record = { id: 'sim', project: P, simulation: { id: 'run' }, sessionFile: join(dir, 'sim', 'pi.jsonl') }
  writeFileSync(record.sessionFile, '{"type":"session","id":"x"}\n')
  sessions.ensure(record)
  const rec = sessions.recorder('sim', { agent_id: 'root', tool_call_id: 't' }, 'cli')
  await rec.record('branch.merge', { project: P, name: 'm2', a: 'feat', b: 'empty' }, async () => ({ kind: 'Merged', fast_forward: false, branch: 'm2', head: C3, sources: [{ ref: 'feat', node: C1 }, { ref: 'empty', node: C2 }] }))
  const status = await sessions.flush(record)
  assert.deepEqual([status.portable, status.local_only, status.store], [false, 'simulation', null])
  const [op] = sessions.operations(record, {}).items
  assert.equal(op.origin, 'cli')
  assert.deepEqual(op.inputs, [ref('feat', C1, 'Commit'), ref('empty', C2, 'Layer')])
  assert.deepEqual(reads.sort(), ['empty', 'feat'])
  await sessions.flush(record)
  assert.equal(reads.length, 2, 'kinds are read once')
  assert.ok(!sessions.journal('sim').events(false).some((e) => e.type === 'pi.line'), 'the scripted Pi file stays out of the journal')
})

test('a copy inherits operations with their original session identity; the catalog finds producers and references', async (t) => {
  const dir = tmp(t)
  for (const id of ['src', 'dst']) mkdirSync(join(dir, id))
  const sessions = new ConversationSessions({ dir, state: dir })
  sessions.ensure({ id: 'src', project: P })
  const rec = sessions.recorder('src', { agent_id: 'root', tool_call_id: 't' })
  await rec.record('file.write', { project: P, branch: 'feat' }, async () => ({ kind: 'Committed', branch: 'feat', head: C1 }))
  await rec.record('branch.fork', { project: P, name: 'retry', from_branch: 'feat' }, async () => ({ kind: 'Forked', branch: 'retry', base: LAYER0, head: C1 }))
  sessions.ensure({ id: 'dst', project: P })
  sessions.copy('src', 'dst', { entryId: 'e1', position: 'before' })
  const copied = sessions.operations({ id: 'dst', project: P }, {}).items
  assert.deepEqual(copied.map((o) => [o.session_id, o.inherited_from]), [['src', 'src'], ['src', 'src']])
  const links = sessions.versionLinks([{ id: 'src', project: P }, { id: 'dst', project: P }], P, C1)
  // one producer per conversation that holds it; the fork references C1 under two branch contexts
  assert.deepEqual(links.producers.map((r) => [r.session_id, r.method]).sort(), [['dst', 'file.write'], ['src', 'file.write']])
  assert.deepEqual(links.references.filter((r) => r.session_id === 'src').map((r) => [r.method, r.role, r.branch_id]).sort(), [['branch.fork', 'input', 'feat'], ['branch.fork', 'output', 'retry']])
  const summary = toolOperations(copied)
  assert.deepEqual([summary.count, summary.links, summary.created, summary.distinct], [2, 2, 1, 1])
})

test('a fold keeps the first terminal receipt and reports a contradictory duplicate', () => {
  const events = [
    { seq: 1, id: 'i', type: 'operation.intent', operation_id: 'o', operation: { method: 'file.write', arguments: { project: P, branch: 'x' } } },
    { seq: 2, id: 'r1', type: 'operation.receipt', operation_id: 'o', status: 'succeeded', value: { kind: 'Committed', branch: 'x', head: C1 } },
    { seq: 3, id: 'r1', type: 'operation.receipt', operation_id: 'o', status: 'succeeded', value: { kind: 'Committed', branch: 'x', head: C1 } },
    { seq: 4, id: 'r2', type: 'operation.receipt', operation_id: 'o', status: 'failed', error: { code: 'X', transport: 'refusal' } },
  ]
  const f = fold(events)
  assert.equal(f.operations.get('o').status, 'succeeded')
  assert.deepEqual(f.conflicts.map((c) => c.ignored), ['r2'])
})

test('an unwritable ops directory is reported by the process recorder, not silently dropped', async (t) => {
  if (process.getuid?.() === 0) return
  const dir = tmp(t)
  mkdirSync(join(dir, 'ops'))
  chmodSync(join(dir, 'ops'), 0o500)
  const rec = recorderFromEnv({ [OPS_ENV]: join(dir, 'ops'), [CONTEXT_ENV]: '{"session_id":"z"}' }, 'sdk-z')
  const written = []
  const original = process.stderr.write
  process.stderr.write = (s) => { written.push(String(s)); return true }
  try { assert.equal(await rec.record('file.read', {}, async () => 1), 1) } finally { process.stderr.write = original; chmodSync(join(dir, 'ops'), 0o700) }
  assert.match(written.join(''), /journal is unavailable/)
})
