import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight } from 'lucide-react'
import { workspaceState } from './model'
import type { SandboxDetailProps, WorkspaceTab } from './types'

export function useSandboxDetailModel({ snapshot: s, time, playing, observedAt: observed, highlightedConversation, initialTab }: SandboxDetailProps) {
  const [tab, setTab] = useState<SandboxDetailProps['initialTab']>(initialTab)
  const currentTab = tab === 'workspaces' ? 'workspaces' : 'overview'
  const [selectedWorkspace, setSelectedWorkspace] = useState<string | null>(null)
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>('details')
  const [eventId, setEventId] = useState<string | null>(null)
  const workspaces = s.workspaces.filter(w => w.sandbox === s.name)
  const events = s.events.filter(e => e.sandbox === s.name || workspaces.some(w => w.id === e.workspace))
  const started = events.filter(e => e.start <= time)
  const active = started.filter(e => time < e.end)
  const completed = started.filter(e => e.end <= time)
  const closed = completed.some(e => e.method === 'sandbox.close' && e.outcome === 'ok')
  const creating = active.some(e => e.method === 'sandbox.create')
  const closing = active.some(e => e.method === 'sandbox.close')
  const state = s.recorded ? s.recorded.state[0].toUpperCase() + s.recorded.state.slice(1) : closed ? 'Closed' : creating ? 'Creating' : closing ? 'Closing' : 'Running'
  const workspacesKnown = s.recorded?.workspacesKnown !== false
  const mounted = workspaces.filter(w => workspaceState(w, events, time).mounted)
  const shownWorkspaces = workspaces.filter(w => !events.some(e => e.method === 'workspace.mount' && e.workspace === w.id && e.start > time))
  const selected = shownWorkspaces.find(w => w.id === selectedWorkspace)
  const selectedState = selected ? workspaceState(selected, events, time) : null
  const commands = selected ? started.filter(e => e.workspace === selected.id && e.method === 'workspace.exec') : []
  const selectedPath = selected?.path ?? `/workspaces/${selected?.name ?? ''}`
  const dirty = (id: string) => {
    if (s.recorded) {
      const w = workspaces.find(w => w.id === id)
      return w?.dirty ? `${w.dirty.inodes} changed inodes · ${w.dirty.entries} changed entries` : 'Change counts unavailable'
    }
    const writes = completed.filter(e => e.workspace === id && (e.id === 'edit' || e.method === 'workspace.commit'))
    const last = writes.at(-1)
    return last?.outcome === 'error' ? 'Conflict markers · pending resolution' : last?.method === 'workspace.exec' ? 'Uncommitted changes' : last?.method === 'workspace.commit' ? 'Clean · changes committed' : 'Clean · no recorded changes'
  }
  const workspaceLabel = (id: string) => {
    const ws = workspaces.find(w => w.id === id)!
    if (s.recorded) return ws.activity ?? 'Mounted'
    const state = workspaceState(ws, events, time)
    return state.mounting ? 'Mounting' : state.unmounted ? 'Unmounted' : state.active.some(e => e.method === 'workspace.unmount') ? 'Unmounting' : state.last?.outcome === 'error' ? state.last.result.split(' · ')[0] : state.active.some(e => e.method === 'workspace.exec') ? 'Executing' : state.active.some(e => e.method === 'workspace.commit') ? 'Committing' : 'Mounted'
  }
  function openTab(next: NonNullable<SandboxDetailProps['initialTab']>) { setTab(next) }
  function openWorkspace(id: string) { setSelectedWorkspace(id); setWorkspaceTab('details'); openTab('workspaces') }
  function actorName(id: string) { return s.actors.find(a => a.id === id)?.name ?? 'Unknown' }
  function actorLink(id: string) { return s.links[id] ? <Link to={s.links[id]}>{actorName(id)}<ArrowUpRight size={11} /></Link> : <span>{actorName(id)} <small>Scenario agent</small></span> }

  return { s, time, playing, observed, highlightedConversation, tab: currentTab, openTab,
    selectedWorkspace, setSelectedWorkspace, workspaceTab, setWorkspaceTab, eventId, setEventId,
    workspaces, events, started, active, completed, closed, creating, closing,
    state, mounted, workspacesKnown, shownWorkspaces, selected, selectedState,
    commands, selectedPath, dirty, workspaceLabel, openWorkspace, actorName, actorLink }
}
