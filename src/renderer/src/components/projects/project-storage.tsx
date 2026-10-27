// Storage and Sandboxes, two tabs of a demo's LayerFS project.
// Storage: its Store (one SQLite file in its Docker volume): how raw history
// shrinks to the bytes on disk, how both grow Commit by Commit, and what
// each Commit added. Sandboxes: the Sandboxes open on it, as tiles.
import type { ProjectState, RunDetail, StoreStats } from '@shared/host-api'

import { LfsSandbox, LfsStore } from '@/components/lfs-icons'
import { SandboxTiles } from '@/components/projects/sandbox-tiles'
import { Empty, LoadError, Loading } from '@/components/projects/states'
import { CommitBars, CountBytes, DiskFlow, GrowthChart, times, useLanded } from '@/components/projects/store-visuals'
import { isLive, plural } from '@/components/runs/run-format'
import { useRunProject } from '@/components/runs/run-project-tabs'
import { Tile } from '@/components/storage/icons'
import { bytes, when } from '@/data/format'

const ENTER = 'motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:fill-mode-both'

function Fact({ label, children, mono }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-faint">{label}</dt>
      <dd className={mono ? 'mt-0.5 truncate font-mono text-[13px]' : 'mt-0.5 truncate text-sm tabular-nums'}>{children}</dd>
    </div>
  )
}

function Section({ title, aside, delay, children }: { title: string; aside?: React.ReactNode; delay: number; children: React.ReactNode }) {
  return (
    <section className={ENTER} style={{ animationDelay: `${delay}ms`, animationDuration: '500ms' }}>
      <header className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h4 className="text-[13px] font-medium">{title}</h4>
        {aside}
      </header>
      {children}
    </section>
  )
}

/** A small labelled number under the flow. */
function Pill({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1.5 rounded-md bg-muted/70 px-2 py-1 text-xs">
      <span className="text-faint">{label}</span>
      <span className="font-mono tabular-nums">{children}</span>
    </span>
  )
}

function StoreStatsBody({ s, t }: { s: ProjectState; t: StoreStats }) {
  const onDisk = s.store.bytes ?? t.file
  const added = t.commits.map((c) => c.stored)
  const average = added.length ? added.reduce((a, b) => a + b, 0) / added.length : null
  const largest = added.length ? Math.max(...added) : null
  const smaller = onDisk > 0 ? t.logical / onDisk : 0
  const landed = useLanded(t.commits)
  return (
    <div className="flex flex-col gap-7 px-5 pt-5 pb-6">
      <div className={ENTER} style={{ animationDuration: '500ms' }}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <p className="text-[15px]">
            <CountBytes value={onDisk} className="text-3xl font-semibold tracking-[-0.02em]" />{' '}
            <span className="text-muted-foreground">on disk for</span> <CountBytes value={t.logical} className="font-semibold" />{' '}
            <span className="text-muted-foreground">of history</span>
          </p>
          {smaller >= 1.1 && (
            <span className="rounded-full bg-success/10 px-2 py-0.5 text-xs font-medium text-success ring-1 ring-success/25 ring-inset">
              {times(smaller)} smaller
            </span>
          )}
          {landed && (
            <span
              key={landed.id}
              className="flex max-w-80 items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-0.5 text-xs text-accent-foreground ring-1 ring-primary/25 ring-inset motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 dark:text-primary"
            >
              <span className="font-mono font-medium">+{bytes(landed.stored)}</span>
              <span className="truncate">{landed.message || 'new Commit'}</span>
            </span>
          )}
        </div>
        <p className="mt-1 text-xs text-muted-foreground tabular-nums">
          {plural(s.commits, 'Commit')} · {s.branches.length} Branch{s.branches.length === 1 ? '' : 'es'} · {plural(s.layers.length, 'Layer')}, each a full
          snapshot
        </p>
      </div>

      <Section title="From history to disk" delay={120}>
        <DiskFlow t={t} onDisk={onDisk} />
        <div className="mt-3 flex flex-wrap gap-2">
          <Pill label="main, latest, raw">{bytes(t.main)}</Pill>
          {t.init && (
            <Pill label="from Init">
              {bytes(t.init.bytes)} · {plural(t.init.files, 'file')}
            </Pill>
          )}
          <Pill label="SQLite pages">{bytes(t.file)}</Pill>
          {t.free > 0 && <Pill label="free">{bytes(t.free)}</Pill>}
        </div>
      </Section>

      <div className="grid gap-x-8 gap-y-7 border-t pt-6 md:grid-cols-2">
        <Section title="History against disk" aside={<span className="text-xs text-faint">cumulative, Commit by Commit</span>} delay={260}>
          <GrowthChart t={t} />
        </Section>
        <Section
          title="Each Commit"
          delay={360}
          aside={
            average === null ? (
              <span className="text-xs text-muted-foreground">no Commits yet</span>
            ) : (
              <span className="text-xs text-muted-foreground">
                <CountBytes value={Math.round(average)} className="font-mono text-foreground" /> average ·{' '}
                <CountBytes value={largest} className="font-mono text-foreground" /> largest, added on disk
              </span>
            )
          }
        >
          {t.commits.length > 0 ? (
            <CommitBars commits={t.commits} />
          ) : (
            <p className="flex h-[150px] items-center justify-center rounded-lg border border-dashed text-xs text-faint">The first Commit’s bar shows here</p>
          )}
        </Section>
      </div>
    </div>
  )
}

