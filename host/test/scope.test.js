// A scenario run's scope (host/runs/scope.js) without LayerFS: how each call
// is put in the run's folder, namespace and Sandboxes, how a publish becomes
// the next trunk, and that every scenario's calls and change files land
// under the folder. Run: node --test host/test/scope.test.js
import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { loadScenarios } from '../../tools/lib/scenario.mjs'
import { translateRecorded } from '../checks/history.js'
import { inFolder, lwwFor, Scope, scopedScenario } from '../runs/scope.js'

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

test('refs: main is the trunk, a Branch is in the namespace, ids are as they are', async () => {
  const s = scope()
  let { sent } = await call(s, 'branch.fork', { name: 'feature', from: 'main' })
  assert.deepEqual(sent[0].args, { project: 'p', name: 'tour_1.feature', from: 'tour_1.main' })
  ;({ sent } = await call(s, 'branch.fork', { name: 'header', from: ID }))
  assert.equal(sent[0].args.from, ID)
  ;({ sent } = await call(s, 'branch.merge', { branch: 'feature', with: 'main', name: 'release', message: 'm' }))
  assert.deepEqual([sent[0].args.branch, sent[0].args.with, sent[0].args.name], ['tour_1.feature', 'tour_1.main', 'tour_1.release'])
  ;({ sent } = await call(s, 'fs.glob', { branch: 'main', pattern: 'r*/change-*.ts' }))
  assert.deepEqual([sent[0].args.branch, sent[0].args.path], ['tour_1.main', '/tour_1'])
  ;({ sent } = await call(s, 'fs.diff_files', { branch: 'a', left: { commit: 'a', path: '/x' }, right: { commit: ID, path: '/x' } }))
  assert.deepEqual([sent[0].args.left, sent[0].args.right], [{ commit: 'tour_1.a', path: '/tour_1/x' }, { commit: ID, path: '/tour_1/x' }])
  ;({ sent } = await call(s, 'fs.mv', { branch: 'a', from: '/x', to: '/y', message: 'm' }))
  assert.deepEqual([sent[0].args.from, sent[0].args.to], ['/tour_1/x', '/tour_1/y'])
  // a call on another project is not the run's
  ;({ sent } = await s.call('branch.fork', { project: 'other', name: 'feature', from: 'main' }, async (o, a) => (sent = [{ op: o, args: a }])).then(() => ({ sent })))
  assert.deepEqual(sent[0].args, { project: 'other', name: 'feature', from: 'main' })
})

test('fs.apply changes and a /.lww write move with the folder', async () => {
  const s = scope()
  const { sent } = await call(s, 'fs.apply', {
    branch: 'lead',
    changes: [{ op: 'mkdir', path: '/packages' }, { op: 'write', path: '/packages/a.js', content: 'x' }, { op: 'write', path: '/.lww', content: '%include .gitignore\n' }],
  })
  assert.deepEqual(sent[0].args.changes, [
    { op: 'mkdir', path: '/tour_1/packages' },
    { op: 'write', path: '/tour_1/packages/a.js', content: 'x' },
    { op: 'write', path: '/.lww', content: '%include tour_1/.gitignore\n' },
    { op: 'write', path: '/tour_1/.lww', content: '%include .gitignore\n' },
  ])
  const w = await call(s, 'fs.write', { branch: 'checkout', path: '/.lww', content: '%include .gitignore\n', message: 'lww' })
  assert.deepEqual([w.sent[0].args.path, w.sent[0].args.content], ['/.lww', '%include tour_1/.gitignore\n'])
})

test('a command runs in the folder', async () => {
  const s = scope()
  const created = await call(s, 'sandbox.create', {}, () => ({ sandbox: '7' }))
  const { sent } = await call(s, 'workspace.exec', { sandbox: created.value.sandbox, path: '/workspaces/1', command: 'sh build.sh' })
  assert.deepEqual([sent[0].args.sandbox, sent[0].args.command], ['7', 'cd tour_1 || exit 97\nsh build.sh'])
})

test('publish: the next trunk is forked from the Branch or Commit; main follows it; a refusal leaves the trunk', async () => {
  const s = scope()
  let { sent, value } = await call(s, 'branch.publish', { branch: 'feature-home' }, () => ({ kind: 'Forked', branch: 'tour_1.main.1' }))
  assert.deepEqual(sent, [{ op: 'branch.fork', args: { project: 'p', name: 'tour_1.main.1', from: 'tour_1.feature-home' } }])
  // the answer names the trunk as the script knows it
  assert.deepEqual(value, { kind: 'Forked', branch: 'main' })
  assert.deepEqual(s.trunk(), { k: 1, branch: 'tour_1.main.1' })
  ;({ sent } = await call(s, 'branch.fork', { name: 'header', from: 'main' }))
  assert.equal(sent[0].args.from, 'tour_1.main.1')
  ;({ sent } = await call(s, 'branch.publish', { branch: 'header', commit: ID }))
  assert.deepEqual(sent[0].args, { project: 'p', name: 'tour_1.main.2', from: ID })
  await assert.rejects(
    s.call('branch.publish', { project: 'p', branch: 'nothing' }, async () => {
      throw Object.assign(new Error('no such Branch'), { code: 'NoSuchBranch' })
    }),
    { code: 'NoSuchBranch' },
  )
  assert.deepEqual(s.trunk(), { k: 2, branch: 'tour_1.main.2' })
  assert.deepEqual(s.trunks().map((t) => t.branch), ['tour_1.main', 'tour_1.main.1', 'tour_1.main.2'])
  // the refused publish's number is free again
  ;({ sent } = await call(s, 'branch.publish', { branch: 'header' }))
  assert.equal(sent[0].args.name, 'tour_1.main.3')
})

