import { ArrowUpRight, Check, ChevronDown, ChevronRight, Cpu, PanelLeftClose, FolderClosed, FolderOpen, Laptop, MessageSquarePlus, Plus, RefreshCw, Settings, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { AgentSessionSummary } from '@shared/agent-api'
import { projectKey, projectRef, type ProjectSummary } from '@shared/host-api'

import { LfsProject, LfsStore } from '@/components/lfs-icons'
import { Collapse } from '@/components/motion/collapse'
import { useIndicator } from '@/components/motion/indicator'
import { revealStyle } from '@/components/motion/reveal'
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
import { jobCounts } from '@/data/job-progress'
import { ago, when } from '@/data/format'
import { useStorageJobs } from '@/host/storage-jobs'
import { chatLive, chatProject, useChatSessions } from '@/host/use-chat-sessions'
import type { ProjectCatalog } from '@/host/use-projects'
import { cn } from '@/lib/utils'
import { useI18n } from '@/i18n'
import './app-shell.css'

export type NavId = 'chat' | 'projects' | 'machines' | 'storage'
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

// The pages sit at the top (Projects, then where they run and keep their data); the Chats section
// below lists the chats grouped by project. Chat is reached from New chat and from those chat rows.
const groups: { label?: string; items: NavItem[] }[] = [
  {
    items: [
      { id: 'projects', label: 'Projects', icon: LfsProject },
      { id: 'machines', label: 'Machines', icon: Cpu },
      { id: 'storage', label: 'Storage', icon: LfsStore },
    ],
  },
]

/** ⌘-click (Ctrl-click off the Mac) opens a place in a new tab. */
const inNewTab = (e: React.MouseEvent) => e.metaKey || e.ctrlKey

/** The project and session list under the pages: off for now (owner, 2026-10-31). */
const SHOW_PROJECT_TREE = false

/** A small icon button in a section heading. */
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
  onDeleteChat: (chat: AgentSessionSummary, returnFocus: HTMLElement) => void
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

export function AppSidebar({ selected, projects, onSelect, onNewProject, onDeleteProject, onDeleteChat, onOpenChat, onNewChat, onNewSession, settingsOpen, onOpenSettings }: AppSidebarProps) {
  const { t } = useI18n()
  const known = useStorageJobs()
  // Storage's mark: a live dot while a job runs, red while a failed one is not dismissed
  const jobs = jobCounts(known.jobs, known.dismissed)
  const { container, indicator } = useIndicator<HTMLDivElement>()
  const isMac = window.connect.platform === 'darwin'
  // a project's page counts as Projects
  const activePage = selected.kind === 'project' ? 'projects' : selected.id !== 'chat' ? selected.id : undefined
  const { open, setOpen } = useSidebar()

  return (
    // Folded, it slides away; compact windows present it above a dismissible scrim.
    <>
    {open && <button type="button" className="shell-sidebar-dismiss app-no-drag" aria-label={t('Hide sidebar')} onClick={() => setOpen(false)} />}
    <div
      inert={!open}
      data-open={open}
      style={{ width: open ? 'var(--sidebar-width)' : 0 }}
      className="shell-sidebar-wrap relative z-10 h-svh shrink-0 overflow-hidden transition-[width] duration-(--dur-slow) ease-out-expo"
    >
    <Sidebar collapsible="none" className="shell-sidebar sidebar-glass relative z-10 h-svh shrink-0">
      <SidebarHeader className="shell-sidebar-header px-3 pt-3 pb-2 app-drag">
        <div className="flex h-7 items-center justify-end px-1.5 app-no-drag">
          <button type="button" onClick={() => setOpen(false)} aria-label={t('Hide sidebar')} title={`${t('Hide sidebar')} (${isMac ? '⌘B' : 'Ctrl+B'})`} className={HEAD_BUTTON}>
            <PanelLeftClose className="size-4" />
          </button>
        </div>
        <button
          type="button"
          onClick={onNewSession}
          className="shell-new-chat app-no-drag"
        >
          <MessageSquarePlus />
          {t('New')}
        </button>
      </SidebarHeader>

      <SidebarContent className="gap-0 overflow-hidden pb-3">
        <div ref={container} className="side-tree relative shrink-0">
          <span ref={indicator} hidden={!activePage} aria-hidden="true" className="indicator shell-nav-indicator rounded-lg" />
          {groups.map((group, g) => (
            <SidebarGroup key={group.label ?? g} className={cn('px-3 pb-2', group.label ? 'pt-3' : 'pt-1')}>
              {group.label && (
                <SidebarGroupLabel className="px-3 text-xs font-normal text-muted-foreground">
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
                          'h-[42px] gap-3 px-3 text-[14px] font-normal [&_svg]:size-[17px] [&_svg]:transition-colors [&_svg]:duration-(--dur-base)',
                          active
                            ? 'data-active:font-medium text-foreground [&_svg]:text-foreground'
                            : 'text-muted-foreground hover:text-foreground [&_svg]:text-muted-foreground hover:[&_svg]:text-foreground',
                        )}
                      >
                        <item.icon />
                        <span>{t(item.label)}</span>
                        {item.id === 'storage' && (jobs.running > 0 || jobs.failed > 0) && (
                          <span
                            role="img"
                            aria-label={jobs.running ? t('{n} running', { n: jobs.running }) : t('{n} failed', { n: jobs.failed })}
                            title={jobs.running ? t('{n} running', { n: jobs.running }) : t('{n} failed', { n: jobs.failed })}
                            className={cn('ml-auto size-2 rounded-full', jobs.running ? 'pulse-ring bg-primary text-primary' : 'bg-destructive')}
                          />
                        )}
                      </SidebarMenuButton>
                            </SidebarMenuItem>
                  )
                })}
              </SidebarMenu>
            </SidebarGroup>
          ))}
        </div>
        <ChatList selected={selected} onSelect={onSelect} onDeleteChat={onDeleteChat} onOpenChat={onOpenChat} onNewChat={onNewChat} />
        {SHOW_PROJECT_TREE && <ProjectTree selected={selected} projects={projects} onSelect={onSelect} onNewProject={onNewProject} onDeleteProject={onDeleteProject} onDeleteChat={onDeleteChat} onOpenChat={onOpenChat} onNewChat={onNewChat} />}
      </SidebarContent>
      <SidebarFooter className="shell-sidebar-footer flex shrink-0 flex-row items-center gap-0 p-0 pr-4">
        <button
          type="button"
          data-testid="open-settings"
          aria-label={t('Settings')}
          aria-haspopup="dialog"
          aria-expanded={settingsOpen}
          onClick={onOpenSettings}
          className="shell-settings-button app-no-drag flex h-13 min-w-0 flex-1 items-center gap-2.5 rounded-none px-6 text-[13px] text-muted-foreground outline-none transition-colors hover:bg-foreground/[0.05] hover:text-foreground aria-expanded:bg-foreground/[0.05] aria-expanded:text-foreground"
        >
          <Settings className="size-[18px] shrink-0 text-muted-foreground" strokeWidth={1.7} />
          <span className="truncate">{t('Settings')}</span>
        </button>
      </SidebarFooter>
    </Sidebar>
    </div>
    </>
  )
}

