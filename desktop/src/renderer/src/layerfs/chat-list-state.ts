import type { ChatSummary } from './agent-api'

/** Keep sidebar state small even when an ordinary chat event carries history. */
function summary(chat: ChatSummary): ChatSummary {
  const { id, title, archived, cwd, project, created, updated, state, provider, modelId, error, scenario, simulation } = chat
  const execution = chat.execution ? { phase: chat.execution.phase, startedAt: chat.execution.startedAt } : undefined
  return { id, title, archived, cwd, project, created, updated, state, provider, modelId, error, scenario, simulation, execution }
}

/** Progress changes status and age, but cannot reorder a running conversation. */
export class ChatListIndex {
  private entries = new Map<string, { chat: ChatSummary; order: number }>()
  merge(chats: ChatSummary[]): boolean {
    let changed = false
    for (const input of chats) {
      const previous = this.entries.get(input.id)
      if (previous && input.updated < previous.chat.updated) continue
      const chat = summary(input)
      if (previous && JSON.stringify(previous.chat) === JSON.stringify(chat)) continue
      const order = chat.state === 'running'
        ? previous?.chat.state === 'running' ? previous.order : chat.execution?.startedAt ?? chat.created
        : chat.updated
      this.entries.set(chat.id, { chat, order }); changed = true
    }
    return changed
  }
  remove(id: string): void { this.entries.delete(id) }
  list(): ChatSummary[] {
    return [...this.entries.values()].sort((a, b) => b.order - a.order || b.chat.created - a.chat.created || a.chat.id.localeCompare(b.chat.id)).map(entry => entry.chat)
  }
}
