// The `layerfs` command of a scoped run: `node cli-shim.mjs <native> <args…>`.
// Without LAYERFS_CONNECT_SCOPE it runs the native binary as given. With it,
// it reads the call's positionals by the call table, puts them through the
// run's scope (scope.js: folder, Branch namespace and trunk, Sandbox names
// and machine), rewrites a `file apply --from` file's paths, and runs the
// native binary with the rewritten arguments, passing on its output and exit
// code. Answers keep the real names (the scope takes them back as they are).
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { table } from 'layerfs'
import { Scope, SCOPE_ENV } from './scope.js'

const [native, ...argv] = process.argv.slice(2)
const spec = table.find((c) => c.family === argv[0] && c.call === argv[1]?.replaceAll('-', '_'))
if (!process.env[SCOPE_ENV] || !spec) process.exit(spawnSync(native, argv, { stdio: 'inherit' }).status ?? 1)

// The calls whose answer the scope keeps (a merge's fast-forward) have their
// output read, then passed on; the rest stream it.
const READS = new Set(['branch.merge'])
/**
 * Runs the native binary to its end and answers its last JSON line (the
 * scope then records what the call did: the trunk a publish moved, a
 * fast-forward, a closed Sandbox), or throws its exit status, so a refused
 * call changes nothing in the scope.
 */
function exec(args, read) {
  const done = spawnSync(native, args, { stdio: ['inherit', read ? 'pipe' : 'inherit', 'inherit'], maxBuffer: 1 << 30 })
  if (read && done.stdout) process.stdout.write(done.stdout)
  if (done.status !== 0) throw Object.assign(new Error(`layerfs exited ${done.status}`), { status: done.status ?? 1 })
  const lines = read ? String(done.stdout).trim().split('\n') : []
  try {
    return JSON.parse(lines.at(-1) ?? '{}')
  } catch {
    return {}
  }
}

const scope = Scope.open(process.env[SCOPE_ENV])
const kinds = Object.fromEntries(spec.options.map((o) => [o.name.replaceAll('_', '-'), o.kind]))
const takesValue = (flag) => flag === '-m' || flag === '--from' || (kinds[flag.slice(2)] !== undefined && kinds[flag.slice(2)] !== 'bool')
// the positionals, and where each sits in argv
const at = []
for (let i = 2; i < argv.length; i++) {
  const word = argv[i]
  if (word === '--') {
    for (let j = i + 1; j < argv.length; j++) at.push(j)
    break
  }
  if (word.startsWith('-') && word.length > 1 && !/^-\d/.test(word)) {
    if (!word.includes('=') && takesValue(word)) i++
    continue
  }
  at.push(i)
}
const named = Object.fromEntries(spec.args.map((a, k) => [a.name, argv[at[k]]]).filter(([, v]) => v !== undefined))
const op = `${spec.family}.${spec.call}`
const out = [...argv]
const call = scope.call(op, named, async (sent, args) => {
  const target = table.find((c) => `${c.family}.${c.call}` === sent)
  const words = target.args.map((a) => args[a.name]).filter((v) => v !== undefined)
  // a publish becomes the fork of the next trunk: its own command line
  if (sent !== op) return exec([target.family, target.call, ...words, ...argv.slice(2).filter((_, i) => !at.includes(i + 2))], READS.has(sent))
  words.forEach((w, k) => (out[at[k]] = w))
  for (let k = words.length; k < at.length; k++) out[at[k]] = undefined
  if (op === 'file.apply') {
    const from = out.indexOf('--from')
    if (from >= 0) {
      const changes = scope.changes(JSON.parse(readFileSync(out[from + 1], 'utf8')))
      const file = join(mkdtempSync(join(tmpdir(), 'lfc-apply-')), 'changes.json')
      writeFileSync(file, JSON.stringify(changes))
      out[from + 1] = file
    }
  }
  return exec(out.filter((w) => w !== undefined), READS.has(op))
})
process.exit(await call.then(() => 0, (error) => error.status ?? (console.error(`layerfs: ${error.message}`), 1)))
