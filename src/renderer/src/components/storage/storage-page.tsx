import { t, useI18n } from '@/i18n'
// The Storage page: a list of where projects' history can live on the left
// (a lit card glides behind the chosen one), its detail on the right, which
// cross-fades when the choice changes. Only Local SQLite works today; the rest
// are shown as quiet "not available yet" entries.
import { Clock, Cloud, HardDrive, Laptop, Plus } from 'lucide-react'
import { type CSSProperties, useState } from 'react'

import { PageHeader, revealStyle, useIndicator, viewTransition } from '@/components/motion'
import { LoadError, Loading } from '@/components/projects/states'
import { Chip } from '@/components/storage/chips'
import { DatabaseIcon, PROVIDER_LABEL, type Provider, ProviderGlyph, Tile } from '@/components/storage/icons'
import { LocalDetail, NOT_YET, workerChip } from '@/components/storage/local-detail'
import { Unavailable } from '@/components/storage/unavailable'
import { Button } from '@/components/ui/button'
import { host } from '@/host/client'
import { useHostEvents, useHostQuery } from '@/host/use-host'
import type { ProjectCatalog } from '@/host/use-projects'
import { cn } from '@/lib/utils'

import '@/components/storage/storage.css'

type Choice = 'local' | 'postgres' | Provider

const PROVIDERS: Provider[] = ['google-drive', 's3', 'r2', 'minio', 'folder']

const PROVIDER_DESC: Record<Provider, string> = {
  'google-drive': 'Cloud backup archive',
  s3: 'AWS S3 bucket store',
  r2: 'Cloudflare R2 replica',
  minio: 'Self-hosted S3 object store',
  folder: 'Local directory backup',
}

const ABOUT: Record<Exclude<Choice, 'local'>, { title: string; body: string; kind: string }> = {
  postgres: {
    title: 'PostgreSQL',
    kind: 'Remote storage',
    body: 'Relational database over HTTP for concurrent multi-agent access.',
  },
  'google-drive': {
    title: PROVIDER_LABEL['google-drive'],
    kind: 'Sync location',
    body: 'Encrypted backup copies in Google Drive.',
  },
  s3: {
    title: PROVIDER_LABEL.s3,
    kind: 'Sync location',
    body: 'Snapshot replicas in Amazon S3 bucket.',
  },
  r2: {
    title: PROVIDER_LABEL.r2,
    kind: 'Sync location',
    body: 'Zero-egress object replication in Cloudflare R2.',
  },
  minio: {
    title: PROVIDER_LABEL.minio,
    kind: 'Sync location',
    body: 'Self-hosted S3-compatible snapshot store.',
  },
  folder: {
    title: PROVIDER_LABEL.folder,
    kind: 'Sync location',
    body: 'Local directory or external volume backup.',
  },
}

/** One stop on a not-yet path: a quiet tile and its name. */
function Stop({ icon, label }: { icon: React.ReactNode; label: string }) {
  useI18n()
  return (
    <span className="flex min-w-0 flex-col items-center gap-1.5 text-center">
      <span className="sc-soon-mark">{icon}</span>
      <span className="max-w-28 truncate text-[11px] text-muted-foreground">{t(label)}</span>
    </span>
  )
}

/** A dashed link between stops, named by what would travel along it. */
function Link({ label }: { label: string }) {
  useI18n()
  return (
    <span className="flex min-w-10 flex-1 flex-col items-center gap-1 pb-5">
      <span className="text-[10px] text-faint">{t(label)}</span>
      <span aria-hidden="true" className="h-px w-full border-t border-dashed border-foreground/20" />
    </span>
  )
}

