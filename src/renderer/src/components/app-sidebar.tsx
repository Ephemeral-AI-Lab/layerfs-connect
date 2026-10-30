import { Check, ChevronDown, ChevronRight, Cpu, FolderClosed, FolderOpen, Hourglass, Laptop, MessageSquare, Plus, RefreshCw, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { AgentSessionSummary } from '@shared/agent-api'
import { projectKey, projectRef, type ProjectSummary, type RunSummary } from '@shared/host-api'

import { ConnectMark } from '@/components/connect-mark'
import { LanguageSwitcher } from '@/components/language-switcher'
import { LfsProject, LfsStore } from '@/components/lfs-icons'
import { Collapse } from '@/components/motion/collapse'
import { useIndicator } from '@/components/motion/indicator'
import { revealStyle } from '@/components/motion/reveal'
import { useDemos } from '@/components/projects/scenario-picker'
import { RunDot, StateDot } from '@/components/runs/run-badges'
import { ago, duration, isLive, plural, runName } from '@/components/runs/run-format'
import { useNow } from '@/components/runs/use-run'
import { useRuns } from '@/components/runs/use-runs'
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
} from '@/components/ui/sidebar'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { agentHost } from '@/host/agent-client'
import { onHostEvent } from '@/host/client'
import type { ProjectCatalog } from '@/host/use-projects'
import { cn } from '@/lib/utils'
import { useI18n } from '@/i18n'

export type NavId = 'chat' | 'projects' | 'storage' | 'compute'
/**
 * A page (Chat with the conversation open on it, if any), or a project by its
 * key (projectKey: `store/name` in a shared Store), and maybe one of its
 * scenario runs and an agent of it.
 */
export type Selection = { kind: 'nav'; id: NavId; session?: string } | { kind: 'project'; id: string; run?: string; agent?: string }

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

/** The project and session list under the pages: off for now (owner, 2026-10-31). */
const SHOW_PROJECT_TREE = false

/** Which sessions the list shows: all of them, or only the working ones. */
type Filter = 'all' | 'running'
/** Sessions a project lists before "Show all". */
const SHOWN = 5
/** Projects open at first: the ones with the newest sessions (and the selected or a playing one). */
const OPEN_FIRST = 3

/** A project's session: a chat conversation on it, or a scenario run. */
type Entry = { kind: 'chat'; at: number; chat: AgentSessionSummary } | { kind: 'run'; at: number; run: RunSummary }

const chatLive = (c: AgentSessionSummary) => c.state === 'running' || c.execution?.phase === 'children'
const entryLive = (e: Entry) => (e.kind === 'chat' ? chatLive(e.chat) : isLive(e.run.state))
const entryKey = (e: Entry) => (e.kind === 'chat' ? `c:${e.chat.id}` : `r:${e.run.id}`)

/** The agent harness's conversations, kept current from the host's `chat` events; archived ones left out. */
function useChatSessions(tick: unknown) {
  const [sessions, setSessions] = useState<AgentSessionSummary[]>()
  useEffect(() => {
    let live = true
    agentHost.sessions().then((all) => live && setSessions(all), () => live && setSessions((s) => s ?? []))
    return () => { live = false }
  }, [tick])
  useEffect(() => onHostEvent((event) => {
    if (event.type !== 'chat') return
    const { messages: _m, queued: _q, tools: _t, children: _c, approvals: _a, ...summary } = event.session
    setSessions((all) => {
      if (!all) return all
      const i = all.findIndex((s) => s.id === summary.id)
      if (i >= 0 && all[i].updated > summary.updated) return all
      return i < 0 ? [summary, ...all] : all.map((s, j) => (j === i ? summary : s))
    })
  }), [])
  return useMemo(() => sessions?.filter((s) => !s.archived), [sessions])
}

interface AppSidebarProps {
  selected: Selection
  projects: ProjectCatalog
  onSelect: (selection: Selection) => void
  onNewProject: () => void
  onDeleteProject: (project: ProjectSummary) => void
  /** Opens a chat conversation on the Chat page. */
  onOpenChat: (session: string) => void
  /** A new chat on project `project`, or on a local folder when it is ''. */
  onNewChat: (project: string) => void
}

