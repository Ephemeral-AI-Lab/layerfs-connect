import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { StorageObservations, OBSERVATION_GAP_MS } from '../storage-observations.js'
import { Projects, commitInfo } from '../projects.js'
import { stringify } from '../cli/json.js'
import { createHostServer, listen, newToken } from '../server.js'

const layer = `32${'a'.repeat(64)}`, commit = `12${'c'.repeat(64)}`
const stats = { store_id: 'opaque-a', store_generation: 10, kind: 'sqlite', canonical: 9007199254740993n, stored: 40, database_page_bytes: 4096, data_pack_bytes: 40, metadata_pack_bytes: 100, database_overhead_bytes: 3956, free_page_bytes: 0, composition_complete: true }
async function fixture(t) {
  const state = await mkdtemp(join(tmpdir(), 'connect-storage-observations-'))
  t.after(() => rm(state, { recursive: true, force: true }))
  return { state, home: join(state, 'home-2') }
}

test('observation history starts empty, survives restart and retains exact bytes with real observation gaps', async t => {
  const spec = await fixture(t)
  let now = 1000
  const observations = new StorageObservations(spec, { now: () => now })
  assert.deepEqual((await observations.read('studio')).series, [])
  await observations.record('studio', stats, { machine: 'native', created: 10 })
  now += OBSERVATION_GAP_MS + 1
  await observations.record('studio', { ...stats, stored: 80 }, { machine: 'native', created: 10 })
  const resumed = new StorageObservations(spec)
  const journal = await resumed.read('studio')
  assert.equal(journal.series.length, 1)
  assert.equal(journal.series[0].points[1].observedAt - journal.series[0].points[0].observedAt, OBSERVATION_GAP_MS + 1)
  assert.deepEqual(journal.series[0].points[0].stats.canonical, { $layerfs: 'i64-v1', decimal: '9007199254740993' })
  assert.equal(journal.series[0].points[1].stats.stored, 80)
  assert.match(await readFile(observations.path('studio'), 'utf8'), /9007199254740993/)
})

test('recreation, restore generation, route changes and different homes never join one disk line', async t => {
  const spec = await fixture(t), observations = new StorageObservations(spec)
  const record = { machine: 'native', created: 10 }
  await observations.record('studio', stats, record)
  await observations.record('studio', { ...stats, store_id: 'opaque-b' }, record)
  await observations.record('studio', { ...stats, store_generation: 11 }, record)
  await observations.record('studio', { ...stats, store_generation: 11 }, { ...record, machine: 'lima1' })
  assert.equal((await observations.read('studio')).series.length, 4)
  assert.deepEqual((await observations.read('another')).series, [])
  assert.deepEqual((await new StorageObservations({ ...spec, home: join(spec.state, 'another-home') }).read('studio')).series, [])
  await assert.rejects(observations.record('studio', { stored: 42 }, record), /identity/)
  assert.equal((await observations.read('studio')).series.length, 4)
})

test('concurrent explicit reads persist all samples, enforce bounded retention and expire old history', async t => {
  const spec = await fixture(t)
  let now = 1
  const observations = new StorageObservations(spec, { now: () => now })
  await Promise.all(Array.from({ length: 1003 }, (_, stored) => observations.record('studio', { ...stats, stored }, { machine: 'native' })))
  let journal = await observations.read('studio')
  assert.equal(journal.series[0].points.length, 1000)
  assert.equal(journal.series[0].points[0].stats.stored, 3)
  now += 91 * 86400000
  await observations.record('studio', stats, { machine: 'native' })
  journal = await observations.read('studio')
  assert.equal(journal.series[0].points.length, 1)
})

test('measurement remains successful when observation identity is unavailable; failed measurement adds no samples', async t => {
  const spec = await fixture(t)
  const client = { store: { stats: async () => ({ stored: 42 }), get: async () => ({ created: 1 }) } }
  const projects = new Projects({ spec, client })
  const measured = await projects.storeStats('studio')
  assert.equal(measured.stored, 42)
  assert.match(measured.observationError, /identity/)
  client.store.stats = async () => { throw Object.assign(new Error('Store busy'), { code: 'Busy' }) }
  await assert.rejects(projects.storeStats('studio'), { code: 'Busy' })
  assert.deepEqual((await projects.storeObservations('studio')).series, [])
})

