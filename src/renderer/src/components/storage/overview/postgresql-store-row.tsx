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
import { cn } from '@/lib/utils'
import type { PostgresqlConnection, StoreInfo, SyncJob } from '@shared/host-api'

/** "↳ from work": a link to the SQLite Store it was imported from. */
export function FromLink({ store }: { store: StoreInfo }) {
  const s = useStorage()
  const from = store.importedFrom
  if (!from) return <span className="text-faint">—</span>
  const exists = s.view.stores.list.some((x) => x.name === from.store && x.kind === 'sqlite')
  const body = (
    <span className="inline-flex min-w-0 items-center gap-1">
      <CornerDownRight aria-hidden="true" className="size-3 shrink-0 text-faint" />
      <span className="truncate">from {from.store}</span>
    </span>
  )
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {exists ? (
          <button type="button" onClick={() => s.open({ view: 'store', id: from.store })} className="min-w-0 rounded-sm text-[13px] text-muted-foreground outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring">
            {body}
          </button>
        ) : (
          <span className="min-w-0 text-[13px] text-faint">{body}</span>
        )}
      </TooltipTrigger>
      <TooltipContent>{exists ? `Imported ${when(from.at)}` : `${from.store} was removed · imported ${when(from.at)}`}</TooltipContent>
    </Tooltip>
  )
}

export function PostgresqlStoreRow({ store, connection, match }: { store: StoreInfo; connection?: PostgresqlConnection; match?: string | null }) {
  const s = useStorage()
  const down = connection && (connection.health.state === 'unreachable' || connection.health.state === 'denied')
  const flash = s.flash?.store === store.name ? s.flash.token : null
  return (
    <div role="row" key={flash ?? undefined} id={`store-row-${store.name}`} className={cn('sc-row sc-pg-row pl-12 transition-colors duration-(--dur-fast) hover:bg-foreground/[0.025] @max-[759px]/storage:pl-5', flash !== null && 'live-flash [--flash:var(--primary)]')}>
      <span role="rowheader" className="sc-a-name flex min-w-0 items-center gap-2.5">
        <StoreIcon family="postgresql" size="sm" />
        <span className="min-w-0">
          <button type="button" onClick={() => s.open({ view: 'store', id: store.name })} className="block max-w-full truncate rounded-sm text-left text-[13.5px] font-medium outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring">
            {store.name}
          </button>
          {match && <span className="block truncate text-[11.5px] text-muted-foreground">has {match}</span>}
          <span className="sc-under-name truncate text-[11.5px] text-faint">{count(store.projects.length, 'project')}</span>
        </span>
      </span>
      <span role="cell" className="sc-a-projects text-[13px] text-muted-foreground tabular-nums" title={store.projects.slice(0, 8).join(', ')}>
        {store.projects.length}
      </span>
      <span role="cell" className="sc-a-size text-[13px]">
        <SizeText store={store} reason={down ? `${connection!.name} is not answering` : undefined} />
      </span>
      <span role="cell" className="sc-a-from min-w-0">
        <FromLink store={store} />
      </span>
      <span role="cell" className="sc-a-created text-[13px] text-muted-foreground tabular-nums" title={when(store.created)}>
        {store.created ? ago(store.created) : '—'}
      </span>
      <span role="cell" className="sc-a-meta items-center gap-2 text-[12px] text-muted-foreground">
        <SizeText store={store} />
        <span aria-hidden="true">·</span>
        {count(store.projects.length, 'project')}
      </span>
      <span role="cell" className="sc-a-pill">
        <SyncPill state="live" />
      </span>
      <span role="cell" className="sc-a-action">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <MoreButton label={`More for ${store.name}`} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem onSelect={() => s.open({ view: 'store', id: store.name })}>
              <ExternalLink className="text-muted-foreground" /> Open
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => s.remove({ kind: 'store', store })}>
              <Trash2 /> Remove…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </span>
    </div>
  )
}

/** An import still copying: its name and bar, not openable until it ends (§2.2). */
export function PendingImportRow({ job }: { job: SyncJob }) {
  return (
    <div role="row" aria-busy="true" className="sc-row sc-pg-row sc-live-row bg-primary/[0.02] pl-12 @max-[759px]/storage:pl-5">
      <span role="rowheader" className="sc-a-name flex min-w-0 items-center gap-2.5 opacity-80">
        <StoreIcon family="postgresql" size="sm" />
        <span className="truncate text-[13.5px] font-medium">{job.from ?? 'new Store'}</span>
      </span>
      <span role="cell" className="sc-a-from min-w-0 text-[13px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <CornerDownRight aria-hidden="true" className="size-3 text-faint" /> from {job.store}
        </span>
      </span>
      <span role="cell" className="sc-a-pill">
        <TransferRow job={job} form="compact" />
      </span>
    </div>
  )
}
