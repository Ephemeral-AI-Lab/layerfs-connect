// The board's toolbar (storage-redesign §3.1 region 4): search over Store and
// project names (`/` focuses it, Esc clears it), All or Needs attention, and
// Check now, which reads every link's and connection's state again.
import { RefreshCw, Search, X } from 'lucide-react'
import { type CSSProperties, useEffect, useRef, useState } from 'react'

import { Segmented } from '@/components/motion'
import { useStorage } from '@/components/storage/actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ago } from '@/data/format'
import { t, useI18n } from '@/i18n'

export type Filter = 'all' | 'attention'

interface ToolbarProps {
  query: string
  onQuery: (q: string) => void
  filter: Filter
  onFilter: (f: Filter) => void
  counts: { all: number; attention: number }
  /** Nothing matched: show Clear. */
  noMatch: boolean
  index?: number
}

/** Check now rests this long after a check. */
const REST_MS = 10_000

export function Toolbar({ query, onQuery, filter, onFilter, counts, noMatch, index = 0 }: ToolbarProps) {
  useI18n()
  const s = useStorage()
  const input = useRef<HTMLInputElement>(null)
  const [resting, setResting] = useState(false)
  const canCheck = s.view.supports.check || s.view.supports.postgresqlStatus

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return
      if (document.querySelector('[role="dialog"]')) return
      e.preventDefault()
      input.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const checkNow = () => {
    setResting(true)
    void s.check().finally(() => setTimeout(() => setResting(false), REST_MS))
  }

  return (
    <div className="reveal flex flex-wrap items-center gap-2.5" style={{ '--i': index } as CSSProperties}>
      <div className="relative min-w-48 flex-1 sm:max-w-sm">
        <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={input}
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && query) {
              e.preventDefault()
              onQuery('')
            }
          }}
          placeholder={t('Search Stores and projects')}
          aria-label={t('Search Stores and projects')}
          className="glass-liquid h-9 rounded-xl pr-8 pl-8.5"
        />
        {query ? (
          <button
            type="button"
            onClick={() => onQuery('')}
            aria-label={t('Clear the search')}
            className="absolute top-1/2 right-2 flex size-5 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="size-3.5" />
          </button>
        ) : (
          <kbd aria-hidden="true" className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 rounded-md border border-foreground/10 bg-muted/70 px-1.5 font-mono text-[10px] text-muted-foreground">
            /
          </kbd>
        )}
      </div>
      <Segmented<Filter>
        aria-label={t('Show')}
        value={filter}
        onChange={onFilter}
        options={[
          { value: 'all', label: t('All'), count: counts.all },
          { value: 'attention', label: t('Needs attention'), count: counts.attention },
        ]}
      />
      {noMatch && (query || filter !== 'all') && (
        <Button size="sm" variant="ghost" className="rounded-xl" onClick={() => (onQuery(''), onFilter('all'))}>
          {t('Clear')}
        </Button>
      )}
      {canCheck && (
        <span className="ml-auto flex items-center gap-2.5">
          <span className="hidden text-xs text-muted-foreground tabular-nums sm:inline">{s.view.checkedAt ? t('Checked {ago}', { ago: ago(s.view.checkedAt) }) : t('Not checked yet')}</span>
          <Button size="sm" variant="outline" className="rounded-xl" onClick={checkNow} disabled={s.checking || resting}>
            <RefreshCw className={s.checking ? 'motion-safe:animate-spin' : undefined} /> {s.checking ? t('Checking…') : t('Check now')}
          </Button>
        </span>
      )}
    </div>
  )
}
