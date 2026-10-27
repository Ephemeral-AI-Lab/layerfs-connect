import { FolderOpen } from 'lucide-react'
import { useLayoutEffect, useRef, useState } from 'react'

import { TargetIcon } from '@/components/compute/target-parts'
import { LayerfsMark } from '@/components/layerfs-mark'
import { DatabaseIcon } from '@/components/storage/icons'
import type { FlowState } from '@/components/projects/use-workflow'
import { type FlowCompute, type Live, PHASE_LABEL } from '@/data/flow'
import type { Agent, Project, Session } from '@/data/sample'
import { type Database, databaseName } from '@/data/storage'
import { cn } from '@/lib/utils'

// Literal class names, so Tailwind sees them.
const TINT: Record<Agent, string> = {
  builder: 'bg-agent-builder/10 text-agent-builder',
  reviewer: 'bg-agent-reviewer/10 text-agent-reviewer',
  tester: 'bg-agent-tester/10 text-agent-tester',
  docs: 'bg-agent-docs/10 text-agent-docs',
}
const DOT: Record<Agent, string> = {
  builder: 'bg-agent-builder',
  reviewer: 'bg-agent-reviewer',
  tester: 'bg-agent-tester',
  docs: 'bg-agent-docs',
}

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

function SessionNode({
  session,
  live,
  current,
  onOpen,
}: {
  session: Session
  live: Live
  current: boolean
  onOpen: () => void
}) {
  const active = live.phase !== 'idle'
  return (
    <button
      type="button"
      data-anchor={`session-${session.id}`}
      onClick={onOpen}
      className={cn(
        'relative flex w-full flex-col items-center gap-1.5 rounded-xl border bg-card px-3 pt-3 pb-3.5 text-center outline-none transition-[border-color,box-shadow] focus-visible:ring-2 focus-visible:ring-ring',
        current ? 'border-primary ring-2 ring-primary/25' : active ? 'border-foreground/25 shadow-sm' : 'opacity-80 hover:opacity-100',
      )}
    >
      {current && (
        <span className="absolute -top-2.5 rounded-full bg-primary px-2 py-px text-[11px] font-medium text-primary-foreground">
          This session
        </span>
      )}
      <span className={cn('flex size-8 items-center justify-center rounded-lg font-serif text-lg leading-none', TINT[session.agent])}>
        π
      </span>
      <span className="flex items-center gap-1.5 text-sm font-medium">
        <span aria-hidden="true" className={cn('size-2 rounded-full', active ? DOT[session.agent] : 'bg-idle')} />
        {session.title}
      </span>
      <span className="text-xs leading-snug text-muted-foreground">
        pi · {session.agent} · {PHASE_LABEL[live.phase]}
        {live.workspace && (
          <>
            {' · '}
            <span className="font-mono whitespace-nowrap">{live.workspace}</span>
          </>
        )}
      </span>
    </button>
  )
}

function HubNode({ project, db, state }: { project: Project; db?: Database; state: FlowState }) {
  const flashing = state.lastCommit !== undefined && state.t - state.lastCommit.at < 1400
  const live = db?.kind === 'postgres'
  return (
    <div
      data-anchor="hub"
      className={cn(
        'relative flex flex-col items-center gap-2.5 rounded-2xl border-2 bg-card px-5 pt-5 pb-4 text-center transition-shadow duration-500',
        flashing ? 'border-primary shadow-[0_0_0_6px] shadow-primary/15' : 'border-foreground/15',
      )}
    >
      <LayerfsMark className="size-14" />
      <span className="text-lg font-semibold">{project.key}</span>
      {db && (
        <span className="inline-flex max-w-full items-center gap-2 rounded-lg border bg-background px-2 py-1 text-[13px]">
          <span className="[&>span]:size-5 [&>span]:rounded [&_svg]:size-3">
            <DatabaseIcon db={db} size="sm" />
          </span>
          <span className="truncate">{db.kind === 'postgres' ? (db.label ?? databaseName(db)) : databaseName(db)}</span>
        </span>
      )}
      <span
        className={cn(
          'rounded-full px-3 py-1 text-xs font-medium',
          live ? 'bg-foreground text-background' : 'bg-muted text-foreground',
        )}
      >
        {live ? 'Live database' : 'Local SQLite'}
      </span>
      <span className="font-mono text-xs text-muted-foreground">
        head{' '}
        <span key={state.head} className={cn('text-foreground', flashing && 'animate-in fade-in zoom-in-150 duration-500')}>
          c{state.head}
        </span>
      </span>
    </div>
  )
}

