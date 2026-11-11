import test from 'node:test'
import assert from 'node:assert/strict'
import { runBounded } from '../tools/demo/scheduler.mjs'

test('all eight independent project histories can start before any finishes', async () => {
  const projects = Array.from({ length: 8 }, (_, index) => `project-${index}`)
  let active = 0, peak = 0, release
  const gate = new Promise(resolve => { release = resolve }), started = [], finished = []
  const work = runBounded(projects, 8, async project => {
    peak = Math.max(peak, ++active); started.push(project)
    if (started.length === projects.length) release()
    await gate
    finished.push(project); active--
  })
  await work
  assert.equal(peak, 8); assert.equal(active, 0)
  assert.deepEqual(started, projects)
  assert.deepEqual(finished.sort(), projects)
})

test('first failure stops admission and waits for a running sibling before returning', async () => {
  let release, started, settled = false; const events = []
  const sibling = new Promise(resolve => { release = resolve })
  const ready = new Promise(resolve => { started = resolve })
  const failure = new Error('failed store')
  const work = runBounded(['a', 'b', 'never'], 2, async store => {
    events.push(store)
    if (store === 'a') { await ready; throw failure }
    started(); await sibling; events.push('b settled')
  }).catch(error => { settled = true; throw error })
  await ready; await new Promise(resolve => setImmediate(resolve))
  assert.equal(settled, false)
  release(); await assert.rejects(work, error => error === failure)
  assert.deepEqual(events, ['a', 'b', 'b settled'])
})

test('eight-worker failure drains every admitted sibling and never starts queued projects', async () => {
  const projects = Array.from({ length: 10 }, (_, index) => `project-${index}`)
  let releaseSiblings, allStarted, settled = false
  const siblings = new Promise(resolve => { releaseSiblings = resolve })
  const ready = new Promise(resolve => { allStarted = resolve })
  const started = [], finished = [], failure = new Error('history write failed')
  const work = runBounded(projects, 8, async project => {
    started.push(project)
    if (started.length === 8) allStarted()
    await ready
    if (project === 'project-0') throw failure
    await siblings
    finished.push(project)
  }).catch(error => { settled = true; throw error })
  await ready; await new Promise(resolve => setImmediate(resolve))
  assert.equal(settled, false)
  assert.deepEqual(started, projects.slice(0, 8))
  releaseSiblings()
  await assert.rejects(work, error => error === failure)
  assert.deepEqual(finished.sort(), projects.slice(1, 8))
  assert.deepEqual(started, projects.slice(0, 8))
})
