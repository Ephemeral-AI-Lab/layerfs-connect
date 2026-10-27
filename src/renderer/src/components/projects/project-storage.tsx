// Storage and Sandboxes, two tabs of a demo's LayerFS project.
// Storage: its Store (one SQLite file in its Docker volume) told as a story:
// how raw history shrinks to the bytes on disk, how both grow Commit by
// Commit, and what each Commit added, by kind. Sandboxes: the Sandboxes open
// on it, as tiles.
import type { ProjectState, RunDetail, StoreStats } from '@shared/host-api'
import type { CSSProperties } from 'react'

import { LfsSandbox, LfsStore } from '@/components/lfs-icons'
import { CountUp } from '@/components/motion'
import { SandboxTiles } from '@/components/projects/sandbox-tiles'
import { Empty, LoadError, Loading } from '@/components/projects/states'
import { CommitBars, CommitKinds, CountBytes, DiskFlow, GrowthChart, SavedRing, times, useLanded } from '@/components/projects/store-visuals'
import { isLive, plural } from '@/components/runs/run-format'
import { useRunProject } from '@/components/runs/run-project-tabs'
import { Tile } from '@/components/storage/icons'
import { bytes, when } from '@/data/format'
import { cn } from '@/lib/utils'

import '@/components/storage/storage.css'

const i = (n: number) => ({ '--i': n }) as CSSProperties

function Fact({ label, children, mono }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium tracking-wide text-faint uppercase">{label}</dt>
      <dd className={mono ? 'mt-1 truncate font-mono text-[12px] text-muted-foreground' : 'mt-1 truncate text-sm tabular-nums'}>{children}</dd>
    </div>
  )
}

/** One part of the story: a numbered heading, a line on what it shows, then the picture. */
function Section({
  n,
  title,
  note,
  aside,
  index,
  className,
  children,
}: {
  n: number
  title: string
  note?: React.ReactNode
  aside?: React.ReactNode
  index: number
  className?: string
  children: React.ReactNode
}) {
  return (
    <section className={cn('reveal min-w-0', className)} style={i(index)}>
      <header className="mb-4 flex flex-wrap items-start gap-x-3 gap-y-1">
        <span
          aria-hidden="true"
          className="mt-px flex size-5 shrink-0 items-center justify-center rounded-md bg-muted font-mono text-[10px] font-semibold text-muted-foreground ring-1 ring-foreground/[0.06] ring-inset"
        >
          {n}
        </span>
        <div className="min-w-0 flex-1">
          <h4 className="text-[13px] font-semibold">{title}</h4>
          {note && <p className="mt-0.5 text-xs text-muted-foreground text-pretty">{note}</p>}
        </div>
        {aside}
      </header>
      {children}
    </section>
  )
}

/** A small labelled number under the flow. */
function Pill({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1.5 rounded-md bg-muted/60 px-2 py-1 text-xs ring-1 ring-foreground/[0.05] ring-inset">
      <span className="text-faint">{label}</span>
      <span className="font-mono text-foreground/90 tabular-nums">{children}</span>
    </span>
  )
}

