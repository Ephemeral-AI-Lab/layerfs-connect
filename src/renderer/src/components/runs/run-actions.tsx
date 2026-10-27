import type { RunDetail } from '@shared/host-api'
import { CircleStop, RotateCw } from 'lucide-react'
import { useState } from 'react'

import { isLive } from '@/components/runs/run-format'
import { useStartRun } from '@/components/runs/use-runs'
import { Button } from '@/components/ui/button'
import { host } from '@/host/client'

/** Stop (while live) and Run again, with what went wrong. */
export function useRunActions(run: RunDetail, onOpenRun?: (runId: string) => void) {
  const [stopping, setStopping] = useState(false)
  const [stopError, setStopError] = useState<string>()
  const again = useStartRun((r) => onOpenRun?.(r.id))
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
  return {
    live: isLive(run.state),
    stop,
    stopping,
    runAgain: () => void again.start(run.demo),
    starting: again.starting !== null,
    error: stopError ?? again.error?.message,
  }
}

export type RunActions = ReturnType<typeof useRunActions>

/** Stop while the run plays, Run again once it ended. */
export function RunActionButton({ actions, className }: { actions: RunActions; className?: string }) {
  return actions.live ? (
    <Button variant="ghost" size="sm" onClick={() => void actions.stop()} disabled={actions.stopping} className={className}>
      <CircleStop /> {actions.stopping ? 'Stopping…' : 'Stop'}
    </Button>
  ) : (
    <Button variant="ghost" size="sm" onClick={actions.runAgain} disabled={actions.starting} className={className}>
      <RotateCw /> {actions.starting ? 'Starting…' : 'Run again'}
    </Button>
  )
}
