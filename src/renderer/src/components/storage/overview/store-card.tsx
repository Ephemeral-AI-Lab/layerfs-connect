// One Store on the board (layerfs-storage.md region 3): a glass card with
// the Store's mark, name and menu; where it lives and its size; its projects
// (up to three, each opens the project); and a footer with its state and at
// most one button, shown only when there is something to do. A Store that
// needs you gets a tinted ring. While a job runs, the footer is the job.
import { ArrowDownToLine, ArrowUpFromLine, CloudUpload, Folder, Plus, Split } from 'lucide-react'
import { useState } from 'react'

import { useStorage } from '@/components/storage/actions'
import { message } from '@/components/storage/dialogs/fields'
import { ProviderMark, StoreIcon, storeProviders } from '@/components/storage/identity/store-icon'
import { Card } from '@/components/storage/overview/row-parts'
import { FromLink, PostgresqlStoreMenu } from '@/components/storage/overview/postgresql-store-row'
import { StoreMenu } from '@/components/storage/overview/sqlite-store-row'
import { SizeText } from '@/components/storage/size'
import { copyTip } from '@/components/storage/sync/sync-pill'
import { NEEDS_ACTION, SYNC } from '@/components/storage/sync/sync-state'
import { isFailed } from '@/components/storage/transfers/phases'
import { TransferRow } from '@/components/storage/transfers/transfer-row'
import { Button } from '@/components/ui/button'
import { t, useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import type { StoreInfo } from '@shared/host-api'

/** Projects listed on a card before "N more". */
const SHOWN = 3

/** A state's words in its tone, quieter than a pill. */
const TONE_TEXT = {
  neutral: 'text-muted-foreground',
  success: 'text-emerald-600 dark:text-emerald-400',
  info: 'text-primary',
  warning: 'text-amber-600 dark:text-amber-400',
  danger: 'text-destructive',
} as const

/** Why a Store needs you, or null: its link's state, a failed job, or its database not answering. */
export type Attention = 'warning' | 'danger' | null

interface StoreCardProps {
  store: StoreInfo
  attention: Attention
  /** The project the search matched: listed first. */
  match?: string | null
  index?: number
}

export function StoreCard({ store, attention, match, index = 0 }: StoreCardProps) {
  useI18n()
  const s = useStorage()
  const job = s.transfers.runningFor(store.name)
  const flash = s.flash?.store === store.name ? s.flash.token : null
  const sqlite = store.kind === 'sqlite'
  // a project's own Store: the project is the Store, so the card names it once and opens it
  const solo = store.projects.length === 1 && store.projects[0] === store.name
  const openStore = () => s.open({ view: 'store', id: store.name })
  const openTitle = solo && s.openProject ? () => s.openProject!(store.name, store.name) : openStore
  return (
    <Card
      key={flash ?? undefined}
      id={`store-row-${store.name}`}
      index={index}
      aria-label={store.name}
      className={cn(
        'group/card flex flex-col gap-3 p-4',
        attention === 'warning' && 'ring-1 ring-amber-500/45',
        attention === 'danger' && 'ring-1 ring-destructive/45',
        flash !== null && 'live-flash [--flash:var(--primary)]',
      )}
    >
      <header className="flex min-w-0 items-start gap-3">
        <StoreIcon family={store.kind} providers={storeProviders(store, s.view.remotes.list)} size="sm" />
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={openTitle}
            title={solo && s.openProject ? t('Open project') : t('Open Store')}
            className="block max-w-full truncate rounded-md text-left text-[14.5px] font-semibold tracking-tight outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring"
          >
            {store.name}
          </button>
          <Where store={store} />
        </div>
        {sqlite ? <StoreMenu store={store} /> : <PostgresqlStoreMenu store={store} />}
      </header>
      {!solo && <Projects store={store} match={match ?? null} onMore={openStore} />}
      <footer className="mt-auto flex min-h-11 min-w-0 items-center gap-2 border-t border-foreground/[0.06] pt-3">
        {job ? <TransferRow job={job} form="compact" className="min-w-0 flex-1" /> : <Footer store={store} />}
      </footer>
    </Card>
  )
}

/** "r2 / work · 410 MB", "This machine · 238 MB", "local-pg · 330 MB". */
function Where({ store }: { store: StoreInfo }) {
  const s = useStorage()
  const link = store.link
  const down = store.kind === 'postgresql' && isDown(s, store.connection)
  const place =
    store.kind === 'postgresql' ? (
      <button type="button" onClick={() => s.open({ view: 'connection', id: store.connection ?? '' })} className="truncate rounded-md font-mono outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring">
        {store.connection}
      </button>
    ) : link ? (
      <button
        type="button"
        onClick={() => s.open({ view: 'location', id: link.remote })}
        title={link.object}
        className="flex min-w-0 items-center gap-1.5 rounded-md font-mono outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ProviderMark provider={link.provider} className="size-3 shrink-0" />
        <span className="truncate">
          {link.remote} / {link.file}
        </span>
      </button>
    ) : (
      <span className="truncate">{t('This machine')}</span>
    )
  return (
    <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
      {place}
      <span aria-hidden="true" className="text-faint">
        ·
      </span>
      <SizeText store={store} reason={down ? t('{name} is not answering', { name: store.connection ?? '' }) : s.sizeReason} />
    </div>
  )
}

/** Up to three projects, each opens its page; the search's match first; "N more" opens the Store. */
function Projects({ store, match, onMore }: { store: StoreInfo; match: string | null; onMore: () => void }) {
  const s = useStorage()
  if (!store.projects.length)
    return (
      <div className="flex items-center justify-between gap-2 text-[13px] text-muted-foreground">
        <span>{t('No projects yet')}</span>
        {store.kind === 'sqlite' && s.view.stores.available && (
          <Button size="xs" variant="ghost" className="rounded-lg" onClick={() => s.addProject(store)}>
            <Plus /> {t('Add project')}
          </Button>
        )}
      </div>
    )
  const names = match ? [match, ...store.projects.filter((p) => p !== match)] : store.projects
  const more = names.length - SHOWN
  const row = 'flex w-full min-w-0 items-center gap-2 rounded-lg px-1.5 py-1 text-left text-[13px]'
  return (
    <ul aria-label={t('Projects in {store}', { store: store.name })} className="-mx-1.5 flex flex-col">
      {names.slice(0, SHOWN).map((p) => (
        <li key={p}>
          {s.openProject ? (
            <button type="button" onClick={() => s.openProject!(store.name, p)} className={cn(row, 'outline-none hover:bg-foreground/[0.04] hover:text-primary focus-visible:ring-2 focus-visible:ring-ring', p === match && 'bg-primary/[0.06]')}>
              <Folder aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{p}</span>
            </button>
          ) : (
            <span className={row}>
              <Folder aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{p}</span>
            </span>
          )}
        </li>
      ))}
      {more > 0 && (
        <li>
          <button type="button" onClick={onMore} className={cn(row, 'text-xs text-muted-foreground outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring')}>
            {t('{n} more', { n: more })}
          </button>
        </li>
      )}
    </ul>
  )
}

/** The state on the left; one button on the right when the state asks for it. */
function Footer({ store }: { store: StoreInfo }) {
  const s = useStorage()
  const [error, setError] = useState<string>()
  const go = (fn: () => Promise<void>) => {
    setError(undefined)
    fn().catch((e: unknown) => setError(message(e)))
  }
  const failed = s.transfers.shown.find((j) => j.store === store.name && isFailed(j))
  const btn = 'rounded-lg'

  let state: React.ReactNode
  let action: React.ReactNode = null
  if (store.kind === 'postgresql') {
    state = isDown(s, store.connection) ? (
      <span className={TONE_TEXT.warning}>{t('{name} is not answering', { name: store.connection ?? '' })}</span>
    ) : store.importedFrom ? (
      <FromLink store={store} />
    ) : (
      <span title={t(SYNC.live.means)}>{t('Live in the database')}</span>
    )
  } else if (store.link) {
    const sync = store.sync.state === 'unknown' && store.link.lastKnown ? store.link.lastKnown : store.sync.state
    const meta = SYNC[sync] ?? SYNC.unknown
    const Icon = meta.icon
    state = (
      <span title={copyTip(store.link)} className={cn('inline-flex min-w-0 items-center gap-1.5', TONE_TEXT[meta.tone])}>
        <Icon aria-hidden="true" className={cn('size-3.5 shrink-0', meta.spin && 'motion-safe:animate-spin')} />
        <span className="truncate">{t(meta.label)}</span>
      </span>
    )
    const where = `${store.link.remote} / ${store.link.file}`
    if (sync === 'ahead' || sync === 'missing')
      action = (
        <Button size="xs" variant="outline" className={btn} disabled={!store.projects.length} onClick={() => go(() => s.push(store))} aria-label={t('Push {store} to {where}', { store: store.name, where })}>
          <ArrowUpFromLine /> {t('Push')}
        </Button>
      )
    else if (sync === 'behind')
      action = (
        <Button size="xs" variant="outline" className={btn} onClick={() => go(() => s.pull(store))} aria-label={t('Pull {store} from {where}', { store: store.name, where })}>
          <ArrowDownToLine /> {t('Pull')}
        </Button>
      )
    else if (sync === 'diverged')
      action = (
        <Button size="xs" variant="outline" className={btn} onClick={() => s.open({ view: 'store', id: store.name })}>
          <Split /> {t('Resolve…')}
        </Button>
      )
  } else {
    const remotesOn = s.view.remotes.available
    state = <span>{remotesOn ? t('Not published') : t('Local only')}</span>
    // not urgent: the button wakes on hover and focus, and the menu has it too
    if (remotesOn && store.projects.length) {
      const none = !s.view.remotes.list.length
      action = (
        <Button
          size="xs"
          variant="ghost"
          className={cn(btn, 'opacity-0 transition-opacity group-hover/card:opacity-100 focus-visible:opacity-100 group-focus-within/card:opacity-100')}
          title={none ? t('Add a connection first') : undefined}
          onClick={() => (none ? s.addLocation({ family: 'copy' }) : s.publish(store))}
          aria-label={t('Publish {store}', { store: store.name })}
        >
          <CloudUpload /> {t('Publish…')}
        </Button>
      )
    }
  }
  if (failed) state = <span className={TONE_TEXT.danger}>{t('Last transfer failed')}</span>

  return (
    <>
      <span className="min-w-0 flex-1 truncate text-xs font-medium text-muted-foreground">{error ? <span role="alert" className="text-destructive">{error}</span> : state}</span>
      {action}
    </>
  )
}

function isDown(s: ReturnType<typeof useStorage>, connection: string | null): boolean {
  const c = s.view.postgresql.connections.find((x) => x.name === connection)
  return !!c && (c.health.state === 'unreachable' || c.health.state === 'denied')
}

/** How much a Store needs you: a link to settle or a failed job (warning), both sides changed (danger). */
export function attentionOf(store: StoreInfo, s: ReturnType<typeof useStorage>): Attention {
  if (store.kind === 'postgresql') return isDown(s, store.connection) ? 'warning' : null
  if (s.transfers.shown.some((j) => j.store === store.name && isFailed(j))) return 'danger'
  if (store.sync.state === 'diverged') return 'danger'
  return NEEDS_ACTION.includes(store.sync.state) ? 'warning' : null
}
