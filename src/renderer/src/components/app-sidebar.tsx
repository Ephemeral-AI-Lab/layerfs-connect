import { projectLabel, type RunSummary } from '@shared/host-api'
import { Check, ChevronDown, ChevronRight, FolderPlus, MessageSquare, Plus, RotateCw, Sparkles, Unplug } from 'lucide-react'
import { type CSSProperties, useEffect, useMemo, useState } from 'react'

import { ConnectMark } from '@/components/connect-mark'
import { LfsProject } from '@/components/lfs-icons'
import { ModelsDialog } from '@/components/models/models-dialog'
import { NewProjectDialog } from '@/components/projects/new-project-dialog'
import { Collapse } from '@/components/motion/collapse'
import { useIndicator } from '@/components/motion/indicator'
import { revealStyle } from '@/components/motion/reveal'
import { RunDot } from '@/components/runs/run-badges'
import { agentColors, ago, isLive, modelLabel, ownProject, projectOf, runLabel } from '@/components/runs/run-format'
import { useRuns } from '@/components/runs/use-runs'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from '@/components/ui/sidebar'
import { HostError, host } from '@/host/client'
import { useHostQuery, useProjects } from '@/host/use-host'
import { cn } from '@/lib/utils'

export type NavId = 'chat' | 'projects' | 'storage' | 'compute'

/**
 * What the sidebar has selected: a page, or one demo project, optionally one
 * of its sessions (`run`, one replay) and an agent of it (`agent`, its root when
 * absent).
 */
/** A project's page, one of its sessions, or (draft) a new conversation on it that has not started yet. */
export type Selection = { kind: 'nav'; id: NavId } | { kind: 'project'; id: string; run?: string; agent?: string; draft?: boolean }

interface NavItem {
  id: NavId
  label: string
  icon: React.ComponentType<{ className?: string }>
  count?: number
}

interface AppSidebarProps {
  selected: Selection
  onSelect: (selection: Selection) => void
}

/** Which sessions the list shows: all of them, or only the playing ones. */
type Filter = 'all' | 'running'

/** Sessions a project lists before "Show all". */
const SHOWN = 5
/** Projects open at first: the ones with the newest sessions (and the selected or a playing one). */
const OPEN_FIRST = 3

/**
 * The sidebar: the pages on top (fixed); below them the sessions, under their
 * projects (it scrolls). The project with the newest session comes first; a
 * project's header opens its page, its + starts a session on it.
 */
