import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import test, { after, before } from 'node:test'
import ts from 'typescript'
let directory, parse
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'connect-simulation-command-'))
  const source = await readFile(new URL('../desktop/src/renderer/src/layerfs/simulation-command.ts', import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
  const file = join(directory, 'command.mjs')
  await writeFile(file, compiled)
  ;({ parseSimulationCommand: parse } = await import(pathToFileURL(file).href))
})
after(async () => { await rm(directory, { recursive: true, force: true }) })
test('simulation command requires an explicit project and machine and defaults to filesystem', () => {
  assert.equal(parse('ordinary message'), null)
  assert.equal(parse('/simulations --project website --machine docker'), null)
  assert.deepEqual(parse(' /simulation --project website --machine docker '), { ok: true, input: { project: 'website', machine: 'docker', mixed: false } })
  assert.equal(parse('/simulation').ok, false)
  assert.equal(parse('/simulation --project website').ok, false)
})
test('mixed supports a bare switch and explicit booleans in either argument form', () => {
  for (const suffix of ['--mixed', '--mixed true', '--mixed=true']) assert.equal(parse(`/simulation --project website --machine docker ${suffix}`).input.mixed, true)
  for (const suffix of ['--mixed false', '--mixed=false']) assert.equal(parse(`/simulation --project website --machine docker ${suffix}`).input.mixed, false)
  assert.deepEqual(parse('/simulation --mixed --machine=docker --project=design').input, { project: 'design', machine: 'docker', mixed: true })
})
test('invalid or ambiguous arguments never dispatch a simulation', () => {
  for (const args of ['--mixed=no', '--mixed=', '--mixed nope', '--machine', '--project=', '--project --machine docker', '--project a --project b', '--machine a --machine b', '--mixed --mixed', '--parallel 8', 'website docker']) {
    assert.equal(parse(`/simulation --project website --machine docker ${args}`).ok, false, args)
  }
})
