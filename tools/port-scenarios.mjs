#!/usr/bin/env node
// Ports dsh-layerfs's hand-written demo scenarios and their fixture into
// Connect, renamed from dsh's names to LayerFS's own. Rerunnable: each run
// replaces scenarios/<id>/, scenarios/CONVERSION.md and
// fixtures/demo-workspace/ whole. scenarios/README.md is Connect's own, and
// the replays (shop, depot, crew) are not ported: tools/replay/convert.mjs
// writes them from the recording, with Connect's own fixes (an npm pin, fork
// sources from final.json's history), so they differ from dsh-layerfs's.
//   node tools/port-scenarios.mjs [--from <dsh-layerfs checkout>] [--check]
// --from defaults to ../dsh-layerfs beside Connect. Only files Git tracks
// there are copied, as they are in its working tree. --check writes nothing:
// it exits 1 when Connect's copy differs from what a port would write.
//
// What changes (the full list is in scenarios/README.md):
//   scenario.json   every string: the SDK and backend imports become bare
//                   @layerfs/agent and @layerfs/backend imports (the engine's
//                   resolve hook finds them), DSH_LAYERFS_<NAME> becomes
//                   LAYERFS_<NAME>, the fixture path moves under fixtures/
//   CONVERSION.md   prose naming dsh's host and plugin
// Nothing else changes: steps, expects, exits, commits, placeholders, the
// shell and the JS stay as they are. A DSH_ name with no mapping stops the port.
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { NAMES as REPLAYS } from './replay/convert.mjs'

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** dsh's names with a LayerFS meaning: the engine sets each as LAYERFS_<NAME>. */
export const ENV_NAMES = [
  'PROJECT',
  'HOME',
  'DOCKER',
  'IMAGE',
  'DAEMON',
  'VOLUME',
  'STORE_PATH',
  'CONTAINER_PREFIX',
  'WORKER_ENDPOINT',
  'TRACE',
  'TRACE_STEP',
  'TRACE_START',
]
const FIXTURE_FROM = '../../demo-workspace'
const FIXTURE_TO = '../../fixtures/demo-workspace'

/** Prose in CONVERSION.md that names dsh's host or plugin, and its neutral wording. */
export const PROSE = [
  ['the configured Host runtime image', 'the configured runtime image'],
  [
    "They come from the Host's own Branch poll\n  (`packages/host/src/storage.js`), not from the scenario.",
    "They came from the recording host's own Branch\n  poll, not from the scenario.",
  ],
]

/**
 * The quote a script's string literals use: the first ' or " in its code,
 * past the heredoc line, the dsh imports and comment lines; else ".
 */
