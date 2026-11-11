import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DemoRunner } from './runner.mjs'
import { StepJournal } from './step-journal.mjs'
import { DEFAULT_HISTORY_LIMITS } from './history-scheduler.mjs'
import { CONTENT_VERSION, presetOf } from './presets.mjs'
import { MIXED_RECIPE_VERSION } from './mixed-recipe.mjs'
import { projectHistorySteps, projectHistoryPlan, machineCreateArgs } from './recipe.mjs'
import { projectVerificationSteps } from './project-verification.mjs'
import { EnvironmentReset } from '../../host/environment-reset.js'

/** Initialize only a fresh private fixture home; never adopt a populated home. */
export async function prepareBuild({ spec, preset, driver, sandboxes, executionMode = 'filesystem', report = () => {}, progress = () => {} }) {
  progress({ stage: 'checking', completed: 0, total: null, label: 'Checking preset requirements' })
  const runner = new DemoRunner({ state: spec.state, preset, driver, sandboxes, executionMode, report, progress })
  runner.acquire()
  try {
    runner.command = 'reset' // Preparation permits a newly selected sandbox option; reset applies it later.
    runner.load(true)
    await driver.discover()
    // Initialize the fresh owned home before read-only prerequisite calls.
    // Requirements still precede any reset that can discard resource data.
    await runner.initialize()
    await runner.preflight()
  } finally { runner.release() }
  const plan = await new EnvironmentReset({ spec, driver, report, progress }).plan()
  return { ...plan, executionMode, signature: executionMode === 'mixed' ? `mixed:${plan.signature}` : plan.signature }
}

/** Same build workflow for the app and command line: general reset, then setup. */
export async function buildPreset({ spec, preset, driver, sandboxes = true, executionMode = 'filesystem', expectedPlan, assertIdle, onReady, onBuildReady, onCleanup, report = () => {}, progress = () => {} }) {
  if (!['filesystem', 'mixed'].includes(executionMode)) throw new Error('Unknown preset execution mode.')
  if (executionMode === 'mixed') {
    if (!expectedPlan?.startsWith('mixed:')) throw Object.assign(new Error('The build mode changed since confirmation. Review the build plan again.'), { code: 'Conflict', status: 409 })
    expectedPlan = expectedPlan.slice(6)
  }
  if (presetOf(preset).sandboxes === false) sandboxes = false
  const runner = new DemoRunner({ state: spec.state, preset, driver, sandboxes, executionMode, report, progress })
  runner.command = 'reset'
  runner.load() // Validate ownership/home identity before any destructive cleanup.
  await driver.discover()
  await runner.preflight()
  let resetSteps = { completed: 0, total: null }
  const resetProgress = value => {
    if (value.stage === 'resetting') {
      resetSteps = value
      progress({ ...value, total: value.total === null ? null : value.total + 1 })
    } else if (value.stage === 'verifying') {
      progress({ ...value, stage: 'resetting', completed: resetSteps.completed + value.completed, total: resetSteps.total === null ? null : resetSteps.total + 1 })
    } else progress(value)
  }
  return new EnvironmentReset({ spec, driver, report, progress: resetProgress }).run({ expectedPlan, assertIdle, onReady,
    afterCleanup: async (cleanup, inheritedLock) => {
      await onCleanup?.(cleanup)
      const file = join(spec.state, 'demo-fixtures.json')
      const manifest = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null
      if (!manifest || manifest.tool !== 'layerfs-connect-demo' || manifest.preset !== preset || manifest.homeId !== cleanup.homeId) throw new Error('Preset manifest does not match the cleaned home. Inspect the environment before building.')
      if (!cleanup.verified) throw new Error('Cleanup was not verified; history receipts are retained.')
      const journal = new StepJournal(join(spec.state, 'demo-steps.ndjson')); journal.clear()
      manifest.stepJournal = journal.metadata(); delete manifest.activityCapture
      Object.assign(manifest, { resources: { machine: {}, store: {}, sandbox: {} }, projects: {}, steps: {}, borrowed: {}, lastSetupActionId: null, contentVersion: CONTENT_VERSION, sandboxes, executionMode, mixedRecipeVersion: executionMode === 'mixed' ? MIXED_RECIPE_VERSION : null })
      const tmp = `${file}.${process.pid}.tmp`; writeFileSync(tmp, JSON.stringify(manifest), { mode: 0o600 }); renameSync(tmp, file)
      report('Building selected preset')
      const result = await runner.run('setup', { onReady: onBuildReady, inheritedLock })
      return { ...result, cleanup, resetActionId: cleanup.actionId, actionIds: [cleanup.actionId, result.actionId] }
    },
  })
}

