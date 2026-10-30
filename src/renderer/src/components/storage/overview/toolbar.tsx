// The board's toolbar (storage-redesign §3.1 region 4): search over Store and
// project names (`/` focuses it, Esc clears it), All or Needs attention, and
// Check now, which reads every copy's and connection's state again.
import { RefreshCw, Search, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { Segmented } from '@/components/motion'
import { useStorage } from '@/components/storage/actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ago } from '@/data/format'

export type Filter = 'all' | 'attention'

interface ToolbarProps {
  query: string
  onQuery: (q: string) => void
  filter: Filter
  onFilter: (f: Filter) => void
  counts: { all: number; attention: number }
  /** Nothing matched: show Clear. */
  noMatch: boolean
}

/** Check now rests this long after a check. */
const REST_MS = 10_000

export function Toolbar({ query, onQuery, filter, onFilter, counts, noMatch }: ToolbarProps) {
  const s = useStorage()
  const input = useRef<HTMLInputElement>(null)
  const [resting, setResting] = useState(false)
  const canCheck = s.view.supports.check || s.view.supports.postgresqlStatus

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return
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
    <div className="reveal flex flex-wrap items-center gap-2.5" style={{ '--i': 2 } as React.CSSProperties}>
      <div className="relative min-w-48 flex-1 sm:max-w-sm">
        <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-faint" />
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
          placeholder="Search Stores and projects"
          aria-label="Search Stores and projects"
          className="h-8 pr-8 pl-8"
        />
        {query ? (
          <button type="button" onClick={() => onQuery('')} aria-label="Clear the search" className="absolute top-1/2 right-1.5 flex size-5 -translate-y-1/2 items-center justify-center rounded text-faint outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
            <X className="size-3.5" />
          </button>
        ) : (
          <kbd aria-hidden="true" className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 rounded border bg-muted px-1 font-mono text-[10px] text-faint">
            /
          </kbd>
        )}
      </div>
      <Segmented<Filter>
        aria-label="Show"
        value={filter}
        onChange={onFilter}
        options={[
          { value: 'all', label: 'All', count: counts.all },
          { value: 'attention', label: 'Needs attention', count: counts.attention },
        ]}
      />
      {noMatch && (query || filter !== 'all') && (
        <Button size="sm" variant="ghost" onClick={() => (onQuery(''), onFilter('all'))}>
          Clear
        </Button>
      )}
      {canCheck && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="ml-auto inline-flex">
              <Button size="sm" variant="outline" onClick={checkNow} disabled={s.checking || resting}>
                <RefreshCw className={s.checking ? 'animate-spin' : undefined} /> {s.checking ? 'Checking…' : 'Check now'}
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>{s.view.checkedAt ? `Checked ${ago(s.view.checkedAt)}` : 'Not checked yet'}</TooltipContent>
        </Tooltip>
      )}
    </div>
  )
}