function ComputeNode({
  compute,
  mounted,
  sessions,
}: {
  compute: FlowCompute
  mounted: [string, Live][]
  sessions: Map<string, Session>
}) {
  return (
    <div
      data-anchor={`compute-${compute.id}`}
      className={cn('overflow-hidden rounded-xl border bg-card', mounted.length > 0 && 'border-foreground/25 shadow-sm')}
    >
      <div className="flex items-center gap-2.5 px-3.5 py-2.5">
        <span className="[&>span]:size-6 [&>span]:rounded-md [&>span]:text-[9px] [&_svg]:size-3.5">
          <TargetIcon id={compute.kind === 'docker' && compute.os === 'darwin' ? 'docker' : 'native'} os={compute.os} size="sm" />
        </span>
        <span className="shrink-0 text-sm font-medium whitespace-nowrap">{compute.label}</span>
        <span className="truncate font-mono text-xs text-faint">{compute.container ?? 'native'}</span>
        <span className="ml-auto shrink-0 text-xs text-faint">{mounted.length} mounted</span>
      </div>
      {mounted.length === 0 ? (
        <div className="flex items-center gap-2.5 border-t bg-muted/30 px-3.5 py-2.5 text-xs text-faint italic">
          <FolderOpen aria-hidden="true" className="size-3.5 shrink-0 not-italic" />
          Nothing mounted. The next call mounts a new Workspace here.
        </div>
      ) : (
        mounted.map(([id, live]) => {
          const session = sessions.get(id)
          if (!session) return null
          return (
            <div
              key={live.workspace}
              data-anchor={`ws-${live.workspace}`}
              className="flex items-center gap-2.5 border-t bg-muted/30 px-3.5 py-2.5 text-xs animate-in fade-in slide-in-from-left-2 duration-300"
            >
              <FolderOpen aria-hidden="true" className="size-3.5 shrink-0 text-faint" />
              <span className="font-mono">{live.workspace}</span>
              <span className="ml-auto flex items-center gap-1.5">
                <span aria-hidden="true" className={cn('size-2 rounded-full', DOT[session.agent])} />
                {session.agent}
              </span>
              <span className="text-accent-foreground dark:text-primary">
                {live.phase === 'exec' ? 'exec' : live.phase === 'commit' ? 'commit' : 'mounting'}
              </span>
              <span className="w-24 truncate text-right text-muted-foreground">
                {live.phase === 'exec' ? live.command : live.phase === 'commit' ? 'to the head' : `from c${live.from}`}
              </span>
            </div>
          )
        })
      )}
    </div>
  )
}

interface Edge {
  id: string
  d: string
  agent?: Agent
  /** Commits travel back toward the database. */
  back?: boolean
}