/**
 * The Chats section: every chat that is not archived, grouped by its project (the group with the
 * newest chat first), then the chats on a local folder under "No project". A group's header folds
 * it; on hover it offers its project's page and a new chat on it. The heading's + starts a chat
 * with no project picked yet. It fills the rest of the column; the list scrolls.
 */
function ChatList({ selected, onSelect, onDeleteChat, onOpenChat, onNewChat }: Pick<AppSidebarProps, 'selected' | 'onSelect' | 'onDeleteChat' | 'onOpenChat' | 'onNewChat'>) {
  const { t } = useI18n()
  const [retry, setRetry] = useState(0)
  // a new or removed conversation shows on the next page change too; chat events keep the rest current
  const { sessions, error } = useChatSessions(`${selected.kind === 'nav' ? `${selected.id}:${selected.session ?? ''}` : selected.id}#${retry}`)
  // each project's chats (scenario chats too), newest first, the project with the newest chat first; archived ones left out
  const { groups, local } = useMemo(() => {
    const map = new Map<string, AgentSessionSummary[]>()
    const local: AgentSessionSummary[] = []
    for (const chat of sessions ?? []) {
      if (chat.archived) continue
      const key = chatProject(chat)
      if (!key) local.push(chat)
      else map.set(key, [...(map.get(key) ?? []), chat])
    }
    const newestFirst = (a: AgentSessionSummary, b: AgentSessionSummary) => b.updated - a.updated
    for (const list of map.values()) list.sort(newestFirst)
    return { groups: [...map].sort((a, b) => b[1][0].updated - a[1][0].updated), local: local.sort(newestFirst) }
  }, [sessions])
  const openChat = selected.kind === 'nav' && selected.id === 'chat' ? selected.session : undefined
  const openChatProject = useMemo(() => {
    const chat = openChat ? sessions?.find((c) => c.id === openChat) : undefined
    return chat ? (chatProject(chat) ?? LOCAL) : null
  }, [openChat, sessions])
  const selectedProject = selected.kind === 'project' ? selected.id : undefined
  // unfolded at first: the groups with the newest chats, the open project (or the open chat's), and any with a chat working
  const recent = useMemo(() => new Set(groups.slice(0, OPEN_FIRST).map(([key]) => key)), [groups])
  const [toggled, setToggled] = useState<Map<string, boolean>>(() => new Map())
  useEffect(() => {
    for (const key of [selectedProject, openChatProject]) {
      if (key) setToggled((m) => (m.get(key) === false ? new Map(m).set(key, true) : m))
    }
  }, [selectedProject, openChatProject])
  const isOpen = (key: string, chats: AgentSessionSummary[]) =>
    toggled.get(key) ?? (recent.has(key) || key === selectedProject || key === openChatProject || chats.some(chatLive) || (key === LOCAL && groups.length === 0))
  const toggle = (key: string, open: boolean) => setToggled((m) => new Map(m).set(key, !open))
  const shared = { openChat, onOpenChat, onDeleteChat }
  return (
    <SidebarGroup aria-label={t('Chats')} className="flex min-h-0 flex-1 flex-col px-3 pt-3 pb-0">
      <div className="flex shrink-0 items-center gap-1 pr-1">
        <SidebarGroupLabel className="min-w-0 flex-1 px-3 text-xs font-normal text-muted-foreground">
          {t('Chats')}
        </SidebarGroupLabel>
        <button type="button" aria-label={t('New chat')} title={t('New chat')} onClick={() => onNewChat('')} className={HEAD_BUTTON}>
          <Plus className="size-3.5" />
        </button>
      </div>
      <div className="min-h-0 overflow-y-auto overscroll-contain pt-1">
        {error && (
          <div role="status" className="mx-1 mb-2 rounded-xl bg-foreground/[0.03] px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
            {t('Could not load chats.')}
            <button type="button" onClick={() => setRetry((n) => n + 1)} className="ml-1 rounded-sm font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{t('Retry')}</button>
          </div>
        )}
        {!sessions ? (
          <div aria-label={t('Loading chats')} aria-busy="true" className="space-y-2 px-2">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-9 rounded-xl" />)}
          </div>
        ) : groups.length === 0 && local.length === 0 ? (
          !error && (
            <div className="px-3 pt-1 text-xs leading-relaxed text-muted-foreground">
              <p>{t('No chats yet')}</p>
              <button type="button" onClick={() => onNewChat('')} className="mt-1.5 inline-flex items-center gap-1.5 rounded-md py-1 font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <Plus className="size-3" />{t('New chat')}
              </button>
            </div>
          )
        ) : (
          <ul className="flex flex-col gap-1">
            {groups.map(([key, chats], i) => {
              const { name, store } = projectRef(key)
              const open = isOpen(key, chats)
              return (
                <ChatGroup
                  key={key}
                  index={i}
                  icon={LfsProject}
                  name={name}
                  store={store}
                  active={key === selectedProject}
                  chats={chats}
                  open={open}
                  onToggle={() => toggle(key, open)}
                  onOpenPage={(newTab) => onSelect({ kind: 'project', id: key }, newTab)}
                  newChatLabel={t('New chat on {name}', { name })}
                  onNewChat={() => onNewChat(key)}
                  {...shared}
                />
              )
            })}
            {local.length > 0 && (
              <ChatGroup
                index={groups.length}
                icon={Laptop}
                name={t('No project')}
                chats={local}
                open={isOpen(LOCAL, local)}
                onToggle={() => toggle(LOCAL, isOpen(LOCAL, local))}
                newChatLabel={t('New chat on a local folder')}
                onNewChat={() => onNewChat('')}
                {...shared}
              />
            )}
          </ul>
        )}
      </div>
    </SidebarGroup>
  )
}

