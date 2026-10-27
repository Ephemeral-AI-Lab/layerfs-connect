// The game world: an island with main's building at its centre and a plot
// for each open Branch around it, worked by the website's heroes.
//
//   fork     a new plot pops up, a road draws itself from where the Branch
//            forked (its parent's plot, or the castle gate), and the
//            Branch's hero walks down it
//   commit   the hero hammers and a block drops onto the plot's stack
//   merge    the merged-in Branch's hero carries a crate to the other plot,
//            where it lands as a gold-banded block; a Branch that ends there
//            packs up its plot
//   publish  (3 s) the Branch's hero and two helpers carry its blocks to the
//            building, raise a scaffold, hammer the Layer's new piece into
//            place, take the scaffold down and cheer under fireworks; the plot
//            is cleared
//   renew    when a publish crosses into the next tier, the builders first
//            take the old building down under a scaffold and raise the new,
//            bigger one in its place (its heritage stones keep every older
//            Layer's colour), then build the new Layer's piece on it
//
// The world keeps a model (plots, their stacks, the Layers, the tier) apart
// from what is drawn. An instant event (opening on the present, a seek, a
// time-lapse replay of a huge history) changes only the model; `flush` then
// brings the drawing up to date once, so 100,000 events cost one rebuild.
// An animated event flushes first, then animates on top of the drawing.
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'

import { buildCastle, disposeCastleAssets, makeScaffold, renewalLine, tierIndexFor, tierOf } from './castle'
import { disposeHeroAssets, HERO_NAMES, heroNameFor, makeHero, makeProp } from './heroes'
import { CREAM, DIRT, GOLD, GRASS, GRASS_DARK, ROSE, SAND, TIMBER, WATER, colorOf, hashOf, hex, lighter } from './palette'
import { Particles } from './particles'
import { ProxyPool, releaseProxies } from './pool'
import { Timeline, ease, lerp, span } from './timeline'
import type { CastleBuild, CastlePiece, CastleTier, GameEvent, GameEventKind, Hero, LayerPaint } from './types'

// ---- tuning ---------------------------------------------------------------------

/** Seconds (at 1×) until the next event may start: commits overlap, a publish is watched whole. */
export const LEAD: Record<GameEventKind, number> = { commit: 0.2, fork: 0.5, merge: 0.65, publish: 3 }
export const PUBLISH_S = 3
export const RENEW_S = 2.6
const RING_GAP = 2.5
const RING_CAP = (r: number) => 10 + 6 * r
const STACK_MAX = 36
const BLOCK = 0.27
/** Heroes standing at plots, at most: past this, plots keep only their flags. */
const MAX_HEROES = 64
/** Past this many heroes, they are drawn with the cheaper voxels. */
const LOW_DETAIL_AT = 40
/** In a time-lapse, the castle is rebuilt at most this often (ms of wall time). */
const REBUILD_MS = 120

/** Any tier, however far the castle has grown: there is no last one. */
export const tierAt = (i: number): CastleTier => tierOf(i)

export interface WorldNote {
  kind: GameEventKind | 'renew'
  text: string
  color: string
}

/** What pointing at something shows. */
export interface PickInfo {
  kind: 'branch' | 'layer' | 'castle'
  title: string
  lines: string[]
  color: string
  branch?: string
}

interface Worker {
  hero: Hero
  /** home: stands by its plot (or the castle); script: the timeline moves it. */
  mode: 'home' | 'script'
  plot?: Plot
  /** A castle crew member's place around the building. */
  crewAngle?: number
}

interface Road {
  mesh: THREE.Mesh
  from: () => THREE.Vector3
  to: () => THREE.Vector3
  grown: number
}

/** What is drawn for a plot. */
interface PlotVis {
  group: THREE.Group
  flag: THREE.Group
  stack: THREE.Group
  blocks: THREE.Object3D[]
  road?: Road
}

interface Plot {
  name: string
  color: THREE.Color
  slot: number
  /** The Branch it forked from, when that one had a plot. */
  parent?: string
  by?: string
  /** Its stack, oldest first: true for a merged-in block. Capped at STACK_MAX. */
  kinds: boolean[]
  commits: number
  merges: number
  /** Where it is drawn now (slides when the castle grows). */
  pos: THREE.Vector3
  vis?: PlotVis
  worker?: Worker
  /** Being packed up (animated): no longer in the model. */
  closing: boolean
}

const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z)
const facing = (from: THREE.Vector3, to: THREE.Vector3) => Math.atan2(to.x - from.x, to.z - from.z)

export class CastleWorld {
  readonly root = new THREE.Group()
  readonly tl = new Timeline()
  /** Where the action is: the camera drifts towards it. */
  readonly focus = v3(0, 1, 0)
  /** How close the camera wants to be: 1 shows the whole island, less moves in on the action. */
  zoom = 1
  /** While moved in: the side to look from (an angle around the island), or null for any. */
  look: number | null = null
  onNote?: (n: WorldNote) => void

  private particles = new Particles()
  private castle!: CastleBuild
  private builtLayers = -1
  private builtTier = -1
  private lastBuild = 0
  private tier = 0
  private layers: LayerPaint[] = []
  private layerBy: string[] = []
  private plots = new Map<string, Plot>()
  private workers = new Set<Worker>()
  private crew: Worker[] = []
  private used = new Set<number>()
  // what flush() still has to draw
  private dirty = new Set<Plot>()
  private doomed: Plot[] = []
  private layoutDirty = false
  private island = new THREE.Group()
  private islandR = 6
  private trees = new THREE.Group()
  private clouds = new THREE.Group()
  private keep: { dispose: () => void }[] = []
  private mats = new Map<string, THREE.MeshStandardMaterial>()
  private block: THREE.BufferGeometry
  private pad: THREE.BufferGeometry
  private dark: boolean
  /** Batches: every block, post and flag part; the shore's trees and rocks; the clouds. */
  private vox: ProxyPool
  private pools: ProxyPool[] = []

  constructor(dark: boolean) {
    this.dark = dark
    this.block = this.own(new RoundedBoxGeometry(BLOCK, BLOCK, BLOCK, 2, 0.05))
    this.pad = this.own(new RoundedBoxGeometry(1.7, 0.14, 1.7, 2, 0.06))
    this.root.add(this.island, this.trees, this.clouds, this.particles.mesh)
    this.vox = this.pool(this.block, this.own(new THREE.MeshStandardMaterial({ roughness: 0.6 })))
    this.makeIsland()
    this.reset()
  }

