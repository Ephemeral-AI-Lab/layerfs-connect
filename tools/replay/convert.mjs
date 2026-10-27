#!/usr/bin/env node
// Converts a recorded run of the LayerFS scripted model (shop, depot or crew)
// into a scenario (format v3, scenarios/README.md). Ported from dsh-layerfs
// tools/replay/convert.mjs; it writes LayerFS's own names (an SDK step
// imports @layerfs/agent and opens process.env.LAYERFS_PROJECT).
//
//   node tools/replay/convert.mjs <shop|depot|crew> [--repo <layerfs checkout>] [--rev <commit>] [--out <scenarios dir>]
//
// The source is the layerfs repository's dsh/scenarios/<name>/ at --rev
// (default 0c7d9c47c1^, the parent of the commit that moved dsh/ out of the
// layerfs repository), read with git from --repo (default $LAYERFS_SOURCE,
// else ../layerfs beside Connect): scenario.json (format
// layerfs-mock-scenario v2), seed.json, final.json and run/NNN.json, one per
// recorded bash step, with the LayerFS calls it made. --out (default
// Connect's scenarios/) is where it writes. Rerunning replaces
// <out>/<name>/ whole:
//   scenario.json   each recorded bash step that keeps a call is one bash step
//                   that makes its calls as an agent types them: shop and
//                   crew with the layerfs command (form cli), depot as one
//                   inline Node script on the SDK (form sdk). Each step's
//                   `expect` holds the recorded outcome codes, and `exit` the
//                   call's own exit where it is not 0
//   seed.json       the recorded fixture, plus SEED_ADDITIONS (depot: its
//                   .cargo/config.toml), which a run writes out before
//                   its Init (host/seed.js)
//   changes/        each recorded write's changes, as `layerfs fs apply` reads them
//   final.json      as recorded, with main's hashes of the files SEED_ADDITIONS change
//   CONVERSION.md   what was kept, dropped and changed, and why
//
// Owner rules (2026-10-23):
//   rerun          an exec of a command that already ran on the same Branch,
//                  in a Workspace with nothing uncommitted, when nothing on
//                  that Branch changed since (no write, and no Commit the
//                  record has as Committed): dropped with its expect code
//   verification   crew only: a verification-only command is dropped unless
//                  it is an install (npm install / npm ci), the last build
//                  (npm run build, esbuild, tsc) or the last test run (npm
//                  test, npm run test, node --test) of its Branch, or the
//                  latest build or prepare command (npm run prepare-tests)
//                  before that kept test on its Branch; commands that drive
//                  a browser stay out
//   dated          crew's P1e-059: its workflow-impact test reads today's
//                  burndown day of a sprint that ended 2026-10-20; dropped
//   one Sandbox and one Workspace per step
//                  a step that runs commands creates its Sandbox from the
//                  configured runtime image, mounts a new Workspace
//                  of the Branch, runs, Commits, unmounts and closes the
//                  Sandbox. The recorded Sandbox create and close calls are
//                  dropped; a recorded Workspace's mount, Commits and unmount
//                  go to each step that runs one of its commands. Workspaces
//                  the record had mounted on one Branch at once stay together
//                  in the step of their first command
//   Commit ids     a fork from a recorded Commit names it {{commit:<ref>}}:
//                  the id its own step printed (that step lists the ref in
//                  `commits`), or one another agent's reply carried to it;
//                  else the Branch head where the record forked from its
//                  head anyway
// A Workspace in which no command is left is not mounted at all, and a
// Commit after no remaining command is dropped. A bash step left with no call
// is dropped; a turn left with no call is its agent's reply alone (a child
// answering the lead), which keeps the coordination (send_message, reply/until).
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { readSeed } from '../../host/seed.js'
import { ROOT_PROMPTS } from '../lib/prompts.mjs'


const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
/** The replays this converter writes; tools/port-scenarios.mjs leaves their folders to it. */
export const NAMES = ['shop', 'depot', 'crew']

/** Subagent prompts that describe each child's work, in place of the record's; each stays unique, since a child is known by its prompt. */
const PROMPTS = {
  crew: {
    people: "You are people in the Crew team building an issue tracker. Your lane is people: organizations, teams, permissions, invitations and accounts. Each turn, pick up your work where the lead's message points, write, build and test it on your Branches, and report what is done.",
    'work-a': "You are work-a in the Crew team building an issue tracker. Your lane is the issue core: issues, validation, routes, mentions, discussion and Markdown editing. Each turn, pick up your work where the lead's message points, write, build and test it on your Branches, and report what is done.",
    'work-b': "You are work-b in the Crew team building an issue tracker. Your lane is projects and boards: the project schema, ranking, drag state, planning, uploads and attachments. Each turn, pick up your work where the lead's message points, write, build and test it on your Branches, and report what is done.",
    'insight-a': "You are insight-a in the Crew team building an issue tracker. Your lane is search: the query grammar, saved filters, and search over HTTP, the web app and the CLI. Each turn, pick up your work where the lead's message points, write, build and test it on your Branches, and report what is done.",
    'insight-b': "You are insight-b in the Crew team building an issue tracker. Your lane is activity and reporting: activity sources, project transfer previews and digests. Each turn, pick up your work where the lead's message points, write, build and test it on your Branches, and report what is done.",
  },
}

/** Cargo settings depot's recorded commands set by environment on every call, now in its seed. */
const CARGO_BUILD = [
  '[build]',
  'target-dir = "target"',
  'jobs = 3',
  'rustc-wrapper = ""',
  'rustc-workspace-wrapper = ""',
  '',
].join('\n')
const CARGO_CONFIG = `${CARGO_BUILD}\n[net]\nretry = 0\n`
/** Seed entries a scenario adds to the recorded seed; tools/replay/check.mjs accepts these and nothing else. */
/** npm's registry view as of the recordings: their lockfiles resolve again only with it (see NPM_NOTE). */
const NPM_BEFORE = '2026-10-16T00:00:00.000Z'
const NPMRC = { type: 'file', mode: 0o644, text: `before=${NPM_BEFORE}\n` }
export const SEED_ADDITIONS = {
  depot: {
    '/.cargo': { type: 'dir', mode: 0o755 },
    '/.cargo/config.toml': { type: 'file', mode: 0o644, text: CARGO_CONFIG },
  },
  shop: { '/.npmrc': NPMRC },
  crew: { '/.npmrc': NPMRC },
}
const NPM_NOTE = (lock, now) =>
  `The seed's \`.npmrc\` sets npm's \`before=${NPM_BEFORE}\`, so \`npm install\` resolves the registry as it was when the run was recorded. The registry's transitive versions moved since: npm 11.19.0 on this scenario's final package.json files resolves /package-lock.json ${lock.slice(0, 12)} with this date${now ? `, ${now}` : ''}. The file is tracked, so main's record gains it.`
