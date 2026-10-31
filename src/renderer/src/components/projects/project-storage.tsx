import { useI18n } from '@/i18n'
import { ChevronDown } from 'lucide-react'
import type { ReactNode } from 'react'
import type { ProjectState, SandboxInfo, StoreStats } from '@shared/host-api'

import { SandboxTiles } from '@/components/projects/sandbox-tiles'
import { useProjectSandboxes } from '@/components/projects/use-sandboxes'
import type { StoreFacts } from '@/components/projects/store-facts'
import { CommitStorageTable, GrowthChart, times } from '@/components/projects/store-visuals'
import { StoreIcon } from '@/components/storage/identity/store-icon'
import { bytes, when } from '@/data/format'

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return <div className="min-w-0">
    <dt className="text-xs text-muted-foreground">{label}</dt>
    <dd className="mt-1 break-words text-[13px] tabular-nums">{children}</dd>
  </div>
}

function StorageDetails({ s, store, stats }: { s: ProjectState; store: StoreFacts; stats: StoreStats | null }) {
  const { t } = useI18n()
  return <details className="group border-t border-border/70">
    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-lg px-5 py-4 text-[13px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
      {t('Storage details')}<ChevronDown className="size-4 text-muted-foreground group-open:rotate-180" />
    </summary>
    <dl className="grid gap-x-6 gap-y-4 px-5 pb-5 sm:grid-cols-2 lg:grid-cols-3">
      <Fact label={t('Created')}>{when(s.project.created)}</Fact>
      <Fact label={t(store.family === 'postgresql' ? 'Connection' : 'Volume')}>
        <span className="text-xs">{store.family === 'postgresql' ? store.connection ?? '—' : s.project.volume ?? '—'}</span>
      </Fact>
      {stats && <>
        <Fact label={t('Current snapshot')}>{bytes(stats.main)}</Fact>
        <Fact label={t('dedupe')}>{times(stats.dedupe)}</Fact>
        <Fact label={t('compression')}>{times(stats.compression)}</Fact>
        <Fact label={t('metadata')}>{bytes(stats.metadata)}</Fact>
        {store.family === 'sqlite' && <><Fact label={t('SQLite pages')}>{bytes(stats.file)}</Fact><Fact label={t('free')}>{bytes(stats.free)}</Fact></>}
        {stats.init && <Fact label={t('from Init')}>{t('{count} files · {size}', { count: stats.init.files, size: bytes(stats.init.bytes) })}</Fact>}
      </>}
      <div className="sm:col-span-2 lg:col-span-3">
        <Fact label={t('Store file')}><span className="break-all font-mono text-xs">{s.store.path ?? '—'}</span></Fact>
      </div>
    </dl>
  </details>
}

/** Capacity first; paths and storage history stay available on demand. */
export function ProjectStorageContent({ state: s, store }: { state: ProjectState; store: StoreFacts }) {
  const { t } = useI18n()
  const stats = s.storage
  const metrics = [
    { label: 'On disk', value: s.store.bytes ?? stats?.file ?? null },
    { label: 'raw history', value: stats?.logical ?? null },
    { label: 'Unique', value: stats?.canonical ?? null },
    { label: 'Compressed', value: stats?.stored ?? null },
  ]
  return <section className="glass-liquid overflow-hidden rounded-2xl">
    <header className="flex min-w-0 items-center gap-3 px-5 py-4">
      <StoreIcon family={store.family} providers={store.providers} size="sm" />
      <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">{store.name || t('Project Store')}</h3>
      <span className="shrink-0 text-xs text-muted-foreground">{store.family === 'postgresql' ? 'PostgreSQL' : 'SQLite'}</span>
      {store.link && <span className="max-w-[40%] truncate text-xs text-muted-foreground" title={store.link.object}>{store.link.remote} / {store.link.file}</span>}
    </header>
    <dl className="grid grid-cols-2 gap-x-5 gap-y-5 px-5 pt-2 pb-6 sm:grid-cols-4">
      {metrics.map(({ label, value }) => <div key={label} className="min-w-0">
        <dt className="text-xs text-muted-foreground">{t(label)}</dt>
        <dd className="mt-1.5 text-xl font-medium tracking-tight tabular-nums">{bytes(value)}</dd>
      </div>)}
    </dl>
    {store.shared && <p className="px-5 pb-4 text-xs leading-relaxed text-muted-foreground">{t('Shared Store. Sync affects its other projects.')}</p>}
    {!stats && <p className="px-5 pb-4 text-xs text-muted-foreground">{t('Storage totals unavailable.')}</p>}
    <StorageDetails s={s} store={store} stats={stats} />
    {stats && <details className="group border-t border-border/70">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-lg px-5 py-4 text-[13px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        {t('Storage history')}<ChevronDown className="size-4 text-muted-foreground group-open:rotate-180" />
      </summary>
      <div className="space-y-6 px-5 pt-1 pb-5"><GrowthChart t={stats} /><CommitStorageTable commits={stats.commits} /></div>
    </details>}
  </section>
}

function SandboxesCard({ sandboxes, reading, unavailable, onBrowseFiles }: { sandboxes: SandboxInfo[]; reading: boolean; unavailable: boolean; onBrowseFiles?: (branch: string) => void }) {
  const { t } = useI18n()
  const open = sandboxes.filter((sandbox) => sandbox.state !== 'gone')
  const mounted = open.reduce((count, sandbox) => count + sandbox.workspaces.length, 0)
  const mountsKnown = !reading && !unavailable && !open.some((sandbox) => sandbox.reach)
  return <section className="glass-liquid overflow-hidden rounded-2xl">
    <header className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
      <h3 className="text-sm font-semibold">{t('Sandboxes')}</h3>
      {open.length > 0 && <p className="text-xs text-muted-foreground tabular-nums">
        {mountsKnown ? t('{sandboxes} active · {workspaces} mounted', { sandboxes: open.length, workspaces: mounted }) : t('{count} active sandboxes', { count: open.length })}
      </p>}
    </header>
    <SandboxTiles sandboxes={sandboxes} reading={reading} unavailable={unavailable} onBrowseFiles={onBrowseFiles} />
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
    <SandboxesCard sandboxes={q.data ?? state.sandboxes} reading={q.loading && !q.data} unavailable={!!q.error && !q.data} onBrowseFiles={onBrowseFiles} />
  </div>
}
