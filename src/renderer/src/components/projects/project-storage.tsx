import { t as tr, useI18n } from '@/i18n'
// Storage and Sandboxes read from the LayerFS project's current state.
// Storage: its Store (one SQLite file in its Docker volume, or a PostgreSQL
// schema; layerfs#506 lets several projects share one) told as a story:
// how raw history shrinks to the bytes on disk, how both grow Commit by
// Commit, and what each Commit added, by kind. Sandboxes: the Sandboxes open
// on it, as tiles.
import type { ProjectState, SandboxInfo, StoreStats } from '@shared/host-api'
import { type CSSProperties, useState } from 'react'
import { LoaderCircle, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { host } from '@/host/client'

import { CountUp, spotlight } from '@/components/motion'
import { SandboxTiles } from '@/components/projects/sandbox-tiles'
import { useProjectSandboxes } from '@/components/projects/use-sandboxes'
import type { StoreFacts } from '@/components/projects/store-facts'
import { CommitBars, CommitKinds, CountBytes, DiskFlow, GrowthChart, SavedRing, times, useLanded } from '@/components/projects/store-visuals'
import { plural } from '@/data/format'
import { GapLine } from '@/components/gap-line'
import { StoreIcon } from '@/components/storage/identity/store-icon'
import { bytes, when } from '@/data/format'
import { cn } from '@/lib/utils'

import '@/components/storage/storage.css'

const i = (n: number) => ({ '--i': n }) as CSSProperties

function Fact({ label, children, mono }: { label: string; children: React.ReactNode; mono?: boolean }) {
  useI18n()
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium tracking-wide text-faint uppercase">{tr(label)}</dt>
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
  useI18n()
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
          <h4 className="text-[13px] font-semibold">{tr(title)}</h4>
          {note && <p className="mt-0.5 text-xs text-muted-foreground text-pretty">{typeof note === 'string' ? tr(note) : note}</p>}
        </div>
        {aside}
      </header>
      {children}
    </section>
  )
}

/** A small labelled number under the flow. */
function Pill({ label, children }: { label: string; children: React.ReactNode }) {
  useI18n()
  return (
    <span className="flex items-center gap-1.5 rounded-md bg-muted/60 px-2 py-1 text-xs ring-1 ring-foreground/[0.05] ring-inset">
      <span className="text-faint">{tr(label)}</span>
      <span className="font-mono text-foreground/90 tabular-nums">{children}</span>
    </span>
  )
}

function StoreStatsBody({ s, t }: { s: ProjectState; t: StoreStats }) {
  useI18n()
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
          <p className="text-[11px] font-medium tracking-wide text-faint uppercase">{tr("On disk")}</p>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-2">
            <CountBytes value={onDisk} className="text-brand text-[40px] leading-none font-semibold tracking-[-0.03em]" />
            <p className="text-[15px] text-muted-foreground">{tr("for ")}<CountBytes value={t.logical} className="font-semibold text-foreground" />{' '}{tr("of history")}</p>
            {smaller >= 1.1 && (
              <span className="self-center rounded-full bg-success/10 px-2 py-0.5 text-xs font-medium text-success ring-1 ring-success/25 ring-inset tabular-nums">
                {times(smaller)} {tr("smaller")}</span>
            )}
            {landed && (
              <span
                key={landed.id}
                className="live-glow flex max-w-80 items-center gap-1.5 self-center rounded-full bg-primary/10 px-2.5 py-0.5 text-xs text-accent-foreground motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 dark:text-primary"
              >
                <span className="font-mono font-medium">+{bytes(landed.stored)}</span>
                <span className="truncate">{landed.message || tr('New commit')}</span>
              </span>
            )}
          </div>
          <p className="mt-2 text-xs text-muted-foreground tabular-nums">
            <CountUp value={s.commits} /> {tr(s.commits === 1 ? "Commit" : "Commits")} · <CountUp value={s.branches.length} /> {tr(s.branches.length === 1 ? "Branch" : "Branches")} · {plural(s.layers.length, 'Layer')}
          </p>
        </div>
        {saved !== null && <SavedRing saved={saved} wait={300} />}
      </div>

      <div className="border-t px-6 pt-5 pb-6">
        <Section
          n={1}
          index={2}
          title={tr("From history to disk")}
          note={tr("Deduplicated and compressed storage flow")}
        >
          <DiskFlow t={t} onDisk={onDisk} />
          <div className="sc-fade mt-4 flex flex-wrap gap-2" style={{ '--d': '1300ms' } as CSSProperties}>
            <Pill label={tr("main, latest, raw")}>{bytes(t.main)}</Pill>
            {t.init && (
              <Pill label={tr("from Init")}>
                {bytes(t.init.bytes)} · {plural(t.init.files, 'file')}
              </Pill>
            )}
            <Pill label={tr("SQLite pages")}>{bytes(t.file)}</Pill>
            {t.free > 0 && <Pill label={tr("free")}>{bytes(t.free)}</Pill>}
          </div>
        </Section>
      </div>

      <div className="grid gap-x-10 gap-y-8 border-t px-6 pt-5 pb-6 md:grid-cols-2">
        <Section n={2} index={3} title={tr("History against disk")} note={tr("Cumulative snapshot vs packed size")}>
          <GrowthChart t={t} />
        </Section>
        <Section
          n={3}
          index={4}
          title={tr("Each Commit")}
          note={
            average === null ? (
              'No Commits yet.'
            ) : (
              <>
                <CountBytes value={Math.round(average)} className="font-mono text-foreground font-semibold" /> {tr("avg ·")}{' '}
                <CountBytes value={largest} className="font-mono text-foreground font-semibold" /> {tr("Maximum")}</>
            )
          }
        >
          {t.commits.length > 0 ? (
            <>
              <CommitBars commits={t.commits} />
              <CommitKinds commits={t.commits} />
            </>
          ) : (
            <p className="flex h-[156px] items-center justify-center rounded-lg border border-dashed text-xs text-faint">{tr("The first Commit’s bar shows here")}</p>
          )}
        </Section>
      </div>
    </div>
  )
}

