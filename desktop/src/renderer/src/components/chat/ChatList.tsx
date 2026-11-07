// The sidebar's CHATS section: a collapsible group per LayerFS project, then
// Scratch (chats with no project). A long group shows its five newest chats
// and a "Show more" row. Which groups are collapsed is remembered per window.
import { ChevronRight, Plus, SquareDashed } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { LfsProject } from '@/components/layerfs/LfsIcons'
import { Tip } from '@/components/ui/tooltip'
import { groupChats, type ChatGroup as Group } from '@/layerfs/chat-groups'
import { useChats } from '@/layerfs/use-chats'
import { cn } from '@/lib/utils'
import { ChatRow } from './ChatRow'

const COLLAPSED_KEY = 'lfs.chats.collapsed'
const SHOWN = 5

function readCollapsed(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '[]') as string[])
  } catch {
    return new Set()
  }
}

export function ChatList() {
  const { chats, loaded, error } = useChats()
  const groups = useMemo(() => groupChats(chats), [chats])
  const [collapsed, setCollapsed] = useState(readCollapsed)

  const toggle = (key: string) =>
    setCollapsed((current) => {
      const next = new Set(current)
      if (!next.delete(key)) next.add(key)
      try {
        localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]))
      } catch {
        // a private window: collapse for this session only
      }
      return next
    })

  return (
    <section aria-label="Chats" className="flex flex-col gap-0.5">
      <h2 className="px-3 pb-1 pt-4 text-11 font-medium uppercase tracking-[0.04em] text-[var(--text-tertiary)]">Chats</h2>
      {error && !groups.length && <p className="px-3 py-1 text-12 text-[var(--text-tertiary)]">Chats could not load: {error}</p>}
      {loaded && !error && !groups.length && <p className="px-3 py-1 text-13 text-[var(--text-tertiary)]">No chats yet</p>}
      {groups.map((group) => (
        <ChatGroup key={group.key} group={group} open={!collapsed.has(group.key)} onToggle={() => toggle(group.key)} />
      ))}
    </section>
  )
}

function ChatGroup({ group, open, onToggle }: { group: Group; open: boolean; onToggle: () => void }) {
  const navigate = useNavigate()
  const [all, setAll] = useState(false)
  const shown = all ? group.chats : group.chats.slice(0, SHOWN)
  const Icon = group.kind === 'project' ? LfsProject : SquareDashed
  const startHere = () => navigate(group.kind === 'project' ? `/?project=${encodeURIComponent(group.key)}` : '/?project=')

  return (
    <div className="flex flex-col gap-0.5">
      <div className="group/head relative">
        <button
          type="button"
          aria-expanded={open}
          onClick={onToggle}
          className="flex h-8 w-full items-center gap-1.5 rounded-full pl-2 pr-3 text-left text-13 text-[var(--sidebar-nav-text)] transition-colors hover:bg-sidebar-item-hover"
        >
          <ChevronRight className={cn('size-3.5 shrink-0 text-[var(--text-tertiary)] transition-transform duration-150', open && 'rotate-90')} />
          <Icon className="size-3.5 shrink-0 text-[var(--text-secondary)]" />
          <span className="min-w-0 truncate font-medium">{group.name}</span>
          {group.store && <span className="min-w-0 shrink truncate text-12 text-[var(--text-tertiary)]">{group.store}</span>}
          <span className="ml-auto shrink-0 text-11 tabular-nums text-[var(--text-tertiary)] group-hover/head:invisible">{group.chats.length}</span>
        </button>
        <Tip label={group.kind === 'project' ? `New chat in ${group.name}` : 'New scratch chat'}>
          <button
            type="button"
            aria-label={group.kind === 'project' ? `New chat in ${group.name}` : 'New scratch chat'}
            onClick={startHere}
            className="absolute right-1.5 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-full text-[var(--text-tertiary)] opacity-0 transition-opacity hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] focus-visible:opacity-100 group-hover/head:opacity-100"
          >
            <Plus className="size-3.5" />
          </button>
        </Tip>
      </div>
      {open && (
        <>
          {shown.map((chat) => (
            <ChatRow key={chat.id} chat={chat} />
          ))}
          {group.chats.length > SHOWN && (
            <button
              type="button"
              onClick={() => setAll((v) => !v)}
              className="flex h-7 w-full items-center rounded-full pl-8 text-12 text-[var(--text-tertiary)] transition-colors hover:bg-sidebar-item-hover hover:text-[var(--text-secondary)]"
            >
              {all ? 'Show less' : `Show ${group.chats.length - SHOWN} more`}
            </button>
          )}
        </>
      )}
    </div>
  )
}
