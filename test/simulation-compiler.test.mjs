import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compileSimulation, writeSimulationPackage, resolveSimulationStep, renderSimulationCommand, SIMULATION_PROFILES, validateSimulationPackage, claimSimulationExecution } from '../tools/simulation/compiler.mjs'
import { executePackageStep, beginPackageStep } from '../tools/simulation/script-command.mjs'

const fixed = { runId: 'test-run', createdAt: '2026-11-10T00:00:00.000Z' }
test('all production projects remain bounded, reuse agents and preserve complete CLI dependency graphs', () => {
  for (const project of Object.keys(SIMULATION_PROFILES)) {
    const compiled = compileSimulation({ ...fixed, project })
    assert.equal(compiled.plan.conversations.length, SIMULATION_PROFILES[project].conversations)
    assert.ok(compiled.plan.conversations.every(item => item.subagents.length >= 1 && item.subagents.length <= 8))
    for (const conversation of compiled.plan.conversations) {
      const mainTurns = compiled.plan.turns.filter(turn => turn.conversationId === conversation.id && turn.agentId === null)
      assert.equal(mainTurns.length, conversation.cycles.length + (conversation === compiled.plan.conversations[0] ? 1 : 0))
      assert.ok(mainTurns.length <= 6)
      for (const child of conversation.subagents) {
        const childTurns = compiled.plan.turns.filter(turn => turn.conversationId === conversation.id && turn.agentId === child.id)
        assert.ok(childTurns.length <= 5)
        for (const turn of childTurns) assert.equal(new Set(turn.taskIds.map(id => compiled.plan.tasks.find(task => task.id === id).cycle)).size, 1)
      }
    }
    for (const task of compiled.plan.tasks) {
      assert.equal(compiled.plan.turns.filter(turn => turn.conversationId === task.conversationId && turn.agentId === null && turn.taskIds.includes(task.id)).length, 1)
      if (task.agentId) assert.equal(compiled.plan.turns.filter(turn => turn.conversationId === task.conversationId && turn.agentId === task.agentId && turn.taskIds.includes(task.id)).length, 1)
    }
    assert.ok(compiled.plan.tasks.some(task => task.agentId && compiled.plan.tasks.filter(other => other.agentId === task.agentId && other.conversationId === task.conversationId).length > 1))
    const keys = new Set(compiled.plan.steps.map(step => step.key))
    assert.equal(keys.size, compiled.plan.steps.length)
    for (const step of compiled.plan.steps) for (const dependency of step.dependsOn) assert.ok(keys.has(dependency), dependency)
    const pending = new Map(compiled.plan.tasks.map(task => [task.id, task])), done = new Set()
    while (pending.size) {
      const ready = [...pending.values()].filter(task => task.dependsOn.every(id => done.has(id)))
      assert.ok(ready.length, 'task graph must be acyclic')
      for (const task of ready) { done.add(task.id); pending.delete(task.id) }
    }
    assert.equal(compiled.plan.counts.historyCommands, 35 + 322 * compiled.manifest.cycles)
  }
})
test('mixed lifecycle has exactly two exec/commit pairs per actual mounted session and receipt-based handles', () => {
  const compiled = compileSimulation({ ...fixed, project: 'website', mixed: true, machine: 'docker', cycles: 1 })
  const steps = compiled.plan.steps, mounts = steps.filter(step => step.argv[0] === 'workspace' && step.argv[1] === 'mount')
  assert.equal(mounts.length, 48)
  for (const mount of mounts) {
    const handle = `<ws:${mount.key}>`, lifecycle = steps.filter(step => step.argv[2] === handle)
    assert.deepEqual(lifecycle.map(step => step.argv[1]), ['exec', 'commit', 'exec', 'commit', 'unmount'])
    const unmount = lifecycle.at(-1)
    assert.ok(!unmount.dependsOn.includes(unmount.key))
    assert.throws(() => resolveSimulationStep(lifecycle[0], {}), /workspace receipt/)
    assert.equal(resolveSimulationStep(lifecycle[0], { [mount.key]: { ws: 'returned:handle' } })[2], 'returned:handle')
  }
  assert.equal(compiled.plan.counts.historyCommands, 550)
  assert.deepEqual(steps.find(step => step.key === 'setup.push').argv.slice(0, 2), ['store', 'push'])
  assert.equal(steps.find(step => step.argv[0] === 'sandbox').argv.at(-1), 'docker')
})
test('fresh stores, validation and deterministic frozen package files', () => {
  const one = compileSimulation({ ...fixed, project: 'design', cycles: 1 })
  assert.deepEqual(one.files, compileSimulation({ ...fixed, project: 'design', cycles: 1 }).files)
  assert.notEqual(one.manifest.projectName, compileSimulation({ ...fixed, project: 'design', runId: 'another', cycles: 1 }).manifest.projectName)
  assert.notEqual(one.manifest.store, compileSimulation({ ...fixed, project: 'design', runId: 'another', cycles: 1 }).manifest.store)
  assert.throws(() => compileSimulation({ project: '../design' }), /Unknown/)
  assert.throws(() => compileSimulation({ project: 'design', runId: '../bad' }), /valid/)
  assert.throws(() => compileSimulation({ project: 'design', mixed: 'true' }), /boolean/)
  assert.throws(() => compileSimulation({ project: 'design', cycles: 0 }), /cycle/)
  const publish = one.plan.steps.find(step => step.commitFrom)
  assert.throws(() => resolveSimulationStep(publish, {}), /Commit receipt/)
  assert.equal(resolveSimulationStep(publish, { [publish.commitFrom]: { head: 'confirmed-head' } }).at(-1), 'confirmed-head')
})
test('package scripts execute actual adapter calls once and stop on missing dependencies', async () => {
  const state = await mkdtemp(join(tmpdir(), 'simulation-'))
  try {
    const compiled = compileSimulation({ ...fixed, project: 'design', cycles: 1 })
    const directory = await writeSimulationPackage(state, compiled)
    await assert.rejects(writeSimulationPackage(state, compiled), /EEXIST/)
    assert.equal(await readFile(join(directory, 'journal.jsonl'), 'utf8'), '')
    const calls = [], options = { spec: {}, executeCommand: async (_spec, argv) => { calls.push(argv); return { name: 'native', state: 'running' } } }
    await assert.rejects(executePackageStep(directory, 'setup.store', options), /ENOENT/)
    await executePackageStep(directory, 'setup.machine', options)
    await assert.rejects(executePackageStep(directory, 'setup.machine', options), /EEXIST/)
    assert.equal(calls.length, 1)
    assert.deepEqual(calls[0], ['machine', 'get', 'native'])
  } finally { await rm(state, { recursive: true, force: true }) }
})