export function quoteOf(script) {
  const code = script
    .split('\n')
    .filter((l) => !/<<'[A-Z_]+'$/.test(l) && !/import\(process\.env\.DSH_/.test(l) && !/^\s*(#|\/\/)/.test(l))
    .join('\n')
  return code.match(/["']/)?.[0] ?? '"'
}

/**
 * Rewrites one string of a scenario.json. Answers the new text and the count
 * of each rule it applied.
 */
export function rewrite(text, counts = {}) {
  const bump = (rule, n = 1) => {
    if (n) counts[rule] = (counts[rule] ?? 0) + n
  }
  let out = text
  if (out.includes('DSH_LAYERFS_SDK') || out.includes('DSH_LAYERFS_BACKEND')) {
    const q = quoteOf(out)
    out = out.replace(/import\(process\.env\.DSH_LAYERFS_(SDK|BACKEND)\)/g, (_, which) => {
      bump(`import(process.env.DSH_LAYERFS_${which}) -> import(${q}@layerfs/${which === 'SDK' ? 'agent' : 'backend'}${q})`)
      return `import(${q}@layerfs/${which === 'SDK' ? 'agent' : 'backend'}${q})`
    })
  }
  out = out.replace(/(\$\{?|process\.env\.)DSH_LAYERFS_([A-Z_]+)\b/g, (all, lead, name) => {
    if (!ENV_NAMES.includes(name)) return all
    bump(`${lead === 'process.env.' ? 'process.env.' : '$'}DSH_LAYERFS_${name} -> LAYERFS_${name}`)
    return `${lead}LAYERFS_${name}`
  })
  if (out === FIXTURE_FROM) {
    bump(`fixture ${FIXTURE_FROM} -> ${FIXTURE_TO}`)
    out = FIXTURE_TO
  }
  const left = out.match(/\bDSH_[A-Z_]+/)
  if (left) throw new Error(`${left[0]} has no LayerFS mapping: add it to tools/port-scenarios.mjs and scenarios/README.md`)
  return out
}

/** Every string in a parsed JSON value, rewritten. */
function walk(value, counts) {
  if (typeof value === 'string') return rewrite(value, counts)
  if (Array.isArray(value)) return value.map((v) => walk(v, counts))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walk(v, counts)]))
  return value
}

/** A scenario.json's text, ported: parsed, rewritten, written back in its own layout (indent 1). */
export function portScenario(text, counts = {}) {
  const value = JSON.parse(text)
  if (`${JSON.stringify(value, null, 1)}\n` !== text) throw new Error('not in the one-space JSON layout a round trip keeps')
  return `${JSON.stringify(walk(value, counts), null, 1)}\n`
}

/** A CONVERSION.md's text, ported. */
export function portProse(text, counts = {}) {
  let out = text
  for (const [from, to] of PROSE) {
    const n = out.split(from).length - 1
    if (n) counts[`prose: ${from.split('\n')[0]}`] = (counts[`prose: ${from.split('\n')[0]}`] ?? 0) + n
    out = out.replaceAll(from, to)
  }
  return out
}

/** What the port writes: { path (relative to Connect), bytes, mode, counts }[]. */
export function plan(from) {
  const listed = execFileSync('git', ['-C', from, 'ls-files', '-z', '--', 'scenarios', 'demo-workspace'], { encoding: 'utf8' })
  const out = []
  for (const path of listed.split('\0').filter(Boolean).sort()) {
    const src = join(from, path)
    if (!existsSync(src)) continue // deleted in the working tree
    if (REPLAYS.some((id) => path.startsWith(`scenarios/${id}/`))) continue // convert.mjs writes these
    const mode = statSync(src).mode & 0o777
    const to = path.startsWith('demo-workspace/') ? `fixtures/${path}` : path
    let bytes = readFileSync(src)
    const counts = {}
    if (/^scenarios\/[^/]+\/scenario\.json$/.test(path)) bytes = Buffer.from(portScenario(bytes.toString('utf8'), counts))
    else if (/(^|\/)CONVERSION\.md$/.test(path)) bytes = Buffer.from(portProse(bytes.toString('utf8'), counts))
    else if (/\bDSH_[A-Z_]+/.test(bytes.toString('latin1'))) throw new Error(`${path} names a DSH_ setting and has no rewrite rule`)
    out.push({ path: to, bytes, mode, counts })
  }
  return out
}

function main() {
  const argv = process.argv.slice(2)
  const at = argv.indexOf('--from')
  const from = resolve(at >= 0 ? argv[at + 1] : join(APP, '..', 'dsh-layerfs'))
  const check = argv.includes('--check')
  const files = plan(from)
  const ids = [...new Set(files.map((f) => f.path.match(/^scenarios\/([^/]+)\//)?.[1]).filter(Boolean))]
  if (check) {
    const stale = files.filter((f) => !existsSync(join(APP, f.path)) || !readFileSync(join(APP, f.path)).equals(f.bytes))
    for (const f of stale) console.log(`differs: ${f.path}`)
    console.log(stale.length ? `${stale.length} file(s) differ from a port of ${from}` : `up to date with ${from}`)
    process.exit(stale.length ? 1 : 0)
  }
  // replace what a port owns, whole
  for (const id of ids) rmSync(join(APP, 'scenarios', id), { recursive: true, force: true })
  rmSync(join(APP, 'fixtures', 'demo-workspace'), { recursive: true, force: true })
  for (const f of files) {
    const to = join(APP, f.path)
    mkdirSync(dirname(to), { recursive: true })
    writeFileSync(to, f.bytes)
    chmodSync(to, f.mode)
  }
  // the diff summary: rules applied, per file
  const total = {}
  console.log(`ported ${files.length} files from ${relative(APP, from) || from}: ${ids.length} scenarios and fixtures/demo-workspace`)
  for (const f of files) {
    const rules = Object.entries(f.counts)
    if (!rules.length) continue
    console.log(`  ${f.path}`)
    for (const [rule, n] of rules) {
      console.log(`    ${String(n).padStart(4)}  ${rule}`)
      total[rule] = (total[rule] ?? 0) + n
    }
  }
  console.log('  total')
  for (const [rule, n] of Object.entries(total).sort()) console.log(`    ${String(n).padStart(4)}  ${rule}`)
  const same = files.filter((f) => !Object.keys(f.counts).length).length
  console.log(`  ${same} file(s) copied byte for byte`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
