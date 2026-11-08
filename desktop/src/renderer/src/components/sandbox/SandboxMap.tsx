import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, ArrowUpRight, Box, Check, ChevronDown, ChevronRight, CircleAlert, GitBranch, GitCommitHorizontal, Layers, Radio, Terminal, Users, X } from 'lucide-react'
import { Empty } from '@/components/layerfs/States'
import { workspaceState, type Actor, type Activity, type Workspace } from './model'
import './sandbox-map.css'

type Selection = { kind: 'agent' | 'branch' | 'workspace' | 'sandbox' | 'event'; id: string }
type Edge = { id: string; from: string; to: string; branch: string; active: boolean; result?: boolean; error?: boolean }
type Path = Edge & { d: string }
const stamp = (time: number) => `0:${Math.floor(time).toString().padStart(2, '0')}`
const node = (kind: string, id: string) => `${kind}-${id}`

export interface SandboxMapData {
  actors: Actor[]
  workspaces: (Workspace & { path?: string })[]
  events: Activity[]
  branches: { name: string; commits?: number }[]
  sandboxes: { name: string; machine?: string | null; backend?: string | null; state: string; refusal?: string; unread?: boolean }[]
  links: Record<string, string>
}
export function SandboxMap({ project, data, time = 0, playing = false, simulation = false, controls, playback, focusActorId, chatActorId, onOpenSandbox }: {
  project: string; data: SandboxMapData; time?: number; playing?: boolean; simulation?: boolean
  controls?: ReactNode; playback?: ReactNode; focusActorId?: string; chatActorId?: string
  onOpenSandbox?: (name: string) => void
}) {
  const [collapsed, setCollapsed] = useState<string[]>([])
  const [recent, setRecent] = useState(false)
  const [onlyChat, setOnlyChat] = useState(false)
  const [selection, setSelection] = useState<Selection | null>(null)
  const [hover, setHover] = useState<Selection | null>(null)
  useEffect(() => { setSelection(focusActorId ? { kind: 'agent', id: focusActorId } : null) }, [focusActorId])
  const graph = useRef<HTMLDivElement>(null)
  const { actors, events, workspaces } = data
  const empty = !data.sandboxes.length && !actors.length && !workspaces.length
  const active = events.filter(e => e.start <= time && time < e.end)
  const completed = events.filter(e => e.end <= time)
  const shownActors = actors.filter(a => !onlyChat || a.id === chatActorId || a.parent === chatActorId)
  const roots = shownActors.filter(a => !a.parent)
  const focus = hover ?? selection
  const selectedEvent = selection?.kind === 'event' ? events.find(e => e.id === selection.id) : undefined
  const related = new Set<string>()
  if (focus) {
    const event = focus.kind === 'event' ? events.find(e => e.id === focus.id) : null
    const actorIds = focus.kind === 'agent' ? [focus.id] : event ? [event.actor] : []
    const wsIds = focus.kind === 'workspace' ? [focus.id] : focus.kind === 'sandbox' ? workspaces.filter(w => w.sandbox === focus.id).map(w => w.id) : event?.workspace ? [event.workspace] : []
    const branchIds = focus.kind === 'branch' ? [focus.id] : event ? [event.branch] : []
    for (const a of actors) if (actorIds.includes(a.id) || wsIds.includes(a.workspace ?? '') || branchIds.includes(a.branch)) {
      related.add(node('agent', a.id)); related.add(node('branch', a.branch))
      if (a.workspace) wsIds.push(a.workspace)
    }
    for (const w of workspaces) if (wsIds.includes(w.id) || branchIds.includes(w.branch)) {
      related.add(node('workspace', w.id)); related.add(node('branch', w.branch)); related.add(node('sandbox', w.sandbox))
    }
    if (event?.sandbox) related.add(node('sandbox', event.sandbox))
  }
  const visibleWorkspace = (id: string) => {
    const w = workspaces.find(w => w.id === id)
    if (!w) return false
    const s = workspaceState(w, events, time)
    return s.mounted || s.mounting || (recent && s.unmounted)
  }
  const edges: Edge[] = []
  for (const a of shownActors) {
    const origin = collapsed.includes(a.parent ?? '') ? a.parent! : a.id
    const calls = active.filter(e => e.actor === a.id)
    const justDone = completed.some(e => e.actor === a.id && time - e.end < 1.5)
    edges.push({ id: `a-${a.id}`, from: node('agent', origin), to: node('branch', a.branch), branch: a.branch, active: calls.length > 0, result: justDone, error: completed.some(e => e.actor === a.id && time - e.end < 1.5 && e.outcome !== 'ok') })
  }
  for (const w of workspaces.filter(w => visibleWorkspace(w.id))) edges.push({ id: `w-${w.id}`, from: node('branch', w.branch), to: node('workspace', w.id), branch: w.branch, active: active.some(e => e.workspace === w.id), result: completed.some(e => e.workspace === w.id && time - e.end < 1.5), error: completed.some(e => e.workspace === w.id && time - e.end < 1.5 && e.outcome !== 'ok') })
  for (const e of active.filter(e => !e.workspace && e.sandbox)) edges.push({ id: e.id, from: node('branch', e.branch), to: node('sandbox', e.sandbox!), branch: e.branch, active: true })
  const geometry = edges.map(e => `${e.id}:${e.from}:${e.to}`).join('|')
  const [paths, setPaths] = useState<Path[]>([])

  useLayoutEffect(() => {
    const el = graph.current
    if (!el) return
    function measure() {
      if (!el) return
      const bounds = el.getBoundingClientRect()
      const nodes = new Map([...el.querySelectorAll<HTMLElement>('[data-flow-node]')].map(n => [n.dataset.flowNode!, n]))
      setPaths(edges.flatMap(edge => {
        const a = nodes.get(edge.from)?.getBoundingClientRect(), b = nodes.get(edge.to)?.getBoundingClientRect()
        if (!a || !b || !a.height || !b.height) return []
        const x1 = a.right - bounds.left, y1 = a.top + a.height / 2 - bounds.top
        const x2 = b.left - bounds.left, y2 = b.top + b.height / 2 - bounds.top
        const bend = Math.max(12, (x2 - x1) * .5)
        return [{ ...edge, d: `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}` }]
      }))
    }
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    el.querySelectorAll<HTMLElement>('[data-flow-node]').forEach(n => observer.observe(n))
    measure()
    return () => observer.disconnect()
    // Activity changes style only; geometry is remeasured when nodes or their sizes change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geometry, collapsed.join('|'), recent, onlyChat, data])

  function choose(kind: Selection['kind'], id: string) { setSelection(s => s?.kind === kind && s.id === id ? null : { kind, id }) }
  const dim = (kind: string, id: string) => focus && !related.has(node(kind, id)) ? 'true' : undefined
  const stateOf = (a: Actor) => {
    const running = active.find(e => e.actor === a.id)
    const last = completed.filter(e => e.actor === a.id).at(-1)
    return running ? running.method === 'workspace.exec' ? 'Executing' : running.method.split('.')[1] === 'commit' ? 'Committing' : 'Calling' : last?.outcome === 'error' ? 'Needs attention' : time >= 32 ? 'Done' : a.id === 'explorer' && time >= 3 ? 'Done' : 'Thinking'
  }
  const actorRow = (a: Actor) => {
    const running = active.find(e => e.actor === a.id)
    const last = completed.filter(e => e.actor === a.id).at(-1)
    const isChild = !!a.parent
    return <button key={a.id} className="sb-agent" data-flow-node={node('agent', a.id)} data-child={isChild || undefined} data-dim={dim('agent', a.id)} data-selected={selection?.kind === 'agent' && selection.id === a.id || undefined} data-active={!!running || undefined} onClick={() => choose('agent', a.id)} onMouseEnter={() => setHover({ kind: 'agent', id: a.id })} onFocus={() => setHover({ kind: 'agent', id: a.id })} onBlur={() => setHover(null)}>
      <span className="sb-agent-top"><span className={`sb-avatar ${a.branch === 'search' ? 'sb-lane-a' : 'sb-lane-b'}`}>{a.name[0]}</span><strong>{a.name}</strong><span className="sb-status" data-warning={stateOf(a) === 'Needs attention' || undefined}><i data-live={!!running || undefined} />{stateOf(a)}</span></span>
      <span className="sb-agent-task">{a.task}</span>
      <span className="sb-agent-call">{running ? <><Terminal size={12} /><span>{running.detail}</span><span>{(time - running.start).toFixed(1)}s</span></> : last ? <>{last.outcome === 'error' ? <CircleAlert size={12} className="sb-error-ink" /> : <Check size={12} />}<span>{last.method}</span><span>{stamp(last.end)}</span></> : <><GitBranch size={12} /><span>{a.branch}</span></>}</span>
    </button>
  }
  const selectedActor = selection?.kind === 'agent' ? actors.find(a => a.id === selection.id) : null
  const selectedWorkspace = selection?.kind === 'workspace' ? workspaces.find(w => w.id === selection.id) : null
  const filteredEvents = events.filter(e => {
    if (e.start > time) return false
    if (!selection || selection.kind === 'event') return true
    if (selection.kind === 'agent') return e.actor === selection.id
    if (selection.kind === 'workspace') return e.workspace === selection.id
    if (selection.kind === 'branch') return e.branch === selection.id
    return e.sandbox === selection.id || workspaces.some(w => w.id === e.workspace && w.sandbox === selection.id)
  })
  const selectedTitle = selectedEvent?.method ?? selectedActor?.name ?? selectedWorkspace?.id ?? (selection?.kind === 'branch' ? `Branch · ${selection.id}` : selection?.kind === 'sandbox' ? `Sandbox · ${selection.id}` : 'Activity')

  return <div className="sandbox-page" data-playing={playing}>
    <header className="sb-header"><div><h1>Sandboxes {simulation && <span className="sb-simulation"><Radio size={11} /> Simulation</span>}</h1><p><Layers size={13} /><span>{project}</span><span className="sb-header-note">Project-wide activity</span></p></div>{controls}</header>
    <div className="sb-toolbar"><div className="sb-facts"><span><Users size={13} />{roots.length} main agents</span><span>{actors.filter(a => a.parent).length} subagents</span><span>{data.sandboxes.length} sandboxes</span></div><div className="sb-filters">{chatActorId && <label><input type="checkbox" checked={onlyChat} onChange={e => setOnlyChat(e.target.checked)} />This chat</label>}{simulation && <label><input type="checkbox" checked={recent} onChange={e => setRecent(e.target.checked)} />Recent resources</label>}</div></div>
    {empty ? <div className="sb-no-resources"><Empty icon={Box} title="No sandbox activity yet">Sandboxes created through the LayerFS SDK or CLI and the agents using them will appear here. </Empty></div> : <div className="sb-flow" ref={graph} onMouseLeave={() => setHover(null)} aria-label="Project agents, branches, and sandbox workspaces">
      <svg className="sb-connections" aria-hidden="true"><g>{paths.map(path => {
        const edge = edges.find(e => e.id === path.id)
        const lit = edge?.active || edge?.result
        const muted = focus && !related.has(path.from) && !related.has(path.to)
        return <g key={path.id} className={path.branch === 'search' ? 'sb-lane-a' : 'sb-lane-b'} data-dim={muted || undefined} data-result={edge?.result || undefined} data-error={edge?.error || undefined}>
          <path d={path.d} className="sb-wire" /><path d={path.d} className="sb-wire-lit" data-lit={lit || undefined} />
          {lit && playing && <circle r="3" className="sb-packet"><animateMotion dur="1.6s" repeatCount="indefinite" path={path.d} keyPoints={edge?.result ? '1;0' : '0;1'} keyTimes="0;1" calcMode="linear" /></circle>}
        </g>
      })}</g></svg>
      <section className="sb-agents"><div className="sb-zone"><Users size={13} /><h2>Agents</h2><span>{shownActors.length}</span></div>
        {!roots.length && <p className="sb-box-empty">Agent activity is not reported by this resource snapshot.</p>}{roots.map(root => <div className="sb-agent-group" key={root.id}>
          <div className="sb-group-heading"><button aria-label={`${collapsed.includes(root.id) ? 'Expand' : 'Collapse'} ${root.task}`} aria-expanded={!collapsed.includes(root.id)} onClick={() => setCollapsed(ids => ids.includes(root.id) ? ids.filter(id => id !== root.id) : [...ids, root.id])}>{collapsed.includes(root.id) ? <ChevronRight size={13} /> : <ChevronDown size={13} />}<span>{root.task}</span></button><span className="sb-group-tag">{root.id === chatActorId ? 'This chat' : simulation ? 'Example' : 'Chat'}</span></div>
          {actorRow(root)}{!collapsed.includes(root.id) && shownActors.filter(a => a.parent === root.id).map(actorRow)}
          {collapsed.includes(root.id) && <span className="sb-folded">{shownActors.filter(a => a.parent === root.id).length} subagents folded</span>}
        </div>)}
      </section>
      <section className="sb-project"><div className="sb-zone"><Layers size={13} /><h2>LayerFS</h2></div><div className="sb-project-hub"><div className="sb-hub-heading"><Layers size={20} /><strong>{project.split('/').at(-1)}</strong><span>Project history</span></div>
        <div className="sb-mainline"><GitBranch size={13} /><span>main</span><span>Published</span></div>
        {data.branches.filter(b => b.name !== 'main').map(b => {
          const branch = b.name
          const commitCount = b.commits == null ? null : b.commits + completed.filter(e => e.branch === branch && e.method === 'workspace.commit' && e.outcome === 'ok').length
          const failed = completed.some(e => e.branch === branch && e.method === 'workspace.commit' && e.outcome === 'error')
          return <button key={branch} className={`sb-branch ${branch === 'search' ? 'sb-lane-a' : 'sb-lane-b'}`} data-flow-node={node('branch', branch)} data-dim={dim('branch', branch)} data-selected={selection?.kind === 'branch' && selection.id === branch || undefined} data-active={active.some(e => e.branch === branch) || undefined} onClick={() => choose('branch', branch)} onMouseEnter={() => setHover({ kind: 'branch', id: branch })} onFocus={() => setHover({ kind: 'branch', id: branch })} onBlur={() => setHover(null)}><span><GitBranch size={14} /><strong>{branch}</strong></span><span className="sb-branch-meta">{commitCount != null ? <><GitCommitHorizontal size={13} />{commitCount} {commitCount === 1 ? 'commit' : 'commits'}</> : 'Branch'}{failed && <CircleAlert size={12} className="sb-error-ink" />}</span></button>
        })}<p className="sb-hub-note">Workspaces can share a branch.</p>
      </div><div className="sb-legend"><span><i />Request</span><span><i className="sb-response" />Result</span><span><i className="sb-error-dot" />Refused</span></div></section>
      <section className="sb-boxes"><div className="sb-zone"><Box size={13} /><h2>Sandboxes</h2><span>{data.sandboxes.length}</span></div>
        {data.sandboxes.map(record => {
          const box = record.name
          const creation = events.find(e => e.method === 'sandbox.create' && e.sandbox === box)
          const closure = completed.find(e => e.method === 'sandbox.close' && e.sandbox === box && e.outcome === 'ok')
          const creating = !!creation && time < creation.end
          if (closure && !recent) return <div className="sb-retired" key={box}><Check size={13} />{box} closed<span>History preserved</span></div>
          const mounted = workspaces.filter(w => w.sandbox === box && workspaceState(w, events, time).mounted).length
          return <div className="sb-box" key={box} data-dim={dim('sandbox', box)}>
            <button className="sb-box-heading" data-flow-node={node('sandbox', box)} onClick={() => {
              choose('sandbox', box); setHover(null); onOpenSandbox?.(box)
            }} title={`Open sandbox ${box} details`} aria-pressed={selection?.kind === 'sandbox' && selection.id === box}><Box size={16} /><strong>{box}</strong><span className="sb-status"><i data-live={creating || undefined} />{simulation ? closure ? 'Closed' : creating ? 'Creating' : 'Running' : record.state}</span></button>
            <div className="sb-box-meta">{record.machine ?? record.backend ?? 'Machine unknown'}<span>{record.refusal || record.unread ? 'Workspaces unknown' : `${mounted} / 16 workspaces`}</span></div>{record.refusal && <p role="alert" className="sb-box-empty">{record.refusal}</p>}
            {workspaces.filter(w => w.sandbox === box && visibleWorkspace(w.id)).map(w => {
              const s = workspaceState(w, events, time)
              const executing = s.active.find(e => e.method === 'workspace.exec')
              const warning = s.last?.outcome === 'error'
              return <button className="sb-workspace" key={w.id} data-flow-node={node('workspace', w.id)} data-dim={dim('workspace', w.id)} data-selected={selection?.kind === 'workspace' && selection.id === w.id || undefined} data-active={s.active.length > 0 || undefined} onClick={() => choose('workspace', w.id)} onMouseEnter={() => setHover({ kind: 'workspace', id: w.id })} onFocus={() => setHover({ kind: 'workspace', id: w.id })} onBlur={() => setHover(null)}>
                <span className="sb-workspace-title"><Layers size={13} /><strong>{w.name}</strong><span className={warning ? 'sb-error-ink' : ''}>{s.mounting ? 'Mounting' : s.unmounted ? 'Unmounted' : warning ? s.last?.result.split(' · ')[0] : executing ? 'Executing' : s.active[0]?.method === 'workspace.unmount' ? 'Unmounting' : s.active.length ? 'Committing' : 'Mounted'}</span></span>
                <span className="sb-workspace-branch"><GitBranch size={12} />{w.branch}<span>{w.users.length > 1 ? `${w.users.length} agents` : actors.find(a => a.id === w.users[0])?.name}</span></span>
                <span className="sb-command"><Terminal size={12} /><span>{executing?.detail ?? (s.active[0]?.detail ?? (s.last?.method === 'workspace.exec' ? s.last.result.split('\n')[0] : s.unmounted ? 'Committed history kept' : s.last?.method === 'workspace.commit' && !warning ? 'Changes committed' : simulation ? 'Ready for commands' : 'Mounted workspace'))}</span>{executing && <span>{(time - executing.start).toFixed(1)}s</span>}</span>
              </button>
            })}
            {!workspaces.some(w => w.sandbox === box && visibleWorkspace(w.id)) && <p className="sb-box-empty">{record.refusal ? 'Workspace status unavailable.' : record.unread ? 'Reading workspace status…' : creating ? 'Starting the workspace daemon…' : 'No mounted workspaces'}</p>}
          </div>
        })}
      </section>
    </div>}
    {playback}
    <section className="sb-inspector" aria-label="Sandbox activity details"><header><h2>{selectedTitle}</h2>{selection ? <button aria-label="Clear selection" onClick={() => { setSelection(null); setHover(null) }}><X size={14} /></button> : <span>Select a node to follow its activity</span>}</header>
      {selectedActor && <div className="sb-detail"><strong>{selectedActor.task}</strong><span>{selectedActor.workspace ? `Workspace · ${selectedActor.workspace}` : 'Branch access through SDK / CLI · No mounted workspace'}</span>{data.links[selectedActor.id] ? <Link to={data.links[selectedActor.id]}>Open conversation <ArrowUpRight size={12} /></Link> : <span>{simulation ? 'Scenario agent · simulated' : 'No linked conversation'}</span>}</div>}
      {selectedWorkspace && <div className="sb-detail"><code>{selectedWorkspace.path ?? `/workspaces/${selectedWorkspace.name}`}</code><span>Branch · {selectedWorkspace.branch}</span><span>Used by {selectedWorkspace.users.length ? selectedWorkspace.users.map(id => actors.find(a => a.id === id)?.name).join(', ') : 'Unknown agents'}</span></div>}
      {selection?.kind === 'branch' && <div className="sb-detail"><span>Independent workspace views share this branch’s committed history.</span></div>}
      {selection?.kind === 'sandbox' && <div className="sb-detail"><span>Project · {project}</span><span>Machine · {data.sandboxes.find(b => b.name === selection.id)?.machine ?? 'Unknown'}</span><span>Lifecycle managed through SDK / CLI</span></div>}
      {selectedEvent ? <div className="sb-event-detail"><div><span className="sb-event-method">{selectedEvent.method}</span><span>{actors.find(a => a.id === selectedEvent.actor)?.name} · {stamp(selectedEvent.start)} → {stamp(selectedEvent.end)}</span></div><code>{selectedEvent.detail}</code><pre className={time < selectedEvent.end ? '' : selectedEvent.outcome === 'error' ? 'sb-error-ink' : ''}>{time < selectedEvent.end ? 'In flight. Command output is available after execution ends.' : selectedEvent.result}</pre></div> : filteredEvents.length ? <div className="sb-event-list">{[...filteredEvents].reverse().map(e => <button key={e.id} onClick={() => choose('event', e.id)}><span className={`sb-event-icon ${e.end <= time && e.outcome === 'error' ? 'sb-error-ink' : ''}`}>{e.end > time ? <Radio size={13} /> : e.outcome === 'error' ? <CircleAlert size={13} /> : <Check size={13} />}</span><time>{stamp(e.start)}</time><strong>{e.method}</strong><span>{e.detail}</span><span className="sb-event-owner">{actors.find(a => a.id === e.actor)?.name}</span><ArrowRight size={12} /></button>)}</div> : <p className="sb-activity-empty">{empty ? simulation ? 'No simulated agents, sandboxes, or workspaces.' : 'No sandbox resources.' : simulation ? 'No calls for this selection yet.' : 'Activity events are not reported by this resource snapshot.'}</p>}
    </section>
    <p className="sb-footnote">{simulation ? 'Simulated SDK / CLI activity. No agents, commands, or LayerFS resources are started.' : 'Current LayerFS resource state. Command activity and agent ownership are shown only when reported.'}</p>
  </div>
}
