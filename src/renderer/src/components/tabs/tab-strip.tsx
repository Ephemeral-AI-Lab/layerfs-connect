// The tab strip across the top of the window, beside the traffic lights: one
// tab per open place, + for a new one. It is also the window's drag handle.
// Shortcuts: ⌘T new, ⌘W close (sent by the main process, which owns ⌘W),
// ⌘⇧T reopen, ⌘1–8 / ⌘9 a tab / the last, ⌃Tab and ⌘⇧[ ] next and previous.
import { Cpu, MessageSquare, PanelLeftOpen, Plus, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { AgentSessionSummary } from '@shared/agent-api'
import { projectRef } from '@shared/host-api'

import type { NavId } from '@/components/app-sidebar'
import { LfsProject, LfsStore } from '@/components/lfs-icons'
import type { Tab, TabsApi } from '@/components/tabs/use-tabs'
import { useSidebar } from '@/components/ui/sidebar'
import { agentHost } from '@/host/agent-client'
import { onHostEvent } from '@/host/client'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

const isMac = window.connect.platform === 'darwin'
const NAV_LABELS: Record<NavId, string> = { chat: 'Chat', projects: 'All projects', storage: 'Storage', compute: 'Compute' }
const DRAG_TYPE = 'application/x-connect-tab'

/** The chat sessions the open tabs show, by id, kept current from the host's `chat` events. */
function useTabSessions(ids: string[]) {
  const [sessions, setSessions] = useState<Map<string, AgentSessionSummary>>(() => new Map())
  const missing = ids.filter((id) => !sessions.has(id)).join(',')
  useEffect(() => {
    if (!missing) return
    let live = true
    agentHost.sessions().then(
      (all) => live && setSessions((m) => {
        const next = new Map(m)
        for (const s of all) next.set(s.id, s)
        return next
      }),
      () => {},
    )
    return () => { live = false }
  }, [missing])
  useEffect(() => onHostEvent((event) => {
    if (event.type !== 'chat') return
    const { messages: _m, queued: _q, tools: _t, children: _c, approvals: _a, ...summary } = event.session
    setSessions((m) => {
      const old = m.get(summary.id)
      if (old && old.updated > summary.updated) return m
      return new Map(m).set(summary.id, summary)
    })
  }), [])
  return sessions
}

type Status = 'running' | 'error' | undefined

function describe(tab: Tab, sessions: Map<string, AgentSessionSummary>, t: (s: string) => string): { label: string; title: string; icon: React.ReactNode; status: Status } {
  const s = tab.selected
  if (s.kind === 'project') {
    const { name, store } = projectRef(s.id)
    return { label: name, title: store ? `${name} · ${store}` : name, icon: <LfsProject />, status: undefined }
  }
  if (s.id === 'chat') {
    const session = s.session ? sessions.get(s.session) : undefined
    const label = session?.title || (s.session ? t('Chat') : t('New chat'))
    const status: Status = session && (session.state === 'running' || session.execution?.phase === 'children') ? 'running' : session?.state === 'error' ? 'error' : undefined
    return { label, title: label, icon: <MessageSquare />, status }
  }
  const label = t(NAV_LABELS[s.id])
  const icon = s.id === 'storage' ? <LfsStore /> : s.id === 'compute' ? <Cpu /> : <LfsProject />
  return { label, title: label, icon, status: undefined }
}

interface TabStripProps {
  tabs: TabsApi
  /** + and ⌘T. */
  onNewTab: () => void
  /** ⌘W and a tab's ×; closing the last tab closes the window. */
  onClose: (id: string) => void
}

export function TabStrip({ tabs, onNewTab, onClose }: TabStripProps) {
  const { t } = useI18n()
  const sessionIds = useMemo(
    () => tabs.tabs.flatMap((tab) => (tab.selected.kind === 'nav' && tab.selected.session ? [tab.selected.session] : [])),
    [tabs.tabs],
  )
  const sessions = useTabSessions(sessionIds)
  const refs = useRef(new Map<string, HTMLDivElement>())
  const [dropAt, setDropAt] = useState<number | null>(null)
  const sidebar = useSidebar()

  // keep the active tab in view when the strip scrolls
  useEffect(() => {
    refs.current.get(tabs.active.id)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [tabs.active.id])

  // shortcuts; the latest handlers are read through a ref so the listener stays put
  const actions = useRef({ tabs, onNewTab, onClose })
  actions.current = { tabs, onNewTab, onClose }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { tabs, onNewTab } = actions.current
      const mod = isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey
      const key = e.key.toLowerCase()
      let handled = true
      if (e.ctrlKey && key === 'tab') tabs.cycle(e.shiftKey ? -1 : 1)
      else if (!mod || e.altKey) handled = false
      else if (key === 't') e.shiftKey ? tabs.reopen() : onNewTab()
      else if (!e.shiftKey && /^[1-9]$/.test(e.key)) tabs.activateIndex(e.key === '9' ? Number.MAX_SAFE_INTEGER : Number(e.key) - 1)
      else if (e.shiftKey && (e.code === 'BracketLeft' || e.code === 'BracketRight')) tabs.cycle(e.code === 'BracketLeft' ? -1 : 1)
      else handled = false
      if (handled) e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    const offCommand = window.connect.onTabCommand?.((command) => {
      if (command === 'close') actions.current.onClose(actions.current.tabs.active.id)
    })
    return () => {
      window.removeEventListener('keydown', onKey)
      offCommand?.()
    }
  }, [])

  const dropIndex = (e: React.DragEvent, index: number) => {
    const box = e.currentTarget.getBoundingClientRect()
    return e.clientX < box.left + box.width / 2 ? index : index + 1
  }

  return (
    <div className="tab-strip shell-tab-strip app-drag relative z-10 shrink-0" data-platform={isMac ? 'mac' : 'other'} data-sidebar-open={sidebar.open}>
      {!sidebar.open && (
        <button
          type="button"
          onClick={() => sidebar.setOpen(true)}
          aria-label={t('Show sidebar')}
          title={`${t('Show sidebar')} (${isMac ? '⌘B' : 'Ctrl+B'})`}
          className="shell-toolbar-button shell-sidebar-toggle app-no-drag"
        >
          <PanelLeftOpen className="size-4" />
        </button>
      )}
      <div
        role="tablist"
        aria-label={t('Open tabs')}
        className="shell-tab-list no-scrollbar"
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropAt(null) }}
      >
        {tabs.tabs.map((tab, index) => {
          const active = tab.id === tabs.active.id
          const { label, title, icon, status } = describe(tab, sessions, t)
          return (
            <div
              key={tab.id}
              ref={(el) => { if (el) refs.current.set(tab.id, el); else refs.current.delete(tab.id) }}
              draggable
              onDragStart={(e) => { e.dataTransfer.setData(DRAG_TYPE, tab.id); e.dataTransfer.effectAllowed = 'move' }}
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes(DRAG_TYPE)) return
                e.preventDefault()
                setDropAt(dropIndex(e, index))
              }}
              onDrop={(e) => {
                const id = e.dataTransfer.getData(DRAG_TYPE)
                setDropAt(null)
                if (!id) return
                e.preventDefault()
                const to = dropIndex(e, index)
                const from = tabs.tabs.findIndex((x) => x.id === id)
                tabs.move(id, from < to ? to - 1 : to)
              }}
              onDragEnd={() => setDropAt(null)}
              data-active={active}
              className={cn(
                'shell-tab app-no-drag group/tab relative',
                dropAt === index && 'before:absolute before:-left-[3px] before:inset-y-1 before:w-0.5 before:rounded-full before:bg-primary',
                dropAt === index + 1 && index === tabs.tabs.length - 1 && 'after:absolute after:-right-[3px] after:inset-y-1 after:w-0.5 after:rounded-full after:bg-primary',
              )}
            >
              <button
                type="button"
                role="tab"
                aria-selected={active}
                title={title}
                onClick={() => tabs.activate(tab.id)}
                onMouseDown={(e) => { if (e.button === 1) e.preventDefault() }}
                onAuxClick={(e) => { if (e.button === 1) onClose(tab.id) }}
                className="shell-tab-label"
              >
                <span className={cn('relative flex', active ? '[&_svg]:text-(--icon-accent)' : 'opacity-80')}>
                  {icon}
                  {status && (
                    <span
                      aria-label={status === 'running' ? t('Running') : t('Error')}
                      className={cn(
                        'absolute -right-1 -top-1 size-2 rounded-full ring-2 ring-background',
                        status === 'running' ? 'animate-pulse bg-primary' : 'bg-destructive',
                      )}
                    />
                  )}
                </span>
                <span className={cn('min-w-0 flex-1 truncate', active && 'font-medium')}>{label}</span>
              </button>
              <button
                type="button"
                aria-label={t('Close tab {name}', { name: label })}
                title={`${t('Close tab')} (${isMac ? '⌘W' : 'Ctrl+W'})`}
                onClick={() => onClose(tab.id)}
                className={cn(
                  'shell-tab-close focus-visible:opacity-100',
                  active ? 'opacity-100' : 'opacity-0 group-hover/tab:opacity-100',
                )}
              >
                <X className="size-3" />
              </button>
            </div>
          )
        })}
      </div>
      <button
        type="button"
        aria-label={t('New tab')}
        title={`${t('New tab')} (${isMac ? '⌘T' : 'Ctrl+T'})`}
        onClick={onNewTab}
        className="shell-toolbar-button shell-new-tab app-no-drag"
      >
        <Plus className="size-4" />
      </button>
    </div>
  )
}