function StoreCard({ s }: { s: ProjectState }) {
  return (
    <section className="rounded-xl border bg-card">
      <header className="flex items-start gap-3 border-b px-5 py-4">
        <Tile>
          <LfsStore className="size-5" />
        </Tile>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold">Local SQLite Store</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Every Commit, Branch and Layer of <span className="font-mono text-foreground">{s.project.name}</span> lives in one SQLite file in
            its Docker volume; each new session starts it again from the demo’s fixture.
          </p>
        </div>
      </header>
      {s.storage ? (
        <StoreStatsBody s={s} t={s.storage} />
      ) : (
        <p className="px-5 py-4 text-sm text-muted-foreground">
          The Store’s totals are not readable right now. File size: <span className="tabular-nums">{bytes(s.store.bytes)}</span>
        </p>
      )}
      <dl className="grid grid-cols-2 gap-4 border-t px-5 py-4 sm:grid-cols-4">
        <Fact label="Created">{when(s.project.created)}</Fact>
        <div className="col-span-1 sm:col-span-3">
          <Fact label="Volume" mono>
            {s.project.volume ?? '—'}
          </Fact>
        </div>
        <div className="col-span-2 sm:col-span-4">
          <Fact label="Store file" mono>
            {s.store.path ?? '—'}
          </Fact>
        </div>
      </dl>
    </section>
  )
}

function SandboxesCard({ s, run }: { s: ProjectState; run: RunDetail }) {
  const open = s.sandboxes.filter((x) => x.state !== 'gone').length
  const mounted = s.sandboxes.reduce((n, x) => n + x.workspaces.length, 0)
  return (
    <section className="overflow-hidden rounded-xl border bg-card">
      <header className="flex items-start gap-3 border-b px-5 py-4">
        <Tile>
          <LfsSandbox className="size-5" />
        </Tile>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold">Docker Sandboxes</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Containers the agents mount Workspaces in. Each Workspace is a Branch of{' '}
            <span className="font-mono text-foreground">{s.project.name}</span>; what it writes reaches the Store when it commits.
          </p>
        </div>
        <span className="shrink-0 text-right text-xs text-muted-foreground tabular-nums">
          {open} open{s.sandboxes.length > open ? ` · ${s.sandboxes.length - open} closed` : ''}
          <span className="block text-faint">{plural(mounted, 'Workspace')} mounted</span>
        </span>
      </header>
      {s.sandboxes.length > 0 ? (
        <div className="bg-muted/25 p-4">
          <SandboxTiles sandboxes={s.sandboxes} />
        </div>
      ) : (
        <div className="p-4">
          <Empty icon={LfsSandbox} title="No Sandboxes open">
            {isLive(run.state)
              ? 'A Sandbox opens when an agent first mounts a Workspace.'
              : 'The session’s Sandboxes have closed; its Workspaces were unmounted with them.'}
          </Empty>
        </div>
      )}
    </section>
  )
}

/** Reads the project its newest session played on, then draws `body`. */
function ProjectPane({ run, body }: { run: RunDetail; body: (s: ProjectState) => React.ReactNode }) {
  const p = useRunProject(run)
  const s = p.state
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[1000px] flex-col gap-6 px-8 py-6">
        {s ? body(s) : p.error ? <LoadError error={p.error} what={run.project} onRetry={p.reload} /> : <Loading label={`Reading ${run.project}`} />}
      </div>
    </div>
  )
}

/** The Storage tab of a project: its Store. */
export function ProjectStorage({ run }: { run: RunDetail }) {
  return <ProjectPane run={run} body={(s) => <StoreCard s={s} />} />
}

/** The Sandboxes tab of a project: the Sandboxes open on it. */
export function ProjectSandboxes({ run }: { run: RunDetail }) {
  return <ProjectPane run={run} body={(s) => <SandboxesCard s={s} run={run} />} />
}