export function AppSidebar({ selected, projects, onSelect, onNewProject, onDeleteProject, onOpenChat, onNewChat }: AppSidebarProps) {
  const { t } = useI18n()
  const { container, indicator } = useIndicator<HTMLDivElement>()
  const isMac = window.connect.platform === 'darwin'
  const activePage = selected.kind === 'nav' && selected.id !== 'chat' ? selected.id : undefined

  return (
    <Sidebar collapsible="none" className="sidebar-glass relative z-10 h-svh shrink-0">
      <SidebarHeader className={cn('px-3 pb-3 app-drag', isMac ? 'pt-11' : 'pt-4')}>
        <div className="group/brand flex items-center gap-2.5 px-1.5 app-no-drag">
          <span className="glass-liquid relative flex size-9.5 shrink-0 items-center justify-center rounded-xl">
            <ConnectMark className="size-6 transition-transform duration-(--dur-slow) ease-out-expo group-hover/brand:scale-[1.05]" />
          </span>
          <span className="min-w-0 text-[15px] font-semibold leading-tight tracking-[-0.015em] text-foreground">LayerFS Connect</span>
        </div>
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
                        onClick={() => onSelect({ kind: 'nav', id: item.id })}
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
        <ProjectList selected={selected} projects={projects} onSelect={onSelect} onNewProject={onNewProject} />
        {SHOW_PROJECT_TREE && <ProjectTree selected={selected} projects={projects} onSelect={onSelect} onNewProject={onNewProject} onDeleteProject={onDeleteProject} onOpenChat={onOpenChat} onNewChat={onNewChat} />}
      </SidebarContent>
      <SidebarFooter className="shrink-0 border-t border-foreground/[0.06] px-3 py-2">
        <LanguageSwitcher />
      </SidebarFooter>
    </Sidebar>
  )
}

/**
 * The Projects section: its heading opens the Projects page, + makes a new
 * project, and each project is a row with the LayerFS mark (a shared Store's
 * name faint after it, a dot while a scenario plays). It sits under
 * Resources and fills the rest of the column; the list scrolls.
 */
function ProjectList({ selected, projects, onSelect, onNewProject }: Pick<AppSidebarProps, 'selected' | 'projects' | 'onSelect' | 'onNewProject'>) {
  const { t } = useI18n()
  const items = projects.data ?? []
  const { runs } = useRuns()
  const playing = useMemo(() => new Set((runs ?? []).filter((r) => isLive(r.state) && !r.queued).map((r) => r.project)), [runs])
  const onPage = selected.kind === 'nav' && selected.id === 'projects'
  return (
    <SidebarGroup aria-label={t('Projects')} className="flex min-h-0 flex-1 flex-col px-3 pt-3 pb-0">
      <div className="flex shrink-0 items-center gap-1 pr-1">
        <button
          type="button"
          aria-current={onPage ? 'page' : undefined}
          title={t('All projects')}
          onClick={() => onSelect({ kind: 'nav', id: 'projects' })}
          className={cn(
            'flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-3 text-left text-[11px] font-semibold tracking-wider uppercase transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring',
            onPage ? 'text-foreground' : 'text-muted-foreground',
          )}
        >
          {t('Projects')}
          {items.length > 0 && <span className="text-[10px] font-medium tabular-nums tracking-normal">{items.length}</span>}
        </button>
        <button type="button" aria-label={t('New project')} title={t('New project')} onClick={onNewProject} className="flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/[0.04] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
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
              return (
                <SidebarMenuItem key={key} className="side-in" style={revealStyle(i)}>
                  <SidebarMenuButton
                    type="button"
                    isActive={active}
                    aria-current={active ? 'page' : undefined}
                    title={store ? t('{name} in Store {store}', { name: project.name, store }) : project.name}
                    onClick={() => onSelect({ kind: 'project', id: key })}
                    className={cn(
                      'h-10 gap-3 border px-3 text-[14px] [&_svg]:size-[18px]',
                      active
                        ? 'glass-liquid border-white/80 font-semibold text-foreground shadow-xs dark:border-white/15'
                        : 'border-transparent font-medium text-foreground/80 hover:text-foreground',
                    )}
                  >
                    <LfsProject className={active ? undefined : 'opacity-80'} />
                    <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
                      <span className="truncate">{project.name}</span>
                      {store && <span className="min-w-0 truncate text-[11px] font-normal text-muted-foreground">{store}</span>}
                    </span>
                    {playing.has(key) && (
                      <span role="img" aria-label={t('A scenario is playing')} title={t('A scenario is playing')} className="pulse-ring size-1.5 shrink-0 rounded-full bg-primary text-primary" />
                    )}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )
            })}
          </SidebarMenu>
        )}
      </div>
    </SidebarGroup>
  )
}