  private pool(geo: THREE.BufferGeometry, mat: THREE.Material, shadow = true) {
    const p = new ProxyPool(geo, mat, this.root, shadow)
    this.pools.push(p)
    return p
  }

  /** A block-shaped thing in the batch, in `color`, at `x, y, z`, scaled `sx, sy, sz` (in blocks). */
  private voxel(color: THREE.Color | number, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1) {
    const o = this.vox.add(new THREE.Color(color))
    o.position.set(x, y, z)
    o.scale.set(sx, sy, sz)
    return o
  }

  // ---- shared bits ----

  private own<T extends { dispose: () => void }>(x: T): T {
    this.keep.push(x)
    return x
  }

  private paint(color: THREE.Color | number, o: { rough?: number; glow?: number; opacity?: number } = {}) {
    const c = new THREE.Color(color)
    const key = `${c.getHexString()}:${o.rough ?? 0.6}:${o.glow ?? 0}:${o.opacity ?? 1}`
    let m = this.mats.get(key)
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color: c, roughness: o.rough ?? 0.6, emissive: o.glow ? c : new THREE.Color(0), emissiveIntensity: o.glow ?? 0, transparent: (o.opacity ?? 1) < 1, opacity: o.opacity ?? 1 })
      this.mats.set(key, m)
    }
    return m
  }

  private note(kind: WorldNote['kind'], text: string, color: THREE.Color | string) {
    this.onNote?.({ kind, text, color: typeof color === 'string' ? color : hex(color) })
  }

  private heroFor(by: string | undefined, key: string) {
    const base = by?.replace(/-\d+$/, '')
    return base && HERO_NAMES.includes(base) ? base : heroNameFor(key)
  }

  private spawn(name: string, at: THREE.Vector3, tint?: THREE.Color, scale = 1): Worker {
    const hero = makeHero(name, { scale, tint })
    if (this.workers.size >= LOW_DETAIL_AT) (hero as Hero & { detail?: 'high' | 'low' }).detail = 'low'
    hero.root.position.copy(at)
    this.root.add(hero.root)
    const w: Worker = { hero, mode: 'script' }
    this.workers.add(w)
    return w
  }

  private despawn(w: Worker) {
    this.workers.delete(w)
    w.hero.root.removeFromParent()
    w.hero.dispose()
    if (w.plot?.worker === w) w.plot.worker = undefined
    w.plot = undefined
  }

  /** Walk (or carry) from where it stands to `to`, starting `delay` from now. */
  private walk(w: Worker, to: THREE.Vector3, delay: number, dur: number, pose: 'walk' | 'carry' = 'walk', done?: () => void) {
    let from: THREE.Vector3 | null = null
    this.tl.tween(
      delay,
      dur,
      (p) => {
        if (!from) {
          from = w.hero.root.position.clone()
          w.mode = 'script'
          w.hero.pose = pose
          w.hero.root.rotation.y = facing(from, to)
        }
        const k = ease.inOut(p)
        w.hero.root.position.set(lerp(from.x, to.x, k), 0, lerp(from.z, to.z, k))
      },
      () => {
        w.hero.pose = 'idle'
        done?.()
      },
    )
  }

  private pose(w: Worker, pose: Hero['pose'], delay: number, dur: number, look?: THREE.Vector3) {
    this.tl.tween(
      delay,
      dur,
      () => {
        w.mode = 'script'
        w.hero.pose = pose
        if (look) w.hero.root.rotation.y = facing(w.hero.root.position, look)
      },
      () => {
        if (w.hero.pose === pose) w.hero.pose = 'idle'
      },
    )
  }

  // ---- the island ----

  private makeIsland() {
    const disc = this.own(new THREE.CylinderGeometry(1, 1.04, 1, 96))
    const top = new THREE.Mesh(disc, this.paint(this.dark ? GRASS_DARK : GRASS, { rough: 0.95 }))
    top.position.y = -0.25
    top.scale.set(1, 0.5, 1)
    top.receiveShadow = true
    const sand = new THREE.Mesh(disc, this.paint(SAND, { rough: 0.95 }))
    sand.position.y = -0.42
    sand.scale.set(1.06, 0.5, 1.06)
    sand.receiveShadow = true
    const cliff = new THREE.Mesh(this.own(new THREE.CylinderGeometry(1, 0.82, 1, 96)), this.paint(DIRT, { rough: 1 }))
    cliff.position.y = -1.15
    cliff.scale.set(1.02, 1.1, 1.02)
    const water = new THREE.Mesh(this.own(new THREE.CylinderGeometry(1, 1, 1, 96)), this.paint(this.dark ? 0x3f7fb8 : WATER, { rough: 0.45, opacity: 0.9 }))
    water.position.y = -0.62
    water.scale.set(1.5, 0.2, 1.5)
    water.receiveShadow = true
    top.userData.radial = 1
    sand.userData.radial = 1.06
    cliff.userData.radial = 1.02
    water.userData.radial = 1.5
    this.island.add(top, sand, cliff, water)

    // trees and rocks along the shore, placed by angle (moved when the island grows)
    const flat = this.own(new THREE.MeshStandardMaterial({ roughness: 0.85, flatShading: true }))
    const trunk = this.pool(this.own(new THREE.CylinderGeometry(0.08, 0.11, 0.5, 8)), flat)
    const crown = this.pool(this.own(new THREE.IcosahedronGeometry(0.42, 0)), flat)
    const cone = this.pool(this.own(new THREE.ConeGeometry(0.42, 1, 8)), flat)
    const rock = this.pool(this.own(new THREE.DodecahedronGeometry(0.22, 0)), flat)
    const leaf = [0x5fbf6a, 0x7fd67a, 0x4aa86a, 0x9bd65a].map((c) => new THREE.Color(c))
    for (let i = 0; i < 40; i++) {
      const h = hashOf(`tree${i}`)
      const a = (i / 40) * Math.PI * 2 + ((h % 100) / 100) * 0.12
      const g = new THREE.Group()
      const s = 0.8 + ((h >> 8) % 60) / 100
      if (i % 5 === 4) {
        const r = rock.add(new THREE.Color(0xc9c1b4))
        r.position.y = 0.12
        r.scale.set(1.3, 0.8, 1)
        g.add(r)
      } else {
        const t = trunk.add(new THREE.Color(TIMBER))
        t.position.y = 0.25
        const pine = i % 3 === 0
        const c = (pine ? cone : crown).add(leaf[h % leaf.length])
        c.position.y = pine ? 0.95 : 0.78
        g.add(t, c)
      }
      g.userData = { angle: a, inset: 0.75 + ((h >> 4) % 50) / 100, size: s }
      this.trees.add(g)
    }

    // clouds drifting above
    const puff = this.pool(this.own(new THREE.IcosahedronGeometry(1, 1)), this.own(new THREE.MeshStandardMaterial({ roughness: 1, emissive: 0xffffff, emissiveIntensity: 0.05 })), false)
    for (let i = 0; i < 6; i++) {
      const c = new THREE.Group()
      for (let k = 0; k < 4; k++) {
        const m = puff.add(new THREE.Color(0xffffff))
        m.position.set(k * 0.9 - 1.3, (k % 2) * 0.25, (k % 3) * 0.3)
        m.scale.setScalar(0.7 + (k % 2) * 0.35)
        c.add(m)
      }
      c.userData = { angle: i * 1.1, r: 4 + (i % 3) * 3, y: 8 + (i % 2) * 2.5, speed: 0.012 + i * 0.002 }
      this.clouds.add(c)
    }
  }

  private setIsland(r: number) {
    this.islandR = r
    for (const m of this.island.children) {
      const k = m.userData.radial as number | undefined
      if (k) m.scale.set(r * k, m.scale.y, r * k)
    }
    // the shore's trees grow with a big island, so it never looks bare
    const grow = Math.max(1, r / 14)
    for (const t of this.trees.children) {
      const { angle, inset, size } = t.userData as { angle: number; inset: number; size: number }
      t.position.set(Math.cos(angle) * (r - inset * grow), 0, Math.sin(angle) * (r - inset * grow))
      t.scale.setScalar(size * grow)
    }
    for (const c of this.clouds.children) c.scale.setScalar(0.75 * grow)
  }

  /** The island's radius for the plots in use and the current tier. */
  private wantIsland() {
    let rings = 0
    for (const p of this.plots.values()) rings = Math.max(rings, this.ringOf(p.slot))
    return this.innerR() + rings * RING_GAP + 2.4
  }

  // ---- plots: the model ----

  private innerR() {
    return Math.max(4.4, tierAt(this.tier).radius + 2.8)
  }

  private ringOf(slot: number) {
    let r = 0
    let s = slot
    while (s >= RING_CAP(r)) s -= RING_CAP(r++)
    return r
  }

  /** Where slot `slot` is: rings around the building, spread so neighbours fill evenly. */
  private slotPos(slot: number, inner = this.innerR()) {
    let r = 0
    let s = slot
    while (s >= RING_CAP(r)) s -= RING_CAP(r++)
    const cap = RING_CAP(r)
    let step = Math.round(cap * 0.382)
    while (gcd(step, cap) !== 1) step++
    const a = (((s * step) % cap) / cap) * Math.PI * 2 + r * 0.33 + 0.5
    const R = inner + r * RING_GAP
    return v3(Math.cos(a) * R, 0, Math.sin(a) * R)
  }

  private freeSlot() {
    let s = 0
    while (this.used.has(s)) s++
    this.used.add(s)
    return s
  }

  /** The castle's gate towards `p`. */
  private gate(p: THREE.Vector3) {
    return v3(p.x, 0, p.z).setLength(tierAt(this.tier).radius + 0.4)
  }

  private newPlot(name: string, parent: string | undefined, by: string | undefined): Plot {
    const old = this.plots.get(name)
    if (old) this.dropPlot(old)
    const slot = this.freeSlot()
    const p: Plot = { name, color: colorOf(name), slot, parent: parent && this.plots.has(parent) ? parent : undefined, by, kinds: [], commits: 0, merges: 0, pos: this.slotPos(slot), closing: false }
    this.plots.set(name, p)
    this.dirty.add(p)
    return p
  }

  /** Takes a plot out of the model at once; its drawing goes at the next flush. */
  private dropPlot(p: Plot) {
    if (this.plots.get(p.name) === p) this.plots.delete(p.name)
    this.used.delete(p.slot)
    this.dirty.delete(p)
    if (p.vis || p.worker) this.doomed.push(p)
  }

  private stackOn(p: Plot, merge: boolean) {
    p.commits++
    if (merge) p.merges++
    if (p.kinds.length < STACK_MAX) p.kinds.push(merge)
    this.dirty.add(p)
  }

  // ---- plots: the drawing ----

  private drawPlot(p: Plot): PlotVis {
    if (p.vis) return p.vis
    const group = new THREE.Group()
    group.position.copy(p.pos)
    group.rotation.y = Math.atan2(p.pos.x, p.pos.z) // its front faces out, towards the viewer
    const pad = new THREE.Mesh(this.pad, this.paint(lighter(p.color, 0.55), { rough: 0.9 }))
    pad.position.y = 0.04
    pad.receiveShadow = true
    pad.userData.pick = p.name
    // four little fence posts, and a flag on a pole at the back
    for (const [x, z] of [
      [-0.78, -0.78],
      [0.78, -0.78],
      [-0.78, 0.78],
      [0.78, 0.78],
    ])
      group.add(this.voxel(TIMBER, x, 0.24, z, 0.35, 1.1, 0.35))
    const flag = new THREE.Group()
    flag.position.set(-0.62, 0.1, -0.62)
    flag.add(this.voxel(CREAM, 0, 0.73, 0, 0.16, 5.4, 0.16), this.voxel(p.color, 0.27, 1.27, 0, 1.9, 1.1, 0.12), this.voxel(GOLD, 0, 1.48, 0, 0.35, 0.35, 0.35))
    const stack = new THREE.Group()
    stack.position.set(0.18, 0.11, 0.1)
    group.add(pad, flag, stack)
    this.root.add(group)
    const parent = p.parent ? this.plots.get(p.parent) : undefined
    const road = this.makeRoad(p.color, parent ? () => parent.pos.clone() : () => this.gate(p.pos), () => p.pos.clone())
    p.vis = { group, flag, stack, blocks: [], road }
    return p.vis
  }

  private stackSlot(i: number) {
    const k = i % 9
    return v3(((k % 3) - 1) * (BLOCK + 0.02), BLOCK / 2 + Math.floor(i / 9) * BLOCK, (Math.floor(k / 3) - 1) * (BLOCK + 0.02))
  }

  /** Draws the stack's blocks the model has and the drawing lacks; returns the newest drawn. */
  private drawStack(p: Plot): THREE.Object3D | null {
    const vis = this.drawPlot(p)
    let last: THREE.Object3D | null = null
    while (vis.blocks.length < p.kinds.length) {
      const i = vis.blocks.length
      const at = this.stackSlot(i)
      const m = this.voxel(i % 2 ? lighter(p.color, 0.15) : p.color, at.x, at.y, at.z)
      // a merged-in block wears a gold band
      if (p.kinds[i]) m.add(this.voxel(GOLD, 0, 0, 0, 1.08, 0.3, 1.08))
      vis.stack.add(m)
      vis.blocks.push(m)
      last = m
    }
    return last
  }

  private drawWorker(p: Plot) {
    if (p.worker || this.heroesAtPlots() >= MAX_HEROES) return
    const w = this.spawn(this.heroFor(p.by, p.name), this.homeOf(p), p.color)
    w.mode = 'home'
    w.plot = p
    p.worker = w
  }

  private heroesAtPlots() {
    let n = 0
    for (const p of this.plots.values()) if (p.worker) n++
    return n
  }

  private undraw(p: Plot) {
    if (p.vis) {
      releaseProxies(p.vis.group)
      p.vis.group.removeFromParent()
      if (p.vis.road) this.dropRoad(p.vis.road)
      p.vis = undefined
    }
    if (p.worker) this.despawn(p.worker)
  }

  /** Where a plot's hero stands: on the castle side of its pad, facing out. */
  private homeOf(p: Plot) {
    return p.pos.clone().add(p.pos.clone().setY(0).normalize().multiplyScalar(-1.15))
  }

  private makeRoad(color: THREE.Color, from: () => THREE.Vector3, to: () => THREE.Vector3): Road {
    const mat = new THREE.MeshStandardMaterial({ color: lighter(color, 0.4).lerp(new THREE.Color(SAND), 0.5), roughness: 0.95, transparent: true, opacity: 1 })
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat)
    mesh.receiveShadow = true
    this.root.add(mesh)
    const road: Road = { mesh, from, to, grown: 1 }
    this.shapeRoad(road)
    return road
  }

  /** A ribbon on the grass, bowed a little, from `from()` to `to()`. */
  private shapeRoad(road: Road) {
    const a = road.from()
    const b = road.to()
    const mid = a.clone().lerp(b, 0.5)
    const side = v3(-(b.z - a.z), 0, b.x - a.x).normalize().multiplyScalar(a.distanceTo(b) * 0.12)
    const curve = new THREE.QuadraticBezierCurve3(a.clone().setY(0.012), mid.add(side).setY(0.012), b.clone().setY(0.012))
    const n = 28
    const pos = new Float32Array(n * 18)
    const w = 0.17
    const p0 = v3()
    const p1 = v3()
    const d = v3()
    const s = v3()
    for (let i = 0; i < n; i++) {
      curve.getPoint(i / n, p0)
      curve.getPoint((i + 1) / n, p1)
      d.subVectors(p1, p0).normalize()
      s.set(-d.z, 0, d.x).multiplyScalar(w)
      const q = [p0.x + s.x, p0.z + s.z, p0.x - s.x, p0.z - s.z, p1.x + s.x, p1.z + s.z, p1.x - s.x, p1.z - s.z]
      ;[0, 1, 2, 2, 1, 3].forEach((k, j) => {
        pos[i * 18 + j * 3] = q[k * 2]
        pos[i * 18 + j * 3 + 1] = 0.012
        pos[i * 18 + j * 3 + 2] = q[k * 2 + 1]
      })
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.computeVertexNormals()
    road.mesh.geometry.dispose()
    road.mesh.geometry = g
    g.setDrawRange(0, Math.round(n * road.grown) * 6)
  }

  private dropRoad(road: Road) {
    road.mesh.removeFromParent()
    road.mesh.geometry.dispose()
    ;(road.mesh.material as THREE.Material).dispose()
  }

  /** Packs a plot up, animated: flag down, blocks gone, pad sinks. It leaves the model at once. */
  private packUp(p: Plot, delay: number, keepWorker = false) {
    this.dropPlot(p)
    // the drawing goes when the animation ends, not at the next flush
    this.doomed = this.doomed.filter((d) => d !== p)
    p.closing = true
    if (keepWorker && p.worker) {
      p.worker.plot = undefined
      p.worker = undefined
    }
    const vis = p.vis
    if (!vis) {
      if (p.worker) this.despawn(p.worker)
      return
    }
    const road = vis.road
    this.tl.tween(
      delay,
      0.75,
      (t) => {
        vis.flag.scale.y = Math.max(0.001, 1 - ease.in(span(t, 0, 0.5)))
        vis.stack.scale.setScalar(Math.max(0.001, 1 - ease.inBack(span(t, 0, 0.45))))
        vis.group.scale.setScalar(Math.max(0.001, 1 - ease.inBack(span(t, 0.3, 1))))
        if (road) (road.mesh.material as THREE.MeshStandardMaterial).opacity = 1 - span(t, 0, 0.8)
      },
      () => {
        this.particles.burst('dust', p.pos.clone().setY(0.1), [], 1.2)
        this.undraw(p)
      },
    )
  }

  // ---- the castle ----

  private setCastle(build: CastleBuild) {
    if (this.castle) {
      this.castle.group.removeFromParent()
      this.castle.dispose()
    }
    this.castle = build
    this.builtLayers = this.layers.length
    this.builtTier = this.tier
    this.lastBuild = performance.now()
    build.group.traverse((o) => {
      if (o instanceof THREE.Mesh) o.receiveShadow = true
    })
    for (const piece of build.pieces) this.tagPiece(piece)
    this.root.add(build.group)
  }

  private tagPiece(piece: CastlePiece) {
    const tier = tierAt(this.tier)
    const paint = piece.layer > 0 ? this.layers[piece.layer - 1] : undefined
    const info: PickInfo =
      piece.kind === 'slot' && paint
        ? {
            kind: 'layer',
            title: `Layer ${piece.layer}`,
            lines: [paint.label, `Built on the ${tier.name.toLowerCase()}`],
            color: hex(paint.color),
            branch: this.layerBy[piece.layer - 1],
          }
        : piece.kind === 'heritage'
          ? { kind: 'layer', title: piece.layer ? `Layer ${piece.layer}` : 'Heritage stones', lines: [paint?.label ?? 'One stone for every Layer of an earlier building', 'Kept from an earlier building'], color: paint ? hex(paint.color) : '#f5c542' }
          : { kind: 'castle', title: `main · ${tier.name}`, lines: [tier.description, `${this.layers.length} published Layer${this.layers.length === 1 ? '' : 's'}`], color: hex(new THREE.Color(ROSE)) }
    piece.object.traverse((o) => (o.userData.pickInfo = info))
  }

  private crewHome(w: Worker) {
    const a = w.crewAngle ?? 0
    const r = tierAt(this.tier).radius + 1.0
    return v3(Math.cos(a) * r, 0, Math.sin(a) * r)
  }

  // ---- the whole world ----

  /** Back to Init: the camp, the crew, no plots. */
  reset() {
    this.tl.clear()
    this.particles.clear()
    for (const w of [...this.workers]) this.despawn(w)
    for (const p of [...this.plots.values(), ...this.doomed]) this.undraw(p)
    this.plots.clear()
    this.dirty.clear()
    this.doomed = []
    this.used.clear()
    this.layers = []
    this.layerBy = []
    this.tier = 0
    this.setCastle(buildCastle(0, []))
    for (const piece of this.castle.pieces) piece.reveal(1)
    this.crew = ['bot', 'penguin', 'crab']
      .filter((n) => HERO_NAMES.includes(n))
      .map((n, i) => {
        const w = this.spawn(n, v3(), new THREE.Color(ROSE))
        w.mode = 'home'
        w.crewAngle = Math.PI * 0.25 + i * 2.1
        w.hero.root.position.copy(this.crewHome(w))
        return w
      })
    this.setIsland(this.wantIsland())
    this.focus.set(0, 1, 0)
    this.zoom = 1
    this.look = null
  }

  /**
   * Brings the drawing up to the model. `quick`: a time-lapse frame, so the
   * castle is rebuilt only every REBUILD_MS (and always on a new tier).
   */
  flush(quick = false) {
    for (const p of this.doomed) this.undraw(p)
    this.doomed = []
    if (this.layoutDirty) {
      this.layoutDirty = false
      for (const p of this.plots.values()) {
        p.pos.copy(this.slotPos(p.slot))
        if (p.vis) {
          p.vis.group.position.copy(p.pos)
          p.vis.group.rotation.y = Math.atan2(p.pos.x, p.pos.z)
          if (p.vis.road) this.shapeRoad(p.vis.road)
        }
      }
      for (const w of this.crew) w.hero.root.position.copy(this.crewHome(w))
    }
    for (const p of this.dirty) {
      if (this.plots.get(p.name) !== p) continue
      this.drawStack(p)
      this.drawWorker(p)
    }
    this.dirty.clear()
    // heroes freed by closed plots go to plots that had none
    if (this.heroesAtPlots() < MAX_HEROES) for (const p of this.plots.values()) if (!p.worker && !p.closing) this.drawWorker(p)
    const stale = this.builtLayers !== this.layers.length || this.builtTier !== this.tier
    if (stale && (!quick || this.builtTier !== this.tier || performance.now() - this.lastBuild > REBUILD_MS)) {
      this.setCastle(buildCastle(this.tier, this.layers))
      for (const piece of this.castle.pieces) piece.reveal(1)
    }
    const r = this.wantIsland()
    if (Math.abs(r - this.islandR) > 0.01) this.setIsland(r)
  }

  /** Applies one event. Animated: returns how long until the next may start. */
  apply(ev: GameEvent, animated: boolean): number {
    if (animated) this.flush()
    switch (ev.kind) {
      case 'fork':
        return this.fork(ev, animated)
      case 'commit':
        return this.commit(ev, animated)
      case 'merge':
        return this.merge(ev, animated)
      case 'publish':
        return this.publish(ev, animated)
    }
  }

  /** A small flourish for a publish passed in a time-lapse: confetti, and the note. */
  cheer(ev: GameEvent) {
    if (ev.kind !== 'publish') return
    const c = colorOf(ev.branch)
    this.particles.burst('confetti', v3(0, Math.min(this.castle.top, 8) * 0.8, 0), [c, new THREE.Color(GOLD), new THREE.Color(0xffffff)], Math.max(1, tierAt(this.tier).radius / 4))
  }

  private plotFor(name: string, by?: string) {
    return this.plots.get(name) ?? this.newPlot(name, undefined, by)
  }

  private fork(ev: GameEvent, animated: boolean): number {
    const p = this.newPlot(ev.branch, ev.from, ev.by)
    if (!animated) return 0
    this.dirty.delete(p)
    const vis = this.drawPlot(p)
    const parent = p.parent ? this.plots.get(p.parent) : undefined
    const startAt = parent ? parent.pos.clone() : this.gate(p.pos)
    // pad pops up, the road draws itself, the hero walks down it, the flag goes up
    vis.group.scale.setScalar(0.001)
    vis.flag.scale.y = 0.001
    const road = vis.road!
    road.grown = 0
    this.shapeRoad(road)
    this.tl.tween(0, 0.45, (t) => vis.group.scale.setScalar(Math.max(0.001, ease.outBack(t))))
    this.tl.tween(0.05, 0.7, (t) => {
      road.grown = ease.out(t)
      road.mesh.geometry.setDrawRange(0, Math.round(28 * road.grown) * 6)
    })
    this.tl.tween(0.45, 0.4, (t) => (vis.flag.scale.y = Math.max(0.001, ease.outBack(t))))
    if (this.heroesAtPlots() < MAX_HEROES) {
      const w = this.spawn(this.heroFor(ev.by, ev.branch), startAt, p.color)
      w.plot = p
      p.worker = w
      this.walk(w, this.homeOf(p), 0.1, 1.0, 'walk', () => {
        w.mode = 'home'
        this.particles.burst('poof', p.pos.clone().setY(0.2), [p.color], 0.8)
      })
    }
    this.particles.burst('ring', startAt.clone().setY(0.1), [p.color, new THREE.Color(GOLD)], 0.6)
    const r1 = this.wantIsland()
    if (r1 > this.islandR + 0.01) {
      const r0 = this.islandR
      this.tl.tween(0, 0.6, (t) => this.setIsland(lerp(r0, r1, ease.inOut(t))))
    }
    this.note('fork', `${ev.branch} forks from ${ev.from ?? 'main'}`, p.color)
    return LEAD.fork
  }

  private commit(ev: GameEvent, animated: boolean): number {
    if (ev.branch === 'main') {
      if (!animated) return 0
      const w = this.crew[hashOf(ev.id) % Math.max(1, this.crew.length)]
      if (w) this.pose(w, 'hammer', 0, 0.6, v3())
      this.tl.call(0.4, () => this.particles.burst('sparks', (w?.hero.root.position ?? v3()).clone().setY(0.6)))
      this.note('commit', `main: ${ev.message}`, '#3d55e8')
      return LEAD.commit
    }
    const p = this.plotFor(ev.branch, ev.by)
    this.stackOn(p, false)
    if (!animated) return 0
    this.dirty.delete(p)
    const m = this.drawStack(p)
    const w = p.worker
    if (w) this.pose(w, 'hammer', 0, 0.5, p.pos)
    if (m) {
      const y = m.position.y
      m.scale.setScalar(0.001)
      const stack = p.vis!.stack
      this.tl.tween(
        0.18,
        0.42,
        (t) => {
          m.scale.setScalar(Math.max(0.001, ease.outBack(span(t, 0, 0.3))))
          m.position.y = y + (1 - ease.outBounce(t)) * 1.3
        },
        () => this.particles.burst('sparks', stack.localToWorld(m.position.clone()), [new THREE.Color(GOLD), lighter(p.color, 0.3)], 0.7),
      )
    }
    this.note('commit', `${ev.branch}: ${ev.message}`, p.color)
    return LEAD.commit
  }

  private merge(ev: GameEvent, animated: boolean): number {
    const src = ev.from ? this.plots.get(ev.from) : undefined
    const dst = ev.branch === 'main' ? undefined : this.plotFor(ev.branch)
    const color = src?.color ?? colorOf(ev.from ?? 'main')
    if (dst) this.stackOn(dst, true)
    if (!animated) {
      if (src && ev.closes) this.dropPlot(src)
      return 0
    }
    let m: THREE.Object3D | null = null
    if (dst) {
      this.dirty.delete(dst)
      m = this.drawStack(dst)
    }
    const to = dst ? this.homeOf(dst).lerp(dst.pos, 0.35) : this.gate(src?.pos ?? v3(1, 0, 0))
    if (m) m.scale.setScalar(0.001)
    const land = () => {
      if (!m) return
      const y = m.position.y
      this.tl.tween(0, 0.32, (t) => {
        m.scale.setScalar(Math.max(0.001, ease.outBack(t)))
        m.position.y = y + (1 - ease.outBounce(t)) * 0.5
      })
    }
    const w = src?.worker
    if (src && w) {
      const crate = makeProp('crate', color)
      const back = this.homeOf(src)
      this.tl.call(0.05, () => {
        w.mode = 'script'
        w.hero.hold(crate)
      })
      if (ev.closes) this.packUp(src, 0.9, true)
      this.walk(w, to, 0.15, 0.9, 'carry', () => {
        w.hero.hold(null)
        crate.removeFromParent()
        this.particles.burst('ring', to.clone().setY(0.15), [new THREE.Color(GOLD), color], 0.7)
        land()
        if (ev.closes) {
          this.pose(w, 'cheer', 0, 0.6)
          this.tl.call(0.6, () => {
            this.particles.burst('poof', w.hero.root.position.clone().setY(0.4), [color])
            this.despawn(w)
          })
        } else this.walk(w, back, 0.25, 0.85, 'walk', () => (w.mode = 'home'))
      })
    } else {
      this.tl.call(0.2, land)
      if (src && ev.closes) this.packUp(src, 0.3)
    }
    this.note('merge', `${ev.from} merges into ${ev.branch}`, color)
    return LEAD.merge
  }

  private publish(ev: GameEvent, animated: boolean): number {
    const plot = this.plots.get(ev.branch)
    const color = plot?.color ?? colorOf(ev.branch === 'main' ? 'Init' : ev.branch)
    const n = this.layers.length + 1
    this.layers.push({ color, label: `Layer ${n} · ${ev.branch === 'main' ? 'main' : ev.branch}` })
    this.layerBy.push(ev.branch)
    const next = tierIndexFor(this.layers.length)
    const renewing = next !== this.tier
    if (!animated) {
      if (renewing) {
        this.tier = next
        this.layoutDirty = true
      }
      if (plot) this.dropPlot(plot)
      return 0
    }
    const t0 = renewing ? this.renew(next) : 0
    if (!renewing) {
      this.setCastle(buildCastle(this.tier, this.layers))
      for (const piece of this.castle.pieces) piece.reveal(1)
    }
    const fresh = this.castle.pieces.filter((p) => p.kind === 'slot' && p.layer === n)
    for (const piece of fresh) piece.reveal(0)
    this.build(ev, n, color, plot, fresh, t0)
    // the camera moves in on the building for the big moment, then eases back out
    const r = tierAt(this.tier).radius
    this.focus.set(0, Math.min(this.castle.top * 0.4, r), 0)
    this.zoom = Math.min(1, Math.max(0.35, (r * 2.4 + 4) / (this.islandR * 2.2)))
    this.look = null
    // once the new building stands, it turns to face the side where the new piece goes up
    const side = fresh[0] ? this.castle.group.localToWorld(fresh[0].anchor.clone()) : null
    if (side && side.lengthSq() > 0.01)
      this.tl.call(t0, () => {
        this.look = Math.atan2(side.x, side.z)
        this.focus.set(side.x * 0.35, Math.min(this.castle.top * 0.4, r), side.z * 0.35)
      })
    this.tl.call(t0 + PUBLISH_S + 0.2, () => {
      this.zoom = 1
      this.look = null
      this.focus.set(0, this.castle.top * 0.33, 0)
    })
    return t0 + LEAD.publish
  }

  /** Takes the old building down under a scaffold and raises the next tier. Returns its length. */
  private renew(next: number): number {
    const from = this.tier
    const old = this.castle
    const oldR = tierAt(from).radius
    this.note('renew', renewalLine(from, next), '#f5c542')
    // the old building is kept aside while it comes down
    this.castle = undefined as unknown as CastleBuild
    const scaffold = makeScaffold(oldR + 0.3, Math.min(old.top + 0.3, oldR * 1.5 + 0.8))
    this.root.add(scaffold.object)
    scaffold.reveal(0)
    this.tl.tween(0, 0.55, (t) => scaffold.reveal(ease.out(t)))
    // the crew gathers round and works
    this.crew.forEach((w, i) => {
      const a = (i / Math.max(1, this.crew.length)) * Math.PI * 2 + 0.6
      const at = v3(Math.cos(a), 0, Math.sin(a)).multiplyScalar(oldR + 0.9)
      this.walk(w, at, 0, 0.4)
      this.pose(w, 'hammer', 0.42, 1.9, v3())
    })
    // down it comes, top first
    const down = [...old.pieces].sort((a, b) => b.order - a.order)
    down.forEach((piece, i) => {
      const d = 0.45 + (i / Math.max(1, down.length)) * 0.85
      this.tl.tween(
        d,
        0.32,
        (t) => piece.reveal(1 - ease.in(t)),
        () => {
          if (i % 3 === 0) this.particles.burst('dust', old.group.localToWorld(piece.anchor.clone()).setY(Math.min(piece.top, 3) * 0.5), [], 1.1)
        },
      )
    })
    this.tl.tween(
      1.45,
      0.3,
      (t) => scaffold.reveal(1 - t),
      () => {
        old.group.removeFromParent()
        old.dispose()
        scaffold.object.removeFromParent()
        scaffold.dispose()
      },
    )
    // the new tier, built in order: foundations first
    this.tier = next
    this.setCastle(buildCastle(next, this.layers))
    const nr = tierAt(next).radius
    const up = this.castle.pieces.filter((p) => p.kind !== 'slot' || p.layer !== this.layers.length).sort((a, b) => a.order - b.order)
    for (const piece of this.castle.pieces) piece.reveal(0)
    const scaffold2 = makeScaffold(nr + 0.3, Math.min(this.castle.top * 0.7 + 0.3, nr * 1.5 + 0.8))
    scaffold2.reveal(0)
    this.root.add(scaffold2.object)
    this.tl.tween(1.4, 0.35, (t) => scaffold2.reveal(ease.out(t)))
    up.forEach((piece, i) => {
      const d = 1.55 + (i / Math.max(1, up.length)) * 0.85
      this.tl.tween(
        d,
        0.3,
        (t) => piece.reveal(ease.out(t)),
        () => {
          if (i % 4 === 0) this.particles.burst('sparks', this.castle.group.localToWorld(piece.anchor.clone()).setY(Math.min(piece.top, 4)), [new THREE.Color(GOLD)])
        },
      )
    })
    this.tl.tween(
      RENEW_S - 0.25,
      0.3,
      (t) => scaffold2.reveal(1 - t),
      () => {
        scaffold2.object.removeFromParent()
        scaffold2.dispose()
      },
    )
    // the plots and the island move out to make room
    const moves = [...this.plots.values()].map((p) => ({ p, from: p.pos.clone(), to: this.slotPos(p.slot) }))
    const r0 = this.islandR
    const r1 = this.wantIsland()
    this.tl.tween(1.35, 0.9, (t) => {
      const k = ease.inOut(t)
      for (const m of moves) {
        m.p.pos.lerpVectors(m.from, m.to, k)
        if (m.p.vis) {
          m.p.vis.group.position.copy(m.p.pos)
          if (m.p.vis.road) this.shapeRoad(m.p.vis.road)
        }
      }
      this.setIsland(lerp(r0, r1, k))
    })
    this.crew.forEach((w) => this.walk(w, this.crewHome(w), 2.3, 0.45, 'walk', () => (w.mode = 'home')))
    return RENEW_S
  }

  /** The 3 s publish: carry, scaffold, hammer the new piece up, scaffold down, cheer. */
  private build(ev: GameEvent, n: number, color: THREE.Color, plot: Plot | undefined, pieces: CastlePiece[], t0: number) {
    const group = this.castle.group
    const piece = pieces[0]
    const anchor = piece ? group.localToWorld(piece.anchor.clone()).setY(0) : this.gate(plot?.pos ?? v3(1, 0, 0.4))
    const top = piece ? piece.top : 2
    // the piece's middle on the ground, for the scaffold
    const box = new THREE.Box3()
    for (const p of pieces) {
      p.reveal(1)
      box.expandByObject(p.object)
      p.reveal(0)
    }
    const centre = box.isEmpty() ? anchor.clone() : box.getCenter(v3()).setY(0)
    const size = box.isEmpty() ? v3(1, 2, 1) : box.getSize(v3())
    const label = ev.branch === 'main' ? 'main' : ev.branch
    const tierName = tierAt(this.tier).name.toLowerCase()
    this.tl.call(t0, () => this.note('publish', `Layer ${n} published by ${label}: the builders add to the ${tierName}`, color))

    // the crew: the Branch's hero and two helpers in its colour
    const start = plot ? plot.pos.clone() : this.gate(anchor)
    const team: Worker[] = []
    if (plot?.worker) {
      team.push(plot.worker)
      plot.worker.plot = undefined
      plot.worker = undefined
    }
    while (team.length < 3) {
      const i = team.length
      const at = start.clone().add(v3(Math.cos(i * 2.1) * 0.6, 0, Math.sin(i * 2.1) * 0.6))
      const w = this.spawn(heroNameFor(`${ev.id}:${i}`), at, color, 0.92)
      w.hero.root.visible = false
      this.tl.call(t0 + 0.02 * i, () => {
        w.hero.root.visible = true
        this.particles.burst('poof', at.clone().setY(0.3), [color], 0.6)
      })
      team.push(w)
    }
    // where each stands: around the anchor, facing the piece
    const out = anchor.clone().sub(centre).setY(0)
    if (out.lengthSq() < 0.01) out.set(anchor.x, 0, anchor.z)
    out.normalize()
    const spots = team.map((_, i) => anchor.clone().add(out.clone().applyAxisAngle(v3(0, 1, 0), (i - 1) * 0.55).multiplyScalar(0.55 + (i % 2) * 0.25)))

    // 0.0–1.0 carry the blocks across
    const blocks = plot?.vis ? plot.vis.blocks.slice(-6) : []
    blocks.forEach((b, i) => this.tl.tween(t0 + i * 0.08, 0.25, (t) => b.scale.setScalar(Math.max(0.001, 1 - ease.inBack(t)))))
    team.forEach((w, i) => {
      const prop = makeProp('block', color)
      this.tl.call(t0 + 0.05 + i * 0.06, () => w.hero.hold(prop))
      this.walk(w, spots[i], t0 + 0.08 + i * 0.07, 0.85, 'carry', () => {
        w.hero.hold(null)
        prop.removeFromParent()
        this.particles.burst('dust', spots[i].clone().setY(0.1), [], 0.5)
      })
      // 1.0–2.5 hammer
      this.pose(w, 'hammer', t0 + 1.02 + i * 0.05, 1.45 - i * 0.05, centre.clone().setY(0))
      // 2.5–3.0 cheer
      this.pose(w, 'cheer', t0 + 2.5, 0.5)
    })
    if (plot) this.packUp(plot, t0 + 0.5, true)

    // the scaffold rises around the piece, the piece is hammered up inside it
    const scaffold = makeScaffold(Math.max(0.55, Math.max(size.x, size.z) * 0.6), Math.max(0.8, top + 0.2))
    scaffold.object.position.copy(centre)
    scaffold.reveal(0)
    this.tl.call(t0 + 0.85, () => this.root.add(scaffold.object))
    this.tl.tween(t0 + 0.85, 0.35, (t) => scaffold.reveal(ease.out(t)))
    for (const p of pieces) this.tl.tween(t0 + 1.1, 1.35, (t) => p.reveal(ease.inOut(t)))
    for (let k = 0; k < 7; k++)
      this.tl.call(t0 + 1.15 + k * 0.19, () => {
        const y = Math.min(top, 0.4 + (top - 0.4) * (k / 6))
        this.particles.burst('sparks', centre.clone().add(v3((Math.random() - 0.5) * size.x * 0.7, y, (Math.random() - 0.5) * size.z * 0.7)), [new THREE.Color(GOLD), lighter(color, 0.3)])
      })
    this.tl.tween(
      t0 + 2.45,
      0.4,
      (t) => scaffold.reveal(1 - ease.in(t)),
      () => {
        scaffold.object.removeFromParent()
        scaffold.dispose()
      },
    )
    // fireworks over the building in the Branch's colour
    const palette = [color, lighter(color, 0.4), new THREE.Color(GOLD), new THREE.Color(0xffffff)]
    const spread = Math.max(1.6, tierAt(this.tier).radius * 0.5)
    this.tl.call(t0 + 2.5, () => this.particles.burst('confetti', centre.clone().setY(top + 0.3), palette))
    for (let k = 0; k < 3; k++) this.tl.call(t0 + 2.5 + k * 0.16, () => this.particles.burst('firework', v3((k - 1) * spread, this.castle.top * 0.4, ((k % 2) - 0.5) * spread), palette))
    // the helpers go home with a poof; the Branch is done
    this.tl.call(t0 + PUBLISH_S, () => {
      for (const w of team) {
        this.particles.burst('poof', w.hero.root.position.clone().setY(0.4), [color], 0.7)
        this.despawn(w)
      }
    })
  }

  // ---- each frame ----

  /** `dt`: game seconds since the last frame (already scaled by the speed). */
  update(dt: number) {
    this.tl.update(dt)
    const time = this.tl.time
    this.particles.update(dt)
    const out = v3()
    for (const w of this.workers) {
      if (w.mode === 'home') {
        if (w.plot) {
          const home = this.homeOf(w.plot)
          w.hero.root.position.lerp(home, Math.min(1, dt * 6))
          out.copy(w.plot.pos).setY(0)
          w.hero.root.rotation.y = Math.atan2(out.x, out.z)
        } else if (w.crewAngle !== undefined) {
          w.hero.root.position.lerp(this.crewHome(w), Math.min(1, dt * 4))
          w.hero.root.rotation.y = Math.PI / 2 - w.crewAngle
        }
      }
      w.hero.update(time)
    }
    // flags flutter, clouds drift
    for (const p of this.plots.values()) if (p.vis) p.vis.flag.children[1].rotation.y = Math.sin(time * 3 + p.slot) * 0.25
    for (const c of this.clouds.children) {
      const d = c.userData as { angle: number; r: number; y: number; speed: number }
      d.angle += d.speed * dt
      // high and wide: above the camera's line of sight to the island
      const r = this.islandR + d.r * Math.max(1, this.islandR / 14)
      c.position.set(Math.cos(d.angle) * r, d.y + this.islandR * 0.85, Math.sin(d.angle) * r)
    }
    // the batches follow their proxies
    this.root.updateMatrixWorld()
    for (const pool of this.pools) pool.sync()
  }

  // ---- reading the world ----

  /** Whether anything is moving beyond the heroes' idle breathing: tweens or particles. */
  get busy() {
    return this.tl.busy || this.particles.live
  }

  get tierIndex() {
    return this.tier
  }

  get layerCount() {
    return this.layers.length
  }

  get openPlots() {
    return this.plots.size
  }

  get radius() {
    return this.islandR
  }

  get height() {
    return this.castle?.top ?? 2
  }

  /** What is under the pointer, for its card. */
  pick(ray: THREE.Raycaster): (PickInfo & { at: THREE.Vector3 }) | undefined {
    const targets: THREE.Object3D[] = [this.castle.group]
    for (const p of this.plots.values()) if (p.vis) targets.push(p.vis.group)
    for (const hit of ray.intersectObjects(targets, true)) {
      const name = hit.object.userData.pick as string | undefined
      if (name) {
        const p = this.plots.get(name)
        if (!p) continue
        return {
          kind: 'branch',
          title: name,
          color: hex(p.color),
          branch: name,
          lines: [`${p.commits} Commit${p.commits === 1 ? '' : 's'}${p.merges ? ` · ${p.merges} merged in` : ''}`, p.by ? `Worked by ${p.by}` : 'Open: still being worked on'],
          at: hit.point,
        }
      }
      const info = hit.object.userData.pickInfo as PickInfo | undefined
      if (info) return { ...info, at: hit.point }
    }
    return undefined
  }

  dispose() {
    this.tl.clear()
    for (const w of [...this.workers]) this.despawn(w)
    for (const p of [...this.plots.values(), ...this.doomed]) this.undraw(p)
    this.castle?.dispose()
    this.particles.dispose()
    for (const pool of this.pools) pool.dispose()
    for (const k of this.keep) k.dispose()
    for (const m of this.mats.values()) m.dispose()
    disposeHeroAssets()
    disposeCastleAssets()
  }
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b)
}
