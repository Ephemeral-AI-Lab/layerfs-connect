// The Trace rows (runs/trajectory.js) of a replay and of a live session, from
// made-up records: no LayerFS, no model.
//   node --test host/test/trajectory.test.js
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { piLog, trajectory } from '../runs/trajectory.js'

const T = 1_800_000_000_000
const call = (id, step, method, ok = true, extra = {}) => ({ id, agent: step.split(':')[0], step, method, ok, kind: ok ? 'ok' : null, code: ok ? null : 'NoSuchPath', ms: 3, start: new Date(T).toISOString(), ...extra })
const step = (agent, index, started, extra = {}) => ({ agent, index, state: 'ok', started, ended: started + 100, exitCode: 0, stdout: 'out', stderr: '', calls: [], checks: [], ...extra })
const kinds = (t) => t.records.map((r) => r.kind)

const replay = {
  id: 'r',
  kind: 'replay',
  demo: 'pair',
  state: 'passed',
  started: T,
  ended: T + 10_000,
  error: null,
  agents: [
    { name: 'root', parent: null },
    { name: 'kid', parent: 'root' },
  ],
  steps: [
    step('root', 0, T + 100, { calls: [call('c1', 'root:0', 'branch.fork', true, { branch: 'work' })] }),
    step('root', 1, T + 200, { output: 'kid started' }),
    step('kid', 0, T + 300, { calls: [call('c2', 'kid:0', 'fs.read', false, { path: '/x' })] }),
    step('kid', 1, T + 400),
    step('root', 2, T + 500),
  ],
  messages: [
    { at: T + 250, from: 'root', to: 'kid', text: 'Read /x.' },
    { at: T + 260, from: 'root', to: null, text: 'Waiting for kid.' },
    { at: T + 450, from: 'kid', to: 'root', text: 'kid: /x is missing.' },
  ],
  checks: [{ name: 'main.landed', ok: true, detail: 'landed' }],
}
const script = {
  root: [
    { tool: 'bash', text: 'layerfs branch fork work main', say: 'Fork a Branch.', description: 'fork' },
    { tool: 'subagent', text: 'Read /x.', description: 'kid' },
    { tool: 'reply', text: 'Done.' },
  ],
  kid: [{ tool: 'bash', text: 'layerfs fs read work /x' }, { tool: 'reply', text: 'kid: /x is missing.' }],
}

test('a replay: the script stands in for the model, in time with the messages', () => {
  const root = trajectory({ run: replay, agent: 'root', scriptView: (i) => script.root[i], prompt: 'Pair up.\nThen read.', title: 'Pair' })
  assert.equal(root.kind, 'replay')
  assert.deepEqual(kinds(root), ['system', 'user', 'assistant', 'tool', 'layerfs', 'assistant', 'subagent', 'context', 'assistant', 'check'])
  const [system, user, said, tool, lf, , sub, reply, done, check] = root.records
  assert.ok(system.scripted)
  assert.equal(system.title, 'Scripted agent · Pair')
  assert.equal(user.source, 'scenario')
  assert.equal(user.title, 'Pair up.')
  assert.equal(said.text, 'Fork a Branch.')
  assert.equal(tool.title, 'fork')
  assert.equal(tool.calls, 1)
  assert.equal(lf.parent, tool.id)
  assert.deepEqual(lf.args, { branch: 'work' })
  assert.equal(sub.child, 'kid')
  assert.equal(reply.source, 'child')
  assert.equal(reply.title, 'Reply from kid')
  assert.ok(done.final)
  assert.equal(check.title, 'main.landed')
  assert.ok(root.records.every((r) => r.turn === 1 || r.kind === 'system'))

  const kid = trajectory({ run: replay, agent: 'kid', scriptView: (i) => script.kid[i] })
  assert.deepEqual(kinds(kid), ['system', 'context', 'assistant', 'tool', 'layerfs', 'assistant'])
  assert.equal(kid.records[1].source, 'parent')
  assert.ok(kid.records[2].toolOnly)
  assert.equal(kid.records[4].status, 'failed')
  assert.equal(kid.records[4].outcome, 'NoSuchPath')
})

test('pages run from the newest rows', () => {
  const all = trajectory({ run: replay, agent: 'root', scriptView: (i) => script.root[i] })
  const last = trajectory({ run: replay, agent: 'root', scriptView: (i) => script.root[i], limit: 3 })
  assert.equal(last.total, all.total)
  assert.equal(last.from, all.total - 3)
  assert.deepEqual(last.records, all.records.slice(-3))
  const earlier = trajectory({ run: replay, agent: 'root', scriptView: (i) => script.root[i], before: last.from, limit: 3 })
  assert.deepEqual(earlier.records, all.records.slice(-6, -3))
})