/** The projects with their sessions (chats and scenario runs) and the local chats. */
function ProjectTree({ selected, projects, onSelect, onNewProject, onDeleteProject, onOpenChat, onNewChat }: AppSidebarProps) {
  const { t } = useI18n()
  const items = useMemo(() => projects.data ?? [], [projects.data])
  const { runs } = useRuns()
  // a new or removed conversation shows on the next page change too
  const chats = useChatSessions(selected.kind === 'nav' ? `${selected.id}:${selected.session ?? ''}` : selected.id)
  const demos = useDemos()
  const titleOf = useMemo(() => new Map((demos.data ?? []).map((d) => [d.id, d.title])), [demos.data])
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
    for (const c of chats ?? []) add(c.project, { kind: 'chat', at: c.updated, chat: c })
    for (const r of runs ?? []) add(r.project, { kind: 'run', at: r.started, run: r })
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
  }, [chats, runs, items, filter])
  const working = (chats ?? []).filter(chatLive).length + (runs ?? []).filter((r) => isLive(r.state)).length
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
                  titleOf={titleOf}
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
  /** Its chat conversations and scenario runs, newest first. */
  entries: Entry[]
  open: boolean
  selected: Selection
  /** The conversation open on the Chat page. */
  openChat?: string
  now: number
  titleOf: Map<string, string>
  onToggle: () => void
  onSelect: (selection: Selection) => void
  onOpenChat: (session: string) => void
  onNewChat: () => void
  onDelete: () => void
}

/** A project: its row (opens its page; the chevron folds it; + starts a chat; × deletes it), and under it its sessions. */
function ProjectGroup({ index, project, projectKey: key, entries, open, selected, openChat, now, titleOf, onToggle, onSelect, onOpenChat, onNewChat, onDelete }: ProjectGroupProps) {
  const { t } = useI18n()
  const [all, setAll] = useState(false)
  // a project in a shared Store also names its Store, faint after its name
  const store = projectRef(key).store
  const here = selected.kind === 'project' && selected.id === key
  const active = here && !selected.run
  const playing = entries.some((e) => e.kind === 'run' && isLive(e.run.state) && !e.run.queued)
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
        {playing ? (
          <span role="img" aria-label={t('A scenario is playing')} title={t('A scenario is playing')} className="pulse-ring size-1.5 shrink-0 rounded-full bg-primary text-primary group-hover/project:invisible" />
        ) : entries.length > 0 ? (
          <span className="text-[11px] text-muted-foreground tabular-nums group-hover/project:invisible">{entries.length}</span>
        ) : null}
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
          {shown.map((entry, i) =>
            entry.kind === 'chat' ? (
              <ChatRow key={entryKey(entry)} index={i} chat={entry.chat} active={openChat === entry.chat.id} now={now} onOpen={() => onOpenChat(entry.chat.id)} />
            ) : (
              <RunRow
                key={entryKey(entry)}
                index={i}
                run={entry.run}
                title={titleOf.get(entry.run.demo) ?? entry.run.demo}
                active={here && selected.run === entry.run.id}
                now={now}
                onOpen={() => onSelect({ kind: 'project', id: key, run: entry.run.id })}
              />
            ),
          )}
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
        {shown.map((entry, i) => entry.kind === 'chat' && <ChatRow key={entryKey(entry)} index={i} chat={entry.chat} active={openChat === entry.chat.id} now={now} onOpen={() => onOpenChat(entry.chat.id)} />)}
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

/** A scenario run: its scenario and name, a RunDot (waiting while queued), its agents and duration. */
function RunRow({ index, run, title, active, now, onOpen }: { index: number; run: RunSummary; title: string; active: boolean; now: number; onOpen: () => void }) {
  const { t } = useI18n()
  const live = isLive(run.state)
  const meta = [
    runName(run),
    run.agents.length ? plural(run.agents.length, 'agent') : null,
    run.queued ? t('waiting') : live ? (run.of ? `${run.done}/${run.of}` : t('playing')) : duration((run.ended ?? now) - run.started),
  ]
  return (
    <li>
      <button type="button" onClick={onOpen} aria-current={active ? 'page' : undefined} className={cn(ROW, rowTone(active))} style={revealStyle(index)} title={`${title} · ${runName(run)}`}>
        <span className="mt-[5px] flex">
          {run.queued ? <Hourglass role="img" aria-label={t('Queued')} className="-m-0.5 size-3 text-muted-foreground" /> : <RunDot state={run.state} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className={cn('block truncate text-[12.5px]', active ? 'font-medium text-foreground' : 'text-foreground/85')}>{title}</span>
          <span className={cn('block truncate text-[11px] tabular-nums', live && !run.queued ? 'text-primary' : 'text-muted-foreground')}>{meta.filter(Boolean).join(' · ')}</span>
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
