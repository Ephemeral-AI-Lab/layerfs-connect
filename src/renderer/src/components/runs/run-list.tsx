import type { RunSummary } from '@shared/host-api'
import { ChevronRight, Plus, RotateCw, TriangleAlert } from 'lucide-react'

import { RunDot } from '@/components/runs/run-badges'
import { RUN_LABEL, ago, clock, duration, isLive, plural, runLabel } from '@/components/runs/run-format'
import { useNow } from '@/components/runs/use-run'
import { useRuns, useStartRun } from '@/components/runs/use-runs'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

interface RunListProps {
  demo: string
  onOpenRun: (runId: string) => void
}

/** A demo project's sessions (one per replay), newest first, with a New session button. */
export function RunList({ demo, onOpenRun }: RunListProps) {
  const { runs, error, loading, reload } = useRuns(demo)
  const { start, starting, error: refused, clearError } = useStartRun((run) => onOpenRun(run.id))
  const anyLive = runs?.some((r) => isLive(r.state)) ?? false
  const now = useNow(anyLive)

  return (
    <section aria-label="Runs" className="rounded-xl border bg-card">
      <header className="flex items-center gap-2 px-5 pt-4 pb-3">
        <h3 className="text-sm font-semibold">Sessions</h3>
        {runs && <span className="text-xs text-faint">{runs.length}</span>}
        <Button size="sm" className="ml-auto" onClick={() => void start(demo)} disabled={starting !== null}>
          <Plus /> {starting ? 'Starting…' : 'New session'}
        </Button>
      </header>

      {refused && (
        <div role="alert" className="mx-5 mb-3 flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-[13px] text-destructive ring-1 ring-destructive/25 ring-inset">
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span className="min-w-0 flex-1">Could not start a session: {refused.message}</span>
          <button type="button" onClick={clearError} className="text-xs font-medium underline-offset-2 hover:underline">
            Dismiss
          </button>
        </div>
      )}

      {error && !runs ? (
        <div className="flex flex-col items-center gap-2 px-5 pt-3 pb-7 text-center">
          <p className="text-sm font-medium">Could not load the runs</p>
          <p className="max-w-sm text-xs text-muted-foreground">{error.message}</p>
          <Button variant="outline" size="sm" onClick={reload}>
            <RotateCw /> Try again
          </Button>
        </div>
      ) : loading || !runs ? (
        <div className="flex flex-col gap-2 px-5 pb-5">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-9" />
          ))}
        </div>
      ) : runs.length === 0 ? (
        <div className="flex flex-col items-center gap-1.5 px-5 pt-3 pb-7 text-center">
          <p className="text-sm font-medium">No sessions yet</p>
          <p className="max-w-sm text-xs text-muted-foreground">
            A session Inits this demo’s LayerFS project from its fixture (starting it again after the first) and plays its agents live on the real backend.
          </p>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="pl-5 text-xs text-faint">Session</TableHead>
              <TableHead className="text-xs text-faint">Started</TableHead>
              <TableHead className="text-xs text-faint">Duration</TableHead>
              <TableHead className="text-xs text-faint">Steps</TableHead>
              <TableHead className="text-xs text-faint">Project</TableHead>
              <TableHead className="pr-5 text-xs text-faint">
                <span className="sr-only">Open</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.map((run) => (
              <RunRow key={run.id} run={run} now={now} onOpen={() => onOpenRun(run.id)} />
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  )
}

function RunRow({ run, now, onOpen }: { run: RunSummary; now: number; onOpen: () => void }) {
  return (
    <TableRow
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => e.key === 'Enter' && onOpen()}
      className="cursor-pointer align-top outline-none focus-visible:bg-muted/50"
    >
      <TableCell className="pl-5">
        <span className="flex items-center gap-2.5">
          <RunDot state={run.state} />
          <span className="font-medium">{runLabel(run)}</span>
          {(isLive(run.state) || run.state === 'stopped') && <span className="text-xs text-muted-foreground">{RUN_LABEL[run.state]}</span>}
        </span>
      </TableCell>
      <TableCell className="text-muted-foreground" title={clock(run.started)}>
        {ago(run.started, now)}
      </TableCell>
      <TableCell className="text-muted-foreground tabular-nums">{duration((run.ended ?? now) - run.started)}</TableCell>
      <TableCell>
        <span className="text-xs text-muted-foreground tabular-nums">{plural(run.done, 'step')}</span>
      </TableCell>
      <TableCell>
        <code className="font-mono text-xs text-muted-foreground">{run.project}</code>
      </TableCell>
      <TableCell className="pr-5 text-right">
        <ChevronRight aria-hidden="true" className="ml-auto size-4 text-faint" />
      </TableCell>
    </TableRow>
  )
}
