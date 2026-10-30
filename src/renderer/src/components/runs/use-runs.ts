// Scenario runs, newest first, kept live from the host's `run` events; and
// starting one, whose refusal ("2 runs already playing") is kept to show.
import type { RunSummary } from '@shared/host-api'
import { useCallback, useEffect, useState } from 'react'

import { host } from '@/host/client'
import { useHostEvents, useHostQuery } from '@/host/use-host'

const newestFirst = (a: RunSummary, b: RunSummary) => b.started - a.started

/** A scenario run this build shows: old Pi sessions (`kind: 'live'`) and runs saved as `idle` stay hidden. */
const shownRun = (run: RunSummary) => run.kind !== 'live' && (run.state as string) !== 'idle'

export interface LiveRuns {
  runs: RunSummary[] | undefined
  error: Error | undefined
  loading: boolean
  reload: () => void
}

/** Every scenario run (or those that played on project key `project`), newest first, live. */
export function useRuns(project?: string): LiveRuns {
  const loaded = useHostQuery(() => host.runs(), [], 'runs')
  const [runs, setRuns] = useState<RunSummary[]>()
  const mine = useCallback((r: RunSummary) => shownRun(r) && (!project || r.project === project), [project])
  useEffect(() => {
    if (loaded.data) setRuns(loaded.data.filter(mine).sort(newestFirst))
  }, [loaded.data, mine])

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
    if (e.type === 'run-removed') {
      setRuns((all) => all?.filter((r) => r.id !== e.id))
      return
    }
    if (e.type !== 'run' || !mine(e.run)) return
    setRuns((all) => {
      if (!all) return all
      const i = all.findIndex((r) => r.id === e.run.id)
      if (i < 0) return [e.run, ...all].sort(newestFirst)
      const next = all.slice()
      next[i] = { ...all[i], ...e.run }
      return next.sort(newestFirst)
    })
  })

  return { runs, error: loaded.error, loading: loaded.loading && !runs, reload: loaded.reload }
}

/**
 * Plays scenario `demo` (or, with `ALL`, every scenario) on project key
 * `project`, each in a folder of its own; answers the new runs, or keeps the
 * refusal in `error`.
 */
export function useStartRun(onStarted?: (runs: RunSummary[]) => void) {
  const [starting, setStarting] = useState<string | null>(null)
  const [error, setError] = useState<{ demo: string; message: string } | null>(null)
  const start = useCallback(
    async (demo: string, project: string) => {
      setStarting(demo)
      setError(null)
      try {
        const runs = demo === ALL ? await host.startAll(project) : [await host.startRun(demo, project)]
        onStarted?.(runs)
        return runs
      } catch (e) {
        setError({ demo, message: e instanceof Error ? e.message : String(e) })
        return undefined
      } finally {
        setStarting(null)
      }
    },
    [onStarted],
  )
  const clearError = useCallback(() => setError(null), [])
  return { start, starting, error, clearError }
}

/** useStartRun's `demo` for every scenario at once. */
export const ALL = '*all'
