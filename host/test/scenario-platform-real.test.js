// `/scenario <name> -platform <p>` on the real LayerFS (layerfs#529): each
// scenario plays as a scenario chat (AgentManager.createScenario, the call
// POST /api/agent/sessions makes for the command) on a throwaway project of
// the home LAYERFS_CONNECT_STATE names. It passes its checks and lands on
// main; every sandbox.create its scripts sent named the platform; nothing is
// left running; and a platform this home does not allow is refused 409
// before anything is made. Skipped unless LFC_PLATFORM is set.
// On a vm:ssh home each run wants an empty Store disk: one host serves one
// Store, and a project's delete leaves the disk as it is (it is the user's).
//   LAYERFS_CONNECT_STATE=<home's state> LFC_PLATFORM=<platform> [LFC_SCENARIOS=tour,merge] \
//     node --import ./host/resolve-layerfs.js --test host/test/scenario-platform-real.test.js
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { setTimeout as pause } from 'node:timers/promises'
import { after, before, test } from 'node:test'

const PLATFORM = process.env.LFC_PLATFORM
const SCENARIOS = (process.env.LFC_SCENARIOS || 'tour,merge').split(',').filter(Boolean)
const PLAY_MS = Number(process.env.LFC_PLAY_MS || 20 * 60_000)
const skip = PLATFORM ? false : 'set LFC_PLATFORM (and LAYERFS_CONNECT_STATE) to play scenarios on a platform'

let spec, config, project, manager, scenarios, runtime, agentState
const NAME = `lfc-${(PLATFORM ?? 'none').replace(/[^a-z0-9]/g, '')}-${process.pid}`
const evidence = []

before(async () => {
  if (skip) return
  config = await import('../config.js')
  const { AgentManager } = await import('../agents/index.js')
  const { AgentScenarios } = await import('../agents/scenarios.js')
  const { projectRecord } = await import('../runs/folder.js')
  spec = config.resolveSpec()
  const fixture = join(config.APP, 'fixtures', 'demo-workspace')
  const t0 = Date.now()
  if (config.isHostHome(spec)) {
    // a host home: the Store file on this disk, made by the SDK's Init
    mkdirSync(dirname(config.hostStorePath(spec, NAME)), { recursive: true, mode: 0o700 })
    mkdirSync(spec.localDir, { recursive: true, mode: 0o755 })
    const { LayerFS } = await import('@layerfs/agent')
    const lf = await config.withProjectEnv(spec, { name: NAME, volume: null }, () => LayerFS.init(NAME, fixture))
    await lf.close()
  } else {
    runtime = await config.openRuntime(spec)
    let job = await runtime.project.start_init(NAME, fixture, {})
    while (!job.ended) {
      await pause(500)
      job = await runtime.project.get_init(job.id)
    }
    assert.equal(job.step, 'done', job.error?.message)
  }
  project = await projectRecord(spec, NAME)
  console.log(`# ${PLATFORM}: project ${NAME} made in ${Math.round((Date.now() - t0) / 1000)} s (${config.isHostHome(spec) ? `${spec.sandbox} home` : spec.placement})`)
  scenarios = await new AgentScenarios({ spec }).ready()
  agentState = mkdtempSync(join(tmpdir(), 'lfc-scenario-platform-'))
  manager = await AgentManager.create({ state: agentState, projectEnvironment: (key) => projectRecord(spec, key), scenarios })
})

