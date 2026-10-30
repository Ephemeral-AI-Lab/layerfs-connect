// A Storage page's way back (storage-redesign §3.2 region 1): Storage, the
// family or place, then this page. Alt+← and the mouse back button go back too
// (StoragePage listens).
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Fragment } from 'react'

import { type Route, useStorage } from '@/components/storage/actions'
import { t, useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

export interface Crumb {
  label: string
  to?: Route
  mono?: boolean
}

export function Breadcrumb({ items }: { items: Crumb[] }) {
  useI18n()
  const s = useStorage()
  return (
    <nav aria-label={t('Breadcrumb')} className="reveal">
      <ol className="flex min-w-0 flex-wrap items-center gap-1 text-[13px] text-muted-foreground">
        <li>
          <button
            type="button"
            onClick={() => s.open({ view: 'overview' })}
            className="glass-liquid -ml-0.5 inline-flex items-center gap-0.5 rounded-xl py-1 pr-2.5 pl-1.5 font-medium shadow-2xs outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronLeft aria-hidden="true" className="size-4" /> {t('Storage')}
          </button>
        </li>
        {items.map((c, n) => (
          <Fragment key={n}>
            <li aria-hidden="true">
              <ChevronRight className="size-3.5 text-faint" />
            </li>
            <li className="min-w-0">
              {c.to && n < items.length - 1 ? (
                <button
                  type="button"
                  onClick={() => s.open(c.to!)}
                  className={cn('truncate rounded-lg px-1.5 py-0.5 outline-none hover:bg-foreground/[0.05] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring', c.mono && 'font-mono text-[12.5px]')}
                >
                  {c.label}
                </button>
              ) : (
                <span aria-current={n === items.length - 1 ? 'page' : undefined} className={cn('truncate px-1', n === items.length - 1 && 'font-semibold text-foreground', c.mono && 'font-mono text-[12.5px]')}>
                  {c.label}
                </span>
              )}
            </li>
          </Fragment>
        ))}
      </ol>
    </nav>
  )
}