/** The Chats section's key for the chats on a local folder (no project key has a leading NUL). */
const LOCAL = '\0local'

interface ChatGroupProps {
  index: number
  icon: React.ComponentType<{ className?: string }>
  name: string
  /** A project's Store, faint after its name. */
  store?: string | null
  /** Its project's page is open. */
  active?: boolean
  /** Its chats, newest first. */
  chats: AgentSessionSummary[]
  open: boolean
  /** The conversation open on the Chat page. */
  openChat?: string
  onToggle: () => void
  /** Opens its project's page; none for the local chats. */
  onOpenPage?: (newTab: boolean) => void
  newChatLabel: string
  onNewChat: () => void
  onOpenChat: (session: string) => void
  onDeleteChat: AppSidebarProps['onDeleteChat']
}

/** A group of chats: its header (folds it; on hover, its project's page and a new chat on it), and under it its chats. */
function ChatGroup({ index, icon: Icon, name, store, active, chats, open, openChat, onToggle, onOpenPage, newChatLabel, onNewChat, onOpenChat, onDeleteChat }: ChatGroupProps) {
  const { t } = useI18n()
  const [all, setAll] = useState(false)
  const shown = all ? chats : chats.slice(0, SHOWN)
  const label = store ? `${name} · ${store}` : name
  return (
    <li className="side-in" style={revealStyle(index)}>
      <div className="group/row relative">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-label={open ? t('Hide {name}’s chats', { name: label }) : t('Show {name}’s chats', { name: label })}
          title={label}
          className={cn(
            'flex h-9 w-full min-w-0 items-center gap-2 rounded-xl pr-3 pl-2 text-left text-[14px] font-medium outline-none transition-colors hover:bg-foreground/[0.03] focus-visible:ring-2 focus-visible:ring-ring',
            active ? 'text-foreground' : 'text-foreground/80 hover:text-foreground',
          )}
        >
          <ChevronRight aria-hidden="true" className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform duration-(--dur-base) ease-out-expo', open && 'rotate-90')} />
          <Icon className={cn('size-4 shrink-0', active ? 'text-(--icon-accent)' : 'opacity-80')} />
          <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
            {/* the Store's name gives way before the project's */}
            <span className="max-w-full shrink-0 truncate">{name}</span>
            {store && <span className="min-w-0 truncate text-[11px] font-normal text-muted-foreground">{store}</span>}
          </span>
          {/* the actions take the count's place while the header is hovered */}
          <span className="shrink-0 text-[11px] font-normal text-muted-foreground tabular-nums transition-opacity group-has-[:focus-visible]/row:opacity-0 group-hover/row:opacity-0">
            {chats.length}
          </span>
        </button>
        <div className="absolute top-1.5 right-1.5 flex items-center gap-0.5 opacity-0 transition-opacity group-has-[:focus-visible]/row:opacity-100 group-hover/row:opacity-100">
          {onOpenPage && (
            <button
              type="button"
              aria-label={t('Open project {name}', { name: label })}
              title={t('Open project {name}', { name: label })}
              onClick={(e) => onOpenPage(inNewTab(e))}
              onAuxClick={(e) => { if (e.button === 1) onOpenPage(true) }}
              className="flex size-6 items-center justify-center rounded-lg text-muted-foreground outline-none hover:bg-foreground/[0.05] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ArrowUpRight className="size-3.5" />
            </button>
          )}
          <button type="button" aria-label={newChatLabel} title={newChatLabel} onClick={onNewChat} className="flex size-6 items-center justify-center rounded-lg text-muted-foreground outline-none hover:bg-foreground/[0.05] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
            <Plus className="size-3.5" />
          </button>
        </div>
      </div>
      <Collapse open={open} appear={false}>
        {/* the chats' icons line up under the group's */}
        <ul aria-label={t('{name}’s chats', { name: label })} className="ml-[18px] flex flex-col gap-0.5 py-1">
          {shown.map((chat, i) => <ChatRow key={chat.id} index={i} chat={chat} active={openChat === chat.id} onOpen={() => onOpenChat(chat.id)} onDelete={onDeleteChat} />)}
          {chats.length > SHOWN && <ShowAll all={all} count={chats.length} onToggle={() => setAll(!all)} />}
        </ul>
      </Collapse>
    </li>
  )
}

