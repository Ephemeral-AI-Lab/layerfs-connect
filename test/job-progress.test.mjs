import assert from 'node:assert/strict'
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test, { after, before } from 'node:test'
import { build } from 'vite'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
let directory
let m

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'connect-job-progress-test-'))
  await symlink(join(root, 'node_modules'), join(directory, 'node_modules'), 'dir')
  const entry = join(directory, 'entry.mjs')
  await writeFile(entry, "export * from '@/data/job-progress'")
  const result = await build({
    configFile: false,
    root,
    logLevel: 'silent',
    resolve: { alias: [
      { find: '@/i18n', replacement: 'virtual:job-progress-test-i18n' },
      { find: '@', replacement: join(root, 'src/renderer/src') },
    ] },
    plugins: [{
      name: 'job-progress-test-i18n',
      resolveId(id) { if (id === 'virtual:job-progress-test-i18n') return `\0${id}` },
      load(id) {
        // English, with {name} filled in, so the words can be checked
        if (id === '\0virtual:job-progress-test-i18n') return `
          export const t = (text, values = {}) => text.replace(/\\{(\\w+)\\}/g, (_, k) => String(values[k] ?? '{' + k + '}'))
        `
      },
    }],
    build: { ssr: entry, write: false, minify: false, rolldownOptions: { output: { format: 'es', codeSplitting: false } } },
  })
  const module = result.output.find((file) => file.type === 'chunk' && file.isEntry)
  const compiled = join(directory, 'job-progress.mjs')
  await writeFile(compiled, module.code)
  m = await import(pathToFileURL(compiled).href)
})

after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

const job = (over = {}) => ({ id: 'j1', kind: 'push', store: 'mobile', target: 'docker', from: null, half: null, file: null, started: 1_000, ended: null, phase: 'send', done: 400, total: 1_000, error: null, result: null, ...over })
const states = (segments) => segments.map((s) => s.state).join(' ')

test('a push sending: steps before send are done, send fills by bytes, the rest are to come', () => {
  const s = m.segmentsOf(job())
  assert.deepEqual(s.map((x) => x.step), ['check', 'snapshot', 'send', 'verify', 'install', 'record', 'retire'])
  assert.equal(states(s), 'done done now todo todo todo todo')
  assert.equal(s[2].share, 0.4)
  assert.ok(s[2].weight > s[0].weight, 'send is drawn wider than the short steps')
})

test('a step with no byte count has no share; a job not yet in a step is on its first', () => {
  assert.equal(m.segmentsOf(job({ phase: 'verify', done: null, total: null }))[3].share, null)
  assert.equal(states(m.segmentsOf(job({ phase: null, done: null, total: null }))), 'now todo todo todo todo todo todo')
})

test('a failed job marks the step it stopped in; one that ended well is all done', () => {
  const failed = job({ phase: 'verify', ended: 5_000, error: { code: 'Failed', message: 'x', phase: 'verify' } })
  assert.equal(states(m.segmentsOf(failed)), 'done done done failed todo todo todo')
  assert.equal(states(m.segmentsOf(job({ phase: 'retire', ended: 5_000 }))), 'done done done done done done done')
})

test('a backup from native skips send: snapshot then upload still reads in order', () => {
  assert.equal(states(m.segmentsOf(job({ kind: 'backup', target: 'r2', phase: 'upload', done: null, total: null }))), 'done done now')
  assert.deepEqual(m.STEPS.restore, ['download', 'install'])
})

test('a move draws its pull and its push: the finished half full, the coming half empty', () => {
  const pulling = m.barOf(job({ kind: 'move', target: 'lima-dev', from: 'docker', half: 'pull', phase: 'send' }))
  assert.equal(pulling.length, 2)
  assert.equal(states(pulling[0]), 'done done now todo todo todo todo')
  assert.equal(states(pulling[1]), 'todo todo todo todo todo todo todo')
  const pushing = m.barOf(job({ kind: 'move', target: 'lima-dev', from: 'docker', half: 'push', phase: 'check' }))
  assert.equal(states(pushing[0]), 'done done done done done done done')
  assert.equal(states(pushing[1]), 'now todo todo todo todo todo todo')
})

