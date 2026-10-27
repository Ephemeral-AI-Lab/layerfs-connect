// The Trace tab's rows for one agent of a session: everything the agent was
// given and did, in order, the way dsh's Trajectory lists a conversation.
//
// Both kinds of session record their tool side the same way (run.json):
// steps with their command, output, exit and checks, each step's LayerFS
// calls from the SDK trace, and the messages agents send each other. What
// differs is the model side:
//   live    pi's session log (<runDir>/pi/<agent>/*.jsonl) holds the system
//           prompt, each model request's text, thinking, tokens and time, and
//           model or thinking changes. Rows follow that log; each tool call in
//           it takes the agent's next step for its output and LayerFS calls.
//   replay  no model: the scenario is the script. Each scripted step is a
//           request (its `say`, or tool call only) followed by its call; a
//           reply step ends a turn. Rows follow the steps and messages in time.
// A live session whose pi log is missing is read the replay way.
//
// Row kinds (TraceRecord in src/shared/host-api.ts):
//   system    the system prompt (live), or the script that stands in for one
//   user      the user's message (live), or the scenario's prompt (replay)
//   context   what the agent was given that no user typed: a parent's task, a
//             child's reply, a model or thinking change, the run's end
//   assistant one model request, or one scripted step
//   tool      one tool call (bash, send_message, job_* …), with its output
//   subagent  a subagent started, with its task
//   layerfs   one LayerFS call inside a tool call (`parent` is the tool row)
//   check     a final check of the run (root only)
// A tool row lists the writes its LayerFS calls made (`writes`): every call
// that changes the project's store (traces.js WRITES), refused ones too.
// Kinds: 'file', a Branch file op (fs.write, fs.apply, fs.edit, fs.mkdir,
// fs.rm, fs.mv, fs.cp) committing straight to its Branch; 'workspace',
// workspace.commit saving a Workspace's changes to the Branch it was mounted
// on (the latest workspace.mount of that Sandbox and path before it); 'fork',
// 'merge', 'publish' and 'init'. A scenario run plays on its own trunk
// (scope.js): its script's publish forks the next trunk <folder>.main.<k>
// from the Branch it publishes, so that fork reads as a publish to `trunk`.
// Runs recorded before calls kept these details read them back from the
// trace files (writeNotes).
// Every successful write is an auto-checkpoint, numbered across the whole
// session (all its agents) in the order the writes ended (`checkpoint`). A
// tool call lists its checkpoints' numbers (`checkpoints`); they need not be
// consecutive, since other agents checkpoint in between. Refused writes
// change nothing: listed, not numbered. The page says how many the session
// has (`checkpoints`).
// A turn opens with a user message (or a parent's task); `step` numbers the
// requests. Text fields are cut to PREVIEW characters; the run's detail holds
// the rest.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { WRITES, writeNote } from './traces.js'

const PREVIEW = 4000
const PAGE = 400

const cut = (text) => {
  if (typeof text !== 'string') return text ?? null
  return text.length > PREVIEW ? `${text.slice(0, PREVIEW)}…` : text
}
const firstLine = (text) => String(text ?? '').split('\n').find((l) => l.trim() && !l.trim().startsWith('#'))?.trim() ?? ''
const textOf = (content) => (typeof content === 'string' ? content : Array.isArray(content) ? content.filter((c) => c.type === 'text').map((c) => c.text).join('\n') : '')

/** call id -> writeNote of every write in a run's trace files, for calls recorded without one. */
const notesCache = new Map()
export function writeNotes(runDir) {
  const dir = join(runDir, 'traces')
  const out = new Map()
  if (!existsSync(dir)) return out
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.jsonl'))) {
    const path = join(dir, file)
    let size = 0
    try {
      size = statSync(path).size
    } catch {
      continue
    }
    let notes = notesCache.get(path)
    if (!notes || notes.size !== size) {
      const ids = new Map()
      for (const line of readFileSync(path, 'utf8').split('\n')) {
        const method = /"method":"([a-z_.]+)"/.exec(line)?.[1]
        if (!method || !WRITES[method] || line.includes('"phase":"start"')) continue
        try {
          const l = JSON.parse(line)
          ids.set(String(l.id), writeNote(l))
        } catch {
          // a line being written
        }
      }
      notes = { size, ids }
      notesCache.set(path, notes)
    }
    for (const [id, note] of notes.ids) out.set(id, note)
  }
  return out
}

