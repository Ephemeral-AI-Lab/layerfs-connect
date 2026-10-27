// The project's one replay control: a pill in the page header.
// Idle it reads "Replay" (a new session); while one starts it spins; while a
// session plays it glows and shows that session's progress through the
// scenario ("76/535" with a ring that fills and a pulsing dot), the only place
// the scenario's total appears. Its menu opens the scenario and, while a
// session plays, stops it.
import type { RunSummary } from '@shared/host-api'
import { ChevronDown, CircleStop, FileText, LoaderCircle, Play } from 'lucide-react'
import { useState } from 'react'

import { useCountUp } from '@/components/motion/count-up'
import { isLive } from '@/components/runs/run-format'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { host } from '@/host/client'
import { cn } from '@/lib/utils'

/** A thin progress ring, `share` of it drawn, its arc lit, a dot pulsing at its centre. */
function Ring({ share }: { share: number }) {
  const r = 6
  const c = 2 * Math.PI * r
  return (
    <span aria-hidden="true" className="relative flex size-4 shrink-0 items-center justify-center">
      <RingArc share={share} r={r} c={c} />
      <span className="pulse-ring absolute size-1 rounded-full bg-primary text-primary" />
    </span>
  )
}

function RingArc({ share, r, c }: { share: number; r: number; c: number }) {
  return (
    <svg viewBox="0 0 16 16" className="size-4 -rotate-90 drop-shadow-[0_0_3px_var(--glow-strong)]">
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
        className="stroke-primary transition-[stroke-dashoffset] duration-(--dur-slow) ease-out-expo"
      />
    </svg>
  )
}

/** "76/535", the done count easing up as steps finish. */
function Progress({ done, of }: { done: number; of: number }) {
  const shown = useCountUp(done, { ms: 400, from: done })
  return (
    <span className="tabular-nums">
      {Math.round(shown ?? done)}
      <span className="text-muted-foreground">/{of}</span>
    </span>
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
  // Idle, the control is the page's primary action (brand light); while a session plays it glows and shows progress.
  const pill = 'flex h-8 items-center gap-1.5 px-3 text-[13px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset'
  return (
    <div className="flex items-center gap-2">
      {error && <span className="max-w-60 truncate text-xs text-destructive">{error}</span>}
      <div
        className={cn(
          'flex items-center rounded-full transition-shadow duration-(--dur-base)',
          playing ? 'live-glow bg-card text-foreground ring-1 ring-primary/25' : 'btn-primary bg-primary text-primary-foreground',
        )}
      >
        {playing ? (
          <button
            type="button"
            onClick={() => onOpenRun(playing.id)}
            title="Open the playing session"
            className={cn(pill, 'rounded-l-full tabular-nums hover:text-primary')}
          >
            {playing.state === 'starting' ? (
              <>
                <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin text-primary" />
                Starting…
              </>
            ) : (
              <>
                <Ring share={playing.of ? playing.done / playing.of : 0} />
                <Progress done={playing.done} of={playing.of} />
              </>
            )}
          </button>
        ) : (
          <button
            type="button"
            onClick={onReplay}
            disabled={starting}
            title="Replay the scenario as a new session"
            className={cn(pill, 'group/replay rounded-l-full disabled:opacity-70')}
          >
            {starting ? (
              <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />
            ) : (
              <Play className="size-3.5 fill-current transition-transform duration-(--dur-base) ease-out-expo group-hover/replay:translate-x-px group-hover/replay:scale-110 group-active/replay:scale-90" />
            )}
            {starting ? 'Starting…' : 'Replay'}
          </button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="Replay options"
            className={cn(pill, 'rounded-r-full border-l px-2', playing ? 'border-border hover:text-primary' : 'border-white/20 hover:bg-white/10')}
          >
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
