// A chat's messages as the page shows them: turns that each open with the
// user's message, then the agent's work and replies in order. Tool calls and
// the thinking between them fold into one work block; a written reply closes
// the block, so a turn reads: work, reply, work, reply…
import type { ChatMessage, StepCall } from '@/layerfs/agent-api'

export type WorkItem = { kind: 'thinking'; id: string; text: string; live: boolean } | { kind: 'step'; message: ChatMessage }

export type TurnPart =
  | { kind: 'work'; id: string; items: WorkItem[]; live: boolean }
  | { kind: 'reply'; id: string; text: string; live: boolean }

export interface Turn {
  id: string
  /** The user's message; null for what came before the first one. */
  user: ChatMessage | null
  parts: TurnPart[]
}

/** `running`: the chat works now, so its last message may still be growing. */
export function toTurns(messages: ChatMessage[], running: boolean): Turn[] {
  const turns: Turn[] = []
  let turn: Turn | null = null
  let work: Extract<TurnPart, { kind: 'work' }> | null = null
  const last = messages.at(-1)

  const open = () => (turn ??= { id: 'start', user: null, parts: [] })
  const workBlock = (id: string) => {
    if (!work) {
      work = { kind: 'work', id, items: [], live: false }
      open().parts.push(work)
    }
    return work
  }

  for (const message of messages) {
    const live = running && message === last
    if (message.role === 'user') {
      turn = { id: message.id, user: message, parts: [] }
      turns.push(turn)
      work = null
      continue
    }
    if (!turn) turns.push(open())
    if (message.role === 'tool') {
      const block = workBlock(message.id)
      block.items.push({ kind: 'step', message })
      continue
    }
    // assistant: its thinking goes with the work around it; its text is a reply
    if (message.thinking?.trim()) workBlock(message.id).items.push({ kind: 'thinking', id: message.id, text: message.thinking, live: live && !message.text })
    if (message.text.trim()) {
      work = null
      turn!.parts.push({ kind: 'reply', id: message.id, text: message.text, live })
    }
  }
  // the block still being written is open while the chat works
  const tail = turns.at(-1)?.parts.at(-1)
  if (running && tail?.kind === 'work') tail.live = true
  return turns
}

/** The LayerFS calls of a work block's steps, in the order they ran. */
export const blockCalls = (items: WorkItem[]): StepCall[] =>
  items.flatMap((item) => (item.kind === 'step' ? (item.message.view?.calls ?? []) : []))

/** How long a block's LayerFS calls took, first start to last end; null without calls. */
export function blockSpan(items: WorkItem[]): number | null {
  const calls = blockCalls(items).filter((c) => c.start)
  if (!calls.length) return null
  const starts = calls.map((c) => Date.parse(c.start))
  const ends = calls.map((c, i) => starts[i] + (c.ms ?? 0))
  return Math.max(...ends) - Math.min(...starts)
}
