// A scenario run's scope (host/runs/scope.js) without LayerFS: how each call
// is put in the run's folder, namespace and Sandboxes, how a publish becomes
// the next trunk, and that every scenario's calls and change files land
// under the folder. Run: node --test host/test/scope.test.js
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { loadScenarios } from '../../tools/lib/scenario.mjs'
import { chatLive } from '../agents/trace.js'
import { translateRecorded } from '../checks/history.js'
import { inFolder, inRunFolder, lwwFor, Scope, SCOPE_ENV, scopedScenario } from '../runs/scope.js'

const SCENARIOS = fileURLToPath(new URL('../../scenarios/', import.meta.url))
const root = mkdtempSync(join(tmpdir(), 'lfc-scope-test-'))
after(() => rmSync(root, { recursive: true, force: true }))
let n = 0
const scope = () => Scope.create(join(root, `s${++n}`), { run: 'tour_1', project: 'p', trunk: 'tour_1.main' })
const ID = '12c50ef457476336290fa2a0046a034957d3eea888b71779182e5535ffce71dd44'

/** Plays one call through the scope against a stand-in for the real call: { sent, value }. */
async function call(s, op, args, answer = () => ({})) {
  const sent = []
  const value = await s.call(op, { project: 'p', ...args }, async (o, a) => {
    sent.push({ op: o, args: a })
    return answer(o, a)
  })
  return { sent, value }
}

/** Runs the `layerfs` command a scoped run's bash finds (cli-shim.mjs) over a stand-in native binary that prints `answer`. */
function shim(s, args, { answer = '{"kind":"Forked"}', status = 0, stderr = '', env = {} } = {}) {
  const native = join(s.dir, `native-${++n}`)
  const output = args[0] === 'workspace' && args[1] === 'exec' ? JSON.stringify({stream:'stdout',bytes:answer})+'\n'+JSON.stringify({result:{exit_code:status,kind:`exit:${status}`,stdout:answer,stderr:''}}) : answer
  const cliStatus = args[0] === 'workspace' && args[1] === 'exec' ? 0 : status
  writeFileSync(native, `#!/bin/sh\necho "$@" >> ${JSON.stringify(join(s.dir, 'native.log'))}\necho '${output}'\n${stderr ? `echo '${stderr}' >&2\n` : ''}exit ${cliStatus}\n`)
  chmodSync(native, 0o755)
  const done = spawnSync(process.execPath, [fileURLToPath(new URL('../runs/cli-shim.mjs', import.meta.url)), native, ...args], { encoding: 'utf8', env: { ...process.env, [SCOPE_ENV]: s.dir, LAYERFS_HOME: s.dir, ...env } })
  return { status: done.status, stdout: done.stdout, calls: readFileSync(join(s.dir, 'native.log'), 'utf8').trim().split('\n') }
}

test('the command: a publish moves the trunk, so the next fork from main starts from what was published', () => {
  const s = scope()
  const published = shim(s, ['branch', 'publish', 'p', 'skeleton'])
  assert.equal(published.status, 0)
  assert.deepEqual(published.calls, ['branch fork p tour_1.main.1 tour_1.skeleton'])
  assert.deepEqual(s.trunk(), { k: 1, branch: 'tour_1.main.1' })
  assert.match(published.stdout, /Forked/)
  assert.deepEqual(shim(s, ['branch', 'fork', 'p', 'catalog', 'main']).calls.at(-1), 'branch fork p tour_1.catalog tour_1.main.1')
})

test('the command: a refused publish keeps the trunk and passes on its exit code', () => {
  const s = scope()
  const refused = shim(s, ['branch', 'publish', 'p', 'skeleton'], { answer: '', stderr: '{"code":"NotFound","message":"not found"}', status: 125 })
  assert.equal(refused.status, 125)
  assert.deepEqual(s.trunk(), { k: 0, branch: 'tour_1.main' })
  assert.deepEqual(s.trunks(), [{ k: 0, branch: 'tour_1.main' }])
})

test('the command: a merge with main that fast-forwards is kept, and a closed Sandbox leaves the scope', () => {
  const s = scope()
  shim(s, ['branch', 'merge', 'p', 'up', 'main', 'feature'], { answer: '{"kind":"Merged","fast_forward":true,"head":"abc"}' })
  assert.deepEqual([...s.fastForwards()], [['tour_1.up', 'abc']])
  const real = s.realSandbox('sb1')
  assert.equal(s.sandboxes().size, 1)
  assert.equal(shim(s, ['sandbox', 'close', real]).status, 0)
  assert.equal(s.sandboxes().size, 0)
})

