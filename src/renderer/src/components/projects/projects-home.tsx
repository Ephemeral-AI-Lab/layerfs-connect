import { t, useI18n } from '@/i18n'
import { FolderOpen, FolderSearch, Plus, RotateCw, Search, X } from 'lucide-react'
import { type ReactNode, useMemo, useState } from 'react'
import { projectKey } from '@shared/host-api'

import { PageHeader } from '@/components/motion/page-header'
import { revealStyle } from '@/components/motion/reveal'
import { type ProjectChats, type ProjectRowData, ProjectTable } from '@/components/projects/home/project-table'
import { Empty, LoadError } from '@/components/projects/states'
import { SimulatedNote, SimulationPicker, useSimulation } from '@/components/simulation'
import { storeFacts, useStorageView } from '@/components/projects/store-facts'
import { MachineChip, runsOn, sandboxesByProject, StoreChip, useMachinesView } from '@/components/projects/where-chips'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { SIMULATIONS } from '@/data/compute-sim'
import { toMs } from '@/data/format'
import { simProjects, simStorage } from '@/data/home-sim'
import type { ProjectCatalog } from '@/host/use-projects'
import { chatLive, chatProject, useChatSessions } from '@/host/use-chat-sessions'
import { useNow } from '@/lib/use-now'
import { cn } from '@/lib/utils'

type Sort = 'recent' | 'name'
/** How the list is grouped: not at all, by the Store each project is stored in, or by each machine it runs on (a project running on two shows under both). */
type Group = 'none' | 'store' | 'machine'
/** The machine group of projects with no Sandbox. */
const IDLE = '\u0000idle'

interface RowGroup {
  key: string
  /** The group's heading: a Store or machine link, or "Not running". */
  head: ReactNode
  rows: ProjectRowData[]
}

/** The shown rows in groups, each group in the rows' order, groups by their first row. */
function groupRows(rows: ProjectRowData[], group: Group, t: (s: string, v?: Record<string, string | number>) => string): RowGroup[] {
  if (group === 'none') return [{ key: 'all', head: null, rows }]
  const by = new Map<string, ProjectRowData[]>()
  const add = (key: string, row: ProjectRowData) => by.set(key, [...(by.get(key) ?? []), row])
  for (const row of rows) {
    if (group === 'store') add(row.facts.name, row)
    else if (!row.runs?.length) add(IDLE, row)
    else for (const r of row.runs) add(r.machine, row)
  }
  // "Not running" last
  const keys = [...by.keys()].sort((a, b) => Number(a === IDLE) - Number(b === IDLE))
  return keys.map((key) => {
    const first = by.get(key)![0]
    const head = group === 'store' ? (
      <>
        <StoreChip store={key} />
        <span className="text-xs text-muted-foreground">{first.facts.family === 'postgresql' ? t('PostgreSQL') : first.facts.machine ? t('SQLite · file on {machine}', { machine: first.facts.machine }) : t('SQLite')}</span>
      </>
    ) : key === IDLE ? <span className="text-xs font-medium text-muted-foreground">{t('Not running')}</span> : <MachineChip machine={key} />
    return { key, head, rows: by.get(key)! }
  })
}

interface ProjectsHomeProps {
  projects: ProjectCatalog
  onOpenProject: (project: string) => void
  onNewProject: () => void
}

