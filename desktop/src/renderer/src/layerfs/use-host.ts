import { useCallback, useEffect, useRef, useState } from 'react'

import { onHostEvent } from '@/layerfs/client'
import type { HostEvent, RunEvent } from '@/layerfs/host-api'

export interface Loaded<T> {
  data: T | undefined
  error: Error | undefined
  loading: boolean
  observedAt?: number
  reload: () => void
}

/** The last answer of each keyed query (useHostQuery's `key`), kept for this window's life. */
const answers = new Map<string, unknown>()

/** The last answer a keyed query got under `key`, if any. */
export const lastAnswer = <T>(key: string) => answers.get(key) as T | undefined

/**
 * Loads `load()` and again whenever `deps` change or `reload` is called.
 * With a `key`, the last answer under it shows at once, as a page opens or the
 * key changes, while the fresh read runs: a tab that reads a run or a
 * project's state opens on what the last one read, not on a spinner.
 * One read at a time: a `reload` (a poll, a Refresh) while one runs waits for
 * it and then reads once more, so a slow read still lands instead of being
 * dropped by every poll after it. New `deps` drop the read in flight.
 */
export function useHostQuery<T>(load: () => Promise<T>, deps: unknown[], key?: string): Loaded<T> {
  const [data, setData] = useState<T | undefined>(() => (key ? (answers.get(key) as T | undefined) : undefined))
  const [error, setError] = useState<Error>()
  const [loading, setLoading] = useState(true)
  const [observedAt, setObservedAt] = useState<number>()
  const loader = useRef(load)
  loader.current = load
  const keyRef = useRef(key)
  keyRef.current = key
  /** Bumped by new deps and unmount: a read of an older generation is dropped. */
  const generation = useRef(0)
  const running = useRef(false)
  const again = useRef(false)
  const run = useCallback(() => {
    if (running.current) {
      again.current = true
      return
    }
    running.current = true
    const g = generation.current
    const k = keyRef.current
    setLoading(true)
    loader.current().then(
      (value) => {
        if (k) answers.set(k, value)
        if (g === generation.current) setData(value), setError(undefined), setObservedAt(Date.now())
      },
      (e: unknown) => g === generation.current && setError(e instanceof Error ? e : new Error(String(e))),
    ).finally(() => {
      if (g !== generation.current) return
      running.current = false
      setLoading(false)
      if (again.current) {
        again.current = false
        run()
      }
    })
  }, [])
  useEffect(() => {
    generation.current++
    running.current = false
    again.current = false
    if (key && answers.has(key)) setData(answers.get(key) as T)
    run()
    return () => {
      generation.current++
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, key])
  return { data, error, loading, observedAt, reload: run }
}

/** Calls `listener` for every RunEvent while mounted (Storage's `storage-job` and `storage` events and `chat` go to onHostEvent's listeners only). */
export function useHostEvents(listener: (event: RunEvent) => void) {
  const current = useRef(listener)
  current.current = listener
  useEffect(() => onHostEvent((e) => { if (e.type !== 'storage-job' && e.type !== 'storage' && e.type !== 'chat' && e.type !== 'chat-summary') current.current(e) }), [])
}

/** Calls `listener` for Storage's events while mounted: each job sample and each `storage` view change. */
export function useStorageEvents(listener: (event: Extract<HostEvent, { type: 'storage-job' | 'storage' }>) => void) {
  const current = useRef(listener)
  current.current = listener
  useEffect(() => onHostEvent((e) => { if (e.type === 'storage-job' || e.type === 'storage') current.current(e) }), [])
}

/** How often a page re-reads the list calls while it is shown (#537 §8.9): they carry state and op, so work started elsewhere (the CLI, another window) shows. */
export const POLL_MS = 5000

/** Calls `tick` every `ms` while mounted and the window is visible; never while hidden. */
export function usePoll(tick: () => void, ms = POLL_MS, enabled = true) {
  const current = useRef(tick)
  current.current = tick
  useEffect(() => {
    if (!enabled) return
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') current.current()
    }, ms)
    return () => clearInterval(timer)
  }, [ms, enabled])
}
