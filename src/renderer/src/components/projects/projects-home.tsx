import './home.css'

import { FolderPlus, FolderSearch, Search, X } from 'lucide-react'
import { useCallback, useLayoutEffect, useMemo, useState } from 'react'

import { revealStyle } from '@/components/motion/reveal'
import { type LayerFSPart, LayerFSTabs } from '@/components/layerfs-tabs'
import { PageHeader } from '@/components/motion/page-header'
import { type CardFacts, type CardProject, ProjectCard } from '@/components/projects/home/project-card'
import { NewProjectDialog } from '@/components/projects/new-project-dialog'
import { StatsStrip } from '@/components/projects/home/stats-strip'
import { useFlip } from '@/components/projects/home/use-flip'
import { Empty, LoadError } from '@/components/projects/states'
import { isLive, plural, projectOf } from '@/components/runs/run-format'
import { useRuns } from '@/components/runs/use-runs'
import { Chip } from '@/components/storage/chips'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { bytes } from '@/data/format'
import { host } from '@/host/client'
import { useHostQuery, useProjects } from '@/host/use-host'
import { projectLabel, type RunSummary } from '@shared/host-api'

const GRID = 'grid grid-cols-[repeat(auto-fill,minmax(min(24rem,100%),1fr))] gap-5'

interface ProjectsHomeProps {
  onOpenProject: (project: string) => void
  onOpenRun: (runId: string) => void
  /** Opens a new conversation on the project (it starts with its first message). */
  onNewSession: (project: string) => void
  /** Opens another part of the LayerFS page (Storage, Compute). */
  onPart?: (part: LayerFSPart) => void
}

