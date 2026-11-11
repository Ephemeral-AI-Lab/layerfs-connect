import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

let directory, ChatListIndex, ReadFlights
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'connect-front-perf-'))
  for (const name of ['chat-list-state', 'read-flights']) {
    const source = await readFile(new URL(`../desktop/src/renderer/src/layerfs/${name}.ts`, import.meta.url), 'utf8')
    await writeFile(join(directory, `${name}.mjs`), ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText)
  }
  ;({ ChatListIndex } = await import(pathToFileURL(join(directory, 'chat-list-state.mjs'))))
  ;({ ReadFlights } = await import(pathToFileURL(join(directory, 'read-flights.mjs'))))
})
after(async () => { await rm(directory, { recursive: true, force: true }) })
const chat = (id, created, updated = created, state = 'running') => ({ id, title: id, cwd: '/tmp', project: `store/${id}`, created, updated, state, provider: 'simulation', modelId: 'scripted', error: null })
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }

test('live tool updates cannot rotate running sidebar conversations or their project order', () => {
  const index = new ChatListIndex()
  index.merge([chat('a', 10), chat('b', 20)])
  const originalB = index.list()[0]
  for (let updated = 100; updated < 200; updated++) index.merge([chat(updated % 2 ? 'a' : 'b', updated % 2 ? 10 : 20, updated)])
  assert.deepEqual(index.list().map(c => c.id), ['b', 'a'])
  assert.deepEqual([...new Set(index.list().map(c => c.project))], ['store/b', 'store/a'])
  index.merge([chat('a', 10, 500, 'idle')])
  assert.deepEqual(index.list().map(c => c.id), ['a', 'b'], 'Completion may update recent ordering once')
  const unchangedB = index.list()[1]
  index.merge([chat('a', 10, 501, 'idle')])
  assert.equal(index.list()[1], unchangedB, 'Unchanged rows retain their identity')
  assert.notEqual(unchangedB, originalB)
})

test('sidebar summaries discard histories and reject stale refreshes without hiding new sessions', () => {
  const index = new ChatListIndex()
  index.merge([{ ...chat('a', 10, 100), messages: ['large transcript'], children: ['large child'], tools: ['bash'] }])
  index.merge([chat('a', 10, 90, 'idle'), chat('b', 20)])
  assert.equal(index.list().find(c => c.id === 'a').state, 'running')
  assert.equal(Object.hasOwn(index.list()[1], 'messages'), false)
  assert.equal(Object.hasOwn(index.list()[1], 'children'), false)
  assert.deepEqual(index.list().map(c => c.id), ['b', 'a'])
  index.remove('b'); assert.equal(index.list().length, 1)
})

test('concurrent background page readers share one request without a redundant follow-up', async () => {
  const reads = new ReadFlights(), gate = deferred(); let calls = 0
  const run = () => { calls++; return gate.promise }
  const requests = Array.from({ length: 20 }, () => reads.read('/inventory', run))
  assert.equal(calls, 1)
  gate.resolve('current')
  assert.deepEqual(await Promise.all(requests), Array(20).fill('current'))
  await reads.read('/inventory', async () => { calls++; return 'later' })
  assert.equal(calls, 2, 'Subsequent polling still reads current facts')
})

test('mutation invalidation and explicit Refresh preserve a fresh read while unrelated pages remain independent', async () => {
  const reads = new ReadFlights(), old = deferred(); let calls = 0
  const first = reads.read('/project', () => old.promise)
  reads.invalidate()
  const second = reads.read('/project', async () => { calls++; return 'after mutation' })
  const shared = reads.read('/project', async () => { throw new Error('Redundant request') })
  assert.equal(await reads.read('/machines', async () => 'independent'), 'independent')
  old.resolve('before mutation')
  assert.equal(await first, 'before mutation')
  assert.equal(await second, 'after mutation')
  assert.equal(await shared, 'after mutation')
  assert.equal(calls, 1)
  const stale = deferred(), inFlight = reads.read('/project', () => stale.promise)
  const manual = reads.read('/project', async () => 'explicit refresh', true)
  stale.resolve('poll')
  assert.equal(await inFlight, 'poll')
  assert.equal(await manual, 'explicit refresh')
})
