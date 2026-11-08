// Horizontal history topology informed by dsh-layerfs packages/view/src/tree.js.
// Plain commit markers, distinct branch lanes, and an overview for dense LayerFS histories.
import { Focus, Minus, Plus } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import { layoutNodes, type GraphNode, type HistoryBranch } from './model'

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n))
export const branchColor = (name: string) => {
  let hash = 0
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) | 0
  return name === 'main' ? 'var(--history-trunk)' : `var(--history-bough-${Math.abs(hash) % 6})`
}
type Point = ReturnType<typeof layoutNodes>['positioned'][number]
export function HistoryGraph({ nodes, lanes, branches, selected, linked, focus, onSelect, onBranch, onToggleFamily, collapsed, familyCounts, expanded, onCollapse, reset, inspector, onViewport, comparison, viewportRequest }: {
  nodes: GraphNode[]; lanes: Map<string, number>; branches: HistoryBranch[]; selected: string | null; linked: Set<string>; focus?: string | null
  onSelect: (id: string, branch: string) => void; onBranch: (branch: string) => void
  onToggleFamily: (name: string) => void; collapsed: Set<string>; familyCounts: Map<string, number>; expanded: boolean; onCollapse: () => void; reset: number
  inspector?: React.ReactNode; onViewport?: (top: number, left: number) => void
  comparison?: { from: string | null; to: string | null }
  viewportRequest?: { left: number; top: number; token: number } | null
}) {
  const host = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 1000, height: 500 })
  const [zoom, setZoom] = useState(1)
  const [viewport, setViewport] = useState({ left: 0, top: 0 })
  const drag = useRef<{ x: number; y: number; left: number; top: number; moved: boolean } | null>(null)
  const skipClick = useRef(false)
  const first = useRef(true)
  const appliedReset = useRef(reset)
  const layout = useMemo(() => layoutNodes(nodes, lanes, size.width, size.height), [nodes, lanes, size])
  const zRef = useRef(zoom); zRef.current = zoom
  const tagPoints = useMemo(() => {
    const result = new Map<string, Point>()
    for (const n of layout.positioned) if (!result.has(n.branch) || n.x > result.get(n.branch)!.x) result.set(n.branch, n)
    return result
  }, [layout])
  const now = Math.max(90, ...layout.positioned.map(n => n.x)) + 38
  const main = tagPoints.get('main')
  const mainEnd = main?.x ?? 60
  const pan = useCallback((left: number, top: number) => {
    const el = host.current
    if (!el) return
    el.scrollLeft = left; el.scrollTop = top
    setViewport({ left: el.scrollLeft, top: el.scrollTop })
  }, [])
  useEffect(() => {
    const el = host.current
    if (!el) return
    const observer = new ResizeObserver(() => {
      if (el.clientWidth && el.clientHeight) setSize({ width: el.clientWidth, height: el.clientHeight })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    const el = host.current
    if (!el || !nodes.length) return
    if (first.current) {
      first.current = false
      pan(Math.max(0, layout.width - size.width), layout.center - size.height / 2)
    }
  }, [nodes.length, layout, size, pan])
  useEffect(() => {
    const el = host.current
    if (!el || !focus) return
    const point = layout.points.get(focus)
    if (point) {
      const x = point.x * zoom, y = point.y * zoom
      const left = x < el.scrollLeft + 25 || x > el.scrollLeft + size.width - 25 ? x - size.width / 2 : el.scrollLeft
      const top = y < el.scrollTop + 25 ? y - 25 : y > el.scrollTop + size.height - 25 ? y - size.height + 25 : el.scrollTop
      pan(left, top)
    }
  }, [focus, layout.width, layout.center, pan, size.width, size.height])
  useEffect(() => {
    if (viewportRequest) pan(viewportRequest.left, viewportRequest.top)
  }, [viewportRequest, pan])
  useEffect(() => { if (reset !== appliedReset.current) setZoom(1) }, [reset])
  useEffect(() => {
    if (reset === appliedReset.current || zoom !== 1) return
    pan(Math.max(0, layout.width - size.width), layout.center - size.height / 2)
    appliedReset.current = reset
  }, [reset, zoom, layout.width, layout.center, size.width, size.height, pan])
  const changeZoom = useCallback((next: number, px?: number, py?: number) => {
    const el = host.current
    if (!el) return
    const old = zRef.current
    const value = clamp(next, .25, 3)
    const x = px ?? el.clientWidth / 2, y = py ?? el.clientHeight / 2
    const left = (el.scrollLeft + x) / old * value - x
    const top = (el.scrollTop + y) / old * value - y
    setZoom(value)
    requestAnimationFrame(() => pan(left, top))
  }, [pan])
  useEffect(() => {
    if (!first.current && !focus) pan(host.current?.scrollLeft ?? 0, layout.center * zRef.current - size.height / 2)
  }, [layout.center, size.height, pan])
  const fit = () => changeZoom(Math.min(size.width / layout.width, size.height / layout.height, 1))
  useEffect(() => {
    const el = host.current
    if (!el) return
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const r = el.getBoundingClientRect()
      changeZoom(zRef.current * Math.exp(-e.deltaY * .008), e.clientX - r.left, e.clientY - r.top)
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => el.removeEventListener('wheel', wheel)
  }, [changeZoom])
  const startDrag = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button || (e.target as Element).closest('[data-history-node], [data-branch-tag], button')) return
    e.preventDefault()
    const el = host.current!
    drag.current = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop, moved: false }
    el.setPointerCapture(e.pointerId)
  }
  const moveDrag = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d) return
    if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 4) d.moved = true
    if (d.moved) pan(d.left - (e.clientX - d.x), d.top - (e.clientY - d.y))
  }
  const endDrag = () => { skipClick.current = drag.current?.moved ?? false; drag.current = null }
  const byBranch = new Map<string, Point[]>()
  for (const n of layout.positioned) byBranch.set(n.branch, [...(byBranch.get(n.branch) ?? []), n])
  const curve = (a: Point, b: Point) => {
    const bend = Math.min(Math.max(24, Math.abs(b.y - a.y) * 1.1), Math.max(16, b.x - a.x))
    return `M${a.x},${a.y} C${a.x + bend * .45},${a.y} ${a.x + bend * .55},${b.y} ${a.x + bend},${b.y} H${b.x}`
  }
  const graft = (a: Point, b: Point) => {
    const bend = Math.min(Math.max(24, Math.abs(b.y - a.y) * 1.1), Math.max(16, b.x - a.x))
    const start = Math.max(a.x, b.x - bend)
    return `M${a.x},${a.y} H${start} C${start + bend * .45},${a.y} ${start + bend * .55},${b.y} ${b.x},${b.y}`
  }
  const visible = layout.positioned.filter(n => n.x * zoom > viewport.left - 50 && n.x * zoom < viewport.left + size.width + 50 && n.y * zoom > viewport.top - 40 && n.y * zoom < viewport.top + size.height + 40)
  const topologyPins = new Set(branches.flatMap(b => [b.head, b.forkedFrom]).filter((id): id is string => !!id))
  const bins = new Set<string>()
  const drawn = visible.filter(n => {
    const essential = topologyPins.has(n.id) || n.commits.some(c => topologyPins.has(c.id)) || n.kind === 'layer' || n.kind === 'group' || n.second || n.id === selected || n.commits.some(c => c.id === selected || linked.has(c.id)) || tagPoints.get(n.branch)?.id === n.id
    const bin = `${n.branch}:${Math.floor(n.x * zoom / 12)}`
    if (!essential && bins.has(bin)) return false
    bins.add(bin); return true
  })
  const overview = Array.from({ length: 90 }, () => 0)
  for (const n of layout.positioned) overview[Math.min(89, Math.floor(n.x / layout.width * 90))] += Math.max(1, n.commits.length)
  const peak = Math.max(1, ...overview)
  const miniMove = (e: PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    pan(clamp((e.clientX - rect.left) / rect.width, 0, 1) * layout.width * zoom - size.width / 2, viewport.top)
    if (e.buttons) e.currentTarget.setPointerCapture(e.pointerId)
  }
  return <div className="history-map">
    <div className="history-map-controls" role="group" aria-label="Zoom History">
      {expanded && <button onClick={onCollapse} title="Collapse groups">Collapse</button>}
      <button onClick={() => changeZoom(zoom / 1.25)} aria-label="Zoom out"><Minus size={14} /></button>
      <button className="history-zoom-value" onClick={() => changeZoom(1)} title="Reset zoom">{Math.round(zoom * 100)}%</button>
      <button onClick={() => changeZoom(zoom * 1.25)} aria-label="Zoom in"><Plus size={14} /></button>
      <button onClick={fit} aria-label="Fit history"><Focus size={15} /></button>
    </div>
    <div className="history-graph" ref={host} tabIndex={0} aria-label="Branch history graph. Drag to pan; Control or Command plus scroll to zoom." onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}
      onScroll={e => { setViewport({ left: e.currentTarget.scrollLeft, top: e.currentTarget.scrollTop }); onViewport?.(e.currentTarget.scrollTop, e.currentTarget.scrollLeft) }}
      onKeyDown={e => { if ((e.target as Element).closest('[data-history-node], [data-branch-tag]')) return; if (e.key === '+' || e.key === '=') changeZoom(zoom * 1.25); else if (e.key === '-') changeZoom(zoom / 1.25); else if (e.key === '0') changeZoom(1); else return; e.preventDefault() }}>
      <svg className="history-canvas" width={layout.width * zoom} height={layout.height * zoom} viewBox={`0 0 ${layout.width} ${layout.height}`}>
        <rect className="history-main-band" x={0} y={layout.center - 19 / zoom} width={layout.width} height={38 / zoom} />
        <path className="history-main-line" d={`M20 ${layout.center} H${mainEnd}`} />
        <path className="history-main-future" d={`M${mainEnd + 7} ${layout.center} H${now}`} />
        <line className="history-now-line" x1={now} x2={now} y1={18} y2={layout.height - 18} />
        <text className="history-now-label" x={now + 5 / zoom} y={20 / zoom} style={{ fontSize: 10 / zoom }}>now</text>
        {[...byBranch.entries()].map(([name, ns]) => {
          if (name === 'main') return null
          const branch = branches.find(b => b.name === name)
          const firstNode = ns[0], head = ns.at(-1)!
          const origin = layout.points.get(branch?.forkedFrom ?? '')
          const color = branchColor(name)
          return <g key={name} style={{ '--bough': color } as CSSProperties} className={selected && name !== layout.points.get(selected)?.branch ? 'history-bough is-dimmed' : 'history-bough'}>
            {origin ? <path className="history-fork-path" d={curve(origin, firstNode)} /> : <path className="history-unloaded-path" d={`M${Math.max(20,firstNode.x - 35)},${firstNode.y} H${firstNode.x}`} />}
            <path className="history-branch-path" d={`M${firstNode.x},${head.y} H${head.x}`} />
          </g>
        })}
        {layout.positioned.filter(n => n.second || n.kind === 'layer' && n.parent).map(n => {
          const from = layout.points.get(n.second ?? n.parent ?? '')
          if (!from) return null
          return <path key={`merge:${n.id}`} className={n.kind === 'layer' ? 'history-publish-path' : 'history-merge-path'} style={{ '--bough': branchColor(from.branch) } as CSSProperties} d={graft(from, n)} />
        })}
        {drawn.map((n) => {
          const active = selected === n.id || n.commits.some(c => c.id === selected)
          const isLinked = n.commits.some(c => linked.has(c.id))
          const from = comparison?.from === n.id || n.commits.some(c => c.id === comparison?.from)
          const to = comparison?.to === n.id || n.commits.some(c => c.id === comparison?.to)
          const color = branchColor(n.branch)
          const label = `${n.branch}: ${n.label}${n.kind === 'group' ? '' : ` · ${n.id}`}`
          return <g key={n.id} data-history-node={n.id} data-kind={n.kind} data-comparison={from && to ? 'both' : from ? 'from' : to ? 'to' : undefined} role="button" tabIndex={0} aria-label={label}
            className={`history-node ${active ? 'is-selected' : ''} ${isLinked ? 'is-linked' : ''}`} style={{ '--bough': color } as CSSProperties}
            transform={`translate(${n.x},${n.y}) scale(${1 / zoom})`} onClick={() => { if (!skipClick.current) onSelect(n.id, n.branch); skipClick.current = false }} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(n.id, n.branch) } }}>
            <title>{label}</title><circle className="history-node-hit" r={12} />
            {(from || to) && <text className="hc-graph-pin" y={25} textAnchor="middle">{from && to ? 'From / To' : from ? 'From' : 'To'}</text>}
            {(active || isLinked) && <circle className="history-selected-ring" r={12} />}
            {n.kind === 'layer' ? <rect className="history-layer-mark" x={-3.5} y={-3.5} width={7} height={7} rx={1.5} /> : n.second ? <circle className="history-merge-ring" r={5} /> : n.kind === 'group' ? <>
              {[-5, 0, 5].map(x => <circle className="history-commit-dot history-group-dot" key={x} cx={x} r={3} />)}
              <text className="history-group-count" x={0} y={-12} textAnchor="middle">{n.commits.length}</text>
            </> : <circle className="history-commit-dot" r={3.5} />}

          </g>
        })}
        {[...tagPoints.entries()].map(([name, head]) => {
          const width = name.length * 6.3 + 16
          const children = familyCounts.get(name) ?? 0
          return <g key={name} data-branch-tag={name} role="button" tabIndex={0} aria-label={`Open ${name} branch`} className={`history-branch-tag ${name === 'main' ? 'is-main' : ''}`} style={{ '--bough': branchColor(name) } as CSSProperties}
            transform={`translate(${head.x + 24 / zoom},${head.y}) scale(${1 / zoom})`} onClick={() => onBranch(name)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onBranch(name) } }}>
            <title>{name} · click to inspect branch{children ? ` · ${children} forks` : ''}</title>
            <rect x={0} y={-9} width={width} height={18} rx={2} /><text x={8} y={3.5}>{name}</text>
            {children > 0 && name !== 'main' && <g className="history-family-tag" role="button" tabIndex={0} aria-expanded={!collapsed.has(name)} aria-label={`${collapsed.has(name) ? 'Expand' : 'Collapse'} ${name} family`} onClick={e => { e.stopPropagation(); onToggleFamily(name) }} onKeyDown={e => { if (e.key === 'Enter') { e.stopPropagation(); onToggleFamily(name) } }} transform={`translate(${width + 8},0)`}><rect y={-9} width={24} height={18} rx={2} /><text x={5} y={3.5}>{collapsed.has(name) ? '+' : '−'}{children}</text></g>}
          </g>
        })}
      </svg>
    </div>
    {inspector}
    <div className="history-overview">
      <button className="history-now-button" onClick={() => pan(Math.max(0, layout.width * zoom - size.width), layout.center * zoom - size.height / 2)}>Overview<span>now ↗</span></button>
      <div className="history-overview-strip" role="slider" tabIndex={0} aria-label="History overview" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(viewport.left / Math.max(1,layout.width * zoom-size.width) * 100)} onPointerDown={miniMove} onPointerMove={e => { if (e.buttons) miniMove(e) }} onKeyDown={e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); pan(viewport.left + (e.key === 'ArrowRight' ? 1 : -1) * size.width / 3,viewport.top) } }}>
        <svg viewBox="0 0 900 38" preserveAspectRatio="none" aria-hidden="true">
          {overview.map((v,i) => v > 0 && <rect className="history-overview-bar" key={i} x={i*10 + 1} y={36 - 28 * Math.sqrt(v / peak)} width={8} height={28 * Math.sqrt(v / peak)} />)}
          {layout.positioned.filter(n=>n.kind==='layer').map(n=><rect key={n.id} className="history-overview-layer" x={n.x / layout.width * 900} y={1} width={3} height={8} />)}
        </svg>
        <div className="history-overview-window" style={{ left: `${viewport.left / (layout.width * zoom) * 100}%`, width: `${Math.min(100, size.width / (layout.width * zoom) * 100)}%` }} />
      </div>
    </div>
  </div>
}
