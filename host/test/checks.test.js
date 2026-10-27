// host/checks: a run's final checks against final.json, on a stand-in client
// (no Store, no Docker). The live check is tools/checks/final.mjs.
//   node --import ./host/resolve-layerfs.js --test host/test/checks.test.js
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { finalChecks, readFinal } from '../checks/index.js'
import { compareTree, variesOf } from '../checks/final.js'
import { CHECK_PREFIX, compareHistory } from '../checks/history.js'

const SCENARIOS = fileURLToPath(new URL('../../scenarios/', import.meta.url))
const scratch = mkdtempSync(join(tmpdir(), 'lfc-checks-test-'))
after(() => rmSync(scratch, { recursive: true, force: true }))
const sha = (text) => createHash('sha256').update(text).digest('hex')

/** A stand-in for an @layerfs/agent client and its backend: main's files, one Branch, two Layers. */
function stand(files, { sandboxes = [] } = {}) {
  const calls = []
  const entries = new Map([['/', { type: 'dir' }]])
  for (const [path, content] of Object.entries(files)) {
    const parts = path.split('/')
    for (let i = 2; i < parts.length; i++) entries.set(parts.slice(0, i).join('/'), { type: 'dir' })
    entries.set(path, { type: 'file', content })
  }
  const page = (items, size, pos) => ({ items: items.slice(pos, pos + size), hasMore: pos + size < items.length })
  const commits = [
    { id: 'c2', message: 'second', via: 'exec', parent: 'c1', secondParent: null },
    { id: 'c1', message: 'first', via: 'fs', base: 'l0', secondParent: null },
  ]
  const client = {
    calls,
    fs: {
      async list(ref, dir, size = 50, pos = 0) {
        const prefix = dir === '/' ? '/' : `${dir}/`
        const items = [...entries]
          .filter(([p]) => p !== '/' && p.startsWith(prefix) && !p.slice(prefix.length).includes('/'))
          .map(([p, e]) => ({ name: p.slice(prefix.length), path: p, type: e.type }))
          .sort((a, b) => (a.name < b.name ? -1 : 1))
        return page(items, size, pos)
      },
      async read(ref, path) {
        const text = entries.get(path).content
        return { text, size: Buffer.byteLength(text), nextLine: null, lineTruncated: false }
      },
    },
    branch: {
      async fork(name) {
        calls.push(`fork ${name}`)
      },
      async list_commits(branch, size, pos) {
        return page(commits, size, pos)
      },
    },
    project: {
      async list_branches(size, pos) {
        return page(
          [
            { name: 'main' },
            { name: 'feature', forkedFrom: 'l0' },
            { name: `${CHECK_PREFIX}old`, forkedFrom: 'l1' },
          ],
          size,
          pos,
        )
      },
      async list_sandboxes(size, pos) {
        return page(sandboxes, size, pos)
      },
    },
    sandbox: {
      async create() {
        calls.push('create')
        return { sandbox: '7', image: 'sha256:x' }
      },
      async close(sandbox) {
        calls.push(`close ${sandbox}`)
      },
    },
    workspace: {
      async mount(sandbox, branch) {
        calls.push(`mount ${branch}`)
        return { sandbox, path: '/workspaces/1' }
      },
      async exec(ws, command) {
        const paths = [...command.matchAll(/'\.([^']+)'/g)].map((m) => m[1])
        return { exitCode: 0, stdout: paths.map((p) => `${sha(entries.get(p).content)}  .${p}\n`).join(''), stderr: '' }
      },
      async unmount(ws, discard) {
        calls.push(`unmount discard=${discard}`)
      },
    },
  }
  const backend = {
    store: {
      project: {
        async get_history() {
          return {
            moreLayers: false,
            layers: [
              { id: 'l1', parent: 'l0', sourceCommit: 'c2' },
              { id: 'l0', parent: null },
            ],
          }
        },
      },
    },
  }
  return { client, backend }
}

const FILES = {
  '/.gitignore': 'node_modules\n*.log\n',
  '/README.md': '# Site\n',
  '/app/page.tsx': 'export default 1\n',
  '/node_modules/x/index.js': 'ignored\n',
  '/debug.log': 'ignored\n',
  '/data/run-1793060955567123.sqlite': 'bytes that vary\n',
}
const recorded = () => ({
  main: {
    '/.gitignore': sha(FILES['/.gitignore']),
    '/README.md': sha(FILES['/README.md']),
    '/app/page.tsx': sha(FILES['/app/page.tsx']),
    // recorded with another clock reading in its name and other bytes
    '/data/run-1792000000000000999.sqlite': sha('other bytes'),
  },
  varies: variesOf({ '/data/run-1792000000000000999.sqlite': '' }),
  history: {
    layers: [{ source: null }, { source: 'feature#1' }],
    branches: {
      feature: {
        forkedFrom: 'L0',
        commits: [
          { message: 'first', via: 'fs', merged: null },
          { message: 'second', via: 'exec', merged: null },
        ],
      },
    },
  },
})
function scenarioDir(name, final) {
  const dir = join(scratch, name)
  mkdirSync(dir, { recursive: true })
  if (final) writeFileSync(join(dir, 'final.json'), JSON.stringify(final))
  return dir
}