/** Why each scenario's seed additions are there, for its CONVERSION.md. */
const ADDITION_NOTES = {
  depot: "The settings every recorded command set by environment (`CARGO_TARGET_DIR`, `CARGO_BUILD_JOBS=3`, `CARGO_NET_RETRY=0`, an empty `RUSTC_WRAPPER` and `RUSTC_WORKSPACE_WRAPPER`) are in the seed's `.cargo/config.toml`; `RUSTUP_HOME` is left to the image. `CARGO_HOME` cannot be set there, so each cargo command is prefixed with `CARGO_HOME=$PWD/.cargo-home`. The recorded first write replaces `.cargo/config.toml`, so the file it writes carries the same `[build]` table ahead of its recorded content, and its `mkdir /.cargo` is dropped (the seed has the folder).",
  shop: (final) => NPM_NOTE(final.main['/package-lock.json'], 'the recorded one; without it, the same today, but it drifts as crew\'s did'),
  crew: (final) => NPM_NOTE(final.main['/package-lock.json'], 'the recorded one; without it 24489ac13f86, and with 2026-10-10 bb68d5de86af'),
}

const FORMS = { shop: 'cli', crew: 'cli', depot: 'sdk' }
const META = {
  shop: {
    tags: ['cli', 'node', 'publish', 'merge'],
    blurb: "A builder agent grows a small Node web shop from a skeleton to an admin page over six milestones: a product catalog, carts and totals, checkout with orders and discounts, a browser storefront and an admin page. It writes each milestone's code, installs, builds and tests it in a Workspace, smoke-tests the server, merges the storefront with the orders work and publishes every milestone to main.",
  },
  depot: {
    tags: ['sdk', 'rust', 'publish', 'merge'],
    blurb: 'A builder agent writes Depot, a Rust inventory service (a four-crate Cargo workspace: domain, store, HTTP server and CLI) with a browser client. Milestone by milestone it fetches the locked dependencies, builds and tests each crate and runs Python acceptance tests against the server; it works on a registry and a web Branch in parallel and merges them, then runs a release candidate of clean builds, tests, docs, Clippy, rustfmt and packaging, and checks the published main once more.',
  },
  crew: {
    tags: ['cli', 'node', 'multi-agent', 'merge', 'publish'],
    blurb: 'A lead and five agents build one issue-tracking application together: people and organizations, work boards, search and insight, each lane on Branches of its own. The agents write their code and install, build and test it in Workspaces; the lead forks fresh Branches from main and from their Commits, merges the lanes into integration Branches, checks them and publishes them to main.',
  },
}

function main() {
  const argv = process.argv.slice(2)
  const opt = (name, fallback) => { const i = argv.indexOf(name); return i < 0 ? fallback : argv.splice(i, 2)[1] }
  const repo = resolve(ROOT, opt('--repo', process.env.LAYERFS_SOURCE || '../layerfs'))
  const rev = opt('--rev', '0c7d9c47c1^')
  const out = resolve(opt('--out', join(ROOT, 'scenarios')))
  const name = argv[0]
  if (!NAMES.includes(name) || argv.length !== 1) {
    console.error(`usage: node tools/replay/convert.mjs <${NAMES.join('|')}> [--repo <layerfs checkout>] [--rev <commit>] [--out <scenarios dir>]`)
    process.exit(2)
  }
  convert(name, repo, rev, out)
}