test('a run that failed ends with why', () => {
  const t = trajectory({ run: { ...replay, state: 'failed', error: 'step root:2 exited 1', checks: [] }, agent: 'root', scriptView: (i) => script.root[i] })
  const end = t.records.at(-1)
  assert.equal(end.kind, 'context')
  assert.equal(end.status, 'failed')
  assert.equal(end.text, 'step root:2 exited 1')
})

const dir = mkdtempSync(join(tmpdir(), 'lfc-trajectory-'))
after(() => rmSync(dir, { recursive: true, force: true }))
const at = (ms) => new Date(T + ms).toISOString()
const pi = [
  { type: 'session', timestamp: at(0) },
  { type: 'model_change', provider: 'p', modelId: 'a', timestamp: at(0) },
  { type: 'thinking_level_change', thinkingLevel: 'low', timestamp: at(0) },
  { type: 'message', timestamp: at(0), message: { role: 'system', content: 'You are root.', sections: { preamble: 'You are root.', cwd: '/w' } } },
  { type: 'message', timestamp: at(1000), message: { role: 'user', content: [{ type: 'text', text: 'List files.' }] } },
  {
    type: 'message',
    timestamp: at(3000),
    message: { role: 'assistant', provider: 'p', model: 'a', durationMs: 1500, stopReason: 'toolUse', usage: { input: 10, output: 5, cacheRead: 2, cost: { total: 0.01 } }, content: [{ type: 'thinking', thinking: 'ls it' }, { type: 'toolCall', id: 'tc1', name: 'bash', arguments: { command: 'layerfs fs list main /' } }] },
  },
  { type: 'message', timestamp: at(3500), message: { role: 'toolResult', toolCallId: 'tc1', toolName: 'bash', content: [{ type: 'text', text: 'a b' }] } },
  { type: 'message', timestamp: at(5000), message: { role: 'assistant', durationMs: 1000, stopReason: 'stop', usage: { input: 20, output: 7 }, content: [{ type: 'text', text: 'a and b.' }] } },
  { type: 'model_change', provider: 'p', modelId: 'b', timestamp: at(6000) },
  { type: 'message', timestamp: at(7000), message: { role: 'user', content: [{ type: 'text', text: 'Again.' }] } },
  { type: 'message', timestamp: at(8000), message: { role: 'assistant', durationMs: 500, stopReason: 'toolUse', content: [{ type: 'toolCall', id: 'tc2', name: 'bash', arguments: { command: 'sleep 9' } }] } },
]
mkdirSync(join(dir, 'pi', 'root'), { recursive: true })
writeFileSync(join(dir, 'pi', 'root', '01.jsonl'), `${pi.map((e) => JSON.stringify(e)).join('\n')}\n{"type":"mess`)
const live = {
  id: 'l',
  kind: 'live',
  demo: 'live',
  state: 'stopped',
  started: T,
  ended: T + 9000,
  error: 'stopped by the user',
  agents: [{ name: 'root', parent: null }],
  steps: [
    step('root', 0, T + 3100, { view: { tool: 'bash', text: 'layerfs fs list main /', description: 'List files' }, stdout: 'a b', calls: [call('c3', 'root:0', 'fs.list')] }),
    step('root', 1, T + 5000, { view: { tool: 'reply', text: 'a and b.' } }),
  ],
  messages: [
    { at: T + 900, from: 'user', to: 'root', text: 'List files.' },
    { at: T + 6900, from: 'user', to: 'root', text: 'Again.' },
  ],
  checks: [],
}