function curve(a: { x: number; y: number }, b: { x: number; y: number }) {
  const dx = (b.x - a.x) / 2
  return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`
}

interface FlowGraphProps {
  project: Project
  db?: Database
  computes: FlowCompute[]
  state: FlowState
  currentSession?: string
  onOpenSession: (id: string) => void
}

/** Sessions, the project and its database, and the computes, with live edges between them. */
export function FlowGraph({ project, db, computes, state, currentSession, onOpenSession }: FlowGraphProps) {
  const box = useRef<HTMLDivElement>(null)
  const [edges, setEdges] = useState<Edge[]>([])
  const sessions = new Map(project.sessions.map((s) => [s.id, s]))
  const live = Object.entries(state.sessions)
  const mountedOn = (computeId: string) => live.filter(([, l]) => l.phase !== 'idle' && l.compute === computeId)

  // Edges follow the cards, so they are measured after layout.
  const shape = live.map(([id, l]) => `${id}:${l.phase}:${l.compute}:${l.workspace}`).join('|')
  useLayoutEffect(() => {
    const root = box.current
    if (!root) return
    const measure = () => {
      const origin = root.getBoundingClientRect()
      const at = (anchor: string, side: 'left' | 'right') => {
        const el = root.querySelector(`[data-anchor="${anchor}"]`)
        if (!el) return undefined
        const r = el.getBoundingClientRect()
        return { x: (side === 'right' ? r.right : r.left) - origin.left, y: r.top + r.height / 2 - origin.top }
      }
      const hubIn = at('hub', 'left')
      const hubOut = at('hub', 'right')
      if (!hubIn || !hubOut) return
      const next: Edge[] = []
      for (const s of project.sessions) {
        const from = at(`session-${s.id}`, 'right')
        const l = state.sessions[s.id]
        if (from) next.push({ id: `s-${s.id}`, d: curve(from, hubIn), agent: l && l.phase !== 'idle' ? s.agent : undefined, back: l?.phase === 'commit' })
      }
      for (const c of computes) {
        const busy = live.filter(([, l]) => l.phase !== 'idle' && l.compute === c.id)
        if (busy.length === 0) {
          const to = at(`compute-${c.id}`, 'left')
          if (to) next.push({ id: `c-${c.id}`, d: curve(hubOut, to) })
        }
        for (const [id, l] of busy) {
          const to = at(`ws-${l.workspace}`, 'left')
          const s = sessions.get(id)
          if (to && s) next.push({ id: `w-${l.workspace}`, d: curve(hubOut, to), agent: s.agent, back: l.phase === 'commit' })
        }
      }
      setEdges(next)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(root)
    return () => observer.disconnect()
    // `shape` stands in for the parts of state that move cards.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shape, project.key, computes])

  const motion = !reducedMotion()

  return (
    <div ref={box} className="relative grid grid-cols-[12.5rem_minmax(4rem,1fr)_12rem_minmax(4rem,1fr)_minmax(21rem,25rem)] items-center">
      <svg aria-hidden="true" className="pointer-events-none absolute inset-0 size-full overflow-visible">
        {edges
          .filter((e) => !e.agent)
          .map((e) => (
            <path key={e.id} d={e.d} fill="none" className="stroke-border" strokeWidth={1.5} />
          ))}
        {edges
          .filter((e) => e.agent)
          .map((e) => (
            <g key={e.id} style={{ color: `var(--agent-${e.agent})` }}>
              <path d={e.d} fill="none" stroke="currentColor" strokeWidth={1.75} className="flow-dash" />
              {motion && (
                <circle r={3.5} fill="currentColor">
                  <animateMotion
                    dur="1.6s"
                    repeatCount="indefinite"
                    path={e.d}
                    keyPoints={e.back ? '1;0' : '0;1'}
                    keyTimes="0;1"
                    calcMode="linear"
                  />
                </circle>
              )}
            </g>
          ))}
      </svg>

      <div className="relative z-10 flex flex-col gap-4">
        {project.sessions.map((s) => (
          <SessionNode
            key={s.id}
            session={s}
            live={state.sessions[s.id] ?? { phase: 'idle', until: 0, next: 0 }}
            current={s.id === currentSession}
            onOpen={() => onOpenSession(s.id)}
          />
        ))}
      </div>
      <span />
      <div className="relative z-10">
        <HubNode project={project} db={db} state={state} />
      </div>
      <span />
      <div className="relative z-10 flex flex-col gap-4">
        {computes.map((c) => (
          <ComputeNode key={c.id} compute={c} mounted={mountedOn(c.id)} sessions={sessions} />
        ))}
      </div>
    </div>
  )
}