test("Sandboxes: the run numbers its own from 1, and sees only those", async () => {
  const s = scope()
  const a = await call(s, 'sandbox.create', {}, () => ({ sandbox: '7' }))
  const b = await call(s, 'sandbox.create', {}, () => ({ sandbox: '9' }))
  assert.deepEqual([a.value.sandbox, b.value.sandbox], ['1', '2'])
  const mount = await call(s, 'workspace.mount', { sandbox: '2', branch: 'search' }, (o, x) => ({ kind: 'Mounted', sandbox: x.sandbox, path: '/workspaces/1' }))
  assert.deepEqual([mount.sent[0].args.sandbox, mount.sent[0].args.branch, mount.value.sandbox], ['9', 'tour_1.search', '2'])
  const listed = await call(s, 'project.list_sandboxes', {}, () => ({ items: [{ sandbox: '3' }, { sandbox: '7', workspaces: [{ sandbox: '7' }] }, { sandbox: '9' }] }))
  assert.deepEqual(listed.value.items, [{ sandbox: '1', workspaces: [{ sandbox: '1' }] }, { sandbox: '2' }])
  await call(s, 'sandbox.close', { sandbox: '1' })
  assert.deepEqual([...s.sandboxes()], [['2', '9']])
  // a number the run never had is one the project refuses too
  const unknown = await call(s, 'sandbox.close', { sandbox: '5' })
  assert.equal(unknown.sent[0].args.sandbox, '9999')
  // the lowest free number is taken again, as a fresh project would
  const c = await call(s, 'sandbox.create', {}, () => ({ sandbox: '12' }))
  assert.equal(c.value.sandbox, '1')
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

test("a Workspace's Branch LayerFS leaves null (past its first 64 Branches) is the one the run mounted", async () => {
  const s = scope()
  await call(s, 'sandbox.create', {}, () => ({ sandbox: '4' }))
  await call(s, 'workspace.mount', { sandbox: '1', branch: 'site' }, () => ({ kind: 'Mounted', sandbox: '4', path: '/workspaces/2', branch: 'tour_1.site' }))
  // as the binding answers, before the SDK makes items of it
  const listed = await call(s, 'sandbox.list_workspaces', { sandbox: '1' }, () => ({ workspaces: [{ directory: '/workspaces/2', mounted: true, branch: null }, { directory: '/workspaces/9', mounted: true, branch: null }] }))
  assert.deepEqual(listed.value.workspaces, [{ directory: '/workspaces/2', mounted: true, branch: 'site' }, { directory: '/workspaces/9', mounted: true, branch: null }])
  await call(s, 'workspace.unmount', { sandbox: '1', path: '/workspaces/2' })
  assert.equal(s.mountedBranch('4', '/workspaces/2'), null)
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

test("every replay's change files land under the run's folder", async () => {
  for (const id of ['crew', 'shop', 'depot']) {
    const dir = join(SCENARIOS, id, 'changes')
    const s = Scope.create(join(root, `c-${id}`), { run: `${id}_1`, project: 'p', trunk: `${id}_1.main` })
    for (const file of readdirSync(dir)) {
      const changes = JSON.parse(readFileSync(join(dir, file), 'utf8'))
      const { sent } = await call(s, 'fs.apply', { branch: 'lead', changes })
      for (const c of sent[0].args.changes) for (const key of ['path', 'from', 'to']) if (key in c) assert.ok(c[key] === '/.lww' || c[key].startsWith(`/${id}_1/`), `${id}/${file}: ${c[key]}`)
    }
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

test('a merge with main that fast-forwards onto the trunk is remembered: the Branch starts there', async () => {
  const s = scope()
  await call(s, 'branch.merge', { branch: 'insight.1', with: 'main', name: 'insight.2', message: 'm' }, () => ({ kind: 'Merged', fastForward: true, branch: 'tour_1.insight.2', head: ID }))
  await call(s, 'branch.merge', { branch: 'a', with: 'b', name: 'c', message: 'm' }, () => ({ kind: 'Merged', fastForward: true, branch: 'tour_1.c', head: ID }))
  await call(s, 'branch.merge', { branch: 'x', with: 'main', name: 'y', message: 'm' }, () => ({ kind: 'Merged', fastForward: false, branch: 'tour_1.y', head: ID }))
  assert.deepEqual([...s.fastForwards()], [['tour_1.insight.2', ID]])
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