/** call id -> the write it made (see the top of this file), over every agent of the run. */
function writeLedger(run, notes) {
  const calls = run.steps.flatMap((s) => s.calls).sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
  const mounted = new Map()
  const out = new Map()
  for (const c of calls) {
    if (c.method === 'workspace.mount' && c.ok && c.sandbox && c.path && c.branch) mounted.set(`${c.sandbox}:${c.path}`, c.branch)
    let kind = WRITES[c.method]
    if (!kind) continue
    const at = Date.parse(c.start) || null
    const where = `${c.sandbox}:${c.path}`
    // a mount the trace does not show (another session's, or before the run): the run's own record of it
    const fallback = () =>
      run.live?.mounts
        ?.filter((m) => m.sandbox === c.sandbox && m.path === c.path && (at === null || m.since <= at))
        .sort((a, b) => b.since - a.since)[0]?.branch ?? null
    const note = { ...(notes.get(c.id) ?? {}), ...Object.fromEntries(Object.entries(c).filter(([, v]) => v != null)) }
    const trunk = kind === 'fork' && run.folder && new RegExp(`^${run.folder.replace(/[.]/g, '\\.')}\\.main\\.\\d+$`).test(c.branch ?? '') ? c.branch : null
    if (trunk) kind = 'publish'
    out.set(c.id, {
      kind,
      method: c.method,
      status: c.ok === null ? 'running' : c.ok ? 'ok' : 'failed',
      outcome: c.ok === false ? (c.code ?? 'failed') : (c.kind ?? null),
      commit: typeof c.commit === 'string' ? c.commit : null,
      branch: kind === 'workspace' ? (mounted.get(where) ?? fallback()) : kind === 'merge' ? (note.name ?? c.branch ?? null) : trunk ? (note.from ?? null) : (c.branch ?? null),
      trunk,
      path: kind === 'file' ? (c.path ?? null) : null,
      workspace: kind === 'workspace' ? where : null,
      from: note.from ?? null,
      onto: note.onto ?? null,
      with: note.with ?? null,
      layer: note.layer ?? null,
      message: note.message ?? null,
      sizes: note.sizes ?? null,
      start: at,
      ms: c.ms ?? null,
      checkpoint: null,
    })
  }
  // the session's auto-checkpoints: its successful writes, in the order they ended
  const done = [...out.values()].filter((w) => w.status === 'ok').sort((a, b) => (a.start ?? 0) + (a.ms ?? 0) - ((b.start ?? 0) + (b.ms ?? 0)))
  done.forEach((w, i) => (w.checkpoint = i + 1))
  out.checkpoints = done.length
  return out
}

/** pi's log of one agent: every entry of its session files, oldest file first; null when it has none. */
export function piLog(runDir, agent) {
  const dir = join(runDir, 'pi', agent)
  if (!existsSync(dir)) return null
  const entries = []
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.jsonl')).sort()) {
    for (const line of readFileSync(join(dir, file), 'utf8').split('\n')) {
      if (!line.trim()) continue
      try {
        entries.push(JSON.parse(line))
      } catch {
        // a line being written: the next read has it
      }
    }
  }
  return entries.length ? entries : null
}

/**
 * One agent's rows, the newest page first in the sense dsh pages: the last
 * `limit` rows before index `before` (default: the end).
 * @param {object} o
 * @param {object} o.run       the run's detail (RunDetail)
 * @param {string} o.agent
 * @param {(index: number) => object | undefined} [o.scriptView]  a replay step's script view
 * @param {string | null} [o.prompt]  a replay root's prompt
 * @param {string | null} [o.title]   the scenario's title
 * @param {object[] | null} [o.pi]    pi's log of the agent (piLog)
 */