test('saved allocation metadata distinguishes Layers from Commits, missing counters from zero and exact i64 values', () => {
  const l = commitInfo({ id: layer, logical: 0 }, 'main')
  assert.equal(l.savedKind, 'layer'); assert.equal(l.timeStatus, 'unavailable'); assert.equal(l.newCanonical, null)
  const c = commitInfo({ id: commit, parent: layer, time: 100, new_canonical: 9007199254740993n, new_stored: 0 }, 'work')
  assert.equal(c.savedKind, 'commit'); assert.equal(c.timeStatus, 'recorded'); assert.equal(c.newStored, 0); assert.equal(c.newMetadata, null)
  assert.equal(c.parentRef.kind, 'Layer')
  assert.deepEqual(JSON.parse(stringify(c)).newCanonical, { $layerfs: 'i64-v1', decimal: '9007199254740993' })
})

test('storage history is bounded, pinned and metadata-only across pages', async t => {
  const spec = await fixture(t), calls = []
  const projects = new Projects({ spec, client: { branch: {
    commits: async (...args) => { calls.push(args); return { at_commit: { id: commit, kind: 'Commit', branch: 'main' }, items: [{ id: commit, parent: layer, new_stored: 5 }], has_more: true } },
  } } })
  const page = await projects.storageHistory('studio/site', new URLSearchParams({ at: commit, size: '20' }))
  assert.equal(page.head.id, commit); assert.equal(page.next, layer); assert.equal(page.items[0].newStored, 5)
  assert.deepEqual(calls[0], ['studio/site', 'main', { page: 1, page_size: 20, include_storage: true, at_commit: commit }])
  await projects.storageHistory('studio/site', new URLSearchParams({ at: page.next }))
  assert.equal(calls[1][2].at_commit, layer)
  await assert.rejects(projects.storageHistory('studio/site', new URLSearchParams({ size: '101' })), /size/)
  await assert.rejects(projects.storageHistory('studio/site', new URLSearchParams({ at: 'short' })), /full 66-hex/)
})

test('HTTP storage graph routes preserve exact integers in metadata and persisted observations', async t => {
  const spec = await fixture(t)
  const projects = new Projects({ spec, client: {
    store: { stats: async () => stats, get: async () => ({ machine: 'native' }) },
    branch: { commits: async () => ({ items: [{ id: commit, parent: layer, logical: 9007199254740995n, new_canonical: 9007199254740993n }], has_more: false }) },
  } })
  const token = newToken(), server = createHostServer({ token, projects, storage: {}, runs: () => null })
  const url = await listen(server, 0)
  t.after(() => new Promise(resolve => server.close(resolve)))
  const get = async path => {
    const response = await fetch(`${url}${path}`, { headers: { authorization: `Bearer ${token}` } })
    assert.equal(response.status, 200)
    return response.json()
  }
  const measured = await get('/api/stores/studio/stats')
  assert.deepEqual(measured.canonical, { $layerfs: 'i64-v1', decimal: '9007199254740993' })
  const observed = await get('/api/stores/studio/observations')
  assert.deepEqual(observed.series[0].points[0].stats.canonical, measured.canonical)
  const history = await get(`/api/projects/${encodeURIComponent('studio/site')}/storage-history?branch=main`)
  assert.deepEqual(history.items[0].logical, { $layerfs: 'i64-v1', decimal: '9007199254740995' })
  assert.deepEqual(history.items[0].newCanonical, measured.canonical)
})

