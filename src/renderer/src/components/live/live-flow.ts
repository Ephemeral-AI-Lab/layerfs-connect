// Stable routes connect agents, Branches and Workspaces. A single chevron
// follows a route for each call: outward in the agent's colour, back in green
// or red. Running calls keep a brighter, still route between those moments.
// Idle and reduced-motion scenes do not run an animation loop. Hover/focus
// isolates a node's routes without intercepting its controls.

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
  /** Calls still running: their routes remain visible without repeated packets. */
  active: FlowRoute[]
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
  el: SVGGElement
  /** A fixed-width line; activity changes its emphasis, never its geometry. */
  path: SVGPathElement
  /** It stays drawn: a mount, or where an agent works. */
  mounted: boolean
  active: boolean
  packets: number
  /** What was last written to the DOM, so a frame only touches what changed. */
  d: string
  /** The path's length, measured when `d` changes. */
  len: number
}

interface Link {
  el: SVGGElement
  path: SVGPathElement
  lanes: Lane[]
}

interface Packet {
  lane: Lane
  el: SVGGElement
  t0: number
  back: boolean
  color: string
  promise: Promise<void>
  done: () => void
}

const NS = 'http://www.w3.org/2000/svg'
/** The shortest a leg is drawn, however fast the call: a 9 ms call still shows. */
export const LEG_MS = 650
const MAX_PACKETS = 24
/** Card positions are reread at most this often while lanes move. */
const LAYOUT_MS = 100

export const OK_CLASS = 'text-success'
export const FAIL_CLASS = 'text-destructive'

const laneKey = (r: FlowRoute) => `${r.agent}|${r.via ?? ''}|${r.to ?? ''}`
/** Rounded elbows keep every turn in the space between columns. */
const elbow = (a: { x: number; y: number }, b: { x: number; y: number }, x: number) => {
  const turn = Math.sign(b.y - a.y)
  const r = Math.min(10, Math.abs(b.y - a.y) / 2, (b.x - a.x) / 4)
  if (!turn) return `M ${a.x} ${a.y} H ${b.x}`
  x = Math.max(a.x + r, Math.min(b.x - r, x))
  return `M ${a.x} ${a.y} H ${x - r} Q ${x} ${a.y} ${x} ${a.y + turn * r} V ${b.y - turn * r} Q ${x} ${b.y} ${x + r} ${b.y} H ${b.x}`
}
const ease = (k: number) => (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2)

/** The CSS colour behind a Tailwind text class: "text-primary" → var(--primary), "text-(--lane-3)" → var(--lane-3). */
export function colorVar(textClass: string): string {
  const arbitrary = /^text-\((--[\w-]+)\)$/.exec(textClass)
  return arbitrary ? `var(${arbitrary[1]})` : `var(--${textClass.slice('text-'.length)})`
}

export class FlowEngine {
  private scene: FlowScene = { origin: (a) => `agent-${a}`, color: () => 'text-primary', mounts: [], active: [], tree: [] }
  private lanes = new Map<string, Lane>()
  private packets: Packet[] = []
  private links = new Map<string, Link>()
  private linkOrder: Link[] = []
  private raf = 0
  private disposed = false
  private rects = new Map<string, Rect | null>()
  private base: DOMRect | null = null
  private pointerAnchor: string | null = null
  private focusAnchor: string | null = null
  /** When card positions were last read; 0 rereads them on the next frame. */
  private layoutAt = 0
  private treeD = ''
  private ghostD = ''
  private readonly treeEl: SVGPathElement
  private readonly ghostEl: SVGPathElement
  private readonly laneLayer: SVGGElement
  private readonly packetLayer: SVGGElement
  private readonly linkLayer: SVGGElement
  private readonly observer: ResizeObserver
  private readonly motionQuery: MediaQueryList

  private get motion() { return !this.motionQuery.matches }

  constructor(
    private readonly root: HTMLElement,
    svg: SVGSVGElement,
  ) {
    this.motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    this.ghostEl = svg.appendChild(document.createElementNS(NS, 'path'))
    this.ghostEl.setAttribute('fill', 'none')
    this.ghostEl.setAttribute('class', 'live-ghost')
    this.ghostEl.setAttribute('stroke-width', '1.5')
    this.treeEl = svg.appendChild(document.createElementNS(NS, 'path'))
    this.treeEl.setAttribute('fill', 'none')
    this.treeEl.setAttribute('class', 'live-tree')
    this.treeEl.setAttribute('stroke-width', '1.5')
    this.linkLayer = svg.appendChild(document.createElementNS(NS, 'g'))
    this.laneLayer = svg.appendChild(document.createElementNS(NS, 'g'))
    this.packetLayer = svg.appendChild(document.createElementNS(NS, 'g'))
    this.observer = new ResizeObserver(() => this.relayout())
    this.observer.observe(root)
    // Reposition connectors when card transitions settle.
    root.addEventListener('animationend', this.animationEnd)
    root.addEventListener('transitionend', this.relayout)
    root.addEventListener('scroll', this.relayout, true)
    root.addEventListener('pointerover', this.pointerOver)
    root.addEventListener('pointerleave', this.pointerLeave)
    root.addEventListener('focusin', this.focusIn)
    root.addEventListener('focusout', this.focusOut)
    this.motionQuery.addEventListener('change', this.motionChanged)
  }

