// The summary strip (storage-redesign §3.1 region 2): Stores, size, sync and
// transfers in one row. Bytes are never added across the two families
// without the split under them.
import type { CSSProperties } from 'react'

import { CountUp } from '@/components/motion'
import { CountBytes } from '@/components/projects/store-visuals'
import { Skeleton } from '@/components/ui/skeleton'
import { count } from '@/components/storage/actions'
import { compactLabel, endedSentence, isRunning } from '@/components/storage/transfers/phases'
import type { Transfers } from '@/components/storage/transfers/use-transfers'
import { ago, bytes } from '@/data/format'
import { cn } from '@/lib/utils'
import type { StorageView, StoreSyncState } from '@shared/host-api'

const i = (n: number) => ({ '--i': n }) as CSSProperties

function Cell({ label, live, index, children, note }: { label: string; live?: boolean; index: number; children: React.ReactNode; note: React.ReactNode }) {
  return (
    <div className="sc-strip-cell reveal" data-live={live || undefined} style={i(index)}>
      <dt className="flex items-center gap-1.5 text-[11px] font-medium tracking-[0.06em] text-faint uppercase">
        {live && <span aria-hidden="true" className="pulse-ring size-1.5 rounded-full bg-primary text-primary" />}
        {label}
      </dt>
      <dd className="mt-1">
        <span className={cn('block truncate text-[24px] leading-8 font-semibold tracking-[-0.03em] tabular-nums', live && 'text-brand')}>{children}</span>
        <span className="sc-strip-note mt-0.5 block truncate text-xs text-muted-foreground">{note}</span>
      </dd>
    </div>
  )
}

const URGENT: { state: StoreSyncState; words: string }[] = [
  { state: 'ahead', words: 'to push' },
  { state: 'behind', words: 'newer' },
  { state: 'diverged', words: 'both changed' },
  { state: 'missing', words: 'missing' },
  { state: 'unreachable', words: 'unreachable' },
]

interface SummaryStripProps {
  view: StorageView | null
  transfers: Transfers
  /** A sync count was clicked: filter to Needs attention and go to the SQLite band. */
  onAttention: () => void
  /** The tray is hidden: the Transfers cell opens it. */
  trayHidden: boolean
  onShowTray: () => void
}

export function SummaryStrip({ view, transfers, onAttention, trayHidden, onShowTray }: SummaryStripProps) {
  if (!view)
    return (
      <div aria-busy="true" aria-label="Reading the storage" className="sc-strip surface rounded-xl">
        {Array.from({ length: 4 }, (_, n) => (
          <div key={n} className="sc-strip-cell">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="mt-2.5 h-6 w-20" />
            <Skeleton className="mt-2 h-3 w-28" />
          </div>
        ))}
      </div>
    )
  const t = view.totals
  const sqlite = view.stores.list.filter((s) => s.kind === 'sqlite')
  const withCopies = sqlite.filter((s) => s.link !== null)
  const inSync = withCopies.filter((s) => s.sync.state === 'in_sync').length
  const urgent = URGENT.map((u) => ({ ...u, n: withCopies.filter((s) => s.sync.state === u.state).length })).filter((u) => u.n > 0)
  const unsure = withCopies.length - inSync - urgent.reduce((n, u) => n + u.n, 0)
  /** "1.1 GB here", "1.1 GB + 1 unknown here", "size unknown here". */
  const part = (bytes_: number, unknown: number, stores: number, where: string) =>
    stores > 0 && unknown === stores ? `${where === 'here' ? 'size unknown here' : `PostgreSQL size unknown`}` : `${bytes(bytes_)}${unknown ? ` + ${unknown} unknown` : ''} ${where}`
  const running = transfers.running
  const lastEnded = transfers.all.find((j) => !isRunning(j))
  const first = running[0]

  return (
    <dl aria-label="Storage at a glance" className="sc-strip surface reveal rounded-xl" style={i(1)}>
      <Cell label="Stores" index={2} note={`${t.sqlite.stores} SQLite · ${t.postgresql.stores} PostgreSQL`}>
        <CountUp value={t.sqlite.stores + t.postgresql.stores} />
      </Cell>
      <Cell
        label="Size"
        index={3}
        note={`${part(t.sqlite.bytes, t.sqlite.unknown, t.sqlite.stores, 'here')} · ${part(t.postgresql.bytes, t.postgresql.unknown, t.postgresql.stores, 'in PostgreSQL')}`}
      >
        {t.sqlite.stores + t.postgresql.stores > 0 && t.sqlite.unknown + t.postgresql.unknown === t.sqlite.stores + t.postgresql.stores ? (
          <span className="text-[17px] font-medium text-muted-foreground">size unknown</span>
        ) : (
          <CountBytes value={t.sqlite.bytes + t.postgresql.bytes} />
        )}
      </Cell>
      <Cell
        label="Linked"
        index={4}
        note={
          !withCopies.length ? (
            'Publish a Store to link it'
          ) : urgent.length || unsure ? (
            <>
              {inSync > 0 && `${inSync} in sync · `}
              {urgent.map((u, n) => (
                <span key={u.state}>
                  {n > 0 && ' · '}
                  <button type="button" onClick={onAttention} className="rounded-sm underline-offset-2 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring">
                    {u.n} {u.words}
                  </button>
                </span>
              ))}
              {unsure > 0 && `${urgent.length ? ' · ' : ''}${unsure} not known`}
            </>
          ) : (
            'Every link is in sync'
          )
        }
      >
        <CountUp value={withCopies.length} />
        <span className="text-[15px] font-medium text-muted-foreground"> of {sqlite.length} SQLite</span>
      </Cell>
      <Cell
        label="Transfers"
        index={5}
        live={running.length > 0}
        note={
          first ? (
            `${first.store} · ${compactLabel(first).toLowerCase()}`
          ) : lastEnded ? (
            `last: ${endedSentence(lastEnded).toLowerCase()} ${ago(lastEnded.ended)}`
          ) : (
            'Publish, push, pull, send, load and import show here'
          )
        }
      >
        {trayHidden && transfers.shown.length > 0 ? (
          <button type="button" onClick={onShowTray} className="rounded-sm text-left outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring" aria-label="Show the transfers">
            {running.length ? `${running.length} running` : count(transfers.shown.length, 'ended', 'ended')}
          </button>
        ) : running.length ? (
          `${running.length} running`
        ) : (
          <span className="text-[17px] font-medium text-muted-foreground">None running</span>
        )}
      </Cell>
    </dl>
  )
}
