import { t, useI18n } from '@/i18n'
import './history.css'

import { LocateFixed, Minus, Pause, Play, Plus, SkipForward } from 'lucide-react'
import { type CSSProperties, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { laneColor } from '@/components/projects/history/branch-tree'
import { Button } from '@/components/ui/button'
import { type ForkBranch, type ForkTree, ancestry } from '@/data/forks'
import { agentColor, shortId, when } from '@/data/format'
import { cn } from '@/lib/utils'

const PAD_LEFT = 44
const PAD_RIGHT = 200
const PAD_Y = 44
/** Lane spacing: at least this, more when the canvas is tall, up to the max. */
const LANE_MIN = 36
const LANE_MAX = 64
/** Zoom stops, as px per event; 22 is 100%. */
const STEPS = [12, 16, 22, 30, 40, 52]
const BASE = 22
/** Fitting never zooms past 2.5x, so a tiny history keeps its proportions. */
const FIT_MAX = 55
const TICK_MS = 140

interface Lane {
  b: ForkBranch
  y: number
}

const labelText = (b: ForkBranch) => b.name.length > 26 ? `${b.name.slice(0, 25)}…` : b.name
const labelWidth = (b: ForkBranch) => [...labelText(b)].reduce((width, char) => width + (/[\u2e80-\u9fff]/.test(char) ? 12 : 7.25), 18)
/** A CSS translate, so moves glide (an SVG transform attribute would jump). */
const at = (x: number, y: number): CSSProperties => ({ transform: `translate(${x}px, ${y}px)` })

/**
 * main is the spine. Top-level Branches alternate sides and keep their fork
 * subtree on that side. Lanes are shared: a Branch takes the innermost lane
 * that is free over its span (fork point to label end) and lies further out
 * than its parent's lane, so nesting always reads outward from main.
 */
function packLanes(tree: ForkTree, shown: Set<string>, x: (id?: string) => number, step: number) {
  const top = (tree.branches.get('main')?.children ?? []).filter((n) => shown.has(n))
  const level = new Map<string, number>()
  const used: [number, number][][][] = [[], []]
  const place = (name: string, side: number) => {
    const b = tree.branches.get(name)
    if (!b || !shown.has(name)) return
    const from = x(b.forkedFrom?.id) - 4
    const end = Math.max(b.commits[0] ? x(b.commits[0].id) : 0, from + step * 1.4)
    const to = end + 10 + labelWidth(b) + (b.agent ? 16 : 0) + 8
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
  return { level, sideOf, above: Math.max(used[0].length - 1, 0), below: Math.max(used[1].length - 1, 0) }
}

/** Each Branch's y, `gap` apart, main between the two sides. */
function placeLanes(tree: ForkTree, packed: ReturnType<typeof packLanes>, gap: number) {
  const { level, sideOf, above, below } = packed
  const mainY = PAD_Y + above * gap + 12
  const lanes = new Map<string, Lane>()
  lanes.set('main', { b: tree.branches.get('main')!, y: mainY })
  for (const [name, k] of level) {
    const b = tree.branches.get(name)!
    lanes.set(name, { b, y: sideOf.get(name) === 0 ? mainY - k * gap : mainY + k * gap })
  }
  return { lanes, mainY, height: mainY + below * gap + PAD_Y }
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

interface ForkMapProps {
  /** Names the drawing for screen readers. */
  title: string
  tree: ForkTree
  focus: string
  shown: Set<string>
  /** User search/filter changes recenter the view; incoming data does not. */
  filterKey: string
  onOpen: (name: string) => void
}

/** History over time: main's Layers along a spine, each fork leaving its parent where it forked. */
export function ForkMap({ title, tree, focus, shown, filterKey, onOpen }: ForkMapProps) {
  const { locale } = useI18n()
  // Every Layer and Commit, oldest first by LayerFS's times; x is the event's
  // place in that order, so bursts and quiet stretches take the same room.
  const events = useMemo(
    () =>
      [
        ...[...tree.layers].reverse().map((l) => ({ id: l.id, at: l.at })),
        ...[...tree.commits.values()].map((c) => ({ id: c.id, at: c.at })).sort((a, b) => a.at - b.at),
      ].sort((a, b) => a.at - b.at),
    [tree],
  )
  const order = useMemo(() => new Map(events.map((e, i) => [e.id, i])), [events])
  const lit = useMemo(() => new Set(ancestry(tree, focus).map((b) => b.name)), [tree, focus])

  // The canvas size, so the Map can fit it; nothing draws until it is known.
  const box = useRef<HTMLDivElement>(null)
  const [canvas, setCanvas] = useState({ w: 0, h: 0 })
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const measure = () => {
      const next = { w: Math.round(el.clientWidth), h: Math.round(el.clientHeight) }
      setCanvas((c) => (Math.abs(c.w - next.w) < 2 && Math.abs(c.h - next.h) < 2 ? c : next))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // null fits the width (with margins, at most 2x); a number is a zoom stop picked by hand.
  const [zoom, setZoom] = useState<number | null>(null)
  const [positionRevision, setPositionRevision] = useState(0)
  const positioned = useRef('')
  const changeZoom = (value: number | null) => {
    setZoom(value)
    setPositionRevision((n) => n + 1)
  }
  const fitStep = canvas.w > 0 ? clamp((canvas.w - PAD_LEFT - PAD_RIGHT - 16) / Math.max(events.length, 1), STEPS[0], FIT_MAX) : BASE
  const step = zoom ?? fitStep
  const zoomOut = [...STEPS].reverse().find((s) => s < step - 0.5)
  const zoomIn = STEPS.find((s) => s > step + 0.5)
  const last = events.length - 1
  // null follows the end, so Commits read later show at once; a number is a replay's place
  const [cutState, setCut] = useState<number | null>(null)
  const cut = cutState === null ? last : Math.min(cutState, last)
  const [playing, setPlaying] = useState(false)

  const x = (id: string | undefined) => PAD_LEFT + (order.get(id ?? '') ?? 0) * step
  // Lanes come from the full history, so replaying never moves a Branch.
  // biome-ignore lint/correctness/useExhaustiveDependencies: x depends only on order and step
  const packed = useMemo(() => packLanes(tree, shown, x, step), [tree, shown, order, step, locale])
  // Lanes spread out to use a tall canvas, centring main.
  const rows = packed.above + packed.below
  const gap = rows > 0 && canvas.h > 0 ? clamp((canvas.h - PAD_Y * 2 - 24) / rows, LANE_MIN, LANE_MAX) : LANE_MIN
  const { lanes, mainY, height } = useMemo(() => placeLanes(tree, packed, gap), [tree, packed, gap])
  const seen = (id: string | undefined) => (order.get(id ?? '') ?? Infinity) <= cut
  const nowX = PAD_LEFT + cut * step + step
  const width = PAD_LEFT + events.length * step + PAD_RIGHT

  useEffect(() => {
    if (!playing) return
    const timer = setInterval(() => setCut((c) => (c === null || c + 1 >= last ? null : c + 1)), TICK_MS)
    return () => clearInterval(timer)
  }, [playing, last])
  useEffect(() => {
    if (playing && cut >= last) setPlaying(false)
  }, [playing, cut, last])

  // Position once on opening or explicit navigation. Incoming events never
  // pull the viewport away from the branch the user is inspecting.
  useLayoutEffect(() => {
    const el = box.current
    const key = JSON.stringify([focus, filterKey, positionRevision])
    if (!el || canvas.w === 0 || canvas.h === 0 || positioned.current === key) return
    const lane = lanes.get(focus) ?? lanes.get('main')!
    const headId = lane.b.commits[0]?.id ?? (lane.b.name === 'main' ? tree.layers[0]?.id : lane.b.forkedFrom?.id)
    const targetX = headId ? x(headId) : lane.b.name === 'main' ? nowX : x(undefined)
    el.scrollLeft = Math.max(0, targetX - canvas.w / 2)
    el.scrollTop = Math.max(0, lane.y - canvas.h / 2)
    positioned.current = key
  })

  const visibleLayers = tree.layers.filter((l) => seen(l.id))
  const head = visibleLayers[0]
  const commitsSoFar = [...tree.commits.values()].filter((c) => seen(c.id)).length
  const forkPoints = new Set([...tree.branches.values()].map((b) => b.forkedFrom?.id))

  // Each visible Branch's geometry, shared by the lane and label passes.
  const started = (b: ForkBranch) => b.forkedFrom && order.has(b.forkedFrom.id)
    ? seen(b.forkedFrom.id)
    : b.commits.length ? seen(b.commits[b.commits.length - 1].id) : cut >= last
  const drawn = [...lanes.values()].flatMap(({ b, y }) => {
    if (b.name === 'main' || !started(b)) return []
    const parentY = lanes.get(b.parent ?? 'main')?.y
    if (parentY === undefined) return []
    const fx = x(b.forkedFrom?.id)
    const own = [...b.commits].reverse().filter((c) => seen(c.id))
    const bend = step * 1.4
    const endX = Math.max(own.length > 0 ? x(own[own.length - 1].id) : 0, fx + bend)
    return [{ b, y, parentY, color: laneColor(b.depth), fx, own, endX, bend, on: lit.has(b.name), quiet: b.state === 'merged' }]
  })
  // Merge Commits: a thin curve from the merged-in Commit to the merge.
  const merges = [...tree.commits.values()].flatMap((c) => {
    const src = c.merged ? tree.commits.get(c.merged) : undefined
    const to = lanes.get(c.branch)
    const from = src ? lanes.get(src.branch) : undefined
    if (!src || !to || !from || !seen(c.id) || !seen(src.id)) return []
    if (to.b.name !== 'main' && !started(to.b)) return []
    return [{ id: c.id, x1: x(src.id), y1: from.y, x2: x(c.id), y2: to.y, color: laneColor(from.b.depth) }]
  })

  const play = () => {
    if (playing) return setPlaying(false)
    if (cut >= last) setCut(0)
    setPlaying(true)
  }

  const replaying = playing || cut < last

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="hist-pane-head relative flex flex-wrap items-center gap-2 px-3 py-2">
        <span className="mr-auto flex items-center gap-2 text-xs tabular-nums">
          <span className="font-medium">{t("Timeline")}</span>
          <span className="text-muted-foreground">{commitsSoFar} {t(commitsSoFar === 1 ? "Commit" : "Commits")}</span>
        </span>
        <Button variant="ghost" size="icon-sm" aria-label={t("Locate selected branch")} title={t("Locate selected branch")} onClick={() => setPositionRevision((n) => n + 1)}>
          <LocateFixed />
        </Button>
        <Button variant={replaying ? 'secondary' : 'ghost'} size="sm" disabled={events.length < 2} onClick={play}>
          {playing ? <Pause /> : <Play />} {playing ? t("Pause") : cut < last ? t("Resume") : t("Replay")}
        </Button>
        {replaying && <Button variant="ghost" size="icon-sm" aria-label={t("Return to latest")} title={t("Return to latest")} onClick={() => { setPlaying(false); setCut(null); setPositionRevision((n) => n + 1) }}><SkipForward /></Button>}
        <div role="group" aria-label={t("Zoom")} className="flex items-center rounded-lg border bg-card shadow-[var(--highlight),var(--elev-1)]">
          <Button variant="ghost" size="icon-sm" aria-label={t("Zoom out")} disabled={zoomOut === undefined} onClick={() => zoomOut && changeZoom(zoomOut)}>
            <Minus />
          </Button>
          <button
            type="button"
            aria-pressed={zoom === null}
            aria-label={t("Fit to view, now {value1}%", {value1: Math.round((step / BASE) * 100)})}
            title={zoom === null ? t("Fitted to the view") : t("Fit to view")}
            onClick={() => changeZoom(null)}
            className={cn(
              'flex h-7 w-14 items-center justify-center gap-1 rounded-md text-xs tabular-nums outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring',
              zoom === null ? 'text-foreground' : 'text-muted-foreground',
            )}
          >
            {zoom === null && <span aria-hidden="true" className="size-1 rounded-full bg-primary" />}
            {Math.round((step / BASE) * 100)}%
          </button>
          <Button variant="ghost" size="icon-sm" aria-label={t("Zoom in")} disabled={zoomIn === undefined} onClick={() => zoomIn && changeZoom(zoomIn)}>
            <Plus />
          </Button>
        </div>
        {/* How far the replay has come. */}
        <div
          aria-hidden="true"
          className={cn('absolute inset-x-0 -bottom-px h-0.5 transition-opacity duration-(--dur-base)', replaying ? 'opacity-100' : 'opacity-0')}
        >
          <div className="map-progress h-full" style={{ transform: `scaleX(${last > 0 ? cut / last : 1})` }} />
        </div>
      </div>

      {/* A flex box: margin auto centres a Map smaller than the canvas, and scrolls one that is larger. */}
      <div ref={box} className="map-canvas relative flex min-h-0 flex-1 overflow-auto">
        {canvas.w > 0 && (
          <svg width={width} height={height} role="img" aria-label={title} className="m-auto block shrink-0 overflow-visible">
            {/* now */}
            <path d={`M${nowX} 14 V${height - 10}`} stroke="var(--faint)" strokeDasharray="3 4" data-playing={playing} className="map-now map-glide" />
            <g style={at(nowX, 11)} className="map-glide">
              <text textAnchor="middle" className={cn('map-halo text-[10.5px]', playing ? 'fill-primary' : 'fill-muted-foreground')}>{t("now")}</text>
            </g>

            {/* Branch lanes, drawn before main so the spine sits on top */}
            {merges.map((m) => (
              <path
                key={`m-${m.id}`}
                d={`M${m.x1} ${m.y1} C${(m.x1 + m.x2) / 2} ${m.y1} ${(m.x1 + m.x2) / 2} ${m.y2} ${m.x2} ${m.y2}`}
                fill="none"
                stroke={m.color}
                strokeWidth={1.5}
                strokeDasharray="4 3"
                opacity={0.8}
                className="map-glide hist-fade"
              />
            ))}
            {drawn.map(({ b, y, parentY, color, fx, own, endX, bend, on, quiet }) => (
              <g key={b.name} opacity={quiet ? 0.5 : 1} className="map-glide">
                <path
                  d={`M${fx} ${parentY} C${fx + bend * 0.55} ${parentY} ${fx + bend * 0.45} ${y} ${fx + bend} ${y} L${endX} ${y}`}
                  fill="none"
                  stroke={color}
                  strokeWidth={on ? 3 : 2}
                  strokeLinecap="round"
                  strokeDasharray={own.length === 0 ? '3 3' : undefined}
                  pathLength={own.length === 0 ? undefined : 1}
                  className={cn('map-glide', own.length === 0 ? 'hist-fade' : 'hist-draw')}
                />
                {b.publishedAs && seen(b.publishedAs) && (
                  <path
                    d={`M${endX} ${y} C${endX + step} ${y} ${x(b.publishedAs) - step} ${mainY} ${x(b.publishedAs)} ${mainY}`}
                    fill="none"
                    stroke={color}
                    strokeWidth={1.5}
                    opacity={0.7}
                    pathLength={1}
                    className="map-glide hist-draw"
                  />
                )}
                {own.map((c) =>
                  forkPoints.has(c.id) ? (
                    <circle key={c.id} cx={x(c.id)} cy={y} r={4.5} fill="var(--card)" stroke={color} strokeWidth={2} className="hist-pop map-pop map-glide">
                      <title>{t("{value1} · {value2} · {value3}{value4}", {value1: shortId(c.id), value2: c.message, value3: when(c.at), value4: c.by ? ` · ${c.by}` : ''})}</title>
                    </circle>
                  ) : (
                    <circle key={c.id} cx={x(c.id)} cy={y} r={3.5} fill={color} className="hist-pop map-pop map-glide">
                      <title>{t("{value1} · {value2} · {value3}{value4}", {value1: shortId(c.id), value2: c.message, value3: when(c.at), value4: c.by ? ` · ${c.by}` : ''})}</title>
                    </circle>
                  ),
                )}

              </g>
            ))}

            {/* main: solid through its newest Layer, dotted on to now */}
            {head && (
              <>
                <path d={`M${PAD_LEFT - 20} ${mainY} H${x(head.id)}`} stroke="var(--primary)" strokeWidth={5} strokeLinecap="round" pathLength={1} className="map-glide hist-draw" />
                <path d={`M${x(head.id)} ${mainY} H${nowX}`} stroke="var(--primary)" strokeWidth={2} strokeDasharray="2 5" className="map-glide hist-fade" />
              </>
            )}
            {(tree.branches.get('main')?.commits ?? []).filter((c) => seen(c.id)).map((c) => (
              <circle key={c.id} cx={x(c.id)} cy={mainY} r={3.5} fill="var(--primary)">
                <title>{`${shortId(c.id)} · ${c.message} · ${when(c.at)}`}</title>
              </circle>
            ))}
            {visibleLayers.map((l) => (
              <g key={l.id}>
                <rect
                  x={x(l.id) - 3}
                  y={mainY - 7}
                  width={6}
                  height={14}
                  rx={1.5}
                  fill={l.from ? laneColor(tree.branches.get(l.from)?.depth ?? 1) : 'var(--primary)'}
                  stroke="var(--card)"
                  strokeWidth={1}
                  className={cn('hist-pop map-pop map-glide', l === head && 'hist-head')}
                >
                  <title>{t("{value1} · {value2} · {value3}", {value1: shortId(l.id), value2: l.message, value3: when(l.at)})}</title>
                </rect>
                <g style={at(x(l.id) + 5, mainY - 10)} className="map-glide hist-fade">
                  <text className="map-halo fill-muted-foreground text-[10.5px] tabular-nums">{t("L")}{tree.layers.length - tree.layers.indexOf(l)}</text>
                </g>
              </g>
            ))}
            {/* Labels last, so no lane draws over them */}
            {drawn.map(({ b, y, color, endX, on, quiet }) => {
              const w = labelWidth(b)
              const focused = b.name === focus
              return (
                <g
                  key={`label-${b.name}`}
                  role="button"
                  tabIndex={0}
                  aria-label={t("Open {value1}", {value1: b.name})}
                  onClick={() => onOpen(b.name)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(b.name) } }}
                  className="map-label map-glide cursor-pointer outline-none"
                  opacity={quiet ? 0.6 : 1}
                  style={{ ...at(endX + 10, y - 11), '--head': color } as CSSProperties}
                >
                  <title>{b.name}</title>
                  <rect width={w} height={22} rx={6} fill={focused ? color : 'var(--card)'} stroke={color} strokeWidth={on ? 1.5 : 1} />
                  <text x={9} y={15} className={cn('font-sans text-[12px]', focused && 'font-semibold')} fill={focused ? 'var(--card)' : color}>
                    {labelText(b)}
                  </text>
                  {b.agent && (
                    <circle cx={w + 10} cy={11} r={4} fill={agentColor(tree.agents, b.agent)}>
                      <title>{b.agent}</title>
                    </circle>
                  )}
                </g>
              )
            })}
            <g
              role="button"
              tabIndex={0}
              aria-label={t("Open main")}
              onClick={() => onOpen('main')}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen('main') } }}
              className="map-label map-glide cursor-pointer outline-none"
              style={at(nowX + 10, mainY - 12)}
            >
              <rect width={50} height={24} rx={6} fill="var(--primary)" />
              <text x={25} y={16} textAnchor="middle" className="font-sans text-[12px] font-semibold" fill="var(--primary-foreground)">{t("main")}</text>
            </g>
          </svg>
        )}
      </div>
    </div>
  )
}
