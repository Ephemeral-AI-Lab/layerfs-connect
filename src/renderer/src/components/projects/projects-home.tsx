import { Plus, Search, TriangleAlert } from 'lucide-react'
import { useState } from 'react'

import { LayerfsMark } from '@/components/layerfs-mark'
import { LfsBranch, LfsCommit, LfsStore } from '@/components/lfs-icons'
import { LoadError } from '@/components/projects/states'
import { RunStateBadge } from '@/components/runs/run-badges'
import { isLive, plural, runLabel } from '@/components/runs/run-format'
import { useStartRun } from '@/components/runs/use-runs'
import { Chip } from '@/components/storage/chips'
import { ProjectsTable } from '@/components/storage/projects-table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { ago, bytes, shortId } from '@/data/format'
import { HostError, host } from '@/host/client'
import { useHostEvents, useHostQuery } from '@/host/use-host'
import type { DemoSummary, RunSummary } from '@shared/host-api'

interface ProjectCardProps {
  demo: DemoSummary
  latest: RunSummary | null
  starting: boolean
  onOpen: () => void
  onNewSession: () => void
}

/** A demo's LayerFS project: its state now, its Store and last Commit, and its sessions. */
function ProjectCard({ demo, latest, starting, onOpen, onNewSession }: ProjectCardProps) {
  const live = latest ? isLive(latest.state) : false
  // reread as sessions start and end; a demo never played has no project yet (404)
  const state = useHostQuery(() => host.project(demo.id), [demo.id, latest?.id, latest?.state])
  const s = state.data?.project.name === demo.id ? state.data : undefined
  const missing = state.error instanceof HostError && state.error.status === 404
  return (
    <div className="group relative flex flex-col gap-3.5 rounded-xl border bg-card p-5 transition-[border-color,box-shadow] hover:border-foreground/20 hover:shadow-sm has-[[data-open]:focus-visible]:ring-2 has-[[data-open]:focus-visible]:ring-ring">
      <div className="flex items-start gap-3">
        <LayerfsMark className="size-8 shrink-0" />
        <div className="min-w-0 flex-1">
          <button
            type="button"
            data-open
            onClick={onOpen}
            className="block max-w-full truncate text-left text-[15px] font-semibold outline-none group-hover:underline after:absolute after:inset-0 after:rounded-xl"
          >
            {demo.title}
          </button>
          <div className="truncate text-xs text-muted-foreground">
            {s?.last ? `${shortId(s.last.id)} · ${ago(s.last.at)}` : <span className="font-mono text-faint">{demo.id}</span>}
          </div>
        </div>
        {live ? (
          <Chip tone="info" live>
            {runLabel(latest!)} playing
          </Chip>
        ) : (
          latest && <RunStateBadge state={latest.state} />
        )}
      </div>

      {demo.blurb && <p className="line-clamp-2 text-[13px] text-muted-foreground">{demo.blurb}</p>}

      <div className="flex items-center gap-2.5 rounded-lg bg-muted/50 px-2.5 py-2">
        <LfsStore className="size-4" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium">
            Local SQLite <span className="font-normal text-muted-foreground">· {s ? bytes(s.store.bytes) : missing ? 'not created yet' : '…'}</span>
          </div>
          <div className="truncate text-xs text-faint">
            {s
              ? `main L${Math.max(0, s.layers.length - 1)} · ${s.branches.length} Branch${s.branches.length === 1 ? '' : 'es'} · ${plural(s.commits, 'Commit')}`
              : missing
                ? 'The first session Inits it from the fixture'
                : state.error
                  ? state.error.message
                  : 'Reading the project'}
          </div>
        </div>
      </div>

      {s?.last && (
        <div className="flex min-w-0 items-center gap-2 text-xs">
          <LfsCommit className="size-3.5" />
          <span className="min-w-0 flex-1 truncate">{s.last.message || 'Commit'}</span>
          <span className="flex shrink-0 items-center gap-1 text-muted-foreground">
            <LfsBranch className="size-3.5" />
            {s.last.branch}
          </span>
        </div>
      )}

      <div className="mt-auto flex items-center gap-3 border-t pt-3">
        <div className="min-w-0 flex-1 text-xs text-muted-foreground">
          {live && latest ? (
            <span className="block truncate">
              {plural(demo.runs, 'session')} · one playing since {ago(latest.started)}
            </span>
          ) : latest ? (
            <span className="block truncate">
              {plural(demo.runs, 'session')} · last {ago(latest.ended ?? latest.started)}
            </span>
          ) : (
            'No sessions yet'
          )}
        </div>
        <Button size="sm" variant="outline" className="relative z-10" disabled={starting || live} onClick={onNewSession}>
          <Plus /> {starting ? 'Starting…' : 'New session'}
        </Button>
      </div>
    </div>
  )
}

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

  const latestOf = (d: DemoSummary) => {
    const event = latest[d.id]
    return event && (!d.latest || event.started >= d.latest.started) ? event : d.latest
  }
  const q = query.trim().toLowerCase()
  const shown = (demos.data ?? [])
    .filter((d) => !q || `${d.id} ${d.title} ${d.blurb ?? ''} ${d.tags.join(' ')}`.toLowerCase().includes(q))
    .sort((a, b) => a.order - b.order)
  const live = (demos.data ?? []).filter((d) => {
    const l = latestOf(d)
    return l && isLive(l.state)
  }).length
  const others = (projects.data ?? []).filter((p) => !p.run && !p.demo)

  return (
    <div className="h-svh overflow-y-auto">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-8 pt-7 pb-10">
        <header className="flex items-end justify-between gap-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-[-0.015em]">Projects</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {demos.data
                ? `${demos.data.length} projects · ${live} playing now. Each is one LayerFS project; a new session starts it again from the demo's fixture and plays its scripted agents.`
                : 'Scripted demo scenarios, each played on the real LayerFS.'}
            </p>
          </div>
          <div className="relative w-64 shrink-0">
            <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-faint" />
            <Input
              aria-label="Search projects"
              placeholder="Search projects"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-8"
            />
          </div>
        </header>

        {error && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-[13px] text-destructive ring-1 ring-destructive/25 ring-inset"
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

        {!demos.data ? (
          demos.error ? (
            <LoadError error={demos.error} what="the demo projects" onRetry={demos.reload} />
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(19rem,1fr))] gap-4" aria-busy="true" aria-label="Loading projects">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} className="h-60 rounded-xl" />
              ))}
            </div>
          )
        ) : shown.length === 0 ? (
          <p className="rounded-xl border border-dashed px-6 py-12 text-center text-sm text-muted-foreground">
            {demos.data.length === 0 ? 'The host lists no demo projects.' : 'No projects match. Try another search.'}
          </p>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(19rem,1fr))] gap-4">
            {shown.map((d) => (
              <ProjectCard
                key={d.id}
                demo={d}
                latest={latestOf(d)}
                starting={starting === d.id}
                onOpen={() => onOpenProject(d.id)}
                onNewSession={() => void start(d.id)}
              />
            ))}
          </div>
        )}

        <section className="flex flex-col gap-2">
          <div>
            <h2 className="text-[13px] font-semibold">Other LayerFS projects</h2>
            <p className="text-xs text-faint">Projects in Connect's LayerFS home that no demo session made.</p>
          </div>
          {projects.error && !projects.data ? (
            <LoadError error={projects.error} what="the LayerFS projects" onRetry={projects.reload} />
          ) : !projects.data ? (
            <Skeleton className="h-24 rounded-xl" />
          ) : (
            <ProjectsTable projects={others} title="Projects" empty="Every project here was made by a demo run." />
          )}
        </section>
      </div>
    </div>
  )
}
