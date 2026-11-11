import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

for (const path of ['../src/renderer/src/pages/machines/MachinesPage.tsx', '../../src/renderer/src/components/compute/compute-page.tsx']) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8')
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let action
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(file) === 'act' && ts.isArrowFunction(node.initializer)) action = node.initializer.getText(file)
    ts.forEachChild(node, visit)
  }
  visit(file)
  assert.ok(action, `machine action handler in ${path}`)
  const compiled = ts.transpileModule(`export const make = (host, live, performMachineStartup = async (_operation, request) => request(), available = undefined, clearMachineProgress = () => {}) => (${action})`, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } }).outputText
  const { make } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)

  test(`${path}: refresh observes partial Start effect while preserving the original refusal`, async () => {
    const refusal = Object.assign(new Error('worker protocol 2 differs from expected protocol 3'), { code: 'Unavailable', detail: { worker: { protocol: 2 }, expected: { protocol: 3 } } })
    let state = 'stopped', starts = 0
    const observations = []
    const act = make({ startMachine: async () => { starts++; state = 'running'; throw refusal } }, { reload: () => observations.push(state) })
    await assert.rejects(act({ kind: 'start', name: 'docker' }), error => error === refusal)
    assert.deepEqual(observations, ['running'])
    assert.equal(starts, 1, 'a refused start is never replayed')
  })

  test(`${path}: successful Stop refreshes exactly once after completion`, async () => {
    const calls = []
    const act = make({ stopMachine: async name => calls.push(`stopped ${name}`) }, { reload: () => calls.push('read') })
    await act({ kind: 'stop', name: 'docker' })
    assert.deepEqual(calls, ['stopped docker', 'read'])
  })
}

// Recovery belongs to the submitted machine, even when a new name is being typed.
{
  const path = '../src/renderer/src/pages/machines/AddMachineDialog.tsx'
  const source = readFileSync(new URL(path, import.meta.url), 'utf8')
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let inspect
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(file) === 'inspect') inspect = node.initializer.getText(file)
    ts.forEachChild(node, visit)
  }
  visit(file)
  assert.ok(inspect)
  const compiled = ts.transpileModule(`export const make = (host, setInspection, submittedName, f) => (${inspect})`, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } }).outputText
  const { make } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
  test('creation recovery inspects the submitted identity after the form name changes', async () => {
    const targets = [], observations = []
    const inspect = make({ inspectMachine: async name => { targets.push(name); return { state: 'stopped' } } }, text => observations.push(text), 'failed-machine', { name: 'next-machine' })
    await inspect()
    assert.deepEqual(targets, ['failed-machine'])
    assert.match(observations[0], /stopped/)
  })
}
