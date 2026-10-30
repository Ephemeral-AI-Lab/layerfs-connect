// Two scenarios played at once on the real LayerFS, on one throwaway project
// this file makes in Connect's home (an Init of fixtures/demo-workspace) and
// removes at the end: each plays in a folder /<scenario>_<n>/ of its own, on
// its own trunk, Branches and Sandboxes (runs/scope.js), passes its checks and
// lands on main. Run records go to a temporary folder; steps do not pause.
// It needs the home's settings and, on macOS, its running worker.
//   node --import ./host/resolve-layerfs.js --test host/test/scenario-real.test.js
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as pause } from 'node:timers/promises'
import { after, before, test } from 'node:test'
import { LayerFS } from '@layerfs/agent'
import { APP, openRuntime, resolveSpec, withProjectEnv } from '../config.js'
import { RunManager } from '../runs/index.js'

const NAME = `connect-scenarios-${process.pid}`
const runsDir = mkdtempSync(join(tmpdir(), 'connect-scenario-real-'))
const spec = { ...resolveSpec(), runs: runsDir, think: false }
let runtime
let project
let runs

before(async () => {
  runtime = await openRuntime(spec)
  let job = await runtime.project.start_init(NAME, join(APP, 'fixtures', 'demo-workspace'), {})
  while (!job.ended) {
    await pause(250)
    job = await runtime.project.get_init(job.id)
  }
  assert.equal(job.step, 'done', job.error?.message)
  project = job.project
  runs = new RunManager({ spec })
})

after(async () => {
  await runs?.close()
  await runtime.project.delete(NAME, { confirm: NAME, stopSandboxes: true })
  await runtime.close()
  rmSync(runsDir, { recursive: true, force: true })
})

test('two scenarios play on one project at once, each in its own folder, and both land on main', async () => {
  const started = await Promise.all(['merge', 'tour'].map((id) => runs.start(id, { project: NAME })))
  await Promise.all(started.map((r) => runs.live.get(r.id).finished))
  const details = started.map((r) => runs.run(r.id))
  for (const d of details) {
    const failed = [...d.checks.filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail}`), ...d.steps.filter((s) => s.state === 'failed').map((s) => `${s.agent} ${s.index}: ${s.checks?.find((c) => !c.ok)?.detail ?? s.state}`)]
    assert.equal(d.state, 'passed', `${d.demo}: ${d.error ?? ''} ${failed.join('; ')}`)
    assert.equal(d.kind, 'replay')
    assert.equal(d.project, NAME)
    assert.equal(d.folder, `${d.demo}_1`)
    assert.ok(d.checks.some((c) => c.name === 'main.landed' && c.ok), `${d.demo} landed on main`)
  }
  const lf = await withProjectEnv(spec, project, () => LayerFS.open(NAME))
  try {
    const names = (await lf.project.list_branches(1000, 0)).items.map((b) => b.name)
    for (const run of ['merge_1', 'tour_1']) {
      assert.ok(names.includes(`${run}.main`), `${run}'s trunk`)
      assert.ok(names.includes(`${run}.landed`), `${run}'s landing`)
      // the run's folder is on main
      const listed = await lf.fs.list('main', `/${run}`, 1000, 0)
      assert.ok((listed.items ?? listed.entries ?? []).length > 0, `/${run} on main: ${JSON.stringify(listed).slice(0, 200)}`)
    }
    // every Sandbox a run opened was closed
    assert.deepEqual((await lf.project.list_sandboxes(1000, 0)).items, [])
  } finally {
    await lf.close()
  }
})
