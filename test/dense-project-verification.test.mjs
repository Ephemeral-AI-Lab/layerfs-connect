import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { DemoHistory } from './support/demo-history.mjs'
import { projectHistoryPlan, projectHistorySteps, assertProjectStep, resolveHistoryStep } from '../tools/demo/recipe.mjs'
import { verifyProject, savedHistory } from '../tools/demo/project-verification.mjs'
import { runHistoryDAG } from '../tools/demo/history-scheduler.mjs'

let folder, history, receipts
before(() => {
  folder = mkdtempSync(join(tmpdir(), 'dense-history-unit-')); history = new DemoHistory(); receipts = {}
  for (const [path, content] of Object.entries(projectHistoryPlan('design').definition.files)) {
    const file = join(folder, path); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, content)
  }
  history.init('store/design', folder)
  for (const step of projectHistorySteps('store', 'design')) {
    const result = history.invoke(resolveHistoryStep(step, receipts), { input: step.input })
    assertProjectStep(step, result); receipts[step.key] = result
  }
})
after(() => rmSync(folder, { recursive: true, force: true }))

test('one-cycle branch DAG preserves current-head publication barriers and the complete graph', async () => {
  const model = new DemoHistory(), receipts = {}, steps = projectHistorySteps('store', 'design', { cycles: 1 })
  model.init('store/design', folder)
  let earlierPublications = 0
  await runHistoryDAG([{ project: 'store/design', store: 'store', steps }], async (_task, step) => {
    const argv = resolveHistoryStep(step, receipts)
    if (step.commitFrom) {
      await new Promise(resolve => setTimeout(resolve, 2))
      if (model.projects.get('store/design').branches.get(argv[3]).history[0]?.id !== argv[4]) earlierPublications++
    }
    const result = model.invoke(argv, { input: step.input })
    assertProjectStep(step, result); receipts[step.key] = result
  })
  assert.equal(earlierPublications, 0, 'the pinned engine requires publication before the next branch write')
  const result = await verifyProject(async argv => model.invoke(argv), 'store', 'design', { steps: receipts }, { cycles: 1 })
  assert.equal(result.commits, 288); assert.equal(result.layers, 60); assert.equal(result.branches, 15)
  assert.equal(result.merges, 4); assert.equal(result.publications, 59)
  assert.equal(projectHistoryPlan('design').commits, 2400, 'pilot cycle limit must not change the full preset')
})

test('the CLI model refuses publication of an earlier commit after the branch head advances', () => {
  const model = new DemoHistory(); model.init('store/design', folder)
  model.invoke(['branch', 'fork', 'store/design', 'work', 'main'])
  const first = model.invoke(['file', 'write', 'store/design', 'work', '/docs/probe.md'], { input: 'first revision' })
  const second = model.invoke(['file', 'write', 'store/design', 'work', '/docs/probe.md'], { input: 'second revision' })
  assert.throws(() => model.invoke(['branch', 'publish', 'store/design', 'work', first.head]), error => error.code === 'HeadMoved')
  const result = model.invoke(['branch', 'publish', 'store/design', 'work', second.head])
  assert.equal(result.source.commit, second.head)
  assert.equal(model.invoke(['file', 'read', 'store/design', 'main', '/docs/probe.md']).text, 'second revision')
})

test('complete dense graph verification deduplicates ancestry and pins every continuation', async () => {
  const calls = [], query = async argv => { calls.push(argv); return history.invoke(argv) }
  const result = await verifyProject(query, 'store', 'design', { steps: receipts })
  assert.equal(result.commits, 2400); assert.equal(result.layers, 500)
  assert.equal(result.branches, 55); assert.equal(result.merges, 20)
  assert.equal(result.publications, 499); assert.equal(result.publicationReceiptsVerified, true)
  const continuations = calls.filter(argv => argv[0] === 'branch' && argv[1] === 'commits' && Number(argv[argv.indexOf('--page') + 1]) > 1)
  assert.ok(continuations.length > 25)
  for (const argv of continuations) { assert.ok(argv.includes('--at-commit')); assert.equal(argv[argv.indexOf('--page-size') + 1], '20') }
  assert.equal(continuations.filter(argv => argv[3] === 'main').length, 24)
  const withoutReceipts = await verifyProject(query, 'store', 'design')
  assert.equal(withoutReceipts.commits, result.commits); assert.equal(withoutReceipts.publicationReceiptsVerified, false)
})

test('dense verifier rejects missing receipts and forged merge ancestry', async () => {
  const missing = { ...receipts }; delete missing['dense.001.a.write.1']
  await assert.rejects(verifyProject(async argv => history.invoke(argv), 'store', 'design', missing), /expected Committed/)
  const query = async argv => {
    const result = history.invoke(argv)
    if (argv[0] === 'branch' && argv[1] === 'commits' && argv[3] === 'integration-001') for (const item of result.items) if (item.second_parent) item.second_parent = 'forged-second-parent'
    return result
  }
  await assert.rejects(verifyProject(query, 'store', 'design'), /merge did not preserve/)
})

test('dense verifier rejects saved publication displacement and altered final content', async () => {
  await assert.rejects(verifyProject(async argv => {
    const result = history.invoke(argv)
    if (argv[0] === 'branch' && argv[1] === 'commits' && argv[3] === 'main' && result.items[0]?.source_commit) result.items[0].overwrote_count = 1
    return result
  }, 'store', 'design'), /overwrote main Layers/)
  await assert.rejects(verifyProject(async argv => {
    const result = history.invoke(argv)
    if (argv[0] === 'file' && argv[1] === 'read' && argv[3] === 'main') result.text = 'changed bytes'
    return result
  }, 'store', 'design'), /saved content does not match/)
})

test('saved history refuses incomplete or moving pagination instead of partial success', async () => {
  await assert.rejects(savedHistory(async () => ({ items: [], scan: { complete: false } }), 'store/design', 'main'), /incomplete saved history/)
  let count = 0
  await assert.rejects(savedHistory(async () => ({ items: [{ id: `layer-${++count}` }], at_commit: { id: count === 1 ? 'anchor-one' : 'anchor-two' }, has_more: count === 1 }), 'store/design', 'main'), /anchor moved/)
  await assert.rejects(savedHistory(async () => ({ items: [{ id: 'same' }], at_commit: { id: 'anchor' }, has_more: true }), 'store/design', 'main'), /duplicate or missing/)
})

test('the history model rejects writes into missing parent directories', () => {
  assert.throws(() => history.invoke(['file', 'write', 'store/design', 'main', '/missing-parent/nested/file.json'], { input: '{}' }), error => error.code === 'NoSuchPath')
})

test('main glob inventory includes parent directories and rejects unrelated paths', async () => {
  const paths = [], query = async argv => {
    const result = history.invoke(argv)
    if (argv[0] === 'file' && argv[1] === 'glob') paths.push(...result.items)
    return result
  }
  await verifyProject(query, 'store', 'design')
  assert.ok(paths.includes('/docs'))
  assert.ok(paths.includes('/tokens'))
  await assert.rejects(verifyProject(async argv => {
    const result = history.invoke(argv)
    if (argv[0] === 'file' && argv[1] === 'glob' && argv[argv.indexOf('--page-pos') + 1] === '0') result.items.push('/unexpected-directory')
    return result
  }, 'store', 'design'), /main file and directory inventory does not match/)
})
