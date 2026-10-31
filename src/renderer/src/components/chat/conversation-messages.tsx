import { ChevronRight } from 'lucide-react'
import { useId, useLayoutEffect, useMemo, useRef, useState, type ComponentProps } from 'react'
import type { ChatMessage } from '@shared/agent-api'

import { AgentMessage } from '@/components/chat/agent-messages'
import { useI18n } from '@/i18n'
import { groupConversationTasks, type ConversationTask } from '@/lib/conversation-tasks'
import { cn } from '@/lib/utils'

type MessageProps = Omit<ComponentProps<typeof AgentMessage>, 'message' | 'collapseThinking' | 'onInspect'>
interface Props extends MessageProps {
  messages: ChatMessage[]
  latestTaskComplete: boolean
  onProcessToggle?: () => void
}

/** Completion folds the task's process without changing the saved conversation. */
export function ConversationMessages({ messages, latestTaskComplete, onProcessToggle, ...props }: Props) {
  const tasks = useMemo(() => groupConversationTasks(messages, latestTaskComplete), [messages, latestTaskComplete])
  return tasks.map((task) => <TaskMessages key={task.id} task={task} onProcessToggle={onProcessToggle} {...props} />)
}

function TaskMessages({ task, onProcessToggle, ...props }: MessageProps & { task: ConversationTask; onProcessToggle?: () => void }) {
  const { t } = useI18n()
  const processId = useId()
  const toggle = useRef<HTMLButtonElement>(null)
  const process = useRef<HTMLDivElement>(null)
  const [expandedReply, setExpandedReply] = useState<string | null>(null)
  // Reading a full-output dialog is an explicit request to keep this task open.
  const [inspecting, setInspecting] = useState(false)
  const last = task.messages.at(-1)!
  const foldable = task.completed && task.messages.slice(0, -1).some((message) =>
    message.role === 'tool' || (message.role === 'assistant' && (!!message.text || !!message.thinking)),
  )
  const expanded = !foldable || inspecting || expandedReply === last.id

  useLayoutEffect(() => {
    const focused = document.activeElement
    if (!expanded && process.current?.contains(focused) && focused?.closest('[hidden]')) toggle.current?.focus({ preventScroll: true })
  }, [expanded])

  const disclosure = foldable && <button
    ref={toggle}
    type="button"
    aria-expanded={expanded}
    aria-controls={processId}
    onClick={() => {
      onProcessToggle?.()
      setInspecting(false)
      setExpandedReply(expanded ? null : last.id)
    }}
    className="mt-1 -mb-2 flex min-h-8 w-fit items-center gap-1.5 rounded-lg px-2 text-xs text-muted-foreground outline-none transition-colors hover:bg-foreground/[0.035] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
  >
    <ChevronRight aria-hidden="true" className={cn('size-3.5', expanded && 'rotate-90')} />
    {t(expanded ? 'Hide task process' : 'View task process')}
  </button>

  return <section className="flex min-w-0 flex-col gap-5" data-task-id={task.id} data-task-completed={task.completed}>
    <div ref={process} id={processId} className="flex flex-col gap-5">
      {task.messages.map((message, index) => {
        const hidden = !expanded && message !== last && message.role !== 'user'
        return <div key={message.id} hidden={hidden} className={cn('empty:hidden', hidden && 'hidden')}>
          <AgentMessage
            {...props}
            message={message}
            collapseThinking={task.completed && message === last}
            onInspect={() => { setInspecting(true); onProcessToggle?.() }}
          />
          {index === 0 && disclosure}
        </div>
      })}
    </div>
  </section>
}