/** Every LayerFS project in Connect's home, one card each; New project makes one, empty or from a folder. */
export function ProjectsHome({ onOpenProject, onNewSession, onPart }: ProjectsHomeProps) {
  const [query, setQuery] = useState('')
  const demos = useHostQuery(() => host.demos(), [])
  const projects = useProjects()
  const { runs } = useRuns()
  const [creating, setCreating] = useState(false)

  // What each card read about its project, summed in the strip.
  const [facts, setFacts] = useState<Record<string, CardFacts>>({})
  const onFacts = useCallback(
    (project: string, f: CardFacts) =>
      setFacts((all) => (all[project]?.commits === f.commits && all[project]?.bytes === f.bytes ? all : { ...all, [project]: f })),
    [],
  )

  // Cards that stay glide to their new places as the search narrows or widens.
  const flip = useFlip<HTMLDivElement>()
  const search = (next: string) => {
    flip.snapshot()
    setQuery(next)
  }

  // each project with its sessions (newest first); a project named after a scenario shows that scenario's title
  const cards = useMemo(
    () =>
      (projects.data ?? []).map((p) => {
        // layerfs#506: a project of a shared Store goes by `store/name`; its name may be in other Stores too
        const id = p.key ?? p.name
        const scenario = p.shared ? undefined : demos.data?.find((d) => d.id === p.name)
        const mine = (runs ?? []).filter((r) => projectOf(r) === id)
        const empty = !p.source || /[\\/]empty-project$/.test(p.source)
        const project: CardProject = {
          id,
          title: scenario?.title ?? projectLabel(id),
          blurb:
            scenario?.blurb ??
            // layerfs#506: a project imported into PostgreSQL or cloned from a remote has no source folder
            (p.shared && !p.source
              ? p.kind === 'postgresql'
                ? `Imported into the PostgreSQL Store ${p.store}.`
                : `A copy in the Store ${p.store}.`
              : empty
                ? 'An empty project.'
                : `Imported from ${p.source}`),
          kind: p.kind ?? null,
          agents: scenario ? scenario.agents.length : null,
          runs: mine.length,
        }
        return { project, latest: mine[0] ?? null, tags: scenario?.tags ?? [] }
      }),
    [projects.data, demos.data, runs],
  )
  const q = query.trim().toLowerCase()
  useLayoutEffect(flip.play, [q, flip.play])
  const shown = cards.filter((c) => !q || `${c.project.id} ${c.project.title} ${c.project.blurb ?? ''} ${c.tags.join(' ')}`.toLowerCase().includes(q))
  const playing = cards.map((c) => c.latest).filter((l): l is RunSummary => !!l && isLive(l.state))
  const live = playing.length

  const known = Object.values(facts)
  const commits = projects.data && known.length > 0 ? known.reduce((n, f) => n + f.commits, 0) : null
  const stored = known.reduce((n, f) => n + (f.bytes ?? 0), 0)
  const agentsRunning = playing.reduce((n, r) => n + r.agents.filter((a) => a.state === 'running').length, 0)
  const sessions = cards.reduce((n, c) => n + c.project.runs, 0)
  const newProject = (
    <Button size="sm" onClick={() => setCreating(true)}>
      <FolderPlus /> New project
    </Button>
  )

  return (
    <div className="h-svh overflow-y-auto">
      <PageHeader
        sticky
        width="max-w-6xl"
        size="md"
        title="LayerFS"
        tabs={<LayerFSTabs current="projects" onPick={onPart} />}
        badges={live > 0 && <Chip tone="info" live>{live} playing</Chip>}
        description="Projects in Connect's home. A session works with an agent on one; /scenario plays a scenario there in a folder of its own."
        actions={
          <div className="flex items-center gap-2">
          {newProject}
          <div className="group/search relative w-64 shrink-0">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-faint transition-colors group-focus-within/search:text-primary"
            />
            <Input
              aria-label="Search projects"
              placeholder="Search projects"
              value={query}
              onChange={(e) => search(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && query && (e.preventDefault(), search(''))}
              className="bg-card/70 pr-16 pl-8 shadow-[var(--highlight),var(--elev-1)] backdrop-blur-sm"
            />
            {q && projects.data && (
              <span className="home-count absolute top-1/2 right-1.5 flex -translate-y-1/2 items-center gap-1">
                <span aria-live="polite" className="text-[11px] text-faint tabular-nums">
                  {shown.length} of {cards.length}
                </span>
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={() => search('')}
                  className="flex size-5 items-center justify-center rounded text-faint outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X className="size-3" />
                </button>
              </span>
            )}
          </div>
          </div>
        }
      />
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-8 pt-2 pb-12">
        <NewProjectDialog
          open={creating}
          onOpenChange={setCreating}
          taken={new Set((projects.data ?? []).map((p) => p.name))}
          onCreated={(name) => {
            setCreating(false)
            onNewSession(name)
          }}
        />

        {!projects.error && (
          <StatsStrip
            stats={[
              {
                label: 'Projects',
                value: projects.data ? cards.length : null,
                note: projects.data ? 'In Connect\'s LayerFS home' : 'Reading',
              },
              {
                label: 'Sessions',
                value: projects.data && runs ? sessions : null,
                note: 'On these projects',
              },
              {
                label: 'Playing now',
                value: projects.data ? live : null,
                live: live > 0,
                note: live > 0 ? `${plural(agentsRunning, 'agent')} running` : 'Nothing playing',
              },
              {
                label: 'Commits',
                value: commits,
                note: commits === null ? 'Reading the projects' : `${bytes(stored)} of Store`,
              },
            ]}
          />
        )}

        {!projects.data ? (
          projects.error ? (
            <LoadError error={projects.error} what="the LayerFS projects" onRetry={projects.reload} />
          ) : (
            <div className={GRID} aria-busy="true" aria-label="Loading projects">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} className="reveal h-64 rounded-xl" style={revealStyle(i)} />
              ))}
            </div>
          )
        ) : shown.length === 0 ? (
          cards.length === 0 ? (
            <Empty icon={FolderSearch} title="No projects yet" action={newProject}>
              Make one, empty or from a folder. Or open a session on a new project and type /scenario to start it from a scenario.
            </Empty>
          ) : (
            <Empty
              icon={FolderSearch}
              title="No projects match"
              action={
                <Button variant="outline" size="sm" onClick={() => search('')}>
                  Clear search
                </Button>
              }
            >
              Nothing matches “{query.trim()}”. Search by name or tag.
            </Empty>
          )
        ) : (
          <div ref={flip.container} className={GRID}>
            {shown.map((c, i) => (
              <ProjectCard
                key={c.project.id}
                demo={c.project}
                index={i}
                latest={c.latest}
                starting={false}
                onOpen={() => onOpenProject(c.project.id)}
                onNewSession={() => onNewSession(c.project.id)}
                onFacts={onFacts}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