test('bounded report selects pinned saved metadata and preserves incomplete results without estimates', async t => {
  const spec = await fixture(t), calls = []
  const report = { definition_version: 1, population_id: 'population-a', population: 'explicit_saved_snapshots', snapshots: [], complete: false, reason: 'object budget', referenced_canonical_bytes: null, unique_canonical_bytes: null, projects: [], physical_bytes: null, reclaimable_bytes: null, physical_reason: 'No physical attribution' }
  const projects = new Projects({ spec, client: {
    branch: { commits: async (...args) => { calls.push(['commits', ...args]); return { at_commit: { id: commit, kind: 'Commit', branch: 'main' }, items: [{ id: commit, parent: layer }], has_more: true } } },
    project: { storage_report: async (...args) => { calls.push(['report', ...args]); return report } },
  } })
  const result = await projects.storageReport('studio/site', new URLSearchParams({ at: commit }))
  assert.equal(result.complete, false); assert.equal(result.unique_canonical_bytes, null); assert.equal(result.physical_bytes, null)
  assert.deepEqual(result.selection, { scope: 'project_saved_revisions', limit: 20, selected: 1, hasEarlier: true, head: { id: commit, kind: 'Commit', branch: 'main' } })
  assert.deepEqual(calls[0], ['commits', 'studio/site', 'main', { page: 1, page_size: 20, at_commit: commit }])
  assert.deepEqual(calls[1], ['report', 'studio/site', [{ branch: 'main', commit }], { max_objects: 10000, max_canonical_bytes: 67108864 }])
  await assert.rejects(projects.storageReport('studio/site', new URLSearchParams({ size: '21' })), /size/)
  projects.lfs.project.storage_report = undefined
  await assert.rejects(projects.storageReport('studio/site', new URLSearchParams()), { code: 'Unsupported', status: 501 })
})

test('Store observations retain independently measured SQLite file and WAL lengths, never substitute page accounting', async t => {
  const spec = await fixture(t)
  const client = { store: {
    stats: async () => stats, get: async () => ({ machine: 'native' }),
    status: async () => ({ file: { exists: true, bytes: 12288, wal_bytes: 9007199254740993n, incoming_bytes: 0 } }),
  } }
  const projects = new Projects({ spec, client })
  const result = await projects.storeStats('studio')
  assert.equal(result.database_page_bytes, 4096)
  assert.equal(result.fileMeasurements.bytes, 12288)
  assert.equal(result.fileMeasurements.walBytes, 9007199254740993n)
  let points = (await projects.storeObservations('studio')).series[0].points
  assert.deepEqual(points[0].stats.fileMeasurements.walBytes, { $layerfs: 'i64-v1', decimal: '9007199254740993' })
  client.store.status = async () => { throw Object.assign(new Error('Worker unavailable'), { code: 'Unavailable' }) }
  const unavailable = await projects.storeStats('studio')
  assert.equal(unavailable.database_page_bytes, 4096); assert.equal(unavailable.fileMeasurements, null)
  assert.equal(unavailable.fileMeasurementError, 'Worker unavailable')
  points = (await projects.storeObservations('studio')).series[0].points
  assert.equal(points.length, 2)
  assert.equal(points[1].stats.fileMeasurements, null)
})