export function ProjectsHome({ projects, onOpenProject, onNewProject }: ProjectsHomeProps) {
  useI18n()
  const [query, setQuery] = useState('')
  const [group, setGroup] = useState<Group>('none')
  const [sort, setSort] = useState<Sort>('recent')
  const search = setQuery
  // dev builds: a simulated host (shared with Machines and Storage); its sample projects open on sample content
  const simId = useSimulation()
  const simulated = simId ? SIMULATIONS[simId] : null
  const liveStorage = useStorageView()
  const liveChats = useChatSessions('projects-home').sessions
  const storage = simulated ? simStorage(simulated) : liveStorage
  const sessions = simulated ? simulated.chats : liveChats
  const data = simulated ? simProjects(simulated) : projects.data
  const error = simulated ? undefined : projects.error
  // where each project runs: its Sandboxes, on any machines
  const machines = useMachinesView(simulated?.view ?? null)
  const sandboxes = useMemo(() => sandboxesByProject(machines), [machines])

  // each project's open chats: how many, how many work, and the newest activity
  const chats = useMemo(() => {
    const by = new Map<string, ProjectChats>()
    for (const chat of sessions ?? []) {
      const key = chatProject(chat)
      if (!key || chat.archived) continue
      const c = by.get(key) ?? { count: 0, working: 0, updated: null }
      c.count++
      if (chatLive(chat)) c.working++
      c.updated = Math.max(c.updated ?? 0, chat.updated)
      by.set(key, c)
    }
    return by
  }, [sessions])
  const working = [...chats.values()].some((c) => c.working > 0)
  const now = useNow(true, working ? 5000 : 30_000)

  const all = data ?? []
  const rows: ProjectRowData[] = all.map((project) => {
    const c = chats.get(projectKey(project))
    const key = projectKey(project)
    return { project, facts: storeFacts(project, storage), chats: c, runs: sandboxes ? runsOn(sandboxes.get(key)) : null, activity: c?.updated ?? toMs(project.created) }
  })
  const q = query.trim().toLowerCase()
  const shown = rows
    .filter(({ project, runs }) => !q || `${project.name} ${project.store} ${runs?.map((r) => r.machine).join(' ') ?? ''}`.toLowerCase().includes(q))
    .sort((a, b) => (sort === 'recent' ? (b.activity ?? 0) - (a.activity ?? 0) : 0) || a.project.name.localeCompare(b.project.name) || a.project.key.localeCompare(b.project.key))
  const groups = groupRows(shown, sandboxes ? group : group === 'machine' ? 'none' : group, t)
  const clear = () => setQuery('')

  return (
    <div className="h-svh overflow-y-auto">
      <PageHeader
        sticky
        width="max-w-6xl"
        title={t("Projects")}
        description={t("Each project is stored in one Store and runs in Sandboxes on any of your machines.")}
        actions={
          <div className="flex w-full min-w-0 flex-wrap items-center gap-2.5">
            <SimulationPicker />
            <div className="group/search relative min-w-40 flex-1 basis-52">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 left-3 z-10 size-3.5 -translate-y-1/2 text-muted-foreground transition-colors group-focus-within/search:text-(--icon-accent)"
              />
              <Input
                aria-label={t("Search projects")}
                placeholder={t("Search projects")}
                value={query}
                onChange={(e) => search(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape' && query) {
                    e.preventDefault()
                    search('')
                  }
                }}
                className="glass h-9 rounded-full pl-9 pr-9 text-sm shadow-xs focus-visible:ring-primary/40"
              />
              {query && (
                <button
                  type="button"
                  aria-label={t("Clear search")}
                  onClick={() => search('')}
                  className="absolute top-1/2 right-2 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X className="size-3" />
                </button>
              )}
            </div>
            <Button variant="outline" size="sm" className="h-9 rounded-full px-3.5 text-xs shadow-xs" disabled={projects.loading || !!simulated} onClick={projects.reload}>
              <RotateCw className={projects.loading ? 'size-3.5 animate-spin' : 'size-3.5'} />{t("Refresh")}</Button>
            <Button size="sm" className="h-9 rounded-full px-3.5 text-xs" disabled={!!simulated} onClick={onNewProject}><Plus className="size-3.5" />{t("New project")}</Button>
          </div>
        }
      />
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-6 pt-2 pb-12 @min-[56rem]/workspace:px-8">
        {simulated && <SimulatedNote sim={simulated} />}
        {error ? (
          <LoadError error={error} what={t("the projects")} onRetry={projects.reload} />
        ) : !data ? (
          <div className="flex flex-col gap-2" aria-busy="true" aria-label={t("Loading projects")}>
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="reveal h-12 rounded-xl" style={revealStyle(i)} />
            ))}
          </div>
        ) : all.length === 0 ? (
          <Empty icon={FolderOpen} title={t("No projects yet")} className="rounded-2xl py-16" action={<Button size="sm" className="rounded-xl" onClick={onNewProject}><Plus className="size-3.5" />{t("Create project")}</Button>}>{t("Start with an empty workspace or import an existing folder.")}</Empty>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-1">
              <div role="group" aria-label={t("Group")} className="flex min-w-0 flex-wrap items-center gap-1.5">
                <span className="mr-0.5 text-xs text-muted-foreground">{t("Group")}</span>
                <Pill active={group === 'none'} onClick={() => setGroup('none')}>{t("None")}<span className="tabular-nums opacity-70">{all.length}</span></Pill>
                <Pill active={group === 'store'} onClick={() => setGroup('store')}>{t("By Store")}</Pill>
                {sandboxes && <Pill active={group === 'machine'} onClick={() => setGroup('machine')}>{t("By machine")}</Pill>}
              </div>
              <div role="group" aria-label={t("Sort")} className="ml-auto flex items-center gap-1.5">
                <span className="mr-0.5 text-xs text-muted-foreground">{t("Sort")}</span>
                <Pill active={sort === 'recent'} onClick={() => setSort('recent')}>{t("Recent")}</Pill>
                <Pill active={sort === 'name'} onClick={() => setSort('name')}>{t("Name")}</Pill>
              </div>
            </div>
            <p aria-live="polite" className="sr-only">
              {shown.length < all.length ? t("{value1} of {value2} projects", {value1: shown.length, value2: all.length}) : t(all.length === 1 ? '{count} project' : '{count} projects', {count: all.length})}
            </p>
            {shown.length === 0 ? (
              <Empty
                icon={FolderSearch}
                title={t("No projects match")}
                action={<Button variant="outline" size="sm" onClick={clear}>{t("Clear search")}</Button>}
                className="rounded-2xl"
              >{q ? <>{t("Nothing matches “")}{query.trim()}{t("”. Search by name, Store or machine.")}</> : null}</Empty>
            ) : (
              groups.map((g) => (
                <section key={g.key} aria-label={g.head ? undefined : t('Projects')} className="flex flex-col gap-2">
                  {g.head && (
                    <h2 className="flex min-w-0 items-center gap-2 px-1 pt-1">
                      {g.head}
                      <span className="text-xs tabular-nums text-faint">{g.rows.length}</span>
                    </h2>
                  )}
                  <ProjectTable rows={g.rows} now={now} onOpen={onOpenProject} />
                </section>
              ))
            )}
          </>
        )}
      </div>
    </div>
  )
}

function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs outline-none ring-1 ring-inset transition-colors focus-visible:ring-2 focus-visible:ring-ring',
        active ? 'bg-foreground/[0.08] font-medium text-foreground ring-foreground/15' : 'text-muted-foreground ring-foreground/[0.07] hover:bg-foreground/[0.04] hover:text-foreground',
      )}
    >
      {children}
    </button>
  )
}
