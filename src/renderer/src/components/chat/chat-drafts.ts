import { useEffect, useRef, useState } from 'react'
import type { AgentAttachment, AgentLimits } from '@shared/agent-api'

type Draft = { text: string; attachments: AgentAttachment[]; limits?: AgentLimits }
const prefix = 'connect.agent.draft.'
const cache = new Map<string, Draft>()
const versions = new Map<string, number>()
const blank = (): Draft => ({ text: '', attachments: [] })
export const sessionDraftKey = (id: string) => `session:${id}`
export const newDraftKey = (project: string, cwd: string) => `new:${JSON.stringify(project ? ['project', project] : ['folder', cwd])}`
let database: Promise<IDBDatabase> | undefined
function db() {
  return database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('connect-agent-drafts', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('drafts')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => { database = undefined; reject(request.error) }
  })
}
async function readSaved(key: string): Promise<Draft> {
  const store = (await db()).transaction('drafts').objectStore('drafts')
  return new Promise((resolve, reject) => {
    const request = store.get(key)
    request.onsuccess = () => resolve(request.result ?? blank())
    request.onerror = () => reject(request.error)
  })
}
async function writeSaved(key: string, value: Draft) {
  const transaction = (await db()).transaction('drafts', 'readwrite')
  const store = transaction.objectStore('drafts')
  if (value.text || value.attachments.length || value.limits) store.put(value, key)
  else store.delete(key)
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
  })
}
function quickRead(key: string): Draft {
  if (cache.has(key)) return cache.get(key)!
  try {
    const saved = JSON.parse(localStorage.getItem(prefix + key) ?? 'null')
    return { text: typeof saved?.text === 'string' ? saved.text : '', attachments: [], limits: saved?.limits }
  } catch { return blank() }
}

/** Text has a synchronous fallback; IndexedDB holds the complete attachment draft. */
export function useChatDraft(initialKey: string) {
  const current = useRef({ key: initialKey, value: quickRead(initialKey), generation: 0, dirty: false, textTouched: false, attachmentsTouched: false, settingsTouched: false, loaded: cache.has(initialKey) })
  const [draft, setDraft] = useState(current.current.value)
  const [ready, setReady] = useState(current.current.loaded)
  const [storageError, setStorageError] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const mounted = useRef(true)

  function persist(snapshot = { ...current.current }) {
    if (!snapshot.dirty) return
    const version = (versions.get(snapshot.key) ?? 0) + 1
    versions.set(snapshot.key, version)
    try {
      if (snapshot.value.text || snapshot.value.limits) localStorage.setItem(prefix + snapshot.key, JSON.stringify({ text: snapshot.value.text, limits: snapshot.value.limits, updated: Date.now() }))
      else localStorage.removeItem(prefix + snapshot.key)
    } catch { /* The full draft is also saved in IndexedDB below. */ }
    void (async () => {
      let value = snapshot.value
      if (!snapshot.loaded) {
        const saved = await readSaved(snapshot.key)
        value = { text: snapshot.textTouched ? value.text : saved.text || value.text, attachments: snapshot.attachmentsTouched ? value.attachments : saved.attachments, limits: snapshot.settingsTouched ? value.limits : saved.limits ?? value.limits }
      }
      if (versions.get(snapshot.key) !== version) return
      cache.set(snapshot.key, value)
      await writeSaved(snapshot.key, value)
      if (mounted.current && current.current.key === snapshot.key) setStorageError('')
    })().catch(() => { if (mounted.current) setStorageError('This draft could not be saved on this device. Keep this window open to retain its attachments.') })
  }
  function flush() { clearTimeout(timer.current); persist() }
  function hydrate() {
    const { key, generation } = current.current
    if (current.current.loaded) return
    void readSaved(key).then((saved) => {
      if (!mounted.current || current.current.key !== key || current.current.generation !== generation) return
      const state = current.current
      state.value = { text: state.textTouched ? state.value.text : saved.text || state.value.text, attachments: state.attachmentsTouched ? state.value.attachments : saved.attachments, limits: state.settingsTouched ? state.value.limits : saved.limits ?? state.value.limits }
      state.loaded = true
      setReady(true)
      cache.set(key, state.value)
      setDraft(state.value)
      if (state.dirty) persist()
    }).catch(() => { if (mounted.current && current.current.key === key) { setReady(true); setStorageError('Saved attachments could not be loaded. Your typed draft is still available.') } })
  }
  function change(value: Draft, field: 'text' | 'attachments' | 'limits') {
    current.current.value = value
    current.current.dirty = true
    if (field === 'text') current.current.textTouched = true
    else if (field === 'attachments') current.current.attachmentsTouched = true
    else current.current.settingsTouched = true
    if (current.current.loaded) cache.set(current.current.key, value)
    setDraft(value)
    clearTimeout(timer.current)
    timer.current = setTimeout(flush, 250)
  }
  function open(key: string, initial?: Draft) {
    if (key === current.current.key && !initial) return
    flush()
    const value = initial ?? quickRead(key)
    current.current = { key, value, generation: current.current.generation + 1, dirty: !!initial, textTouched: !!initial, attachmentsTouched: !!initial, settingsTouched: !!initial, loaded: !!initial || cache.has(key) }
    setReady(current.current.loaded)
    setDraft(value)
    if (initial) persist()
    else hydrate()
  }
  function clear(key: string, sent?: Draft) {
    const value = current.current.key === key ? current.current.value : cache.get(key)
    if (sent && value && (value.text !== sent.text || value.attachments.length !== sent.attachments.length || value.attachments.some((item, index) => item.id !== sent.attachments[index].id || item.data !== sent.attachments[index].data))) return
    const cleared = { ...blank(), limits: value?.limits }
    cache.set(key, cleared)
    if (current.current.key === key) {
      current.current.loaded = true
      setReady(true)
      change(cleared, 'text')
      current.current.attachmentsTouched = true
    }
    persist({ key, value: cleared, generation: 0, dirty: true, loaded: true, textTouched: true, attachmentsTouched: true, settingsTouched: true })
  }
  useEffect(() => {
    mounted.current = true
    hydrate()
    const save = () => flush()
    window.addEventListener('beforeunload', save)
    return () => { flush(); mounted.current = false; window.removeEventListener('beforeunload', save) }
  }, [])
  return {
    input: draft.text, attachments: draft.attachments, storageError, ready,
    key: () => current.current.key, snapshot: () => current.current.value,
    setInput: (value: string | ((text: string) => string)) => change({ ...current.current.value, text: typeof value === 'function' ? value(current.current.value.text) : value }, 'text'),
    setAttachments: (attachments: AgentAttachment[]) => change({ ...current.current.value, attachments }, 'attachments'),
    setLimits: (limits: AgentLimits) => change({ ...current.current.value, limits }, 'limits'),
    open, clear,
    has: (id: string) => { const value = quickRead(sessionDraftKey(id)); return !!value.text || !!value.attachments.length },
  }
}
