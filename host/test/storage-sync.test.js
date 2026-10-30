// storage-sync.js: the sync state of one link (docs/ui/storage-links.md §4,
// layerfs#509), one case per row in its order; the two sides; the last known
// state after a failed check; a Store's state from its link; and the
// transfer rate and ETA of storage-redesign §5.2. Pure functions; no LayerFS.
//   node --test host/test/storage-sync.test.js
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { linkInfo, localSide, nextRate, remoteSide, SEVERITY, storeSync, syncState } from '../storage-sync.js'

const side = (s, reason = null) => ({ side: s, reason })
const WHERE = 'minio-lab / team-examples'
const state = (o) =>
  syncState({ store: 'work', where: WHERE, local: side('unknown', 'local reason'), remoteSide: side('unknown', 'remote reason'), localHeads: null, remoteHeads: null, transferring: false, checking: false, checked: true, ...o })

test('§4: a job running on the Store is transferring, whatever else holds', () => {
  assert.equal(state({ transferring: true, remoteSide: side('missing'), local: side('changed') }).sync, 'transferring')
  assert.match(state({ transferring: true, jobKind: 'pull' }).reason, /A pull from minio-lab \/ team-examples/)
})

test('§4: the linked file deleted is missing', () => {
  assert.equal(state({ remoteSide: side('missing'), local: side('changed'), localHeads: 'h', remoteHeads: 'h' }).sync, 'missing')
})

test('§4: the same heads on both sides is in sync, whatever the base', () => {
  assert.equal(state({ local: side('changed'), remoteSide: side('changed'), localHeads: 'h1', remoteHeads: 'h1' }).sync, 'in_sync')
  assert.equal(state({ local: side('changed'), remoteSide: side('changed'), localHeads: 'h1', remoteHeads: 'h2' }).sync, 'diverged')
})

test('§4: the first check in flight is checking; with an earlier check the earlier state stays', () => {
  assert.equal(state({ checking: true, checked: false, local: side('changed'), remoteSide: side('unknown', 'not checked') }).sync, 'checking')
  assert.equal(state({ checking: true, checked: true, local: side('same'), remoteSide: side('same') }).sync, 'in_sync')
})

test('§4: the four known pairs', () => {
  assert.equal(state({ local: side('same'), remoteSide: side('same') }).sync, 'in_sync')
  assert.equal(state({ local: side('changed'), remoteSide: side('same') }).sync, 'ahead')
  assert.equal(state({ local: side('same'), remoteSide: side('changed') }).sync, 'behind')
  assert.equal(state({ local: side('changed'), remoteSide: side('changed') }).sync, 'diverged')
})

test('§4: a failed check is unreachable; anything else unknown, the reason naming the unknown side', () => {
  const down = state({ local: side('changed'), remoteSide: side('unreachable', `${WHERE} didn't answer: refused`) })
  assert.deepEqual(down, { sync: 'unreachable', reason: `${WHERE} didn't answer: refused` })
  // one side unknown is never a guess: no "ahead" or "behind" from half the facts
  assert.equal(state({ local: side('changed'), remoteSide: side('unknown', 'not checked') }).sync, 'unknown')
  const r = state({ local: side('unknown', "can't tell whether work changed"), remoteSide: side('changed') })
  assert.deepEqual(r, { sync: 'unknown', reason: "can't tell whether work changed" })
  assert.equal(state({}).reason, 'local reason. remote reason')
})

