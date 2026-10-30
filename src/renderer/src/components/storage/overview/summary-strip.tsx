// The summary strip (storage-redesign §3.1 region 2): Stores, size, links and
// transfers on one glass card. Bytes are never added across the two families
// without the split under them.
import type { CSSProperties } from 'react'

import { CountUp, spotlight } from '@/components/motion'
import { CountBytes } from '@/components/projects/store-visuals'
import { count } from '@/components/storage/actions'
import { compactLabel, endedSentence, isRunning } from '@/components/storage/transfers/phases'
import type { Transfers } from '@/components/storage/transfers/use-transfers'
import { Skeleton } from '@/components/ui/skeleton'
import { ago, bytes } from '@/data/format'
import { t, useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import type { StorageView, StoreSyncState } from '@shared/host-api'

const i = (n: number) => ({ '--i': n }) as CSSProperties

function Cell({ label, live, index, children, note }: { label: string; live?: boolean; index: number; children: React.ReactNode; note: React.ReactNode }) {
  return (
    <div className="sc-strip-cell reveal" data-live={live || undefined} style={i(index)}>
      <dt className="flex items-center gap-1.5 text-[10.5px] font-semibold tracking-wider text-muted-foreground/80 uppercase">
        {live && <span aria-hidden="true" className="pulse-ring size-1.5 rounded-full bg-primary text-primary" />}
        {label}
      </dt>
      <dd className="mt-1.5">
        <span className={cn('block truncate text-2xl font-bold tracking-tight tabular-nums', live && 'text-primary')}>{children}</span>
        <span className="sc-strip-note mt-1 block truncate text-[11.5px] font-medium text-muted-foreground">{note}</span>
      </dd>
    </div>
  )
}

const URGENT: { state: StoreSyncState; words: string }[] = [
  { state: 'ahead', words: '{n} to push' },
  { state: 'behind', words: '{n} newer' },
  { state: 'diverged', words: '{n} both changed' },
  { state: 'missing', words: '{n} missing' },
  { state: 'unreachable', words: '{n} unreachable' },
]

interface SummaryStripProps {
  view: StorageView | null
  transfers: Transfers
  /** A sync count was clicked: filter to Needs attention and go to the SQLite band. */
  onAttention: () => void
  /** The tray is hidden: the Transfers cell opens it. */
  trayHidden: boolean
  onShowTray: () => void
  index?: number
}

export function SummaryStrip({ view, transfers, onAttention, trayHidden, onShowTray, index = 0 }: SummaryStripProps) {
  useI18n()
  if (!view)
    return (
      <div aria-busy="true" aria-label={t('Reading the storage')} className="sc-strip glass-liquid rounded-2xl shadow-xs">
        {Array.from({ length: 4 }, (_, n) => (
          <div key={n} className="sc-strip-cell">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="mt-2.5 h-6 w-20" />
            <Skeleton className="mt-2 h-3 w-28" />
          </div>
        ))}
      </div>
    )
  const totals = view.totals
  const sqlite = view.stores.list.filter((s) => s.kind === 'sqlite')
  const linked = sqlite.filter((s) => s.link !== null)
  const inSync = linked.filter((s) => s.sync.state === 'in_sync').length
  const urgent = URGENT.map((u) => ({ ...u, n: linked.filter((s) => s.sync.state === u.state).length })).filter((u) => u.n > 0)
  const unsure = linked.length - inSync - urgent.reduce((n, u) => n + u.n, 0)
  const all = totals.sqlite.stores + totals.postgresql.stores
  const part = (b: number, unknown: number, stores: number, here: boolean) =>
    stores > 0 && unknown === stores
      ? t(here ? 'size unknown here' : 'PostgreSQL size unknown')
      : t(here ? '{size} here' : '{size} in PostgreSQL', { size: unknown ? t('{bytes} + {n} unknown', { bytes: bytes(b), n: unknown }) : bytes(b) })
  const running = transfers.running
  const lastEnded = transfers.all.find((j) => !isRunning(j))
  const first = running[0]

  return (
    <dl aria-label={t('Storage at a glance')} onPointerMove={spotlight} className="sc-strip glass-liquid spotlight reveal rounded-2xl shadow-xs" style={i(index)}>
      <Cell label={t('Stores')} index={index + 1} note={t('{sqlite} SQLite · {pg} PostgreSQL', { sqlite: totals.sqlite.stores, pg: totals.postgresql.stores })}>
        <CountUp value={all} />
      </Cell>
      <Cell label={t('Size')} index={index + 2} note={`${part(totals.sqlite.bytes, totals.sqlite.unknown, totals.sqlite.stores, true)} · ${part(totals.postgresql.bytes, totals.postgresql.unknown, totals.postgresql.stores, false)}`}>
        {all > 0 && totals.sqlite.unknown + totals.postgresql.unknown === all ? (
          <span className="text-base font-medium text-muted-foreground">{t('size unknown')}</span>
        ) : (
          <CountBytes value={totals.sqlite.bytes + totals.postgresql.bytes} />
        )}
      </Cell>
      <Cell
        label={t('Linked')}
        index={index + 3}
        note={
          !linked.length ? (
            t('Publish a Store to link it')
          ) : urgent.length || unsure ? (
            <>
              {inSync > 0 && `${t('{n} in sync', { n: inSync })} · `}
              {urgent.map((u, n) => (
                <span key={u.state}>
                  {n > 0 && ' · '}
                  <button type="button" onClick={onAttention} className="rounded-sm underline-offset-2 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring">
                    {t(u.words, { n: u.n })}
                  </button>
                </span>
              ))}
              {unsure > 0 && `${urgent.length ? ' · ' : ''}${t('{n} not known', { n: unsure })}`}
            </>
          ) : (
            t('Every link is in sync')
          )
        }
      >
        <CountUp value={linked.length} />
        <span className="text-sm font-medium text-muted-foreground"> {t('of {n} SQLite', { n: sqlite.length })}</span>
      </Cell>
      <Cell
        label={t('Transfers')}
        index={index + 4}
        live={running.length > 0}
        note={first ? `${first.store} · ${compactLabel(first)}` : lastEnded ? t('last: {what} {ago}', { what: endedSentence(lastEnded), ago: ago(lastEnded.ended) }) : t('Publish, push, pull, send, load and import show here')}
      >
        {trayHidden && transfers.shown.length > 0 ? (
          <button type="button" onClick={onShowTray} className="rounded-sm text-left outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring" aria-label={t('Show the transfers')}>
            {running.length ? t('{n} running', { n: running.length }) : count(transfers.shown.length, 'ended', 'ended')}
          </button>
        ) : running.length ? (
          t('{n} running', { n: running.length })
        ) : (
          <span className="text-base font-medium text-muted-foreground">{t('None running')}</span>
        )}
      </Cell>
    </dl>
  )
}
