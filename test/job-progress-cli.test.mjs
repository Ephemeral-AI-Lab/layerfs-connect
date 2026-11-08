import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'vite'
let directory, m
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'connect-cli-progress-'))
  const entry = join(directory, 'entry.mjs')
  await writeFile(entry, `export * from ${JSON.stringify(resolve('desktop/src/renderer/src/layerfs/job-progress.ts'))}`)
  const built = await build({ configFile: false, logLevel: 'silent', resolve: { alias: { '@': resolve('desktop/src/renderer/src') } }, build: { ssr: entry, write: false, minify: false } })
  const file = join(directory, 'compiled.mjs')
  await writeFile(file, built.output.find(x => x.type === 'chunk').code)
  m = await import(pathToFileURL(file))
})
after(async () => { if (directory) await rm(directory, { recursive: true, force: true }) })
const job = (over = {}) => ({ kind: 'backup', half: null, phase: 'hash', total: null, done: null, ended: 10, error: { code: 'Failed', phase: 'hash' }, phases: ['check', 'snapshot', 'check', 'hash'].map(phase => ({ phase, half: null, at: 0 })), ...over })
test('progress retains repeated observed phases and marks hash failure', () => {
  const segments = m.segmentsOf(job())
  assert.deepEqual(segments.map(x=>x.step), ['check','snapshot','check','hash'])
  assert.deepEqual(segments.map(x=>x.state), ['done','done','done','failed'])
})
test('unrecognized phase remains named and indeterminate', () => {
  const segments = m.segmentsOf(job({ ended: null, error: null, phases: [{ phase: 'native-transfer', half: null, at: 0 }], phase: 'native-transfer' }))
  assert.equal(segments[0].step, 'native-transfer')
  assert.equal(segments[0].share, null)
  assert.equal(m.stepWords('native-transfer'), 'native-transfer')
})
test('unknown and interrupted endings never report success', () => {
  assert.equal(m.endedWords(job({ outcome:'unknown' })), 'Outcome unknown · Inspect')
  assert.equal(m.endedWords(job({ outcome:'interrupted' })), 'Interrupted · Final result unavailable')
})
