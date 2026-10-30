// The Live tab's moving parts, drawn straight into one SVG over the cards:
// lanes from an agent through the Branch row it touched to the Workspace or
// Sandbox it reached, the dots that travel them (out in the agent's colour,
// back green or red), and the tree guides from each subagent to its parent.
// Positions come from the cards' data-anchor elements, reread at most every
// LAYOUT_MS while anything moves (and at once after a change), so lanes follow
// cards as they come, go and fold. A frame writes only what changed, and dots
// travel their lane's own path.
//
// The look is in live.css: a lane is a soft, wide line in its agent's colour
// that widens with traffic; one that stays drawn (a mount, or the Branch an
// agent works on) rests at that, and while it carries calls dashes flow along
// it toward the target. Each lane has a socket at the card edges it touches,
// plugs into its Branch row's edges, and a dot travels with a halo and a
// short tail. Under reduced motion nothing
// travels: lanes still light up and the cards a call reaches still ring.

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
  /** Lanes that stay drawn: a Workspace mounted by an agent, and the Branch an agent works on. */
  mounts: { key: string; route: FlowRoute }[]
  /** Tree guides, as [child anchor, parent anchor]. */
  tree: [string, string][]
  /** Faint resting connectors between placeholders, as [from anchor, to anchor]: left card's right edge to right card's left edge. */
  ghosts?: [string, string][]
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
  /** The lane itself: a soft, wide line in the agent's colour, wider with traffic. */
  path: SVGPathElement
  /** Its dashes, flowing toward the target while it carries calls. */
  dash: SVGPathElement
  /** Sockets where the lane meets a card's edge. */
  ports: SVGGElement
  heat: number
  /** Recent calls on it, decaying: sets its width. */
  load: number
  /** It stays drawn: a mount, or where an agent works. */
  mounted: boolean
  dots: number
  /** What was last written to the DOM, so a frame only touches what changed. */
  cls: string
  flow: boolean
  d: string
  /** The path's length, measured when `d` changes. */
  len: number
  style: string
}