/** Actual executable source, without touching or initializing resource state. */
export function presetScript({ preset, spec, sandboxes = true, resetPlan, resetNote, historyDensity = 'dense', executionMode = 'filesystem' }) {
  if (presetOf(preset).sandboxes === false) sandboxes = false
  const configuration = { ...presetOf(preset), preset, historyDensity, executionMode, mixedSandboxCapacity: executionMode === 'mixed' ? { perProject: 3, workspacesPerSandbox: 16 } : null, historySchedule: 'parallel', historyLimits: { ...DEFAULT_HISTORY_LIMITS }, sandboxes, state: spec.state, home: spec.home, cli: spec.cli ?? null, daemon: spec.daemon ?? null }
  const quote = value => `'${String(value).replaceAll("'", "'\\''")}'`
  const command = `node tools/demo-fixtures.mjs build --preset ${quote(preset)} --state ${quote(spec.state)}${sandboxes || executionMode === 'mixed' ? '' : ' --no-sandboxes'}${executionMode === 'mixed' ? ' --execution-mode mixed' : ''}${spec.cli ? ` --cli ${quote(spec.cli)}` : ''}${spec.daemon ? ` --daemon ${quote(spec.daemon)}` : ''}`
  const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
  const paths = ['tools/demo-fixtures.mjs', 'tools/demo/build.mjs', 'tools/demo/presets.mjs', 'tools/demo/recipe.mjs', 'tools/demo/dense-recipe.mjs', 'tools/demo/mixed-recipe.mjs', 'tools/demo/projects.mjs', 'tools/demo/project-verification.mjs', 'tools/demo/scheduler.mjs', 'tools/demo/history-scheduler.mjs', 'tools/demo/step-journal.mjs', 'tools/demo/runner.mjs', 'host/environment-reset.js']
  const commands = presetCommandPlan({ configuration, spec, sandboxes, resetPlan, resetNote })
  return { preset, language: 'javascript', command, configuration, commands, dynamicReset: !resetPlan || resetPlan.unknownSandboxes.length > 0, files: paths.map(path => ({ path, source: readFileSync(join(root, path), 'utf8') })) }
}