export function trajectory({ run, agent, scriptView = () => undefined, prompt = null, title = null, pi = null, notes = new Map(), before = null, limit = PAGE }) {
  const ledger = writeLedger(run, notes)
  const records = pi ? fromPi({ run, agent, pi, ledger }) : fromScript({ run, agent, scriptView, prompt, title, ledger })
  if (agent === (run.agents.find((a) => a.parent === null)?.name ?? 'root')) ending(run, records)
  for (const r of records) if (r.writes?.length) r.checkpoints = r.writes.map((w) => w.checkpoint).filter((n) => n !== null)
  const end = before === null ? records.length : Math.max(0, Math.min(Number(before), records.length))
  const from = Math.max(0, end - Math.max(1, Number(limit) || PAGE))
  return { agent, kind: pi ? 'live' : 'replay', total: records.length, from, records: records.slice(from, end), checkpoints: ledger.checkpoints }
}

/** What reached `agent`, oldest first, each with who it is from as a row sees it. */
function incoming(run, agent) {
  const parent = run.agents.find((a) => a.name === agent)?.parent ?? null
  return run.messages
    .filter((m) => m.to === agent && m.from !== agent)
    .sort((a, b) => a.at - b.at)
    .map((m) => ({ ...m, source: m.from === 'user' ? 'user' : m.from === parent ? 'parent' : 'child' }))
}

/** A message as a row; a user's message or a parent's task opens a turn. */
function messageRow(m, turn, id) {
  const opens = m.source === 'user' || m.source === 'parent'
  return {
    id,
    kind: m.source === 'user' ? 'user' : 'context',
    source: m.source,
    from: m.from,
    turn,
    step: null,
    title: m.source === 'user' ? firstLine(m.text) : m.source === 'parent' ? `Task from ${m.from}` : `Reply from ${m.from}`,
    text: cut(m.text),
    status: 'ok',
    start: m.at,
    ms: null,
    opens,
  }
}

const stepStatus = (s) => (s.state === 'ok' ? 'ok' : s.state)

/** A step's call as rows: the call, then its LayerFS calls. */
function callRows(agent, s, view, turn, step, ledger) {
  const v = view ?? {}
  const tool = v.tool ?? 'bash'
  const id = `t:${agent}:${s.index}`
  const ms = s.ended ? s.ended - s.started : null
  if (tool === 'subagent') {
    return [{ id, kind: 'subagent', turn, step, title: v.description ?? 'subagent', child: v.description ?? null, text: cut(v.text), output: cut(s.output), status: stepStatus(s), start: s.started, ms }]
  }
  const rows = [
    {
      id,
      kind: 'tool',
      tool,
      turn,
      step,
      title: v.description || firstLine(v.text) || tool,
      text: cut(v.text),
      output: cut(tool === 'bash' ? [s.stdout, s.stderr].filter(Boolean).join(s.stdout && s.stderr ? '\n' : '') : s.output),
      exitCode: s.exitCode ?? null,
      checks: (s.checks ?? []).map((c) => ({ name: c.name, ok: c.ok, detail: cut(c.detail) })),
      background: v.background === true,
      calls: s.calls.length,
      writes: s.calls.map((c) => ledger.get(c.id)).filter(Boolean),
      status: stepStatus(s),
      start: s.started,
      ms,
    },
  ]
  for (const c of s.calls) {
    rows.push({
      id: `c:${c.id}`,
      kind: 'layerfs',
      parent: id,
      turn,
      step,
      title: c.method,
      outcome: c.ok === null ? null : c.ok ? (c.kind ?? 'ok') : (c.code ?? 'failed'),
      args: Object.fromEntries(['branch', 'sandbox', 'path', 'commit'].filter((k) => c[k]).map((k) => [k, c[k]])),
      writeKind: ledger.get(c.id)?.kind ?? null,
      status: c.ok === null ? 'running' : c.ok ? 'ok' : 'failed',
      start: Date.parse(c.start) || null,
      ms: c.ms ?? null,
    })
  }
  return rows
}

