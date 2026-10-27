// One run, live: loaded once with host.run(id), then kept current from the
// host's events. Events are queued and applied once per animation frame, so
// a burst of step/call events costs one render.
import type { DemoDetail, RunDetail, RunEvent, StepResult, StepView, TraceCall } from '@shared/host-api'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { host } from '@/host/client'
import { useHostEvents, useHostQuery } from '@/host/use-host'
import { stepKey } from '@/components/runs/run-format'

const forRun = (e: RunEvent, id: string) => (e.type === 'run' ? e.run.id === id : e.run === id)

function unionCalls(a: TraceCall[], b: TraceCall[]): TraceCall[] {
  if (b.length === 0) return a
  if (a.length === 0) return b
  const seen = new Set(a.map((c) => c.id))
  const extra = b.filter((c) => !seen.has(c.id))
  return extra.length ? [...a, ...extra] : a
}

/** Applies a batch of events to a run; unchanged parts keep their identity. */
export function applyEvents(run: RunDetail, events: RunEvent[], orphans: Map<string, TraceCall[]>): RunDetail {
  let summary: Partial<RunDetail> | null = null
  let steps = run.steps
  let agents = run.agents
  let messages = run.messages
  let checks = run.checks
  let ownSteps = false
  let index: Map<string, number> | null = null
  const indexOf = () => (index ??= new Map(steps.map((s, i) => [stepKey(s.agent, s.index), i])))
  const own = () => {
    if (!ownSteps) (steps = steps.slice()), (ownSteps = true)
  }

  for (const e of events) {
    switch (e.type) {
      case 'run':
        summary = { ...(summary ?? {}), ...e.run }
        break
      case 'agent': {
        const i = agents.findIndex((a) => a.name === e.agent.name)
        agents = i < 0 ? [...agents, e.agent] : agents.map((a, j) => (j === i ? e.agent : a))
        break
      }
      case 'step': {
        const key = stepKey(e.step.agent, e.step.index)
        const i = indexOf().get(key)
        const waiting = orphans.get(key) ?? []
        orphans.delete(key)
        own()
        if (i === undefined) {
          steps.push({ ...e.step, calls: unionCalls(e.step.calls, waiting) })
          indexOf().set(key, steps.length - 1)
        } else {
          steps[i] = { ...e.step, calls: unionCalls(unionCalls(steps[i].calls, e.step.calls), waiting) }
        }
        break
      }
      case 'call': {
        const i = indexOf().get(e.call.step)
        if (i === undefined) {
          orphans.set(e.call.step, unionCalls(orphans.get(e.call.step) ?? [], [e.call]))
          break
        }
        const calls = unionCalls(steps[i].calls, [e.call])
        if (calls !== steps[i].calls) {
          own()
          steps[i] = { ...steps[i], calls }
        }
        break
      }
      case 'message': {
        const m = e.message
        if (!messages.some((x) => x.at === m.at && x.from === m.from && x.text === m.text)) messages = [...messages, m]
        break
      }
      case 'checks':
        checks = e.checks
        break
    }
  }
  return { ...run, ...summary, id: run.id, steps, agents, messages, checks }
}

export interface LiveRun {
  run: RunDetail | undefined
  demo: DemoDetail | undefined
  /** The script step of a result, by "<agent>:<index>". */
  views: Map<string, StepView>
  error: Error | undefined
  loading: boolean
  reload: () => void
}

export function useRun(runId: string): LiveRun {
  const loaded = useHostQuery(() => host.run(runId), [runId])
  const [run, setRun] = useState<RunDetail>()
  const queue = useRef<RunEvent[]>([])
  const frame = useRef(0)
  const orphans = useRef(new Map<string, TraceCall[]>())

  const ready = useRef(false)

  const flush = useCallback(() => {
    frame.current = 0
    // Until the run has loaded, events wait in the queue.
    if (!ready.current || queue.current.length === 0) return
    const events = queue.current
    queue.current = []
    setRun((current) => (current ? applyEvents(current, events, orphans.current) : current))
  }, [])

  // A fresh load replaces the run, then applies whatever arrived meanwhile.
  useEffect(() => {
    if (!loaded.data || loaded.data.id !== runId) return
    orphans.current = new Map()
    const pending = queue.current
    queue.current = []
    setRun(pending.length ? applyEvents(loaded.data, pending, orphans.current) : loaded.data)
    ready.current = true
  }, [loaded.data, runId])

  useEffect(() => {
    setRun(undefined)
    ready.current = false
    queue.current = []
    return () => {
      if (frame.current) cancelAnimationFrame(frame.current)
      frame.current = 0
    }
  }, [runId])

  useHostEvents((e) => {
    if (!forRun(e, runId)) return
    queue.current.push(e)
    if (!frame.current) frame.current = requestAnimationFrame(flush)
  })

  const demoId = run?.demo ?? loaded.data?.demo
  const demo = useHostQuery(() => (demoId ? host.demo(demoId) : Promise.resolve(undefined)), [demoId])

  const views = useMemo(() => {
    const map = new Map<string, StepView>()
    for (const [agent, steps] of Object.entries(demo.data?.script ?? {}))
      for (const s of steps) map.set(stepKey(agent, s.index), s)
    return map
  }, [demo.data])

  const current = run?.id === runId ? run : undefined
  return {
    run: current,
    demo: demo.data,
    views,
    error: loaded.error,
    loading: loaded.loading && !current,
    reload: loaded.reload,
  }
}

/** Date.now(), ticking every `ms` while `active`. */
export function useNow(active: boolean, ms = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [active, ms])
  return now
}

export type { StepResult }
