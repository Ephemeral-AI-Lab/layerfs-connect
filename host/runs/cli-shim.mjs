// The `layerfs` command of a scoped run: `node cli-shim.mjs <native> <args…>`.
// Without LAYERFS_CONNECT_SCOPE it runs the native binary as given. With it,
// it reads the call's positionals by the call table, puts them through the
// run's scope (scope.js: folder, Branch namespace and trunk, Sandbox names
// and machine), rewrites a `file apply --from` file's paths, and runs the
// native binary with the rewritten arguments, passing on its output and exit
// code. Answers keep the real names (the scope takes them back as they are).
// Either way each call of the table writes its trace lines (trace-line.js).
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { table } from '../cli/table.js'
import { execute } from '../cli/spawn.js'
import { bytes, stringify } from '../cli/json.js'
import { registerExec } from '../agents/exec-cancel.js'
import { randomUUID } from 'node:crypto'
import { Scope, SCOPE_ENV } from './scope.js'
import { traced } from './trace-line.js'
import { activityRecorder } from '../activity/recorder.js'

// process.exit does not drain asynchronous writes; flush the private writer first.
const activity = activityRecorder(process.env.LAYERFS_CONNECT_ACTIVITY_STATE)
async function exitWithActivity(code) { await activity?.flush(); process.exit(code) }

const [native, ...argv] = process.argv.slice(2)
const spec = table.find((c) => c.family === argv[0] && c.call === argv[1]?.replaceAll('-', '_'))
if (!spec) {
  const discovery = ['help', '--version', '--help', '-h'].includes(argv[0]) || argv.includes('--help') || argv.includes('-h')
  const done = await execute({ cli: native, home: process.env.LAYERFS_HOME }, argv, { passthrough: true, discovery })
  await exitWithActivity(done.exit_code ?? 1)
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
async function exec(args, op) {
  const mounted = op === 'workspace.exec'
  const stream = mounted && args.includes('--stream')
  const requestedEvents = mounted && args.includes('--events')
  const words = [...args]
  let unregister = () => {}
  if (mounted) {
    // Fresh identity overrides caller/tool IDs so a recent cancellation mark
    // can never cancel a subsequent launch that reused an ID.
    for (let i = words.length - 1; i >= 2; i--) {
      if (words[i].startsWith('--exec-id=')) words.splice(i, 1)
      else if (words[i] === '--exec-id') words.splice(i, 2)
    }
    const exec_id = `connect-${randomUUID()}`
    words.push('--exec-id', exec_id)
    for (const flag of ['--stream', '--events']) {
      const at = words.indexOf(flag)
      if (at >= 0) words.splice(at, 1)
    }
    words.push('--events')
    unregister = registerExec(process.env.LAYERFS_CONNECT_EXECS, { ws: words[2], exec_id, home: process.env.LAYERFS_HOME, cli: native, pid: process.pid })
  }
  let certain = false, spawned = false
  try {
    const result = await execute({ cli: native, home: process.env.LAYERFS_HOME }, words, { events: mounted, onSpawn: child => { spawned = !!child.pid }, beforeSpawn: () => { if (mounted && process.env.LAYERFS_CONNECT_EXECS && existsSync(join(process.env.LAYERFS_CONNECT_EXECS, 'stopping'))) throw new Error('Queued command was stopped before launch.') }, input: process.stdin.isTTY ? undefined : await readInput(op), onFrame: (frame) => {
      if (requestedEvents) process.stdout.write(`${stringify(frame)}\n`)
      else if (stream && frame.stream) (frame.stream === 'stderr' ? process.stderr : process.stdout).write(bytes(frame.bytes))
    } })
    certain = true
    if (!requestedEvents && !stream) process.stdout.write(`${stringify(result)}\n`)
    if (stream) exitCode = result.exit_code ?? 1
    return result
  } catch (error) {
    if (error.transport === 'refusal' || error.transport === 'usage-incompatible') certain = true
    throw error
  } finally { if (certain || !spawned) unregister() }
}
async function readInput(op) {
  if (!table.find(c => `${c.family}.${c.call}` === op)?.args.some(a => ['content', 'json'].includes(a.kind))) return undefined
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  return Buffer.concat(chunks)
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
// the command's option flags, as a conversation's operation records them
const settings = {}
for (let i = 2; i < argv.length && argv[i] !== '--'; i++) {
  const word = argv[i]
  if (!word.startsWith('--') || at.includes(i)) continue
  const [flag, inline] = word.slice(2).split(/=(.*)/s)
  const name = flag === 'from' ? 'from_file' : flag.replaceAll('-', '_')
  settings[name] = inline !== undefined ? inline : takesValue(`--${flag}`) ? argv[++i] : true
}
const op = `${spec.family}.${spec.call}`
const finish = (call) => call.then(() => exitCode, (error) => { console.error(stringify({ code: error.code ?? 'Unknown', message: error.message, detail: error.detail ?? null })); return error.transport === 'usage-incompatible' ? 2 : 125 })
if (!process.env[SCOPE_ENV]) await exitWithActivity(await finish(traced(op, { ...settings, ...named }, async () => exec(argv, op), process.env, 'cli')))

const scope = Scope.open(process.env[SCOPE_ENV])
const out = [...argv]
const call = scope.call(op, named, (sent, args) => traced(sent, { ...settings, ...args }, async () => {
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
}, process.env, 'cli'))
await exitWithActivity(await finish(call))