/** The projects with their chats, and the local chats. */
function ProjectTree({ selected, projects, onSelect, onNewProject, onDeleteProject, onDeleteChat, onOpenChat, onNewChat }: Omit<AppSidebarProps, 'settingsOpen' | 'onOpenSettings' | 'onNewSession'>) {
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
                  onToggle={() => toggle(row.key, open)}
                  onSelect={onSelect}
                  onOpenChat={onOpenChat}
                  onNewChat={() => onNewChat(row.key)}
                  onDelete={() => onDeleteProject(row.project)}
                  onDeleteChat={onDeleteChat}
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
        <LocalChats entries={local} openChat={openChat} onOpenChat={onOpenChat} onDeleteChat={onDeleteChat} onNewChat={() => onNewChat('')} />
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
  onToggle: () => void
  onSelect: (selection: Selection) => void
  onOpenChat: (session: string) => void
  onNewChat: () => void
  onDelete: () => void
  onDeleteChat: AppSidebarProps['onDeleteChat']
}

/** A project: its row (opens its page; the chevron folds it; + starts a chat; × deletes it), and under it its sessions. */
function ProjectGroup({ index, project, projectKey: key, entries, open, selected, openChat, onToggle, onSelect, onOpenChat, onNewChat, onDelete, onDeleteChat }: ProjectGroupProps) {
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
          ? 'bg-sidebar-accent font-medium text-foreground [&_svg]:text-foreground'
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
        <ul className="ml-0.5 flex flex-col gap-0.5 py-1">
          {!entries.length && <li className="px-2 py-1 text-xs text-muted-foreground">{t('No sessions yet')}</li>}
          {shown.map((entry, i) => <ChatRow key={entryKey(entry)} index={i} chat={entry.chat} active={openChat === entry.chat.id} onOpen={() => onOpenChat(entry.chat.id)} onDelete={onDeleteChat} />)}
          {entries.length > SHOWN && <ShowAll all={all} count={entries.length} onToggle={() => setAll(!all)} />}
        </ul>
      </Collapse>
    </SidebarMenuItem>
  )
}

