#!/usr/bin/env node
// Static check of a scenario folder, without running it: it loads with the
// scenario checks (tools/lib/scenario.mjs: tags, form and placeholders
// included), every bash step's command parses (bash -n for a cli scenario;
// node --check of the inline script for an sdk one), and every changes file
// is the JSON array `layerfs fs apply` reads and is used. A converted replay
// (convert.mjs; it has a final.json) has each fork from a recorded Commit
// checked against final.json's history (forkFailures), and its seed.json against
// the recorded one plus the additions convert.mjs declares for it
// (SEED_ADDITIONS; depot's .cargo/config.toml), and nothing else, written out
// exactly as a run does (host/seed.js). Ported from dsh-layerfs.
//   node tools/replay/check.mjs <scenario> [--scenarios <dir>] [--repo <layerfs checkout>] [--rev <commit>]
// --repo and --rev name the recording (as convert.mjs); only replays read it.
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, lstatSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeSeed } from '../../host/seed.js'
import { loadScenario } from '../lib/scenario.mjs'
import { SEED_ADDITIONS } from './convert.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

/**
 * The problems of scenario folder `folder`, and what it holds.
 * @returns {{ scenario: object, bash: number, changes: number, entries: number, problems: string[] }}
 */
export function checkFolder(folder, { repo, rev } = {}) {
  const name = folder.split('/').filter(Boolean).at(-1)
  const problems = []
  const scenario = loadScenario(folder)
  const scratch = mkdtempSync(join(tmpdir(), `lfc-check-${name}-`))
  const bash = Object.values(scenario.agents)
    .flat()
    .filter((s) => s.kind === 'call' && s.call.name === 'bash')
  const used = new Set()
  try {
    for (const s of bash) {
      const command = s.call.args.command
      const r = spawnSync('bash', ['-n'], { input: command, encoding: 'utf8' })
      if (r.status !== 0) problems.push(`${s.at}: bash -n: ${r.stderr.trim()}`)
      if (scenario.form === 'sdk') {
        const body = command.match(/<<'([A-Z_]+)'\n([\s\S]*)\n\1\n?$/)?.[2] ?? ''
        const file = join(scratch, 'step.mjs')
        writeFileSync(file, body)
        const c = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' })
        if (c.status !== 0) problems.push(`${s.at}: node --check: ${c.stderr.trim().split('\n').slice(0, 5).join(' / ')}`)
      }
      for (const m of command.matchAll(/changes\/([0-9]+(?:-[0-9]+)?\.json)/g)) used.add(m[1])
      if (/\bsandbox\.(mount|exec|commit|unmount):/.test(JSON.stringify(s.expect ?? []))) problems.push(`${s.at}: an old trace name in expect`)
      if (/\bDSH_[A-Z_]+/.test(command)) problems.push(`${s.at}: names a DSH_ setting; LayerFS reads LAYERFS_* names only`)
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }

  const changes = existsSync(join(folder, 'changes')) ? readdirSync(join(folder, 'changes')) : []
  for (const file of changes) {
    let list
    try {
      list = JSON.parse(readFileSync(join(folder, 'changes', file), 'utf8'))
    } catch (error) {
      problems.push(`changes/${file}: ${error.message}`)
      continue
    }
    const ok =
      Array.isArray(list) &&
      list.length &&
      list.every(
        (c) =>
          (c.op === 'write' && typeof c.path === 'string' && c.path.startsWith('/') && typeof c.content === 'string' && Object.keys(c).length === 3) ||
          (c.op === 'mkdir' && typeof c.path === 'string' && c.path.startsWith('/') && Object.keys(c).length === 2),
      )
    if (!ok) problems.push(`changes/${file}: not a list of {op: write, path, content} / {op: mkdir, path}`)
    if (!used.has(file)) problems.push(`changes/${file}: no step applies it`)
  }
  for (const file of used) if (!changes.includes(file)) problems.push(`changes/${file}: applied but missing`)

  if (existsSync(join(folder, 'final.json'))) {
    const final = JSON.parse(readFileSync(join(folder, 'final.json'), 'utf8'))
    problems.push(...forkFailures(bash, final.history))
  }
  const entries = existsSync(join(folder, 'final.json')) ? checkSeed(name, scenario, problems, { repo, rev }) : 0
  return { scenario, bash: bash.length, changes: changes.length, entries, problems }
}

/** A fork from {{commit:<ref>}}, cli or sdk: [name, ref]. */
const FORKS = [/layerfs branch fork '?([^\s']+)'? \{\{commit:([^}]+)\}\}/g, /lf\.branch\.fork\("([^"]+)", "\{\{commit:([^}]+)\}\}"\)/g]

/**
 * Each fork from a recorded Commit against the history the order check
 * compares with: its ref must be the Branch's recorded `forkedFrom`, or an
 * earlier Commit of the same Branch when every recorded Commit after it, up
 * to forkedFrom, is optional (a run may not make those).
 */