export function AppSidebar({ selected, onSelect }: AppSidebarProps) {
  const demos = useHostQuery(() => host.demos(), [])
  const { runs, error: runsError, reload: reloadRuns } = useRuns()
  const ordered = useMemo(() => [...(demos.data ?? [])].sort((a, b) => a.order - b.order), [demos.data])
  // the LayerFS projects in Connect's home, read again whenever one is made or removed anywhere in the app
  const projects = useProjects()
  const [newProject, setNewProject] = useState(false)
  const playing = useMemo(() => new Set((runs ?? []).filter((r) => isLive(r.state)).map(projectOf)), [runs])

  const [filter, setFilter] = useState<Filter>('all')
  // Models opens a dialog, not a page; its row shows the default model (read again when the dialog closes)
  const [modelsOpen, setModelsOpen] = useState(false)
  const models = useHostQuery(() => host.models(), [modelsOpen])
  const defaultModel = models.data?.default
  // each project with its sessions (newest first), the project with the newest session first; never-played ones last
  const groups = useMemo(() => {
    const byDemo = new Map<string, RunSummary[]>()
    for (const r of runs ?? []) {
      if (filter === 'running' && !isLive(r.state)) continue
      const project = projectOf(r)
      byDemo.set(project, [...(byDemo.get(project) ?? []), r])
    }
    // the LayerFS projects in Connect's home (a removed project's sessions are not listed); a scenario's project goes by its title
    const titles = new Map(ordered.map((d) => [d.id, d.title]))
    // layerfs#506: a project of a shared Store goes by `store/name`
    const names = (projects.data ?? []).map((p) => p.key ?? p.name)
    const rows = names.map((id) => ({ demo: { id, title: titles.get(id) ?? projectLabel(id) }, runs: byDemo.get(id) ?? [] }))
    const newest = (g: { runs: RunSummary[] }) => g.runs[0]?.started ?? 0
    return rows.filter((g) => filter === 'all' || g.runs.length).sort((a, b) => newest(b) - newest(a) || a.demo.title.localeCompare(b.demo.title))
  }, [runs, ordered, filter, projects.data])

  // open: the projects with the newest sessions, plus whichever is selected or playing; a toggle wins after that
  const [toggled, setToggled] = useState<Map<string, boolean>>(() => new Map())
  const selectedDemo = selected.kind === 'project' ? selected.id : undefined
  useEffect(() => {
    if (selectedDemo) setToggled((m) => (m.get(selectedDemo) === false ? new Map(m).set(selectedDemo, true) : m))
  }, [selectedDemo])
  const isOpen = (id: string, i: number) => toggled.get(id) ?? (i < OPEN_FIRST || id === selectedDemo || playing.has(id) || filter === 'running')
  const toggle = (id: string, open: boolean) => setToggled((m) => new Map(m).set(id, !open))

  // a new session opens an empty conversation on the project; it starts with the first message
  const start = (project: string) => onSelect({ kind: 'project', id: project, draft: true })

  // one item for the LayerFS page; Projects, Storage and Compute are its tabs (layerfs-tabs.tsx)
  // Chat: the Pi coding agent (chat/); LayerFS: Projects, Storage and Compute as its tabs
  const nav: NavItem[] = [
    { id: 'chat', label: 'Chat', icon: MessageSquare },
    { id: 'projects', label: 'LayerFS', icon: LfsProject, count: projects.data?.length },
  ]
  const unreachable = demos.error ?? (runsError && !runs ? runsError : undefined)

  // one highlight per part, gliding to whichever row is active
  const navGlide = useIndicator<HTMLDivElement>()
  const listGlide = useIndicator<HTMLDivElement>()
  const indicatorClass =
    'indicator rounded-md bg-sidebar-accent shadow-[var(--highlight),var(--elev-1)] ring-1 ring-foreground/[0.05] before:absolute before:inset-y-2 before:-left-px before:w-[3px] before:rounded-full before:bg-brand before:shadow-[0_0_8px_0_var(--glow-strong)] dark:ring-white/[0.04]'

  return (
    <Sidebar collapsible="none" className="h-svh border-r border-sidebar-border">
      <SidebarHeader className="gap-0 px-3 pt-5 pb-0">
        <div className="group/brand flex items-center gap-2.5 px-1.5">
          <span className="relative flex size-10 shrink-0 items-center justify-center">
            <span aria-hidden="true" className="absolute inset-1 rounded-full bg-brand opacity-25 blur-lg transition-opacity duration-(--dur-slow) group-hover/brand:opacity-45 dark:opacity-30" />
            <span className="surface relative flex size-10 items-center justify-center rounded-xl">
              <ConnectMark className="size-7 transition-transform duration-(--dur-slow) ease-out-expo group-hover/brand:scale-[1.06] group-hover/brand:-rotate-3" />
            </span>
          </span>
          <div className="min-w-0 leading-tight">
            <div className="text-[16px] font-semibold tracking-[-0.015em]">LayerFS Connect</div>
            <div className="text-[12px] text-faint">Demo replays on real LayerFS</div>
          </div>
        </div>

        {/* the pages */}
        <div ref={navGlide.container} className="side-tree relative pt-4 pb-3">
          <span ref={navGlide.indicator} aria-hidden="true" className={indicatorClass} />
          <SidebarMenu className="gap-1">
            {nav.map((item) => {
              const active = selected.kind === 'nav' && (item.id === 'chat' ? selected.id === 'chat' : selected.id !== 'chat')
              return (
                <SidebarMenuItem key={item.id}>
                  <SidebarMenuButton
                    isActive={active}
                    onClick={() => onSelect({ kind: 'nav', id: item.id })}
                    className={cn(
                      'h-10 gap-3 px-3 text-[15px] font-medium [&_svg]:size-[18px] [&_svg]:transition-colors [&_svg]:duration-(--dur-base)',
                      active ? '[&_svg]:text-primary' : '[&_svg]:text-muted-foreground',
                    )}
                  >
                    <item.icon />
                    <span className="flex-1">{item.label}</span>
                    {item.count !== undefined && (
                      <span
                        className={cn(
                          'min-w-6 rounded-full px-1.5 text-center text-[11.5px] leading-5 font-medium tabular-nums ring-1 ring-inset transition-colors duration-(--dur-base) animate-in fade-in',
                          active ? 'bg-primary/10 text-primary ring-primary/20' : 'bg-foreground/[0.04] text-faint ring-foreground/[0.05]',
                        )}
                      >
                        {item.count}
                      </span>
                    )}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )
            })}
            <SidebarMenuItem>
              <SidebarMenuButton
                onClick={() => setModelsOpen(true)}
                aria-haspopup="dialog"
                className="h-10 gap-3 px-3 text-[15px] font-medium [&_svg]:size-[18px] [&_svg]:text-muted-foreground"
              >
                <Sparkles />
                <span className="flex-1">Models</span>
                {defaultModel?.usable ? (
                  <span className="max-w-32 truncate text-[11.5px] font-normal text-faint" title={`Default: ${defaultModel.provider}/${defaultModel.model} · thinking ${defaultModel.thinking}`}>
                    {modelLabel(`${defaultModel.provider}/${defaultModel.model}`).text}
                  </span>
                ) : models.data ? (
                  <span className="flex items-center gap-1.5 text-[11.5px] font-normal text-warning" title={defaultModel ? 'The default model has no API key' : 'No default model yet'}>
                    <span aria-hidden="true" className="size-1.5 rounded-full bg-warning" />
                    {defaultModel ? 'No key' : 'Set up'}
                  </span>
                ) : null}
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </div>
        <ModelsDialog open={modelsOpen} onOpenChange={setModelsOpen} />

        {/* the sessions' head: New session, then the list's name and filter */}
        <div className="relative flex flex-col gap-2 pt-3 pb-1 before:absolute before:inset-x-2 before:top-0 before:h-px before:bg-linear-to-r before:from-transparent before:via-sidebar-border before:to-transparent">
          <NewSession projects={groups.map((g) => g.demo)} disabled={!demos.data || !!unreachable} onStart={start} onNewProject={() => setNewProject(true)} />
          <NewProjectDialog
            open={newProject}
            onOpenChange={setNewProject}
            taken={new Set((projects.data ?? []).map((p) => p.name))}
            onCreated={(name) => {
              setNewProject(false)
              onSelect({ kind: 'project', id: name, draft: true })
            }}
          />
          <div className="flex items-center justify-between px-2">
            <span className="text-[11px] font-semibold tracking-[0.08em] text-faint uppercase">Sessions</span>
            <FilterMenu filter={filter} runs={runs ?? []} onChange={setFilter} />
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent className="gap-0 pb-6">
        <div ref={listGlide.container} className="side-tree relative">
          <span ref={listGlide.indicator} aria-hidden="true" className={indicatorClass} />
          <SidebarGroup className="px-3 pt-1">
            {unreachable ? (
              <HostNotice
                title={unreachable instanceof HostError && unreachable.status > 0 ? 'Demos unavailable' : 'Host unreachable'}
                message={unreachable.message}
                onRetry={() => {
                  demos.reload()
                  reloadRuns()
                }}
              />
            ) : !runs || !demos.data || !projects.data ? (
              <SidebarMenu className="gap-0.5">
                {Array.from({ length: 6 }, (_, i) => (
                  <SidebarMenuSkeleton key={i} className="h-9" />
                ))}
              </SidebarMenu>
            ) : !groups.length ? (
              <p className="px-2 py-3 text-xs text-muted-foreground">{filter === 'running' ? 'No session is playing.' : 'No projects yet. New session → New project… makes one.'}</p>
            ) : (
              <SidebarMenu className="gap-0.5">
                {groups.map(({ demo, runs: rows }, i) => {
                  const open = isOpen(demo.id, i)
                  return (
                    <ProjectGroup
                      key={demo.id}
                      index={i}
                      demo={demo}
                      runs={rows}
                      open={open}
                      selected={selected}
                      onToggle={() => toggle(demo.id, open)}
                      onSelect={onSelect}
                      onStart={() => start(demo.id)}
                    />
                  )
                })}
              </SidebarMenu>
            )}
          </SidebarGroup>
        </div>
      </SidebarContent>
    </Sidebar>
  )
}

