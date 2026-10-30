// Pieces of a PostgreSQL Store's card (layerfs-storage.md region 3): where it
// was imported from, and its menu.
import { CornerDownRight, ExternalLink, Trash2 } from 'lucide-react'

import { useStorage } from '@/components/storage/actions'
import { MoreButton } from '@/components/storage/overview/row-parts'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { when } from '@/data/format'
import { t, useI18n } from '@/i18n'
import type { StoreInfo } from '@shared/host-api'

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

/** A PostgreSQL Store's menu: Open and Remove…. */
export function PostgresqlStoreMenu({ store }: { store: StoreInfo }) {
  useI18n()
  const s = useStorage()
  return (
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
  )
}
