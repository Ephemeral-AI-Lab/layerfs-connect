// Run summaries, newest first, kept live from the host's `run` events; and
// starting a run, whose refusal ("2 runs already playing") is kept to show.
import type { RunSummary } from '@shared/host-api'
import { useCallback, useEffect, useState } from 'react'

import { host } from '@/host/client'
import { useHostEvents, useHostQuery } from '@/host/use-host'

const newestFirst = (a: RunSummary, b: RunSummary) => b.started - a.started

export interface LiveRuns {
  runs: RunSummary[] | undefined
  error: Error | undefined
  loading: boolean
  reload: () => void
}

/** Every run (or one demo's), newest first, live. */
export function useRuns(demo?: string): LiveRuns {
  const loaded = useHostQuery(() => host.runs(demo), [demo])
  const [runs, setRuns] = useState<RunSummary[]>()
  useEffect(() => {
    if (loaded.data) setRuns([...loaded.data].sort(newestFirst))
  }, [loaded.data])
  useEffect(() => setRuns(undefined), [demo])

  useHostEvents((e) => {
    if (e.type !== 'run' || (demo && e.run.demo !== demo)) return
    setRuns((all) => {
      if (!all) return all
      const i = all.findIndex((r) => r.id === e.run.id)
      if (i < 0) return [e.run, ...all].sort(newestFirst)
      const next = all.slice()
      next[i] = e.run
      return next
    })
  })

  return { runs, error: loaded.error, loading: loaded.loading && !runs, reload: loaded.reload }
}

/** Starts a run of `demo`; answers the new run, or keeps the refusal in `error`. */
export function useStartRun(onStarted?: (run: RunSummary) => void) {
  const [starting, setStarting] = useState<string | null>(null)
  const [error, setError] = useState<{ demo: string; message: string } | null>(null)
  const start = useCallback(
    async (demo: string) => {
      setStarting(demo)
      setError(null)
      try {
        const run = await host.startRun(demo)
        onStarted?.(run)
        return run
      } catch (e) {
        setError({ demo, message: e instanceof Error ? e.message : String(e) })
        return undefined
      } finally {
        setStarting(null)
      }
    },
    [onStarted],
  )
  return { start, starting, error, clearError: () => setError(null) }
}
