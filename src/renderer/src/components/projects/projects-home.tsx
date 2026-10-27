import './home.css'

import { FolderSearch, Search, TriangleAlert, X } from 'lucide-react'
import { useCallback, useLayoutEffect, useState } from 'react'

import { revealStyle } from '@/components/motion/reveal'
import { PageHeader } from '@/components/motion/page-header'
import { type CardFacts, ProjectCard } from '@/components/projects/home/project-card'
import { StatsStrip } from '@/components/projects/home/stats-strip'
import { useFlip } from '@/components/projects/home/use-flip'
import { Empty, LoadError } from '@/components/projects/states'
import { isLive, plural } from '@/components/runs/run-format'
import { useStartRun } from '@/components/runs/use-runs'
import { Chip } from '@/components/storage/chips'
import { ProjectsTable } from '@/components/storage/projects-table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { bytes } from '@/data/format'
import { host } from '@/host/client'
import { useHostEvents, useHostQuery } from '@/host/use-host'
import type { DemoSummary, RunSummary } from '@shared/host-api'

const GRID = 'grid grid-cols-[repeat(auto-fill,minmax(19rem,1fr))] gap-4'

interface ProjectsHomeProps {
  onOpenProject: (demo: string) => void
  onOpenRun: (runId: string) => void
}

/** The ten demo projects, and the other LayerFS projects in Connect's home. */
export function ProjectsHome({ onOpenProject, onOpenRun }: ProjectsHomeProps) {
  const [query, setQuery] = useState('')
  const demos = useHostQuery(() => host.demos(), [])
  const projects = useHostQuery(() => host.projects(), [])
  // Each demo's newest run, kept live from run events.
  const [latest, setLatest] = useState<Record<string, RunSummary>>({})
  useHostEvents((e) => {
    if (e.type !== 'run') return
    setLatest((all) => {
      const was = all[e.run.demo]
      if (was && was.id !== e.run.id && was.started > e.run.started) return all
      return { ...all, [e.run.demo]: e.run }
    })
    if (e.run.state === 'starting') projects.reload()
  })
  const { start, starting, error, clearError } = useStartRun((run) => onOpenRun(run.id))

  // What each card read about its project, summed in the strip.
  const [facts, setFacts] = useState<Record<string, CardFacts>>({})
  const onFacts = useCallback(
    (demo: string, f: CardFacts) =>
      setFacts((all) => (all[demo]?.commits === f.commits && all[demo]?.bytes === f.bytes ? all : { ...all, [demo]: f })),
    [],
  )

  // Cards that stay glide to their new places as the search narrows or widens.
  const flip = useFlip<HTMLDivElement>()
  const search = (next: string) => {
    flip.snapshot()
    setQuery(next)
  }

  const latestOf = (d: DemoSummary) => {
    const event = latest[d.id]
    return event && (!d.latest || event.started >= d.latest.started) ? event : d.latest
  }
  const q = query.trim().toLowerCase()
  useLayoutEffect(flip.play, [q, flip.play])
  const all = demos.data ?? []
  const shown = all
    .filter((d) => !q || `${d.id} ${d.title} ${d.blurb ?? ''} ${d.tags.join(' ')}`.toLowerCase().includes(q))
    .sort((a, b) => a.order - b.order)
  const playing = all.map(latestOf).filter((l): l is RunSummary => !!l && isLive(l.state))
  const live = playing.length
  const others = (projects.data ?? []).filter((p) => !p.run && !p.demo)

  const known = Object.values(facts)
  const commits = demos.data && known.length > 0 ? known.reduce((n, f) => n + f.commits, 0) : null
  const stored = known.reduce((n, f) => n + (f.bytes ?? 0), 0)
  const agentsRunning = playing.reduce((n, r) => n + r.agents.filter((a) => a.state === 'running').length, 0)

  return (
    <div className="h-svh overflow-y-auto">
      <PageHeader
        sticky
        width="max-w-6xl"
        title="Projects"
        badges={live > 0 && <Chip tone="info" live>{live} playing</Chip>}
        description="Each is one LayerFS project; a new session starts it again from the demo's fixture and plays its scripted agents."
        actions={
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
            {q && demos.data && (
              <span className="home-count absolute top-1/2 right-1.5 flex -translate-y-1/2 items-center gap-1">
                <span aria-live="polite" className="text-[11px] text-faint tabular-nums">
                  {shown.length} of {all.length}
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
        }
      />
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-8 pt-2 pb-12">
        {error && (
          <div
            role="alert"
            className="reveal flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-[13px] text-destructive ring-1 ring-destructive/25 ring-inset"
          >
            <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <span className="min-w-0 flex-1">
              Could not start a session of {error.demo}: {error.message}
            </span>
            <button type="button" onClick={clearError} className="text-xs font-medium underline-offset-2 hover:underline">
              Dismiss
            </button>
          </div>
        )}

        {!demos.error && (
          <StatsStrip
            stats={[
              {
                label: 'Projects',
                value: demos.data ? all.length + others.length : null,
                note: demos.data ? `${plural(all.length, 'demo')} · ${others.length} other` : 'Reading',
              },
              {
                label: 'Sessions',
                value: demos.data ? all.reduce((n, d) => n + d.runs, 0) : null,
                note: 'Played over every project',
              },
              {
                label: 'Playing now',
                value: demos.data ? live : null,
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

        {!demos.data ? (
          demos.error ? (
            <LoadError error={demos.error} what="the demo projects" onRetry={demos.reload} />
          ) : (
            <div className={GRID} aria-busy="true" aria-label="Loading projects">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} className="reveal h-64 rounded-xl" style={revealStyle(i)} />
              ))}
            </div>
          )
        ) : shown.length === 0 ? (
          all.length === 0 ? (
            <Empty icon={FolderSearch} title="No demo projects">
              The host lists no demo projects.
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
              Nothing matches “{query.trim()}”. Search by name, id or tag.
            </Empty>
          )
        ) : (
          <div ref={flip.container} className={GRID}>
            {shown.map((d, i) => (
              <ProjectCard
                key={d.id}
                demo={d}
                index={i}
                latest={latestOf(d)}
                starting={starting === d.id}
                onOpen={() => onOpenProject(d.id)}
                onNewSession={() => void start(d.id)}
                onFacts={onFacts}
              />
            ))}
          </div>
        )}

        <section className="reveal mt-2 flex flex-col gap-3" style={revealStyle(6)}>
          <div className="flex items-end gap-3">
            <div className="min-w-0 flex-1">
              <h2 className="flex items-center gap-2 text-sm font-semibold tracking-[-0.01em]">
                Other LayerFS projects
                {projects.data && (
                  <span className="rounded-full bg-muted px-1.5 text-[11px] font-medium text-muted-foreground tabular-nums">{others.length}</span>
                )}
              </h2>
              <p className="mt-0.5 text-xs text-faint">Projects in Connect's LayerFS home that no demo session made.</p>
            </div>
          </div>
          {projects.error && !projects.data ? (
            <LoadError error={projects.error} what="the LayerFS projects" onRetry={projects.reload} />
          ) : !projects.data ? (
            <Skeleton className="h-24 rounded-xl" />
          ) : (
            <div className="surface overflow-hidden rounded-xl [&>section]:rounded-none [&>section]:border-0 [&>section]:bg-transparent [&>section>header]:hidden">
              <ProjectsTable projects={others} title="Projects" empty="Every project here was made by a demo run." />
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
