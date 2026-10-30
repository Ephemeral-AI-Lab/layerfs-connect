import { t, useI18n } from '@/i18n'
// Small parts the History and Files panes share: a pane header, a search
// field with a clear button, and the id chip.
import './history.css'

import { Search, X } from 'lucide-react'
import type { ReactNode } from 'react'

import { Input } from '@/components/ui/input'
import { shortId } from '@/data/format'
import { cn } from '@/lib/utils'

/** A pane's header: an eyebrow label, a count, anything on the right. Frosted and sticky in a scroller. */
export function PaneHead({ label, count, children, className }: { label: string; count?: ReactNode; children?: ReactNode; className?: string }) {
  useI18n()
  return (
    <div className={cn('hist-pane-head flex h-10 shrink-0 items-center gap-2 px-3', className)}>
      <span className="hist-eyebrow">{label}</span>
      {count !== undefined && <span className="text-[11px] text-faint tabular-nums">{count}</span>}
      {children && <div className="ml-auto flex min-w-0 items-center gap-1.5">{children}</div>}
    </div>
  )
}

interface SearchFieldProps {
  label: string
  value: string
  onChange: (value: string) => void
  className?: string
  size?: 'sm' | 'md'
}

/** A search box: an icon, the field, and a clear button (Escape clears too). */
export function SearchField({ label, value, onChange, className, size = 'md' }: SearchFieldProps) {
  useI18n()
  return (
    <div className={cn('relative', className)}>
      <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-faint" />
      <Input
        aria-label={label}
        placeholder={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && value) {
            e.preventDefault()
            onChange('')
          }
        }}
        className={cn('pr-7 pl-7 text-[13px] shadow-[var(--highlight)] dark:bg-input/20', size === 'sm' ? 'h-7' : 'h-8')}
      />
      {value && (
        <button
          type="button"
          aria-label={t("Clear")}
          onClick={() => onChange('')}
          className="absolute top-1/2 right-1.5 flex size-5 -translate-y-1/2 items-center justify-center rounded text-faint outline-none animate-in fade-in zoom-in-75 hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="size-3" />
        </button>
      )}
    </div>
  )
}

/** A Commit or Layer id, short, the full id on hover. */
export function HashChip({ id, on, dim, className }: { id: string; on?: boolean; dim?: boolean; className?: string }) {
  useI18n()
  return (
    <code title={id} data-on={on} className={cn('hash-chip', dim ? 'text-faint' : 'text-foreground/85', className)}>
      {shortId(id)}
    </code>
  )
}