interface ProjectGroupProps {
  /** Its place in the list, for the entrance stagger. */
  index: number
  /** The project: its LayerFS name, and its scenario's title when a scenario has that name. */
  demo: ProjectRow
  /** The project's sessions, newest first. */
  runs: RunSummary[]
  open: boolean
  selected: Selection
  onToggle: () => void
  onSelect: (selection: Selection) => void
  onStart: () => void
}

/** A project: its header (opens its page; the chevron folds it; + starts a session), and under it its sessions. */
function ProjectGroup({ index, demo, runs, open, selected, onToggle, onSelect, onStart }: ProjectGroupProps) {
  const [all, setAll] = useState(false)
  const live = runs.find((r) => isLive(r.state))
  const here = selected.kind === 'project' && selected.id === demo.id
  const shown = all ? runs : runs.slice(0, SHOWN)
  return (
    <SidebarMenuItem className="side-in group/project" style={revealStyle(index)}>
      <SidebarMenuButton
        isActive={here && !selected.run && !selected.draft}
        onClick={() => {
          onSelect({ kind: 'project', id: demo.id })
          if (!open) onToggle()
        }}
        title={`${demo.title}: open the project`}
        className="h-9 gap-2 pr-14 pl-8 text-[13.5px] font-semibold"
      >
        <span className="min-w-0 flex-1 truncate">{demo.title}</span>
        {live ? (
          <span className="flex items-center gap-1.5 text-[11px] font-medium text-primary" title="A session is playing">
            <span className="text-brand">live</span>
            <RunDot state={live.state} />
          </span>
        ) : (
          <span className="text-[11px] font-normal text-faint tabular-nums group-hover/project:invisible">{runs.length || ''}</span>
        )}
      </SidebarMenuButton>
      <SidebarMenuAction
        onClick={onToggle}
        aria-label={open ? `Hide ${demo.title}'s sessions` : `Show ${demo.title}'s sessions`}
        aria-expanded={open}
        className="top-2 right-auto left-2 text-faint hover:text-foreground"
      >
        <ChevronRight className={cn('size-3.5! transition-transform duration-(--dur-base) ease-out-expo', open && 'rotate-90')} />
      </SidebarMenuAction>
      <SidebarMenuAction
        onClick={onStart}
        aria-label={`New session on ${demo.title}`}
        title={`New session on ${demo.title}: talk with an agent on the project as it is`}
        className="top-2 right-1.5 opacity-0 group-hover/project:opacity-100 focus-visible:opacity-100"
      >
        <Plus className="size-3.5!" />
      </SidebarMenuAction>

      <Collapse open={open} appear={false}>
        <SidebarMenuSub className="mr-0 ml-[15px] gap-0.5 pt-0.5 pr-0">
          {!runs.length && <li className="px-2 py-1 text-xs text-faint">No sessions yet</li>}
          {shown.map((r, i) => (
            <SessionRow key={r.id} index={i} run={r} active={here && selected.run === r.id} onSelect={() => onSelect({ kind: 'project', id: demo.id, run: r.id })} />
          ))}
          {runs.length > SHOWN && (
            <li>
              <button
                type="button"
                onClick={() => setAll(!all)}
                className="flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
              >
                {all ? 'Show fewer' : 'Show all'}
                {!all && <span className="rounded-full bg-foreground/[0.05] px-1.5 text-[11px] leading-4 text-faint tabular-nums">{runs.length}</span>}
              </button>
            </li>
          )}
        </SidebarMenuSub>
      </Collapse>
    </SidebarMenuItem>
  )
}

