// The `layerfs` command of a scoped run: `node cli-shim.mjs <native> <args…>`.
// Without LAYERFS_CONNECT_SCOPE it runs the native binary as given. With it,
// it reads the call's positionals by the call table, puts them through the
// run's scope (scope.js: folder, Branch namespace and trunk, Sandbox names
// and machine), rewrites a `file apply --from` file's paths, and runs the
// native binary with the rewritten arguments, passing on its output and exit
// code. Answers keep the real names (the scope takes them back as they are).
// Either way each call of the table writes its trace lines (trace-line.js).
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, writeSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { table } from 'layerfs'
import { Scope, SCOPE_ENV } from './scope.js'
import { traced } from './trace-line.js'

const [native, ...argv] = process.argv.slice(2)
const spec = table.find((c) => c.family === argv[0] && c.call === argv[1]?.replaceAll('-', '_'))
if (!spec) process.exit(spawnSync(native, argv, { stdio: 'inherit' }).status ?? 1)

const lastJson = (buffer) => {
  try {
    return JSON.parse(String(buffer ?? '').trim().split('\n').at(-1) || '{}')
  } catch {
    return {}
  }
}
/** The exit code this command ends with: a streamed exec's is its command's. */
let exitCode = 0
/**
 * Runs the native binary to its end and answers its last JSON line (the
 * scope then records what the call did: the trunk a publish moved, a
 * fast-forward, a closed Sandbox; the trace its result), or throws its
 * refusal and exit status, so a refused call changes nothing in the scope.
 * A streamed `workspace exec` passes its output on as it comes and answers
 * its command's exit code.
 */
function exec(args, op) {
  const stream = op === 'workspace.exec' && args.includes('--stream')
  const io = stream ? 'inherit' : 'pipe'
  const done = spawnSync(native, args, { stdio: ['inherit', io, io], maxBuffer: 1 << 30 })
  for (const [fd, buffer] of [[1, done.stdout], [2, done.stderr]]) for (let k = 0; buffer && k < buffer.length; ) k += writeSync(fd, buffer, k)
  const status = done.status ?? 1
  // 2: a wrong command line, 125: LayerFS refused the call (main.rs)
  if (stream && done.status !== null && status !== 2 && status !== 125) {
    exitCode = status
    return { exit_code: status }
  }
  if (status !== 0) {
    const refusal = lastJson(done.stderr)
    throw Object.assign(new Error(refusal.message ?? `layerfs exited ${status}`), { status, code: refusal.code ?? null })
  }
  return lastJson(done.stdout)
}

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
const finish = (call) => call.then(() => exitCode, (error) => error.status ?? (console.error(`layerfs: ${error.message}`), 1))
if (!process.env[SCOPE_ENV]) process.exit(await finish(traced(op, named, async () => exec(argv, op))))

const scope = Scope.open(process.env[SCOPE_ENV])
const out = [...argv]
const call = scope.call(op, named, (sent, args) => traced(sent, args, async () => {
  const target = table.find((c) => `${c.family}.${c.call}` === sent)
  const words = target.args.map((a) => args[a.name]).filter((v) => v !== undefined)
  // a publish becomes the fork of the next trunk: its own command line
  if (sent !== op) return exec([target.family, target.call, ...words, ...argv.slice(2).filter((_, i) => !at.includes(i + 2))], sent)
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
  return exec(out.filter((w) => w !== undefined), op)
}))
process.exit(await finish(call))
