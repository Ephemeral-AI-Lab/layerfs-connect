import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { DemoHistory } from './support/demo-history.mjs'
import { projectHistoryPlan, projectHistorySteps, resolveHistoryStep, assertProjectStep } from '../tools/demo/recipe.mjs'
import { verifyProject } from '../tools/demo/project-verification.mjs'
import { runHistoryDAG } from '../tools/demo/history-scheduler.mjs'

// Execute the generated shell bodies against real files. The strict saved-graph
// model only sees the resulting bytes, rather than trusting recipe expectations.
test('mixed workspace shell edits preserve exact bytes, independent branch graphs and publication provenance', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mixed-project-proof-'))
  const model = new DemoHistory(), receipts = {}, sessions = new Map()
  const options = { executionMode: 'mixed', cycles: 1 }, project = 'store/design'
  const writeTree = (folder, files) => { for (const [path, content] of Object.entries(files)) { mkdirSync(dirname(join(folder, path)), { recursive: true }); writeFileSync(join(folder, path), content) } }
  const readTree = folder => Object.fromEntries(readdirSync(folder, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile()).map(entry => { const file = join(entry.parentPath, entry.name); return [file.slice(folder.length + 1), readFileSync(file, 'utf8')] }))
  try {
    const initial = join(root, 'source'); writeTree(initial, projectHistoryPlan('design', options).definition.files); model.init(project, initial)
    let workspaceCommits = 0
    const steps = projectHistorySteps('store', 'design', options)
    await runHistoryDAG([{ project, store: 'store', steps }], async (_task, step) => {
      const argv = resolveHistoryStep(step, receipts), [family, call, ref] = argv
      let result
      if (family === 'sandbox') result = { name: ref }
      else if (family === 'workspace' && call === 'mount') {
        const branch = argv[3], name = argv.at(-1), folder = join(root, name)
        writeTree(folder, model.projects.get(project).branches.get(branch).files)
        sessions.set(`${ref}:${name}`, { branch, folder }); result = { kind: 'Mounted' }
      } else if (family === 'workspace' && call === 'exec') {
        execFileSync('/bin/bash', ['-c', argv[3]], { cwd: sessions.get(ref).folder })
        result = { kind: 'exit:0', exit_code: 0 }
      } else if (family === 'workspace' && call === 'commit') {
        const { branch, folder } = sessions.get(ref), tree = readTree(folder)
        const before = model.projects.get(project).branches.get(branch).files
        const changes = Object.entries(tree).filter(([path, content]) => content !== before[path])
        assert.equal(changes.length, 1, 'one converted revision saves precisely one file change')
        const [path, content] = changes[0]
        result = model.invoke(['file', 'write', project, branch, `/${path}`, '--message', argv.at(-1)], { input: content })
        workspaceCommits++
      } else if (family === 'workspace' && call === 'unmount') {
        sessions.delete(ref); result = { kind: 'Unmounted' }
      } else result = model.invoke(argv, { input: step.input })
      assertProjectStep(step, result); receipts[step.key] = result
    })
    const proof = await verifyProject(async argv => model.invoke(argv), 'store', 'design', { steps: receipts }, options)
    assert.equal(workspaceCommits, 96); assert.equal(sessions.size, 0)
    assert.equal(proof.commits, 288); assert.equal(proof.layers, 60)
    assert.equal(proof.branches, 15); assert.equal(proof.publicationReceiptsVerified, true)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