test('a scenario without final.json has no final checks', async () => {
  const { client } = stand(FILES)
  assert.deepEqual(await finalChecks({ scenario: 'tour', scenarioDir: join(SCENARIOS, 'tour'), project: 'p', client }), [])
  assert.equal(readFinal(join(SCENARIOS, 'tour')), null)
})

test('a run matching final.json passes order, tree and closed', async () => {
  const { client, backend } = stand(FILES)
  const checks = await finalChecks({ scenario: 'x', scenarioDir: scenarioDir('match', recorded()), project: 'p', client, backend })
  assert.deepEqual(
    checks.map((c) => [c.name, c.ok]),
    [
      ['final.order', true],
      ['final.tree', true],
      ['final.closed', true],
    ],
    checks.map((c) => c.detail).join('\n'),
  )
  assert.match(checks[1].detail, /^4 tracked files on main as recorded \(1 by stamped name, 1 by presence\)/)
  // the tree check reads bytes in a Workspace of a Branch forked from main, unmounted without a Commit and closed
  assert.match(client.calls[0], new RegExp(`^fork ${CHECK_PREFIX}`))
  assert.deepEqual(client.calls.slice(1), ['create', `mount ${client.calls[0].slice(5)}`, 'unmount discard=true', 'close 7'])
})

test('differences fail with what differs; one check failing does not stop the next', async () => {
  const { client, backend } = stand({ ...FILES, '/README.md': '# Changed\n', '/extra.txt': 'new\n' }, { sandboxes: [{ sandbox: '3', workspaces: [{}] }] })
  const final = recorded()
  final.history.branches.feature.commits[1].via = 'fs'
  final.history.layers.push({ source: 'feature#0' })
  const checks = await finalChecks({ scenario: 'x', scenarioDir: scenarioDir('differ', final), project: 'p', client, backend })
  assert.deepEqual(
    checks.map((c) => c.ok),
    [false, false, false],
  )
  assert.match(checks[0].detail, /feature#1 "second" was made by exec, recorded fs/)
  assert.match(checks[0].detail, /main has 2 Layers, recorded 3/)
  assert.match(checks[1].detail, /\/README\.md differs/)
  assert.match(checks[1].detail, /\/extra\.txt \([0-9a-f]{12}\) is tracked on main but not in the record/)
  assert.match(checks[2].detail, /Sandbox 3 \(1 Workspace\(s\)\) still runs/)

  const fresh = stand(FILES).client
  const broken = { ...fresh, project: { ...fresh.project, list_branches: async () => Promise.reject(Object.assign(new Error('gone'), { code: 'NoSuchProject' })) } }
  const again = await finalChecks({ scenario: 'x', scenarioDir: scenarioDir('match', recorded()), project: 'p', client: broken, backend })
  assert.deepEqual(again[0], { name: 'final.order', ok: false, detail: 'NoSuchProject: gone' })
  assert.equal(again[1].ok, true)
})

test('an unreadable final.json is one failed check', async () => {
  const dir = scenarioDir('bad')
  writeFileSync(join(dir, 'final.json'), '{"main": {}}')
  const { client } = stand(FILES)
  const checks = await finalChecks({ scenario: 'bad', scenarioDir: dir, project: 'p', client })
  assert.equal(checks.length, 1)
  assert.equal(checks[0].ok, false)
  assert.match(checks[0].detail, /has no main and history/)
})

test('compareHistory: optional Commits may be missing, recorded UpToDate extras may be present', () => {
  const want = {
    layers: [{ source: null }, { source: 'a#1' }],
    branches: {
      a: { forkedFrom: 'L0', commits: [{ message: 'build', via: 'exec', merged: null, optional: true }, { message: 'write', via: 'fs', merged: null }], extras: [{ after: 1, message: 'again' }] },
    },
  }
  const run = {
    layers: [{ source: null }, { source: 'a#0' }],
    branches: { a: { forkedFrom: 'L0', commits: [{ message: 'write', via: 'fs', merged: null }, { message: 'again', via: 'exec', merged: null }] } },
  }
  const failures = compareHistory(want, run)
  assert.deepEqual([...failures], [])
  assert.deepEqual(failures.extras, ['a#1'])
  assert.ok(compareHistory(want, { ...run, branches: {} }).includes('Branch a is missing'))
})

test("compareTree and variesOf on the replays' records", () => {
  for (const id of ['shop', 'depot', 'crew']) {
    const final = readFinal(join(SCENARIOS, id))
    // a run equal to the record passes; one changed file fails once each way
    assert.deepEqual(compareTree(final, final.main).failures, [], id)
    const [first] = Object.keys(final.main).filter((p) => !final.varies.content[p])
    const changed = compareTree(final, { ...final.main, [first]: '0'.repeat(64) })
    assert.equal(changed.failures.length, 2, `${id}: ${changed.failures.join('; ')}`)
    // the record's varies is what variesOf decides from its main
    assert.deepEqual(variesOf(final.main), final.varies, id)
  }
})
