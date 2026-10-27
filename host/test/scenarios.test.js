// The ten demo scenarios ported from dsh-layerfs: each loads under the format
// v3 checks, every command parses, and no dsh name is left.
//   node --test host/test/scenarios.test.js
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { compileScenario, loadScenarios, SDK_SCRIPT } from '../../tools/lib/scenario.mjs'
import { demoViews } from '../runs/views.js'
import { checkFolder, forkFailures } from '../../tools/replay/check.mjs'
import { NAMES as REPLAYS } from '../../tools/replay/convert.mjs'
import { plan, quoteOf, rewrite } from '../../tools/port-scenarios.mjs'

const APP = fileURLToPath(new URL('../../', import.meta.url))
const SCENARIOS = join(APP, 'scenarios')
const IDS = ['tour', 'parallel', 'conflicts', 'merge', 'sandbox', 'agents', 'teams', 'shop', 'depot', 'crew', 'checkpoints']
/** Scenarios written in Connect, not ported from dsh-layerfs. */
const OWN = ['teams']
const DSH = join(APP, '..', 'dsh-layerfs')
const LAYERFS = join(APP, '..', 'layerfs')
const REV = '0c7d9c47c1^'
const hasRev = () => {
  try {
    execFileSync('git', ['-C', LAYERFS, 'cat-file', '-e', `${REV}:dsh/scenarios/shop/seed.json`], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

test('the eleven scenarios load, in order, with their fixtures', () => {
  const all = loadScenarios(SCENARIOS)
  assert.deepEqual([...all.keys()], IDS)
  for (const s of all.values()) {
    if (['shop', 'depot', 'crew'].includes(s.name)) assert.equal(s.seed, join(SCENARIOS, s.name, 'seed.json'), s.name)
    else assert.equal(s.fixture, resolve(APP, 'fixtures/demo-workspace'), s.name)
  }
  assert.ok(existsSync(join(APP, 'fixtures/demo-workspace/package.json')))
})

test('SDK steps import @layerfs/* and read LAYERFS_PROJECT; no DSH_ name is left', () => {
  for (const s of loadScenarios(SCENARIOS).values()) {
    const text = readFileSync(join(SCENARIOS, s.name, 'scenario.json'), 'utf8')
    assert.doesNotMatch(text, /DSH_/, s.name)
    for (const step of Object.values(s.agents).flat()) {
      if (step.kind !== 'call' || step.call.name !== 'bash') continue
      const command = step.call.args.command
      if (s.form === 'sdk') {
        assert.match(command, SDK_SCRIPT, step.at)
        assert.match(command, /await import\("@layerfs\/agent"\)/, step.at)
        assert.match(command, /LayerFS\.open\(process\.env\.LAYERFS_PROJECT\)/, step.at)
      } else assert.doesNotMatch(command, /@layerfs\/|LayerFS\.open/, step.at)
    }
  }
})

test('every command parses and every changes file is applied (tools/replay/check.mjs)', { skip: !hasRev() && `no ${LAYERFS} with ${REV}` }, () => {
  for (const id of IDS) {
    const r = checkFolder(join(SCENARIOS, id), { repo: LAYERFS, rev: REV })
    assert.deepEqual(r.problems, [], id)
  }
})

test('the port rewrites dsh names and refuses an unmapped one', () => {
  const script = "# x\nnode --input-type=module <<'JS'\nconst { LayerFS } = await import(process.env.DSH_LAYERFS_SDK);\nconst { LayerFSBackend } = await import(process.env.DSH_LAYERFS_BACKEND);\nconst lf = await LayerFS.open(process.env.DSH_LAYERFS_PROJECT);\nawait lf.fs.list('main', '/');\nJS\n"
  const counts = {}
  assert.equal(
    rewrite(script, counts),
    "# x\nnode --input-type=module <<'JS'\nconst { LayerFS } = await import('@layerfs/agent');\nconst { LayerFSBackend } = await import('@layerfs/backend');\nconst lf = await LayerFS.open(process.env.LAYERFS_PROJECT);\nawait lf.fs.list('main', '/');\nJS\n",
  )
  assert.equal(Object.values(counts).reduce((a, b) => a + b), 3)
  assert.equal(quoteOf('const a = f("x", \'y\')'), '"')
  assert.equal(rewrite('echo "$DSH_LAYERFS_PROJECT" ${DSH_LAYERFS_VOLUME}'), 'echo "$LAYERFS_PROJECT" ${LAYERFS_VOLUME}')
  assert.equal(rewrite('../../demo-workspace'), '../../fixtures/demo-workspace')
  assert.throws(() => rewrite('$DSH_LAYERFS_CLI fs list main'), /DSH_LAYERFS_CLI has no LayerFS mapping/)
  assert.throws(() => rewrite('$DSH_SOURCE'), /DSH_SOURCE has no LayerFS mapping/)
})

test('a fork from a recorded Commit must be the one final.json records', () => {
  const step = (at, command) => ({ at, call: { args: { command } } })
  const history = {
    branches: {
      lane: { forkedFrom: 'L0', commits: [{ message: 'a' }, { message: 'b', optional: true }, { message: 'c' }] },
      cut: { forkedFrom: 'lane#2', commits: [] },
      opt: { forkedFrom: 'lane#1', commits: [] },
    },
  }
  const bash = [
    step('s0', 'layerfs branch fork cut {{commit:lane#2}}'),
    step('s1', 'layerfs branch fork opt {{commit:lane#0}}'),
    step('s2', 'layerfs branch fork cut {{commit:lane#0}}'),
    step('s3', "node --input-type=module <<'JS'\nawait lf.branch.fork(\"cut\", \"{{commit:lane#1}}\");\nJS"),
  ]
  assert.deepEqual(forkFailures(bash, history), [
    "s2: forks cut from lane#0; final.json's history has it forked from lane#2",
    "s3: forks cut from lane#1; final.json's history has it forked from lane#2",
  ])
})

test('the replays are what tools/replay/convert.mjs writes', { skip: !hasRev() && `no ${LAYERFS} with ${REV}` }, () => {
  const out = mkdtempSync(join(tmpdir(), 'lfc-convert-'))
  try {
    for (const id of REPLAYS) {
      execFileSync(process.execPath, [join(APP, 'tools/replay/convert.mjs'), id, '--repo', LAYERFS, '--rev', REV, '--out', out], { stdio: 'ignore' })
      execFileSync('diff', ['-r', join(out, id), join(SCENARIOS, id)])
    }
  } finally {
    rmSync(out, { recursive: true, force: true })
  }
})

test('the hand-written scenarios and the fixture are what a port of dsh-layerfs writes', { skip: !existsSync(join(DSH, 'scenarios')) && `no ${DSH}` }, () => {
  const files = plan(DSH)
  const stale = files.filter((f) => !existsSync(join(APP, f.path)) || !readFileSync(join(APP, f.path)).equals(f.bytes)).map((f) => f.path)
  assert.deepEqual(stale, [])
  // and nothing else sits in the ported folders
  const ported = new Set(files.map((f) => f.path))
  const extra = []
  const walk = (dir, rel) => {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      const path = `${rel}/${name.name}`
      if (name.isDirectory()) walk(join(dir, name.name), path)
      else if (!ported.has(path) && path !== 'scenarios/README.md' && ![...REPLAYS, ...OWN].some((id) => path.startsWith(`scenarios/${id}/`))) extra.push(path)
    }
  }
  walk(SCENARIOS, 'scenarios')
  walk(join(APP, 'fixtures/demo-workspace'), 'fixtures/demo-workspace')
  assert.deepEqual(extra, [])
})

test('teams: three sessions, each a lead named after it with two subagents', () => {
  const s = loadScenarios(SCENARIOS).get('teams')
  assert.deepEqual(
    s.sessions.map((x) => [x.name, x.scenario.root, Object.keys(x.scenario.agents)]),
    [
      ['checkout', 'checkout', ['checkout', 'cart', 'pay']],
      ['search', 'search', ['search', 'index', 'results']],
      ['docs', 'docs', ['docs', 'guide', 'faq']],
    ],
  )
  for (const x of s.sessions) {
    assert.ok(x.prompt)
    assert.deepEqual([...x.scenario.parents.values()], [x.name, x.name])
  }
  assert.equal(s.counts.agents, 9)
  const raw = JSON.parse(readFileSync(join(SCENARIOS, 'teams', 'scenario.json'), 'utf8'))
  const { summary, script } = demoViews({ id: 'teams', scenario: s, raw })
  assert.deepEqual(Object.keys(script).sort(), ['cart', 'checkout', 'docs', 'faq', 'guide', 'index', 'pay', 'results', 'search'])
  assert.deepEqual(summary.sessions.map((x) => x.agents), [['checkout', 'cart', 'pay'], ['search', 'index', 'results'], ['docs', 'guide', 'faq']])
  // a lead's last reply is its own (said to the user); a subagent's goes to its lead
  assert.equal(script.checkout.at(-1).kind, 'local')
  assert.equal(script.cart.at(-1).kind, 'subagent')
})

test('a scenario of sessions: refusals', () => {
  const base = { type: 'layerfs-scenario', version: 3, title: 'x', tags: ['cli', 'multi-agent'] }
  const lead = (name, child) => ({ prompt: `p ${name}`, agents: { [name]: [{ subagent: { description: child, prompt: `do ${child}` } }, { reply: 'ok' }], [child]: [{ reply: 'done' }] } })
  const compile = (raw) => compileScenario({ ...base, ...raw }, { name: 'x', folder: SCENARIOS })
  assert.equal(compile({ sessions: { a: lead('a', 'c1'), b: lead('b', 'c2') } }).sessions.length, 2)
  assert.throws(() => compile({ sessions: { a: lead('a', 'c1') } }), /two or more sessions/)
  assert.throws(() => compile({ sessions: { a: lead('a', 'c1'), b: lead('b', 'c1') } }), /also an agent of session a/)
  assert.throws(() => compile({ agents: { root: [{ reply: 'x' }] }, sessions: { a: lead('a', 'c1'), b: lead('b', 'c2') } }), /agents or sessions, not both/)
  assert.throws(() => compile({ prompt: 'p', sessions: { a: lead('a', 'c1'), b: lead('b', 'c2') } }), /a prompt per session/)
  assert.throws(() => compile({ sessions: { a: { prompt: 'p', agents: { root: [{ reply: 'x' }] } }, b: lead('b', 'c2') } }), /steps of a, the session's own agent/)
  assert.throws(() => compile({ sessions: { a: { agents: lead('a', 'c1').agents }, b: lead('b', 'c2') } }), /sessions\.a\.prompt/)
})
