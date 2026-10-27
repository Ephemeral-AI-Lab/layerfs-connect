// The Live tab's moving parts, drawn straight into one SVG over the cards:
// lanes from an agent through the Branch row it touched to the Workspace or
// Sandbox it reached, the dots that travel them (out in the agent's colour,
// back green or red), and the tree guides from each subagent to its parent.
// Positions come from the cards' data-anchor elements, read every frame while
// anything moves, so lanes follow cards as they come, go and fold.

/** Where a call travels: from an agent, through a Branch row (or the hub), to a target. */
export interface FlowRoute {
  /** The agent's key, "<run>/<name>". */
  agent: string
  /** The Branch row's anchor; null goes through the middle of the hub. */
  via: string | null
  /** The Workspace's or Sandbox's anchor; null ends at the hub. */
  to: string | null
}

export interface FlowScene {
  /** The anchor a call of this agent starts from: its card, a folded ancestor's, or its folded session's. */
  origin: (agent: string) => string
  /** The agent's colour as a Tailwind text class ("text-primary"), so lanes follow the theme. */
  color: (agent: string) => string
  /** Lanes that stay drawn: a Workspace mounted by an agent. */
  mounts: { key: string; route: FlowRoute }[]
  /** Tree guides, as [child anchor, parent anchor]. */
  tree: [string, string][]
}

interface Rect {
  l: number
  r: number
  t: number
  b: number
  y: number
}

interface Lane {
  route: FlowRoute
  path: SVGPathElement
  heat: number
  mounted: boolean
  dots: number
}

interface Dot {
  lane: Lane
  el: SVGCircleElement
  t0: number
  ms: number
  back: boolean
  done: () => void
}

const NS = 'http://www.w3.org/2000/svg'
/** The shortest a leg is drawn, however fast the call: a 9 ms call still shows. */
export const LEG_MS = 550
/** A lane's glow after its last call. */
const COOL_MS = 3000
/** Dots on one lane at once; more calls only keep it warm. */
const LANE_DOTS = 3
const MAX_DOTS = 40

export const OK_CLASS = 'text-success'
export const FAIL_CLASS = 'text-destructive'

const laneKey = (r: FlowRoute) => `${r.agent}|${r.via ?? ''}|${r.to ?? ''}`
const curve = (a: { x: number; y: number }, b: { x: number; y: number }) => {
  const dx = (b.x - a.x) / 2
  return `C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`
}
const ease = (k: number) => (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2)

/** The CSS colour behind a Tailwind text class: "text-primary" → var(--color-primary), "text-(--lane-3)" → var(--lane-3). */
export function colorVar(textClass: string): string {
  const arbitrary = /^text-\((--[\w-]+)\)$/.exec(textClass)
  return arbitrary ? `var(${arbitrary[1]})` : `var(--color-${textClass.slice('text-'.length)})`
}

export class FlowEngine {
  private scene: FlowScene = { origin: (a) => `agent-${a}`, color: () => 'text-primary', mounts: [], tree: [] }
  private lanes = new Map<string, Lane>()
  private dots: Dot[] = []
  private raf = 0
  private last = 0
  private disposed = false
  private rects = new Map<string, Rect | null>()
  private base: DOMRect | null = null
  private readonly treeEl: SVGPathElement
  private readonly laneLayer: SVGGElement
  private readonly dotLayer: SVGGElement
  private readonly probe: SVGPathElement
  private readonly observer: ResizeObserver
  private readonly motion: boolean

  constructor(
    private readonly root: HTMLElement,
    svg: SVGSVGElement,
  ) {
    this.motion = !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    this.treeEl = svg.appendChild(document.createElementNS(NS, 'path'))
    this.treeEl.setAttribute('fill', 'none')
    this.treeEl.setAttribute('class', 'stroke-border')
    this.treeEl.setAttribute('stroke-width', '1.5')
    this.laneLayer = svg.appendChild(document.createElementNS(NS, 'g'))
    this.dotLayer = svg.appendChild(document.createElementNS(NS, 'g'))
    this.probe = document.createElementNS(NS, 'path')
    this.observer = new ResizeObserver(() => this.kick())
    this.observer.observe(root)
  }

  dispose() {
    this.disposed = true
    cancelAnimationFrame(this.raf)
    this.raf = 0
    this.observer.disconnect()
    const dots = this.dots
    this.dots = []
    for (const d of dots) d.done()
  }

  /** The cards' current state: called on every render, so a frame follows each change. */
  setScene(scene: FlowScene) {
    this.scene = scene
    const keep = new Set<string>()
    for (const m of scene.mounts) {
      const lane = this.lane(m.route)
      lane.mounted = true
      keep.add(laneKey(m.route))
    }
    for (const [key, lane] of this.lanes)
      if (lane.mounted && !keep.has(key)) {
        // unmounted: it fades out like any lane after its last call
        lane.mounted = false
        lane.heat = Math.max(lane.heat, 0.6)
      }
    this.kick()
  }

