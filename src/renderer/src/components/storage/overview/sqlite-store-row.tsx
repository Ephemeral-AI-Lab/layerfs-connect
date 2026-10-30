// One SQLite Store on the board (storage-links §3.1): identity with its
// projects and size, the one remote file it links to (provider mark,
// connection / file) or "Local only", one sync pill, and Push and Pull (or
// Publish… for a local-only Store). While a job runs on it, the Linked-to
// cell shows the job instead (layerfs#509).
import { ArrowDownToLine, ArrowUpFromLine, CloudUpload, CopyPlus, DatabaseZap, ExternalLink, RefreshCw, Trash2, Unlink } from 'lucide-react'
import { useState } from 'react'

import { count, useStorage } from '@/components/storage/actions'
import { message } from '@/components/storage/dialogs/fields'
import { ProviderMark, StoreIcon, storeProviders } from '@/components/storage/identity/store-icon'
import { MoreButton } from '@/components/storage/overview/row-parts'
import { SizeText } from '@/components/storage/size'
import { SyncPill } from '@/components/storage/sync/sync-pill'
import { TransferRow } from '@/components/storage/transfers/transfer-row'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ago } from '@/data/format'
import { t, useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
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

/** The Linked-to cell: provider mark, connection / file, or "Local only". */
function LinkedTo({ store, narrow }: { store: StoreInfo; narrow?: boolean }) {
  const s = useStorage()
  const link = store.link
  if (!link) return <span className="text-[13px] text-muted-foreground">{t('Local only')}</span>
  return (
    <button
      type="button"
      onClick={() => s.open({ view: 'location', id: link.remote })}
      title={link.object}
      className="flex min-w-0 items-center gap-1.5 rounded-md text-left outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring"
    >
      <ProviderMark provider={link.provider} className="size-3.5 shrink-0" />
      {!narrow && <span className="truncate font-mono text-[12.5px] text-muted-foreground">{link.remote}</span>}
      {!narrow && (
        <span aria-hidden="true" className="text-faint">
          /
        </span>
      )}
      <span className="truncate font-mono text-[12.5px]">{link.file}</span>
    </button>
  )
}

/** "pushed 3 h ago", under an unknown pill, so the row is still useful without E2/E3. */
function lastTransfer(store: StoreInfo): string | null {
  if (store.sync.state !== 'unknown' || !store.link?.last?.at) return null
  return t(store.link.last.direction === 'pull' ? 'pulled {ago}' : 'pushed {ago}', { ago: ago(store.link.last.at) })
}

interface SqliteStoreRowProps {
  store: StoreInfo
  /** The project the search matched, shown as "has <project>". */
  match?: string | null
}

export function SqliteStoreRow({ store, match }: SqliteStoreRowProps) {
  useI18n()
  const s = useStorage()
  const job = s.transfers.runningFor(store.name)
  const providers = storeProviders(store, s.view.remotes.list)
  const flash = s.flash?.store === store.name ? s.flash.token : null
  const projects = store.projects
  const last = lastTransfer(store)
  const projectsTip = projects.length ? projects.slice(0, 8).join(', ') + (projects.length > 8 ? ` ${t('and {n} more', { n: projects.length - 8 })}` : '') : t('No projects yet')
  return (
    <div
      role="row"
      key={flash ?? undefined}
      id={`store-row-${store.name}`}
      className={cn('sc-row sc-sqlite-row relative transition-colors duration-(--dur-fast) hover:bg-foreground/[0.025]', job && 'sc-live-row bg-primary/[0.025]', flash !== null && 'live-flash [--flash:var(--primary)]')}
    >
      <span role="rowheader" className="sc-a-name flex min-w-0 items-center gap-3">
        <StoreIcon family="sqlite" providers={providers} size="sm" />
        <span className="min-w-0">
          <span className="flex min-w-0 items-center gap-1.5">
            <button
              type="button"
              onClick={() => s.open({ view: 'store', id: store.name })}
              className="truncate rounded-md text-left text-[13.5px] font-semibold tracking-tight outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring"
            >
              {store.name}
            </button>
            {store.legacy && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="shrink-0 rounded-full bg-muted/80 px-1.5 text-[10px] font-semibold text-muted-foreground ring-1 ring-foreground/[0.06] ring-inset">{t('own Store')}</span>
                </TooltipTrigger>
                <TooltipContent>{t('A project’s own Store, from before Stores held several projects.')}</TooltipContent>
              </Tooltip>
            )}
          </span>
          {match && <span className="block truncate text-[11.5px] text-muted-foreground">{t('has {project}', { project: match })}</span>}
          <span className="sc-under-name truncate text-[11.5px] text-muted-foreground tabular-nums" title={projectsTip}>
            {count(projects.length, 'project')} · <SizeText store={store} reason={s.sizeReason} />
          </span>
        </span>
      </span>
      <span role="cell" className="sc-a-copies min-w-0">
        {job ? <TransferRow job={job} form="compact" /> : <LinkedTo store={store} />}
      </span>
      <span role="cell" className="sc-a-meta items-center gap-2 text-[12px] text-muted-foreground">
        <SizeText store={store} reason={s.sizeReason} />
        <span aria-hidden="true">·</span>
        <span>{count(projects.length, 'project')}</span>
        {store.link && <LinkedTo store={store} narrow />}
      </span>
      <span role="cell" className="sc-a-pill">
        <span className="flex min-w-0 flex-col items-start gap-0.5">
          <SyncPill state={store.sync.state} copy={store.link} job={job ?? null} />
          {last && <span className="text-[11px] text-muted-foreground">{last}</span>}
        </span>
      </span>
      <span role="cell" className="sc-a-action flex items-center gap-1">
        <ContextAction store={store} />
        <StoreMenu store={store} />
      </span>
    </div>
  )
}