/** A session's own name: a scenario's folder (and session), a launch's session name, else "Session <n>"; an old run that made its own project goes by that project. */
function sessionTitle(run: RunSummary): string {
  if (run.kind === 'live') return run.title || 'New session'
  if (run.folder) return `/${run.folder}${run.session ? ` · ${run.session}` : ''}`
  if (run.session) return run.session
  return run.replay ? `Session ${run.replay}` : run.project
}

/** One session under its project: its name and time. A playing one breathes and shows its progress. */
function SessionRow({ index, run, active, onSelect }: { index: number; run: RunSummary; active: boolean; onSelect: () => void }) {
  const live = isLive(run.state)
  return (
    <SidebarMenuSubItem className="side-in" style={revealStyle(index)}>
      <SidebarMenuSubButton asChild isActive={active} className={cn('h-8 text-[13px]', live && 'side-live text-foreground')} style={live ? pulseOf(run) : undefined}>
        <button type="button" onClick={onSelect} className="w-full" title={ownProject(run) ? `${runLabel(run)} (its own project)` : runLabel(run)}>
          {live ? <RunningAgents run={run} /> : <RunDot state={run.state} />}
          <span className="min-w-0 flex-1 truncate text-left">{sessionTitle(run)}</span>
          {run.kind !== 'live' && (
            <span className="rounded px-1 text-[10px] font-medium tracking-wide text-faint uppercase ring-1 ring-sidebar-border ring-inset" title="A scenario replay">
              replay
            </span>
          )}
          <span className={cn('text-[11px] tabular-nums', live ? 'font-medium text-primary' : 'text-faint')}>
            {live ? (run.kind === 'live' ? 'working' : run.queued ? 'waiting' : run.of ? `${Math.round((100 * run.done) / run.of)}%` : 'live') : ago(run.ended ?? run.started)}
          </span>
          {live && <span aria-hidden="true" className="side-progress" style={{ '--p': run.of ? run.done / run.of : 0 } as CSSProperties} />}
        </button>
      </SidebarMenuSubButton>
    </SidebarMenuSubItem>
  )
}