test('the words say what it does and how it ended', () => {
  assert.equal(m.doingWords(job()), 'Pushing to docker')
  assert.equal(m.doingWords(job({ kind: 'pull', from: 'lima-dev', target: 'native' })), 'Pulling from lima-dev')
  assert.equal(m.doingWords(job({ kind: 'restore', target: 'r2', file: 'shop.lfs' })), 'Restoring from r2/shop.lfs')
  assert.equal(m.stepWords('retire'), 'cleaning up')
  assert.equal(m.stepWords(null), 'starting')
  assert.equal(m.endedWords(job({ ended: 9_000 })), 'Pushed to docker')
  assert.equal(m.endedWords(job({ ended: 9_000, error: { code: 'Failed', message: 'x', phase: 'verify' } })), 'Push to docker failed in verify')
  assert.equal(m.endedWords(job({ kind: 'pull', from: 'native', ended: 9_000 })), 'Pulled from Home')
})

test('the speed needs two samples at least two seconds apart, within the last ten seconds', () => {
  assert.equal(m.rateOf([{ at: 0, done: 0 }]), null)
  assert.equal(m.rateOf([{ at: 0, done: 0 }, { at: 1_000, done: 8e6 }]), null)
  assert.equal(m.rateOf([{ at: 0, done: 0 }, { at: 4_000, done: 168e6 }]), 42e6)
  // samples older than the window are left out
  assert.equal(m.rateOf([{ at: 0, done: 0 }, { at: 20_000, done: 500e6 }, { at: 24_000, done: 540e6 }]), 10e6)
  assert.equal(m.rateWords(42e6), '42 MB/s')
  assert.equal(m.rateWords(4.25e6), '4.3 MB/s')
  assert.equal(m.rateWords(512), '512 B/s')
})

test('time left and durations read as words', () => {
  assert.equal(m.secondsLeft(job({ done: 400, total: 1_000 }), 100), 6)
  assert.equal(m.secondsLeft(job(), null), null)
  assert.equal(m.leftWords(30), 'under a minute')
  assert.equal(m.leftWords(150), 'about 3 min left')
  assert.equal(m.tookWords(58_000), '58 s')
  assert.equal(m.tookWords(92_000), '1 min 32 s')
  assert.equal(m.tookWords(7_500_000), '2 h 5 min')
})

test("a card shows its running job, a failure until dismissed, and a success for a minute", () => {
  const ok = job({ id: 'ok', ended: 100_000 })
  const bad = job({ id: 'bad', ended: 100_000, error: { code: 'Failed', message: 'x', phase: 'send' } })
  const none = new Set()
  assert.equal(m.cardJob([ok], 'mobile', none, 130_000)?.id, 'ok')
  assert.equal(m.cardJob([ok], 'mobile', none, 100_000 + m.SHOW_DONE_MS + 1), undefined)
  assert.equal(m.cardJob([bad], 'mobile', none, 10_000_000)?.id, 'bad')
  assert.equal(m.cardJob([bad], 'mobile', new Set(['bad']), 130_000), undefined)
  assert.equal(m.cardJob([bad, job({ id: 'run' })], 'mobile', none)?.id, 'run')
  assert.equal(m.cardJob([bad], 'other', none), undefined)
})

test('the header and sidebar count running jobs and undismissed failures, one per Store', () => {
  const fail = (id, store, started) => job({ id, store, started, ended: started + 1, error: { code: 'Failed', message: 'x', phase: 'send' } })
  const jobs = [job({ id: 'r', store: 'a' }), fail('f', 'b', 10), fail('old', 'c', 10), job({ id: 'again', store: 'c', started: 20, ended: 30 })]
  // c's failure was followed by a push that ended well: it no longer counts
  assert.deepEqual(m.jobCounts(jobs, new Set()), { running: 1, failed: 1 })
  assert.deepEqual(m.jobCounts(jobs, new Set(['f'])), { running: 1, failed: 0 })
})
