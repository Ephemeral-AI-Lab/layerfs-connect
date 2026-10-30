// Pieces both bands' tables use: a sortable column header, and the `…` menu button.
import { ArrowDown, ArrowUp, ChevronsUpDown, Ellipsis } from 'lucide-react'
import { forwardRef } from 'react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export type SortKey = 'name' | 'size' | 'status'
export interface Sort {
  key: SortKey
  dir: 1 | -1
}

/** A column header; sortable ones are buttons and carry aria-sort. */
export function ColumnHead({ label, sortKey, sort, onSort, className }: { label: string; sortKey?: SortKey; sort?: Sort; onSort?: (key: SortKey) => void; className?: string }) {
  const on = !!sortKey && sort?.key === sortKey
  const Icon = !on ? ChevronsUpDown : sort.dir === 1 ? ArrowUp : ArrowDown
  return (
    <span role="columnheader" aria-sort={sortKey ? (on ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none') : undefined} className={cn('min-w-0 text-[11px] font-medium tracking-[0.04em] text-faint uppercase', className)}>
      {sortKey && onSort ? (
        <button
          type="button"
          onClick={() => onSort(sortKey)}
          className={cn('group/sort -mx-1 inline-flex items-center gap-1 rounded px-1 uppercase outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring', on && 'text-muted-foreground')}
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
    <Button ref={ref} size="icon-sm" variant="ghost" aria-label={label} className={cn('text-muted-foreground', className)} {...props}>
      <Ellipsis />
    </Button>
  )
})