/** Where history would go: PostgreSQL holds it live for cloud Sandboxes; a sync location keeps copies of a local Store. */
function SoonPath({ choice }: { choice: Exclude<Choice, 'local'> }) {
  useI18n()
  const local = (
    <Stop
      label={t("Local SQLite")}
      icon={
        <Tile size="md">
          <HardDrive aria-hidden="true" />
        </Tile>
      }
    />
  )
  return (
    <div className="mt-3 flex max-w-md items-start gap-2" role="img" aria-label={choice === 'postgres' ? t("Connect and cloud Sandboxes both open projects in PostgreSQL") : t("A local Store copied to and from {value1}", {value1: ABOUT[choice].title})}>
      {choice === 'postgres' ? (
        <>
          <Stop label={t("Connect")} icon={<Tile size="md"><Laptop aria-hidden="true" /></Tile>} />
          <Link label={t("live over HTTP")} />
          <Stop label={t("PostgreSQL")} icon={<DatabaseIcon kind="postgres" size="md" />} />
          <Link label={t("opens projects")} />
          <Stop label={t("Cloud Sandboxes")} icon={<Tile size="md"><Cloud aria-hidden="true" /></Tile>} />
        </>
      ) : (
        <>
          {local}
          <Link label={t("push & pull")} />
          <Stop label={ABOUT[choice].title} icon={<Tile size="md"><ProviderGlyph provider={choice} /></Tile>} />
        </>
      )}
    </div>
  )
}