  dispose() {
    this.disposed = true
    cancelAnimationFrame(this.raf)
    this.raf = 0
    this.observer.disconnect()
    this.root.removeEventListener('animationend', this.animationEnd)
    this.root.removeEventListener('transitionend', this.relayout)
    this.root.removeEventListener('scroll', this.relayout, true)
    this.root.removeEventListener('pointerover', this.pointerOver)
    this.root.removeEventListener('pointerleave', this.pointerLeave)
    this.root.removeEventListener('focusin', this.focusIn)
    this.root.removeEventListener('focusout', this.focusOut)
    this.motionQuery.removeEventListener('change', this.motionChanged)
    for (const layer of [this.ghostEl, this.treeEl, this.linkLayer, this.laneLayer, this.packetLayer]) layer.remove()
    this.clearPackets()
  }

  private clearPackets() {
    const packets = this.packets
    this.packets = []
    for (const packet of packets) {
      packet.el.remove()
      packet.lane.packets--
      packet.done()
    }
  }

  private motionChanged = () => {
    if (this.motion) return
    this.clearPackets()
    for (const el of this.root.querySelectorAll('.live-flash')) el.classList.remove('live-flash')
    cancelAnimationFrame(this.raf)
    this.raf = 0
    this.relayout()
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
    const active = new Set<string>()
    for (const route of scene.active) {
      this.lane(route)
      active.add(laneKey(route))
    }
    for (const [key, lane] of this.lanes) {
      lane.mounted = keep.has(key)
      lane.active = active.has(key)
    }
    this.emphasize()
    this.relayout()
  }

  /** One outward/return packet. Concurrent calls share a direction; the return waits for departure. */
  send(route: FlowRoute, opts: { back?: boolean; color?: string } = {}): Promise<void> {
    if (this.disposed) return Promise.resolve()
    const lane = this.lane(route)
    const pending = this.packets.find((packet) => packet.lane === lane)
    if (pending) {
      if (pending.back !== !!opts.back) return pending.promise.then(() => this.send(route, opts))
      // A failed result remains visible when several results share the return.
      if (opts.color === FAIL_CLASS && pending.color !== FAIL_CLASS) {
        pending.color = FAIL_CLASS
        pending.el.setAttribute('class', `live-packet ${FAIL_CLASS}`)
        this.flash(route.to ?? route.via ?? 'hub-core', FAIL_CLASS)
      }
      return pending.promise
    }
    if (opts.back && opts.color) this.flash(route.to ?? route.via ?? 'hub-core', opts.color)
    this.kick()
    if (!this.motion || this.packets.length >= MAX_PACKETS) return Promise.resolve()
    const color = opts.color ?? this.scene.color(route.agent)
    const el = this.packet(color)
    let done!: () => void
    const promise = new Promise<void>((resolve) => { done = resolve })
    lane.packets++
    this.packets.push({ lane, el, color, back: !!opts.back, t0: performance.now(), promise, done })
    this.emphasize()
    return promise
  }

  /** One brief result on the destination, without restarting feedback already in progress. */
  flash(anchor: string | null, colorClass: string) {
    if (!anchor || !this.motion || this.disposed) return
    const el = this.element(anchor)
    if (!el) return
    el.style.setProperty('--flash', colorVar(colorClass))
    el.classList.add('live-flash')
  }

  private animationEnd = (event: AnimationEvent) => {
    if (event.animationName === 'live-call-feedback' || event.animationName === 'live-core-feedback') {
      if (event.target instanceof Element) event.target.classList.remove('live-flash')
    } else this.relayout()
  }

  private anchorOf(target: EventTarget | null): string | null {
    const el = target instanceof Element ? target.closest<HTMLElement>('[data-anchor]') : null
    return el && this.root.contains(el) ? el.dataset.anchor ?? null : null
  }

  private pointerOver = (event: PointerEvent) => {
    this.pointerAnchor = this.anchorOf(event.target)
    this.emphasize()
  }

  private pointerLeave = () => {
    this.pointerAnchor = null
    this.emphasize()
  }

  private focusIn = (event: FocusEvent) => {
    this.pointerAnchor = null
    this.focusAnchor = this.anchorOf(event.target)
    this.emphasize()
  }

  private focusOut = (event: FocusEvent) => {
    this.focusAnchor = this.anchorOf(event.relatedTarget)
    this.emphasize()
  }

