// The call lines Live and the Trace tab read (traces.js, live.js), written by
// Connect's own `layerfs` command (cli-shim.mjs) and package
// (scope-client.js): LayerFS 2.0's LAYERFS_TRACE records only connections to
// a machine's worker, not calls. Each call appends a start line (when
// LAYERFS_TRACE_START is set) and an end line to LAYERFS_TRACE, labelled
// LAYERFS_TRACE_STEP, with the real (scoped) arguments: Branch and Sandbox
// names as LayerFS knows them.
import { randomBytes } from 'node:crypto'
import { appendFileSync } from 'node:fs'

const PREFIX = randomBytes(4).toString('hex')
let n = 0
const CLIP = 240
/** Arguments that are bodies, not names: kept out of the line. */
const BODIES = new Set(['content', 'old', 'new', 'changes', 'stdout', 'stderr'])

const clip = (v) => (typeof v === 'string' && v.length > CLIP ? `${v.slice(0, CLIP - 1)}…` : v)
const text = (v) => (typeof v === 'string' && v ? v : null)

function shown(args) {
  const out = {}
  for (const [k, v] of Object.entries(args ?? {})) {
    if (v === undefined || typeof v === 'function') continue
    if (BODIES.has(k)) {
      if (Array.isArray(v)) out[`${k}_count`] = v.length
      continue
    }
    out[k] = clip(v)
  }
  return out
}

/** Where a Sandbox or Workspace call acts: its Sandbox, the Workspace's path (`ws` is `<sandbox>:<path or name>`), its Branch. */
function place(op, args, value) {
  const family = op.split('.')[0]
  const out = {}
  const branch = text(args?.branch) ?? text(value?.branch)
  if (branch) out.branch = branch
  if (family !== 'sandbox' && family !== 'workspace') return out
  const ws = text(args?.ws) ?? text(value?.ws)
  const at = ws ? ws.indexOf(':') : -1
  const sandbox = op === 'workspace.mount' ? text(args?.sandbox) : at > 0 ? ws.slice(0, at) : text(value?.name) ?? text(args?.name)
  if (sandbox) out.sandbox = sandbox
  const path = text(value?.path) ?? (at > 0 ? ws.slice(at + 1) : null)
  if (family === 'workspace' && path) out.path = path
  if (ws) out.ws = ws
  return out
}

function outcome(value) {
  const out = {}
  if (Number.isInteger(value?.exit_code)) out.kind = `exit:${value.exit_code}`
  else if (text(value?.kind)) out.kind = value.kind
  const commit = text(value?.commit) ?? text(value?.head)
  if (commit) out.commit = commit
  if (text(value?.layer)) out.layer = value.layer
  return out
}

/** Runs one LayerFS call (`run` answers its value or throws its refusal), with its trace lines when LAYERFS_TRACE is set. */
export async function traced(op, args, run, env = process.env) {
  const file = env.LAYERFS_TRACE
  if (!file) return run()
  const write = (line) => {
    try {
      appendFileSync(file, `${JSON.stringify(line)}\n`)
    } catch {
      // a trace is diagnostic: the call goes on without it
    }
  }
  const base = {
    layerfs_trace: 1,
    id: `${PREFIX}-${++n}`,
    step: env.LAYERFS_TRACE_STEP ?? '',
    method: op,
    ...(text(args?.project) ? { project: args.project } : {}),
    args: shown(args),
    start: new Date().toISOString(),
  }
  if (env.LAYERFS_TRACE_START) write({ ...base, phase: 'start', ...place(op, args, null) })
  const t0 = performance.now()
  const ms = () => Math.round((performance.now() - t0) * 1000) / 1000
  try {
    const value = await run()
    write({ ...base, phase: 'end', ms: ms(), ok: true, ...place(op, args, value), ...outcome(value) })
    return value
  } catch (error) {
    write({ ...base, phase: 'end', ms: ms(), ok: false, code: error?.code ?? null, message: clip(error?.message ?? null), ...place(op, args, null) })
    throw error
  }
}
