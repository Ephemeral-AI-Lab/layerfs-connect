import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { alignAttribution } from '../src/renderer/src/components/files/attribution-model.ts'
import { layoutNodes } from '../src/renderer/src/components/history/model.ts'

// Compile the renderer adapter with its fixture import resolved; no host or SDK is started.
const attributionUrl = new URL('../src/renderer/src/components/files/attribution-model.ts', import.meta.url).href
const fixtureSource = readFileSync(new URL('../src/renderer/src/components/files/file-preview-data.ts', import.meta.url), 'utf8').replace('./attribution-model', attributionUrl)
const fixtureCompiled = ts.transpileModule(fixtureSource, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } }).outputText
const dataUrl = `data:text/javascript;base64,${Buffer.from(fixtureCompiled).toString('base64')}`
const { previewAttribution, previewChanges, previewComparisonChanges, previewCommits, previewHead, previewOwn, previewDiff, previewBlame } = await import(dataUrl)
const source = readFileSync(new URL('../src/renderer/src/components/history/preview-model.ts', import.meta.url), 'utf8').replace('@/components/files/file-preview-data', dataUrl)
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } }).outputText
const { previewGraph, previewGroupId, previewGroupCommits, previewParent } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)

test('collapsed and expanded sample graphs preserve every commit and all parent endpoints', () => {
  for (const expanded of [false, true]) {
    const graph = previewGraph(expanded)
    assert.deepEqual(graph.nodes.flatMap(n => n.commits.map(c => c.id)).sort(), previewCommits.map(c => c.id).sort())
    assert.equal(graph.nodes.filter(n => n.kind === 'layer').length, 3)
    const layout = layoutNodes(graph.nodes, graph.lanes, 1000, 240)
    for (const n of layout.positioned) if (n.parent) assert.ok(layout.points.get(n.parent).x < n.x)
    assert.equal(layout.points.get(previewHead('main').id).y, layout.center)
    for (const c of previewGroupCommits) assert.equal(layout.points.get(c.id).id, expanded ? c.id : previewGroupId)
  }
})

test('a net group comparison spans the first parent through the final grouped commit', () => {
  const before = previewParent(previewGroupCommits[0])
  const after = previewGroupCommits.at(-1)
  assert.deepEqual(previewChanges(before, after).map(c => [c.kind, c.path]), [
    ['Added', '/src/auth.js'], ['Modified', '/src/routes/login.js'], ['Added', '/test/login.test.js'],
  ])
  assert.equal(previewChanges(previewParent(after), after).length, 1, 'a group must not silently become only its final commit diff')
})

test('comparisons support empty-tree origins, reversed deletions and identical saved versions', () => {
  const origin = previewOwn('main').at(-1)
  assert.ok(previewChanges(null, origin).every(c => c.kind === 'Added'))
  assert.ok(previewChanges(origin, null).every(c => c.kind === 'Removed'))
  assert.deepEqual(previewChanges(origin, origin), [])
  const main = previewHead('main'), feature = previewHead('feature-login')
  assert.equal(previewChanges(main, feature).find(c => c.path === '/src/auth.js').kind, 'Added')
  assert.equal(previewChanges(feature, main).find(c => c.path === '/src/auth.js').kind, 'Removed')
})

test('shared diff input reconstructs both versions and blame preserves inherited main origins', () => {
  const path = '/src/routes/login.js'
  const main = previewHead('main'), feature = previewHead('feature-login')
  const lines = previewDiff(main.tree[path].text, feature.tree[path].text)
  assert.equal(lines.filter(l => l.op !== '+').map(l => l.text).join('\n') + '\n', main.tree[path].text)
  assert.equal(lines.filter(l => l.op !== '-').map(l => l.text).join('\n') + '\n', feature.tree[path].text)
  const owners = previewBlame(feature, path)
  assert.equal(owners[0].owner.message, 'Verify tokens against the store')
  assert.equal(owners.find(l => l.text.includes('export function login')).owner.operation, 'Init')
  assert.equal(owners.find(l => l.text.includes('Content-Type')).owner.id, main.source)
})

test('identical content across different histories exposes attribution-only paths and owners', () => {
  const main = previewHead('main'), review = previewHead('review-login'), path = '/src/routes/login.js'
  assert.equal(main.tree[path].text, review.tree[path].text)
  assert.equal(previewChanges(main, review).some(c => c.path === path), false)
  const changed = previewAttribution(main, review, path).filter(line => line.ownerChanged)
  assert.equal(changed.length, 2)
  assert.ok(changed.every(line => line.op === ' ' && line.before.id === main.source && line.after.branch === 'review-login'))
  const entry = previewComparisonChanges(main, review).find(c => c.path === path)
  assert.equal(entry.kind, 'Attribution')
  assert.equal(entry.content, false)
  assert.equal(entry.attributionLines, 2)
})

test('publishing a source commit does not create a different blame owner for identical text', () => {
  const main = previewHead('main'), source = previewCommits.find(c => c.id === main.source)
  assert.equal(previewAttribution(main, source, '/src/routes/login.js').some(line => line.ownerChanged), false)
})

test('missing blame windows remain unknown; text additions do not count as attribution-only changes', () => {
  const owner = { id: 'saved-id', branch: 'work', message: 'save' }
  const unknown = alignAttribution([{ op: ' ', text: 'same', left: 1, right: 1 }], [], [{ owner }])[0]
  assert.equal(unknown.ownerChanged, null)
  const added = alignAttribution([{ op: '+', text: 'new', left: null, right: 1 }], [], [{ owner }])[0]
  assert.equal(added.ownerChanged, false)
})