after(async () => {
  if (skip) return
  await manager?.close().catch((e) => console.log(`# closing chats: ${e.message}`))
  if (config && config.isHostHome(spec)) {
    // the SDK has no project delete: its Store, its home entry and its Sandboxes' folders (each test closed them)
    const local = existsSync(spec.localDir) ? readdirSync(spec.localDir).filter((d) => d.startsWith(`${spec.prefix}${NAME}-`)) : []
    for (const path of [dirname(config.hostStorePath(spec, NAME)), join(spec.home, NAME), ...local.map((d) => join(spec.localDir, d))]) rmSync(path, { recursive: true, force: true })
  } else if (runtime) {
    // on a VM home, project.delete reads the Store's holders with a Docker deployment, which the
    // VM's worker refuses (LayerFS #530, sandbox/records.js); a stopped VM holds nothing to read
    if (config.isVm(spec)) await runtime.vm.stop(NAME).catch((e) => console.log(`# stopping ${NAME}'s VM: ${e.message}`))
    await runtime.project.delete(NAME, { confirm: NAME, stopSandboxes: true }).catch((e) => console.log(`# deleting ${NAME}: ${e.message}`))
    await runtime.close()
  }
  if (agentState) rmSync(agentState, { recursive: true, force: true })
  for (const line of evidence) console.log(`# ${line}`)
})

/** The finished sandbox.create lines a chat's scripts wrote. */
function creates(id) {
  const file = join(manager.dir, id, 'traces', 'root.jsonl')
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).map((raw) => {
    try { return JSON.parse(raw) } catch { return null }
  }).filter((l) => l?.layerfs_trace === 1 && l.method === 'sandbox.create' && l.phase !== 'start' && l.phase !== 'skipped')
}

for (const id of SCENARIOS) {
  test(`${id} plays on ${PLATFORM} through /scenario -platform`, { skip, timeout: PLAY_MS + 60_000 }, async () => {
    const t0 = Date.now()
    const detail = await manager.createScenario({ scenario: id, project: NAME, platform: PLATFORM })
    assert.equal(detail.scenario.platform, PLATFORM)
    let s
    for (const until = Date.now() + PLAY_MS; Date.now() < until; await pause(1000)) {
      const record = manager.record(detail.id)
      s = record.scenario
      // passed, or failed or stopped; a script that stopped leaves the chat idle on 'playing'
      if (['passed', 'failed', 'stopped'].includes(s.state)) break
      if (s.state === 'playing' && record.state === 'error') break
    }
    const failed = (s.checks ?? []).filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail}`)
    assert.equal(s.state, 'passed', `${id} on ${PLATFORM}: ${s.state} ${s.error ?? ''} ${failed.join('; ')} ${manager.record(detail.id).error ?? ''}`)
    assert.ok(s.checks.some((c) => c.name === 'main.landed' && c.ok), `${id} landed on main`)

    const made = creates(detail.id)
    assert.ok(made.length > 0, `${id}'s scripts made Sandboxes`)
    for (const line of made) {
      assert.equal(line.ok, true, `sandbox.create: ${line.code} ${line.message ?? ''}`)
      assert.equal(line.args?.platform, PLATFORM, `sandbox.create sent platform ${line.args?.platform}`)
    }
    // every Sandbox it made was closed
    const { LayerFS } = await import('@layerfs/agent')
    const lf = await config.withProjectEnv(spec, project, () => LayerFS.open(NAME))
    try {
      const left = (await lf.project.list_sandboxes(1000, 0)).items
      assert.deepEqual(left.map((b) => `${b.sandbox}:${b.platform}`), [], 'no Sandbox left running')
    } finally {
      await lf.close()
    }
    evidence.push(`${id} on ${PLATFORM}: passed in ${Math.round((Date.now() - t0) / 1000)} s, ${made.length} Sandboxes made by its scripts, each sandbox.create with platform ${PLATFORM}; checks ${s.checks.map((c) => c.name).join(', ')}`)
  })
}

test(`a platform this home does not allow is refused before anything is made`, { skip }, async () => {
  const status = await scenarios.status()
  const other = (status.platforms ?? []).find((p) => !p.allowed)
  assert.ok(other, 'this home disallows some platform')
  await assert.rejects(scenarios.checkPlatform(other.id), (e) => e.status === 409 && /is not available on this home/.test(e.message))
  const allowed = status.platforms.filter((p) => p.allowed).map((p) => p.id)
  assert.ok(allowed.includes(PLATFORM), `${PLATFORM} is allowed here (allowed: ${allowed.join(', ')})`)
  evidence.push(`refusal: -platform ${other.id} refused 409; this home allows ${allowed.join(', ')}`)
})
