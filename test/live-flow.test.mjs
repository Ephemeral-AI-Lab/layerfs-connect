import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import test, { after, before } from 'node:test'
import ts from 'typescript'

let directory
let FlowEngine
let LEG_MS
let OK_CLASS
let FAIL_CLASS

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'connect-live-flow-test-'))
  const source = await readFile(new URL('../src/renderer/src/components/live/live-flow.ts', import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const file = join(directory, 'live-flow.mjs')
  await writeFile(file, compiled)
  ;({ FlowEngine, LEG_MS, OK_CLASS, FAIL_CLASS } = await import(pathToFileURL(file).href))
})

after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

// The engine needs SVG ownership, anchor lookup and a clock, not a browser renderer.
// A straight, 100px measured path makes the packet's direction observable.
class Element {
  constructor(tag = 'div') {
    this.tagName = tag
    this.children = []
    this.attributes = new Map()
    this.listeners = new Map()
    this.parentElement = null
    this.bounds = { left: 0, top: 0, width: 100, height: 40 }
    const properties = new Map()
    this.style = {
      setProperty: (name, value) => properties.set(name, value),
      getPropertyValue: (name) => properties.get(name) ?? '',
      removeProperty: (name) => properties.delete(name),
    }
    this.classList = {
      contains: (name) => (this.getAttribute('class') ?? '').split(' ').includes(name),
      add: (name) => this.setAttribute('class', `${this.getAttribute('class') ?? ''} ${name}`.trim()),
      remove: (name) => this.setAttribute('class', (this.getAttribute('class') ?? '').split(' ').filter((value) => value !== name).join(' ')),
    }
  }
  get childNodes() { return this.children }
  get lastChild() { return this.children.at(-1) }
  get dataset() { return { anchor: this.getAttribute('data-anchor') } }
  get offsetParent() { return this.parentElement }
  get offsetWidth() { return this.bounds.width }
  appendChild(child) { child.remove(); child.parentElement = this; this.children.push(child); return child }
  remove() {
    if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((child) => child !== this)
    this.parentElement = null
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)) }
  getAttribute(name) { return this.attributes.get(name) ?? null }
  hasAttribute(name) { return this.attributes.has(name) }
  removeAttribute(name) { this.attributes.delete(name) }
  toggleAttribute(name, force) {
    const present = force ?? !this.hasAttribute(name)
    if (present) this.setAttribute(name, '')
    else this.removeAttribute(name)
    return present
  }
  matches(selector) {
    if (selector.startsWith('.')) return this.classList.contains(selector.slice(1))
    const attribute = /^\[([^=\]]+)(?:="(.*)")?\]$/.exec(selector)
    return !!attribute && (attribute[2] === undefined ? this.hasAttribute(attribute[1]) : this.getAttribute(attribute[1]) === attribute[2])
  }
  closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) ?? null }
  contains(node) { return node === this || this.children.some((child) => child.contains(node)) }
  querySelectorAll(selector) { return this.children.flatMap((child) => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]) }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null }
  getBoundingClientRect() { return { ...this.bounds, right: this.bounds.left + this.bounds.width, bottom: this.bounds.top + this.bounds.height } }
  getTotalLength() { return this.getAttribute('d') ? 100 : 0 }
  getPointAtLength(at) { return { x: at, y: 0 } }
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? new Set()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener) }
  emit(type, target = this, relatedTarget = null) {
    for (const listener of this.listeners.get(type) ?? []) listener({ type, target, relatedTarget })
  }
}

