import { Minus, Pause, Play, Plus } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { laneColor } from '@/components/projects/history/branch-tree'
import { Button } from '@/components/ui/button'
import { type ForkBranch, type ForkTree, ancestry } from '@/data/forks'
import type { Project } from '@/data/sample'

const LANE = 34
const PAD_LEFT = 44
const PAD_RIGHT = 190
const PAD_Y = 40
const STEPS = [16, 22, 30, 40]
const TICK_MS = 140

interface Lane {
  b: ForkBranch
  y: number
}

const labelText = (b: ForkBranch) => (b.state === 'merged' ? `${b.name} · merged` : b.name)
const labelWidth = (b: ForkBranch) => labelText(b).length * 6.4 + 16

/**
 * main is the spine. Top-level Branches alternate sides and keep their fork
 * subtree on that side. Lanes are shared: a Branch takes the innermost lane
 * that is free over its span (fork point to label end) and lies further out
 * than its parent's lane, so nesting always reads outward from main.
 */
function lanesFor(tree: ForkTree, shown: Set<string>, x: (id?: string) => number, step: number) {
  const top = (tree.branches.get('main')?.children ?? []).filter((n) => shown.has(n))
  const level = new Map<string, number>()
  const used: [number, number][][][] = [[], []]
  const place = (name: string, side: number) => {
    const b = tree.branches.get(name)
    if (!b || !shown.has(name)) return
    const from = x(b.forkedFrom?.id) - 4
    const end = Math.max(b.commits[0] ? x(b.commits[0].id) : 0, from + step * 1.4)
    const to = end + 10 + labelWidth(b) + (b.session ? 16 : 0) + 8
    let k = b.parent && b.parent !== 'main' ? (level.get(b.parent) ?? 0) + 1 : 1
    while ((used[side][k] ?? []).some(([a, z]) => from < z && to > a)) k++
    ;(used[side][k] ??= []).push([from, to])
    level.set(name, k)
    for (const kid of b.children) place(kid, side)
  }
  const sideOf = new Map<string, number>()
  top.forEach((name, i) => {
    const mark = (n: string) => {
      sideOf.set(n, i % 2)
      for (const kid of tree.branches.get(n)?.children ?? []) mark(kid)
    }
    mark(name)
    place(name, i % 2)
  })
  const above = Math.max(used[0].length - 1, 0)
  const below = Math.max(used[1].length - 1, 0)
  const mainY = PAD_Y + above * LANE + 12
  const lanes = new Map<string, Lane>()
  lanes.set('main', { b: tree.branches.get('main')!, y: mainY })
  for (const [name, k] of level) {
    const b = tree.branches.get(name)!
    lanes.set(name, { b, y: sideOf.get(name) === 0 ? mainY - k * LANE : mainY + k * LANE })
  }
  return { lanes, mainY, height: mainY + below * LANE + PAD_Y }
}

interface ForkMapProps {
  project: Project
  tree: ForkTree
  focus: string
  shown: Set<string>
  onOpen: (name: string) => void
  /** Start replaying from the first Layer as soon as it opens. */
  autoplay?: boolean
}

