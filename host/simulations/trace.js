import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { traced } from '../runs/trace-line.js'
import { toolEntry } from '../sessions/recorder.js'

// the call table discovers the pinned CLI when first imported
let calls
const callTable = async () => (calls ??= import('../cli/table.js').then((m) => m.table))

// These are diagnostic names for the compiled recipe's positional arguments.
// Execution and validation continue to use the exact compiled argv.
const positions = {
  'branch.fork': ['project', 'name', 'from', 'commit'],
  'branch.merge': ['project', 'name', 'branch', 'with'],
  'branch.publish': ['project', 'branch', 'commit'],
  'file.write': ['project', 'branch', 'path'],
  'sandbox.create': ['project', 'name', 'machine'],
  'workspace.mount': ['sandbox', 'branch'],
  'workspace.exec': ['ws'],
  'workspace.commit': ['ws'],
  'workspace.unmount': ['ws'],
}

/** The call's arguments named as the CLI table (and the SDK) name them, as cli-shim.mjs reads a command line. */
export function cliArguments(table, argv, input) {
  const spec = table?.find((c) => c.family === argv[0] && c.call === argv[1]?.replaceAll('-', '_'))
  if (!spec) return null
  const kinds = Object.fromEntries(spec.options.map((o) => [o.name, o.kind]))
  const positional = [], named = {}
  for (let i = 2; i < argv.length; i++) {
    const word = String(argv[i])
    if (word === '--') { positional.push(...argv.slice(i + 1)); break }
    if (!word.startsWith('--')) { positional.push(word); continue }
    const [flag, inline] = word.slice(2).split(/=(.*)/s)
    const name = flag === 'from' ? 'from_file' : flag.replaceAll('-', '_')
    named[name] = inline !== undefined ? inline : kinds[name] !== undefined && kinds[name] !== 'bool' ? argv[++i] : true
  }
  spec.args.forEach((a, k) => { if (positional[k] !== undefined) named[a.name] = positional[k] })
  const body = spec.args.find((a) => ['content', 'json'].includes(a.kind))
  if (body && input !== undefined && named[body.name] === undefined) named[body.name] = input
  return named
}

/**
 * Join actual CLI execution to its parent or child Bash step in the normal UI,
 * and record it as one `cli` operation of that bash tool in the conversation's
 * journal when the host gives a recorder (sessions/recorder.js). `mount`
 * answers the confirmed Workspace facts of a workspace call.
 */
export function traceSimulationStep({ state, chatId, agentId, sessionId, sessionManager, toolCallId, argv, input, recorder, mount, execution }, execute) {
  const agent = agentId ? `child-${sessionId}` : 'root'
  const directory = join(state, 'chats', chatId, 'traces')
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const method = `${argv[0]}.${argv[1].replaceAll('-', '_')}`
  const args = Object.fromEntries((positions[method] ?? []).flatMap((name, index) => argv[index + 2] === undefined ? [] : [[name, argv[index + 2]]]))
  const message = argv.indexOf('--message')
  if (message >= 0) args.message = argv[message + 1]
  const rec = recorder?.({ agent_id: agent, native_session_id: sessionId, entry_id: toolEntry(sessionManager, toolCallId), tool_call_id: toolCallId })
  const run = rec
    ? async () => rec.record(method, cliArguments(await callTable().catch(() => null), argv, input) ?? args, () => execute(), { cause: 'tool', ...(argv[0] === 'workspace' && mount ? { mount } : {}), execution: { ...execution, argv } })
    : execute
  return traced(method, args, run, {
    LAYERFS_TRACE: join(directory, `${agent}.jsonl`),
    LAYERFS_TRACE_STEP: `${agent}:${toolCallId}`,
    LAYERFS_TRACE_START: '1',
  })
}
