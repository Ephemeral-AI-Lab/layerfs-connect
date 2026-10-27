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
import { useHostQuery } from '@/host/use-host'
import { cn } from '@/lib/utils'

import '@/components/storage/storage.css'

type Choice = 'local' | 'postgres' | Provider

const PROVIDERS: Provider[] = ['google-drive', 's3', 'r2', 'minio', 'folder']

const ABOUT: Record<Exclude<Choice, 'local'>, { title: string; body: string; kind: string }> = {
  postgres: {
    title: 'PostgreSQL',
    kind: 'Remote storage',
    body: 'A PostgreSQL database over HTTP would hold projects live, with nothing to push or pull, and let cloud Sandboxes open them.',
  },
  'google-drive': {
    title: PROVIDER_LABEL['google-drive'],
    kind: 'Sync location',
    body: 'Whole-file copies of a local Store, pulled in and pushed back.',
  },
  s3: {
    title: PROVIDER_LABEL.s3,
    kind: 'Sync location',
    body: 'Whole-file copies of a local Store in an S3 bucket, pulled in and pushed back.',
  },
  r2: {
    title: PROVIDER_LABEL.r2,
    kind: 'Sync location',
    body: 'Whole-file copies of a local Store in an R2 bucket, pulled in and pushed back.',
  },
  minio: {
    title: PROVIDER_LABEL.minio,
    kind: 'Sync location',
    body: 'Whole-file copies of a local Store in a MinIO bucket, pulled in and pushed back.',
  },
  folder: {
    title: PROVIDER_LABEL.folder,
    kind: 'Sync location',
    body: 'Whole-file copies of a local Store in a folder, such as a backup disk.',
  },
}

/** One stop on a not-yet path: a quiet tile and its name. */
function Stop({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span className="flex min-w-0 flex-col items-center gap-1.5 text-center">
      <span className="sc-soon-mark">{icon}</span>
      <span className="max-w-24 truncate text-[11px] text-muted-foreground">{label}</span>
    </span>
  )
}

/** A dashed link between stops, named by what would travel along it. */
function Link({ label }: { label: string }) {
  return (
    <span className="flex min-w-10 flex-1 flex-col items-center gap-1 pb-5">
      <span className="text-[10px] text-faint">{label}</span>
      <span aria-hidden="true" className="h-px w-full border-t border-dashed border-foreground/20" />
    </span>
  )
}

/** Where history would go: PostgreSQL holds it live for cloud Sandboxes; a sync location keeps copies of a local Store. */
function SoonPath({ choice }: { choice: Exclude<Choice, 'local'> }) {
  const local = (
    <Stop
      label="Local SQLite"
      icon={
        <Tile size="md">
          <HardDrive aria-hidden="true" />
        </Tile>
      }
    />
  )
  return (
    <div className="mt-3 flex max-w-md items-start gap-2" role="img" aria-label={choice === 'postgres' ? 'Connect and cloud Sandboxes both open projects in PostgreSQL' : `A local Store copied to and from ${ABOUT[choice].title}`}>
      {choice === 'postgres' ? (
        <>
          <Stop label="Connect" icon={<Tile size="md"><Laptop aria-hidden="true" /></Tile>} />
          <Link label="live over HTTP" />
          <Stop label="PostgreSQL" icon={<DatabaseIcon kind="postgres" size="md" />} />
          <Link label="opens projects" />
          <Stop label="Cloud Sandboxes" icon={<Tile size="md"><Cloud aria-hidden="true" /></Tile>} />
        </>
      ) : (
        <>
          {local}
          <Link label="push and pull" />
          <Stop label={ABOUT[choice].title} icon={<Tile size="md"><ProviderGlyph provider={choice} /></Tile>} />
        </>
      )}
    </div>
  )
}

