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

test('/scenario plays on the Store\'s machine unless -machine names another', () => {
  assert.deepEqual(parse('/scenario tour'), { ok: true, name: 'tour', machine: null })
  assert.deepEqual(parse('/scenario tour -machine lima1'), { ok: true, name: 'tour', machine: 'lima1' })
  assert.deepEqual(parse('/scenario   tour   --machine   docker '), { ok: true, name: 'tour', machine: 'docker' })
  assert.deepEqual(parse('/scenario -machine=native all'), { ok: true, name: 'all', machine: 'native' })
  // no name yet: the composer completes it
  assert.deepEqual(parse('/scenario'), { ok: true, name: null, machine: null })
})

test('/scenario refuses what it cannot read', () => {
  assert.equal(parse('hello'), null)
  assert.equal(parse('/scenarios tour'), null)
  assert.equal(parse('/scenario tour -machine').error, '-machine needs a machine’s name.')
  assert.equal(parse('/scenario tour -machine a -machine b').error, 'Name -machine once.')
  assert.deepEqual(parse('/scenario tour -p linux').params, { option: '-p' })
  assert.deepEqual(parse('/scenario tour crew').params, { first: 'tour', second: 'crew' })
})
