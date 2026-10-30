import { useCallback, useEffect, useRef, useState } from 'react'

import { onHostEvent } from '@/host/client'
import type { HostEvent, RunEvent } from '@shared/host-api'

export interface Loaded<T> {
  data: T | undefined
  error: Error | undefined
  loading: boolean
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
 */
export function useHostQuery<T>(load: () => Promise<T>, deps: unknown[], key?: string): Loaded<T> {
  const [data, setData] = useState<T | undefined>(() => (key ? (answers.get(key) as T | undefined) : undefined))
  const [error, setError] = useState<Error>()
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)
  const loader = useRef(load)
  loader.current = load
  useEffect(() => {
    let live = true
    if (key && answers.has(key)) setData(answers.get(key) as T)
    setLoading(true)
    loader.current().then(
      (value) => {
        if (key) answers.set(key, value)
        if (live) setData(value), setError(undefined), setLoading(false)
      },
      (e: unknown) => live && (setError(e instanceof Error ? e : new Error(String(e))), setLoading(false)),
    )
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, key, tick])
  const reload = useCallback(() => setTick((t) => t + 1), [])
  return { data, error, loading, reload }
}

/** Calls `listener` for every RunEvent while mounted (chat events and Storage's `sync` and `storage` events go to onHostEvent's listeners only). */
export function useHostEvents(listener: (event: RunEvent) => void) {
  const current = useRef(listener)
  current.current = listener
  useEffect(() => onHostEvent((e) => { if (e.type !== 'chat' && e.type !== 'chat-navigate' && e.type !== 'sync' && e.type !== 'storage') current.current(e) }), [])
}

/** Calls `listener` for Storage's events while mounted: each `sync` job sample and each `storage` view change. */
export function useStorageEvents(listener: (event: Extract<HostEvent, { type: 'sync' | 'storage' }>) => void) {
  const current = useRef(listener)
  current.current = listener
  useEffect(() => onHostEvent((e) => { if (e.type === 'sync' || e.type === 'storage') current.current(e) }), [])
}
