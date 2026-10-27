import { Bot, ListOrdered, Play, Search, TriangleAlert } from 'lucide-react'
import { useState } from 'react'

import { LoadError } from '@/components/projects/states'
import { Progress, RunStateBadge } from '@/components/runs/run-badges'
import { KIND, KIND_ORDER, agentColors, isLive } from '@/components/runs/run-format'
import { useStartRun } from '@/components/runs/use-runs'
import { ProjectsTable } from '@/components/storage/projects-table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { ago } from '@/data/format'
import { host } from '@/host/client'
import { useHostEvents, useHostQuery } from '@/host/use-host'
import { cn } from '@/lib/utils'
import type { DemoSummary, RunSummary } from '@shared/host-api'

/** Counts by kind as one bar, widths by share. */
export function KindBar({ kinds, className }: { kinds: DemoSummary['kinds']; className?: string }) {
  const total = KIND_ORDER.reduce((n, k) => n + (kinds[k] ?? 0), 0)
  if (total === 0) return null
  const parts = KIND_ORDER.filter((k) => (kinds[k] ?? 0) > 0)
  return (
    <div
      role="img"
      aria-label={`Segments by kind: ${parts.map((k) => `${KIND[k].label} ${kinds[k]}`).join(', ')}`}
      className={cn('flex h-1.5 gap-px overflow-hidden rounded-full bg-muted', className)}
    >
      {parts.map((k) => (
        <span
          key={k}
          title={`${KIND[k].label} · ${kinds[k]}`}
          className={cn('h-full', KIND[k].dot)}
          style={{ width: `${((kinds[k] ?? 0) / total) * 100}%` }}
        />
      ))}
    </div>
  )
}

interface DemoCardProps {
  demo: DemoSummary
  latest: RunSummary | null
  starting: boolean
  onOpen: () => void
  onRun: () => void
}

function DemoCard({ demo, latest, starting, onOpen, onRun }: DemoCardProps) {
  const colorOf = agentColors(demo.agents.map((a) => a.name))
  const live = latest ? isLive(latest.state) : false
  return (
    <div className="group relative flex flex-col gap-3.5 rounded-xl border bg-card p-5 transition-[border-color,box-shadow] hover:border-foreground/20 hover:shadow-sm has-[[data-open]:focus-visible]:ring-2 has-[[data-open]:focus-visible]:ring-ring">
      <div className="flex items-start gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted font-mono text-xs font-semibold text-muted-foreground tabular-nums">
          {String(demo.order).padStart(2, '0')}
        </span>
        <div className="min-w-0 flex-1">
          <button
            type="button"
            data-open
            onClick={onOpen}
            className="block max-w-full truncate text-left text-[15px] font-semibold outline-none group-hover:underline after:absolute after:inset-0 after:rounded-xl"
          >
            {demo.title}
          </button>
          <div className="truncate font-mono text-xs text-faint">{demo.id}</div>
        </div>
        {latest && <RunStateBadge state={latest.state} />}
      </div>

      {demo.blurb && <p className="line-clamp-2 text-[13px] text-muted-foreground">{demo.blurb}</p>}

      {demo.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {demo.tags.map((t) => (
            <span key={t} className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
              {t}
            </span>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
          <span className="flex min-w-0 items-center gap-1.5" title={demo.agents.map((a) => `${a.name} · ${a.steps} steps`).join('\n')}>
            <Bot aria-hidden="true" className="size-3.5 shrink-0 text-faint" />
            <span className="flex shrink-0 gap-1">
              {demo.agents.slice(0, 6).map((a) => (
                <span key={a.name} aria-hidden="true" className={cn('size-2 rounded-full', colorOf(a.name).dot)} />
              ))}
            </span>
            <span className="truncate">
              {demo.agents.length === 1 ? demo.agents[0].name : `${demo.agents.length} agents`}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-1">
            <ListOrdered aria-hidden="true" className="size-3.5 text-faint" />
            {demo.steps} steps
          </span>
        </div>
        <KindBar kinds={demo.kinds} />
      </div>

      <div className="mt-auto flex items-center gap-3 border-t pt-3">
        <div className="min-w-0 flex-1 text-xs text-muted-foreground">
          {latest ? (
            live ? (
              <div className="flex items-center gap-2">
                <Progress done={latest.done} of={latest.of} className="w-20" />
                <span className="truncate tabular-nums">
                  {latest.done}/{latest.of} · {latest.project}
                </span>
              </div>
            ) : (
              <span className="block truncate">
                {demo.runs} run{demo.runs === 1 ? '' : 's'} · last {ago(latest.ended ?? latest.started)} ·{' '}
                <span className="font-mono">{latest.project}</span>
              </span>
            )
          ) : (
            'Not run yet'
          )}
        </div>
        <Button size="sm" variant={latest ? 'outline' : 'default'} className="relative z-10" disabled={starting} onClick={onRun}>
          <Play /> {starting ? 'Starting…' : latest ? 'Run again' : 'Run'}
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
                ? `${demos.data.length} demo projects · ${live} running now. Each run Inits a fresh LayerFS project and plays scripted agents on it.`
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
              Could not start a run of {error.demo}: {error.message}
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
              <DemoCard
                key={d.id}
                demo={d}
                latest={latestOf(d)}
                starting={starting === d.id}
                onOpen={() => onOpenProject(d.id)}
                onRun={() => void start(d.id)}
              />
            ))}
          </div>
        )}

        <section className="flex flex-col gap-2">
          <div>
            <h2 className="text-[13px] font-semibold">Other LayerFS projects</h2>
            <p className="text-xs text-faint">Projects in Connect's LayerFS home that no demo run made.</p>
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