test('the command writes the call lines Live reads (LayerFS 2.0 traces only worker connections)', () => {
  const s = scope()
  const traces = join(s.dir, 'traces')
  mkdirSync(traces)
  const env = { LAYERFS_TRACE: join(traces, 'root.jsonl'), LAYERFS_TRACE_STEP: 'root:call-1', LAYERFS_TRACE_START: '1' }
  const sb = s.realSandbox('sb1')
  const ws = `${sb}:/w/1`
  assert.equal(shim(s, ['sandbox', 'create', 'p', 'sb1'], { answer: `{"kind":"Created","name":"${sb}"}`, env }).status, 0)
  shim(s, ['workspace', 'mount', sb, 'skeleton'], { answer: `{"kind":"Mounted","path":"/w/1","ws":"${ws}"}`, env })
  // a streamed exec exits with its command's code: the call itself worked
  assert.equal(shim(s, ['workspace', 'exec', ws, 'npm test', '--stream'], { answer: 'out', status: 1, env }).status, 1)
  const refused = shim(s, ['branch', 'fork', 'p', 'x', 'main'], { answer: '', stderr: '{"code":"Exists","message":"x exists"}', status: 125, env })
  assert.equal(refused.status, 125)
  const { calls, live } = chatLive(traces, { running: true })
  assert.deepEqual(calls.map((c) => [c.method, c.ok, c.step]), [
    ['sandbox.create', true, 'root:call-1'],
    ['workspace.mount', true, 'root:call-1'],
    ['workspace.exec', true, 'root:call-1'],
    ['branch.fork', false, 'root:call-1'],
  ])
  assert.equal(calls[3].code, 'Exists')
  assert.deepEqual(live.sandboxes.map((x) => x.id), [sb])
  assert.deepEqual(live.mounts.map((m) => [m.sandbox, m.path, m.branch, m.last?.kind]), [[sb, '/w/1', 'tour_1.skeleton', 'exit:1']])
  assert.deepEqual(live.running, [])
})

test('paths go under the folder once; the root /.lww stays where LayerFS reads it', () => {
  assert.equal(inFolder('tour_1', '/app/page.tsx'), '/tour_1/app/page.tsx')
  assert.equal(inFolder('tour_1', '/'), '/tour_1')
  assert.equal(inFolder('tour_1', '/tour_1/app'), '/tour_1/app')
  assert.equal(inFolder('tour_1', '/tour_10/app'), '/tour_1/tour_10/app')
  assert.equal(inFolder('tour_1', '/.lww'), '/.lww')
})

test('a /.lww keeps its meaning with the files under the folder', () => {
  assert.equal(lwwFor('crew_2', '%include .gitignore\npackage-lock.json\n'), '%include crew_2/.gitignore\npackage-lock.json\n')
  assert.equal(lwwFor('crew_2', '# generated\n/dist\nsrc/generated/\n!keep.log\n!/a/b'), '# generated\n/crew_2/dist\n/crew_2/src/generated/\n!keep.log\n!/crew_2/a/b')
})

test('a command runs in the folder', async () => {
  const s = scope()
  const created = await call(s, 'sandbox.create', {}, () => ({ sandbox: '7' }))
  const { sent } = await call(s, 'workspace.exec', { sandbox: created.value.sandbox, path: '/workspaces/1', command: 'sh build.sh' })
  assert.equal(sent[0].args.sandbox, '7')
  assert.match(sent[0].args.command, /\ncd tour_1 \|\| exit 97\nsh build\.sh$/)
})

test('a command finds `timeout` where the Sandbox has none (a macOS native Sandbox), and it ends the command', () => {
  const dir = mkdtempSync(join(root, 'run-'))
  mkdirSync(join(dir, 'tour_1'))
  const sh = (command) => spawnSync('/bin/sh', ['-c', inRunFolder('tour_1', command)], { cwd: dir, encoding: 'utf8', env: { PATH: '/usr/bin:/bin' } })
  assert.equal(sh('timeout 5 pwd').stdout.trim().endsWith('/tour_1'), true)
  const started = Date.now()
  assert.notEqual(sh('timeout 1 sleep 5').status, 0)
  assert.ok(Date.now() - started < 4000)
  assert.equal(sh('timeout 5 sh -c "exit 3"').status, 3)
})