function StoreStatsBody({ s, t }: { s: ProjectState; t: StoreStats }) {
  const onDisk = s.store.bytes ?? t.file
  const added = t.commits.map((c) => c.stored)
  const average = added.length ? added.reduce((a, b) => a + b, 0) / added.length : null
  const largest = added.length ? Math.max(...added) : null
  const smaller = onDisk > 0 ? t.logical / onDisk : 0
  const saved = t.logical > 0 && onDisk < t.logical ? 1 - onDisk / t.logical : null
  const landed = useLanded(t.commits)
  return (
    <div className="flex flex-col">
      {/* the headline: what the history costs on disk */}
      <div className="reveal flex items-center gap-6 px-6 pt-6 pb-5" style={i(1)}>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium tracking-wide text-faint uppercase">On disk</p>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-2">
            <CountBytes value={onDisk} className="text-brand text-[40px] leading-none font-semibold tracking-[-0.03em]" />
            <p className="text-[15px] text-muted-foreground">
              for <CountBytes value={t.logical} className="font-semibold text-foreground" /> of history
            </p>
            {smaller >= 1.1 && (
              <span className="self-center rounded-full bg-success/10 px-2 py-0.5 text-xs font-medium text-success ring-1 ring-success/25 ring-inset tabular-nums">
                {times(smaller)} smaller
              </span>
            )}
            {landed && (
              <span
                key={landed.id}
                className="live-glow flex max-w-80 items-center gap-1.5 self-center rounded-full bg-primary/10 px-2.5 py-0.5 text-xs text-accent-foreground motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 dark:text-primary"
              >
                <span className="font-mono font-medium">+{bytes(landed.stored)}</span>
                <span className="truncate">{landed.message || 'new Commit'}</span>
              </span>
            )}
          </div>
          <p className="mt-2 text-xs text-muted-foreground tabular-nums">
            <CountUp value={s.commits} /> Commit{s.commits === 1 ? '' : 's'} · <CountUp value={s.branches.length} /> Branch
            {s.branches.length === 1 ? '' : 'es'} · {plural(s.layers.length, 'Layer')}. LayerFS counts each as a full snapshot, then keeps only what is new.
          </p>
        </div>
        {saved !== null && <SavedRing saved={saved} wait={300} />}
      </div>

      <div className="border-t px-6 pt-5 pb-6">
        <Section
          n={1}
          index={2}
          title="From history to disk"
          note="Every snapshot counted in full, then the same bytes once, then packed. The band’s thickness is the bytes."
        >
          <DiskFlow t={t} onDisk={onDisk} />
          <div className="sc-fade mt-4 flex flex-wrap gap-2" style={{ '--d': '1300ms' } as CSSProperties}>
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
      </div>

      <div className="grid gap-x-10 gap-y-8 border-t px-6 pt-5 pb-6 md:grid-cols-2">
        <Section n={2} index={3} title="History against disk" note="Cumulative, Commit by Commit: every snapshot in full, against the packed bytes kept.">
          <GrowthChart t={t} />
        </Section>
        <Section
          n={3}
          index={4}
          title="Each Commit"
          note={
            average === null ? (
              'No Commits yet.'
            ) : (
              <>
                <CountBytes value={Math.round(average)} className="font-mono text-foreground" /> average ·{' '}
                <CountBytes value={largest} className="font-mono text-foreground" /> largest, added on disk.
              </>
            )
          }
        >
          {t.commits.length > 0 ? (
            <>
              <CommitBars commits={t.commits} />
              <CommitKinds commits={t.commits} />
            </>
          ) : (
            <p className="flex h-[156px] items-center justify-center rounded-lg border border-dashed text-xs text-faint">The first Commit’s bar shows here</p>
          )}
        </Section>
      </div>
    </div>
  )
}

function StoreCard({ s }: { s: ProjectState }) {
  return (
    <section className="surface reveal-scale overflow-hidden rounded-2xl">
      <header className="flex items-start gap-3 px-6 pt-5">
        <Tile className="text-primary">
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
        <p className="px-6 py-5 text-sm text-muted-foreground">
          The Store’s totals are not readable right now. File size: <span className="tabular-nums">{bytes(s.store.bytes)}</span>
        </p>
      )}
      <dl className="grid grid-cols-2 gap-4 border-t bg-muted/25 px-6 py-4 sm:grid-cols-4">
        <Fact label="Created">{when(s.project.created)}</Fact>
        <div className="col-span-1 sm:col-span-3">
          <Fact label="Volume" mono>
            {s.project.volume ?? '—'}
          </Fact>
        </div>
        <div className="col-span-2 sm:col-span-4">
          <Fact label="Store file" mono>
            <span title={s.store.path ?? undefined}>{s.store.path ?? '—'}</span>
          </Fact>
        </div>
      </dl>
    </section>
  )
}

function SandboxesCard({ s, run }: { s: ProjectState; run: RunDetail }) {
  const open = s.sandboxes.filter((x) => x.state !== 'gone').length
  const running = s.sandboxes.filter((x) => x.state === 'running').length
  const mounted = s.sandboxes.reduce((n, x) => n + x.workspaces.length, 0)
  return (
    <section className="surface reveal-scale overflow-hidden rounded-2xl">
      <header className="flex items-start gap-3 px-6 py-5">
        <Tile className={cn(running > 0 && 'text-primary')}>
          <LfsSandbox className="size-5" />
        </Tile>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold">Docker Sandboxes</h3>
          <p className="mt-0.5 max-w-xl text-xs text-muted-foreground">
            Containers the agents mount Workspaces in. Each Workspace is a Branch of{' '}
            <span className="font-mono text-foreground">{s.project.name}</span>; what it writes reaches the Store when it commits.
          </p>
        </div>
        <dl className="flex shrink-0 gap-5 text-right">
          <div>
            <dt className="text-[11px] text-faint">Open</dt>
            <dd className="text-lg leading-6 font-semibold tabular-nums">
              <CountUp value={open} />
              {s.sandboxes.length > open && <span className="ml-1 text-xs font-normal text-faint">+{s.sandboxes.length - open} closed</span>}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] text-faint">Workspaces</dt>
            <dd className={cn('text-lg leading-6 font-semibold tabular-nums', mounted > 0 && 'text-brand')}>
              <CountUp value={mounted} />
            </dd>
          </div>
        </dl>
      </header>
      {s.sandboxes.length > 0 ? (
        <div className="border-t bg-muted/25 p-4">
          <SandboxTiles sandboxes={s.sandboxes} />
        </div>
      ) : (
        <div className="border-t p-4">
          <Empty icon={LfsSandbox} title="No Sandboxes open" className="border-transparent bg-transparent">
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
