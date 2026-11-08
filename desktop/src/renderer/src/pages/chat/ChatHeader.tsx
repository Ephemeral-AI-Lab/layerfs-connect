// The chat's title bar: its name, where it works (a LayerFS project or a
// scratch folder) and, for a scenario chat, the scenario and its state. The
// bar is the window's drag area.
import { SquareDashed } from 'lucide-react'
import type { Ref } from 'react'
import { LfsProject } from '@/components/layerfs/LfsIcons'
import { chatProject, type ChatDetail, type ChildRun } from '@/layerfs/agent-api'
import { splitProjectKey } from '@/layerfs/chat-groups'
import { SubagentNavigation } from './subagents/SubagentNavigation'

export function ChatHeader({ chat, lead, child, viewingChildren, onParent, onOpenChild, onOpenAside, onOverview, triggerRef }: {
  chat: ChatDetail | null
  lead: number
  child?: ChildRun
  viewingChildren: boolean
  onParent: () => void
  onOpenChild: (id: string) => void
  onOpenAside: (id: string) => void
  onOverview: () => void
  triggerRef: Ref<HTMLButtonElement>
}) {
  const project = chat ? chatProject(chat) : null
  const where = project ? splitProjectKey(project) : null
  const scenario = child ? null : chat?.scenario
  const model = child ? child.model : chat?.modelId
  return (
    <header className="drag flex h-[46px] shrink-0 items-center gap-2.5 pr-4" style={{ paddingLeft: lead }}>
      <nav aria-label="Agent hierarchy" className="flex min-w-0 flex-1 items-center gap-2">
        {viewingChildren ? <>
          <button type="button" onClick={onParent} title={chat?.title} className="no-drag min-w-0 max-w-[50%] truncate rounded-md px-1 text-14 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-ring">{chat?.title}</button>
          <span aria-hidden="true" className="text-[var(--text-tertiary)]">/</span>
        </> : <span className="min-w-0 truncate text-14 font-medium text-[var(--text-primary)]">{chat?.title || ''}</span>}
        {chat && <SubagentNavigation children={chat.children} current={child} onOpen={onOpenChild} onOpenAside={onOpenAside} onParent={viewingChildren ? onParent : undefined} onOverview={onOverview} triggerRef={triggerRef} />}
      </nav>
      {chat && (
        <span className="hidden shrink-0 items-center gap-1 text-12 text-[var(--text-tertiary)] @min-[700px]/chat:flex">
          {where ? <LfsProject className="size-3.5" /> : <SquareDashed className="size-3.5" />}
          {where ? `${where.name} · ${where.store}` : 'Scratch'}
        </span>
      )}
      {model && !scenario && <span className="ml-auto min-w-0 truncate text-12 text-[var(--text-tertiary)]" title={child ? model : `${chat?.provider}/${model}`}>Pi · {model}</span>}
      {scenario && (
        <span className="hidden shrink-0 items-center gap-1 rounded-full bg-[var(--surface-soft,#E8EFF8)] px-2 py-0.5 text-11 text-[var(--text-secondary)] @min-[900px]/chat:flex">
          Scenario {scenario.title} · {scenario.state}
        </span>
      )}
    </header>
  )
}
