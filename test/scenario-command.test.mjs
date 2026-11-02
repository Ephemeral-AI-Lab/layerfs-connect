import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import test, { after, before } from 'node:test'
import ts from 'typescript'

let directory
let parse

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'connect-scenario-command-test-'))
  const source = await readFile(new URL('../src/renderer/src/lib/scenario-command.ts', import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
  const file = join(directory, 'scenario-command.mjs')
  await writeFile(file, compiled)
  ;({ parseScenarioCommand: parse } = await import(pathToFileURL(file).href))
})

after(async () => {
  await rm(directory, { recursive: true, force: true })
})

test('/scenario plays on docker unless -platform names another', () => {
  assert.deepEqual(parse('/scenario tour'), { ok: true, name: 'tour', platform: 'docker' })
  assert.deepEqual(parse('/scenario tour -platform linux'), { ok: true, name: 'tour', platform: 'linux' })
  assert.deepEqual(parse('/scenario   tour   --platform   apple-container '), { ok: true, name: 'tour', platform: 'apple-container' })
  assert.deepEqual(parse('/scenario -platform=mac all'), { ok: true, name: 'all', platform: 'mac' })
  // no name yet: the composer completes it
  assert.deepEqual(parse('/scenario'), { ok: true, name: null, platform: 'docker' })
  assert.deepEqual(parse('/scenario -platform ssh'), { ok: true, name: null, platform: 'ssh' })
})

test('/scenario refuses what it cannot read', () => {
  assert.equal(parse('hello'), null)
  assert.equal(parse('/scenarios tour'), null)
  assert.equal(parse('/scenario tour -platform windows').error, 'No platform named {platform}. Platforms: {names}.')
  assert.equal(parse('/scenario tour -platform').error, '-platform needs a name: {names}.')
  assert.equal(parse('/scenario tour -platform linux -platform docker').error, 'Name -platform once.')
  assert.deepEqual(parse('/scenario tour -p linux').params, { option: '-p' })
  assert.deepEqual(parse('/scenario tour crew').params, { first: 'tour', second: 'crew' })
})