  /**
   * Sends one leg of a call along `route`: out in the agent's colour (a folded
   * card it starts from rings, and the Branch row and target ring when it
   * arrives), or back in `color`. Resolves when the dot arrives: at once
   * without motion, or when the lane is too busy for another dot.
   */
  send(route: FlowRoute, opts: { back?: boolean; color?: string } = {}): Promise<void> {
    if (this.disposed) return Promise.resolve()
    const lane = this.lane(route)
    const agentColor = this.scene.color(route.agent)
    lane.heat = 1
    this.kick()
    if (!opts.back) {
      const origin = this.scene.origin(route.agent)
      if (origin !== `agent-${route.agent}`) this.flash(origin, agentColor)
    }
    const arrived = () => {
      if (opts.back) return
      this.flash(route.via, agentColor)
      this.flash(route.to, agentColor)
    }
    if (!this.motion || lane.dots >= LANE_DOTS || this.dots.length >= MAX_DOTS) {
      arrived()
      return Promise.resolve()
    }
    return new Promise((resolve) => {
      const el = this.dotLayer.appendChild(document.createElementNS(NS, 'circle'))
      el.setAttribute('r', '4')
      el.setAttribute('fill', 'currentColor')
      el.setAttribute('class', opts.color ?? agentColor)
      lane.dots++
      this.dots.push({
        lane,
        el,
        t0: performance.now(),
        ms: LEG_MS,
        back: !!opts.back,
        done: () => {
          arrived()
          resolve()
        },
      })
    })
  }

  /** Rings an anchor's element in a colour (a Branch row a call reached, a folded card whose subagent called). */
  flash(anchor: string | null, colorClass: string) {
    if (!anchor) return
    const el = this.element(anchor)
    if (!el) return
    el.style.setProperty('--flash', colorVar(colorClass))
    el.classList.remove('live-flash')
    void el.offsetWidth // restart the animation
    el.classList.add('live-flash')
  }

  // ---------- drawing ----------

  private kick() {
    if (!this.raf && !this.disposed) this.raf = requestAnimationFrame(this.frame)
  }

  private lane(route: FlowRoute): Lane {
    const key = laneKey(route)
    let lane = this.lanes.get(key)
    if (!lane) {
      const path = this.laneLayer.appendChild(document.createElementNS(NS, 'path'))
      path.setAttribute('fill', 'none')
      path.setAttribute('stroke', 'currentColor')
      lane = { route, path, heat: 0, mounted: false, dots: 0 }
      this.lanes.set(key, lane)
    }
    return lane
  }

  private element(anchor: string): HTMLElement | null {
    return this.root.querySelector<HTMLElement>(`[data-anchor="${CSS.escape(anchor)}"]`)
  }

  private rect(anchor: string): Rect | null {
    if (this.rects.has(anchor)) return this.rects.get(anchor)!
    const el = this.element(anchor)
    let r: Rect | null = null
    if (el && el.offsetParent !== null && this.base) {
      const b = el.getBoundingClientRect()
      const o = this.base
      r = { l: b.left - o.left, r: b.right - o.left, t: b.top - o.top, b: b.bottom - o.top, y: b.top + b.height / 2 - o.top }
    }
    this.rects.set(anchor, r)
    return r
  }

  /** agent → (hub's left edge at the Branch row) → [across the hub, hidden behind it] → target. */
  private pathFor(route: FlowRoute): string | null {
    const a = this.rect(this.scene.origin(route.agent))
    const hub = this.rect('hub')
    if (!a || !hub) return null
    const row = route.via ? this.rect(route.via) : null
    // a row scrolled out of the hub's list still enters at the hub's edge
    const y = row ? Math.min(Math.max(row.y, hub.t + 16), hub.b - 16) : hub.y
    const from = { x: a.r, y: a.y }
    const d = `M ${from.x} ${from.y} ${curve(from, { x: hub.l, y })}`
    const to = route.to ? this.rect(route.to) : null
    if (!to) return `${d} L ${hub.l + 24} ${y}`
    return `${d} L ${hub.r} ${y} ${curve({ x: hub.r, y }, { x: to.l, y: to.y })}`
  }

  private frame = (now: number) => {
    this.raf = 0
    const dt = this.last ? Math.min(100, now - this.last) : 16
    this.last = now
    this.rects.clear()
    this.base = this.root.getBoundingClientRect()

    let tree = ''
    for (const [child, parent] of this.scene.tree) {
      const c = this.rect(child)
      const p = this.rect(parent)
      if (!c || !p) continue
      const x = p.l + 14
      tree += `M ${x} ${p.b} V ${c.y - 6} Q ${x} ${c.y} ${x + 6} ${c.y} H ${c.l} `
    }
    this.treeEl.setAttribute('d', tree)

    let warm = false
    for (const [key, lane] of this.lanes) {
      lane.heat = Math.max(0, lane.heat - dt / COOL_MS)
      if (!lane.mounted && lane.heat === 0 && lane.dots === 0) {
        lane.path.remove()
        this.lanes.delete(key)
        continue
      }
      if (lane.heat > 0) warm = true
      lane.path.setAttribute('d', this.pathFor(lane.route) ?? '')
      lane.path.setAttribute('class', this.scene.color(lane.route.agent))
      lane.path.setAttribute('stroke-width', lane.mounted ? '2' : '1.5')
      lane.path.setAttribute('stroke-opacity', String((lane.mounted ? 0.4 : 0) + lane.heat * 0.55))
      if (lane.mounted) lane.path.removeAttribute('stroke-dasharray')
      else lane.path.setAttribute('stroke-dasharray', '3 5')
    }

    this.dotLayer.appendChild(this.probe)
    this.dots = this.dots.filter((dot) => {
      const d = this.pathFor(dot.lane.route)
      const k = Math.min(1, (now - dot.t0) / dot.ms)
      if (d) {
        this.probe.setAttribute('d', d)
        const len = this.probe.getTotalLength()
        const e = ease(k)
        const p = this.probe.getPointAtLength((dot.back ? 1 - e : e) * len)
        dot.el.setAttribute('cx', String(p.x))
        dot.el.setAttribute('cy', String(p.y))
      }
      if (k < 1 && d) return true
      dot.el.remove()
      dot.lane.dots--
      dot.done()
      return false
    })
    this.probe.remove()

    if (this.dots.length || warm) this.kick()
  }
}