/** A replay's rows (and a live session's without pi's log): the script's steps and the messages, in time. */
function fromScript({ run, agent, scriptView, prompt, title, ledger }) {
  const rows = []
  const isRoot = run.agents.find((a) => a.name === agent)?.parent == null
  const steps = run.steps.filter((s) => s.agent === agent).sort((a, b) => a.index - b.index)
  rows.push({
    id: `s:${agent}`,
    kind: 'system',
    turn: 0,
    step: null,
    title: run.kind === 'live' ? 'System prompt (not recorded)' : `Scripted agent · ${title ?? run.demo}`,
    text: run.kind === 'live' ? null : `No model: every step is the ${run.demo} scenario's script, played against the real LayerFS.`,
    scripted: run.kind !== 'live',
    status: 'ok',
    start: run.started,
    ms: null,
  })
  let turn = 0
  let step = 0
  const events = [
    ...(isRoot && prompt ? [{ at: run.started, prompt }] : []),
    ...incoming(run, agent).map((m) => ({ at: m.at, message: m })),
    ...steps.map((s) => ({ at: s.started, step: s })),
  ].sort((a, b) => a.at - b.at || (a.step ? 1 : 0) - (b.step ? 1 : 0))
  events.forEach((e, n) => {
    if (e.prompt) {
      turn++
      rows.push({ id: `u:${agent}:prompt`, kind: 'user', source: 'scenario', turn, step: null, title: firstLine(e.prompt), text: cut(e.prompt), status: 'ok', start: e.at, ms: null, opens: true })
      return
    }
    if (e.message) {
      const row = messageRow(e.message, turn, `m:${agent}:${n}`)
      if (row.opens) row.turn = ++turn
      rows.push(row)
      return
    }
    const s = e.step
    const v = s.view ?? scriptView(s.index)
    turn ||= 1
    step++
    if (v?.tool === 'reply') {
      rows.push({ id: `a:${agent}:${s.index}`, kind: 'assistant', turn, step, title: firstLine(v.text), text: cut(v.text), final: true, scripted: run.kind !== 'live', status: stepStatus(s), start: s.started, ms: null })
      return
    }
    rows.push({ id: `a:${agent}:${s.index}`, kind: 'assistant', turn, step, title: v?.say ? firstLine(v.say) : '', text: cut(v?.say ?? null), toolOnly: !v?.say, scripted: run.kind !== 'live', phase: v?.phase ?? null, status: 'ok', start: s.started, ms: null })
    rows.push(...callRows(agent, s, v, turn, step, ledger))
  })
  return rows
}

