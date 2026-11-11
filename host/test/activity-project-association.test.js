import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, utimesSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ActivityStore } from '../activity/store.js'

function fixture(t) {
  const state = mkdtempSync(join(tmpdir(), 'connect-project-activity-'))
  t.after(() => rmSync(state, { recursive: true, force: true }))
  const store = new ActivityStore(state)
  mkdirSync(store.dir, { recursive: true })
  return store
}
const action = { id: 'mixed-build', name: 'demo.setup', origin: 'user' }
function rows(id, argv, owner = action, status = 'success') {
  const base = { v: 1, generation: 'initial', action: owner, invocationId: id, at: 10 }
  return [
    { ...base, type: 'cli.queued', data: { argv } },
    { ...base, type: 'cli.finished', data: { status, stdout: { text: 'BODY_MUST_STAY_LAZY', bytes: 19, truncated: false } } },
  ]
}
function shard(store, suffix, records, at) {
  const file = join(store.dir, `activity-2026-11-11-${suffix}-protected-1.ndjson`)
  writeFileSync(file, records.map(row => JSON.stringify(row) + '\n').join(''))
  utimesSync(file, at, at)
}

test('Mixed workspace project filtering resolves successful sandbox creation across writer shards without loading output', async t => {
  const store = fixture(t), project = 'demo-studio/design', sandbox = 'design-alias'
  shard(store, 'first', [
    ...rows('mount', ['workspace', 'mount', sandbox, 'feature-a', '--name', 'work']),
    ...rows('exec', ['workspace', 'exec', `${sandbox}:work`, 'cat docs/readme.md']),
    ...rows('commit', ['workspace', 'commit', `${sandbox}:work`]),
    ...rows('unmount', ['workspace', 'unmount', `${sandbox}:work`]),
  ], 1)
  shard(store, 'last', rows('create', ['sandbox', 'create', project, sandbox]), 2)
  const page = await store.invocationPage(action.id, { project })
  assert.equal(page.total, 5)
  assert.ok(page.items.every(call => call.project === project))
  assert.doesNotMatch(JSON.stringify(page), /BODY_MUST_STAY_LAZY/)
  assert.ok(page.items.every(call => call.stdout === undefined && call.stdin === undefined))
  assert.equal((await store.summaries()).items[0].projects.join(), project)
  const parsed = store.index.parsed
  await store.invocationPage(action.id, { project })
  assert.equal(store.index.parsed, parsed)
})

test('Sandbox associations require success, remain action scoped, and do not interpret shell paths as project names', async t => {
  const store = fixture(t), project = 'demo-studio/design', sandbox = 'shared-alias', other = { ...action, id: 'other-action' }
  shard(store, 'calls', [
    ...rows('failed-create', ['sandbox', 'create', project, sandbox], action, 'failed'),
    ...rows('exec', ['workspace', 'exec', `${sandbox}:work`, 'docs/readme.md']),
    ...rows('other-create', ['sandbox', 'create', 'other-store/project', sandbox], other),
    ...rows('path', ['machine', 'update', 'native', '--daemon', 'tools/daemon']),
  ], 1)
  let page = await store.invocationPage(action.id, { project })
  assert.deepEqual(page.items.map(call => call.id), ['failed-create'])
  assert.equal(store.index.calls.get('exec').project, undefined)
  assert.equal(store.index.calls.get('path').project, undefined)
  shard(store, 'success-later', rows('create', ['sandbox', 'create', project, sandbox]), 2)
  page = await store.invocationPage(action.id, { project })
  assert.deepEqual(page.items.map(call => call.id).sort(), ['create', 'exec', 'failed-create'])
  assert.equal(store.index.calls.get('other-create').project, 'other-store/project')
})

test('Clearing activity fences sandbox project associations from the previous generation', async t => {
  const store = fixture(t), sandbox = 'design-alias', project = 'demo-studio/design'
  shard(store, 'create', rows('create', ['sandbox', 'create', project, sandbox]), 1)
  assert.equal((await store.invocationPage(action.id, { project })).total, 1)
  const generation = await store.clear()
  shard(store, 'new', rows('exec-new', ['workspace', 'exec', `${sandbox}:work`, 'docs/readme.md']).map(row => ({ ...row, generation })), 2)
  assert.equal((await store.invocationPage(action.id, { project })).total, 0)
  assert.equal(store.index.calls.get('exec-new').project, undefined)
})
