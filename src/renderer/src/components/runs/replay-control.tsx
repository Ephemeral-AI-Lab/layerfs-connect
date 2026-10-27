// The project's one replay control: a small, quiet pill in the page header.
// Idle it reads "Replay" (a new session); while a session plays it shows that
// session's progress through the scenario ("76/535" with a thin ring), the
// only place the scenario's total appears. Its menu opens the scenario and,
// while a session plays, stops it.
import type { RunSummary } from '@shared/host-api'
import { ChevronDown, CircleStop, FileText, Play } from 'lucide-react'
import { useState } from 'react'

import { isLive } from '@/components/runs/run-format'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { host } from '@/host/client'
import { cn } from '@/lib/utils'

/** A thin progress ring, `share` of it drawn. */
function Ring({ share }: { share: number }) {
  const r = 6
  const c = 2 * Math.PI * r
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="size-3.5 -rotate-90">
      <circle cx="8" cy="8" r={r} fill="none" strokeWidth="2" className="stroke-muted-foreground/25" />
      <circle
        cx="8"
        cy="8"
        r={r}
        fill="none"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - Math.min(1, Math.max(0, share)))}
        className="stroke-primary transition-[stroke-dashoffset] duration-300"
      />
    </svg>
  )
}

interface ReplayControlProps {
  /** The demo's sessions, newest first. */
  runs: RunSummary[] | undefined
  /** Starts a new session. */
  onReplay: () => void
  starting: boolean
  onOpenRun: (runId: string) => void
  onViewScenario: () => void
}

export function ReplayControl({ runs, onReplay, starting, onOpenRun, onViewScenario }: ReplayControlProps) {
  const playing = runs?.find((r) => isLive(r.state))
  const [stopping, setStopping] = useState(false)
  const [error, setError] = useState<string>()
  const stop = async (id: string) => {
    setStopping(true)
    setError(undefined)
    try {
      await host.stopRun(id)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setStopping(false)
    }
  }
  const pill = 'flex h-7 items-center gap-1.5 px-2.5 text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring'
  return (
    <div className="flex items-center gap-2">
      {error && <span className="max-w-60 truncate text-xs text-destructive">{error}</span>}
      <div className="flex items-center rounded-full border bg-card shadow-xs">
        {playing ? (
          <button type="button" onClick={() => onOpenRun(playing.id)} title="Open the playing session" className={cn(pill, 'rounded-l-full tabular-nums')}>
            <Ring share={playing.of ? playing.done / playing.of : 0} />
            {playing.done}/{playing.of}
          </button>
        ) : (
          <button type="button" onClick={onReplay} disabled={starting} title="Replay the scenario as a new session" className={cn(pill, 'rounded-l-full disabled:opacity-60')}>
            <Play className="size-3" />
            {starting ? 'Starting…' : 'Replay'}
          </button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger aria-label="Replay options" className={cn(pill, 'rounded-r-full border-l px-1.5')}>
            <ChevronDown className="size-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onViewScenario}>
              <FileText /> View scenario
            </DropdownMenuItem>
            {playing && (
              <DropdownMenuItem onSelect={() => void stop(playing.id)} disabled={stopping}>
                <CircleStop /> {stopping ? 'Stopping…' : 'Stop session'}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}
