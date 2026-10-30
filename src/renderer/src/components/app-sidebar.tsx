import { Check, ChevronDown, ChevronRight, Cpu, PanelLeftClose, FolderClosed, FolderOpen, Laptop, LayoutGrid, MessageSquare, MessageSquarePlus, Plus, RefreshCw, Settings, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { AgentSessionSummary } from '@shared/agent-api'
import { projectKey, projectRef, type ProjectSummary } from '@shared/host-api'

import { ConnectMark } from '@/components/connect-mark'
import { LfsProject, LfsStore } from '@/components/lfs-icons'
import { Collapse } from '@/components/motion/collapse'
import { useIndicator } from '@/components/motion/indicator'
import { revealStyle } from '@/components/motion/reveal'
import { StateDot } from '@/components/storage/chips'
import { ago } from '@/data/format'
import { useNow } from '@/lib/use-now'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuAction,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { chatLive, chatProject, useChatSessions } from '@/host/use-chat-sessions'
import type { ProjectCatalog } from '@/host/use-projects'
import { cn } from '@/lib/utils'
import { useI18n } from '@/i18n'

export type NavId = 'chat' | 'projects' | 'storage' | 'compute'
/**
 * A page (Chat with the conversation open on it, if any), or a project by its
 * key (projectKey: `store/name` in a shared Store).
 */
/** A place a tab shows; a chat also keeps which of its views is open (Chat, Trace, History…). */
export type Selection = { kind: 'nav'; id: NavId; session?: string; view?: string } | { kind: 'project'; id: string }

interface NavItem {
  id: NavId
  label: string
  icon: React.ComponentType<{ className?: string }>
}

// Projects are their own section below (its heading opens the Projects page); Chat is reached
// from New chat on a project and from the chat page's history.
const groups: { label?: string; items: NavItem[] }[] = [
  {
    label: 'Resources',
    items: [
      { id: 'storage', label: 'Storage', icon: LfsStore },
      { id: 'compute', label: 'Compute', icon: Cpu },
    ],
  },
]

/** ⌘-click (Ctrl-click off the Mac) opens a place in a new tab. */
const inNewTab = (e: React.MouseEvent) => e.metaKey || e.ctrlKey

/** The project and session list under the pages: off for now (owner, 2026-10-31). */
const SHOW_PROJECT_TREE = false

/** A small icon button in the Projects heading. */
const HEAD_BUTTON = 'flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/[0.04] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

/** Which sessions the list shows: all of them, or only the working ones. */
type Filter = 'all' | 'running'
/** Sessions a project lists before "Show all". */
const SHOWN = 5
/** Projects open at first: the ones with the newest sessions (and the selected or a playing one). */
const OPEN_FIRST = 3

/** A project's session: a chat conversation on it. */
type Entry = { kind: 'chat'; at: number; chat: AgentSessionSummary }

const entryLive = (e: Entry) => chatLive(e.chat)
const entryKey = (e: Entry) => `c:${e.chat.id}`

interface AppSidebarProps {
  selected: Selection
  projects: ProjectCatalog
  /** Opens a place in the active tab, or in a new tab (⌘/Ctrl-click, middle-click). */
  onSelect: (selection: Selection, newTab?: boolean) => void
  onNewProject: () => void
  onDeleteProject: (project: ProjectSummary) => void
  /** Opens a chat conversation on the Chat page. */
  onOpenChat: (session: string) => void
  /** A new chat on project `project`, or on a local folder when it is ''. */
  onNewChat: (project: string) => void
  /** The New chat button at the top: a new chat in a tab of its own. */
  onNewSession: () => void
  /** Whether the Settings dialog is open, and the bottom-left button that opens it. */
  settingsOpen: boolean
  onOpenSettings: () => void
}

export function AppSidebar({ selected, projects, onSelect, onNewProject, onDeleteProject, onOpenChat, onNewChat, onNewSession, settingsOpen, onOpenSettings }: AppSidebarProps) {
  const { t } = useI18n()
  const { container, indicator } = useIndicator<HTMLDivElement>()
  const isMac = window.connect.platform === 'darwin'
  const activePage = selected.kind === 'nav' && selected.id !== 'chat' ? selected.id : undefined
  const { open, setOpen } = useSidebar()

  return (
    // folded, it slides away: its width eases to nothing, its content keeps its own width
    <div
      inert={!open}
      style={{ width: open ? 'var(--sidebar-width)' : 0 }}
      className="relative z-10 h-svh shrink-0 overflow-hidden transition-[width] duration-(--dur-slow) ease-out-expo"
    >
    <Sidebar collapsible="none" className="sidebar-glass relative z-10 h-svh shrink-0">
      <SidebarHeader className={cn('px-3 pb-3 app-drag', isMac ? 'pt-11' : 'pt-4')}>
        <div className="group/brand flex items-center gap-2.5 px-1.5 app-no-drag">
          <span className="glass-liquid relative flex size-9.5 shrink-0 items-center justify-center rounded-xl">
            <ConnectMark className="size-6 transition-transform duration-(--dur-slow) ease-out-expo group-hover/brand:scale-[1.05]" />
          </span>
          <span className="min-w-0 flex-1 truncate text-[15px] font-semibold leading-tight tracking-[-0.015em] text-foreground">LayerFS Connect</span>
          <button type="button" onClick={() => setOpen(false)} aria-label={t('Hide sidebar')} title={`${t('Hide sidebar')} (${isMac ? '⌘B' : 'Ctrl+B'})`} className={HEAD_BUTTON}>
            <PanelLeftClose className="size-4" />
          </button>
        </div>
        <button
          type="button"
          onClick={onNewSession}
          className="glass-liquid app-no-drag mt-4 flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-white/80 text-[14px] font-medium text-foreground shadow-xs transition-colors hover:bg-foreground/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:border-white/15 [&_svg]:size-4 [&_svg]:text-muted-foreground"
        >
          <MessageSquarePlus />
          {t('New chat')}
        </button>
      </SidebarHeader>

      <SidebarContent className="gap-0 overflow-hidden pb-3">
        <div ref={container} className="side-tree relative shrink-0">
          <span ref={indicator} aria-hidden="true" className="indicator glass-liquid rounded-xl shadow-xs border border-white/80 dark:border-white/15" />
          {groups.map((group, g) => (
            <SidebarGroup key={group.label ?? g} className={cn('px-3 pb-2', group.label ? 'pt-3' : 'pt-1')}>
              {group.label && (
                <SidebarGroupLabel className="px-3 text-[11px] font-semibold tracking-wider uppercase text-muted-foreground">
                  {t(group.label)}
                </SidebarGroupLabel>
              )}
              <SidebarMenu className={cn('gap-1', group.label && 'mt-1')}>
                {group.items.map((item) => {
                  const active = activePage === item.id
                  return (
                    <SidebarMenuItem key={item.id}>
                      <SidebarMenuButton
                        isActive={active}
                        onClick={(e) => onSelect({ kind: 'nav', id: item.id }, inNewTab(e))}
                        onAuxClick={(e) => { if (e.button === 1) onSelect({ kind: 'nav', id: item.id }, true) }}
                        className={cn(
                          'h-10 gap-3 px-3 text-[14.5px] font-medium [&_svg]:size-[18px] [&_svg]:transition-colors [&_svg]:duration-(--dur-base)',
                          active
                            ? 'font-semibold text-foreground [&_svg]:text-primary'
                            : 'text-foreground/80 hover:text-foreground [&_svg]:text-muted-foreground hover:[&_svg]:text-foreground',
                        )}
                      >
                        <item.icon />
                        <span>{t(item.label)}</span>
                      </SidebarMenuButton>
                            </SidebarMenuItem>
                  )
                })}
              </SidebarMenu>
            </SidebarGroup>
          ))}
        </div>
        <ProjectList selected={selected} projects={projects} onSelect={onSelect} onNewProject={onNewProject} onOpenChat={onOpenChat} onNewChat={onNewChat} />
        {SHOW_PROJECT_TREE && <ProjectTree selected={selected} projects={projects} onSelect={onSelect} onNewProject={onNewProject} onDeleteProject={onDeleteProject} onOpenChat={onOpenChat} onNewChat={onNewChat} />}
      </SidebarContent>
      <SidebarFooter className="shrink-0 px-3 py-2">
        <button
          type="button"
          data-testid="open-settings"
          aria-label={t('Settings')}
          aria-haspopup="dialog"
          aria-expanded={settingsOpen}
          onClick={onOpenSettings}
          className="app-no-drag flex h-[42px] w-full items-center gap-2 rounded-xl px-2.5 text-sm text-foreground outline-none transition-colors hover:bg-foreground/[0.05] focus-visible:ring-2 focus-visible:ring-ring aria-expanded:bg-foreground/[0.05]"
        >
          <Settings className="size-[18px] shrink-0 text-muted-foreground" strokeWidth={1.7} />
          <span className="truncate">{t('Settings')}</span>
        </button>
      </SidebarFooter>
    </Sidebar>
    </div>
  )
}

/**
 * The Projects section: its heading and the grid button open the Projects
 * page, + starts a chat with no project picked yet, and each project is a row
 * with the LayerFS mark (a shared Store's name faint after it), a + for a chat
 * on it, and, folding under it, its chat sessions. It sits under Resources and
 * fills the rest of the column; the list scrolls.
 */
function ProjectList({ selected, projects, onSelect, onNewProject, onOpenChat, onNewChat }: Pick<AppSidebarProps, 'selected' | 'projects' | 'onSelect' | 'onNewProject' | 'onOpenChat' | 'onNewChat'>) {
  const { t } = useI18n()
  const items = projects.data ?? []
  const onPage = selected.kind === 'nav' && selected.id === 'projects'
  // a new or removed conversation shows on the next page change too; chat events keep the rest current
  const { sessions } = useChatSessions(selected.kind === 'nav' ? `${selected.id}:${selected.session ?? ''}` : selected.id)
  // each project's chats (scenario chats too), newest first; archived ones left out
  const byProject = useMemo(() => {
    const map = new Map<string, AgentSessionSummary[]>()
    for (const chat of sessions ?? []) {
      const key = chatProject(chat)
      if (chat.archived || !key) continue
      map.set(key, [...(map.get(key) ?? []), chat])
    }
    for (const list of map.values()) list.sort((a, b) => b.updated - a.updated)
    return map
  }, [sessions])
  const openChat = selected.kind === 'nav' && selected.id === 'chat' ? selected.session : undefined
  const openChatProject = useMemo(() => {
    const chat = openChat ? sessions?.find((c) => c.id === openChat) : undefined
    return chat ? chatProject(chat) : null
  }, [openChat, sessions])
  const selectedProject = selected.kind === 'project' ? selected.id : undefined
  // unfolded at first: the projects with the newest chats, the one open (or whose chat is), and any with a chat working
  const recent = useMemo(
    () => new Set([...byProject].sort((a, b) => b[1][0].updated - a[1][0].updated).slice(0, OPEN_FIRST).map(([key]) => key)),
    [byProject],
  )
  const [toggled, setToggled] = useState<Map<string, boolean>>(() => new Map())
  useEffect(() => {
    for (const key of [selectedProject, openChatProject]) {
      if (key) setToggled((m) => (m.get(key) === false ? new Map(m).set(key, true) : m))
    }
  }, [selectedProject, openChatProject])
  const isOpen = (key: string, chats: AgentSessionSummary[]) =>
    chats.length > 0 && (toggled.get(key) ?? (recent.has(key) || key === selectedProject || key === openChatProject || chats.some(chatLive)))
  const working = (sessions ?? []).some((c) => !c.archived && chatLive(c))
  const now = useNow(!!sessions?.length, working ? 5000 : 30_000)
  return (
    <SidebarGroup aria-label={t('Projects')} className="flex min-h-0 flex-1 flex-col px-3 pt-3 pb-0">
      <div className="flex shrink-0 items-center gap-1 pr-1">
        <button
          type="button"
          aria-current={onPage ? 'page' : undefined}
          title={t('All projects')}
          onClick={(e) => onSelect({ kind: 'nav', id: 'projects' }, inNewTab(e))}
          className={cn(
            'flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-3 text-left text-[11px] font-semibold tracking-wider uppercase transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring',
            onPage ? 'text-foreground' : 'text-muted-foreground',
          )}
        >
          {t('Projects')}
          {items.length > 0 && <span className="text-[10px] font-medium tabular-nums tracking-normal">{items.length}</span>}
        </button>
        <button type="button" aria-label={t('All projects')} title={t('All projects')} onClick={(e) => onSelect({ kind: 'nav', id: 'projects' }, inNewTab(e))} className={cn(HEAD_BUTTON, onPage && 'text-foreground')}>
          <LayoutGrid className="size-3.5" />
        </button>
        <button type="button" aria-label={t('New chat')} title={t('New chat')} onClick={() => onNewChat('')} className={HEAD_BUTTON}>
          <Plus className="size-3.5" />
        </button>
      </div>
      <div className="min-h-0 overflow-y-auto overscroll-contain pt-1">
        {projects.error && !projects.data ? (
          <div role="status" className="mx-1 rounded-xl bg-foreground/[0.03] px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
            {t('Could not load projects.')}
            <button type="button" onClick={projects.reload} className="ml-1 rounded-sm font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{t('Retry')}</button>
          </div>
        ) : !projects.data ? (
          <div aria-label={t('Loading sidebar projects')} aria-busy="true" className="space-y-2 px-2">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-9 rounded-xl" />)}
          </div>
        ) : items.length === 0 ? (
          <button type="button" onClick={onNewProject} className="mx-3 inline-flex items-center gap-1.5 rounded-md py-1 text-xs font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Plus className="size-3" />{t('Create project')}
          </button>
        ) : (
          <SidebarMenu className="gap-1">
            {items.map((project, i) => {
              const key = projectKey(project)
              const store = projectRef(key).store
              const active = selected.kind === 'project' && selected.id === key
              const chats = byProject.get(key) ?? []
              const open = isOpen(key, chats)
              const live = chats.some(chatLive)
              return (
                <ProjectRow
                  key={key}
                  index={i}
                  name={project.name}
                  store={store}
                  active={active}
                  chats={chats}
                  open={open}
                  live={live}
                  openChat={openChat}
                  now={now}
                  onSelect={(newTab) => onSelect({ kind: 'project', id: key }, newTab)}
                  onToggle={() => setToggled((m) => new Map(m).set(key, !open))}
                  onOpenChat={onOpenChat}
                  onNewChat={() => onNewChat(key)}
                />
              )
            })}
          </SidebarMenu>
        )}
      </div>
    </SidebarGroup>
  )
}

interface ProjectRowProps {
  index: number
  name: string
  store: string | null
  active: boolean
  /** Its chats, newest first. */
  chats: AgentSessionSummary[]
  open: boolean
  /** One of its chats is working. */
  live: boolean
  /** The conversation open on the Chat page. */
  openChat?: string
  now: number
  onSelect: (newTab: boolean) => void
  onToggle: () => void
  onOpenChat: (session: string) => void
  onNewChat: () => void
}

/** A project's row (opens its page; + starts a chat on it, shown on hover; the chevron folds its chats), and under it its chats. */
function ProjectRow({ index, name, store, active, chats, open, live, openChat, now, onSelect, onToggle, onOpenChat, onNewChat }: ProjectRowProps) {
  const { t } = useI18n()
  const [all, setAll] = useState(false)
  const shown = all ? chats : chats.slice(0, SHOWN)
  const has = chats.length > 0
  return (
    <SidebarMenuItem className="side-in group/project" style={revealStyle(index)}>
      <div className="group/row relative">
      <SidebarMenuButton
        type="button"
        isActive={active}
        aria-current={active ? 'page' : undefined}
        title={store ? t('{name} in Store {store}', { name, store }) : name}
        onClick={(e) => onSelect(inNewTab(e))}
        onAuxClick={(e) => { if (e.button === 1) onSelect(true) }}
        className={cn(
          'h-10 gap-3 border px-3 pr-9 text-[14px] [&_svg]:size-[18px]',
          active
            ? 'glass-liquid border-white/80 font-semibold text-foreground shadow-xs dark:border-white/15'
            : 'border-transparent font-medium text-foreground/80 hover:text-foreground',
        )}
      >
        <LfsProject className={active ? undefined : 'opacity-80'} />
        <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
          {/* the Store's name gives way before the project's */}
          <span className="max-w-full shrink-0 truncate">{name}</span>
          {store && <span className="min-w-0 truncate text-[11px] font-normal text-muted-foreground">{store}</span>}
        </span>
        {/* + takes the place of the live dot and the count while the row is hovered */}
        {(live || has) && (
          <span className="flex shrink-0 items-center gap-3 transition-opacity group-has-[:focus-visible]/row:opacity-0 group-hover/row:opacity-0">
            {live && <span aria-hidden="true" className="pulse-ring size-1.5 shrink-0 rounded-full bg-primary text-primary" />}
            {has && <span className="text-[11px] font-normal text-muted-foreground tabular-nums">{chats.length}</span>}
          </span>
        )}
      </SidebarMenuButton>
      <SidebarMenuAction
        type="button"
        onClick={onNewChat}
        aria-label={t('New chat on {name}', { name })}
        title={t('New chat on {name}', { name })}
        className={cn(
          'top-2 size-6 rounded-lg text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-has-[:focus-visible]/row:opacity-100 group-hover/row:opacity-100 peer-data-[size=default]/menu-button:top-2 [&>svg]:size-3.5',
          has ? 'right-8' : 'right-1.5',
        )}
      >
        <Plus />
      </SidebarMenuAction>
      {has && (
        <SidebarMenuAction
          type="button"
          onClick={onToggle}
          aria-label={open ? t('Hide {name}’s sessions', { name }) : t('Show {name}’s sessions', { name })}
          aria-expanded={open}
          className="top-2 right-1.5 size-6 rounded-lg text-muted-foreground hover:text-foreground peer-data-[size=default]/menu-button:top-2 [&>svg]:size-3.5"
        >
          <ChevronRight className={cn('transition-transform duration-(--dur-base) ease-out-expo', open && 'rotate-90')} />
        </SidebarMenuAction>
      )}
      </div>
      {has && (
        <Collapse open={open} appear={false}>
          <ul aria-label={t('{name}’s sessions', { name })} className="ml-[21px] flex flex-col gap-0.5 border-l border-foreground/[0.07] py-1 pl-2">
            {shown.map((chat, i) => <ChatRow key={chat.id} index={i} chat={chat} active={openChat === chat.id} now={now} onOpen={() => onOpenChat(chat.id)} />)}
            {chats.length > SHOWN && <ShowAll all={all} count={chats.length} onToggle={() => setAll(!all)} />}
          </ul>
        </Collapse>
      )}
    </SidebarMenuItem>
  )
}

/** The projects with their chats, and the local chats. */
function ProjectTree({ selected, projects, onSelect, onNewProject, onDeleteProject, onOpenChat, onNewChat }: Omit<AppSidebarProps, 'settingsOpen' | 'onOpenSettings' | 'onNewSession'>) {
  const { t } = useI18n()
  const items = useMemo(() => projects.data ?? [], [projects.data])
  // a new or removed conversation shows on the next page change too
  const { sessions } = useChatSessions(selected.kind === 'nav' ? `${selected.id}:${selected.session ?? ''}` : selected.id)
  const chats = useMemo(() => sessions?.filter((s) => !s.archived), [sessions])
  const [filter, setFilter] = useState<Filter>('all')

  // each project with its sessions, newest first; the project with the newest session first, never-used ones last
  const { rows, local } = useMemo(() => {
    const byProject = new Map<string, Entry[]>()
    const local: Entry[] = []
    const add = (project: string | null, entry: Entry) => {
      if (filter === 'running' && !entryLive(entry)) return
      if (!project) local.push(entry)
      else byProject.set(project, [...(byProject.get(project) ?? []), entry])
    }
    for (const c of chats ?? []) add(chatProject(c), { kind: 'chat', at: c.updated, chat: c })
    const newestFirst = (a: Entry, b: Entry) => b.at - a.at
    const rows = items.map((project) => {
      const key = projectKey(project)
      return { project, key, entries: (byProject.get(key) ?? []).sort(newestFirst) }
    })
    const newest = (r: { entries: Entry[] }) => r.entries[0]?.at ?? 0
    return {
      rows: rows.filter((r) => filter === 'all' || r.entries.length).sort((a, b) => newest(b) - newest(a)),
      local: local.sort(newestFirst),
    }
  }, [chats, items, filter])
  const working = (chats ?? []).filter(chatLive).length
  const now = useNow(working > 0, 5000)

  // open: the projects with the newest sessions, plus whichever is selected or playing; a toggle wins after that
  const [toggled, setToggled] = useState<Map<string, boolean>>(() => new Map())
  const selectedProject = selected.kind === 'project' ? selected.id : undefined
  useEffect(() => {
    if (selectedProject) setToggled((m) => (m.get(selectedProject) === false ? new Map(m).set(selectedProject, true) : m))
  }, [selectedProject])
  const isOpen = (row: (typeof rows)[number], i: number) =>
    toggled.get(row.key) ?? ((i < OPEN_FIRST && row.entries.length > 0) || row.key === selectedProject || row.entries.some(entryLive) || filter === 'running')
  const toggle = (key: string, open: boolean) => setToggled((m) => new Map(m).set(key, !open))
  const openChat = selected.kind === 'nav' && selected.id === 'chat' ? selected.session : undefined

  return (
    <SidebarGroup aria-label={t('Your projects')} className="mt-2 min-h-0 flex-1 px-3 pt-0 pb-0">
      <div className="mx-3 mb-2 shrink-0 border-t border-foreground/[0.07]" />
      <div className="flex shrink-0 items-center gap-1 pr-1.5">
        <SidebarGroupLabel className="min-w-0 flex-1 gap-2 px-3 text-[11px] font-semibold tracking-wider uppercase text-muted-foreground">
          {t('Your projects')}
          {items.length > 0 && <span className="text-[10px] font-medium tabular-nums tracking-normal">{items.length}</span>}
        </SidebarGroupLabel>
        <FilterMenu filter={filter} working={working} onChange={setFilter} />
        <button type="button" aria-label={t('Refresh sidebar projects')} title={t('Refresh projects')} disabled={projects.loading} onClick={projects.reload} className="flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/[0.04] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">
          <RefreshCw className={cn('size-3', projects.loading && 'animate-spin')} />
        </button>
      </div>
      <div className="min-h-0 overflow-y-auto overscroll-contain pt-1 pb-2">
        {projects.error && (
          <div role="status" className="mx-1 mb-2 rounded-xl bg-foreground/[0.03] px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
            {t('Could not load projects.')}
            <button type="button" onClick={projects.reload} className="ml-1 rounded-sm font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{t('Retry')}</button>
          </div>
        )}
        {!projects.data && projects.loading ? (
          <div aria-label={t('Loading sidebar projects')} aria-busy="true" className="space-y-2 px-2">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-9 rounded-xl" />)}
          </div>
        ) : items.length > 0 ? (
          <SidebarMenu className="gap-1">
            {rows.length === 0 && <li className="px-3 py-2 text-xs text-muted-foreground">{t('Nothing is working now.')}</li>}
            {rows.map((row, i) => {
              const open = isOpen(row, i)
              return (
                <ProjectGroup
                  key={row.key}
                  index={i}
                  project={row.project}
                  projectKey={row.key}
                  entries={row.entries}
                  open={open}
                  selected={selected}
                  openChat={openChat}
                  now={now}
                  onToggle={() => toggle(row.key, open)}
                  onSelect={onSelect}
                  onOpenChat={onOpenChat}
                  onNewChat={() => onNewChat(row.key)}
                  onDelete={() => onDeleteProject(row.project)}
                />
              )
            })}
          </SidebarMenu>
        ) : !projects.error && (
          <div className="px-3 pt-2 pb-3 text-xs leading-relaxed text-muted-foreground">
            <p>{t('No projects yet.')}</p>
            <button type="button" onClick={onNewProject} className="mt-2 inline-flex items-center gap-1.5 rounded-md py-1 font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><Plus className="size-3" />{t('Create project')}</button>
          </div>
        )}
        <LocalChats entries={local} openChat={openChat} now={now} onOpenChat={onOpenChat} onNewChat={() => onNewChat('')} />
      </div>
    </SidebarGroup>
  )
}

interface ProjectGroupProps {
  index: number
  project: ProjectSummary
  projectKey: string
  /** Its chat conversations, newest first. */
  entries: Entry[]
  open: boolean
  selected: Selection
  /** The conversation open on the Chat page. */
  openChat?: string
  now: number
  onToggle: () => void
  onSelect: (selection: Selection) => void
  onOpenChat: (session: string) => void
  onNewChat: () => void
  onDelete: () => void
}

/** A project: its row (opens its page; the chevron folds it; + starts a chat; × deletes it), and under it its sessions. */
function ProjectGroup({ index, project, projectKey: key, entries, open, selected, openChat, now, onToggle, onSelect, onOpenChat, onNewChat, onDelete }: ProjectGroupProps) {
  const { t } = useI18n()
  const [all, setAll] = useState(false)
  // a project in a shared Store also names its Store, faint after its name
  const store = projectRef(key).store
  const active = selected.kind === 'project' && selected.id === key
  const Icon = active ? FolderOpen : FolderClosed
  const shown = all ? entries : entries.slice(0, SHOWN)
  return (
    <SidebarMenuItem className="side-in group/project" style={revealStyle(index)}>
      <SidebarMenuButton
        type="button"
        isActive={active}
        aria-current={active ? 'page' : undefined}
        title={store ? t('{name} in Store {store}', { name: project.name, store }) : project.name}
        onClick={() => onSelect({ kind: 'project', id: key })}
        className={cn('h-10 gap-2.5 border pr-16 pl-8 text-[13px] [&_svg]:size-4', active
          ? 'glass-liquid border-white/80 font-medium text-foreground shadow-xs dark:border-white/15 [&_svg]:text-primary'
          : 'border-transparent text-foreground/80 hover:text-foreground [&_svg]:text-muted-foreground')}
      >
        <Icon />
        <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
          <span className="truncate">{project.name}</span>
          {store && <span className="min-w-0 truncate text-[11px] font-normal text-muted-foreground">{store}</span>}
        </span>
        {entries.length > 0 && <span className="text-[11px] text-muted-foreground tabular-nums group-hover/project:invisible">{entries.length}</span>}
      </SidebarMenuButton>
      <SidebarMenuAction
        type="button"
        onClick={onToggle}
        aria-label={open ? t('Hide {name}’s sessions', { name: project.name }) : t('Show {name}’s sessions', { name: project.name })}
        aria-expanded={open}
        className="top-2 right-auto left-1.5 size-6 rounded-lg text-muted-foreground hover:text-foreground peer-data-[size=default]/menu-button:top-2 [&>svg]:size-3.5"
      >
        <ChevronRight className={cn('transition-transform duration-(--dur-base) ease-out-expo', open && 'rotate-90')} />
      </SidebarMenuAction>
      <SidebarMenuAction
        type="button"
        onClick={onNewChat}
        disabled={!project.initialized}
        aria-label={t('New chat on {name}', { name: project.name })}
        title={t('New chat on this project')}
        className="top-2 right-8 size-6 rounded-lg text-muted-foreground opacity-0 transition-opacity group-hover/project:opacity-100 focus-visible:opacity-100 peer-data-[size=default]/menu-button:top-2 [&>svg]:size-3.5"
      >
        <Plus />
      </SidebarMenuAction>
      <SidebarMenuAction
        type="button"
        aria-label={t('Delete project {name}', { name: store ? `${project.name} · ${store}` : project.name })}
        title={t('Delete project')}
        onClick={onDelete}
        className="top-2 right-2 size-6 rounded-lg text-muted-foreground/70 opacity-0 transition-[opacity,color] group-hover/project:opacity-100 hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 peer-data-[size=default]/menu-button:top-2 [&>svg]:size-3.5"
      >
        <X />
      </SidebarMenuAction>

      <Collapse open={open} appear={false}>
        <ul className="ml-[22px] flex flex-col gap-0.5 border-l border-foreground/[0.07] py-1 pl-2">
          {!entries.length && <li className="px-2 py-1 text-xs text-muted-foreground">{t('No sessions yet')}</li>}
          {shown.map((entry, i) => <ChatRow key={entryKey(entry)} index={i} chat={entry.chat} active={openChat === entry.chat.id} now={now} onOpen={() => onOpenChat(entry.chat.id)} />)}
          {entries.length > SHOWN && <ShowAll all={all} count={entries.length} onToggle={() => setAll(!all)} />}
        </ul>
      </Collapse>
    </SidebarMenuItem>
  )
}

/** Chats on a local folder, not a LayerFS project: a small group after the projects. */
function LocalChats({ entries, openChat, now, onOpenChat, onNewChat }: { entries: Entry[]; openChat?: string; now: number; onOpenChat: (session: string) => void; onNewChat: () => void }) {
  const { t } = useI18n()
  const [all, setAll] = useState(false)
  const shown = all ? entries : entries.slice(0, SHOWN)
  return (
    <section aria-label={t('Local chats')} className="mt-3">
      <div className="flex items-center gap-1 pr-1.5">
        <span className="flex min-w-0 flex-1 items-center gap-2 px-3 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
          <Laptop className="size-3.5" />
          {t('Local chats')}
        </span>
        <button type="button" aria-label={t('New chat on a local folder')} title={t('New chat on a local folder')} onClick={onNewChat} className="flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/[0.04] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <Plus className="size-3.5" />
        </button>
      </div>
      <ul className="mt-0.5 flex flex-col gap-0.5 px-1">
        {!entries.length && <li className="px-3 py-1 text-xs text-muted-foreground">{t('No local chats')}</li>}
        {shown.map((entry, i) => <ChatRow key={entryKey(entry)} index={i} chat={entry.chat} active={openChat === entry.chat.id} now={now} onOpen={() => onOpenChat(entry.chat.id)} />)}
        {entries.length > SHOWN && <ShowAll all={all} count={entries.length} onToggle={() => setAll(!all)} />}
      </ul>
    </section>
  )
}

const ROW = 'side-in flex w-full min-w-0 items-start gap-2.5 rounded-xl border px-2.5 py-1.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring'
const rowTone = (active: boolean) =>
  active ? 'glass-liquid border-white/80 shadow-xs dark:border-white/15' : 'border-transparent hover:bg-foreground/[0.04]'

/** A chat conversation: its title, a state dot, its model and how long ago it was active. */
function ChatRow({ index, chat, active, now, onOpen }: { index: number; chat: AgentSessionSummary; active: boolean; now: number; onOpen: () => void }) {
  const { t } = useI18n()
  const live = chatLive(chat)
  const state = chat.state === 'error' ? t('error') : live ? t('working') : t('idle')
  return (
    <li>
      <button type="button" onClick={onOpen} aria-current={active ? 'page' : undefined} className={cn(ROW, rowTone(active))} style={revealStyle(index)} title={chat.title}>
        <span className="mt-[5px] flex">
          <StateDot tone={chat.state === 'error' ? 'danger' : live ? 'info' : 'neutral'} live={live} label={state} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <MessageSquare aria-hidden="true" className="size-3 shrink-0 text-muted-foreground" />
            <span className={cn('truncate text-[12.5px]', active ? 'font-medium text-foreground' : 'text-foreground/85')}>{chat.title || t('New session')}</span>
          </span>
          <span className="block truncate text-[11px] text-muted-foreground">
            {[chat.modelId, live ? t('working') : ago(chat.updated, now)].filter(Boolean).join(' · ')}
          </span>
        </span>
      </button>
    </li>
  )
}

function ShowAll({ all, count, onToggle }: { all: boolean; count: number; onToggle: () => void }) {
  const { t } = useI18n()
  return (
    <li>
      <button type="button" onClick={onToggle} className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
        {all ? t('Show fewer') : t('Show all')}
        {!all && <span className="rounded-full bg-foreground/[0.05] px-1.5 text-[11px] leading-4 tabular-nums">{count}</span>}
      </button>
    </li>
  )
}

/** The list's filter: every session, or only the working ones. */
function FilterMenu({ filter, working, onChange }: { filter: Filter; working: number; onChange: (f: Filter) => void }) {
  const { t } = useI18n()
  const item = (f: Filter, text: string) => (
    <DropdownMenuItem onSelect={() => onChange(f)} className="rounded-xl">
      <Check aria-hidden="true" className={cn('size-3.5', f === filter ? 'text-primary' : 'invisible')} />
      <span className="min-w-0 flex-1 truncate">{t(text)}</span>
      {f === 'running' && <span className="text-[11px] text-muted-foreground tabular-nums">{working}</span>}
    </DropdownMenuItem>
  )
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t('Show sessions: {filter}', { filter: filter === 'all' ? t('All') : t('Running') })}
          className={cn('flex h-7 shrink-0 items-center gap-1 rounded-lg px-2 text-[11px] outline-none transition-colors hover:bg-foreground/[0.04] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring', filter === 'all' ? 'text-muted-foreground' : 'font-medium text-primary')}
        >
          {filter === 'all' ? t('All') : t('Running')}
          <ChevronDown aria-hidden="true" className="size-3" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-44" align="end">
        {item('all', 'All sessions')}
        {item('running', 'Running')}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
