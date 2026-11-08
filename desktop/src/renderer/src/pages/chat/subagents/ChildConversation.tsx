import { childActive, type ChatDetail, type ChildRun } from '@/layerfs/agent-api'
import { useChild } from '@/layerfs/use-child'
import { ConversationTab } from '../conversation/ConversationTab'

/** Project a child into the ordinary conversation layout without inheriting parent controls. */
export function ChildConversation({ chat, child: summary, shown = true, onChange }: {
  chat: ChatDetail
  child: ChildRun
  shown?: boolean
  onChange: (next: ChatDetail) => void
}) {
  const { data, error } = useChild(chat.id, summary.id)
  const child = { ...data?.child, ...summary }
  const running = childActive(child)
  const messages = data?.messages.length ? data.messages : [
    ...(child.task ? [{ id: `${child.id}:task`, role: 'user' as const, text: child.task }] : []),
    ...(child.text ? [{ id: `${child.id}:output`, role: 'assistant' as const, text: child.text }] : []),
  ]
  const conversation: ChatDetail = {
    ...chat, title: child.agent, messages, children: [], queued: [], approvals: [],
    state: running ? 'running' : child.state === 'failed' ? 'error' : 'idle',
    error: child.error ?? null, scenario: null, provider: null, modelId: child.model ?? null,
    contextUsage: null, usage: undefined, recovery: undefined,
    execution: { phase: running ? child.currentTool ? 'tool' : 'thinking' : 'idle', startedAt: child.startedAt ?? null },
  }
  return <ConversationTab chat={conversation} child={child} shown={shown} onChange={onChange} loading={!data && !error} loadError={error} />
}