function convert(name, repo, rev, outDir) {
  const fail = (message) => { throw new Error(`${name}: ${message}`) }
  const form = FORMS[name]

  // ---------------------------------------------------------------- source
  const src = mkdtempSync(join(tmpdir(), 'replay-convert-'))
  let source
  try {
    const tar = execFileSync('git', ['-C', repo, 'archive', '--format=tar', rev, `dsh/scenarios/${name}`], { maxBuffer: 1 << 30 })
    execFileSync('tar', ['-x', '-C', src], { input: tar })
    const dir = join(src, 'dsh/scenarios', name)
    const json = (file) => JSON.parse(readFileSync(join(dir, file), 'utf8'))
    source = {
      scenario: json('scenario.json'),
      seedText: readFileSync(join(dir, 'seed.json'), 'utf8'),
      finalText: readFileSync(join(dir, 'final.json'), 'utf8'),
      runs: new Map(readdirSync(join(dir, 'run')).sort().map((f) => [f.replace(/\.json$/, ''), json(`run/${f}`)])),
    }
  } finally {
    rmSync(src, { recursive: true, force: true })
  }
  const { scenario: old, runs } = source
  const final = JSON.parse(source.finalText)
  const history = final.history
  if (old.type !== 'layerfs-mock-scenario' || old.version !== 2) fail('scenario.json is not a layerfs-mock-scenario v2')

  // ---------------------------------------------------------------- the decisions, in recorded order
  const INSTALL = /\bnpm (install|ci)\b/
  const BUILD = /\bnpm run build\b|\besbuild\b|\btsc\b/
  const TEST = /\bnpm (run )?test\b|\bnode --test\b/
  const PREPARE = /\bnpm run prepare-tests\b/
  // crew's command whose test reads today's date (owner, 2026-10-23): dropped
  const DATED = name === 'crew' ? new Map([['P1e-059', "its workflow-impact test 16, \"confirmed category changes reuse canonical issue and sprint ledger updates\", reads today's burndown day of a sprint that ended 2026-10-20 (an app test unrelated to LayerFS)"]]) : new Map()
  const verificationOff = name === 'crew'
  const changed = (c) => c.expect?.includes('Committed') && !c.generated // the record's Commit came back Committed
  const idOf = (number) => runs.get(number).step.split(/[ ]/)[0]

  let seq = 0
  const wsOf = new Map() // agent|ws -> Branch
  const execs = []
  for (const [number, run] of runs) {
    for (const c of run.calls) {
      c.number = number
      c.agent = run.agent
      c.seq = seq++
      if (c.op === 'mount') wsOf.set(`${run.agent}|${c.ws}`, c.branch)
      if (c.op === 'exec') { c.branch = wsOf.get(`${run.agent}|${c.ws}`) ?? fail(`${number}: exec in ${c.ws}, which is not mounted`); execs.push(c) }
    }
  }
  const lastOf = new Set()
  if (verificationOff) {
    const lastBuild = new Map(), lastTest = new Map()
    for (const c of execs) {
      if (c.browser) continue
      if (BUILD.test(c.command)) lastBuild.set(c.branch, c)
      if (TEST.test(c.command)) lastTest.set(c.branch, c)
    }
    for (const c of [...lastBuild.values(), ...lastTest.values()]) lastOf.add(c)
    // a kept test also keeps the latest build or prepare command before it on
    // its Branch: crew's people.6 test failed without P1e-054's build
    for (const test of lastTest.values()) {
      const before = execs.slice(0, execs.indexOf(test)).reverse()
        .find((c) => !c.browser && c.branch === test.branch && (BUILD.test(c.command) || PREPARE.test(c.command)))
      if (before) lastOf.add(before)
    }
  }
  const verificationKept = (c) => (!c.browser && INSTALL.test(c.command)) || lastOf.has(c)

  const version = new Map() // Branch -> how many changes it has had
  const lost = new Map() // Branch -> recorded Committed Commits this scenario does not make
  const ran = new Map() // Branch, version, command -> the exec that ran it
  const ranOnBranch = new Map() // Branch, command -> the last exec that ran it (for the summary)
  const live = new Map() // agent|ws -> Workspace
  const publishAt = [] // publish ordinal -> the publish call
  let publishes = 0
  const lifetimes = []
  for (const [number, run] of runs) {
    for (const c of run.calls) {
      const key = `${run.agent}|${c.ws}`
      switch (c.op) {
        case 'mount': {
          const w = { agent: run.agent, branch: c.branch, version: version.get(c.branch) ?? 0, dirty: false, removedSince: false, kept: 0, calls: [c], mount: c }
          live.set(key, w)
          lifetimes.push(w)
          c.w = w
          break
        }
        case 'exec': {
          const w = live.get(key)
          w.calls.push(c)
          c.w = w
          if (DATED.has(idOf(number))) { c.removed = 'dated'; c.dated = DATED.get(idOf(number)) }
          if (!c.removed && verificationOff && c.verification && !verificationKept(c)) c.removed = 'verification'
          const same = `${w.branch}\0${w.version}\0${c.command}`
          const before = !w.dirty && w.version !== null ? ran.get(same) : null
          if (!c.removed && before && before.exit === c.exit && before.expect === c.expect && !c.flaky && !c.sandboxOwn) {
            c.removed = 'rerun'
            c.sameAs = before.number
          }
          if (c.removed) { w.removedSince = true; break }
          const earlier = ranOnBranch.get(`${w.branch}\0${c.command}`)
          if (earlier) {
            c.ranAgain = { as: earlier.number, why: w.dirty ? 'its Workspace held uncommitted changes' : w.version === null ? "its Workspace may not show the Branch's head" : w.version !== earlier.at ? 'the Branch changed since (a write or a Commit recorded as Committed)' : c.flaky || c.sandboxOwn ? 'its recorded exit is a race or a census' : 'its recorded exit differs' }
          }
          ranOnBranch.set(`${w.branch}\0${c.command}`, { number, at: w.version })
          if (!w.dirty && w.version !== null && !ran.has(same)) ran.set(same, c)
          w.dirty = true
          w.kept++
          w.lastExec = c
          break
        }
        case 'commit': {
          const w = live.get(key)
          w.calls.push(c)
          c.w = w
          if (!w.dirty) {
            c.removed = 'nothing'
            if (changed(c)) lost.set(w.branch, [...(lost.get(w.branch) ?? []), c])
            w.removedSince = false
            break
          }
          c.kinds = c.expect === 'sandbox.commit:Committed' && !w.removedSince ? ['Committed'] : ['Committed', 'UpToDate']
          c.after = w.lastExec // the command whose changes it Commits
          const head = version.get(w.branch) ?? 0
          if (changed(c)) { version.set(w.branch, head + 1); w.version = head + 1 } else if (w.version !== head) w.version = null
          w.dirty = false
          w.removedSince = false
          break
        }
        case 'unmount': {
          const w = live.get(key)
          w.calls.push(c)
          c.w = w
          w.unmount = c
          live.delete(key)
          break
        }
        case 'write': version.set(c.branch, (version.get(c.branch) ?? 0) + 1); break
        case 'merge': version.set(c.name, 0); break
        case 'fork': if (c.expect === 'branch.fork:Forked') version.set(c.name, 0); break
        case 'publish': c.ordinal = ++publishes; publishAt[publishes] = c; c.lostBefore = (lost.get(c.branch) ?? []).length > 0; break
        case 'create': case 'close': c.removed = 'sandbox'; break // each step now has a Sandbox of its own
        default: fail(`${number}: unknown call ${c.op}`)
      }
    }
  }
  if (live.size) fail(`Workspaces left mounted at the end: ${[...live.keys()].join(', ')}`)
  for (const w of lifetimes) {
    // a Workspace with no command left is not mounted; the others' mounts and unmounts are placed per step
    for (const c of w.calls) if (c.op === 'mount' || c.op === 'unmount' || !w.kept) c.removed ??= w.kept ? 'placed' : 'nothing'
  }

  // ---------------------------------------------------------------- Workspaces per step
  // Workspaces mounted at once on one Branch (each with a command left) stay
  // together: their calls go to the step of the group's first command
  const kept = lifetimes.filter((w) => w.kept)
  const group = new Map(kept.map((w) => [w, [w]]))
  for (const a of kept) for (const b of kept) {
    if (a === b || a.branch !== b.branch || a.agent !== b.agent || group.get(a) === group.get(b)) continue
    if (b.mount.seq > a.mount.seq && b.mount.seq < a.unmount.seq) {
      const merged = [...group.get(a), ...group.get(b)]
      for (const w of merged) group.set(w, merged)
    }
  }
  const blocksAt = new Map() // run number -> [{ at, items }]
  const together = []
  for (const members of new Set(group.values())) {
    members.sort((x, y) => x.mount.seq - y.mount.seq)
    const work = members.flatMap((w) => w.calls.filter((c) => !c.removed && (c.op === 'exec' || c.op === 'commit'))).sort((x, y) => x.seq - y.seq)
    // a command runs in its own step (a Commit in its command's), or in the group's first when the group has several Workspaces
    const stepOf = (c) => (members.length > 1 ? work[0].number : c.op === 'exec' ? c.number : c.after.number)
    if (members.length > 1) together.push({ members, steps: [...new Set(members.flatMap((w) => w.calls.map((c) => c.number)))].sort() })
    const byStep = new Map()
    for (const c of work) {
      const n = stepOf(c)
      if (!byStep.has(n)) byStep.set(n, [])
      byStep.get(n).push(c)
      c.emittedIn = n
    }
    for (const [n, cs] of byStep) {
      const run = runs.get(n)
      const here = members.filter((w) => cs.some((c) => c.w === w))
      // where the block stands among the step's recorded calls: at its recorded mount, else at its first command
      const mounts = here.map((w) => run.calls.indexOf(w.mount)).filter((i) => i >= 0)
      const first = run.calls.indexOf(cs[0])
      const at = mounts.length ? Math.min(...mounts) : first >= 0 ? first : run.calls.length
      const items = [
        ...here.map((w) => ({ op: 'mount', w })),
        ...cs,
        ...here.slice().sort((x, y) => x.unmount.seq - y.unmount.seq).map((w) => ({ op: 'unmount', w })),
      ]
      if (!blocksAt.has(n)) blocksAt.set(n, [])
      blocksAt.get(n).push({ at, items })
      for (const w of here) (w.steps ??= []).push(n)
    }
  }
  for (const list of blocksAt.values()) list.sort((a, b) => a.at - b.at)

  /** One recorded step's calls as this scenario makes them, or null when none is left. */
  function plan(number) {
    const run = runs.get(number)
    const blocks = blocksAt.get(number) ?? []
    const items = []
    run.calls.forEach((c, i) => {
      for (const b of blocks) if (b.at === i) items.push(...b.items)
      if (!c.removed && !['mount', 'exec', 'commit', 'unmount'].includes(c.op)) items.push(c)
    })
    for (const b of blocks) if (b.at >= run.calls.length) items.push(...b.items)
    if (!items.length) return null
    return { kind: 'bash', number, agent: run.agent, items, sandbox: blocks.length > 0 }
  }

  // ---------------------------------------------------------------- steps, in each agent's order
  const counts = { recordedSteps: 0, keptSteps: 0, replyOnly: 0, otherSteps: 0 }
  const agents = {}
  const planned = new Map() // run number -> its planned step
  for (const [agent, steps] of Object.entries(old.agents)) {
    const out = []
    let phase = null, callsInTurn = 0, dropped = []
    for (const step of steps) {
      if ('pause' in step) continue
      if (step.bash) {
        counts.recordedSteps++
        const [call, ...more] = step.bash.run ?? []
        if (!call || more.length || call[0] !== 'step' || call[1] !== name) fail(`${agent}: a bash step that is not one recorded step: ${JSON.stringify(step.bash)}`)
        const run = runs.get(call[2]) ?? fail(`${agent}: no run/${call[2]}.json`)
        if (run.agent !== agent) fail(`${call[2]} is ${run.agent}'s, in ${agent}'s steps`)
        const p = plan(call[2])
        if (!p) { dropped.push(call[2]); if (step.phase && !phase) phase = step.phase; continue }
        counts.keptSteps++
        p.phase = step.phase ?? phase
        p.timeoutMs = step.bash.timeoutMs
        phase = null
        planned.set(call[2], p)
        out.push(p)
        callsInTurn++
        continue
      }
      counts.otherSteps++
      if ('reply' in step) {
        const next = { reply: step.reply }
        if (step.until) next.until = step.until
        if (step.phase) next.phase = step.phase
        if (!callsInTurn) {
          // a turn with no call left is the reply alone; next to a wait for children it needs a call
          const before = out[out.length - 1]
          if (step.until || (before?.kind === 'reply' && before.step.until)) fail(`${agent}: a turn with no call left next to a wait for children (${dropped.map(idOf).join(', ') || 'no records'})`)
          counts.replyOnly++
          if (dropped.length) next.note = `records ${dropped.map(idOf).join(', ')}: no call left`
        }
        dropped = []
        out.push({ kind: 'reply', step: next })
        callsInTurn = 0
        continue
      }
      const tools = ['subagent', 'send_message'].filter((t) => t in step)
      if (tools.length !== 1) fail(`${agent}: a step this converter does not know: ${JSON.stringify(step).slice(0, 200)}`)
      const next = { [tools[0]]: step[tools[0]] }
      const prompt = tools[0] === 'subagent' ? PROMPTS[name]?.[step.subagent.description] : undefined
      if (prompt) next.subagent = { ...step.subagent, prompt }
      for (const k of ['say', 'phase', 'note']) if (step[k] !== undefined) next[k] = step[k]
      if (phase && !next.phase) { next.phase = phase; phase = null }
      out.push({ kind: tools[0], step: next, to: tools[0] === 'subagent' ? step.subagent.description : String(step.send_message.agent_id).slice(1) })
      callsInTurn++
    }
    agents[agent] = out
  }

  // ---------------------------------------------------------------- Commit refs
  // each Branch's recorded Commits (final.json history) and the calls that made them
  const all = [...runs.values()].flatMap((r) => r.calls)
  const madeBy = new Map() // Branch -> [call | null] by history index
  for (const [branch, h] of Object.entries(history?.branches ?? {})) {
    const candidates = all.filter((c) => (c.op === 'write' && c.branch === branch) || (c.op === 'merge' && c.name === branch) || (c.op === 'commit' && c.w.branch === branch))
    let from = 0
    const made = h.commits.map((entry) => {
      const k = candidates.findIndex((c, i) => i >= from && c.message === entry.message)
      if (k < 0) return null
      from = k + 1
      return candidates[k]
    })
    made.forEach((c, i) => { if (c) c.historyRef = `${branch}#${i}` })
    madeBy.set(branch, made)
  }
  const printing = (c) => !c.removed && (c.op === 'write' || c.op === 'merge' || c.op === 'commit')
  const deterministic = (c) => c.op !== 'commit' || (c.kinds.length === 1 && c.kinds[0] === 'Committed')
  const stepOfCall = (c) => planned.get(c.op === 'commit' ? c.emittedIn : c.number)
  const refCounts = { own: 0, message: 0, head: 0, main: 0, branch: 0 }
  const refNotes = []
  const replyEdits = new Map() // reply step -> refs it carries
  const renamed = []
  for (const fork of all.filter((c) => c.op === 'fork')) {
    const user = planned.get(fork.number)
    // the call names its source by its own count of the Branch's Commits, which
    // may differ from final.json's history; the order check compares with the history
    const recordedFrom = fork.expect === 'branch.fork:Forked' ? history?.branches?.[fork.name]?.forkedFrom : null
    if (recordedFrom && /#[0-9]+$/.test(fork.from ?? '') && recordedFrom !== fork.from) {
      renamed.push(`${idOf(fork.number)} (${fork.agent}) forks ${fork.name}: the recorded call names ${fork.from}, final.json's history ${recordedFrom}`)
      fork.from = recordedFrom
    }
    const where = `${idOf(fork.number)} (${fork.agent}) forks ${fork.name} from ${fork.from}`
    fork.fromArg = null
    if (fork.from == null || fork.from === 'main') continue
    const layer = /^L([0-9]+)$/.exec(fork.from)
    if (layer) {
      // a Layer of main is not a Commit: main's head, when no later publish came before the fork
      const p = publishAt[Number(layer[1])] ?? fail(`${where}: no publish made it`)
      if (p.seq > fork.seq || publishAt.slice(Number(layer[1]) + 1).some((x) => x && x.seq < fork.seq)) fail(`${where}: main's head then was not ${fork.from}`)
      refCounts.main++
      refNotes.push(`${where}: main's head (main showed ${fork.from} then)`)
      continue
    }
    const [, branch, index] = /^(.+)#([0-9]+)$/.exec(fork.from) ?? []
    if (!branch) { fork.fromArg = { branch: fork.from }; refCounts.branch++; continue }
    const made = madeBy.get(branch) ?? fail(`${where}: no recorded history of ${branch}`)
    if (!(Number(index) < made.length)) fail(`${where}: past ${branch}'s recorded Commits`)
    // the recorded Commit, or the one before it this scenario makes
    let i = Number(index)
    while (i >= 0 && (!made[i] || made[i].removed)) i--
    const producer = i >= 0 ? made[i] : null
    const wasHead = !made.slice(Number(index) + 1).some((c) => c && c.seq < fork.seq)
    const headFallback = (why) => {
      if (!wasHead) fail(`${where}: ${why}, and the record did not fork from ${branch}'s head`)
      fork.fromArg = { branch }
      refCounts.head++
      refNotes.push(`${where}: ${branch}'s head, which the record forked from (${why})`)
    }
    if (!producer) { headFallback('this scenario makes none of its Commits up to it'); continue }
    const ref = producer.historyRef
    const step = stepOfCall(producer)
    const prints = step.items.filter(printing)
    if (!prints.every(deterministic)) { headFallback(`its step ${idOf(step.number)} makes a Commit that may be UpToDate, so the ids it prints are not fixed`); continue }
    const tag = i === Number(index) ? '' : `; this scenario does not make ${fork.from} (its command is dropped), so ${ref}, the one before it`
    const refs = prints.map((c, k) => c.historyRef ?? `${idOf(step.number)}.${k}`)
    if (producer.agent === fork.agent) {
      step.commits = refs
      fork.fromArg = { ref }
      refCounts.own++
      refNotes.push(`${where}: its own ${ref} from ${idOf(step.number)}${tag}`)
      continue
    }
    // another agent's: the producer's reply that closes the turn carries it, when the user waits for that turn first
    const carrier = carrierOf(producer.agent, step, fork.agent, user)
    if (!carrier) { headFallback(`no reply of ${producer.agent} reaches ${fork.agent} before it`); continue }
    step.commits = refs
    replyEdits.set(carrier, [...new Set([...(replyEdits.get(carrier) ?? []), ref])])
    fork.fromArg = { ref }
    refCounts.message++
    refNotes.push(`${where}: ${ref} from ${producer.agent}'s ${idOf(step.number)}, carried to ${fork.agent} by ${producer.agent}'s reply closing that turn${tag}`)
  }
  /** The reply of child `from` that closes the turn holding `step`, when its parent `to` waits for that turn before `use`. */
  function carrierOf(from, step, to, use) {
    const theirs = agents[from], ours = agents[to]
    const k = theirs.indexOf(step)
    const turn = theirs.slice(0, k).filter((s) => s.kind === 'reply').length
    const reply = theirs.slice(k).find((s) => s.kind === 'reply')
    if (!reply) return null
    let contacts = 0
    for (const s of ours.slice(0, ours.indexOf(use))) {
      if ((s.kind === 'subagent' || s.kind === 'send_message') && s.to === from) contacts++
      if (s.kind === 'reply' && s.step.until?.includes(from) && contacts > turn) return reply
    }
    return null
  }
  for (const [reply, refs] of replyEdits) reply.step.reply = `${reply.step.reply} ${refs.map((r) => `${r.replace(/#[0-9]+$/, '')} is at Commit {{commit:${r}}}.`).join(' ')}`

  // ---------------------------------------------------------------- seed and changes
  const additions = SEED_ADDITIONS[name] ?? {}
  const changeFiles = new Map()
  const transform = (changes) => {
    if (!additions['/.cargo/config.toml']) return changes
    return changes.filter((ch) => !(ch.op === 'mkdir' && additions[ch.path])).map((ch) => {
      if (ch.op !== 'write' || ch.path !== '/.cargo/config.toml') return ch
      if (/^\[build\]/m.test(ch.content) || !/^\[net\]\nretry = 0$/m.test(ch.content)) fail('the recorded .cargo/config.toml has a [build] table or no net.retry = 0')
      return { ...ch, content: `${CARGO_BUILD}${ch.content}` }
    })
  }
  for (const steps of Object.values(agents)) for (const s of steps) {
    if (s.kind !== 'bash') continue
    const writes = s.items.filter((c) => c.op === 'write')
    writes.forEach((c, k) => {
      c.file = writes.length > 1 ? `${s.number}-${k + 1}.json` : `${s.number}.json`
      changeFiles.set(c.file, transform(c.changes))
    })
  }

  // ---------------------------------------------------------------- commands
  /** The exits a recorded exec allows ("sandbox.exec:exit:1|0"), the recorded one first. */
  const exits = (c) => {
    const m = /^sandbox\.exec:exit:([0-9|]+)$/.exec(c.expect ?? '')
    const codes = m ? m[1].split('|') : [String(c.exit)]
    if (!codes.includes(String(c.exit))) codes.unshift(String(c.exit))
    return [...new Set(codes)]
  }
  const streams = (c) => { const codes = exits(c); return codes.length === 1 && codes[0] === '0' }
  const commandOf = (c) => simplify(name === 'depot' ? cargo(c.command) : c.command)
  const wsNames = (s) => {
    const ws = [...new Set(s.items.filter((c) => c.op === 'mount').map((c) => c.w))]
    return new Map(ws.map((w, k) => [w, ws.length > 1 ? `ws${k + 1}` : 'ws']))
  }

  function renderCli(s, what) {
    const lines = [`# ${what}`], expect = []
    const vars = wsNames(s)
    const firstMount = s.items.findIndex((c) => c.op === 'mount')
    const lastUnmount = s.items.map((c) => c.op).lastIndexOf('unmount')
    s.items.forEach((c, i) => {
      if (i === firstMount) { lines.push('sb=$(layerfs sandbox create | jq -r .sandbox)'); expect.push('sandbox.create:ok') }
      switch (c.op) {
        case 'mount':
          lines.push(`${vars.get(c.w)}=$(layerfs workspace mount "$sb" ${q(c.w.branch)} | jq -r .ws)`)
          expect.push('workspace.mount:Mounted')
          break
        case 'exec': {
          const command = commandOf(c)
          let arg = q(command)
          if (arg.includes("'\\''")) {
            // a command that holds both kinds of quote reads as recorded in a here-document, not in escaped quotes
            let end = 'CMD'
            while (command.split('\n').includes(end)) end += '_END'
            lines.push(`IFS= read -r -d '' cmd <<'${end}'`, command, end)
            arg = '"$cmd"'
          }
          lines.push(`layerfs workspace exec "$${vars.get(c.w)}" ${arg}${msg(c.message)}${streams(c) ? ' --stream' : ''}`)
          expect.push(`workspace.exec:exit:${exits(c).join('|')}`)
          break
        }
        case 'commit':
          lines.push(`layerfs workspace commit "$${vars.get(c.w)}"${msg(c.message)}${c.force ? ' --force' : ''}`)
          expect.push(`workspace.commit:${c.kinds.join('|')}`)
          break
        case 'unmount':
          lines.push(`layerfs workspace unmount "$${vars.get(c.w)}"${c.w.unmount.discard ? ' --discard' : ''}`)
          expect.push('workspace.unmount:Unmounted')
          break
        case 'write':
          lines.push(`layerfs fs apply ${q(c.branch)}${msg(c.message)} --from "{{scenario}}/changes/${c.file}"`)
          expect.push('fs.apply:Committed')
          break
        case 'fork': {
          const from = c.fromArg?.ref ? ` {{commit:${c.fromArg.ref}}}` : c.fromArg?.branch ? ` ${q(c.fromArg.branch)}` : ''
          lines.push(`layerfs branch fork ${q(c.name)}${from}`)
          expect.push(c.expect)
          break
        }
        case 'merge':
          if (c.expect !== 'branch.merge:Merged') fail(`${s.number}: merge expects ${c.expect}`)
          lines.push(`layerfs branch merge ${q(c.a)} ${q(c.b)} ${q(c.name)}${msg(c.message)}`)
          expect.push(c.expect)
          break
        case 'publish':
          if (c.commit) fail(`${s.number}: a publish of a named Commit (${c.commit})`)
          if (c.expect !== 'branch.publish:Added') fail(`${s.number}: publish expects ${c.expect}`)
          lines.push(`layerfs branch publish ${q(c.branch)}`)
          expect.push(c.lostBefore ? 'branch.publish:Added|NoChanges' : c.expect)
          break
        default: fail(`${s.number}: unknown call ${c.op}`)
      }
      if (i === lastUnmount) { lines.push('layerfs sandbox close "$sb"'); expect.push('sandbox.close:Closed') }
    })
    // the call's exit is its last line's: 125 when LayerFS refuses that call
    const last = s.items[s.items.length - 1]
    const refused = s.items.length - 1 !== lastUnmount && last.expect && !/:(Forked|Merged|Added|Committed)$/.test(last.expect)
    return { command: lines.join('\n'), expect, exit: refused ? 125 : 0 }
  }

  function renderSdk(s, what) {
    const expect = [], body = []
    const vars = wsNames(s)
    const firstMount = s.items.findIndex((c) => c.op === 'mount')
    const result = s.items.some((c) => ['commit', 'write', 'merge'].includes(c.op))
    const caught = s.items.some((c) => c.op === 'exec' && !streams(c))
    if (result || caught) body.push(`let ${[result && 'r', caught && 'run'].filter(Boolean).join(', ')};`)
    const say = 'console.log(JSON.stringify({ kind: r.kind, head: r.head }));'
    s.items.forEach((c, i) => {
      if (i === firstMount) { body.push('({ sandbox } = await lf.sandbox.create());'); expect.push('sandbox.create:ok') }
      switch (c.op) {
        case 'mount':
          body.push(`${vars.get(c.w)} = await lf.workspace.mount(sandbox, ${js(c.w.branch)});`)
          expect.push('workspace.mount:Mounted')
          break
        case 'exec': {
          const args = `${vars.get(c.w)}, ${js(commandOf(c))}, ${js(c.message ?? null)}`
          if (streams(c)) body.push(`await lf.workspace.exec(${args}, { stdout: process.stdout, stderr: process.stderr });`)
          else body.push(`run = await lf.workspace.exec(${args});`, 'console.log(`exit ${run.exitCode}`);', 'process.stdout.write(run.stdout);', 'process.stderr.write(run.stderr);')
          expect.push(`workspace.exec:exit:${exits(c).join('|')}`)
          break
        }
        case 'commit':
          body.push(`r = await lf.workspace.commit(${vars.get(c.w)}, ${js(c.message ?? null)}${c.force ? ', true' : ''});`, say)
          expect.push(`workspace.commit:${c.kinds.join('|')}`)
          break
        case 'unmount': break // in finally
        case 'write':
          body.push(`r = await lf.fs.apply(${js(c.branch)}, JSON.parse(readFileSync("{{scenario}}/changes/${c.file}", "utf8")), ${js(c.message ?? null)});`, say)
          expect.push('fs.apply:Committed')
          break
        case 'fork': {
          if (c.expect !== 'branch.fork:Forked') fail(`${s.number}: an sdk step's fork expects ${c.expect}`)
          const from = c.fromArg?.ref ? ', "{{commit:' + c.fromArg.ref + '}}"' : c.fromArg?.branch ? `, ${js(c.fromArg.branch)}` : ''
          body.push(`console.log((await lf.branch.fork(${js(c.name)}${from})).kind);`)
          expect.push(c.expect)
          break
        }
        case 'merge':
          if (c.expect !== 'branch.merge:Merged') fail(`${s.number}: merge expects ${c.expect}`)
          body.push(`r = await lf.branch.merge(${js(c.a)}, ${js(c.b)}, ${js(c.name)}${c.message ? `, ${js(c.message)}` : ''});`, say)
          expect.push(c.expect)
          break
        case 'publish':
          if (c.commit) fail(`${s.number}: a publish of a named Commit (${c.commit})`)
          if (c.expect !== 'branch.publish:Added') fail(`${s.number}: publish expects ${c.expect}`)
          body.push(`console.log((await lf.branch.publish(${js(c.branch)})).kind);`)
          expect.push(c.lostBefore ? 'branch.publish:Added|NoChanges' : c.expect)
          break
        default: fail(`${s.number}: unknown call ${c.op}`)
      }
    })
    const names = [...vars.values()]
    // the unmounts and the Sandbox's close come last, in finally
    if (s.sandbox) expect.push(...names.map(() => 'workspace.unmount:Unmounted'), 'sandbox.close:Closed')
    const lines = [
      `# ${what}`,
      "node --input-type=module <<'JS'",
      ...(s.items.some((c) => c.op === 'write') ? ['import { readFileSync } from "node:fs";'] : []),
      'const { LayerFS } = await import("@layerfs/agent");',
      'const lf = await LayerFS.open(process.env.LAYERFS_PROJECT);',
      ...(s.sandbox ? [`let sandbox, ${names.join(', ')};`] : []),
      'try {',
      ...body.map((l) => `  ${l}`),
      '} finally {',
      ...names.map((w) => `  if (${w}) await lf.workspace.unmount(${w});`),
      ...(s.sandbox ? ['  if (sandbox) await lf.sandbox.close(sandbox);'] : []),
      '  await lf.close();',
      '}',
      'JS',
    ]
    return { command: lines.join('\n'), expect, exit: 0 }
  }

  const render = form === 'sdk' ? renderSdk : renderCli
  const sandboxes = { recorded: all.filter((c) => c.op === 'create').length, now: 0 }
  const scenarioAgents = {}
  for (const [agent, steps] of Object.entries(agents)) {
    scenarioAgents[agent] = steps.map((s) => {
      if (s.kind !== 'bash') return s.step
      if (s.sandbox) sandboxes.now++
      const what = description(name, runs.get(s.number), idOf(s.number))
      const { command, expect, exit } = render(s, what)
      const execsHere = s.items.filter((c) => c.op === 'exec')
      const bash = { description: what, command }
      if (execsHere.length) bash.timeoutMs = Math.max(s.timeoutMs ?? 0, execsHere.reduce((n, c) => n + timeoutOf(commandOf(c)) * 1000, 0) + 90000)
      const next = { bash }
      if (s.phase) next.phase = s.phase
      next.note = noteOf(s)
      if (expect.length) next.expect = expect
      if (exit) next.exit = exit
      if (s.commits) next.commits = s.commits
      return next
    })
  }
  function noteOf(s) {
    // the recorded steps whose calls this step makes: a Workspace's mount in its first step, its unmount in its last
    const absorbed = [...new Set(s.items.flatMap((c) => (c.op === 'mount' ? (c.w.steps[0] === s.number ? [c.w.mount.number] : []) : c.op === 'unmount' ? (c.w.steps.at(-1) === s.number ? [c.w.unmount.number] : []) : [c.number])))].filter((n) => n !== s.number).sort()
    const parts = [`record ${idOf(s.number)}${absorbed.length ? ` (with ${absorbed.map(idOf).join(', ')})` : ''}`]
    for (const c of s.items.filter((c) => c.op === 'exec')) {
      if (c.flaky) parts.push(`exit ${c.exit} in the record came from a racing test only: ${c.flaky.tests?.join('; ') ?? `${c.flaky.errors.join(' or ')} in ${c.flaky.where}`}`)
      if (c.sandboxOwn) parts.push(`a process census written for the recorded runtime; it may also find the Sandbox's own ${c.sandboxOwn.join(', ')}`)
    }
    return parts.join('; ')
  }

  // ---------------------------------------------------------------- output
  const folder = join(outDir, name)
  rmSync(folder, { recursive: true, force: true })
  mkdirSync(join(folder, 'changes'), { recursive: true })

  // fixture: the recorded seed.json, plus this scenario's declared additions
  let seedText = source.seedText
  if (Object.keys(additions).length) {
    const seed = JSON.parse(seedText)
    for (const path of Object.keys(additions)) if (seed.entries[path]) fail(`the recorded seed already has ${path}`)
    seed.entries = { ...seed.entries, ...additions }
    seedText = `${JSON.stringify(seed, null, 1)}\n`
  }
  writeFileSync(join(folder, 'seed.json'), seedText)
  try { readSeed(join(folder, 'seed.json')) } catch (error) { fail(error.message) }

  for (const [file, changes] of changeFiles) writeFileSync(join(folder, 'changes', file), `${JSON.stringify(changes, null, 1)}\n`)

  // final.json: main's hashes of the files the seed's additions change
  let finalText = source.finalText
  const finalChanged = []
  const sha = (text) => createHash('sha256').update(text).digest('hex')
  for (const [path, e] of Object.entries(additions)) {
    // a tracked file the recording never wrote: main has it as the seed does
    if (e.type !== 'file' || path === '/.cargo/config.toml') continue
    if (final.main[path] || all.some((c) => c.op === 'write' && c.changes.some((ch) => ch.path === path))) fail(`the recording has ${path} already`)
    final.main[path] = sha(e.text)
    finalChanged.push(`main ${path}: added, ${final.main[path]}`)
  }
  if (finalChanged.length) final.main = Object.fromEntries(Object.entries(final.main).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
  if (additions['/.cargo/config.toml']) {
    const written = all.filter((c) => c.op === 'write').flatMap((c) => c.changes).filter((ch) => ch.op === 'write' && ch.path === '/.cargo/config.toml')
    const last = written[written.length - 1]
    if (!last || final.main['/.cargo/config.toml'] !== sha(last.content)) fail("main's recorded .cargo/config.toml is not the last one written")
    const now = sha(`${CARGO_BUILD}${last.content}`)
    finalChanged.push(`main /.cargo/config.toml: ${final.main['/.cargo/config.toml']} -> ${now}`)
    final.main['/.cargo/config.toml'] = now
  }
  if (finalChanged.length) {
    const indent = /^\{\n( +)"/.exec(source.finalText)?.[1].length ?? 1
    finalText = `${JSON.stringify(final, null, indent)}${source.finalText.endsWith('\n') ? '\n' : ''}`
  }
  writeFileSync(join(folder, 'final.json'), finalText)

  const { tags, blurb } = META[name]
  const scenario = { type: 'layerfs-scenario', version: 3, title: old.title, blurb, prompt: ROOT_PROMPTS[name], order: old.order, tags, fixture: 'seed.json', agents: scenarioAgents }
  writeFileSync(join(folder, 'scenario.json'), `${JSON.stringify(scenario, null, 1)}\n`)

  // ---------------------------------------------------------------- summary
  const by = (op, why) => all.filter((c) => c.op === op && c.removed === why).length
  const keptExecs = execs.filter((c) => !c.removed)
  const seconds = (list) => (list.reduce((n, c) => n + c.ms, 0) / 1000).toFixed(1)
  const lostCommits = [...lost.values()].flat()
  const required = new Set(Object.entries(history?.branches ?? {}).flatMap(([b, h]) => h.commits.filter((c) => c.via === 'exec' && !c.optional).map((c) => `${b}\0${c.message}`)))
  const lostTracked = lostCommits.filter((c) => required.has(`${c.w.branch}\0${c.message}`))
  const bashSteps = Object.values(agents).flat().filter((s) => s.kind === 'bash')
  const lines = [
    `# ${old.title}: conversion`,
    '',
    `Written by \`node tools/replay/convert.mjs ${name}\` from \`${rev}\` of the layerfs repository (\`dsh/scenarios/${name}/\`). Rerun it to rewrite this folder; do not edit by hand.`,
    '',
    `Form \`${form}\`: ${form === 'cli' ? 'every bash step is plain `layerfs` lines' : 'every bash step is one inline Node script on the SDK'}. Each step that runs a command creates its own Sandbox from the configured runtime image, mounts a new Workspace, runs, Commits, unmounts and closes the Sandbox. The recorded outcome codes are each step's \`expect\`, checked live; the record id is each step's \`note\`.`,
    '',
    '| | count |',
    '| --- | ---: |',
    `| recorded steps (bash) | ${counts.recordedSteps} |`,
    `| bash steps kept | ${counts.keptSteps} |`,
    `| coordination steps (subagent, send_message, reply) | ${counts.otherSteps} |`,
    `| steps in all | ${counts.keptSteps + counts.otherSteps} |`,
    `| turns left with no call: the reply alone, no echo | ${counts.replyOnly} |`,
    `| commands recorded | ${execs.length} |`,
    `| dropped: identical re-run on an unchanged Branch | ${by('exec', 'rerun')} |`,
    `| dropped: verification off${verificationOff ? '' : ' (not applied)'} | ${by('exec', 'verification')} |`,
    `| dropped: date-dependent | ${by('exec', 'dated')} |`,
    `| commands kept | ${keptExecs.length} |`,
    `| recorded seconds of the commands kept | ${seconds(keptExecs)} |`,
    `| recorded seconds of all commands | ${seconds(execs)} |`,
    `| Workspace mounts now / recorded | ${bashSteps.reduce((n, s) => n + s.items.filter((c) => c.op === 'mount').length, 0)} / ${all.filter((c) => c.op === 'mount').length} |`,
    `| Workspace Commits kept / recorded | ${all.filter((c) => c.op === 'commit' && !c.removed).length} / ${all.filter((c) => c.op === 'commit').length} |`,
    `| Sandbox creates now / recorded | ${sandboxes.now} / ${sandboxes.recorded} (${sandboxes.now >= sandboxes.recorded ? '+' : ''}${sandboxes.now - sandboxes.recorded}) |`,
    `| recorded Committed Commits this scenario does not make | ${lostCommits.length} (${lostTracked.length} not optional in the recorded history) |`,
    `| writes (fs.apply) | ${all.filter((c) => c.op === 'write').length} |`,
    `| forks from a recorded Commit: own id / a reply's id / Branch head | ${refCounts.own} / ${refCounts.message} / ${refCounts.head} |`,
    `| forks from a Layer of main (now main's head) | ${refCounts.main} |`,
    '',
    'Forks from a recorded Commit or Layer:',
    '',
    ...(refNotes.length ? refNotes.map((n) => `- ${n}`) : ['- none']),
    '',
    "Forks whose recorded call names another Commit than final.json's history (the history decides, as the order check compares with it):",
    '',
    ...(renamed.length ? renamed.map((n) => `- ${n}`) : ['- none']),
    '',
    'Workspaces the record had mounted on one Branch at once, kept together in one step:',
    '',
    ...(together.length ? together.map((t) => `- ${t.members.map((w) => `${w.branch} ${w.mount.ws}`).join(' and ')}: records ${t.steps.map(idOf).join(', ')}`) : ['- none']),
    '',
    'Commands dropped as identical re-runs (step: same as step):',
    '',
    ...execs.filter((c) => c.removed === 'rerun').map((c) => `- ${runs.get(c.number).step}: same as ${runs.get(c.sameAs).step}, nothing changed on ${c.branch} since`),
    ...(by('exec', 'rerun') ? [] : ['- none']),
    '',
    'Commands dropped as date-dependent:',
    '',
    ...execs.filter((c) => c.removed === 'dated').map((c) => `- ${runs.get(c.number).step}: ${c.dated}`),
    ...(by('exec', 'dated') ? [] : ['- none']),
    '',
    'Commands kept that repeat an earlier kept command on the same Branch, and why they run again:',
    '',
    ...keptExecs.filter((c) => c.ranAgain).map((c) => `- ${runs.get(c.number).step}: same as ${runs.get(c.ranAgain.as).step}; ${c.ranAgain.why}`),
    ...(keptExecs.some((c) => c.ranAgain) ? [] : ['- none']),
    '',
  ]
  if (verificationOff) {
    lines.push("Verification commands kept (install, a Branch's last build or test, or the latest build or prepare before that test):", '')
    for (const c of keptExecs.filter((c) => c.verification)) lines.push(`- ${runs.get(c.number).step} (${c.branch}; ${[!c.browser && INSTALL.test(c.command) && 'install', BUILD.test(c.command) && 'build', PREPARE.test(c.command) && 'prepare', TEST.test(c.command) && 'test'].filter(Boolean).join(', ')}; ${(c.ms / 1000).toFixed(1)} s)`)
    lines.push('')
  }
  if (Object.keys(additions).length) {
    lines.push('Seed additions (tools/replay/check.mjs accepts exactly these):', '')
    for (const [path, e] of Object.entries(additions)) lines.push(`- ${path} (${e.type}${e.text ? `: ${JSON.stringify(e.text)}` : ''})`)
    const note = ADDITION_NOTES[name]
    lines.push('', typeof note === 'function' ? note(final) : note, '')
    lines.push('final.json:', '', ...finalChanged.map((l) => `- ${l}`), '')
  }
  if (lostTracked.length) {
    lines.push("Recorded Commits with tracked changes this scenario does not make (main's files may differ from final.json where they reached main):", '')
    for (const c of lostTracked) lines.push(`- ${c.w.branch}: ${c.message}`)
    lines.push('')
  }
  writeFileSync(join(folder, 'CONVERSION.md'), `${lines.join('\n')}\n`)
  console.log(lines.filter((l) => l.startsWith('|') && !l.startsWith('| ---') && !l.startsWith('| |')).join('\n'))
  console.log(`wrote ${folder}: ${changeFiles.size} changes files`)
}

// ------------------------------------------------------------------ helpers
const SAFE = /^[A-Za-z0-9._\/:@%+=,-]+$/
const sq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`
/** A shell word: bare when safe, else in single quotes, else in double quotes when nothing in it expands, else single quotes with '\'' escapes. */
function q(s) {
  s = String(s)
  if (SAFE.test(s)) return s
  if (!s.includes("'")) return `'${s}'`
  if (!/["$`\\!\n]/.test(s)) return `"${s}"`
  return sq(s)
}
const msg = (m) => (m == null || m === '' ? '' : ` -m ${q(m)}`)
/** A JavaScript string literal: a template literal for a multi-line command, else JSON. */
function js(s) {
  if (s === null) return 'null'
  if (s.includes('\n') && !/[`\\]|\$\{/.test(s)) return `\`${s}\``
  return JSON.stringify(s)
}

/** A command's `timeout N` in seconds, 110 when it has none. */
function timeoutOf(command) {
  const m = /^(?:[A-Z_]+=\S+ )*timeout ([0-9]+) /.exec(command)
  return m ? Number(m[1]) : 110
}

const KEYWORD = /^(cd|export|set|unset|source|\.|exec|eval|if|for|while|until|case|\[|\[\[|\{|!|function|declare|local|read|shopt|trap|ulimit|umask)$/
/** `timeout N bash -c '<cmd>'` as `timeout N <cmd>` when <cmd> is one simple command; its leading VAR=value words go before timeout. */
function simplify(command) {
  const m = /^timeout ([0-9]+) bash -c '((?:[^']|'\\'')*)'$/.exec(command)
  if (!m) return command
  const inner = m[2].replace(/'\\''/g, "'")
  // compound, or not plainly one command (substitution, heredoc, node -e with an inline program): as recorded
  if (/[;&|()`\n<]|\$\(|\bnode -e\b|^\s|\s$/.test(inner)) return command
  const words = inner.split(' ')
  let k = 0
  while (k < words.length && /^[A-Z_][A-Z0-9_]*=/.test(words[k])) k++
  if (k === words.length || KEYWORD.test(words[k])) return command
  return [...words.slice(0, k), `timeout ${m[1]}`, ...words.slice(k)].join(' ')
}

const CARGO_ENV = /^(timeout [0-9]+ bash -c ')export CARGO_HOME="\$PWD\/\.cargo-home" CARGO_TARGET_DIR="\$PWD\/target" CARGO_NET_RETRY=0 CARGO_BUILD_JOBS=3 RUSTUP_HOME=\/usr\/local\/rustup RUSTC_WRAPPER= RUSTC_WORKSPACE_WRAPPER=; /
/** Depot's recorded command without its Cargo exports (now in .cargo/config.toml), each cargo command prefixed with CARGO_HOME. */
function cargo(command) {
  if (!CARGO_ENV.test(command)) {
    if (/\bcargo\b|CARGO_|RUSTC_/.test(command) && !/<<'AUDIT'/.test(command)) throw new Error(`depot: a Cargo command outside the recorded export line: ${command.slice(0, 200)}`)
    return command
  }
  return command.replace(CARGO_ENV, '$1').replace(/(^timeout [0-9]+ bash -c '|; |&& |\|\| )((?:timeout [0-9]+ )?)cargo /g, '$1CARGO_HOME=$$PWD/.cargo-home $2cargo ')
}

/** A step's description in readable words: what it does, without the record id. */
function description(name, run, id) {
  if (name === 'depot') {
    const commit = run.calls.find((c) => c.op === 'commit')
    if (commit) return capital(commit.message.replace(/ \(exit [0-9]+\)$/, '').replace(/^final-main acceptance /, 'Final main: ').replace(/^(M[0-9]+)( candidate)? /, '$1$2: '))
    const write = run.calls.find((c) => c.op === 'write')
    if (write) return capital(write.message.replace(/^(M[0-9]+) /, '$1: '))
    // Branch calls only: say what they do
    const said = run.calls.flatMap((c) => c.op === 'publish' ? [`publish ${c.branch} to main`] : c.op === 'fork' ? [`fork ${c.name}`] : c.op === 'merge' ? [`merge ${c.a} and ${c.b} into ${c.name}`] : [])
    const milestone = /-m([0-9]+)\b/.exec(run.step)?.[1]
    if (said.length) {
      const text = said.length > 1 ? `${said.slice(0, -1).join(', ')} and ${said.at(-1)}` : said[0]
      return milestone ? `M${milestone}: ${text}` : capital(text)
    }
    return capital(run.step.replace(/^[0-9]+-/, '').replace(/-/g, ' ').replace(/\bm([0-9]+)\b/g, 'M$1'))
  }
  const text = run.step.slice(id.length).trim().replace(/^[0-9]{3} /, '').replace(/ (exec|execute)$/, '')
  return capital(text || run.step)
}
const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1)

// run last: the helpers above are module constants
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main()