/** The Store card's header (storage-links §6): the Store's mark, family and name and its link, one chip. No sync state: the project page never checks the remote file. */
function StoreCard({ s, store }: { s: ProjectState; store: StoreFacts }) {
  useI18n()
  const postgresql = store.family === 'postgresql'
  const family = postgresql ? 'PostgreSQL' : 'SQLite'
  return (
    <section onPointerMove={spotlight} className="glass-liquid spotlight reveal rounded-2xl shadow-xs overflow-hidden">
      <header className="flex items-start gap-4 px-6 py-6">
        <StoreIcon family={store.family} size="md" />
        <div className="min-w-0 flex-1 basis-56">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="min-w-0 text-sm font-semibold [overflow-wrap:anywhere]">
              {store.name ? <>{tr("{family} Store", { family })} <span className="font-mono">{store.name}</span></> : tr("Project Store")}
            </h3>
            {!postgresql && store.name && (
              <span className="max-w-full truncate rounded-full bg-foreground/[0.05] px-2 py-0.5 font-mono text-[11px] text-muted-foreground ring-1 ring-foreground/[0.05] ring-inset">
                {tr("on {machine}", { machine: store.machine ?? '?' })}
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground font-medium text-pretty">
            {postgresql
              ? tr("Every Commit, Branch and Layer of {project} lives in the PostgreSQL Store {store}; each Commit goes straight there.", { project: s.project.name, store: store.name })
              : store.name
                ? tr("Every Commit, Branch and Layer of {project} lives in this Store’s one SQLite file, on {machine}.", { project: s.project.name, machine: store.machine ?? '?' })
                : tr("Copy-on-Write project history and storage usage")}
          </p>
          {store.shared && (
            <p className="mt-1 text-xs text-muted-foreground">
              {store.others.length > 0
                ? tr(store.others.length === 1 ? "Shared with 1 other project: a move or backup carries it too." : "Shared with {count} other projects: a move or backup carries them too.", { count: store.others.length })
                : tr("Shared with other projects: a move or backup carries them too.")}
            </p>
          )}
        </div>
      </header>
      {s.storage ? (
        <StoreStatsBody s={s} t={s.storage} />
      ) : (
        <div className="space-y-1.5 px-6 py-5 text-sm text-muted-foreground">
          <p>{tr("Store file with its WAL: ")}<span className="tabular-nums">{bytes(s.store.bytes)}</span></p>
          <GapLine what="Store totals (dedupe, compression, what each Commit stored)" />
        </div>
      )}
      <dl className="grid grid-cols-2 gap-4 border-t bg-muted/25 px-6 py-4 sm:grid-cols-4">
        <Fact label={tr("Created")}>{when(s.project.created)}</Fact>
        <div className="col-span-1 sm:col-span-3">
          <Fact label={tr(store.family === 'postgresql' ? "Store" : "Machine")} mono>
            {store.family === 'postgresql' ? store.name : (store.machine ?? '—')}
          </Fact>
        </div>
      </dl>
    </section>
  )
}

/** Project panels can render directly from state without a scripted session. */
export function ProjectStorageContent({ state, store }: { state: ProjectState; store: StoreFacts }) {
  useI18n()
  return <StoreCard s={state} store={store} />
}

/**
 * New Sandbox: a name unique in the home, prefilled, and an image. A sqlite
 * project's Sandboxes run on its Store's machine (shown, fixed); a
 * PostgreSQL project chooses native or docker.
 */
function NewSandbox({ project, state, taken, onMade }: { project: string; state: ProjectState; taken: string[]; onMade: () => void }) {
  const { t } = useI18n()
  const p = state.project
  const suggest = () => {
    const stem = `${p.name}`.replace(/[^a-z0-9_.-]/g, '-').slice(0, 50)
    for (let n = 1; ; n++) if (!taken.includes(`${stem}-${n}`)) return `${stem}-${n}`
  }
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [image, setImage] = useState('')
  const [machine, setMachine] = useState('native')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const postgresql = p.kind === 'postgresql'
  const make = async () => {
    setBusy(true)
    setError(null)
    try {
      await host.createSandbox(project, { name: name.trim(), ...(image.trim() ? { image: image.trim() } : {}), ...(postgresql ? { machine } : {}) })
      setOpen(false)
      onMade()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  if (!open) return <Button size="sm" variant="outline" className="h-7 rounded-xl px-2.5 text-xs" onClick={() => { setName(suggest()); setImage(''); setError(null); setOpen(true) }}><Plus className="size-3.5" />{t('New Sandbox')}</Button>
  return <form className="flex w-full flex-wrap items-end gap-2 border-t border-border/70 px-5 py-3" onSubmit={(e) => { e.preventDefault(); void make() }}>
    <label className="flex min-w-40 flex-1 flex-col gap-1 text-[11px] text-muted-foreground">{t('Name')}
      <Input value={name} onChange={(e) => setName(e.target.value)} className="h-8 rounded-xl font-mono text-xs" autoFocus spellCheck={false} /></label>
    <label className="flex min-w-48 flex-1 flex-col gap-1 text-[11px] text-muted-foreground">{t('Image')}
      <Input value={image} onChange={(e) => setImage(e.target.value)} placeholder={t('the machine’s image')} className="h-8 rounded-xl font-mono text-xs" spellCheck={false} /></label>
    <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">{t('Machine')}
      {postgresql ? (
        <select value={machine} onChange={(e) => setMachine(e.target.value)} className="h-8 rounded-xl border bg-background px-2 text-xs">
          <option value="native">native</option>
          <option value="docker">docker</option>
        </select>
      ) : <span className="flex h-8 items-center rounded-xl bg-muted/40 px-2.5 font-mono text-xs" title={t('A sqlite project’s Sandboxes run on its Store’s machine')}>{p.machine ?? '?'}</span>}
    </label>
    <Button type="submit" size="sm" className="h-8 rounded-xl" disabled={busy || !name.trim()}>{busy && <LoaderCircle className="size-3.5 animate-spin" />}{t('Create')}</Button>
    <Button type="button" size="sm" variant="ghost" className="h-8 rounded-xl" onClick={() => setOpen(false)} disabled={busy}>{t('Cancel')}</Button>
    {error && <p role="alert" className="w-full text-xs text-destructive">{error}</p>}
  </form>
}

function SandboxesCard({ sandboxes, reading, unavailable, onBrowseFiles, onChanged, create }: { sandboxes: SandboxInfo[]; reading: boolean; unavailable: boolean; onBrowseFiles?: (branch: string) => void; onChanged?: () => void; create?: React.ReactNode }) {
  const { t } = useI18n()
  const open = sandboxes.filter((sandbox) => sandbox.state !== 'gone')
  const mounted = open.reduce((count, sandbox) => count + sandbox.workspaces.length, 0)
  const mountsKnown = !reading && !unavailable && !open.some((sandbox) => sandbox.reach)
  return <section className="glass-liquid overflow-hidden rounded-2xl">
    <header className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
      <h3 className="text-sm font-semibold">{t('Sandboxes')}</h3>
      <span className="flex items-center gap-3">
        {open.length > 0 && <p className="text-xs text-muted-foreground tabular-nums">
          {mountsKnown ? t('{sandboxes} recorded · {workspaces} mounted', { sandboxes: open.length, workspaces: mounted }) : t('{count} recorded Sandboxes', { count: open.length })}
        </p>}
        {create}
      </span>
    </header>
    <GapLine what="A Sandbox’s live state (running, exited) beside its record" className="px-5 pb-3" />
    <SandboxTiles sandboxes={sandboxes} reading={reading} unavailable={unavailable} onBrowseFiles={onBrowseFiles} onChanged={onChanged} />
  </section>
}

/** Browse opens the mounted branch in the surrounding project's Files view. */
export function ProjectSandboxesContent({ project, state, tick, onBrowseFiles }: { project: string; state: ProjectState; tick?: unknown; onBrowseFiles?: (branch: string) => void }) {
  const { t } = useI18n()
  const q = useProjectSandboxes(project, 5000, tick)
  return <div className="space-y-3">
    {q.error && <div role="alert" className="flex items-center gap-3 rounded-xl border border-destructive/15 bg-destructive/[0.03] px-4 py-3 text-xs">
      <p className="min-w-0 flex-1 break-words text-destructive">{q.error.message}</p>
      <button type="button" onClick={q.reload} disabled={q.loading} className="shrink-0 rounded-lg px-2 py-1.5 font-medium outline-none hover:bg-destructive/5 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">{t('Retry')}</button>
    </div>}
    <SandboxesCard sandboxes={q.data ?? state.sandboxes} reading={q.loading && !q.data} unavailable={!!q.error && !q.data} onBrowseFiles={onBrowseFiles} onChanged={q.reload}
      create={<NewSandbox project={project} state={state} taken={(q.data ?? state.sandboxes).map((s) => s.name)} onMade={q.reload} />} />
  </div>
}
