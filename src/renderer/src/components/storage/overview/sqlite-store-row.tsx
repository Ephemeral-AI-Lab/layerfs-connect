// A SQLite Store's actions (storage-links §2): the menu of every action, on
// its card and its page, and the page's Push and Pull (or Publish…) buttons.
import { ArrowDownToLine, ArrowUpFromLine, CloudUpload, CopyPlus, DatabaseZap, ExternalLink, RefreshCw, Trash2, Unlink } from 'lucide-react'
import { useState } from 'react'

import { useStorage } from '@/components/storage/actions'
import { message } from '@/components/storage/dialogs/fields'
import { MoreButton } from '@/components/storage/overview/row-parts'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { t, useI18n } from '@/i18n'
import type { StoreInfo } from '@shared/host-api'

const BUSY = 'A transfer is running'

/** The menu of every Store action: Publish… or Push/Pull/Check now/Unlink…, Send a copy…, Import, Open, Remove. */
export function StoreMenu({ store, align = 'end' }: { store: StoreInfo; align?: 'start' | 'end' }) {
  useI18n()
  const s = useStorage()
  const running = !!s.transfers.runningFor(store.name)
  const link = store.link
  const noRemotes = !s.view.remotes.list.length
  const empty = !store.projects.length
  const run = (fn: () => Promise<void>) => void fn().catch(() => undefined)
  const icon = 'text-muted-foreground'
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <MoreButton label={t('More for {name}', { name: store.name })} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="w-56 rounded-xl">
        {s.view.remotes.available &&
          (link ? (
            <>
              <DropdownMenuItem onSelect={() => run(() => s.push(store))} disabled={running || empty}>
                <ArrowUpFromLine className={icon} /> {t('Push')}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => run(() => s.pull(store))} disabled={running}>
                <ArrowDownToLine className={icon} /> {t('Pull')}
              </DropdownMenuItem>
              {s.view.supports.check && (
                <DropdownMenuItem onSelect={() => run(() => s.check({ store: store.name }))}>
                  <RefreshCw className={icon} /> {t('Check now')}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={() => s.send(store)} disabled={running || empty}>
                <CopyPlus className={icon} /> {t('Send a copy…')}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => s.unlink(store)} disabled={running}>
                <Unlink className={icon} /> {t('Unlink…')}
              </DropdownMenuItem>
            </>
          ) : (
            <>
              <DropdownMenuItem onSelect={() => s.publish(store)} disabled={running || empty || noRemotes}>
                <CloudUpload className={icon} /> {t('Publish…')}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => s.send(store)} disabled={running || empty || noRemotes}>
                <CopyPlus className={icon} /> {t('Send a copy…')}
              </DropdownMenuItem>
            </>
          ))}
        {s.view.postgresql.available && (
          <DropdownMenuItem onSelect={() => s.importInto({ store: store.name })}>
            <DatabaseZap className={icon} /> {t('Import into PostgreSQL…')}
          </DropdownMenuItem>
        )}
        {(s.view.remotes.available || s.view.postgresql.available) && <DropdownMenuSeparator />}
        <DropdownMenuItem onSelect={() => s.open({ view: 'store', id: store.name })}>
          <ExternalLink className={icon} /> {t('Open')}
        </DropdownMenuItem>
        {s.view.stores.available && (
          <DropdownMenuItem variant="destructive" onSelect={() => s.remove({ kind: 'store', store })} disabled={running}>
            <Trash2 /> {t('Remove…')}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Push and Pull for a linked Store; Publish… for a local-only one. */
export function ContextAction({ store, size = 'xs' }: { store: StoreInfo; size?: 'xs' | 'sm' }) {
  useI18n()
  const s = useStorage()
  const [error, setError] = useState<string>()
  const running = !!s.transfers.runningFor(store.name)
  const go = (fn: () => Promise<void>) => {
    setError(undefined)
    fn().catch((e: unknown) => setError(message(e)))
  }
  const cls = size === 'sm' ? 'rounded-xl' : 'rounded-lg'
  let buttons: React.ReactNode = null
  if (store.link) {
    const where = `${store.link.remote} / ${store.link.file}`
    buttons = (
      <>
        <Button size={size} variant="outline" className={cls} disabled={running || !store.projects.length} title={running ? t(BUSY) : undefined} onClick={() => go(() => s.push(store))} aria-label={t('Push {store} to {where}', { store: store.name, where })}>
          <ArrowUpFromLine /> {t('Push')}
        </Button>
        <Button size={size} variant="outline" className={cls} disabled={running} title={running ? t(BUSY) : undefined} onClick={() => go(() => s.pull(store))} aria-label={t('Pull {store} from {where}', { store: store.name, where })}>
          <ArrowDownToLine /> {t('Pull')}
        </Button>
      </>
    )
  } else if (s.view.remotes.available) {
    const none = !s.view.remotes.list.length
    buttons = (
      <Button
        size={size}
        variant="outline"
        className={cls}
        disabled={running || !store.projects.length}
        title={!store.projects.length ? t('Nothing to publish yet') : none ? t('Add a connection first') : undefined}
        onClick={() => (none ? s.addLocation({ family: 'copy' }) : s.publish(store))}
        aria-label={t('Publish {store}', { store: store.name })}
      >
        <CloudUpload /> {t('Publish…')}
      </Button>
    )
  }
  return (
    <span className="relative inline-flex items-center gap-1">
      {buttons}
      {error && (
        <span role="alert" className="glass-strong absolute top-full right-0 z-10 mt-1 w-60 rounded-xl border border-destructive/25 px-2.5 py-2 text-[11.5px] break-words text-destructive shadow-md">
          {error}
        </span>
      )}
    </span>
  )
}