/** A not-yet choice's detail: what it would be, why it waits, and what works today. */
function SoonDetail({ choice }: { choice: Exclude<Choice, 'local'> }) {
  const about = ABOUT[choice]
  return (
    <div className="flex flex-col gap-5">
      <header className="reveal flex items-start gap-4">
        <span className="relative">
          <span aria-hidden="true" className="bg-brand absolute -inset-3 rounded-full opacity-[0.12] blur-xl" />
          {choice === 'postgres' ? (
            <DatabaseIcon kind="postgres" size="lg" />
          ) : (
            <Tile size="lg">
              <ProviderGlyph provider={choice} />
            </Tile>
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium tracking-wide text-faint uppercase">{about.kind}</p>
          <div className="mt-0.5 flex flex-wrap items-center gap-2.5">
            <h2 className="text-xl font-semibold tracking-[-0.01em]">{about.title}</h2>
            <Chip tone="neutral" icon={Clock}>
              Not available yet
            </Chip>
          </div>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground text-pretty">{about.body}</p>
        </div>
      </header>

      <section className="sc-soon reveal overflow-hidden rounded-xl" style={revealStyle(1)}>
        <div className="flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <h3 className="text-[11px] font-medium tracking-wide text-faint uppercase">How it would work</h3>
            <SoonPath choice={choice} />
          </div>
          <Unavailable reason={NOT_YET}>
            <Button variant="outline" size="sm" disabled>
              <Plus /> Connect {about.title}
            </Button>
          </Unavailable>
        </div>
        <p className="flex items-start gap-2 border-t border-dashed px-5 py-3 text-xs text-muted-foreground">
          <HardDrive aria-hidden="true" className="mt-px size-3.5 shrink-0 text-faint" />
          LayerFS keeps every project in a local SQLite Store today. Remote storage waits on LayerFS remotes (#446).
        </p>
      </section>
    </div>
  )
}

interface StoragePageProps {
  /** Dev aid: 'local', 'postgres' or a provider to select first. */
  initialId?: string
  /** Opens a project a demo run made. */
  onOpenRun?: (runId: string) => void
}

export function StoragePage({ initialId, onOpenRun }: StoragePageProps) {
  const [selected, setSelected] = useState<Choice>(
    () => (['local', 'postgres', ...PROVIDERS] as Choice[]).find((c) => c === initialId) ?? 'local',
  )
  const q = useHostQuery(() => Promise.all([host.status(), host.projects()]), [])
  const [status, projects] = q.data ?? []
  const pick = useIndicator<HTMLElement, HTMLSpanElement>({ selector: '[aria-current="true"]' })
  const choose = (id: Choice) => {
    if (id !== selected) viewTransition(() => setSelected(id), 'tab')
  }

  let n = 0
  const row = (id: Choice, icon: React.ReactNode, title: string, note: React.ReactNode, soon?: boolean) => (
    <li key={id} className="reveal" style={revealStyle(n++)}>
      <button
        type="button"
        aria-current={selected === id ? 'true' : undefined}
        onClick={() => choose(id)}
        className={cn(
          'group relative flex w-full items-center gap-3 rounded-[0.6rem] px-2 py-2 text-left outline-none transition-colors duration-(--dur-fast) focus-visible:ring-2 focus-visible:ring-ring',
          selected !== id && 'hover:bg-foreground/[0.04]',
        )}
      >
        <span className={cn('transition-opacity duration-(--dur-base)', soon && selected !== id && 'opacity-60 grayscale group-hover:opacity-90 group-hover:grayscale-0')}>
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className={cn('block truncate text-sm font-medium', soon && selected !== id && 'text-muted-foreground')}>{title}</span>
          <span className="block truncate text-xs text-faint">{note}</span>
        </span>
        {soon && (
          <Clock aria-label="Not available yet" className="size-3.5 shrink-0 text-faint opacity-0 transition-opacity group-hover:opacity-100 group-aria-[current=true]:opacity-100" />
        )}
      </button>
    </li>
  )
  const group = (title: string, sub: React.ReactNode, soon: boolean, rows: React.ReactNode) => (
    <div className="mb-6">
      <div className="mb-2 flex items-center gap-2 px-2">
        <div className="min-w-0 flex-1">
          <h2 className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{title}</h2>
          {sub && <p className="truncate font-mono text-[11px] text-faint">{sub}</p>}
        </div>
        {soon && (
          <span className="rounded-full border border-dashed px-1.5 py-px text-[10px] font-medium text-faint" title={NOT_YET}>
            Not available yet
          </span>
        )}
      </div>
      <ul className="flex flex-col gap-0.5">{rows}</ul>
    </div>
  )

  return (
    <div className="flex h-svh flex-col">
      <PageHeader
        title="Storage"
        description="Where projects' history lives. Each LayerFS project is one SQLite Store, in its own Docker volume."
        actions={
          <Unavailable reason={NOT_YET}>
            <Button disabled>
              <Plus /> Add storage
            </Button>
          </Unavailable>
        }
      />

      <div className="flex min-h-0 flex-1 gap-8 px-8">
        <nav ref={pick.container} aria-label="Storage" className="relative w-72 shrink-0 overflow-y-auto pt-1 pb-8">
          <span ref={pick.indicator} aria-hidden="true" className="indicator sc-pick" />
          {group(
            'Local storage',
            status?.settings.home ?? 'This machine',
            false,
            row(
              'local',
              <Tile size="sm" className="text-primary">
                <HardDrive aria-hidden="true" />
              </Tile>,
              'Local SQLite',
              projects
                ? `${projects.length} project${projects.length === 1 ? '' : 's'}${status ? ` · ${workerChip(status).label.toLowerCase()}` : ''}`
                : 'Reading…',
            ),
          )}
          {group('Remote storage', null, true, row('postgres', <DatabaseIcon kind="postgres" size="sm" />, 'PostgreSQL', 'Live over HTTP', true))}
          {group(
            'Sync locations',
            null,
            true,
            PROVIDERS.map((p) =>
              row(
                p,
                <Tile size="sm">
                  <ProviderGlyph provider={p} />
                </Tile>,
                PROVIDER_LABEL[p],
                'Whole-file copies',
                true,
              ),
            ),
          )}
        </nav>

        <div className="vt-panel min-w-0 flex-1 overflow-y-auto pt-1 pb-8" style={{ scrollbarGutter: 'stable' } as CSSProperties}>
          {selected === 'local' ? (
            status && projects ? (
              <LocalDetail status={status} projects={projects} onOpenRun={onOpenRun} />
            ) : q.error ? (
              <LoadError error={q.error} what="the local storage" onRetry={q.reload} />
            ) : (
              <Loading label="Reading the LayerFS home" />
            )
          ) : (
            <SoonDetail choice={selected} />
          )}
        </div>
      </div>
    </div>
  )
}
