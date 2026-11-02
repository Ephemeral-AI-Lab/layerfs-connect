// The window's tabs: each one shows a page (Storage, Compute, Projects, a chat)
// or a project, and keeps its own place. Only the active tab is mounted; the
// others come back from what is stored here. The list survives a relaunch.
// Like a browser tab, each keeps the places it showed before (Back) and
// after (Forward): opening a place in a tab pushes the one it left.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { NavId, Selection } from '@/components/app-sidebar'

/** A request to open the Chat page on a project or a conversation; a new id remounts the page. */
/** `fresh`: a new chat, never the last conversation restored from an earlier visit. */
export type ChatIntent = { id: number; project?: string; session?: string; fresh?: boolean }
/** Where a project tab opens: its own tab (history, files, …) and branch. */
export type ProjectLocation = { tab?: string; branch?: string }

/** A place a tab showed, to go Back or Forward to; `label` names it (a chat's title). */
export type TabPlace = { selected: Selection; location?: ProjectLocation; label?: string }

export interface Tab {
  id: string
  selected: Selection
  chat?: ChatIntent
  location?: ProjectLocation
  back?: TabPlace[]
  forward?: TabPlace[]
  /** What the place shown now is called, once known (a chat's title): it goes with it onto Back. */
  label?: string
}
export type TabTarget = Omit<Tab, 'id' | 'back' | 'forward' | 'label'>

interface TabsState {
  tabs: Tab[]
  active: string
}

const STORAGE_KEY = 'connect.tabs'
const CLOSED_KEPT = 20
const HISTORY_KEPT = 30
const NAV_IDS: NavId[] = ['chat', 'projects', 'storage', 'compute']

let counter = 0
const newId = () => `t${Date.now().toString(36)}${(counter++).toString(36)}`

/**
 * Whether two selections are the same place, so a click on it switches to
 * its tab instead of opening another. Each page is one place; a chat counts
 * by its conversation, and a new chat (no conversation yet) is never shared.
 */
export function sameTarget(a: Selection, b: Selection): boolean {
  if (a.kind !== b.kind || a.id !== b.id) return false
  if (a.kind === 'nav' && b.kind === 'nav' && a.id === 'chat') return !!a.session && a.session === b.session
  return true
}

/** Removes a deleted chat from open tabs, navigation history and recently closed targets. */
export function withoutSession<T extends TabTarget & { back?: TabPlace[]; forward?: TabPlace[] }>(targets: T[], sessionId: string): T[] {
  const matches = (target: Pick<TabTarget, 'selected' | 'chat'>) => target.selected.kind === 'nav'
    && target.selected.id === 'chat'
    && (target.selected.session || target.chat?.session) === sessionId
  const history = (items?: TabPlace[]) => {
    if (!items?.some(matches)) return items
    const kept = items.filter((place) => !matches(place))
    return kept.length ? kept : undefined
  }
  return targets.filter((target) => !matches(target)).map((target) => {
    const back = history(target.back)
    const forward = history(target.forward)
    const chat = target.chat?.session === sessionId ? { ...target.chat, session: undefined } : target.chat
    return back === target.back && forward === target.forward && chat === target.chat ? target : { ...target, chat, back, forward }
  })
}

function validSelection(value: unknown): value is Selection {
  if (!value || typeof value !== 'object') return false
  const s = value as Record<string, unknown>
  if (s.kind === 'project') return typeof s.id === 'string' && s.id.length > 0
  return s.kind === 'nav' && NAV_IDS.includes(s.id as NavId) && (s.session === undefined || typeof s.session === 'string')
}

const places = (value: unknown): TabPlace[] | undefined => {
  if (!Array.isArray(value)) return undefined
  const kept = value
    .filter((p): p is TabPlace => !!p && typeof p === 'object' && validSelection((p as TabPlace).selected))
    .map(({ selected, location, label }) => ({ selected, location: location && typeof location === 'object' ? location : undefined, label: typeof label === 'string' ? label : undefined }))
    .slice(-HISTORY_KEPT)
  return kept.length ? kept : undefined
}

function load(): TabsState | null {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as { tabs?: unknown; active?: unknown } | null
    if (!raw || !Array.isArray(raw.tabs)) return null
    const tabs: Tab[] = raw.tabs
      .filter((t): t is Tab => !!t && typeof (t as Tab).id === 'string' && validSelection((t as Tab).selected))
      .map((t) => ({ id: t.id, selected: t.selected, location: t.location && typeof t.location === 'object' ? t.location : undefined, back: places(t.back), forward: places(t.forward) }))
    if (!tabs.length) return null
    return { tabs, active: tabs.some((t) => t.id === raw.active) ? (raw.active as string) : tabs[0].id }
  } catch {
    return null
  }
}