test('a live session: pi’s log gives the model side, the steps the tool side', () => {
  const log = piLog(dir, 'root')
  assert.equal(log.length, pi.length, 'a line still being written is left out')
  assert.equal(piLog(dir, 'nobody'), null)
  const t = trajectory({ run: live, agent: 'root', pi: log })
  assert.equal(t.kind, 'live')
  assert.deepEqual(kinds(t), ['system', 'user', 'assistant', 'tool', 'layerfs', 'assistant', 'context', 'user', 'assistant', 'tool', 'context'])
  const [system, user, ask, tool, , answer, model, again, ask2, pending, end] = t.records
  assert.deepEqual(system.sections, ['preamble', 'cwd'])
  assert.equal(system.model, 'p/a')
  assert.equal(user.source, 'user')
  assert.equal(user.text, 'List files.')
  assert.equal(ask.thinking, 'ls it')
  assert.ok(ask.toolOnly)
  assert.equal(ask.ms, 1500)
  assert.equal(ask.start, T + 1500)
  assert.deepEqual(ask.usage, { input: 10, output: 5, cacheRead: 2, cacheWrite: 0, reasoning: 0, cost: 0.01 })
  assert.equal(tool.title, 'List files')
  assert.equal(tool.output, 'a b')
  assert.equal(answer.text, 'a and b.')
  assert.ok(answer.final)
  assert.equal(model.title, 'Model: p/b')
  assert.equal(again.turn, 2)
  assert.equal(ask2.step, 3)
  assert.equal(pending.status, 'stopped', 'a call no step recorded')
  assert.equal(pending.text, 'sleep 9')
  assert.equal(end.status, 'stopped')
})

test('a parent’s task opens a child’s turn; several inbox messages in one prompt are a row each', () => {
  const run = {
    ...live,
    state: 'running',
    error: null,
    agents: [
      { name: 'root', parent: null },
      { name: 'kid', parent: 'root' },
    ],
    steps: [],
    messages: [
      { at: T + 900, from: 'root', to: 'kid', text: 'Read /x.' },
      { at: T + 950, from: 'user', to: 'kid', text: 'Be quick.' },
    ],
  }
  const log = [{ type: 'message', timestamp: at(1000), message: { role: 'user', content: 'Read /x.\n\nBe quick.' } }]
  const t = trajectory({ run, agent: 'kid', pi: log })
  assert.deepEqual(
    t.records.map((r) => [r.kind, r.source, r.turn, r.opens]),
    [
      ['context', 'parent', 1, true],
      ['user', 'user', 1, false],
    ],
  )
})

test('a tool call lists its writes: Branch file ops, Workspace commits on their mounted Branch, fork, merge, publish', () => {
  const at = (ms) => new Date(T + ms).toISOString()
  const c = (id, method, extra) => ({ id, agent: 'root', step: 'root:0', method, ok: true, kind: 'ok', code: null, ms: 5, start: at(Number(id.slice(1))), ...extra })
  const run = {
    ...replay,
    agents: [{ name: 'root', parent: null }],
    messages: [],
    checks: [],
    steps: [
      step('root', 0, T, {
        calls: [
          c('c1', 'branch.fork', { kind: 'Forked', branch: 'docs', from: 'main' }),
          c('c2', 'fs.write', { kind: 'Committed', branch: 'docs', path: '/a.md', commit: '12aa', message: 'write /a.md', sizes: { logical: 10, stored: 4 } }),
          c('c3', 'workspace.mount', { kind: 'Mounted', branch: 'feature', sandbox: '3', path: '/workspaces/1' }),
          c('c4', 'workspace.exec', { kind: 'exit:0', sandbox: '3', path: '/workspaces/1' }),
          c('c5', 'workspace.commit', { kind: 'Committed', sandbox: '3', path: '/workspaces/1', commit: '12bb' }),
          c('c6', 'fs.read', { branch: 'docs', path: '/a.md' }),
          c('c7', 'branch.merge', { ok: false, kind: null, code: 'Conflict', branch: 'docs' }),
          c('c8', 'branch.merge', { kind: 'Merged', branch: 'release', commit: '12cc' }),
          c('c9', 'branch.publish', { kind: 'Added', branch: 'release', commit: '12cc' }),
        ],
      }),
    ],
  }
  // calls recorded before they kept their details: the trace files have them
  const notes = new Map([
    ['c5', { message: 'save the build', sizes: null }],
    ['c7', { message: 'docs + feature conflict in 1 file(s); nothing was created', onto: 'docs', with: 'feature', name: 'release' }],
    ['c8', { onto: 'docs', with: 'feature', name: 'release' }],
    ['c9', { layer: '32dd' }],
  ])
  const t = trajectory({ run, agent: 'root', scriptView: () => ({ tool: 'bash', text: 'x' }), notes })
  const tool = t.records.find((r) => r.kind === 'tool')
  assert.deepEqual(
    tool.writes.map((w) => [w.kind, w.method, w.status, w.outcome, w.commit, w.branch]),
    [
      ['fork', 'branch.fork', 'ok', 'Forked', null, 'docs'],
      ['file', 'fs.write', 'ok', 'Committed', '12aa', 'docs'],
      ['workspace', 'workspace.commit', 'ok', 'Committed', '12bb', 'feature'],
      ['merge', 'branch.merge', 'failed', 'Conflict', null, 'release'],
      ['merge', 'branch.merge', 'ok', 'Merged', '12cc', 'release'],
      ['publish', 'branch.publish', 'ok', 'Added', '12cc', 'release'],
    ],
    'reads, mounts and execs are not writes',
  )
  assert.deepEqual(tool.writes.map((w) => w.checkpoint), [1, 2, 3, null, 4, 5], 'each successful write is an auto-checkpoint; a refused one changed nothing')
  assert.deepEqual(tool.checkpoints, [1, 2, 3, 4, 5])
  assert.equal(t.checkpoints, 5)
  const [fork, file, ws, refused, merged, published] = tool.writes
  assert.equal(fork.from, 'main')
  assert.deepEqual([file.path, file.message, file.sizes], ['/a.md', 'write /a.md', { logical: 10, stored: 4 }])
  assert.deepEqual([ws.workspace, ws.message], ['3:/workspaces/1', 'save the build'])
  assert.match(refused.message, /conflict/)
  assert.deepEqual([merged.onto, merged.with], ['docs', 'feature'])
  assert.equal(published.layer, '32dd')
  assert.equal(published.trunk, null)

  // a scenario run's publish forks its next trunk: it reads as a publish to that trunk
  const scoped = {
    ...run,
    folder: 'pair_1',
    steps: [step('root', 0, T, { calls: [c('c1', 'branch.fork', { kind: 'Forked', branch: 'pair_1.main.2' }), c('c2', 'branch.fork', { kind: 'Forked', branch: 'pair_1.docs' })] })],
  }
  const p = trajectory({ run: scoped, agent: 'root', scriptView: () => ({ tool: 'bash', text: 'x' }), notes: new Map([['c1', { from: 'pair_1.release' }], ['c2', { from: 'pair_1.main' }]]) })
  assert.deepEqual(
    p.records.find((r) => r.kind === 'tool').writes.map((w) => [w.kind, w.branch, w.trunk, w.from]),
    [
      ['publish', 'pair_1.release', 'pair_1.main.2', 'pair_1.release'],
      ['fork', 'pair_1.docs', null, 'pair_1.main'],
    ],
  )
  assert.deepEqual(
    t.records.filter((r) => r.kind === 'layerfs').map((r) => r.writeKind),
    ['fork', 'file', null, null, 'workspace', null, 'merge', 'merge', 'publish'],
  )
})

