// The chat's title bar: its name, where it works (a LayerFS project or a
// scratch folder) and, for a scenario chat, the scenario and its state. The
// bar is the window's drag area.
import { SquareDashed } from 'lucide-react'
import { LfsProject } from '@/components/layerfs/LfsIcons'
import { chatProject, type ChatDetail } from '@/layerfs/agent-api'
import { splitProjectKey } from '@/layerfs/chat-groups'

export function ChatHeader({ chat, lead }: { chat: ChatDetail | null; lead: number }) {
  const project = chat ? chatProject(chat) : null
  const where = project ? splitProjectKey(project) : null
  const scenario = chat?.scenario
  return (
    <header className="drag flex h-[46px] shrink-0 items-center gap-2.5 pr-4" style={{ paddingLeft: lead }}>
      <span className="min-w-0 truncate text-14 font-medium text-[var(--text-primary)]">{chat?.title || ''}</span>
      {chat && (
        <span className="flex shrink-0 items-center gap-1 text-12 text-[var(--text-tertiary)]">
          {where ? <LfsProject className="size-3.5" /> : <SquareDashed className="size-3.5" />}
          {where ? `${where.name} · ${where.store}` : 'Scratch'}
        </span>
      )}
      {scenario && (
        <span className="flex shrink-0 items-center gap-1 rounded-full bg-[var(--surface-soft,#E8EFF8)] px-2 py-0.5 text-11 text-[var(--text-secondary)]">
          Scenario {scenario.title} · {scenario.state}
        </span>
      )}
    </header>
  )
}