  private emphasize() {
    const anchor = this.pointerAnchor ?? this.focusAnchor
    const selected = anchor ? this.element(anchor) : null
    const relates = (route: FlowRoute) => !!selected && (
      anchor === 'hub' || anchor === 'hub-core' || anchor === 'hub-rows' ||
      [this.scene.origin(route.agent), route.via, route.to].some((key) => key && (key === anchor || selected.contains(this.element(key))))
    )
    const mark = (el: SVGGElement, route: FlowRoute) => {
      const related = relates(route)
      el.toggleAttribute('data-related', related)
      el.toggleAttribute('data-dimmed', !!selected && !related)
    }
    for (const lane of this.lanes.values()) mark(lane.el, lane.route)
    for (const packet of this.packets) mark(packet.el, packet.lane.route)
    for (const link of this.links.values()) {
      const related = link.lanes.filter((lane) => relates(lane.route))
      const highlighted = related.find((lane) => lane.active) ?? related[0]
      const active = link.lanes.find((lane) => lane.active || lane.packets > 0)
      const owner = highlighted ?? active
      link.el.toggleAttribute('data-related', related.length > 0)
      link.el.toggleAttribute('data-dimmed', !!selected && related.length === 0)
      link.el.toggleAttribute('data-active', !!active)
      link.el.style.setProperty('--route-color', owner ? colorVar(this.scene.color(owner.route.agent)) : 'var(--muted-foreground)')
    }
    // Shared rail portions must not paint a quiet line over the highlighted route.
    const priority = (link: Link) => link.el.hasAttribute('data-related') ? 2 : link.el.hasAttribute('data-active') ? 1 : 0
    const ordered = [...this.links.values()].sort((a, b) => priority(a) - priority(b))
    if (ordered.some((link, i) => this.linkOrder[i] !== link) || ordered.length !== this.linkOrder.length) {
      for (const link of ordered) this.linkLayer.appendChild(link.el)
      this.linkOrder = ordered
    }
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

  /** The arrow tip follows the path tangent; no halo, trail or second moving line. */
  private packet(colorClass: string) {
    const el = this.packetLayer.appendChild(document.createElementNS(NS, 'g'))
    el.setAttribute('class', `live-packet ${colorClass}`)
    el.setAttribute('visibility', 'hidden')
    const arrow = el.appendChild(document.createElementNS(NS, 'path'))
    arrow.setAttribute('d', 'M -5 -3.5 L 0 0 L -5 3.5')
    arrow.setAttribute('fill', 'none')
    arrow.setAttribute('stroke', 'currentColor')
    arrow.setAttribute('stroke-width', '2')
    arrow.setAttribute('stroke-linecap', 'round')
    arrow.setAttribute('stroke-linejoin', 'round')
    return el
  }

  private lane(route: FlowRoute): Lane {
    const key = laneKey(route)
    let lane = this.lanes.get(key)
    if (!lane) {
      const el = this.laneLayer.appendChild(document.createElementNS(NS, 'g'))
      el.setAttribute('class', 'live-route')
      const path = el.appendChild(document.createElementNS(NS, 'path'))
      path.setAttribute('fill', 'none')
      path.setAttribute('stroke', 'none')
      path.setAttribute('class', 'live-lane')
      lane = { route, el, path, mounted: false, active: false, packets: 0, d: '', len: 0 }
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

  /** Dock at the hub's outside edge, aligned with its visible Branch row. */
  private dock(route: FlowRoute): { hub: Rect; y: number } | null {
    const hub = this.rect('hub')
    if (!hub) return null
    let row = route.via ? this.rect(route.via) : null
    const list = row ? this.rect('hub-rows') : null
    if (row && list && (row.y < list.t || row.y > list.b)) row = null
    return { hub, y: row?.y ?? hub.y }
  }

  /** One stable rail in each gutter: adding calls does not fan out the wiring. */
  private rails() {
    const hub = this.rect('hub')
    if (!hub) return { left: 0, right: 0 }
    let fromX = 0
    let toX = this.base!.width
    for (const lane of this.lanes.values()) {
      const from = this.rect(this.scene.origin(lane.route.agent))
      if (from) fromX = Math.max(fromX, from.r)
      const to = lane.route.to ? this.rect(lane.route.to) : null
      if (to) toX = Math.min(toX, to.l)
    }
    return { left: (fromX + hub.l) / 2, right: (hub.r + toX) / 2 }
  }

  /** Logical packet paths jump across cards; visible links share identical legs. */
  private legs(route: FlowRoute, rails: ReturnType<FlowEngine['rails']>): { d: string; parts: string[] } | null {
    const a = this.rect(this.scene.origin(route.agent))
    const dock = this.dock(route)
    if (!a || !dock) return null
    const { hub, y } = dock
    const from = { x: a.r, y: a.y }
    const entry = { x: hub.l, y }
    const parts = [elbow(from, entry, rails.left)]
    const to = route.to ? this.rect(route.to) : null
    if (to) {
      const exit = { x: hub.r, y }
      const end = { x: to.l, y: to.y }
      parts.push(elbow(exit, end, rails.right))
    }
    return { d: parts.join(' '), parts }
  }

  private syncLinks(parts: Map<string, Lane[]>) {
    for (const [d, link] of this.links) {
      if (!parts.has(d)) { link.el.remove(); this.links.delete(d) }
    }
    for (const [d, lanes] of parts) {
      let link = this.links.get(d)
      if (!link) {
        const el = this.linkLayer.appendChild(document.createElementNS(NS, 'g'))
        el.setAttribute('class', 'live-link')
        const path = el.appendChild(document.createElementNS(NS, 'path'))
        path.setAttribute('d', d)
        path.setAttribute('fill', 'none')
        path.setAttribute('stroke-width', '1.25')
        path.setAttribute('stroke-linecap', 'round')
        path.setAttribute('stroke-linejoin', 'round')
        link = { el, path, lanes }
        this.links.set(d, link)
      }
      link.lanes = lanes
    }
    this.emphasize()
  }

  private frame = (now: number) => {
    this.raf = 0
    // Drop finished routes before laying out their shared connections.
    for (const [key, lane] of this.lanes) {
      if (!lane.mounted && !lane.active && lane.packets === 0) {
        lane.el.remove()
        this.lanes.delete(key)
        this.layoutAt = 0
      }
    }
    const layout = this.layoutAt === 0 || now - this.layoutAt >= LAYOUT_MS
    if (layout) {
      this.layoutAt = now
      this.rects.clear()
      this.base = this.root.getBoundingClientRect()
      this.placeGuides()
    }

    const rails = layout ? this.rails() : null
    const links = new Map<string, Lane[]>()
    for (const lane of this.lanes.values()) {
      if (rails) {
        const legs = this.legs(lane.route, rails)
        for (const part of legs?.parts ?? []) links.set(part, [...(links.get(part) ?? []), lane])
        const d = legs?.d ?? ''
        if (d !== lane.d) {
          lane.d = d
          lane.path.setAttribute('d', d)
          lane.len = d ? lane.path.getTotalLength() : 0
        }
      }
      lane.el.toggleAttribute('data-active', lane.active)
    }

    if (rails) this.syncLinks(links)
    else this.emphasize()

    let finished = false
    this.packets = this.packets.filter((packet) => {
      const { path, len } = packet.lane
      const k = Math.min(1, (now - packet.t0) / LEG_MS)
      if (len > 0) {
        const e = ease(k)
        const at = (packet.back ? 1 - e : e) * len
        const p = path.getPointAtLength(at)
        const before = path.getPointAtLength(Math.max(0, at - 1))
        const after = path.getPointAtLength(Math.min(len, at + 1))
        const angle = Math.atan2(after.y - before.y, after.x - before.x) * 180 / Math.PI + (packet.back ? 180 : 0)
        packet.el.setAttribute('visibility', 'visible')
        packet.el.setAttribute('transform', `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)}) rotate(${angle.toFixed(1)})`)
      }
      if (k < 1 && len > 0) return true
      packet.el.remove()
      packet.lane.packets--
      packet.done()
      finished = true
      return false
    })

    // One last frame clears transient lanes and returns mounted ones to rest.
    if (this.packets.length || finished) this.kick()
  }

  /** The tree guides and the resting ghosts: rewritten only when they change. */
  private placeGuides() {
    let tree = ''
    const children = new Map<string, Rect[]>()
    for (const [child, parent] of this.scene.tree) {
      const c = this.rect(child)
      if (c) children.set(parent, [...(children.get(parent) ?? []), c])
    }
    for (const [parent, nodes] of children) {
      const p = this.rect(parent)
      if (!p) continue
      const x = p.l + 14
      const bottom = Math.max(...nodes.map((c) => c.y))
      tree += `M ${x} ${p.b} V ${bottom - 6} `
      for (const c of nodes) tree += `M ${x} ${c.y - 6} Q ${x} ${c.y} ${x + 6} ${c.y} H ${c.l} `
    }
    if (tree !== this.treeD) this.treeEl.setAttribute('d', (this.treeD = tree))

    let ghosts = ''
    for (const [from, to] of this.scene.ghosts ?? []) {
      const f = this.rect(from)
      const t = this.rect(to)
      if (!f || !t) continue
      const a = { x: f.r, y: f.y }
      ghosts += `${elbow(a, { x: t.l, y: t.y }, (a.x + t.l) / 2)} `
    }
    if (ghosts !== this.ghostD) this.ghostEl.setAttribute('d', (this.ghostD = ghosts))
  }
}
