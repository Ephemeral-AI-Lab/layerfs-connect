// Heavy scenarios wait their turn (runs/index.js: isHeavy, play, playNext):
// at most HEAVY_AT_ONCE heavy launches play at once, the rest are queued and
// start, in order, as one ends; light ones always play. Stand-in runs, no
// LayerFS.
//   node --import ./host/resolve-layerfs.js --test host/test/heavy-queue.test.js
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { HEAVY_AT_ONCE, isHeavy, RunManager, WAITING_PHASE } from '../runs/index.js'

const root = mkdtempSync(join(tmpdir(), 'lfc-heavy-test-'))
const spec = { state: root, home: join(root, 'home'), runs: join(root, 'runs'), image: 'sha256:' + '0'.repeat(64), bundle: null, daemon: '/x/layerfs-daemon', docker: '/var/run/docker.sock', prefix: 'lfc-test-', worker: false, think: false }
mkdirSync(spec.runs, { recursive: true })
mkdirSync(join(root, 'scenarios'), { recursive: true })
after(() => rmSync(root, { recursive: true, force: true }))

/** A run that plays until `finish()`; `stop()` ends it while it waits. */
function standIn(id, launch = null) {
  let finish = () => {}
  const run = {
    id,
    launch,
    state: 'starting',
    phase: null,
    started: 1,
    plays: 0,
    changed() {},
    fail() {},
    play() {
      run.plays++
      run.state = 'running'
      return new Promise((resolve) => {
        finish = () => {
          run.state = 'passed'
          resolve()
        }
      })
    },
    finish: () => finish(),
    stop() {
      run.state = 'stopped'
    },
  }
  return run
}

const settle = () => new Promise((resolve) => setImmediate(resolve))

test('heavy: tagged node or rust, or 100 steps or more', () => {
  const demo = (tags, steps) => ({ raw: { tags }, scenario: { counts: { steps } } })
  assert.equal(isHeavy(demo(['cli', 'node'], 17)), true)
  assert.equal(isHeavy(demo(['sdk', 'rust'], 98)), true)
  assert.equal(isHeavy(demo(['sdk', 'multi-agent'], 199)), true)
  assert.equal(isHeavy(demo(['cli', 'merge'], 39)), false)
})

test(`at most ${HEAVY_AT_ONCE} heavy launches play; the next starts when one ends; light ones always play`, async () => {
  const m = new RunManager({ spec, scenarios: join(root, 'scenarios') })
  await m.sweeping
  const launch = (id, heavy, sessions = 1) => {
    const runs = Array.from({ length: sessions }, (_, i) => standIn(`${id}-${i}`, sessions > 1 ? id : null))
    for (const run of runs) m.live.set(run.id, run)
    m.play(runs, heavy)
    return runs
  }
  const heavy = Array.from({ length: HEAVY_AT_ONCE + 2 }, (_, i) => launch(`h${i}`, true))
  const light = launch('light', false, 3)

  const playing = (runs) => runs.every((r) => r.plays === 1)
  for (const runs of heavy.slice(0, HEAVY_AT_ONCE)) assert.ok(playing(runs))
  for (const runs of heavy.slice(HEAVY_AT_ONCE)) {
    assert.equal(runs[0].plays, 0)
    assert.equal(runs[0].queued, true)
    assert.equal(runs[0].phase, WAITING_PHASE)
  }
  assert.ok(playing(light))

  // the first queued is stopped while it waits: it is dropped, and the one after takes its turn
  const [stopped, next] = heavy.slice(HEAVY_AT_ONCE)
  stopped[0].stop()
  heavy[0][0].finish()
  await settle()
  assert.equal(stopped[0].plays, 0)
  assert.ok(playing(next))
  assert.equal(next[0].queued, false)
  assert.equal(next[0].phase, null)
  assert.ok(next[0].started > 1, 'its clock starts when it plays')
  assert.equal(m.heavyPlaying(), HEAVY_AT_ONCE)
  assert.equal(m.queue.length, 0)
})