function environment(t, reducedMotion = false) {
  let now = 1000
  let nextFrame = 0
  const frames = new Map()
  const observers = []
  const root = new Element()
  root.bounds = { left: 0, top: 0, width: 650, height: 200 }
  const svg = root.appendChild(new Element('svg'))
  const document = { createElementNS: (_namespace, tag) => new Element(tag), activeElement: null }
  const motionQuery = {
    matches: reducedMotion,
    listeners: new Set(),
    addEventListener(type, listener) { if (type === 'change') this.listeners.add(listener) },
    removeEventListener(type, listener) { if (type === 'change') this.listeners.delete(listener) },
  }
  const globals = {
    Element,
    HTMLElement: Element,
    document,
    window: { matchMedia: () => motionQuery },
    CSS: { escape: (value) => value },
    requestAnimationFrame: (callback) => { const id = ++nextFrame; frames.set(id, callback); return id },
    cancelAnimationFrame: (id) => frames.delete(id),
    ResizeObserver: class {
      constructor(callback) { this.callback = callback; observers.push(this) }
      observe() {}
      disconnect() { this.disconnected = true }
    },
  }
  const originals = new Map(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  t.mock.method(performance, 'now', () => now)
  const engines = []
  t.after(() => {
    for (const engine of engines) engine.dispose()
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  })
  const anchor = (name, left, top = 0, parent = root) => {
    const node = parent.appendChild(new Element())
    node.setAttribute('data-anchor', name)
    node.bounds = { left, top, width: 100, height: 40 }
    return node
  }
  const hub = anchor('hub', 220)
  hub.bounds.height = 180
  anchor('hub-rows', 220, 0, hub).bounds.height = 180
  anchor('branch-layout', 220, 40, hub)
  anchor('branch-tests', 220, 100, hub)
  anchor('agent-chat/root', 0, 40)
  anchor('agent-review/root', 0, 100)
  anchor('ws-box:/workspace', 450, 40)
  return {
    root, svg, frames, observers, document, motionQuery,
    engine() { const engine = new FlowEngine(root, svg); engines.push(engine); return engine },
    reduceMotion(matches) {
      motionQuery.matches = matches
      for (const listener of motionQuery.listeners) listener({ matches })
    },
    step(ms = 16) {
      now += ms
      const pending = [...frames.values()]
      frames.clear()
      for (const callback of pending) callback(now)
    },
    packets: () => svg.querySelectorAll('.live-packet'),
    lanes: () => svg.querySelectorAll('.live-route'),
    links: () => svg.querySelectorAll('.live-link'),
    addAnchor: anchor,
    anchor: (name) => root.querySelector(`[data-anchor="${name}"]`),
  }
}

const route = { agent: 'chat/root', via: 'branch-layout', to: 'ws-box:/workspace' }
const otherRoute = { agent: 'review/root', via: 'branch-tests', to: null }
const scene = (overrides = {}) => ({
  origin: (agent) => `agent-${agent}`,
  color: () => 'text-(--icon-accent)',
  mounts: [], active: [], tree: [], ...overrides,
})
const mountedScene = (routes = [route]) => scene({ mounts: routes.map((route, i) => ({ key: String(i), route })) })
const flushPromises = async () => { await Promise.resolve(); await Promise.resolve() }
const linkPath = (link) => link.children[0].getAttribute('d')

// Read the endpoints of the engine's absolute SVG commands independently of its
// rail choices. Control points are included so a curve cannot enter a card.
function geometry(d) {
  let point
  let start
  const points = []
  for (const [, command, values] of d.matchAll(/([MHVQ])\s*([^MHVQ]*)/g)) {
    const numbers = values.trim().split(/\s+/).map(Number)
    if (command === 'M') point = { x: numbers[0], y: numbers[1] }
    if (command === 'H') point = { x: numbers[0], y: point.y }
    if (command === 'V') point = { x: point.x, y: numbers[0] }
    if (command === 'Q') {
      points.push({ x: numbers[0], y: numbers[1] })
      point = { x: numbers[2], y: numbers[3] }
    }
    start ??= point
    points.push(point)
  }
  return { start, end: point, points }
}

test('mounted and active-only lanes stay still without idle animation frames', (t) => {
  const dom = environment(t)
  const engine = dom.engine()
  engine.setScene(mountedScene())
  dom.step()
  assert.equal(dom.lanes().length, 1)
  assert.equal(dom.links().length, 2)
  assert.equal(dom.lanes()[0].children.length, 1)
  assert.equal(dom.lanes()[0].children[0].getAttribute('stroke'), 'none')
  assert.ok(dom.links().every((link) => link.style.getPropertyValue('--route-color') === 'var(--muted-foreground)'))
  assert.equal(dom.frames.size, 0)
  assert.equal(dom.packets().length, 0)
  engine.setScene(scene({ active: [otherRoute] }))
  dom.step()
  assert.equal(dom.lanes().length, 1)
  assert.equal(dom.links().length, 1)
  assert.ok(dom.lanes()[0].hasAttribute('data-active'))
  assert.equal(dom.frames.size, 0)
  engine.setScene(scene())
  dom.step()
  assert.equal(dom.lanes().length, 0)
  assert.equal(dom.links().length, 0)
  assert.equal(dom.frames.size, 0)
})

test('scrolling the branch list updates idle connector positions and falls back when a row leaves view', (t) => {
  const dom = environment(t)
  const engine = dom.engine()
  engine.setScene(mountedScene())
  dom.step()
  const lane = dom.lanes()[0]
  const path = lane.children[0]
  const before = path.getAttribute('d')
  const branch = dom.anchor('branch-layout')
  branch.bounds.left = 240
  branch.bounds.width = 60
  branch.bounds.top += 20
  dom.root.emit('scroll', dom.anchor('hub-rows'))
  dom.step()
  assert.notEqual(path.getAttribute('d'), before)
  let [incoming, outgoing] = dom.links().map((link) => geometry(linkPath(link)))
  assert.deepEqual(incoming.end, { x: 220, y: 80 })
  assert.deepEqual(outgoing.start, { x: 320, y: 80 })
  assert.ok(incoming.points.every(({ x }) => x >= 100 && x <= 220))
  assert.ok(outgoing.points.every(({ x }) => x >= 320 && x <= 450))
  assert.equal((path.getAttribute('d').match(/\bM /g) ?? []).length, 2, 'packet path jumps across the hub instead of drawing through it')
  assert.equal(dom.frames.size, 0)
  branch.bounds.top = -60
  dom.root.emit('scroll', dom.anchor('hub-rows'))
  dom.step()
  ;[incoming, outgoing] = dom.links().map((link) => geometry(linkPath(link)))
  assert.deepEqual(incoming.end, { x: 220, y: 90 })
  assert.deepEqual(outgoing.start, { x: 320, y: 90 })
  assert.equal(dom.frames.size, 0)
})

test('agents sharing a branch and workspace keep independent routes but one visible output link', (t) => {
  const dom = environment(t)
  const engine = dom.engine()
  const shared = { ...route, agent: 'review/root' }
  engine.setScene(mountedScene([route, shared]))
  dom.step()
  assert.equal(dom.lanes().length, 2)
  assert.equal(dom.links().length, 3)
  const outgoing = dom.links().filter((link) => geometry(linkPath(link)).start.x === 320)
  assert.equal(outgoing.length, 1)
  assert.deepEqual(geometry(linkPath(outgoing[0])).end, { x: 450, y: 60 })
  assert.ok(dom.links().every((link) => link.children.length === 1))
  assert.equal(new Set(dom.links().map(linkPath)).size, 3)
  assert.ok(dom.links().some((link) => linkPath(link).includes(' Q ')), 'vertical changes use rounded elbows')
  assert.ok(dom.lanes().every((lane) => lane.children[0].getAttribute('stroke') === 'none'))
  assert.equal(dom.packets().length, 0)
  assert.equal(dom.frames.size, 0)
})

test('folded agents share both physical legs, then expand without losing their logical routes', (t) => {
  const dom = environment(t)
  const engine = dom.engine()
  const shared = { ...route, agent: 'review/root' }
  const folded = dom.addAnchor('session-folded', 20, 100)
  folded.bounds.width = 120
  engine.setScene({ ...mountedScene([route, shared]), origin: () => 'session-folded' })
  dom.step()
  assert.equal(dom.lanes().length, 2)
  assert.equal(dom.links().length, 2)
  const outgoing = dom.links().find((link) => geometry(linkPath(link)).start.x === 320)
  const incoming = dom.links().find((link) => geometry(linkPath(link)).start.x === 140)
  assert.deepEqual(geometry(linkPath(incoming)).start, { x: 140, y: 120 })
  assert.equal(dom.lanes()[0].children[0].getAttribute('d'), dom.lanes()[1].children[0].getAttribute('d'))
  engine.setScene(mountedScene([route, shared]))
  dom.step()
  assert.equal(dom.lanes().length, 2)
  assert.equal(dom.links().length, 3)
  assert.ok(dom.links().includes(outgoing), 'unchanged shared output is retained while origins expand')
  assert.equal(incoming.parentElement, null)
  assert.equal(dom.packets().length, 0)
  assert.equal(dom.frames.size, 0)
})

test('adding another branch and workspace leaves existing gutter routes in place', (t) => {
  const dom = environment(t)
  const engine = dom.engine()
  dom.addAnchor('ws-box:/review', 450, 100)
  dom.anchor('branch-layout').bounds.top = 70
  engine.setScene(mountedScene())
  dom.step()
  const original = [...dom.links()]
  const paths = original.map(linkPath)
  assert.ok(paths.every((path) => path.includes(' Q ')), 'both existing legs turn before other destinations are added')
  const logicalPath = dom.lanes()[0].children[0].getAttribute('d')
  const additional = { ...otherRoute, to: 'ws-box:/review' }
  engine.setScene(mountedScene([route, additional]))
  dom.step()
  assert.equal(dom.links().length, 4)
  assert.ok(original.every((link) => dom.links().includes(link)))
  assert.deepEqual(original.map(linkPath), paths)
  assert.equal(dom.lanes()[0].children[0].getAttribute('d'), logicalPath)
  engine.setScene(mountedScene())
  dom.step()
  assert.deepEqual(dom.links(), original)
  assert.deepEqual(dom.links().map(linkPath), paths)
  assert.equal(dom.frames.size, 0)
})

test('folding a session moves its existing route to the session anchor without replaying a call', (t) => {
  const dom = environment(t)
  const engine = dom.engine()
  engine.setScene(mountedScene())
  dom.step()
  const path = dom.lanes()[0].children[0]
  assert.match(path.getAttribute('d'), /^M 100 60 /)
  const folded = dom.root.appendChild(new Element())
  folded.setAttribute('data-anchor', 'session-chat')
  folded.bounds = { left: 20, top: 100, width: 120, height: 40 }
  engine.setScene({ ...mountedScene(), origin: () => 'session-chat' })
  dom.step()
  assert.equal(dom.lanes().length, 1)
  assert.match(path.getAttribute('d'), /^M 140 120 /)
  assert.equal(dom.packets().length, 0)
  assert.equal(dom.frames.size, 0)
  engine.setScene(mountedScene())
  dom.step()
  assert.match(path.getAttribute('d'), /^M 100 60 /)
})

test('calls use one directional chevron and return in outcome color without changing lane width', async (t) => {
  const dom = environment(t)
  const engine = dom.engine()
  engine.setScene(mountedScene())
  dom.step()
  const forward = engine.send(route)
  dom.step(LEG_MS / 2)
  const packet = dom.packets()[0]
  assert.equal(dom.packets().length, 1)
  assert.equal(packet.children.length, 1)
  assert.match(packet.children[0].getAttribute('d'), /L/)
  assert.match(packet.getAttribute('transform'), /rotate\(0(?:\.0+)?\)/)
  assert.match(packet.getAttribute('class'), /text-\(--icon-accent\)/)
  const widths = dom.links().map((link) => link.children[0].getAttribute('stroke-width'))
  assert.deepEqual(widths, ['1.25', '1.25'])
  dom.step(LEG_MS)
  await forward
  assert.equal(dom.packets().length, 0)
  for (const color of [OK_CLASS, FAIL_CLASS]) {
    const back = engine.send(route, { back: true, color })
    dom.step(LEG_MS / 2)
    assert.match(dom.packets()[0].getAttribute('class'), new RegExp(color))
    assert.match(dom.packets()[0].getAttribute('transform'), /rotate\((?:180|-180)(?:\.0+)?\)/)
    assert.deepEqual(dom.links().map((link) => link.children[0].getAttribute('stroke-width')), widths)
    dom.step(LEG_MS)
    await back
  }
  dom.step()
  assert.equal(dom.frames.size, 0)
  assert.equal(dom.anchor('hub').classList.contains('live-flash'), false)
  assert.equal(dom.anchor('branch-layout').classList.contains('live-flash'), false)
})

test('concurrent traffic shares one packet per lane and waits before reversing direction', async (t) => {
  const dom = environment(t)
  const engine = dom.engine()
  engine.setScene(mountedScene())
  dom.step()
  const first = engine.send(route)
  const same = engine.send(route)
  const back = engine.send(route, { back: true, color: OK_CLASS })
  assert.equal(dom.packets().length, 1)
  dom.step(LEG_MS / 2)
  assert.match(dom.packets()[0].getAttribute('transform'), /rotate\(0(?:\.0+)?\)/)
  dom.step(LEG_MS)
  await Promise.all([first, same])
  await flushPromises()
  dom.step(LEG_MS / 2)
  assert.equal(dom.packets().length, 1)
  assert.match(dom.packets()[0].getAttribute('transform'), /rotate\((?:180|-180)(?:\.0+)?\)/)
  const failed = engine.send(route, { back: true, color: FAIL_CLASS })
  const success = engine.send(route, { back: true, color: OK_CLASS })
  assert.equal(dom.packets().length, 1)
  assert.match(dom.packets()[0].getAttribute('class'), new RegExp(FAIL_CLASS))
  dom.step(LEG_MS)
  await Promise.all([back, failed, success])
  assert.equal(dom.packets().length, 0)
})

test('reduced motion keeps calls static and never starts a packet animation loop', async (t) => {
  const dom = environment(t, true)
  const engine = dom.engine()
  engine.setScene(scene({ active: [route] }))
  dom.step()
  await engine.send(route)
  await engine.send(route, { back: true, color: FAIL_CLASS })
  dom.step()
  assert.equal(dom.packets().length, 0)
  assert.equal(dom.frames.size, 0)
  assert.equal(dom.lanes().length, 1)
})

test('enabling reduced motion settles active and queued packets immediately without replaying them later', async (t) => {
  const dom = environment(t)
  const engine = dom.engine()
  engine.setScene(scene({ active: [route] }))
  dom.step()
  const outward = engine.send(route)
  const returning = engine.send(route, { back: true, color: OK_CLASS })
  dom.step(LEG_MS / 3)
  assert.equal(dom.packets().length, 1)
  dom.reduceMotion(true)
  assert.equal(dom.packets().length, 0)
  await Promise.all([outward, returning])
  assert.ok(dom.frames.size <= 1)
  dom.step()
  assert.equal(dom.frames.size, 0)
  assert.equal(dom.lanes().length, 1)
  assert.ok(dom.lanes()[0].hasAttribute('data-active'))
  dom.reduceMotion(false)
  dom.step()
  assert.equal(dom.packets().length, 0)
  assert.equal(dom.frames.size, 0)
  const next = engine.send(route)
  dom.step(LEG_MS / 3)
  assert.equal(dom.packets().length, 1)
  dom.step(LEG_MS)
  await next
  dom.step()
  assert.equal(dom.packets().length, 0)
  assert.equal(dom.frames.size, 0)
})

test('hover and keyboard focus emphasize related routes and restore the others on exit', (t) => {
  const dom = environment(t)
  const engine = dom.engine()
  engine.setScene(mountedScene([route, otherRoute]))
  dom.step()
  const [related, other] = dom.lanes()
  const branch = dom.anchor('branch-layout')
  const child = branch.appendChild(new Element('button'))
  dom.root.emit('pointerover', child)
  dom.step()
  assert.ok(related.hasAttribute('data-related'))
  assert.ok(other.hasAttribute('data-dimmed'))
  dom.root.emit('pointerleave')
  dom.step()
  assert.equal(other.hasAttribute('data-dimmed'), false)
  dom.root.emit('pointerover', dom.anchor('branch-tests'))
  assert.ok(related.hasAttribute('data-dimmed'))
  dom.document.activeElement = child
  dom.root.emit('focusin', child)
  dom.step()
  assert.ok(related.hasAttribute('data-related'))
  assert.ok(other.hasAttribute('data-dimmed'))
  dom.document.activeElement = null
  dom.root.emit('focusout', child, null)
  dom.step()
  assert.equal(related.hasAttribute('data-related'), false)
  assert.equal(other.hasAttribute('data-dimmed'), false)
})

test('a shared link follows either related agent and paints highlighted routes above quiet links', (t) => {
  const dom = environment(t)
  const engine = dom.engine()
  dom.addAnchor('agent-audit/root', 0, 160)
  const shared = { ...route, agent: 'review/root' }
  const unrelated = { ...otherRoute, agent: 'audit/root' }
  const colors = { 'chat/root': 'text-(--lane-1)', 'review/root': 'text-(--lane-2)', 'audit/root': 'text-(--lane-3)' }
  const routes = { ...mountedScene([route, shared, unrelated]), color: (agent) => colors[agent] }
  engine.setScene({ ...routes, active: [shared] })
  dom.step()
  const links = dom.links()
  assert.equal(links.length, 4)
  const output = links.find((link) => geometry(linkPath(link)).start.x === 320)
  assert.equal(output.style.getPropertyValue('--route-color'), 'var(--lane-2)')
  assert.ok(output.hasAttribute('data-active'))

  const assertPaintOrder = () => {
    const priority = (link) => link.hasAttribute('data-related') ? 2 : link.hasAttribute('data-active') ? 1 : 0
    const priorities = dom.links().map(priority)
    assert.deepEqual(priorities, [...priorities].sort((a, b) => a - b))
    assert.equal(new Set(dom.links()).size, 4, 'reordering moves existing SVG groups rather than duplicating them')
  }
  assertPaintOrder()
  for (const agent of ['chat/root', 'review/root']) {
    dom.root.emit('pointerover', dom.anchor(`agent-${agent}`))
    assert.ok(output.hasAttribute('data-related'))
    assert.equal(output.hasAttribute('data-dimmed'), false)
    assert.equal(output.style.getPropertyValue('--route-color'), `var(${agent === 'chat/root' ? '--lane-1' : '--lane-2'})`)
    assert.equal(dom.links().filter((link) => link.hasAttribute('data-related')).length, 2)
    assertPaintOrder()
  }
  dom.root.emit('pointerover', dom.anchor('branch-layout'))
  assert.equal(dom.links().filter((link) => link.hasAttribute('data-related')).length, 3)
  assert.equal(dom.links().filter((link) => link.hasAttribute('data-dimmed')).length, 1)
  assertPaintOrder()
  const workspace = dom.anchor(route.to)
  dom.document.activeElement = workspace
  dom.root.emit('focusin', workspace)
  assert.ok(output.hasAttribute('data-related'))
  assert.equal(dom.links().filter((link) => link.hasAttribute('data-related')).length, 3)
  assertPaintOrder()
  dom.document.activeElement = null
  dom.root.emit('focusout', workspace, null)
  assert.ok(dom.links().every((link) => !link.hasAttribute('data-dimmed') && !link.hasAttribute('data-related')))
  assert.equal(output.style.getPropertyValue('--route-color'), 'var(--lane-2)')
  engine.setScene(routes)
  dom.step()
  assert.ok(dom.links().includes(output))
  assert.ok(dom.links().every((link) => !link.hasAttribute('data-active') && link.style.getPropertyValue('--route-color') === 'var(--muted-foreground)'))
  assert.equal(dom.frames.size, 0)
})

test('transient traffic removes only its unused links after settling, retaining the shared mounted output', async (t) => {
  const dom = environment(t)
  const engine = dom.engine()
  engine.setScene(mountedScene())
  dom.step()
  const mounted = [...dom.links()]
  const shared = { ...route, agent: 'review/root' }
  const sending = engine.send(shared)
  dom.step(LEG_MS / 2)
  assert.equal(dom.lanes().length, 2)
  assert.equal(dom.links().length, 3)
  assert.ok(mounted.every((link) => dom.links().includes(link)))
  const transient = dom.links().find((link) => !mounted.includes(link))
  dom.step(LEG_MS)
  await sending
  dom.step()
  assert.equal(dom.lanes().length, 1)
  assert.equal(dom.links().length, 2)
  assert.ok(mounted.every((link) => dom.links().includes(link)))
  assert.equal(transient.parentElement, null)
  assert.equal(dom.packets().length, 0)
  assert.equal(dom.frames.size, 0)
  engine.setScene(scene())
  dom.step()
  assert.equal(dom.links().length, 0)
  assert.ok(mounted.every((link) => !link.parentElement))
  assert.equal(dom.lanes().length, 0)
  assert.equal(dom.frames.size, 0)
})

test('siblings share one tree trunk and removed children leave no guide behind', (t) => {
  const dom = environment(t)
  const engine = dom.engine()
  dom.addAnchor('tree-parent', 0, 0)
  dom.addAnchor('tree-one', 30, 60)
  dom.addAnchor('tree-two', 30, 120)
  engine.setScene(scene({ tree: [['tree-one', 'tree-parent'], ['tree-two', 'tree-parent']] }))
  dom.step()
  const tree = dom.svg.querySelector('.live-tree')
  assert.equal((tree.getAttribute('d').match(/\bV /g) ?? []).length, 1)
  assert.equal((tree.getAttribute('d').match(/\bQ /g) ?? []).length, 2)
  engine.setScene(scene())
  dom.step()
  assert.equal(tree.getAttribute('d'), '')
  assert.equal(dom.frames.size, 0)
})

test('dispose resolves traffic, removes its own layers and listeners, and leaves another engine intact', async (t) => {
  const dom = environment(t)
  const first = dom.engine()
  first.setScene(mountedScene())
  dom.step()
  const pending = first.send(route)
  const returning = first.send(route, { back: true, color: OK_CLASS })
  const firstLayers = [...dom.svg.children]
  assert.equal(firstLayers.length, 5, 'ghosts, tree, visible links, logical lanes, packets')
  const second = dom.engine()
  const secondLayers = dom.svg.children.slice(firstLayers.length)
  assert.equal(secondLayers.length, 5)
  second.setScene(mountedScene([otherRoute]))
  dom.step()
  const secondLinks = secondLayers.flatMap((layer) => layer.querySelectorAll('.live-link'))
  assert.equal(secondLinks.length, 1)
  first.dispose()
  await Promise.all([pending, returning])
  assert.deepEqual(dom.svg.children, secondLayers)
  assert.deepEqual(dom.links(), secondLinks)
  assert.ok(firstLayers.every((layer) => !layer.parentElement))
  assert.equal(dom.observers[0].disconnected, true)
  assert.equal(dom.observers[1].disconnected, undefined)
  assert.equal(dom.motionQuery.listeners.size, 1)
  for (const listeners of dom.root.listeners.values()) assert.equal(listeners.size, 1)
  await first.send(route)
  first.dispose()
  assert.deepEqual(dom.svg.children, secondLayers)
  second.dispose()
  assert.equal(dom.svg.children.length, 0)
  assert.equal(dom.frames.size, 0)
  assert.equal(dom.motionQuery.listeners.size, 0)
  for (const listeners of dom.root.listeners.values()) assert.equal(listeners.size, 0)
})