/** A not-yet choice's detail: what it would be, why it waits, and what works today. */
function SoonDetail({ choice }: { choice: Exclude<Choice, 'local'> }) {
  useI18n()
  const about = ABOUT[choice]
  return (
    <div className="@container/storage-detail flex min-w-0 flex-col gap-6">
      <header className="reveal flex items-start gap-4">
        <div className="glass-liquid flex size-12 shrink-0 items-center justify-center rounded-2xl border border-border/50 shadow-xs">
          {choice === 'postgres' ? (
            <DatabaseIcon kind="postgres" size="md" />
          ) : (
            <ProviderGlyph provider={choice} />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[10.5px] font-semibold tracking-wider uppercase text-muted-foreground/80">
            <span>{t(about.kind)}</span>
            <span>·</span>
            <span>{choice === 'postgres' ? t("PostgreSQL Cluster") : t("Remote Replication")}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2.5">
            <h2 className="text-xl font-semibold tracking-tight text-foreground">{about.title}</h2>
            <Chip tone="neutral" icon={Clock}>{t("Planned for remotes")}</Chip>
          </div>
          <p className="mt-1 max-w-xl text-xs text-muted-foreground">{t(about.body)}</p>
        </div>
      </header>

      <section className="glass-liquid spotlight reveal rounded-2xl p-5 shadow-xs" style={revealStyle(1)}>
        <div className="flex min-w-0 flex-col gap-4 @min-[38rem]/storage-detail:flex-row @min-[38rem]/storage-detail:items-center">
          <div className="min-w-0 flex-1">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-faint">{t("Architecture & Data Flow")}</h3>
            <SoonPath choice={choice} />
          </div>
          <Unavailable reason={NOT_YET}>
            <Button variant="outline" size="sm" className="rounded-xl px-3.5" disabled>
              <Plus className="mr-1 size-3.5" />{t("Connect ")}{about.title}
            </Button>
          </Unavailable>
        </div>
        <div className="mt-4 flex items-center gap-2 border-t pt-3.5 text-xs text-muted-foreground font-medium">
          <HardDrive aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
          <span>{t("Primary store in local SQLite · Remote sync via S3 & PostgreSQL")}</span>
        </div>
      </section>
    </div>
  )
}

interface StoragePageProps {
  catalog: ProjectCatalog
  /** Dev aid: 'local', 'postgres' or a provider to select first. */
  initialId?: string
  onOpenProject?: (project: string) => void
}

export function StoragePage({ catalog, initialId, onOpenProject }: StoragePageProps) {
  useI18n()
  const [selected, setSelected] = useState<Choice>(
    () => (['local', 'postgres', ...PROVIDERS] as Choice[]).find((c) => c === initialId) ?? 'local',
  )
  const q = useHostQuery(() => host.status(), [catalog.removed])
  useHostEvents((e) => {
    if (e.type === 'run-removed') { q.reload(); catalog.reload() }
  })
  const status = q.data
  const projects = catalog.data
  const error = q.error ?? catalog.error
  const pick = useIndicator<HTMLElement, HTMLSpanElement>({ selector: '[aria-current="true"]' })
  const choose = (id: Choice) => {
    if (id !== selected) viewTransition(() => setSelected(id), 'tab')
  }

  let n = 0
  const row = (id: Choice, icon: React.ReactNode, title: string, note: React.ReactNode, soon?: boolean) => (
    <li key={id} className="reveal min-w-0" style={revealStyle(n++)}>
      <button
        type="button"
        aria-current={selected === id ? 'true' : undefined}
        onClick={() => choose(id)}
        className={cn(
          'group relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left outline-none transition-colors duration-(--dur-fast) focus-visible:ring-2 focus-visible:ring-ring',
          selected !== id ? 'hover:bg-foreground/[0.04]' : '',
        )}
      >
        <span className={cn('transition-opacity duration-(--dur-base)', soon && selected !== id && 'opacity-70 group-hover:opacity-100')}>
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className={cn('block truncate text-[13px] font-medium transition-colors', selected === id ? 'text-primary font-semibold' : 'text-foreground')}>
            {t(title)}
          </span>
          <span className="block truncate text-[11px] text-muted-foreground">{typeof note === 'string' ? t(note) : note}</span>
        </span>
        {soon && (
          <span className="rounded-full bg-muted/70 px-2 py-0.5 text-[10px] font-medium text-muted-foreground ring-1 ring-foreground/[0.05]">{t("Soon")}</span>
        )}
      </button>
    </li>
  )

  const group = (title: string, soon: boolean, rows: React.ReactNode) => (
    <div className="mb-5 @min-[60rem]/workspace:mb-6">
      <div className="mb-2.5 flex items-center justify-between px-2.5">
        <h2 className="text-[10.5px] font-semibold tracking-wider text-muted-foreground/80 uppercase">{t(title)}</h2>
        {soon && (
          <span className="rounded-full bg-muted/60 px-2 py-0.5 text-[9.5px] text-muted-foreground font-semibold ring-1 ring-border/40">{t("Upcoming")}</span>
        )}
      </div>
      <ul className="grid grid-cols-1 gap-1.5 @min-[30rem]/workspace:grid-cols-2 @min-[46rem]/workspace:grid-cols-3 @min-[60rem]/workspace:grid-cols-1">{rows}</ul>
    </div>
  )

  return (
    <div className="flex h-svh min-w-0 flex-col">
      <PageHeader
        title={t("Storage")}
        description={t("SQLite embedded volumes, PostgreSQL clusters, and object stores.")}

      />

      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto px-6 @min-[56rem]/workspace:px-8 @min-[60rem]/workspace:flex @min-[60rem]/workspace:gap-6 @min-[60rem]/workspace:overflow-hidden">
        <nav ref={pick.container} aria-label={t("Storage")} className="relative min-w-0 pt-1 pb-3 @min-[60rem]/workspace:w-64 @min-[60rem]/workspace:shrink-0 @min-[60rem]/workspace:overflow-y-auto @min-[60rem]/workspace:pb-8">
          <span ref={pick.indicator} aria-hidden="true" className="indicator sc-pick" />
          {group(
            t('Storage Engines'),
            false,
            <>
              {row(
                'local',
                <Tile size="sm" className="text-primary">
                  <HardDrive aria-hidden="true" />
                </Tile>,
                'Local SQLite',
                projects
                  ? t('{count} projects{worker}', { count: projects.length, worker: status ? ` · ${t(workerChip(status).label)}` : '' })
                  : t('Reading…'),
              )}
              {row('postgres', <DatabaseIcon kind="postgres" size="sm" />, 'PostgreSQL', t('Multi-agent relational cluster'), true)}
            </>,
          )}

          {group(
            t('Sync & Remotes'),
            true,
            PROVIDERS.map((p) =>
              row(
                p,
                <Tile size="sm">
                  <ProviderGlyph provider={p} />
                </Tile>,
                PROVIDER_LABEL[p],
                t(PROVIDER_DESC[p]),
                true,
              ),
            ),
          )}
        </nav>

        <div className="vt-panel min-w-0 pt-1 pb-8 @min-[60rem]/workspace:flex-1 @min-[60rem]/workspace:overflow-y-auto" style={{ scrollbarGutter: 'stable' } as CSSProperties}>
          {selected === 'local' ? (
            status && projects ? (
              <LocalDetail status={status} projects={projects} onOpenProject={onOpenProject} />
            ) : error ? (
              <LoadError error={error} what={t("the local storage")} onRetry={() => { q.reload(); catalog.reload() }} />
            ) : (
              <Loading label={t("Reading the LayerFS home")} />
            )
          ) : (
            <SoonDetail choice={selected} />
          )}
        </div>
      </div>
    </div>
  )
}