/** Chats on a local folder, not a LayerFS project: a small group after the projects. */
function LocalChats({ entries, openChat, onOpenChat, onNewChat, onDeleteChat }: { entries: Entry[]; openChat?: string; onOpenChat: (session: string) => void; onNewChat: () => void; onDeleteChat: AppSidebarProps['onDeleteChat'] }) {
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
        {shown.map((entry, i) => <ChatRow key={entryKey(entry)} index={i} chat={entry.chat} active={openChat === entry.chat.id} onOpen={() => onOpenChat(entry.chat.id)} onDelete={onDeleteChat} />)}
        {entries.length > SHOWN && <ShowAll all={all} count={entries.length} onToggle={() => setAll(!all)} />}
      </ul>
    </section>
  )
}

const ROW = 'sidebar-chat-open block w-full min-w-0 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring'

/** A title with the persisted session state and recency; deletion remains a separate control. */
function ChatRow({ index, chat, active, onOpen, onDelete }: { index: number; chat: AgentSessionSummary; active: boolean; onOpen: () => void; onDelete: AppSidebarProps['onDeleteChat'] }) {
  const { t } = useI18n()
  return (
    <li className="sidebar-chat-row side-in" data-active={active} style={revealStyle(index)}>
      <button type="button" onClick={onOpen} aria-current={active ? 'page' : undefined} className={ROW} title={chat.title}>
        <span className="sidebar-chat-title flex h-5 items-center gap-2">
          <span className="sidebar-chat-label truncate text-[14px] font-normal leading-5">{chat.title || t('New session')}</span>
        </span>
        <span className="sidebar-chat-meta">
          <span className={cn('sidebar-chat-state', chat.state === 'running' && 'text-success', chat.state === 'error' && 'text-destructive')} title={chat.error || undefined}>
            {chat.state === 'running' && <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-current" />}
            {t(chat.state === 'running' ? 'Working' : chat.state === 'error' ? 'Error' : 'Idle')}
          </span>
          <span className="shrink-0 tabular-nums" title={when(chat.updated)}>{ago(chat.updated)}</span>
        </span>
      </button>
      <button type="button" className="sidebar-chat-delete" aria-haspopup="dialog" aria-label={t('Delete conversation {name}', { name: chat.title || t('New session') })} title={t('Delete conversation')} onClick={(event) => onDelete(chat, event.currentTarget)}>
        <X aria-hidden="true" />
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
      <Check aria-hidden="true" className={cn('size-3.5', f === filter ? 'text-(--icon-accent)' : 'invisible')} />
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
