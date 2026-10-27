import { HardDrive, Info, Plus } from 'lucide-react'
import { useState } from 'react'

import { PageHeader } from '@/components/motion/page-header'
import { LoadError, Loading } from '@/components/projects/states'
import { Chip } from '@/components/storage/chips'
import { DatabaseIcon, PROVIDER_LABEL, type Provider, ProviderIcon, Tile } from '@/components/storage/icons'
import { LocalDetail, NOT_YET, workerChip } from '@/components/storage/local-detail'
import { Unavailable } from '@/components/storage/unavailable'
import { Button } from '@/components/ui/button'
import { host } from '@/host/client'
import { useHostQuery } from '@/host/use-host'
import { cn } from '@/lib/utils'

type Choice = 'local' | 'postgres' | Provider

const PROVIDERS: Provider[] = ['google-drive', 's3', 'r2', 'minio', 'folder']

const ABOUT: Record<Exclude<Choice, 'local'>, { title: string; body: string }> = {
  postgres: {
    title: 'PostgreSQL',
    body: 'A PostgreSQL database over HTTP would hold projects live, with nothing to push or pull, and let cloud Sandboxes open them.',
  },
  'google-drive': { title: PROVIDER_LABEL['google-drive'], body: 'Whole-file copies of a local Store, pulled in and pushed back.' },
  s3: { title: PROVIDER_LABEL.s3, body: 'Whole-file copies of a local Store in an S3 bucket, pulled in and pushed back.' },
  r2: { title: PROVIDER_LABEL.r2, body: 'Whole-file copies of a local Store in an R2 bucket, pulled in and pushed back.' },
  minio: { title: PROVIDER_LABEL.minio, body: 'Whole-file copies of a local Store in a MinIO bucket, pulled in and pushed back.' },
  folder: { title: PROVIDER_LABEL.folder, body: 'Whole-file copies of a local Store in a folder, such as a backup disk.' },
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

  const row = (id: Choice, icon: React.ReactNode, title: string, note: React.ReactNode) => (
    <li key={id}>
      <button
        type="button"
        aria-current={selected === id ? 'true' : undefined}
        onClick={() => setSelected(id)}
        className={cn(
          'flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring',
          selected === id ? 'bg-card shadow-xs ring-1 ring-border' : 'hover:bg-foreground/[0.04]',
          id !== 'local' && selected !== id && 'opacity-70',
        )}
      >
        {icon}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{title}</span>
          <span className="block truncate text-xs text-faint">{note}</span>
        </span>
      </button>
    </li>
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

      <div className="flex min-h-0 flex-1 gap-6 px-8">
        <nav aria-label="Storage" className="w-72 shrink-0 overflow-y-auto pb-8">
          <div className="mb-6">
            <div className="mb-2 px-2">
              <h2 className="text-[13px] font-semibold">Local storage</h2>
              <p className="truncate font-mono text-[11px] text-faint">{status?.settings.home ?? 'This machine'}</p>
            </div>
            <ul className="flex flex-col gap-0.5">
              {row(
                'local',
                <Tile size="sm">
                  <HardDrive aria-hidden="true" />
                </Tile>,
                'Local SQLite',
                projects
                  ? `${projects.length} project${projects.length === 1 ? '' : 's'}${status ? ` · ${workerChip(status).label.toLowerCase()}` : ''}`
                  : 'Reading…',
              )}
            </ul>
          </div>
          <div className="mb-6">
            <div className="mb-2 flex items-center gap-2 px-2">
              <h2 className="text-[13px] font-semibold">Remote storage</h2>
              <Chip tone="neutral">Not available yet</Chip>
            </div>
            <ul className="flex flex-col gap-0.5">
              {row('postgres', <DatabaseIcon kind="postgres" size="sm" />, 'PostgreSQL', 'Live over HTTP')}
            </ul>
          </div>
          <div className="mb-6">
            <div className="mb-2 flex items-center gap-2 px-2">
              <h2 className="text-[13px] font-semibold">Sync locations</h2>
              <Chip tone="neutral">Not available yet</Chip>
            </div>
            <ul className="flex flex-col gap-0.5">
              {PROVIDERS.map((p) => row(p, <ProviderIcon provider={p} size="sm" />, PROVIDER_LABEL[p], 'Whole-file copies'))}
            </ul>
          </div>
        </nav>

        <div className="min-w-0 flex-1 overflow-y-auto pb-8">
          {selected === 'local' ? (
            status && projects ? (
              <LocalDetail status={status} projects={projects} onOpenRun={onOpenRun} />
            ) : q.error ? (
              <LoadError error={q.error} what="the local storage" onRetry={q.reload} />
            ) : (
              <Loading label="Reading the LayerFS home" />
            )
          ) : (
            <div className="flex flex-col gap-5">
              <header className="flex items-start gap-4">
                {selected === 'postgres' ? <DatabaseIcon kind="postgres" size="lg" /> : <ProviderIcon provider={selected} size="lg" />}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <h2 className="text-xl font-semibold tracking-[-0.01em]">{ABOUT[selected].title}</h2>
                    <Chip tone="neutral">Not available yet</Chip>
                  </div>
                  <p className="mt-1 max-w-xl text-sm text-muted-foreground">{ABOUT[selected].body}</p>
                </div>
              </header>
              <p className="flex items-start gap-2 rounded-xl border border-dashed px-4 py-3 text-[13px] text-muted-foreground">
                <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-faint" />
                LayerFS keeps every project in a local SQLite Store today. Remote storage waits on LayerFS remotes (#446).
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