function save(state: TabsState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      tabs: state.tabs.map(({ id, selected, location, back, forward }) => ({ id, selected, location, back, forward })),
      active: state.active,
    }))
  } catch {
    // storage full or blocked: the tabs just won't come back after a relaunch
  }
}

/** Shows `target` in `tab`, the place it leaves pushed onto its Back (named `label`). */
function go(tab: Tab, target: TabTarget, label?: string): Tab {
  const left: TabPlace = { selected: tab.selected, location: tab.location, label: label ?? tab.label }
  return { id: tab.id, ...target, back: [...(tab.back ?? []), left].slice(-HISTORY_KEPT), forward: undefined }
}

/**
 * Opens `target`: its own tab if one shows it already, else a new tab or the
 * active one. `here` opens it in the active tab even if another shows it.
 */
function openIn(state: TabsState, target: TabTarget, newTab: boolean, here?: { label?: string }): TabsState {
  const existing = here ? undefined : state.tabs.find((t) => sameTarget(t.selected, target.selected))
  if (existing) {
    const tab: Tab = { ...existing, chat: target.chat ?? existing.chat, location: target.location ?? existing.location }
    return { tabs: state.tabs.map((t) => (t.id === existing.id ? tab : t)), active: existing.id }
  }
  if (newTab) {
    const tab: Tab = { id: newId(), ...target }
    const at = state.tabs.findIndex((t) => t.id === state.active) + 1
    return { tabs: [...state.tabs.slice(0, at), tab, ...state.tabs.slice(at)], active: tab.id }
  }
  return { ...state, tabs: state.tabs.map((t) => (t.id === state.active ? go(t, target, here?.label) : t)) }
}

export interface TabsApi {
  tabs: Tab[]
  active: Tab
  /** Opens a place in the active tab, or with `newTab` in a new one; switches to its tab if it is open already. */
  open: (target: TabTarget, newTab?: boolean) => void
  /** Opens a place in the active tab, open elsewhere or not; Back returns to the place left, named `label`. */
  openHere: (target: TabTarget, label?: string) => void
  /** The active tab's previous place (-1) or next one (+1), if it has one. */
  go: (delta: -1 | 1) => void
  activate: (id: string) => void
  /** The nth tab (0-based); a number past the end is the last tab. */
  activateIndex: (index: number) => void
  /** The next (+1) or previous (-1) tab, wrapping around. */
  cycle: (delta: number) => void
  /** Closes a tab; closing the last one opens `instead` (default: the fallback page) in its place. */
  close: (id: string, instead?: TabTarget) => void
  /** Closes every tab that matches; opens `fallback` when none is left. */
  closeWhere: (match: (tab: Tab) => boolean) => void
  /** Forgets a deleted conversation, including Back, Forward and recently closed tabs. */
  forgetSession: (sessionId: string) => void
  /** Brings back the most recently closed tab. */
  reopen: () => void
  move: (id: string, toIndex: number) => void
  /** Changes a tab's place in place (the chat page reporting its conversation). */
  update: (id: string, change: (selected: Selection) => Selection) => void
}

/**
 * `fallback` is the place a window with no tabs shows. `start` is a place the
 * launch asked for (CONNECT_VIEW): it opens on top of the restored tabs.
 */
