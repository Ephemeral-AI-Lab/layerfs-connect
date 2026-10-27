// The call parser: what each block of an agent's call does to LayerFS.
//   segments(command) -> Segment[]       a bash command, every line classified
//   stepView(step, index, agent?) -> StepView   one scenario step (scenario.json's
//                                        form), with its segments
// A non-bash tool call is one `tool` segment: subagent tools are subagent,
// job tools job. A reply is one segment too: a child's reply goes to its
// parent (subagent), as does a reply that waits for children; root's last
// word is local. Types: src/shared/host-api.ts.
import { segments } from './segments.js'
import { linesOf } from './shell.js'

export { segments }

const SUBAGENT = new Set(['subagent', 'send_message', 'interrupt_agent', 'list_agents'])
const JOB = new Set(['job_output', 'job_kill', 'job_list'])
const LAYERFS = new Set(['workspace', 'fs', 'branch', 'sandbox', 'project', 'backend'])
const TOOLS = ['bash', ...SUBAGENT, ...JOB, 'working_directory']

/** The one segment of a text that is not a bash command. */
function whole(kind, call, text, detail) {
  const seg = { kind, form: 'tool', call, text, lines: [1, Math.max(1, linesOf(text).length)] }
  if (detail) seg.detail = detail
  return seg
}

const ref = (id) => String(id ?? '').replace(/^@/, '')

/**
 * A step as the views show it. `step` is a scenario.json step ({ bash: … },
 * { reply: … }, …); `agent` its agent's name (default root).
 */
export function stepView(step, index, agent = 'root') {
  const view = { index }
  for (const key of ['say', 'phase', 'note']) if (typeof step[key] === 'string') view[key] = step[key]
  if (Array.isArray(step.expect)) view.expect = step.expect
  if (Number.isInteger(step.exit)) view.exit = step.exit
  if ('reply' in step) {
    view.tool = 'reply'
    view.text = String(step.reply)
    const until = Array.isArray(step.until) && step.until.length ? step.until : null
    if (until) view.until = until
    const kind = until || agent !== 'root' ? 'subagent' : 'local'
    view.segments = [whole(kind, 'reply', view.text, until ? until.join(', ') : agent !== 'root' ? agent : undefined)]
    view.kind = kind
    return view
  }
  const tool = TOOLS.find((t) => t in step)
  const args = step[tool] ?? {}
  view.tool = tool ?? 'bash'
  if (typeof args.description === 'string') view.description = args.description
  if (tool === 'bash') {
    view.text = String(args.command ?? '')
    view.segments = segments(view.text)
    if (args.run_in_background === true) {
      view.background = true
      if (typeof step.as === 'string') view.job = step.as
    }
    view.kind = view.segments.find((s) => LAYERFS.has(s.kind))?.kind ?? (view.background ? 'job' : 'local')
    return view
  }
  if (tool === 'subagent') {
    view.text = String(args.prompt ?? '')
    view.segments = [whole('subagent', 'subagent', view.text, args.description)]
  } else if (SUBAGENT.has(tool)) {
    view.text = String(tool === 'send_message' ? args.message ?? '' : tool === 'list_agents' ? args.scope ?? '' : args.agent_id ?? '')
    view.segments = [whole('subagent', tool, view.text, args.agent_id ? ref(args.agent_id) : undefined)]
  } else if (JOB.has(tool)) {
    view.text = String(args.job_id ?? '')
    view.segments = [whole('job', tool, view.text, args.job_id ? ref(args.job_id) : undefined)]
  } else {
    view.text = String(args.cd ?? '')
    view.segments = [whole('local', tool ?? 'working_directory', view.text)]
  }
  view.kind = view.segments[0].kind
  return view
}
