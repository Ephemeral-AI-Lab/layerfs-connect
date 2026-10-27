// One agent's conversation, as a chat reads it: turns that open with the
// messages the agent received, then its words and folded tool calls, and
// close with its reply. Built from a run (steps with results, messages) or
// from a demo's script alone (no results, only the subagent's prompt).
import type { RunDetail, SegmentKind, StepResult, StepView } from '@shared/host-api'

export type Message = RunDetail['messages'][number]

/** One step: its script view and, in a run, its result. */
export interface Entry {
  key: string
  agent: string
  index: number
  view?: StepView
  result?: StepResult
}

export type Sender = 'parent' | 'child' | 'other'

export type Item =
  | { type: 'phase'; key: string; phase: string }
  | { type: 'received'; key: string; message: Message; sender: Sender }
  | { type: 'say'; key: string; text: string }
  | { type: 'calls'; key: string; entries: Entry[] }
  | { type: 'chip'; key: string; entry: Entry }
  | { type: 'reply'; key: string; entry: Entry; text: string }

export interface Turn {
  key: string
  items: Item[]
}

/** Tools shown as a chip in the thread rather than inside the folded calls. */
const CHIP_TOOLS = new Set(['subagent', 'send_message', 'interrupt_agent'])

/** The agent a subagent, send_message or reply step names. */
export const targetOf = (view?: StepView) => view?.segments.find((s) => s.detail)?.detail

export const replyText = (e: Entry) => e.view?.text || e.result?.output || e.view?.say || ''

/** Orders agents as a tree, root first, each followed by its children. */
export function treeOrder<T>(items: T[], name: (t: T) => string, parent: (t: T) => string | null): { item: T; depth: number }[] {
  const names = new Set(items.map(name))
  const children = new Map<string | null, T[]>()
  for (const t of items) {
    const p = parent(t)
    const key = p && names.has(p) && p !== name(t) ? p : null
    children.set(key, [...(children.get(key) ?? []), t])
  }
  const out: { item: T; depth: number }[] = []
  const seen = new Set<string>()
  const walk = (key: string | null, depth: number) => {
    for (const t of children.get(key) ?? []) {
      if (seen.has(name(t))) continue
      seen.add(name(t))
      out.push({ item: t, depth })
      walk(name(t), depth + 1)
    }
  }
  walk(null, 0)
  for (const t of items) if (!seen.has(name(t))) out.push({ item: t, depth: 0 })
  return out
}

interface ThreadInput {
  agent: string
  parent: string | null
  /** The agents this one started: their messages read as replies. */
  children: Set<string>
  entries: Entry[]
  /** Messages sent to this agent, in any order. */
  incoming: Message[]
}

/** Builds an agent's turns. Messages go before the step they precede in time; replies an agent waits for go right after its waiting reply. */
export function buildThread({ agent, parent, children, entries, incoming }: ThreadInput): Turn[] {
  const messages = incoming.filter((m) => m.from !== agent).sort((a, b) => a.at - b.at)
  const used = new Array<boolean>(messages.length).fill(false)
  const turns: Turn[] = []
  let turn: Turn | null = null
  let closed = true
  let lo = 0
  // A message sent the instant a step starts is what that step answers, once per turn.
  let heard = false

  const push = (item: Item) => {
    // A turn closes with a reply; what comes next opens the next one.
    if (!turn || (closed && item.type !== 'phase')) {
      turn = { key: item.key, items: [] }
      turns.push(turn)
      closed = false
    }
    turn.items.push(item)
  }
  const sender = (m: Message): Sender => (m.from === parent ? 'parent' : children.has(m.from) ? 'child' : 'other')
  const receive = (i: number) => {
    used[i] = true
    const m = messages[i]
    if (m.from === parent) heard = true
    push({ type: 'received', key: `m:${m.at}:${m.from}:${i}`, message: m, sender: sender(m) })
    while (lo < messages.length && used[lo]) lo++
  }

  entries.forEach((e, n) => {
    const started = e.result?.started
    if (started !== undefined)
      for (let i = lo; i < messages.length && messages[i].at <= started; i++)
        if (!used[i] && (messages[i].at < started || (messages[i].from === parent && !heard))) receive(i)
    if (!e.result && n === 0) for (let i = 0; i < messages.length; i++) if (!used[i]) receive(i)

    const v = e.view
    if (v?.phase) {
      const last = turn?.items[turn.items.length - 1]
      if (!(last?.type === 'phase' && last.phase === v.phase)) push({ type: 'phase', key: `p:${e.key}`, phase: v.phase })
    }
    const tool = v?.tool ?? (e.result?.output !== undefined && !e.result.calls.length ? 'reply' : 'bash')
    if (v?.say && tool !== 'reply') push({ type: 'say', key: `t:${e.key}`, text: v.say })

    if (tool === 'reply') {
      push({ type: 'reply', key: `r:${e.key}`, entry: e, text: replyText(e) })
      closed = true
      heard = false
      // The replies it waits for arrive before its next step.
      const next = entries[n + 1]?.result?.started ?? Infinity
      const waits = new Set(v?.until ?? [])
      if (waits.size && e.result)
        for (let i = lo; i < messages.length && messages[i].at <= next; i++)
          if (!used[i] && waits.has(messages[i].from)) {
            waits.delete(messages[i].from)
            receive(i)
          }
      return
    }
    if (CHIP_TOOLS.has(tool)) {
      push({ type: 'chip', key: `c:${e.key}`, entry: e })
      return
    }
    const last = closed ? undefined : turn?.items[turn.items.length - 1]
    if (last?.type === 'calls') last.entries.push(e)
    else push({ type: 'calls', key: `g:${e.key}`, entries: [e] })
  })
  for (let i = lo; i < messages.length; i++) if (!used[i]) receive(i)
  return turns
}

/** Calls in a group's scripts by kind, LayerFS kinds only unless there are none. */
export function kindCounts(entries: Entry[]): [SegmentKind, number][] {
  const counts = new Map<SegmentKind, number>()
  for (const e of entries) for (const s of e.view?.segments ?? []) if (s.call) counts.set(s.kind, (counts.get(s.kind) ?? 0) + 1)
  if (counts.size === 0) for (const e of entries) counts.set(e.view?.kind ?? 'local', (counts.get(e.view?.kind ?? 'local') ?? 0) + 1)
  return [...counts].sort((a, b) => b[1] - a[1])
}

/** "8 turns · 15 steps" for the footer. */
export function threadSize(turns: Turn[], steps: number): string {
  const n = turns.length
  return `${n} turn${n === 1 ? '' : 's'} · ${steps} step${steps === 1 ? '' : 's'}`
}