function presetCommandPlan({ configuration, spec, sandboxes, resetPlan, resetNote }) {
  const commands = [], add = (phase, argv, extra = {}) => commands.push({ phase, argv, ...extra })
  add('reset', ['machine', 'list'], { note: resetNote || 'Read the environment inventory. Cleanup targets are rechecked when Build starts; CLI Activity records the exact executed commands.' })
  add('reset', ['store', 'list'])
  add('reset', ['sandbox', 'list', '--page-size', '1000', '--page-pos', '0'], { note: 'Additional pages are read when present.' })
  if (resetPlan) {
    for (const name of resetPlan.startMachines) add('reset', ['machine', 'start', name])
    for (const name of resetPlan.remove.sandboxes) {
      add('reset', ['sandbox', 'get', name, '--page-size', '1000', '--page-pos', '0'], { note: resetPlan.unknownSandboxes.includes(name) ? 'Workspace targets will be discovered after its machine starts.' : undefined })
      for (const ws of resetPlan.workspaceGroups?.find(group => group.sandbox === name)?.workspaces ?? []) add('reset', ['workspace', 'unmount', ws, '--discard'])
      add('reset', ['sandbox', 'close', name])
    }
    for (const name of resetPlan.remove.stores) add('reset', ['store', 'remove', name])
    for (const name of resetPlan.disconnect) add('reset', ['store', 'disconnect', name])
    for (const name of resetPlan.remove.machines) add('reset', ['machine', 'remove', name])
    if (resetPlan.stopDocker || resetPlan.startMachines.includes('docker')) add('reset', ['machine', 'stop', 'docker'])
    for (const family of ['machine', 'store', 'sandbox']) add('reset', [family, 'list', ...(family === 'sandbox' ? ['--page-size', '1000', '--page-pos', '0'] : [])], { note: 'Verify the environment is empty before creating preset resources.' })
  }
  add('build', ['machine', 'platforms'], { note: 'Prerequisites are checked before cleanup and checked again during setup.' })
  for (const machine of configuration.machines) {
    const name = typeof machine === 'string' ? machine : machine.name
    if (typeof machine !== 'string') add('build', machineCreateArgs(machine))
    if (configuration.stores.some(store => store.machine === name)) add('build', ['machine', 'start', name], { note: 'Only if the machine is not already running or ready.' })
  }
  if (sandboxes && spec.daemon && configuration.stores.some(store => store.machine === 'native')) add('build', ['machine', 'update', 'native', '--daemon', spec.daemon], { note: 'Only if the native daemon path differs.' })
  if (configuration.preset === 'studio') {
    for (const store of configuration.stores) {
      add('build', ['store', 'create', store.name], { note: 'Preparation only: project imports are serial within this store; independent stores can prepare concurrently.' })
      for (const name of store.projects) add('build', ['project', 'init', `${store.name}/${name}`, join(spec.state, 'demo-sources', store.name, name), '--progress'], { note: 'The preset prepares source files here. All imports and store placements finish before concurrent histories start.' })
      if (store.machine !== 'native') add('build', ['store', 'push', store.name, store.machine, '--progress'])
    }
    for (const store of configuration.stores) for (const name of store.projects) {
      for (const [index, step] of projectHistorySteps(store.name, name, { density: configuration.historyDensity, executionMode: configuration.executionMode }).entries()) {
        const { argv, input, key, dependsOn, lane, commitFrom } = step
        add('build', argv, { key, dependsOn, lane, commitFrom, ...(input === undefined ? {} : { input }), ...(index === 0 ? { note: `Project script on ${store.machine}: starts after every store is placed. Independent branches run concurrently; writes on each branch and publications to main remain ordered. Exact publication commits come from successful receipts.` } : {}) })
      }
    }
  } else {
  for (const store of configuration.stores) {
    add('build', ['store', 'create', store.name], { note: 'Independent store pipelines may run concurrently (up to two); project writes within this store remain ordered.' })
    for (const name of store.projects) {
      add('build', ['project', 'init', `${store.name}/${name}`, join(spec.state, 'demo-sources', store.name, name), '--progress'], { note: 'The preset prepares sample source files at this path before initialization.' })
      for (const { argv, input } of projectHistorySteps(store.name, name, { density: configuration.historyDensity, executionMode: configuration.executionMode })) add('build', argv, input === undefined ? {} : { input })
    }
    if (store.machine !== 'native') add('build', ['store', 'push', store.name, store.machine, '--progress'])
    if (sandboxes) {
      const name = `demo-${store.projects[0]}`
      add('build', ['sandbox', 'create', `${store.name}/${store.projects[0]}`, name, store.machine])
      add('build', ['workspace', 'mount', name, projectHistoryPlan(store.projects[0]).definition.features[0].name, '--name', 'feature'])
      add('build', ['workspace', 'mount', name, projectHistoryPlan(store.projects[0]).definition.features[1].name, '--name', 'fix'])
    }
  }
  }
  for (const machine of configuration.machines) add('verify', ['machine', 'get', typeof machine === 'string' ? machine : machine.name])
  for (const store of configuration.stores) {
    add('verify', ['store', 'get', store.name])
    for (const name of store.projects) {
      const project = `${store.name}/${name}`
      add('verify', ['project', 'get', project])
      for (const step of projectVerificationSteps(store.name, name, { density: configuration.historyDensity, executionMode: configuration.executionMode })) add('verify', step.argv)
    }
    if (sandboxes) add('verify', ['sandbox', 'get', `demo-${store.projects[0]}`, '--page-size', '1000', '--page-pos', '0'])
  }
  return commands
}