test('auto-checkpoints are numbered across the session as writes end, so another agent’s can fall between one call’s', () => {
  const at = (ms) => new Date(T + ms).toISOString()
  const c = (id, agent, step, method, start, extra) => ({ id, agent, step, method, ok: true, kind: 'Committed', code: null, ms: 5, start: at(start), ...extra })
  const run = {
    ...replay,
    agents: [
      { name: 'root', parent: null },
      { name: 'kid', parent: 'root' },
    ],
    messages: [],
    checks: [],
    steps: [
      step('root', 0, T, { calls: [c('a1', 'root', 'root:0', 'fs.write', 0, { branch: 'a', path: '/x', commit: '12aa' }), c('a2', 'root', 'root:0', 'fs.write', 30, { branch: 'a', path: '/y', commit: '12ab' })] }),
      step('kid', 0, T + 10, { calls: [c('k1', 'kid', 'kid:0', 'fs.write', 10, { branch: 'b', path: '/z', commit: '12ba' })] }),
      step('root', 1, T + 40, { calls: [c('a3', 'root', 'root:1', 'fs.read', 40, { branch: 'a', path: '/x' })] }),
      step('root', 2, T + 50, { calls: [c('a4', 'root', 'root:2', 'branch.merge', 50, { ok: false, kind: null, code: 'Conflict' })] }),
    ],
  }
  const view = () => ({ tool: 'bash', text: 'x' })
  const root = trajectory({ run, agent: 'root', scriptView: view })
  assert.equal(root.checkpoints, 3, 'the session has three, the kid’s among them')
  assert.deepEqual(
    root.records.filter((r) => r.kind === 'tool').map((r) => r.checkpoints ?? null),
    [[1, 3], null, []],
    'root’s first call made #1 and #3; the kid made #2 in between; a refused merge makes none',
  )
  const kid = trajectory({ run, agent: 'kid', scriptView: view })
  assert.deepEqual(kid.records.find((r) => r.kind === 'tool').checkpoints, [2])
})