/** History over time: main's Layers along a spine, each fork leaving its parent where it forked. */
export function ForkMap({ project, tree, focus, shown, onOpen, autoplay }: ForkMapProps) {
  // Every Layer and Commit, oldest first; x is the event's place in that order.
  const events = useMemo(
    () =>
      [...tree.layers.map((l) => ({ id: l.id, minutes: l.minutes })), ...[...tree.commits.values()].map((c) => ({ id: c.id, minutes: c.minutes }))].sort(
        (a, b) => b.minutes - a.minutes,
      ),
    [tree],
  )
  const order = useMemo(() => new Map(events.map((e, i) => [e.id, i])), [events])
  const lit = useMemo(() => new Set(ancestry(tree, focus).map((b) => b.name)), [tree, focus])

  const [zoom, setZoom] = useState(1)
  const step = STEPS[zoom]
  const last = events.length - 1
  const [cut, setCut] = useState(autoplay ? 0 : last)
  const [playing, setPlaying] = useState(Boolean(autoplay))
  const box = useRef<HTMLDivElement>(null)

  const x = (id: string | undefined) => PAD_LEFT + (order.get(id ?? '') ?? 0) * step
  // Lanes come from the full history, so replaying never moves a Branch.
  // biome-ignore lint/correctness/useExhaustiveDependencies: x depends only on order and step
  const { lanes, mainY, height } = useMemo(() => lanesFor(tree, shown, x, step), [tree, shown, order, step])
  const seen = (id: string | undefined) => (order.get(id ?? '') ?? Infinity) <= cut
  const nowX = PAD_LEFT + cut * step + step
  const width = PAD_LEFT + events.length * step + PAD_RIGHT

  useEffect(() => {
    if (!playing) return
    const timer = setInterval(() => setCut((c) => Math.min(c + 1, last)), TICK_MS)
    return () => clearInterval(timer)
  }, [playing, last])
  if (playing && cut >= last) setPlaying(false)

  // Keep "now" in view: at the right edge when idle, following it while replaying.
  useEffect(() => {
    const el = box.current
    if (el) el.scrollLeft = Math.max(0, nowX - el.clientWidth + PAD_RIGHT)
  }, [nowX])
  // Start with main in the middle vertically.
  useEffect(() => {
    const el = box.current
    if (el) el.scrollTop = Math.max(0, mainY - el.clientHeight / 2)
  }, [mainY])

  const visibleLayers = tree.layers.filter((l) => seen(l.id))
  const head = visibleLayers[0]
  const commitsSoFar = [...tree.commits.values()].filter((c) => seen(c.id)).length
  const forkPoints = new Set([...tree.branches.values()].map((b) => b.forkedFrom?.id))

  // Each visible Branch's geometry, shared by the lane and label passes.
  const drawn = [...lanes.values()].flatMap(({ b, y }) => {
    if (b.name === 'main' || !seen(b.forkedFrom?.id)) return []
    const parentY = lanes.get(b.parent ?? 'main')?.y
    if (parentY === undefined) return []
    const fx = x(b.forkedFrom?.id)
    const own = [...b.commits].reverse().filter((c) => seen(c.id))
    const bend = step * 1.4
    const endX = Math.max(own.length > 0 ? x(own[own.length - 1].id) : 0, fx + bend)
    const session = b.session ? project.sessions.find((s) => s.id === b.session) : undefined
    return [{ b, y, parentY, color: laneColor(b.depth), fx, own, endX, bend, on: lit.has(b.name), quiet: b.state === 'merged', session }]
  })

  const play = () => {
    if (playing) return setPlaying(false)
    if (cut >= last) setCut(0)
    setPlaying(true)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-3 border-b px-4 py-2">
        <span className="font-mono text-xs">
          main @ {head?.id ?? '—'}
          <span className="text-muted-foreground">
            {' '}
            · {commitsSoFar} Commit{commitsSoFar === 1 ? '' : 's'}
            {cut < last ? ' · replay' : ''}
          </span>
        </span>
        <span className="ml-auto text-xs text-faint">Click a Branch to open its lineage</span>
        <Button variant="outline" size="sm" onClick={play}>
          {playing ? <Pause /> : <Play />} {playing ? 'Pause' : cut < last ? 'Resume' : 'Replay'}
        </Button>
        <div className="flex items-center rounded-lg border">
          <Button variant="ghost" size="icon-sm" aria-label="Zoom out" disabled={zoom === 0} onClick={() => setZoom((z) => z - 1)}>
            <Minus />
          </Button>
          <span className="w-10 text-center text-xs tabular-nums text-muted-foreground">{Math.round((step / STEPS[1]) * 100)}%</span>
          <Button variant="ghost" size="icon-sm" aria-label="Zoom in" disabled={zoom === STEPS.length - 1} onClick={() => setZoom((z) => z + 1)}>
            <Plus />
          </Button>
        </div>
      </div>

      <div ref={box} className="relative min-h-0 flex-1 overflow-auto">
        <svg width={width} height={height} role="img" aria-label={`Fork timeline of ${project.key}`} className="block">
          {/* Layer guides */}
          {visibleLayers.map((l) => (
            <line key={`g-${l.id}`} x1={x(l.id)} x2={x(l.id)} y1={PAD_Y / 2} y2={height - PAD_Y / 2} stroke="var(--border)" strokeWidth={1} opacity={0.5} />
          ))}
          {/* now */}
          <line x1={nowX} x2={nowX} y1={14} y2={height - 10} stroke="var(--faint)" strokeDasharray="3 4" />
          <text x={nowX} y={11} textAnchor="middle" className="fill-muted-foreground font-mono text-[10px]">
            now
          </text>

          {/* Branch lanes, drawn before main so the spine sits on top */}
          {drawn.map(({ b, y, parentY, color, fx, own, endX, bend, on, quiet, session }) => (
            <g key={b.name} opacity={quiet ? 0.5 : 1}>
              <path
                d={`M${fx} ${parentY} C${fx + bend * 0.55} ${parentY} ${fx + bend * 0.45} ${y} ${fx + bend} ${y} L${endX} ${y}`}
                fill="none"
                stroke={color}
                strokeWidth={on ? 3 : 2}
                strokeDasharray={own.length === 0 ? '3 3' : undefined}
              />
              {b.publishedAs && seen(b.publishedAs) && (
                <path
                  d={`M${endX} ${y} C${endX + step} ${y} ${x(b.publishedAs) - step} ${mainY} ${x(b.publishedAs)} ${mainY}`}
                  fill="none"
                  stroke={color}
                  strokeWidth={1.5}
                  opacity={0.7}
                />
              )}
              {own.map((c) =>
                forkPoints.has(c.id) ? (
                  <circle key={c.id} cx={x(c.id)} cy={y} r={4.5} fill="var(--card)" stroke={color} strokeWidth={2}>
                    <title>{`${c.id} · ${c.message} · ${c.ago}`}</title>
                  </circle>
                ) : (
                  <circle key={c.id} cx={x(c.id)} cy={y} r={3.5} fill={color}>
                    <title>{`${c.id} · ${c.message} · ${c.ago}`}</title>
                  </circle>
                ),
              )}
              {session?.busy && cut >= last && (
                <circle cx={endX} cy={y} r={6} fill="none" stroke={`var(--agent-${session.agent})`} strokeWidth={2}>
                  <animate attributeName="r" values="5;10;5" dur="1.6s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="1;0.2;1" dur="1.6s" repeatCount="indefinite" />
                </circle>
              )}
            </g>
          ))}

          {/* main: solid through its newest Layer, dotted on to now */}
          {head && (
            <>
              <line x1={PAD_LEFT - 20} x2={x(head.id)} y1={mainY} y2={mainY} stroke="var(--primary)" strokeWidth={5} strokeLinecap="round" />
              <line x1={x(head.id)} x2={nowX} y1={mainY} y2={mainY} stroke="var(--primary)" strokeWidth={2} strokeDasharray="2 5" />
            </>
          )}
          {visibleLayers.map((l) => (
            <g key={l.id}>
              <rect x={x(l.id) - 3} y={mainY - 7} width={6} height={14} rx={1.5} fill={l.from ? laneColor(tree.branches.get(l.from)?.depth ?? 1) : 'var(--primary)'} stroke="var(--card)" strokeWidth={1}>
                <title>{`${l.id} · ${l.message} · ${l.ago}`}</title>
              </rect>
              <text x={x(l.id) + 5} y={mainY - 10} className="fill-muted-foreground font-mono text-[10px]">
                {l.id}
              </text>
            </g>
          ))}
          {/* Labels last, so no lane draws over them */}
          {drawn.map(({ b, y, color, endX, on, quiet, session }) => {
            const w = labelWidth(b)
            const focused = b.name === focus
            return (
              <g
                key={`label-${b.name}`}
                role="button"
                tabIndex={0}
                aria-label={`Open ${b.name}`}
                onClick={() => onOpen(b.name)}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onOpen(b.name)}
                className="cursor-pointer outline-none"
                opacity={quiet ? 0.6 : 1}
                transform={`translate(${endX + 10} ${y - 10})`}
              >
                <rect width={w} height={20} rx={5} fill={focused ? color : 'var(--card)'} stroke={color} strokeWidth={on ? 1.5 : 1} />
                <text x={8} y={14} className="font-mono text-[11px]" fill={focused ? 'var(--card)' : color}>
                  {labelText(b)}
                </text>
                {session && (
                  <circle cx={w + 9} cy={10} r={3.5} fill={session.busy ? `var(--agent-${session.agent})` : 'var(--idle)'}>
                    <title>{session.title}</title>
                  </circle>
                )}
              </g>
            )
          })}
          <g role="button" tabIndex={0} aria-label="Open main" onClick={() => onOpen('main')} onKeyDown={(e) => e.key === 'Enter' && onOpen('main')} className="cursor-pointer outline-none" transform={`translate(${nowX + 10} ${mainY - 11})`}>
            <rect width={44} height={22} rx={5} fill="var(--primary)" />
            <text x={22} y={15} textAnchor="middle" className="font-mono text-[11px] font-semibold" fill="var(--primary-foreground)">
              main
            </text>
          </g>
        </svg>
      </div>
    </div>
  )
}
