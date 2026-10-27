import './run-list.css'

import type { RunSummary } from '@shared/host-api'
import { ChevronRight, LoaderCircle, Plus, PlayCircle, TriangleAlert } from 'lucide-react'
import { useMemo } from 'react'

import { revealStyle } from '@/components/motion/reveal'
import { Empty, LoadError } from '@/components/projects/states'
import { RunDot } from '@/components/runs/run-badges'
import { RUN_LABEL, agentColors, ago, clock, duration, isLive, plural, runLabel } from '@/components/runs/run-format'
import { useNow } from '@/components/runs/use-run'
import { useRuns, useStartRun } from '@/components/runs/use-runs'
import { Chip } from '@/components/storage/chips'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'

interface RunListProps {
  demo: string
  onOpenRun: (runId: string) => void
}

const HEAD = 'h-9 text-[11px] font-medium tracking-[0.05em] text-faint uppercase'

/** A demo project's sessions (one per replay), newest first, with a New session button. */
export function RunList({ demo, onOpenRun }: RunListProps) {
  const { runs, error, loading, reload } = useRuns(demo)
  const { start, starting, error: refused, clearError } = useStartRun((run) => onOpenRun(run.id))
  const playing = runs?.filter((r) => isLive(r.state)).length ?? 0
  const now = useNow(playing > 0)
  // one colour per agent name across the project's sessions
  const colorOf = useMemo(() => agentColors((runs ?? []).flatMap((r) => r.agents.map((a) => a.name))), [runs])

  return (
    <section aria-label="Runs" className="surface reveal overflow-hidden rounded-xl">
      <header className="flex items-center gap-2.5 px-5 pt-4 pb-3">
        <h3 className="text-sm font-semibold tracking-[-0.01em]">Sessions</h3>
        {runs && <span className="rounded-full bg-muted px-1.5 text-[11px] font-medium text-muted-foreground tabular-nums">{runs.length}</span>}
        {playing > 0 && (
          <Chip tone="info" live>
            {playing} playing
          </Chip>
        )}
        <Button size="sm" className="run-new ml-auto" onClick={() => void start(demo)} disabled={starting !== null}>
          {starting ? <LoaderCircle className="animate-spin" /> : <Plus className="run-plus" />}
          {starting ? 'Starting…' : 'New session'}
        </Button>
      </header>

      {refused && (
        <div
          role="alert"
          className="reveal mx-5 mb-3 flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-[13px] text-destructive ring-1 ring-destructive/25 ring-inset"
        >
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span className="min-w-0 flex-1">Could not start a session: {refused.message}</span>
          <button type="button" onClick={clearError} className="text-xs font-medium underline-offset-2 hover:underline">
            Dismiss
          </button>
        </div>
      )}

      {error && !runs ? (
        <LoadError error={error} what="the sessions" onRetry={reload} className="mx-5 mb-5" />
      ) : loading || !runs ? (
        <div aria-busy="true" className="flex flex-col gap-2 px-5 pb-5">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="reveal h-10" style={revealStyle(i)} />
          ))}
        </div>
      ) : runs.length === 0 ? (
        <Empty icon={PlayCircle} title="No sessions yet" className="mx-5 mb-5">
          A session Inits this demo’s LayerFS project from its fixture (starting it again after the first) and plays its agents live on the
          real backend.
        </Empty>
      ) : (
        <Table>
          <TableHeader className="border-t bg-muted/30">
            <TableRow className="hover:bg-transparent">
              <TableHead className={cn(HEAD, 'pl-5')}>Session</TableHead>
              <TableHead className={HEAD}>Started</TableHead>
              <TableHead className={HEAD}>Duration</TableHead>
              <TableHead className={HEAD}>Steps</TableHead>
              <TableHead className={HEAD}>Agents</TableHead>
              <TableHead className={HEAD}>Project</TableHead>
              <TableHead className={cn(HEAD, 'pr-5')}>
                <span className="sr-only">Open</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.map((run, i) => (
              <RunRow key={run.id} run={run} index={i} now={now} colorOf={colorOf} onOpen={() => onOpenRun(run.id)} />
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  )
}

interface RunRowProps {
  run: RunSummary
  index: number
  now: number
  colorOf: ReturnType<typeof agentColors>
  onOpen: () => void
}

/** At most this many agent dots in a row. */
const DOTS = 6

function RunRow({ run, index, now, colorOf, onOpen }: RunRowProps) {
  const live = isLive(run.state)
  const share = run.of ? Math.min(1, Math.max(0, run.done / run.of)) : 0
  return (
    <TableRow
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => e.key === 'Enter' && onOpen()}
      data-live={live || undefined}
      style={revealStyle(index)}
      className="run-row reveal cursor-pointer outline-none hover:bg-muted/40 focus-visible:bg-muted/50"
    >
      <TableCell className="py-2.5 pl-5">
        <span className="flex items-center gap-2.5">
          <RunDot state={run.state} />
          <span className="font-medium">{runLabel(run)}</span>
          {(live || run.state === 'stopped') && (
            <span className={cn('text-xs', live ? 'text-primary' : 'text-warning')}>{RUN_LABEL[run.state]}</span>
          )}
        </span>
      </TableCell>
      <TableCell className="text-muted-foreground tabular-nums" title={clock(run.started)}>
        {ago(run.started, now)}
      </TableCell>
      <TableCell className={cn('tabular-nums', live ? 'text-foreground' : 'text-muted-foreground')}>
        {duration((run.ended ?? now) - run.started)}
      </TableCell>
      <TableCell>
        {run.of ? (
          <span className="flex items-center gap-2.5" title={`${run.done} of ${plural(run.of, 'step')}`}>
            <span
              role="progressbar"
              aria-label={`${runLabel(run)} steps`}
              aria-valuemin={0}
              aria-valuemax={run.of}
              aria-valuenow={run.done}
              className="run-bar"
              data-tone={live ? 'live' : run.state === 'stopped' ? 'stopped' : 'ended'}
            >
              <span style={{ transform: `scaleX(${share})` }} />
            </span>
            <span className="text-xs text-muted-foreground tabular-nums">
              <span className={cn(live && 'font-medium text-foreground')}>{run.done}</span>/{run.of}
            </span>
          </span>
        ) : (
          <span className="text-xs text-muted-foreground tabular-nums">{plural(run.done, 'step')}</span>
        )}
      </TableCell>
      <TableCell>
        {run.agents.length > 0 ? (
          <span className="flex items-center gap-2" title={run.agents.map((a) => a.name).join(', ')}>
            <span aria-hidden="true" className="run-agents flex">
              {run.agents.slice(0, DOTS).map((a) => (
                <span key={a.name} className={cn('size-2.5 rounded-full', colorOf(a.name).dot)} />
              ))}
            </span>
            <span className="text-xs text-muted-foreground tabular-nums">{run.agents.length}</span>
          </span>
        ) : (
          <span className="text-xs text-faint">–</span>
        )}
      </TableCell>
      <TableCell>
        <code className="font-mono text-xs text-muted-foreground">{run.project}</code>
      </TableCell>
      <TableCell className="pr-5 text-right">
        <span aria-hidden="true" className="run-open text-xs">
          <span>Open</span>
          <ChevronRight className="size-4" />
        </span>
      </TableCell>
    </TableRow>
  )
}
