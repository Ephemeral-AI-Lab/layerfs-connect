import { ArrowUpRight, X } from 'lucide-react'
import { useState } from 'react'
import { IconButton } from '@/components/ui/icon-button'
import type { ChatDetail } from '@/layerfs/agent-api'
import { ChatTabs, type ChatTab } from '../ChatTabs'
import { ChatFilesTab } from '../FilesTab'
import { SandboxesTab } from '../SandboxesTab'
import { HistoryTab } from '../history/HistoryTab'
import { TraceTab } from '../trace/TraceTab'
import { ChildConversation } from './ChildConversation'
import { SubagentNavigation } from './SubagentNavigation'

/** Embedded inspection uses the same child transcript and stop action as the main view. */
export function SubagentPanel({ chat, childId, onChange, onSelect, onOpen, onClose }: {
  chat: ChatDetail
  childId: string
  onChange: (next: ChatDetail) => void
  onSelect: (id: string) => void
  onOpen: (id: string) => void
  onClose: () => void
}) {
  const child = chat.children.find(item => item.id === childId)
  const [view, setView] = useState<ChatTab>('chat')
  return (
    <aside
      aria-label="Subagent side panel"
      onKeyDown={event => {
        if (event.key === 'Escape' && !event.defaultPrevented) {
          event.stopPropagation()
          onClose()
        }
      }}
      className="flex min-h-0 w-full min-w-0 shrink-0 flex-col border-l border-[var(--border-default)] bg-[var(--card)] @min-[820px]/chat:w-[42%] @min-[820px]/chat:min-w-[320px] @min-[820px]/chat:max-w-[560px]"
    >
      <div className="flex h-11 shrink-0 items-center gap-1 border-b border-[var(--border-default)] px-3">
        {child ? <SubagentNavigation children={chat.children} current={child} onOpen={onSelect} /> : <span className="text-13">Subagent unavailable</span>}
        <div className="ml-auto flex shrink-0 items-center">
          {child && <IconButton icon={ArrowUpRight} tone="header" label="Open subagent in main view" onClick={() => onOpen(child.id)} />}
          <IconButton icon={X} tone="header" label="Close subagent side panel" onClick={onClose} />
        </div>
      </div>
      {child ? <>
        <ChatTabs chat={chat} child={child} current={view} lead={12} onSelect={setView} />
        <div className={view === 'chat' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
          <ChildConversation key={child.id} chat={chat} child={child} onChange={onChange} shown={view === 'chat'} />
        </div>
        {view === 'files' && <ChatFilesTab chat={chat} />}
        {view === 'sandboxes' && <SandboxesTab chat={chat} childId={child.id} />}
        {view === 'history' && <HistoryTab key={child.id} chat={chat} childId={child.id} />}
        {view === 'trace' && <TraceTab key={child.id} chat={chat} childId={child.id} />}
      </> : <p role="status" className="p-5 text-13 text-[var(--text-tertiary)]">This subagent is no longer available in this chat.</p>}
    </aside>
  )
}
