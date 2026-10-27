import { useCallback, useEffect, useRef, useState } from 'react'

import { onHostEvent } from '@/host/client'
import type { RunEvent } from '@shared/host-api'

export interface Loaded<T> {
  data: T | undefined
  error: Error | undefined
  loading: boolean
  reload: () => void
}

/** Loads `load()` and again whenever `deps` change or `reload` is called. */
export function useHostQuery<T>(load: () => Promise<T>, deps: unknown[]): Loaded<T> {
  const [data, setData] = useState<T>()
  const [error, setError] = useState<Error>()
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)
  const loader = useRef(load)
  loader.current = load
  useEffect(() => {
    let live = true
    setLoading(true)
    loader.current().then(
      (value) => live && (setData(value), setError(undefined), setLoading(false)),
      (e: unknown) => live && (setError(e instanceof Error ? e : new Error(String(e))), setLoading(false)),
    )
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick])
  const reload = useCallback(() => setTick((t) => t + 1), [])
  return { data, error, loading, reload }
}

/** Calls `listener` for every host event while mounted. */
export function useHostEvents(listener: (event: RunEvent) => void) {
  const current = useRef(listener)
  current.current = listener
  useEffect(() => onHostEvent((e) => current.current(e)), [])
}