test('generated setup shell runs reviewed CLI commands with an absolute source folder', async () => {
  const state = await mkdtemp(join(tmpdir(), 'simulation-shell-'))
  try {
    const compiled = compileSimulation({ ...fixed, project: 'design', cycles: 1 })
    const directory = await writeSimulationPackage(state, compiled)
    const fakeCli = join(state, 'layerfs'), ledger = join(state, 'calls.jsonl')
    await writeFile(fakeCli, `#!${process.execPath}
const fs = require('node:fs'); const argv = process.argv.slice(2); fs.appendFileSync(process.env.SIM_TEST_LEDGER, JSON.stringify(argv) + '\\n'); console.log(JSON.stringify(argv[0] === 'machine' ? {name:'native', state:'running'} : argv[0] === 'store' ? {name:argv[2], kind:'sqlite'} : {project:argv[2], kind:'sqlite'}));
`, { mode: 0o700 })
    await promisify(execFile)('/bin/sh', [join(directory, 'setup/scripts/initialize-project.sh')], { env: { ...process.env, SIMULATION_RUN_DIR: directory, LAYERFS_CONNECT_CLI: fakeCli, LAYERFS_HOME: join(state, 'home'), SIM_TEST_LEDGER: ledger } })
    const calls = (await readFile(ledger, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    assert.deepEqual(calls, compiled.plan.steps.filter(step => step.phase === 'setup').map(step => resolveSimulationStep(step, {}, directory)))
    assert.equal(calls.at(-1)[3], join(directory, 'setup/source'))
  } finally { await rm(state, { recursive: true, force: true }) }
})

test('immutable source tampering and host-owned package replay stop before CLI execution', async () => {
  const state = await mkdtemp(join(tmpdir(), 'simulation-custody-'))
  try {
    const compiled = compileSimulation({ ...fixed, project: 'design', cycles: 1 })
    const directory = await writeSimulationPackage(state, compiled)
    await validateSimulationPackage(directory)
    await writeFile(join(directory, 'setup/source/README.md'), 'changed source')
    await assert.rejects(validateSimulationPackage(directory), /hash changed/)
    let calls = 0
    const options = { spec: {}, executeCommand: async () => { calls++; return {} } }
    await assert.rejects(executePackageStep(directory, 'setup.machine', options), /hash changed/)
    assert.equal(calls, 0)
    const managed = await writeSimulationPackage(state, compileSimulation({ ...fixed, runId: 'managed', project: 'design', cycles: 1 }))
    await claimSimulationExecution(managed, 'host')
    await assert.rejects(executePackageStep(managed, 'setup.machine', options), /owned by host/)
    const manifest = JSON.parse(await readFile(join(managed, 'manifest.json'), 'utf8'))
    manifest.status = 'completed'
    await writeFile(join(managed, 'manifest.json'), JSON.stringify(manifest))
    await assert.rejects(executePackageStep(managed, 'setup.machine', options), /cannot replay/)
    assert.equal(calls, 0)
  } finally { await rm(state, { recursive: true, force: true }) }
})

test('agent bash renders actual CLI argv and input without executing shell metacharacters', async () => {
  const state = await mkdtemp(join(tmpdir(), 'simulation-bash-'))
  try {
    const binary = join(state, 'layerfs'), ledger = join(state, 'ledger.json'), sentinel = join(state, 'must-not-exist')
    await writeFile(binary, `#!${process.execPath}\nconst fs = require('node:fs'); fs.writeFileSync(process.env.SIM_TEST_LEDGER, JSON.stringify({argv:process.argv.slice(2),input:fs.readFileSync(0,'utf8')}));\n`, { mode: 0o700 })
    const step = { argv: ['file', 'write', 'store/project', 'feature', '/a.txt', '--message', `Literal $(touch ${sentinel}) and 'quote'`], input: `literal $HOME, \`uname\`, $(touch ${sentinel})\nsecond line\n` }
    const command = renderSimulationCommand(step)
    assert.ok(command.includes("'file' 'write'"))
    assert.ok(!command.includes('script-command'))
    await promisify(execFile)('/bin/sh', ['-c', command], { env: { ...process.env, LAYERFS_CONNECT_CLI: binary, SIM_TEST_LEDGER: ledger } })
    assert.deepEqual(JSON.parse(await readFile(ledger, 'utf8')), { argv: step.argv, input: step.input })
    await assert.rejects(readFile(sentinel), /ENOENT/)
    const compiled = compileSimulation({ ...fixed, project: 'design', cycles: 1 })
    for (const [path, content] of Object.entries(compiled.files).filter(([path]) => path.endsWith('/script.json'))) {
      const script = JSON.parse(content)
      assert.ok(script.turns.length <= 10, path)
      assert.equal(script.maxTurns, 10)
      for (const action of script.turns.flatMap(turn => turn.actions).filter(action => action.type === 'tool')) assert.equal(action.tool, 'bash')
    }
  } finally { await rm(state, { recursive: true, force: true }) }
})

test('standalone setup rejects stopped or unsupported machines before any Store mutation', async () => {
  const state = await mkdtemp(join(tmpdir(), 'simulation-preflight-'))
  try {
    const binary = join(state, 'layerfs')
    await writeFile(binary, `#!${process.execPath}\nconst fs = require('node:fs'); fs.appendFileSync(process.env.SIM_TEST_LEDGER, JSON.stringify(process.argv.slice(2)) + '\\n'); console.log(process.env.SIM_TEST_MACHINE);\n`, { mode: 0o700 })
    for (const [index, machine] of [{ state: 'stopped', supports: { sqlite: true } }, { state: 'running', supports: { sqlite: false } }].entries()) {
      const directory = await writeSimulationPackage(state, compileSimulation({ ...fixed, project: 'design', cycles: 1, runId: `preflight-${index}` }))
      const ledger = join(state, `calls-${index}.jsonl`)
      await assert.rejects(promisify(execFile)('/bin/sh', [join(directory, 'setup/scripts/initialize-project.sh')], { env: { ...process.env, SIMULATION_RUN_DIR: directory, LAYERFS_CONNECT_CLI: binary, LAYERFS_HOME: join(state, 'home'), SIM_TEST_LEDGER: ledger, SIM_TEST_MACHINE: JSON.stringify(machine) } }), /not ready for a SQLite simulation/)
      assert.deepEqual((await readFile(ledger, 'utf8')).trim().split('\n').map(JSON.parse), [['machine', 'get', 'native']])
      await assert.rejects(beginPackageStep(directory, 'setup.store'), /ENOENT/)
    }
  } finally { await rm(state, { recursive: true, force: true }) }
})
