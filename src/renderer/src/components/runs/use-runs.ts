// Run summaries, newest first, kept live from the host's `run` events; and
// starting a run, whose refusal ("2 runs already playing") is kept to show.
import type { RunSummary } from '@shared/host-api'
import { useCallback, useEffect, useState } from 'react'

import { projectOf } from '@/components/runs/run-format'
import { host } from '@/host/client'
import { useHostEvents, useHostQuery } from '@/host/use-host'

const newestFirst = (a: RunSummary, b: RunSummary) => b.started - a.started

export interface LiveRuns {
  runs: RunSummary[] | undefined
  error: Error | undefined
  loading: boolean
  reload: () => void
}

/** Every session (or one project's: replays and live sessions on it), newest first, live. */
export function useRuns(project?: string): LiveRuns {
  const loaded = useHostQuery(() => host.runs(), [])
  const [runs, setRuns] = useState<RunSummary[]>()
  useEffect(() => {
    if (loaded.data) setRuns(loaded.data.filter((r) => !project || projectOf(r) === project).sort(newestFirst))
  }, [loaded.data, project])
  useEffect(() => setRuns(undefined), [project])

  useHostEvents((e) => {
    if (e.type === 'agent') {
      // an agent's state moved: its run's sessions follow
      setRuns((all) => {
        const i = all?.findIndex((r) => r.id === e.run) ?? -1
        if (!all || i < 0) return all
        const run = all[i]
        const j = run.agents.findIndex((a) => a.name === e.agent.name)
        const agents = j < 0 ? [...run.agents, e.agent] : run.agents.map((a, k) => (k === j ? e.agent : a))
        const next = all.slice()
        next[i] = { ...run, agents }
        return next
      })
      return
    }
    if (e.type !== 'run' || (project && projectOf(e.run) !== project)) return
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

/** Plays scenario `demo` on `project` (else the project named like it), in a folder of its own; answers the new run, or keeps the refusal in `error`. */
export function useStartRun(onStarted?: (run: RunSummary) => void) {
  const [starting, setStarting] = useState<string | null>(null)
  const [error, setError] = useState<{ demo: string; message: string } | null>(null)
  const start = useCallback(
    async (demo: string, project?: string) => {
      setStarting(demo)
      setError(null)
      try {
        const run = await host.startRun(demo, project ?? demo)
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