export function forkFailures(bash, history) {
  const problems = []
  for (const s of bash) {
    for (const pattern of FORKS) {
      for (const [, name, ref] of s.call.args.command.matchAll(pattern)) {
        const want = history.branches?.[name]?.forkedFrom
        const [, branch, index] = /^(.+)#([0-9]+)$/.exec(ref) ?? []
        if (!want || !branch) continue
        if (want === ref) continue
        const [, wantBranch, wantIndex] = /^(.+)#([0-9]+)$/.exec(want) ?? []
        const between = wantBranch === branch && Number(index) < Number(wantIndex) ? history.branches[branch].commits.slice(Number(index) + 1, Number(wantIndex) + 1) : null
        if (between?.every((c) => c.optional)) continue
        problems.push(`${s.at}: forks ${name} from ${ref}; final.json's history has it forked from ${want}`)
      }
    }
  }
  return problems
}

/** A replay's seed.json against the recorded one plus its declared additions, written out as a run does; answers its entry count. */
function checkSeed(name, scenario, problems, { repo, rev }) {
  const recorded = execFileSync('git', ['-C', repo, 'show', `${rev}:dsh/scenarios/${name}/seed.json`], { encoding: 'utf8' })
  const additions = SEED_ADDITIONS[name] ?? {}
  const seed = JSON.parse(recorded)
  for (const path of Object.keys(additions)) if (seed.entries[path]) problems.push(`seed.json: the declared addition ${path} is in the recorded seed already`)
  seed.entries = { ...seed.entries, ...additions }
  if (!scenario.seed) {
    problems.push('fixture: not a seed file')
    return 0
  }
  if (!Object.keys(additions).length) {
    if (readFileSync(scenario.seed, 'utf8') !== recorded) problems.push('seed.json: differs from the recorded one')
  } else {
    const ours = JSON.parse(readFileSync(scenario.seed, 'utf8'))
    const { entries: ourEntries, ...ourRest } = ours
    const { entries: wantEntries, ...wantRest } = seed
    if (JSON.stringify(ourRest) !== JSON.stringify(wantRest)) problems.push("seed.json: its fields differ from the recorded seed's")
    for (const path of new Set([...Object.keys(ourEntries ?? {}), ...Object.keys(wantEntries)])) {
      const a = ourEntries?.[path]
      const b = wantEntries[path]
      if (JSON.stringify(a) === JSON.stringify(b)) continue
      const why = !a ? 'missing' : !b ? 'neither recorded nor a declared addition' : additions[path] ? 'differs from the declared addition' : 'differs from the recorded entry'
      problems.push(`seed.json ${path}: ${why}`)
    }
  }
  const fixture = writeSeed(scenario.seed, mkdtempSync(join(tmpdir(), `lfc-replay-${name}-`)))
  const found = new Map()
  ;(function walk(dir) {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry)
      const st = lstatSync(path)
      found.set(`/${relative(fixture, path)}`, { st, path })
      if (st.isDirectory()) walk(path)
    }
  })(fixture)
  for (const [path, e] of Object.entries(seed.entries)) {
    const f = found.get(path)
    if (!f) {
      problems.push(`fixture${path}: missing`)
      continue
    }
    found.delete(path)
    const type = f.st.isDirectory() ? 'dir' : f.st.isSymbolicLink() ? 'symlink' : 'file'
    if (type !== e.type) problems.push(`fixture${path}: a ${type}, the seed has a ${e.type}`)
    if (e.mode !== undefined && type !== 'symlink' && (f.st.mode & 0o7777) !== e.mode) {
      problems.push(`fixture${path}: mode ${(f.st.mode & 0o7777).toString(8)}, the seed has ${e.mode.toString(8)}`)
    }
    if (type === 'file') {
      const want = e.text !== undefined ? Buffer.from(e.text) : Buffer.from(e.base64 ?? '', 'base64')
      if (!readFileSync(f.path).equals(want)) problems.push(`fixture${path}: content differs from the seed`)
    }
    if (type === 'symlink' && readlinkSync(f.path) !== e.target) problems.push(`fixture${path}: link target differs`)
  }
  for (const path of found.keys()) problems.push(`fixture${path}: not in the seed`)
  rmSync(fixture, { recursive: true, force: true })
  return Object.keys(seed.entries).length
}

function main() {
  const argv = process.argv.slice(2)
  const opt = (flag, fallback) => {
    const i = argv.indexOf(flag)
    return i < 0 ? fallback : argv.splice(i, 2)[1]
  }
  const scenarios = resolve(opt('--scenarios', join(ROOT, 'scenarios')))
  const repo = resolve(ROOT, opt('--repo', process.env.LAYERFS_SOURCE || '../layerfs'))
  const rev = opt('--rev', '0c7d9c47c1^')
  const [name] = argv
  if (!name || argv.length !== 1) {
    console.error('usage: node tools/replay/check.mjs <scenario> [--scenarios <dir>] [--repo <layerfs checkout>] [--rev <commit>]')
    process.exit(2)
  }
  const r = checkFolder(join(scenarios, name), { repo, rev })
  const fixture = r.entries ? `, ${r.entries} fixture entries` : ''
  console.log(`${name} (${r.scenario.tags.join(', ')}): ${r.bash} bash steps, ${r.changes} changes files${fixture}: ${r.problems.length ? `${r.problems.length} problem(s)` : 'ok'}`)
  for (const p of r.problems) console.log(`  ✕ ${p}`)
  process.exitCode = r.problems.length ? 1 : 0
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
