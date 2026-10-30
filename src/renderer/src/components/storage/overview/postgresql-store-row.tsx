// One PostgreSQL Store under its connection (storage-redesign §3.1 region 7),
// and the pending row of an import that is still copying into one.
import { CornerDownRight, ExternalLink, Trash2 } from 'lucide-react'

import { count, useStorage } from '@/components/storage/actions'
import { StoreIcon } from '@/components/storage/identity/store-icon'
import { MoreButton } from '@/components/storage/overview/row-parts'
import { SizeText } from '@/components/storage/size'
import { SyncPill } from '@/components/storage/sync/sync-pill'
import { TransferRow } from '@/components/storage/transfers/transfer-row'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ago, when } from '@/data/format'
import { t, useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import type { PostgresqlConnection, StoreInfo, SyncJob } from '@shared/host-api'

/** "↳ from work": a link to the SQLite Store it was imported from. */
export function FromLink({ store }: { store: StoreInfo }) {
  useI18n()
  const s = useStorage()
  const from = store.importedFrom
  if (!from) return <span className="text-faint">—</span>
  const exists = s.view.stores.list.some((x) => x.name === from.store && x.kind === 'sqlite')
  const body = (
    <span className="inline-flex min-w-0 items-center gap-1">
      <CornerDownRight aria-hidden="true" className="size-3 shrink-0 text-faint" />
      <span className="truncate">{t('from {store}', { store: from.store })}</span>
    </span>
  )
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {exists ? (
          <button type="button" onClick={() => s.open({ view: 'store', id: from.store })} className="min-w-0 rounded-md text-[13px] text-muted-foreground outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring">
            {body}
          </button>
        ) : (
          <span className="min-w-0 text-[13px] text-faint">{body}</span>
        )}
      </TooltipTrigger>
      <TooltipContent>{exists ? t('Imported {when}', { when: when(from.at) }) : t('{store} was removed · imported {when}', { store: from.store, when: when(from.at) })}</TooltipContent>
    </Tooltip>
  )
}

export function PostgresqlStoreRow({ store, connection, match }: { store: StoreInfo; connection?: PostgresqlConnection; match?: string | null }) {
  useI18n()
  const s = useStorage()
  const down = connection && (connection.health.state === 'unreachable' || connection.health.state === 'denied')
  const flash = s.flash?.store === store.name ? s.flash.token : null
  const reason = down ? t('{name} is not answering', { name: connection!.name }) : undefined
  return (
    <div
      role="row"
      key={flash ?? undefined}
      id={`store-row-${store.name}`}
      className={cn('sc-row sc-pg-row pl-12 transition-colors duration-(--dur-fast) hover:bg-foreground/[0.025] @max-[759px]/storage:pl-5', flash !== null && 'live-flash [--flash:var(--primary)]')}
    >
      <span role="rowheader" className="sc-a-name flex min-w-0 items-center gap-3">
        <StoreIcon family="postgresql" size="sm" />
        <span className="min-w-0">
          <button type="button" onClick={() => s.open({ view: 'store', id: store.name })} className="block max-w-full truncate rounded-md text-left text-[13.5px] font-semibold tracking-tight outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring">
            {store.name}
          </button>
          {match && <span className="block truncate text-[11.5px] text-muted-foreground">{t('has {project}', { project: match })}</span>}
          <span className="sc-under-name truncate text-[11.5px] text-muted-foreground">{count(store.projects.length, 'project')}</span>
        </span>
      </span>
      <span role="cell" className="sc-a-projects text-[13px] text-muted-foreground tabular-nums" title={store.projects.slice(0, 8).join(', ')}>
        {store.projects.length}
      </span>
      <span role="cell" className="sc-a-size text-[13px]">
        <SizeText store={store} reason={reason} />
      </span>
      <span role="cell" className="sc-a-from min-w-0">
        <FromLink store={store} />
      </span>
      <span role="cell" className="sc-a-created text-[13px] text-muted-foreground tabular-nums" title={when(store.created)}>
        {store.created ? ago(store.created) : '—'}
      </span>
      <span role="cell" className="sc-a-meta items-center gap-2 text-[12px] text-muted-foreground">
        <SizeText store={store} reason={reason} />
        <span aria-hidden="true">·</span>
        {count(store.projects.length, 'project')}
      </span>
      <span role="cell" className="sc-a-pill">
        <SyncPill state="live" />
      </span>
      <span role="cell" className="sc-a-action">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <MoreButton label={t('More for {name}', { name: store.name })} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44 rounded-xl">
            <DropdownMenuItem onSelect={() => s.open({ view: 'store', id: store.name })}>
              <ExternalLink className="text-muted-foreground" /> {t('Open')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => s.remove({ kind: 'store', store })}>
              <Trash2 /> {t('Remove…')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </span>
    </div>
  )
}

/** An import still copying: its name and bar, not openable until it ends (§2.2). */
export function PendingImportRow({ job }: { job: SyncJob }) {
  useI18n()
  return (
    <div role="row" aria-busy="true" className="sc-row sc-pg-row sc-live-row bg-primary/[0.025] pl-12 @max-[759px]/storage:pl-5">
      <span role="rowheader" className="sc-a-name flex min-w-0 items-center gap-3 opacity-80">
        <StoreIcon family="postgresql" size="sm" />
        <span className="truncate text-[13.5px] font-semibold">{job.from ?? t('new Store')}</span>
      </span>
      <span role="cell" className="sc-a-from min-w-0 text-[13px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <CornerDownRight aria-hidden="true" className="size-3 text-faint" /> {t('from {store}', { store: job.store })}
        </span>
      </span>
      <span role="cell" className="sc-a-pill">
        <TransferRow job={job} form="compact" />
      </span>
    </div>
  )
}