export function useTabs(fallback: () => TabTarget, start?: TabTarget): TabsApi {
  const [state, setState] = useState<TabsState>(() => {
    const saved = load()
    if (saved) return start ? openIn(saved, start, true) : saved
    const tab: Tab = { id: newId(), ...(start ?? fallback()) }
    return { tabs: [tab], active: tab.id }
  })
  const current = useRef(state)
  current.current = state
  const closed = useRef<TabTarget[]>([])
  const fallbackRef = useRef(fallback)
  fallbackRef.current = fallback

  useEffect(() => save(state), [state])

  const remove = useCallback((s: TabsState, ids: Set<string>, instead?: TabTarget): TabsState => {
    const tabs = s.tabs.filter((t) => !ids.has(t.id))
    if (!tabs.length) {
      const tab: Tab = { id: newId(), ...(instead ?? fallbackRef.current()) }
      return { tabs: [tab], active: tab.id }
    }
    if (!ids.has(s.active)) return { ...s, tabs }
    // the active tab went: its right-hand neighbour takes over, else the one on its left
    const at = s.tabs.findIndex((t) => t.id === s.active)
    const next = s.tabs.slice(at + 1).find((t) => !ids.has(t.id)) ?? [...s.tabs.slice(0, at)].reverse().find((t) => !ids.has(t.id))
    return { tabs, active: next?.id ?? tabs[0].id }
  }, [])

  const rememberClosed = (tabs: Tab[]) => {
    for (const { selected, location } of tabs) closed.current.push({ selected, location })
    closed.current = closed.current.slice(-CLOSED_KEPT)
  }

  const open = useCallback((target: TabTarget, newTab = false) => setState((s) => openIn(s, target, newTab)), [])
  const openHere = useCallback((target: TabTarget, label?: string) => setState((s) => openIn(s, target, false, { label })), [])
  const goTo = useCallback((delta: -1 | 1) => setState((s) => {
    const tab = s.tabs.find((t) => t.id === s.active)
    const from = delta < 0 ? tab?.back : tab?.forward
    if (!tab || !from?.length) return s
    const place = from[from.length - 1]
    const left: TabPlace = { selected: tab.selected, location: tab.location, label: tab.label }
    const rest = from.slice(0, -1)
    const next: Tab = {
      id: tab.id,
      selected: place.selected,
      location: place.location,
      label: place.label,
      back: delta < 0 ? rest : [...(tab.back ?? []), left].slice(-HISTORY_KEPT),
      forward: delta < 0 ? [...(tab.forward ?? []), left].slice(-HISTORY_KEPT) : rest,
    }
    return { ...s, tabs: s.tabs.map((t) => (t.id === tab.id ? next : t)) }
  }), [])
  const activate = useCallback((id: string) => setState((s) => (s.active === id || !s.tabs.some((t) => t.id === id) ? s : { ...s, active: id })), [])
  const activateIndex = useCallback((index: number) => setState((s) => {
    const tab = s.tabs[Math.min(index, s.tabs.length - 1)]
    return tab && tab.id !== s.active ? { ...s, active: tab.id } : s
  }), [])
  const cycle = useCallback((delta: number) => setState((s) => {
    if (s.tabs.length < 2) return s
    const at = s.tabs.findIndex((t) => t.id === s.active)
    return { ...s, active: s.tabs[(at + delta + s.tabs.length) % s.tabs.length].id }
  }), [])
  const close = useCallback((id: string, instead?: TabTarget) => {
    const tab = current.current.tabs.find((t) => t.id === id)
    if (!tab) return
    rememberClosed([tab])
    setState((s) => remove(s, new Set([id]), instead))
  }, [remove])
  const closeWhere = useCallback((match: (tab: Tab) => boolean) => {
    const ids = new Set(current.current.tabs.filter(match).map((t) => t.id))
    if (ids.size) setState((s) => remove(s, ids))
  }, [remove])
  const forgetSession = useCallback((sessionId: string) => {
    closed.current = withoutSession(closed.current, sessionId)
    setState((s) => {
      const tabs = withoutSession(s.tabs, sessionId)
      const kept = new Set(tabs.map((tab) => tab.id))
      const ids = new Set(s.tabs.filter((tab) => !kept.has(tab.id)).map((tab) => tab.id))
      const next = remove(s, ids)
      return tabs.length ? { ...next, tabs } : next
    })
  }, [remove])
  const reopen = useCallback(() => {
    const target = closed.current.pop()
    if (target) setState((s) => openIn(s, target, true))
  }, [])
  const move = useCallback((id: string, toIndex: number) => setState((s) => {
    const from = s.tabs.findIndex((t) => t.id === id)
    if (from < 0) return s
    const tabs = [...s.tabs]
    const [tab] = tabs.splice(from, 1)
    tabs.splice(Math.max(0, Math.min(toIndex, tabs.length)), 0, tab)
    return tabs.every((t, i) => t === s.tabs[i]) ? s : { ...s, tabs }
  }), [])
  const update = useCallback((id: string, change: (selected: Selection) => Selection) => setState((s) => {
    const tab = s.tabs.find((t) => t.id === id)
    if (!tab) return s
    const selected = change(tab.selected)
    return selected === tab.selected ? s : { ...s, tabs: s.tabs.map((t) => (t.id === id ? { ...t, selected } : t)) }
  }), [])

  const active = useMemo(() => state.tabs.find((t) => t.id === state.active) ?? state.tabs[0], [state])
  return { tabs: state.tabs, active, open, openHere, go: goTo, activate, activateIndex, cycle, close, closeWhere, forgetSession, reopen, move, update }
}
