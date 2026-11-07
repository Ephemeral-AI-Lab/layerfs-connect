// The Subagents tab: the chat's subagents and one of them open. Wide, the
// list stays on the left beside the chosen one; narrow, it is the list or
// the subagent, with a way back.
import { Bot } from 'lucide-react'
import type { ChatDetail } from '@/layerfs/agent-api'
import { ChildList } from './ChildList'
import { ChildView } from './ChildView'

export function SubagentsTab({ chat, childId, onChange }: { chat: ChatDetail; childId: string | null; onChange: (next: ChatDetail) => void }) {
  const children = chat.children
  const chosen = childId ? children.find((c) => c.id === childId) : undefined

  if (!children.length) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center text-13 text-[var(--text-tertiary)]">
        <Bot className="size-5" />
        <p className="max-w-[360px]">No subagents yet. When the agent hands work to a subagent, it shows here with its own conversation.</p>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1">
      <aside className={chosen ? 'hidden w-[300px] shrink-0 overflow-y-auto border-r border-[var(--border-default)] p-3 @min-[900px]/chat:block' : 'hidden'}>
        <ChildList chatId={chat.id} children={children} compact />
      </aside>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {chosen ? (
          <ChildView key={chosen.id} chat={chat} child={chosen} onChange={onChange} />
        ) : (
          <div className="mx-auto flex w-full max-w-[780px] flex-col gap-3 px-5 pb-10 pt-5">
            {childId && <p className="text-12 text-destructive">That subagent is not part of this chat.</p>}
            <p className="text-12 text-[var(--text-tertiary)]">
              {children.length} {children.length === 1 ? 'subagent' : 'subagents'} in this chat
            </p>
            <ChildList chatId={chat.id} children={children} compact={false} />
          </div>
        )}
      </div>
    </div>
  )
}