test('local side: same, changed, and unknown with why', () => {
  const base = { heads: 'h1', sha256: 's1' }
  assert.equal(localSide({ store: 'work', heads: 'h1', base, supported: true }).side, 'same')
  assert.equal(localSide({ store: 'work', heads: 'h2', base, supported: true }).side, 'changed')
  assert.match(localSide({ store: 'work', heads: 'h1', base, supported: false }).reason, /can't tell whether work changed/)
  assert.match(localSide({ store: 'work', heads: null, base, supported: true }).reason, /could not be read/)
  assert.match(localSide({ store: 'work', heads: 'h1', base: null, supported: true }).reason, /no recorded push or pull/)
  assert.match(localSide({ store: 'work', heads: 'h1', base: { heads: null }, supported: true }).reason, /without its history/)
})

test('remote side: same, changed, missing, unreachable, and unknown (no check call, no keys, never checked)', () => {
  const base = { heads: 'h1', sha256: 's1' }
  const r = (o) => remoteSide({ where: WHERE, check: null, failedCheck: null, base, supported: true, hasKeys: true, ...o })
  assert.equal(r({ check: { present: true, sha256: 's1' } }).side, 'same')
  assert.equal(r({ check: { present: true, sha256: 's2' } }).side, 'changed')
  assert.equal(r({ check: { present: false } }).side, 'missing')
  assert.equal(r({ failedCheck: { error: { message: 'refused' } } }).side, 'unreachable')
  assert.match(r({ supported: false }).reason, /can't check minio-lab \/ team-examples/)
  assert.match(r({ hasKeys: false }).reason, /no keys for minio-lab$/)
  assert.match(r({}).reason, /not checked yet/)
})

test('linkInfo: the whole StoreLink; a failed check keeps the last known state', () => {
  const link = { remote: 'minio-lab', file: 'team-examples', linked: 1000, last: { direction: 'push', at: 2000, bytes: 980, sha256: 's1', heads: 'h1' } }
  const base = { store: 'work', heads: 'h2', headsSupported: true, link, provider: 'minio', object: 'localhost:9000/b/team-examples/store.sqlite', checkSupported: true, hasKeys: true, job: null }
  const ok = linkInfo({ ...base, checks: { check: { present: true, sha256: 's1', heads: 'h1', at: 3000 }, failedCheck: null, inFlight: false } })
  assert.deepEqual(
    { remote: ok.remote, provider: ok.provider, file: ok.file, object: ok.object, linked: ok.linked, local: ok.local, remoteSide: ok.remoteSide, sync: ok.sync, lastKnown: ok.lastKnown },
    { remote: 'minio-lab', provider: 'minio', file: 'team-examples', object: base.object, linked: 1000, local: 'changed', remoteSide: 'same', sync: 'ahead', lastKnown: null },
  )
  const failed = linkInfo({ ...base, checks: { check: { present: true, sha256: 's1', heads: 'h1', at: 3000 }, failedCheck: { at: 4000, error: { code: 'Unavailable', message: 'refused' } }, inFlight: false } })
  assert.deepEqual({ sync: failed.sync, lastKnown: failed.lastKnown, remoteSide: failed.remoteSide }, { sync: 'unreachable', lastKnown: 'ahead', remoteSide: 'unknown' })
  // never checked, keys present: checking until the first check
  assert.equal(linkInfo({ ...base, checks: { check: null, failedCheck: null, inFlight: false } }).sync, 'checking')
  // a running push: transferring
  assert.equal(linkInfo({ ...base, checks: null, job: { kind: 'push' } }).sync, 'transferring')
})

test('storeSync: the link’s state; transferring while a job runs; local_only with no link; live for PostgreSQL', () => {
  assert.deepEqual(storeSync({ kind: 'sqlite', link: { sync: 'behind' }, running: false }), { state: 'behind' })
  assert.deepEqual(storeSync({ kind: 'sqlite', link: { sync: 'behind' }, running: true }), { state: 'transferring' })
  assert.deepEqual(storeSync({ kind: 'sqlite', link: null, running: false }), { state: 'local_only' })
  assert.deepEqual(storeSync({ kind: 'postgresql', link: null, running: false }), { state: 'live' })
  assert.deepEqual(SEVERITY.slice(0, 4), ['diverged', 'behind', 'missing', 'ahead'])
})

test('rate and ETA (§5.2): withheld for 2 s, a moving mean, reset on a phase change, none without bytes', () => {
  let s = null
  const at = (t, bytes, phase = 'upload') => {
    const r = nextRate(s, { phase, bytes, total: 10_000_000, running: true }, t)
    s = r.state
    return r
  }
  assert.deepEqual(at(0, 0), { state: s, rate: null, eta: null })
  assert.equal(at(1000, 1_000_000).rate, null)
  const settled = at(2000, 2_000_000)
  assert.equal(settled.rate, 1_000_000)
  assert.equal(settled.eta, 8)
  // α = 0.3: 0.3 × 3 MB/s + 0.7 × 1 MB/s
  assert.equal(at(3000, 5_000_000).rate, 1_600_000)
  // a new phase starts over
  assert.equal(at(3500, 100, 'record').rate, null)
  // no bytes (no E4): no rate
  s = null
  at(0, null, null)
  assert.equal(at(5000, null, null).rate, null)
  // below 1 KB/s: a rate, no ETA
  s = null
  at(0, 0)
  const slow = at(3000, 1500)
  assert.equal(slow.rate, 500)
  assert.equal(slow.eta, null)
  // an ended job has neither
  assert.equal(nextRate(s, { phase: 'upload', bytes: 2000, total: 3000, running: false }, 9000).rate, null)
})

test('times: a transfer `at` in seconds reads as ms; ms and ISO strings stay', async () => {
  const { timeOf } = await import('../storage-checks.js')
  assert.equal(timeOf(1793295291), 1793295291000)
  assert.equal(timeOf(1793295291000), 1793295291000)
  assert.equal(timeOf('2026-10-29T00:00:00Z'), Date.parse('2026-10-29T00:00:00Z'))
  assert.equal(timeOf(null), null)
})
