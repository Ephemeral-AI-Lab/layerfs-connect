import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'
const code = ts.transpileModule(readFileSync(new URL('../src/renderer/src/layerfs/preset-resources.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } }).outputText
const { resourceMatches: matches, resourceStatus: status } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
const groups = [{ machine: 'native', store: 'demo-studio', projects: ['website', 'design'] }, { machine: 'docker', store: 'demo-services', projects: ['gateway'] }]
const machine = { kind: 'machine', name: 'native', machine: 'native' }
const store = { kind: 'store', name: 'demo-studio', store: 'demo-studio', machine: 'native' }
const project = { kind: 'project', name: 'demo-studio/website', store: 'demo-studio', machine: 'native' }

test('machine/store/project scopes match identity positions without matching messages or name prefixes', () => {
  for (const resource of [machine, store, project]) {
    assert.equal(matches(['file', 'write', 'demo-studio/website', 'feature-auth', '/FEATURES.md'], resource, groups), true)
    assert.equal(matches(['project', 'get', 'demo-studio/website-other'], resource, groups), false)
    assert.equal(matches(['file', 'write', 'demo-services/gateway', 'main', '/README.md', '--message', 'demo-studio/website'], resource, groups), false)
  }
  assert.equal(matches(['machine', 'start', 'native'], machine, groups), true)
  assert.equal(matches(['machine', 'start', 'native'], project, groups), false)
  assert.equal(matches(['commit', 'list', project.name, 'release-0.2'], project, groups), true)
  assert.equal(matches(['store', 'remove', 'demo-studio'], store, groups), true)
})

test('sandbox/workspace commands belong to their actual preset project and machine', () => {
  assert.equal(matches(['sandbox', 'create', 'demo-studio/website', 'demo-website', 'native'], project, groups), true)
  assert.equal(matches(['workspace', 'unmount', 'demo-website:feature', '--discard'], project, groups), true)
  assert.equal(matches(['workspace', 'unmount', 'demo-website-other:feature'], project, groups), false)
  assert.equal(matches(['workspace', 'mount', 'demo-website', 'feature-auth'], { ...project, name: 'demo-studio/design' }, groups), false)
})

test('readiness requires verified completion; reset and unverified jobs never imply ready', () => {
  const job = { command: 'environment-reset', rebuild: true, state: 'running', progress: { stage: 'building' } }
  const call = { argv: ['project', 'init', project.name], status: 'success' }
  assert.equal(status(job, [], project, groups), 'Waiting')
  assert.equal(status(job, [call], project, groups), 'Created')
  assert.equal(status(job, [{ ...call, status: 'running' }], project, groups), 'In progress')
  assert.equal(status(job, [{ ...call, status: 'refused' }], project, groups), 'Failed')
  assert.equal(status({ ...job, state: 'completed', presetVerified: true }, [], project, groups), 'Ready')
  assert.equal(status({ ...job, state: 'completed', rebuild: false }, [], project, groups), 'Planned')
  assert.equal(status({ ...job, progress: { stage: 'resetting' } }, [call], project, groups), 'Waiting')
  assert.equal(status({ ...job, state: 'interrupted' }, [], project, groups), 'Not verified')
})


test('starting a retained machine is Started, while creating child projects does not claim machine creation', () => {
  const job = { command: 'setup', state: 'running', progress: { stage: 'building' } }
  assert.equal(status(job, [{ argv: ['machine', 'start', 'native'], status: 'success' }], machine, groups), 'Started')
  assert.equal(status(job, [{ argv: ['project', 'init', project.name], status: 'success' }], machine, groups), 'Waiting')
})