test('the command: a `file apply --from` keeps a root /.lww and adds its copy under the folder, as the SDK call does', () => {
  const s = scope()
  const from = join(s.dir, 'changes.json')
  writeFileSync(from, JSON.stringify([{ op: 'write', path: '/.lww', content: '/a.txt\n' }, { op: 'write', path: '/a.txt', content: 'x' }]))
  const native = join(s.dir, 'native-apply')
  writeFileSync(native, `#!/bin/sh\nwhile [ "$1" != --from ]; do shift; done\ncat "$2" > ${JSON.stringify(join(s.dir, 'sent.json'))}\necho '{"kind":"Committed"}'\n`)
  chmodSync(native, 0o755)
  const done = spawnSync(process.execPath, [fileURLToPath(new URL('../runs/cli-shim.mjs', import.meta.url)), native, 'file', 'apply', 'p', 'b', '-m', 'm', '--from', from], { encoding: 'utf8', env: { ...process.env, [SCOPE_ENV]: s.dir, LAYERFS_HOME: s.dir } })
  assert.equal(done.status, 0, done.stderr)
  const sent = JSON.parse(readFileSync(join(s.dir, 'sent.json'), 'utf8'))
  const expected = s.args('file.apply', { changes: JSON.parse(readFileSync(from, 'utf8')) }).changes
  assert.deepEqual(sent, expected)
  assert.deepEqual(sent.map((c) => c.path), ['/.lww', '/tour_1/.lww', '/tour_1/a.txt'])
})

test('answers name Branches and paths as the script wrote them; the trace has the real ones', async () => {
  const s = scope()
  const listed = await call(s, 'sandbox.list_workspaces', { sandbox: '1' }, () => ({ items: [{ branch: 'tour_1.site', path: '/workspaces/2' }, { branch: 'other_1.site', path: '/workspaces/3' }] }))
  assert.deepEqual(listed.value.items.map((w) => w.branch), ['site', 'other_1.site'])
  const files = await call(s, 'fs.list', { branch: 'main', path: '/app' }, () => ({ path: '/tour_1/app', items: [{ name: 'page.tsx', path: '/tour_1/app/page.tsx' }] }))
  assert.equal(files.sent[0].args.path, '/tour_1/app')
  assert.deepEqual(files.value, { path: '/app', items: [{ name: 'page.tsx', path: '/app/page.tsx' }] })
  const merged = await call(s, 'branch.merge', { branch: 'a', with: 'main', name: 'b' }, () => ({ kind: 'Merged', branch: 'tour_1.b', sources: [{ ref: 'tour_1.a' }, { ref: 'tour_1.main.3' }] }))
  assert.deepEqual(merged.value, { kind: 'Merged', branch: 'b', sources: [{ ref: 'a' }, { ref: 'main' }] })
})

test('every scenario: a publish is expected as the trunk fork it becomes, and nothing else changes', () => {
  for (const [id, scenario] of loadScenarios(SCENARIOS)) {
    const scoped = scopedScenario(scenario)
    const codes = (sc) => Object.values(sc.agents).flatMap((steps) => steps.flatMap((st) => st.expect ?? []))
    assert.ok(!codes(scoped).some((c) => c.startsWith('branch.publish:')), `${id} still expects a publish`)
    assert.equal(codes(scoped).length, codes(scenario).length, id)
    for (const s of scoped.sessions ?? []) assert.ok(!codes(s.scenario).some((c) => c.startsWith('branch.publish:')), `${id} session ${s.name}`)
  }
})

test('a recorded history reads as a scoped run: a fork or merge of a published Layer names the Commit it published', () => {
  const final = JSON.parse(readFileSync(join(SCENARIOS, 'crew', 'final.json'), 'utf8'))
  const tr = translateRecorded(final.history)
  for (const [name, b] of Object.entries(tr.branches)) {
    assert.ok(b.forkedFrom === 'L0' || !/^L\d+$/.test(b.forkedFrom ?? ''), `${name} forked from ${b.forkedFrom}`)
    for (const c of b.commits) assert.ok(!/^L[1-9]\d*$/.test(c.merged ?? ''), `${name} merged ${c.merged}`)
  }
  assert.deepEqual(tr.layers, final.history.layers)
})

test("a recorded merge of a Layer that published an ancestor of the merge's first input may be absent", () => {
  const recorded = {
    layers: [{ source: null }, { source: 'work.3#1' }],
    branches: {
      'work.3': { forkedFrom: 'L0', commits: [] },
      'int-work-m2': { forkedFrom: 'work.3#12', commits: [{ message: 'integrate', via: 'merge', merged: 'L1' }, { message: 'tests', via: 'exec', merged: null }] },
      other: { forkedFrom: 'lead#2', commits: [{ message: 'integrate', via: 'merge', merged: 'L1' }] },
    },
  }
  const tr = translateRecorded(recorded)
  assert.deepEqual(tr.branches['int-work-m2'].commits[0], { message: 'integrate', via: 'merge', merged: 'work.3#1', optional: true })
  assert.equal(tr.branches['int-work-m2'].commits[1].optional, undefined)
  // another Branch's Commit is no ancestor: the merge must be there
  assert.equal(tr.branches.other.commits[0].optional, undefined)
})
