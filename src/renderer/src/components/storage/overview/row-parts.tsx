// Pieces both bands' tables use: a band's frame and title block, a sortable
// column header, and the `…` menu button.
import { ArrowDown, ArrowUp, ChevronsUpDown, Ellipsis } from 'lucide-react'
import { type CSSProperties, forwardRef } from 'react'

import { spotlight } from '@/components/motion'
import { FamilyTile } from '@/components/storage/identity/store-icon'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

export type SortKey = 'name' | 'size' | 'status'
export interface Sort {
  key: SortKey
  dir: 1 | -1
}

/** Liquid glass for a band, a section or a detail card: the branch's one card surface. */
export const CARD = 'glass-liquid spotlight reveal min-w-0 rounded-2xl shadow-xs'

/** A band or section card: glass, spotlight and its place in the entrance stagger. */
export function Card({ index = 0, className, children, ...rest }: React.ComponentProps<'section'> & { index?: number }) {
  return (
    <section onPointerMove={spotlight} className={cn(CARD, className)} style={{ '--i': index } as CSSProperties} {...rest}>
      {children}
    </section>
  )
}

/** The band's title block: family mark, title, counts, one line on what it is, and buttons. */
export function BandHead({ id, family, title, counts, about, side }: { id: string; family: 'sqlite' | 'postgresql'; title: string; counts: React.ReactNode; about: string; side?: React.ReactNode }) {
  return (
    <header className="sc-band-head px-5 pt-5 pb-4">
      <FamilyTile family={family} size="md" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
          <h2 id={id} className="text-[15px] font-semibold tracking-tight">
            {title}
          </h2>
          <span className="text-xs font-medium text-muted-foreground tabular-nums">{counts}</span>
        </div>
        <p className="mt-0.5 max-w-2xl text-xs text-muted-foreground text-pretty">{about}</p>
      </div>
      {side && <div className="sc-band-side flex shrink-0 flex-wrap items-center justify-end gap-2">{side}</div>}
    </header>
  )
}

/** A column header; sortable ones are buttons and carry aria-sort. */
export function ColumnHead({ label, sortKey, sort, onSort, className }: { label: string; sortKey?: SortKey; sort?: Sort; onSort?: (key: SortKey) => void; className?: string }) {
  useI18n()
  const on = !!sortKey && sort?.key === sortKey
  const Icon = !on ? ChevronsUpDown : sort.dir === 1 ? ArrowUp : ArrowDown
  return (
    <span
      role="columnheader"
      aria-sort={sortKey ? (on ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none') : undefined}
      className={cn('min-w-0 text-[10.5px] font-semibold tracking-wider text-muted-foreground/80 uppercase', className)}
    >
      {sortKey && onSort ? (
        <button
          type="button"
          onClick={() => onSort(sortKey)}
          className={cn('group/sort -mx-1 inline-flex items-center gap-1 rounded-md px-1 uppercase outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring', on && 'text-foreground')}
        >
          {label}
          <Icon aria-hidden="true" className={cn('size-3', !on && 'opacity-0 group-hover/sort:opacity-60 group-focus-visible/sort:opacity-60')} />
        </button>
      ) : (
        label
      )}
    </span>
  )
}

/** The `…` button that opens a row's menu. */
export const MoreButton = forwardRef<HTMLButtonElement, React.ComponentProps<typeof Button> & { label: string }>(function MoreButton({ label, className, ...props }, ref) {
  return (
    <Button ref={ref} size="icon-sm" variant="ghost" aria-label={label} className={cn('rounded-xl text-muted-foreground', className)} {...props}>
      <Ellipsis />
    </Button>
  )
})