interface Dot {
  lane: Lane
  /** The dot's group: removed when it arrives. */
  el: SVGGElement
  /** Halo and core, moved by transform. */
  head: SVGGElement
  tail: SVGCircleElement
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
/** A lane above this heat is carrying calls: its dashes flow. */
const FLOW_HEAT = 0.12
/** How far a dot's tail trails it, in px. */
const TAIL_PX = 11
/** The project's core rings at most this often, however many calls arrive. */
const CORE_MS = 180
/** Card positions are reread at most this often while lanes move. */
const LAYOUT_MS = 100
/** A lane's load halves over about this long. */
const LOAD_MS = 6000
/** A lane's width at rest, and the most traffic adds to it. */
const LANE_W = 3
const LANE_W_MAX = 6

export const OK_CLASS = 'text-success'
export const FAIL_CLASS = 'text-destructive'

const laneKey = (r: FlowRoute) => `${r.agent}|${r.via ?? ''}|${r.to ?? ''}`
const curve = (a: { x: number; y: number }, b: { x: number; y: number }) => {
  const dx = (b.x - a.x) / 2
  return `C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`
}
const ease = (k: number) => (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2)

/** The CSS colour behind a Tailwind text class: "text-primary" → var(--primary), "text-(--lane-3)" → var(--lane-3). */
export function colorVar(textClass: string): string {
  const arbitrary = /^text-\((--[\w-]+)\)$/.exec(textClass)
  return arbitrary ? `var(${arbitrary[1]})` : `var(--${textClass.slice('text-'.length)})`
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
  private coreAt = 0
  /** When card positions were last read; 0 rereads them on the next frame. */
  private layoutAt = 0
  private treeD = ''
  private ghostD = ''
  private readonly treeEl: SVGPathElement
  private readonly ghostEl: SVGPathElement
  private readonly laneLayer: SVGGElement
  private readonly dotLayer: SVGGElement
  private readonly observer: ResizeObserver
  private readonly motion: boolean

  constructor(
    private readonly root: HTMLElement,
    svg: SVGSVGElement,
  ) {
    this.motion = !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    this.ghostEl = svg.appendChild(document.createElementNS(NS, 'path'))
    this.ghostEl.setAttribute('fill', 'none')
    this.ghostEl.setAttribute('class', 'live-ghost')
    this.ghostEl.setAttribute('stroke-width', '1.5')
    this.treeEl = svg.appendChild(document.createElementNS(NS, 'path'))
    this.treeEl.setAttribute('fill', 'none')
    this.treeEl.setAttribute('class', 'live-tree')
    this.treeEl.setAttribute('stroke-width', '1.5')
    this.laneLayer = svg.appendChild(document.createElementNS(NS, 'g'))
    this.dotLayer = svg.appendChild(document.createElementNS(NS, 'g'))
    this.observer = new ResizeObserver(() => this.relayout())
    this.observer.observe(root)
    // cards rise in and fold with CSS; draw once more when they settle
    root.addEventListener('animationend', this.relayout)
    root.addEventListener('transitionend', this.relayout)
  }

  dispose() {
    this.disposed = true
    cancelAnimationFrame(this.raf)
    this.raf = 0
    this.observer.disconnect()
    this.root.removeEventListener('animationend', this.relayout)
    this.root.removeEventListener('transitionend', this.relayout)
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
    this.relayout()
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
      lane.load += 1
      const origin = this.scene.origin(route.agent)
      if (origin !== `agent-${route.agent}`) this.flash(origin, agentColor)
    } else if (opts.color) {
      // the call ended where it landed: that card glows green, or red when it failed
      this.flash(route.to ?? route.via, opts.color)
    }
    const arrived = () => {
      if (opts.back) return
      this.flash(route.via, agentColor)
      this.flash(route.to, agentColor)
      const now = performance.now()
      if (now - this.coreAt > CORE_MS) {
        this.coreAt = now
        this.flash('hub-core', agentColor)
      }
    }
    if (!this.motion || lane.dots >= LANE_DOTS || this.dots.length >= MAX_DOTS) {
      arrived()
      return Promise.resolve()
    }
    return new Promise((resolve) => {
      const { el, head, tail } = this.dot(opts.color ?? agentColor)
      lane.dots++
      this.dots.push({
        lane,
        el,
        head,
        tail,
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

  /** Cards moved or changed: reread their positions on the next frame. */
  private relayout = () => {
    this.layoutAt = 0
    this.kick()
  }

  private kick = () => {
    if (!this.raf && !this.disposed) this.raf = requestAnimationFrame(this.frame)
  }

  /** A dot: a soft halo and a bright core that move together, and a tail placed behind them. */
  private dot(colorClass: string) {
    const el = this.dotLayer.appendChild(document.createElementNS(NS, 'g'))
    el.setAttribute('class', colorClass)
    el.setAttribute('fill', 'currentColor')
    const tail = el.appendChild(document.createElementNS(NS, 'circle'))
    tail.setAttribute('r', '2.5')
    tail.setAttribute('class', 'live-dot-tail')
    const head = el.appendChild(document.createElementNS(NS, 'g'))
    const halo = head.appendChild(document.createElementNS(NS, 'circle'))
    halo.setAttribute('r', '9')
    halo.setAttribute('class', 'live-dot-halo')
    const core = head.appendChild(document.createElementNS(NS, 'circle'))
    core.setAttribute('r', '4')
    // the head moves by transform; the tail sits beside it so it can trail
    return { el, head, tail }
  }

  private lane(route: FlowRoute): Lane {
    const key = laneKey(route)
    let lane = this.lanes.get(key)
    if (!lane) {
      const path = this.laneLayer.appendChild(document.createElementNS(NS, 'path'))
      path.setAttribute('fill', 'none')
      path.setAttribute('stroke', 'currentColor')
      path.setAttribute('stroke-linecap', 'round')
      const dash = this.laneLayer.appendChild(document.createElementNS(NS, 'path'))
      dash.setAttribute('fill', 'none')
      dash.setAttribute('stroke', 'currentColor')
      dash.setAttribute('stroke-width', '2')
      const ports = this.laneLayer.appendChild(document.createElementNS(NS, 'g'))
      ports.setAttribute('fill', 'currentColor')
      lane = { route, path, dash, ports, heat: 0, load: 0, mounted: false, dots: 0, cls: '', flow: false, d: '', len: 0, style: '' }
      this.layoutAt = 0
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

  /**
   * The lane's path and the points where it meets a card's edge (its sockets).
   * It plugs into the Branch row it passes: in at the row's left edge, out at
   * its right edge toward the target, so a dot seems to pass through the
   * Branch. A row scrolled out of the hub's list, or no row, uses the hub's
   * edges instead. The path never crosses a card: it jumps (M) over the one
   * it passes through.
   */
  private legs(route: FlowRoute): { d: string; ports: { x: number; y: number }[] } | null {
    const a = this.rect(this.scene.origin(route.agent))
    const hub = this.rect('hub')
    if (!a || !hub) return null
    let row = route.via ? this.rect(route.via) : null
    const list = row ? this.rect('hub-rows') : null
    if (row && list && (row.y < list.t || row.y > list.b)) row = null
    const y = row ? row.y : route.via ? Math.min(Math.max(hub.y, hub.t + 16), hub.b - 16) : hub.y
    const inX = row ? row.l : hub.l
    const outX = row ? row.r : hub.r
    const from = { x: a.r, y: a.y }
    const d = `M ${from.x} ${from.y} ${curve(from, { x: inX, y })}`
    const to = route.to ? this.rect(route.to) : null
    if (!to) return { d, ports: [from, { x: inX, y }] }
    return {
      d: `${d} M ${outX} ${y} ${curve({ x: outX, y }, { x: to.l, y: to.y })}`,
      ports: [from, { x: inX, y }, { x: outX, y }, { x: to.l, y: to.y }],
    }
  }

  /** Places a lane's sockets: half-hidden circles under the cards' edges. */
  private placePorts(lane: Lane, ports: { x: number; y: number }[]) {
    const g = lane.ports
    while (g.childNodes.length < ports.length) g.appendChild(document.createElementNS(NS, 'circle')).setAttribute('r', '3.5')
    while (g.childNodes.length > ports.length) g.lastChild!.remove()
    ports.forEach((p, i) => {
      const c = g.childNodes[i] as SVGCircleElement
      c.setAttribute('cx', String(p.x))
      c.setAttribute('cy', String(p.y))
    })
  }

  private frame = (now: number) => {
    this.raf = 0
    const dt = this.last ? Math.min(100, now - this.last) : 16
    this.last = now
    const layout = now - this.layoutAt >= LAYOUT_MS
    if (layout) {
      this.layoutAt = now
      this.rects.clear()
      this.base = this.root.getBoundingClientRect()
      this.placeGuides()
    }

    let warm = false
    for (const [key, lane] of this.lanes) {
      lane.heat = Math.max(0, lane.heat - dt / COOL_MS)
      lane.load *= Math.exp(-dt / LOAD_MS)
      if (!lane.mounted && lane.heat === 0 && lane.dots === 0) {
        lane.path.remove()
        lane.dash.remove()
        lane.ports.remove()
        this.lanes.delete(key)
        continue
      }
      // a lane narrows back as its traffic fades
      if (lane.heat > 0 || lane.load > 0.05) warm = true
      if (layout) {
        const legs = this.legs(lane.route)
        const d = legs?.d ?? ''
        if (d !== lane.d) {
          lane.d = d
          lane.path.setAttribute('d', d)
          lane.dash.setAttribute('d', d)
          lane.len = d ? lane.path.getTotalLength() : 0
          this.placePorts(lane, legs?.ports ?? [])
        }
      }
      const color = this.scene.color(lane.route.agent)
      if (lane.cls !== color) {
        lane.cls = color
        lane.path.setAttribute('class', `live-lane ${color}`)
        lane.dash.setAttribute('class', `live-lane-dash ${color}`)
        lane.ports.setAttribute('class', color)
      }
      // a lane carrying calls flows: its dashes run toward the target over the soft line
      const flow = lane.heat > FLOW_HEAT
      if (lane.flow !== flow) {
        lane.flow = flow
        lane.dash.toggleAttribute('data-flow', flow)
      }
      // at rest a soft, wide line (a lane that stays drawn), wider with traffic
      const width = LANE_W + Math.min(LANE_W_MAX, lane.load * 0.7)
      const opacity = (lane.mounted ? 0.2 : 0) + lane.heat * (lane.mounted ? 0.12 : 0.28)
      const dash = Math.min(0.85, lane.heat * 1.2)
      const style = `${width.toFixed(1)}|${opacity.toFixed(2)}|${dash.toFixed(2)}`
      if (style !== lane.style) {
        lane.style = style
        lane.path.setAttribute('stroke-width', width.toFixed(1))
        lane.path.setAttribute('stroke-opacity', opacity.toFixed(2))
        lane.dash.setAttribute('stroke-opacity', dash.toFixed(2))
        lane.ports.setAttribute('fill-opacity', Math.min(1, 0.45 + opacity + dash).toFixed(2))
      }
    }

    this.dots = this.dots.filter((dot) => {
      const { path, len } = dot.lane
      const k = Math.min(1, (now - dot.t0) / dot.ms)
      if (len > 0) {
        const e = ease(k)
        const at = (dot.back ? 1 - e : e) * len
        const p = path.getPointAtLength(at)
        dot.head.setAttribute('transform', `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`)
        // the tail trails by a few px, less at the ends where the dot is slow
        const lag = TAIL_PX * Math.min(1, 4 * Math.min(k, 1 - k) + 0.2)
        const q = path.getPointAtLength(Math.min(len, Math.max(0, dot.back ? at + lag : at - lag)))
        dot.tail.setAttribute('cx', q.x.toFixed(1))
        dot.tail.setAttribute('cy', q.y.toFixed(1))
      }
      if (k < 1 && len > 0) return true
      dot.el.remove()
      dot.lane.dots--
      dot.done()
      return false
    })

    if (this.dots.length || warm) this.kick()
  }

  /** The tree guides and the resting ghosts: rewritten only when they change. */
  private placeGuides() {
    let tree = ''
    for (const [child, parent] of this.scene.tree) {
      const c = this.rect(child)
      const p = this.rect(parent)
      if (!c || !p) continue
      const x = p.l + 14
      tree += `M ${x} ${p.b} V ${c.y - 6} Q ${x} ${c.y} ${x + 6} ${c.y} H ${c.l} `
    }
    if (tree !== this.treeD) this.treeEl.setAttribute('d', (this.treeD = tree))

    let ghosts = ''
    for (const [from, to] of this.scene.ghosts ?? []) {
      const f = this.rect(from)
      const t = this.rect(to)
      if (!f || !t) continue
      const a = { x: f.r, y: f.y }
      ghosts += `M ${a.x} ${a.y} ${curve(a, { x: t.l, y: t.y })} `
    }
    if (ghosts !== this.ghostD) this.ghostEl.setAttribute('d', (this.ghostD = ghosts))
  }
}