test('Store analysis captures bounded real main heads and reports excluded projects, rather than all retained history', async t => {
  const spec = await fixture(t), calls = [], names = Array.from({ length: 23 }, (_, n) => `p${String(n).padStart(2, '0')}`)
  const projects = new Projects({ spec, client: {
    store: {
      get: async name => { calls.push(['get', name]); return { projects: [...names].reverse() } },
      storage_report: async (...args) => { calls.push(['report', ...args]); return { scope: 'store', name: 'studio', complete: true, physical_bytes: null } },
    },
    branch: { get: async (...args) => { calls.push(['head', ...args]); return { saved_head: { id: layer, kind: 'Layer' } } } },
  } })
  const result = await projects.storeStorageReport('studio', new URLSearchParams())
  assert.equal(result.selection.scope, 'store_main_heads')
  assert.equal(result.selection.selected, 20); assert.equal(result.selection.availableProjects, 23); assert.equal(result.selection.excludedProjects, 3)
  assert.deepEqual(result.selection.projects, names.slice(0, 20).map(name => `studio/${name}`))
  const report = calls.at(-1)
  assert.deepEqual(report.slice(0, 2), ['report', 'studio'])
  assert.equal(report[2].length, 20)
  assert.deepEqual(report[2][0], { project: 'studio/p00', branch: 'main', commit: layer })
  assert.deepEqual(report[3], { max_objects: 10000, max_canonical_bytes: 67108864 })
  assert.equal(calls.filter(call => call[0] === 'head').length, 20)
  calls.length = 0
  const subset = await projects.storeStorageReport('studio', new URLSearchParams([['project', 'p22'], ['project', 'p02']]))
  assert.deepEqual(subset.selection.projects, ['studio/p02', 'studio/p22'])
  assert.equal(subset.selection.excludedProjects, 21)
  assert.equal(calls.filter(call => call[0] === 'head').length, 2)
  await assert.rejects(projects.storeStorageReport('studio', new URLSearchParams({ project: 'foreign' })), /does not belong/)
  await assert.rejects(projects.storeStorageReport('studio', new URLSearchParams([['project', 'p02'], ['project', 'p02']])), /distinct/)
  projects.lfs.store.storage_report = undefined
  await assert.rejects(projects.storeStorageReport('studio', new URLSearchParams({ project: 'p02' })), { code: 'Unsupported', status: 501 })
})

test('Store analysis HTTP route retains explicit project selection and requires an explicit authenticated GET', async t => {
  const calls = [], token = newToken()
  const server = createHostServer({ token, storage: {}, projects: { storeStorageReport: async (name, query) => { calls.push([name, query.getAll('project')]); return { scope: 'store', name, complete: false, physical_bytes: null } } }, runs: () => null })
  const url = await listen(server, 0)
  t.after(() => new Promise(resolve => server.close(resolve)))
  const path = '/api/stores/studio/storage-report?project=one&project=two'
  assert.equal((await fetch(url + path)).status, 401)
  assert.deepEqual(calls, [])
  const response = await fetch(url + path, { headers: { authorization: `Bearer ${token}` } })
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { scope: 'store', name: 'studio', complete: false, physical_bytes: null })
  assert.deepEqual(calls, [['studio', ['one', 'two']]])
})

test('explicit reports request same-population encoding only when the pinned CLI advertises it', async t => {
  const spec = await fixture(t), calls = []
  let supported = true
  const payload = { definition_version: 1, population: 'selected_payload_object_records', available: true, referenced_canonical_bytes: 100, unique_canonical_bytes: 60, encoded_record_bytes: 30, dependency_closure_included: false, shared_framing_included: false }
  const projects = new Projects({ spec, client: {
    supportsOption: async (...args) => { calls.push(['capability', ...args]); return supported },
    project: { storage_report: async (...args) => { calls.push(['project', ...args]); return { scope: 'project', project: 'studio/site', payload_encoding: payload } } },
    store: { get: async () => ({ projects: ['site'] }), storage_report: async (...args) => { calls.push(['store', ...args]); return { scope: 'store', name: 'studio', payload_encoding: payload } } },
    branch: { get: async () => ({ saved_head: { id: layer } }), commits: async () => ({ at_commit: { id: layer, kind: 'Layer', branch: 'main' }, items: [{ id: layer }], has_more: false }) },
  } })
  assert.deepEqual((await projects.storageReport('studio/site', new URLSearchParams())).payload_encoding, payload)
  assert.deepEqual(calls.find(row => row[0] === 'project').at(-1), { max_objects: 10000, max_canonical_bytes: 67108864, include_encoding: true })
  calls.length = 0
  assert.deepEqual((await projects.storeStorageReport('studio', new URLSearchParams())).payload_encoding, payload)
  assert.deepEqual(calls.find(row => row[0] === 'store').at(-1), { max_objects: 10000, max_canonical_bytes: 67108864, include_encoding: true })
  supported = false; calls.length = 0
  await projects.storageReport('studio/site', new URLSearchParams())
  assert.deepEqual(calls.find(row => row[0] === 'project').at(-1), { max_objects: 10000, max_canonical_bytes: 67108864 })
})
