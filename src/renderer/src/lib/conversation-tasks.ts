import type { AgentSessionDetail, ChatMessage } from '@shared/agent-api'

export interface ConversationTask {
  id: string
  messages: ChatMessage[]
  completed: boolean
}

function finalReply(message: ChatMessage | undefined): boolean {
  if (!message || message.role !== 'assistant' || !message.text.trim() || message.status !== 'done') return false
  const kind = (message.details as { kind?: string } | undefined)?.kind
  return kind !== 'compactionSummary' && kind !== 'branchSummary'
}

/** A follow-up starts another task after a reply; inputs during tool work stay together. */
export function groupConversationTasks(messages: readonly ChatMessage[], latestTaskComplete: boolean): ConversationTask[] {
  const tasks: ConversationTask[] = []
  let task: ConversationTask | undefined
  for (const message of messages) {
    if (!task || (message.role === 'user' && (task.messages[0].role !== 'user' || finalReply(task.messages.at(-1))))) {
      task = { id: message.entryId ?? message.id, messages: [], completed: false }
      tasks.push(task)
    }
    task.messages.push(message)
  }
  for (const [index, item] of tasks.entries()) {
    item.completed = item.messages[0].role === 'user'
      && finalReply(item.messages.at(-1))
      && !item.messages.some((message) => message.status === 'running')
      && (index < tasks.length - 1 || latestTaskComplete)
  }
  return tasks
}

/** Settled includes child work and workspace saves, not just the last model message. */
export function canCollapseLatestTask(session: AgentSessionDetail): boolean {
  return session.state === 'idle'
    && (!session.execution || session.execution.phase === 'idle')
    && !session.error
    && !session.recovery?.required
    && session.queued.length === 0
    && !session.children.some((child) => /^(running|pending|queued|paused)$/.test(child.state))
    && !session.approvals.some((approval) => approval.status === 'pending' || approval.status === 'reviewing')
    && (!session.workspace || session.workspace.state === 'ready' || session.workspace.state === 'closed')
}
