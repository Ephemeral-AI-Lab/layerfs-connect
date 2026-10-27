import type { RunDetail } from '@shared/host-api'
import { ChevronLeft, CircleStop, Clock, FolderGit2, TriangleAlert } from 'lucide-react'
import { useState } from 'react'

import { Progress, RunStateBadge } from '@/components/runs/run-badges'
import { RUN_TONE, clock, duration, isLive, runLabel } from '@/components/runs/run-format'
import { useNow } from '@/components/runs/use-run'
import { Button } from '@/components/ui/button'
import { host } from '@/host/client'

interface RunHeaderProps {
  run: RunDetail
  title: string
  onOpenProject?: (demo: string) => void
}

export function RunHeader({ run, title, onOpenProject }: RunHeaderProps) {
  const live = isLive(run.state)
  const now = useNow(live)
  const [stopping, setStopping] = useState(false)
  const [stopError, setStopError] = useState<string>()
  const elapsed = (run.ended ?? now) - run.started
  const pct = run.of > 0 ? Math.round((run.done / run.of) * 100) : 0

  const stop = async () => {
    setStopping(true)
    setStopError(undefined)
    try {
      await host.stopRun(run.id)
    } catch (e) {
      setStopError(e instanceof Error ? e.message : String(e))
    } finally {
      setStopping(false)
    }
  }

  return (
    <header className="flex flex-col gap-3 border-b bg-card/40 px-6 pt-4 pb-3.5">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          {onOpenProject && (
            <button
              type="button"
              onClick={() => onOpenProject(run.demo)}
              className="-ml-1 flex w-fit items-center gap-0.5 rounded text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ChevronLeft aria-hidden="true" className="size-3.5" />
              {title}
            </button>
          )}
          <div className="flex min-w-0 items-center gap-2.5">
            <h1 className="truncate text-[17px] font-semibold tracking-[-0.01em]">
              {title} <span className="font-normal text-muted-foreground">· {runLabel(run)}</span>
            </h1>
            <RunStateBadge state={run.state} />
          </div>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {stopError && <span className="max-w-64 truncate text-xs text-destructive">{stopError}</span>}
          {live && (
            <Button variant="outline" size="sm" onClick={stop} disabled={stopping}>
              <CircleStop /> {stopping ? 'Stopping…' : 'Stop'}
            </Button>
          )}
        </div>
      </div>

      <dl className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5" title="The LayerFS project this run made">
          <dt className="sr-only">Project</dt>
          <FolderGit2 aria-hidden="true" className="size-3.5 text-faint" />
          <dd className="font-mono text-foreground">{run.project}</dd>
        </div>
        <div className="flex items-center gap-1.5">
          <dt className="sr-only">Elapsed</dt>
          <Clock aria-hidden="true" className="size-3.5 text-faint" />
          <dd className="tabular-nums">
            <span className="text-foreground">{duration(elapsed)}</span> · started {clock(run.started)}
          </dd>
        </div>
        <div className="flex min-w-56 flex-1 items-center gap-2.5">
          <dt className="sr-only">Steps</dt>
          <Progress done={run.done} of={run.of} tone={RUN_TONE[run.state]} className="max-w-72 flex-1" />
          <dd className="tabular-nums">
            <span className="text-foreground">{run.done}</span>/{run.of} steps · {pct}%
          </dd>
        </div>
        {run.phase && (
          <div className="flex items-center gap-1.5">
            <dt>Phase</dt>
            <dd className="rounded-md bg-muted px-1.5 py-0.5 font-medium text-foreground">{run.phase}</dd>
          </div>
        )}
      </dl>

      {run.error && (
        <div role="alert" className="flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-[13px] text-destructive ring-1 ring-destructive/25 ring-inset">
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span className="min-w-0 break-words whitespace-pre-wrap">{run.error}</span>
        </div>
      )}
    </header>
  )
}