/** A live agent's rows: pi's log in order, each tool call taking the agent's next step. */
function fromPi({ run, agent, pi, ledger }) {
  const rows = []
  const calls = run.steps.filter((s) => s.agent === agent && s.view?.tool !== 'reply').sort((a, b) => a.index - b.index)
  const waiting = incoming(run, agent)
  const byCall = new Map()
  let turn = 0
  let step = 0
  let answered = false
  let model = null
  let thinking = null
  pi.forEach((e, n) => {
    const at = Date.parse(e.timestamp) || null
    if (e.type === 'model_change') {
      const next = `${e.provider}/${e.modelId}`
      if (answered && next !== model) rows.push({ id: `x:${agent}:${n}`, kind: 'context', source: 'model', turn, step: null, title: `Model: ${next}`, text: null, status: 'ok', start: at, ms: null })
      model = next
      return
    }
    if (e.type === 'thinking_level_change') {
      if (answered && e.thinkingLevel !== thinking) rows.push({ id: `x:${agent}:${n}`, kind: 'context', source: 'model', turn, step: null, title: `Thinking: ${e.thinkingLevel}`, text: null, status: 'ok', start: at, ms: null })
      thinking = e.thinkingLevel
      return
    }
    if (e.type !== 'message' || !e.message) return
    const m = e.message
    if (m.role === 'system') {
      const sections = m.sections && typeof m.sections === 'object' ? m.sections : null
      const text = textOf(m.content) || (sections ? Object.values(sections).join('\n\n') : '')
      rows.push({ id: `s:${agent}:${n}`, kind: 'system', turn, step: null, title: rows.some((r) => r.kind === 'system') ? 'System prompt changed' : 'System prompt', text: cut(text), sections: sections ? Object.keys(sections) : null, model, thinking, status: 'ok', start: at, ms: null })
      return
    }
    if (m.role === 'user') {
      // one prompt may carry several messages the agent's inbox held: a row each
      turn++
      const text = textOf(m.content)
      const taken = []
      while (waiting.length && waiting[0].at <= (at ?? Infinity) + 1000 && text.includes(waiting[0].text.trim().slice(0, 200))) taken.push(waiting.shift())
      if (!taken.length) rows.push({ id: `u:${agent}:${n}`, kind: 'user', source: 'user', turn, step: null, title: firstLine(text), text: cut(text), status: 'ok', start: at, ms: null, opens: true })
      taken.forEach((msg, k) => rows.push({ ...messageRow(msg, turn, `u:${agent}:${n}:${k}`), opens: k === 0 }))
      return
    }
    if (m.role === 'assistant') {
      answered = true
      turn ||= 1
      step++
      const blocks = Array.isArray(m.content) ? m.content : []
      const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n')
      const thought = blocks.filter((b) => b.type === 'thinking').map((b) => b.thinking).join('\n')
      const toolCalls = blocks.filter((b) => b.type === 'toolCall')
      const end = at ?? m.timestamp ?? null
      const ms = Number.isFinite(m.durationMs) ? m.durationMs : null
      const failed = m.stopReason === 'error' || m.stopReason === 'aborted'
      rows.push({
        id: `a:${agent}:${n}`,
        kind: 'assistant',
        turn,
        step,
        title: firstLine(text),
        text: cut(text || null),
        thinking: cut(thought || null),
        toolOnly: !text && toolCalls.length > 0,
        final: m.stopReason !== 'toolUse',
        model: m.provider && m.model ? `${m.provider}/${m.model}` : model,
        usage: m.usage ? { input: m.usage.input ?? 0, output: m.usage.output ?? 0, cacheRead: m.usage.cacheRead ?? 0, cacheWrite: m.usage.cacheWrite ?? 0, reasoning: m.usage.reasoning ?? 0, cost: m.usage.cost?.total ?? 0 } : null,
        stopReason: m.stopReason ?? null,
        error: m.errorMessage ?? null,
        status: failed ? (m.stopReason === 'aborted' ? 'stopped' : 'failed') : 'ok',
        start: end !== null && ms !== null ? end - ms : end,
        ms,
      })
      for (const call of toolCalls) {
        const s = calls.shift()
        if (s) {
          const made = callRows(agent, s, s.view, turn, step, ledger)
          byCall.set(call.id, made[0])
          rows.push(...made)
          continue
        }
        // a call pi made that no step recorded (the run stopped first): its arguments, and pi's result if it came
        const row = { id: `t:${agent}:pi:${n}:${call.id}`, kind: call.name === 'subagent' ? 'subagent' : 'tool', tool: call.name, turn, step, title: call.arguments?.description ?? call.name, text: cut(call.arguments?.command ?? call.arguments?.task ?? JSON.stringify(call.arguments ?? {})), output: null, calls: 0, status: 'stopped', start: end, ms: null }
        byCall.set(call.id, row)
        rows.push(row)
      }
      return
    }
    if (m.role === 'toolResult') {
      const row = byCall.get(m.toolCallId)
      if (row && row.output == null) row.output = cut(textOf(m.content))
    }
  })
  // steps pi's log does not show yet (it is written as each message ends)
  for (const s of calls) rows.push(...callRows(agent, s, s.view, turn || 1, step, ledger))
  return rows
}

/** The root's last rows: the run's final checks, and why it ended when it did not pass. */
function ending(run, rows) {
  const turn = rows.reduce((t, r) => Math.max(t, r.turn), 0)
  run.checks.forEach((c, i) => rows.push({ id: `k:${i}`, kind: 'check', turn, step: null, title: c.name, text: cut(c.detail), status: c.ok ? 'ok' : 'failed', start: run.ended, ms: null }))
  if (run.error && run.state !== 'passed') {
    rows.push({ id: 'end', kind: 'context', source: 'host', turn, step: null, title: run.state === 'idle' ? 'Turn ended early' : `Session ${run.state}`, text: cut(run.error), status: run.state === 'stopped' ? 'stopped' : 'failed', start: run.ended, ms: null })
  }
}