/** A project in the list: its LayerFS name and the title shown. */
type ProjectRow = { id: string; title: string }

function NewSession({ projects, disabled, onStart, onNewProject }: { projects: ProjectRow[]; disabled: boolean; onStart: (project: string) => void; onNewProject: () => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button
          type="button"
          className="group/new flex h-9 w-full items-center gap-2 rounded-lg border border-sidebar-border bg-background/60 px-3 text-[13.5px] font-medium shadow-[var(--highlight)] outline-none transition-[border-color,box-shadow,background-color] duration-(--dur-base) hover:border-primary/40 hover:shadow-[0_0_14px_-6px_var(--glow)] focus-visible:ring-2 focus-visible:ring-sidebar-ring disabled:opacity-60 data-[state=open]:border-primary/40"
        >
          <Plus aria-hidden="true" className="size-4 text-muted-foreground transition-transform duration-(--dur-base) ease-out-expo group-hover/new:rotate-90 group-hover/new:text-primary" />
          <span className="flex-1 text-left">New session</span>
          <ChevronDown aria-hidden="true" className="size-3.5 text-faint" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="max-h-96 w-64 overflow-y-auto" align="start">
        <DropdownMenuLabel>Start a session on</DropdownMenuLabel>
        {projects.map((p) => (
          <DropdownMenuItem key={p.id} onSelect={() => onStart(p.id)} title="Talk with an agent on the project as it is">
            <LfsProject className="text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">{p.title}</span>
          </DropdownMenuItem>
        ))}
        {projects.length > 0 && <DropdownMenuSeparator />}
        <DropdownMenuItem onSelect={onNewProject}>
          <FolderPlus className="text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">New project…</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** The list's filter: every session, or only the playing ones. */
function FilterMenu({ filter, runs, onChange }: { filter: Filter; runs: RunSummary[]; onChange: (f: Filter) => void }) {
  const running = runs.filter((r) => isLive(r.state)).length
  const item = (f: Filter, text: string, n: number) => (
    <DropdownMenuItem onSelect={() => onChange(f)}>
      <Check aria-hidden="true" className={cn('size-3.5', f === filter ? 'text-primary' : 'invisible')} />
      <span className="min-w-0 flex-1 truncate">{text}</span>
      <span className="text-[11px] text-faint tabular-nums">{n}</span>
    </DropdownMenuItem>
  )
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            'flex items-center gap-1 rounded px-1.5 py-0.5 text-[11.5px] outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring',
            filter === 'all' ? 'text-muted-foreground' : 'font-medium text-primary',
          )}
          aria-label={`Show sessions: ${filter === 'all' ? 'All' : 'Running'}`}
        >
          {filter === 'all' ? 'All' : 'Running'}
          <ChevronDown aria-hidden="true" className="size-3 shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-44" align="end">
        {item('all', 'All sessions', runs.length)}
        {item('running', 'Running', running)}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function HostNotice({ title, message, onRetry }: { title: string; message: string; onRetry: () => void }) {
  return (
    <div role="status" className="reveal mx-1 flex flex-col gap-1.5 rounded-lg border border-dashed border-warning/30 bg-warning/[0.04] px-3 py-2.5">
      <span className="flex items-center gap-1.5 text-[13px] font-medium text-foreground">
        <Unplug aria-hidden="true" className="size-3.5 text-warning" />
        {title}
      </span>
      <span className="line-clamp-3 text-xs text-muted-foreground" title={message}>
        {message}
      </span>
      <button
        type="button"
        onClick={onRetry}
        className="flex w-fit items-center gap-1 text-xs font-medium text-primary outline-none hover:underline focus-visible:underline"
      >
        <RotateCw aria-hidden="true" className="size-3" /> Retry
      </button>
    </div>
  )
}

/** A CSS colour from an agent's dot class: "bg-agent-builder" → var(--agent-builder), "bg-(--lane-3)" → var(--lane-3). */
const cssColor = (dot: string) => {
  const v = dot.match(/^bg-\((--[\w-]+)\)$/)
  return v ? `var(${v[1]})` : `var(--${dot.slice(3)})`
}

/** A playing session's row breathes in its first running agent's colour. */
function pulseOf(run: RunSummary): CSSProperties | undefined {
  const colorOf = agentColors(run.agents.map((a) => a.name))
  const first = run.agents.find((a) => a.state === 'running')
  return first ? ({ '--pulse': cssColor(colorOf(first.name).dot) } as CSSProperties) : undefined
}

/** A playing session's running agents, a pulsing dot each in its colour (at most three). */
function RunningAgents({ run }: { run: RunSummary }) {
  const colorOf = agentColors(run.agents.map((a) => a.name))
  const running = run.agents.filter((a) => a.state === 'running')
  if (!running.length) return <RunDot state={run.state} />
  return (
    <span role="img" aria-label={`${running.length} running`} title={running.map((a) => a.name).join(', ')} className="flex shrink-0 items-center gap-[3px]">
      {running.slice(0, 3).map((a) => {
        const c = colorOf(a.name)
        return <span key={a.name} className={cn('pulse-ring size-1.5 rounded-full', c.dot, c.text)} />
      })}
    </span>
  )
}
