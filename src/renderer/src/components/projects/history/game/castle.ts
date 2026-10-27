// main as a building that grows: every published Layer adds a piece to it, in
// the colour of the Branch that published it, and when a tier is full the
// builders renew it into the next, bigger one on the same site.
//   Camp → Cottage → House → Manor → Keep → Castle → Citadel
// Every tier keeps main's look (cream walls, royal roofs, gold trim, the rose
// pennant on top), and the Layers of earlier tiers stay as a ring of coloured
// stones around its foot.
//
// A piece is made of parts (courses, roofs, flags). reveal(p) pops the parts
// in bottom to top, each with a little overshoot and drop, flags unfurling
// last. Shapes and paints are shared through module caches; the shapes of one
// part that share a paint are merged into one mesh (cached by content), so a
// big Citadel stays at a few hundred draw calls.
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

import { BLUSH, CREAM, DIRT, GLOW, GOLD, GRASS_DARK, ROSE, ROYAL, SAND, STONE, STONE_DARK, THATCH, TIMBER, WATER, darker, lighter } from './palette'
import type { CastleBuild, CastlePiece, CastleTier, LayerPaint } from './types'

// ---- the rules ------------------------------------------------------------------
//
// Tiers 0–5 are hand-built. From 6 (Citadel) on, every tier is a grand citadel
// whose platform, terraces, gates and spire grow with its level, for ever: the
// gap to the next renewal grows by 4 Layers each time (16, 20, 24 …).

const HAND: CastleTier[] = [
  { level: 0, name: 'Camp', minLayers: 0, radius: 1.6, description: 'A tent, a campfire and main’s rose pennant on bare grass: Init, waiting for the first publish.' },
  { level: 1, name: 'Cottage', minLayers: 1, radius: 2.0, description: 'A timber cottage on a little paved yard. Layers 1–3 add a chimney, a garden and a porch.' },
  { level: 2, name: 'House', minLayers: 4, radius: 2.6, description: 'A two-storey stone house on a low plinth. Layers 4–7 add a wing, a balcony, a bell tower and a garden wall.' },
  { level: 3, name: 'Manor', minLayers: 8, radius: 3.3, description: 'An L-shaped manor on a terraced courtyard. Layers 8–13 add a turret, a glasshouse, a stable, a fountain, a terrace and a banner hall.' },
  { level: 4, name: 'Keep', minLayers: 14, radius: 4.0, description: 'A stone keep on a raised motte inside a curtain wall. Layers 14–21 add turrets, a gatehouse, wall towers, a drawbridge, a watchtower and hoardings.' },
  { level: 5, name: 'Castle', minLayers: 22, radius: 5.0, description: 'A fairy-tale castle on a round stone platform ringed by a moat. Layers 22–33 add eight wall towers and four keep turrets.' },
]
const GRAND_NAMES = ['Citadel', 'Grand Citadel', 'High Citadel', 'Sky Citadel', 'Star Citadel', 'Crown Citadel']
const ROMAN: [number, string][] = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']]
const roman = (n: number) => {
  let out = ''
  for (const [v, s] of ROMAN) while (n >= v) (out += s), (n -= v)
  return out
}

/** Layers a tier holds before the next renewal. */
const gapAfter = (i: number) => (i < HAND.length - 1 ? HAND[i + 1].minLayers - HAND[i].minLayers : i === HAND.length - 1 ? 12 : 16 + 4 * (i - 6))

// a grand citadel's size, by level (6 = the Citadel)
// (square roots: every tier grows, none is the last, tier 60 is not absurd)
const grandSteps = (L: number) => 2 + Math.round(1.6 * Math.sqrt(L - 6))
const grandTerraces = (L: number) => 3 + Math.floor(0.8 * Math.sqrt(L - 6))
const grandWalls = (L: number) => 1 + Math.floor(Math.sqrt(L - 6) / 2)
const grandGates = (L: number) => Math.min(4, 1 + Math.floor((L - 5) / 2))
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`

const tiers: CastleTier[] = [...HAND]
/** Any tier: 0–5 by hand, 6 on a grand citadel that grows with its level. */
export function tierOf(index: number): CastleTier {
  const i = Math.max(0, Math.floor(Number.isFinite(index) ? index : 0))
  while (tiers.length <= i) {
    const L = tiers.length
    const prev = tiers[L - 1]
    const min = prev.minLayers + gapAfter(L - 1)
    const g = L - 6
    const name = g < GRAND_NAMES.length ? GRAND_NAMES[g] : `Crown Citadel ${roman(g - GRAND_NAMES.length + 2)}`
    const what = g ? `A ${name.toLowerCase().replace(/ [ivxlcdm]+$/, '')}` : 'A tiered citadel'
    tiers.push({
      level: L,
      name,
      minLayers: min,
      radius: 6.0 + 2.2 * Math.sqrt(g),
      description: `${what}: ${plural(grandTerraces(L), 'terrace')} on a ${grandSteps(L)}-step platform, ${plural(grandWalls(L), 'curtain wall')} with ${plural(grandGates(L), 'gate')}. Layers ${min}–${min + gapAfter(L) - 1} add a tower each, ring by ring.`,
    })
  }
  return tiers[i]
}

/** The first tiers, precomputed (tierOf gives any). */
export const TIERS: CastleTier[] = Array.from({ length: 10 }, (_, i) => tierOf(i))

/** The tier main is at with `layers` published Layers. */
export function tierIndexFor(layers: number): number {
  let t = 0
  while (tierOf(t + 1).minLayers <= layers) t++
  return t
}

export const EVOLUTION_RULES: string[] = [
  'Camp — Init: a tent, a campfire and main’s rose pennant, on bare grass.',
  'Cottage — at Layer 1: a timber cottage on a paved yard; Layers 1–3 add a chimney, a garden and a porch.',
  'House — at Layer 4: a two-storey stone house on a low plinth; Layers 4–7 add a wing, a balcony, a bell tower and a garden wall.',
  'Manor — at Layer 8: an L-shaped manor on a terraced courtyard; Layers 8–13 add a turret, a glasshouse, a stable, a fountain, a terrace and a banner hall.',
  'Keep — at Layer 14: a stone keep on a raised motte with a curtain wall; Layers 14–21 add turrets, a gatehouse, wall towers, a drawbridge, a watchtower and hoardings.',
  'Castle — at Layer 22: a fairy-tale castle on a round platform ringed by a moat; Layers 22–33 add eight wall towers and four keep turrets.',
  ...[6, 7, 8, 9].map((i) => {
    const t = tierOf(i)
    return `${t.name} — at Layer ${t.minLayers}: ${plural(grandTerraces(i), 'terrace')} on a ${grandSteps(i)}-step platform, ${plural(grandGates(i), 'gate')}; Layers ${t.minLayers}–${t.minLayers + gapAfter(i) - 1} add ${gapAfter(i)} towers.`
  }),
  'And on for ever — every renewal sets a wider platform with another step and a grander citadel (more terraces, gates, bridges, a taller spire), and holds 4 more Layers than the last.',
]

/** What the rules leave out: colours and the stones that carry the past. */
export const EVOLUTION_NOTES: string[] = [
  'Each piece wears the colour of the Branch whose publish built it.',
  'When a building is full, the builders renew it into the next tier on the same site.',
  'Layers from earlier buildings stay as coloured stones in a ring around its foot.',
]

const RENEWALS: Record<number, string> = {
  1: 'The camp is packed up — the builders raise a timber cottage',
  2: 'The cottage is full — the builders raise a two-storey house',
  3: 'The house is full — the builders raise a manor round a courtyard',
  4: 'The manor is full — the builders raise a stone keep on a motte',
  5: 'The keep is full — the builders raise a fairy-tale castle',
  6: 'The castle is full — the builders raise a tiered citadel',
}

export function renewalLine(fromTier: number, toTier: number): string {
  const from = tierOf(fromTier)
  const to = tierOf(toTier)
  const lower = (t: CastleTier) => (t.level >= 6 ? `the ${t.name}` : `the ${t.name.toLowerCase()}`)
  if (to.level === from.level + 1 && RENEWALS[to.level]) return RENEWALS[to.level]
  if (to.level === from.level + 1) return `${lower(from).replace(/^t/, 'T')} is full — the builders widen the platform and raise ${lower(to)}`
  if (to.level > from.level) return `${lower(from).replace(/^t/, 'T')} gives way — the builders raise ${lower(to)}`
  return `The builders rebuild ${lower(to)}`
}

// ---- shared shapes and paints ---------------------------------------------------------

const geos = new Map<string, THREE.BufferGeometry>()
const geo = (key: string, make: () => THREE.BufferGeometry) => {
  let g = geos.get(key)
  if (!g) geos.set(key, (g = make()))
  return g
}

/** A polygon (fanned from its first point, counter-clockwise) in xy, 1 deep along z, centred. */
function extrude(pts: [number, number][]): THREE.BufferGeometry {
  const pos: number[] = []
  const nor: number[] = []
  const uv: number[] = []
  const v = (x: number, y: number, z: number, nx: number, ny: number, nz: number) => {
    pos.push(x, y, z)
    nor.push(nx, ny, nz)
    uv.push(x + 0.5, y + 0.5)
  }
  for (let i = 1; i < pts.length - 1; i++) {
    const [a, b, c] = [pts[0], pts[i], pts[i + 1]]
    v(a[0], a[1], 0.5, 0, 0, 1)
    v(b[0], b[1], 0.5, 0, 0, 1)
    v(c[0], c[1], 0.5, 0, 0, 1)
    v(a[0], a[1], -0.5, 0, 0, -1)
    v(c[0], c[1], -0.5, 0, 0, -1)
    v(b[0], b[1], -0.5, 0, 0, -1)
  }
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
    const nx = (b[1] - a[1]) / l
    const ny = -(b[0] - a[0]) / l
    for (const [p, z] of [[a, 0.5], [a, -0.5], [b, -0.5], [a, 0.5], [b, -0.5], [b, 0.5]] as const) v(p[0], p[1], z, nx, ny, 0)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  return g
}

const G = {
  /** A chunky rounded block, 1 on a side. */
  box: () => geo('box', () => new RoundedBoxGeometry(1, 1, 1, 2, 0.12)),
  /** A crisp block, for planks and window panes. */
  cube: () => geo('cube', () => new THREE.BoxGeometry(1, 1, 1)),
  /** A flat cushion tile, for heritage stones. */
  tile: () => geo('tile', () => new RoundedBoxGeometry(1, 0.3, 1, 2, 0.12)),
  /** The same, plain: for thousands. */
  tileLo: () => geo('tileLo', () => new THREE.BoxGeometry(1, 0.3, 1)),
  drum: () => geo('drum', () => new THREE.CylinderGeometry(1, 1, 1, 28)),
  /** A plainer drum, for instanced towers. */
  drumLo: () => geo('drumLo', () => new THREE.CylinderGeometry(1, 1, 1, 16)),
  coneLo: () => geo('coneLo', () => new THREE.ConeGeometry(1, 1, 16)),
  /** A smooth drum, for wide platforms and terraces. */
  drumHi: () => geo('drumHi', () => new THREE.CylinderGeometry(1, 1, 1, 96)),
  rod: () => geo('rod', () => new THREE.CylinderGeometry(1, 1, 1, 8)),
  /** A cylinder narrower at the top: a motte, a basin, a corbel. */
  frustum: () => geo('frustum', () => new THREE.CylinderGeometry(0.78, 1, 1, 32)),
  cone: () => geo('cone', () => new THREE.ConeGeometry(1, 1, 28)),
  /** A square pyramid, 1 on a side at its base. */
  pyr: () => geo('pyr', () => new THREE.ConeGeometry(Math.SQRT1_2, 1, 4).rotateY(Math.PI / 4)),
  ball: () => geo('ball', () => new THREE.SphereGeometry(1, 14, 10)),
  /** A triangle (apex up) in xy, extruded along z. */
  prism: () => geo('prism', () => extrude([[-0.5, -0.5], [0.5, -0.5], [0, 0.5]])),
  /** A pennant from x = 0 (the pole) to x = 1 (its tip). */
  pennant: () => geo('pennant', () => extrude([[0, -0.5], [1, 0], [0, 0.5]])),
  /** A hanging banner from y = 0 down to y = -1, a notch in its foot. */
  banner: () => geo('banner', () => extrude([[-0.5, 0], [-0.5, -1], [0, -0.74], [0.5, -1], [0.5, 0]])),
  /** The upper half of a disc of radius 1, 1 deep along z: an arch top. */
  half: () => geo('half', () => new THREE.CylinderGeometry(1, 1, 1, 16, 1, false, -Math.PI / 2, Math.PI).rotateX(-Math.PI / 2)),
  /** An arched window, 1 wide and 2 high (y -1 to 1), 1 deep. */
  arch: () =>
    geo('arch', () => {
      const rect = new THREE.BoxGeometry(1, 1.5, 1).toNonIndexed().translate(0, -0.25, 0)
      const top = G.half().toNonIndexed().scale(0.5, 0.5, 1).translate(0, 0.5, 0)
      const g = mergeGeometries([rect, top]) ?? rect
      rect.dispose()
      top.dispose()
      return g
    }),
}
type Geo = THREE.BufferGeometry

const mats = new Map<string, THREE.MeshStandardMaterial>()
function paint(color: THREE.ColorRepresentation, o: { glow?: number; rough?: number; metal?: number; opacity?: number } = {}) {
  const c = new THREE.Color(color)
  const key = `${c.getHexString()}:${o.glow ?? 0}:${o.rough ?? 0.62}:${o.metal ?? 0}:${o.opacity ?? 1}`
  let m = mats.get(key)
  if (!m)
    mats.set(
      key,
      (m = new THREE.MeshStandardMaterial({
        color: c,
        roughness: o.rough ?? 0.62,
        metalness: o.metal ?? 0,
        emissive: o.glow ? c : new THREE.Color(0),
        emissiveIntensity: o.glow ?? 0,
        transparent: (o.opacity ?? 1) < 1,
        opacity: o.opacity ?? 1,
      })),
    )
  return m
}

const col = (c: number) => new THREE.Color(c)
function palette() {
  return {
    cream: paint(CREAM),
    blush: paint(BLUSH),
    stone: paint(STONE, { rough: 0.85 }),
    stoneDk: paint(STONE_DARK, { rough: 0.85 }),
    timber: paint(TIMBER, { rough: 0.75 }),
    timberDk: paint(darker(col(TIMBER), 0.3), { rough: 0.75 }),
    wood: paint(lighter(col(TIMBER), 0.38), { rough: 0.75 }),
    thatch: paint(THATCH, { rough: 0.9 }),
    royal: paint(ROYAL, { rough: 0.5 }),
    royalLt: paint(lighter(col(ROYAL), 0.3), { rough: 0.5 }),
    rose: paint(ROSE, { rough: 0.55 }),
    pink: paint(0xffa6c9),
    gold: paint(GOLD, { rough: 0.3, metal: 0.45 }),
    glow: paint(GLOW, { glow: 0.75 }),
    fire: paint(0xff5a1f, { glow: 0.55 }),
    flame: paint(0xffc52e, { glow: 0.7 }),
    water: paint(WATER, { rough: 0.12 }),
    turf: paint(GRASS_DARK, { rough: 0.95 }),
    leaf: paint(0x58bb6a, { rough: 0.85 }),
    dirt: paint(DIRT, { rough: 1 }),
    sand: paint(SAND, { rough: 0.95 }),
    yard: paint(0xefe3cf, { rough: 0.95 }),
    white: paint(0xffffff),
    dark: paint(0x5a4232, { rough: 0.9 }),
    glass: paint(0xd2f4ff, { opacity: 0.42, rough: 0.08 }),
    smoke: paint(0xf4f3f8, { rough: 1 }),
    canvas: paint(0xfff6e6, { rough: 0.9 }),
  }
}
type Pal = ReturnType<typeof palette>
type Mat = THREE.Material

/** A Layer's colours: its main colour, a light and a dark shade. */
function accent(lp: LayerPaint) {
  return { m: paint(lp.color, { rough: 0.5 }), lt: paint(lighter(lp.color, 0.35)), dk: paint(darker(lp.color, 0.22), { rough: 0.5 }) }
}

// merged shapes, by what went into them
const composites = new Map<string, Geo>()
function composite(list: Geo[], locals: THREE.Matrix4[]): Geo {
  const key = list.map((g, i) => `${g.uuid}:${locals[i].elements.map((v) => Math.round(v * 1000)).join(',')}`).join('|')
  let g = composites.get(key)
  if (!g) {
    const parts = list.map((src, i) => (src.index ? src.toNonIndexed() : src.clone()).applyMatrix4(locals[i]))
    g = mergeGeometries(parts) ?? parts[0].clone()
    for (const p of parts) p.dispose()
    g.computeBoundingSphere()
    composites.set(key, g)
  }
  return g
}

/** Frees every shared shape and paint (the next build makes them again). */
export function disposeCastleAssets(): void {
  for (const g of geos.values()) g.dispose()
  for (const g of composites.values()) g.dispose()
  for (const m of mats.values()) m.dispose()
  geos.clear()
  composites.clear()
  mats.clear()
}

// ---- easing ------------------------------------------------------------------------

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)
const backOut = (t: number) => {
  const c = 1.55
  const u = t - 1
  return 1 + (c + 1) * u * u * u + c * u * u
}
const cubicOut = (t: number) => 1 - (1 - t) * (1 - t) * (1 - t)

// ---- the piece maker -----------------------------------------------------------------

/** Flags stream this way (world yaw): along +x, broadside to the front. */
const WIND = 0

type PartKind = 'pop' | 'flag' | 'drape'
interface Part {
  node: THREE.Object3D
  kind: PartKind
  y: number
  yaw: number
  drop: number
  at: number
  len: number
}
interface Entry {
  g: Geo
  m: Mat
  w: THREE.Matrix4
  shadow: boolean
}
interface Frame {
  x: number
  y: number
  z: number
  yaw: number
}

const _v = new THREE.Vector3()
const _s = new THREE.Vector3()
const _q = new THREE.Quaternion()
const _e = new THREE.Euler(0, 0, 0, 'YXZ')
const _b = new THREE.Box3()
const UP = new THREE.Vector3(0, 1, 0)

/**
 * Draws one piece. Shapes go into the current part, in a frame that push/pop
 * move and turn (yaw: the frame's +z faces (sin yaw, cos yaw)). Parts are
 * revealed in the order they were begun.
 */
class Maker {
  readonly root = new THREE.Group()
  readonly parts: Part[] = []
  /** The finished piece's box, in group space. */
  readonly box = new THREE.Box3()
  private entries: Entry[] = []
  private f: Frame = { x: 0, y: 0, z: 0, yaw: 0 }
  private stack: Frame[] = []
  private pf: Frame = { x: 0, y: 0, z: 0, yaw: 0 }
  private kind: PartKind = 'pop'
  private pivot = new THREE.Vector3()
  private pivotYaw = 0

  push(x: number, z: number, yaw = 0, y = 0): this {
    this.stack.push(this.f)
    const c = Math.cos(this.f.yaw)
    const s = Math.sin(this.f.yaw)
    this.f = { x: this.f.x + x * c + z * s, y: this.f.y + y, z: this.f.z - x * s + z * c, yaw: this.f.yaw + yaw }
    return this
  }
  pop(): this {
    this.f = this.stack.pop() ?? { x: 0, y: 0, z: 0, yaw: 0 }
    return this
  }
  /** A point of the frame, in group space. */
  world(x: number, y: number, z: number): THREE.Vector3 {
    const c = Math.cos(this.f.yaw)
    const s = Math.sin(this.f.yaw)
    return new THREE.Vector3(this.f.x + x * c + z * s, this.f.y + y, this.f.z - x * s + z * c)
  }
  /** The direction from the group's centre to a point of the frame (as a yaw). */
  outward(x = 0, z = 0): number {
    const p = this.world(x, 0, z)
    return Math.hypot(p.x, p.z) < 0.05 ? 0 : Math.atan2(p.x, p.z)
  }
  /** Turns a group-space yaw into this frame's. */
  local(yaw: number) {
    return yaw - this.f.yaw
  }

  /** Begins the next part (it pops in after the ones before it). */
  part(): this {
    this.flush()
    this.kind = 'pop'
    this.pf = { ...this.f }
    return this
  }

  add(g: Geo, m: Mat, x: number, y: number, z: number, sx: number, sy: number, sz: number, ry = 0, rx = 0, rz = 0, shadow = true): this {
    if (!this.entries.length && this.kind === 'pop') this.pf = { ...this.f }
    _e.set(rx, this.f.yaw + ry, rz, 'YXZ')
    _q.setFromEuler(_e)
    const c = Math.cos(this.f.yaw)
    const s = Math.sin(this.f.yaw)
    _v.set(this.f.x + x * c + z * s, this.f.y + y, this.f.z - x * s + z * c)
    _s.set(sx, sy, sz)
    this.entries.push({ g, m, w: new THREE.Matrix4().compose(_v, _q, _s), shadow })
    return this
  }

  // shapes, standing on y0 unless said
  blk(m: Mat, x: number, y0: number, z: number, w: number, h: number, d: number, ry = 0, shadow = true) {
    return this.add(G.box(), m, x, y0 + h / 2, z, w, h, d, ry, 0, 0, shadow)
  }
  cub(m: Mat, x: number, y0: number, z: number, w: number, h: number, d: number, ry = 0, shadow = true) {
    return this.add(G.cube(), m, x, y0 + h / 2, z, w, h, d, ry, 0, 0, shadow)
  }
  cyl(m: Mat, x: number, y0: number, z: number, r: number, h: number, shadow = true) {
    return this.add(G.drum(), m, x, y0 + h / 2, z, r, h, r, 0, 0, 0, shadow)
  }
  rod(m: Mat, x: number, y0: number, z: number, r: number, h: number, shadow = true) {
    return this.add(G.rod(), m, x, y0 + h / 2, z, r, h, r, 0, 0, 0, shadow)
  }
  con(m: Mat, x: number, y0: number, z: number, r: number, h: number, shadow = true) {
    return this.add(G.cone(), m, x, y0 + h / 2, z, r, h, r, 0, 0, 0, shadow)
  }
  pyr(m: Mat, x: number, y0: number, z: number, w: number, h: number, d: number, ry = 0) {
    return this.add(G.pyr(), m, x, y0 + h / 2, z, w, h, d, ry)
  }
  orb(m: Mat, x: number, y: number, z: number, r: number, sy = 1, shadow = false) {
    return this.add(G.ball(), m, x, y, z, r, r * sy, r, 0, 0, 0, shadow)
  }
  prism(m: Mat, x: number, y0: number, z: number, w: number, h: number, d: number, ry = 0) {
    return this.add(G.prism(), m, x, y0 + h / 2, z, w, h, d, ry)
  }

  /** A pennant flying from (x, y, z) of the frame, along the wind; its own part. */
  pennant(m: Mat, x: number, y: number, z: number, len: number, h: number) {
    this.flush()
    this.kind = 'flag'
    this.pivot.copy(this.world(x, y, z))
    this.pivotYaw = WIND
    _q.setFromAxisAngle(UP, WIND)
    this.entries.push({ g: G.pennant(), m, w: new THREE.Matrix4().compose(this.pivot, _q, _s.set(len, h, 0.035)), shadow: false })
    this.flush()
    return this
  }

  /** A banner hanging from (x, y, z) of the frame, flat to its +z; its own part, unrolled last. */
  banner(m: Mat, trim: Mat | null, x: number, y: number, z: number, w: number, h: number) {
    this.flush()
    this.kind = 'drape'
    this.pivot.copy(this.world(x, y, z))
    this.pivotYaw = this.f.yaw
    _q.setFromAxisAngle(UP, this.f.yaw)
    this.entries.push({ g: G.banner(), m, w: new THREE.Matrix4().compose(this.pivot, _q, _s.set(w, h, 0.04)), shadow: false })
    if (trim) this.entries.push({ g: G.cube(), m: trim, w: new THREE.Matrix4().compose(this.pivot, _q, _s.set(w + 0.12, 0.06, 0.06)), shadow: false })
    this.flush()
    return this
  }

  private flush() {
    const list = this.entries
    if (!list.length) return
    this.entries = []
    const pf = this.pf
    const F = new THREE.Matrix4().compose(_v.set(pf.x, pf.y, pf.z), _q.setFromAxisAngle(UP, pf.yaw), _s.set(1, 1, 1))
    const Finv = F.clone().invert()
    // the part's box, in its own frame
    const box = new THREE.Box3()
    const m4 = new THREE.Matrix4()
    for (const e of list) {
      if (!e.g.boundingBox) e.g.computeBoundingBox()
      box.union(_b.copy(e.g.boundingBox!).applyMatrix4(m4.multiplyMatrices(Finv, e.w)))
    }
    let pos: THREE.Vector3
    let yaw: number
    if (this.kind === 'pop') {
      pos = new THREE.Vector3((box.min.x + box.max.x) / 2, box.min.y, (box.min.z + box.max.z) / 2).applyMatrix4(F)
      yaw = pf.yaw
    } else {
      pos = this.pivot.clone()
      yaw = this.pivotYaw
    }
    const N = new THREE.Matrix4().compose(pos, _q.setFromAxisAngle(UP, yaw), _s.set(1, 1, 1))
    const Ninv = N.clone().invert()
    const node = new THREE.Group()
    node.position.copy(pos)
    node.rotation.y = yaw
    const byMat = new Map<Mat, Entry[]>()
    for (const e of list) byMat.set(e.m, [...(byMat.get(e.m) ?? []), e])
    for (const [m, es] of byMat) {
      const locals = es.map((e) => new THREE.Matrix4().multiplyMatrices(Ninv, e.w))
      let mesh: THREE.Mesh
      if (es.length === 1) {
        mesh = new THREE.Mesh(es[0].g, m)
        locals[0].decompose(mesh.position, mesh.quaternion, mesh.scale)
      } else mesh = new THREE.Mesh(composite(es.map((e) => e.g), locals), m)
      mesh.castShadow = es.some((e) => e.shadow)
      mesh.receiveShadow = true
      node.add(mesh)
    }
    this.root.add(node)
    this.box.union(box.clone().applyMatrix4(F))
    const h = box.max.y - box.min.y
    this.parts.push({ node, kind: this.kind, y: pos.y, yaw, drop: 0.18 + Math.min(0.4, h * 0.22), at: 0, len: 1 })
    this.kind = 'pop'
  }

  /** Ends the piece: times its parts and returns its reveal. */
  finish(): (p: number) => void {
    this.flush()
    const parts = this.parts
    const solid = parts.filter((p) => p.kind === 'pop')
    const last = parts.filter((p) => p.kind !== 'pop')
    const tail = last.length ? (solid.length ? 0.16 : 1) : 0
    const n = solid.length
    const len = n <= 1 ? 1 - tail : Math.min(0.55, Math.max(0.14, 2.4 / (n + 1.4)))
    solid.forEach((p, i) => {
      p.len = Math.max(0.01, len)
      p.at = n <= 1 ? 0 : (i / (n - 1)) * (1 - tail - len)
    })
    for (const p of last) {
      p.at = 1 - tail
      p.len = tail
    }
    const root = this.root
    return (p: number) => {
      root.visible = p > 0
      if (p <= 0) return
      for (const pt of parts) {
        const n = pt.node
        const t = p >= 1 ? 1 : clamp01((p - pt.at) / pt.len)
        if (t <= 0) {
          n.visible = false
          continue
        }
        n.visible = true
        if (t >= 1) {
          n.scale.set(1, 1, 1)
          n.position.y = pt.y
          n.rotation.y = pt.yaw
          continue
        }
        const e = Math.max(0.001, backOut(t))
        if (pt.kind === 'flag') {
          n.scale.set(e, 0.35 + 0.65 * cubicOut(t), 1)
          n.rotation.y = pt.yaw + Math.sin(t * 10) * (1 - t) * 0.6
          n.position.y = pt.y
        } else if (pt.kind === 'drape') {
          n.scale.set(1, e, 1)
          n.position.y = pt.y
        } else {
          n.scale.set(e, e, e)
          n.position.y = pt.y + (1 - cubicOut(t)) * pt.drop
        }
      }
    }
  }
}

// ---- building blocks --------------------------------------------------------------

/** A lit, arched window facing the frame's +z at (x, z), its foot at y0. */
function arch(k: Maker, m: Mat, x: number, y0: number, z: number, w: number, h: number, d = 0.08) {
  const hr = Math.max(0.02, h - w / 2)
  k.add(G.cube(), m, x, y0 + hr / 2, z, w, hr, d, 0, 0, 0, false)
  k.add(G.half(), m, x, y0 + hr, z, w / 2, w / 2, d, 0, 0, 0, false)
}

interface WinOpts {
  frame?: Mat
  shutters?: Mat
  flowers?: Mat[] | null
  sill?: Mat
  arched?: boolean
}
/** A window facing the frame's +z, on a wall whose face is at z. */
function windowAt(k: Maker, P: Pal, x: number, y0: number, z: number, w: number, h: number, o: WinOpts = {}) {
  const frame = o.frame ?? P.white
  if (o.arched ?? true) {
    arch(k, frame, x, y0 - 0.04, z - 0.015, w + 0.1, h + 0.08, 0.06)
    arch(k, P.glow, x, y0, z + 0.01, w, h, 0.07)
  } else {
    k.cub(frame, x, y0 - 0.04, z - 0.015, w + 0.1, h + 0.08, 0.06, 0, false)
    k.cub(P.glow, x, y0, z + 0.01, w, h, 0.07, 0, false)
    k.cub(frame, x, y0 + h / 2 - 0.02, z + 0.05, w, 0.04, 0.02, 0, false)
  }
  k.cub(o.sill ?? frame, x, y0 - 0.06, z + 0.05, w + 0.18, 0.05, 0.12, 0, false)
  if (o.shutters) for (const s of [-1, 1]) k.cub(o.shutters, x + s * (w / 2 + w * 0.3), y0, z + 0.03, w * 0.5, h * 0.82, 0.04, 0, false)
  if (o.flowers) {
    k.cub(P.timber, x, y0 - 0.2, z + 0.1, w + 0.12, 0.13, 0.15, 0, false)
    k.orb(P.leaf, x, y0 - 0.07, z + 0.12, w * 0.42, 0.45)
    const n = Math.max(2, Math.round(w / 0.12))
    for (let i = 0; i < n; i++) k.orb(o.flowers[i % o.flowers.length], x - w / 2 + 0.04 + (i * (w - 0.08)) / Math.max(1, n - 1), y0 - 0.03, z + 0.16, 0.05)
  }
}

/** A door facing the frame's +z, on a wall whose face is at z. */
function door(k: Maker, P: Pal, x: number, y0: number, z: number, w: number, h: number, leaf: Mat, frame?: Mat) {
  arch(k, frame ?? P.stoneDk, x, y0, z - 0.01, w + 0.16, h + 0.08, 0.08)
  arch(k, leaf, x, y0, z + 0.02, w, h, 0.07)
  k.cub(P.gold, x, y0 + (h - w / 2) * 0.45, z + 0.07, 0.03, 0.42 * h, 0.03, 0, false)
  k.orb(P.gold, x + w * 0.3, y0 + h * 0.45, z + 0.07, 0.035)
}

/** Windows round a drum of radius r centred in the frame, facing `face` ± spread. */
function drumWindows(k: Maker, P: Pal, r: number, y0: number, w: number, h: number, n: number, face: number, spread: number, o: WinOpts = {}) {
  for (let j = 0; j < n; j++) {
    const a = face + (n === 1 ? 0 : (j - (n - 1) / 2) * spread)
    k.push(Math.sin(a) * (r - 0.03), Math.cos(a) * (r - 0.03), a)
    windowAt(k, P, 0, y0, 0, w, h, o)
    k.pop()
  }
}

/** Merlons round a circle of radius r centred in the frame. */
function merlonRing(k: Maker, m: Mat, y0: number, r: number, n: number, w: number, h: number, d: number, off = 0) {
  for (let i = 0; i < n; i++) {
    const a = off + (i / n) * Math.PI * 2
    k.blk(m, Math.sin(a) * r, y0, Math.cos(a) * r, w, h, d, a)
  }
}

interface RoofOpts {
  ry?: number
  oh?: number
  ohx?: number
  t?: number
  cap?: Mat | null
  fill?: boolean
}
/**
 * A gable roof on walls of w (along the frame's x) by d, eaves at y0, rising h:
 * its gable ends (in `wall`) as one part, the roof slabs and ridge as the next.
 * Returns the ridge's top.
 */
function gable(k: Maker, roof: Mat, wall: Mat, x: number, y0: number, z: number, w: number, d: number, h: number, o: RoofOpts = {}) {
  const oh = o.oh ?? 0.2
  const ohx = o.ohx ?? 0.14
  const t = o.t ?? 0.15
  k.push(x, z, o.ry ?? 0)
  if (o.fill ?? true) {
    k.part()
    k.add(G.prism(), wall, 0, y0 + h / 2, 0, d, h, w, Math.PI / 2)
  }
  k.part()
  const th = Math.atan2(h, d / 2)
  const L = Math.hypot(d / 2, h) + oh
  const sn = Math.sin(th)
  const cs = Math.cos(th)
  for (const sg of [1, -1]) {
    const cy = y0 + h / 2 - sn * (oh / 2) + cs * (t / 2)
    const cz = sg * (d / 4) + sg * cs * (oh / 2) + sg * sn * (t / 2)
    k.add(G.box(), roof, 0, cy, cz, w + ohx * 2, t, L, 0, sg * th)
  }
  const top = y0 + h + t * cs
  const cr = Math.max(0.06, t * sn * 0.75)
  if (o.cap !== null) k.add(G.rod(), o.cap ?? roof, 0, y0 + h + t * cs * 0.55, 0, cr, w + ohx * 2 + 0.06, cr, 0, 0, Math.PI / 2)
  k.pop()
  return top
}

/** main's rose pennant on a gold pole, standing on (x, y0, z): two parts. Returns the top. */
function mainPennant(k: Maker, P: Pal, x: number, y0: number, z: number, h: number, s = 1) {
  k.part()
  k.rod(P.gold, x, y0, z, 0.032 * s, h, false)
  k.orb(P.gold, x, y0 + h + 0.05 * s, z, 0.075 * s)
  k.pennant(P.rose, x, y0 + h - 0.06 * s, z, 0.78 * s, 0.44 * s)
  return y0 + h + 0.12 * s
}

interface TowerSpec {
  r: number
  h: number
  y0?: number
  wall: Mat
  /** A stone lower course. */
  foot?: Mat
  roof: Mat
  roofH?: number
  roofR?: number
  flag?: Mat | null
  windows?: number
  crenel?: boolean
  corbel?: boolean
  /** A gold ring under the roof. */
  ring?: Mat
  /** Small and far up: one body part, no shadows. */
  lite?: boolean
}
/** A round tower in the frame at (x, z): courses, battlements, a cone roof, a finial and a pennant. Returns its top. */
function tower(k: Maker, P: Pal, x: number, z: number, s: TowerSpec): number {
  const y0 = s.y0 ?? 0
  const { r, h } = s
  const sh = !s.lite
  k.push(x, z)
  const face = k.local(k.outward())
  const h1 = s.lite ? h : Math.min(h * 0.5, 1.6)
  k.part()
  if (s.corbel) k.add(G.cone(), s.lite ? s.wall : P.stoneDk, 0, y0 - 0.25 * (r / 0.4), 0, r * 1.02, 0.5 * (r / 0.4), r * 1.02, 0, Math.PI, 0, sh)
  k.cyl(s.foot ?? s.wall, 0, y0, 0, r, h1, sh)
  if (y0 < 0.05) k.cyl(s.foot ?? s.wall, 0, 0, 0, r + 0.06, 0.16)
  if (!s.lite) k.part()
  if (h1 < h) k.cyl(s.wall, 0, y0 + h1, 0, r, h - h1)
  const n = s.windows ?? (r >= 0.42 ? 2 : 1)
  const ww = Math.min(0.24, r * 0.5)
  const wo: WinOpts = { frame: s.wall, sill: s.wall }
  if (n > 0) drumWindows(k, P, r, y0 + h * 0.6, ww, ww * 1.9, n, face, 1.05, wo)
  if (n > 0 && h > 2.2) drumWindows(k, P, r, y0 + h * 0.28, ww * 0.8, ww * 1.6, 1, face + 0.5, 0, wo)
  let top = y0 + h
  if (s.crenel) {
    k.cyl(s.wall, 0, top, 0, r + 0.09, 0.14)
    merlonRing(k, s.wall, top + 0.14, r + 0.02, Math.max(6, Math.round(r * 13)), 0.17, 0.2, 0.14, face)
    top += 0.34
  }
  k.part()
  const rh = s.roofH ?? r * 2.5
  const rr = s.roofR ?? r * 1.24
  k.cyl(P.gold, 0, y0 + h - 0.09, 0, r + 0.03, 0.08, false)
  if (s.ring) k.cyl(s.ring, 0, top, 0, rr * 0.98, 0.07, false)
  k.con(s.roof, 0, top + (s.ring ? 0.05 : 0), 0, rr, rh, sh)
  const tip = top + rh + (s.ring ? 0.05 : 0)
  k.orb(P.gold, 0, tip + 0.03, 0, Math.max(0.05, r * 0.13))
  if (s.flag) {
    k.rod(P.gold, 0, tip, 0, 0.022, 0.48, false)
    k.pennant(s.flag, 0, tip + 0.44, 0, 0.44, 0.25)
  }
  k.pop()
  return tip + (s.flag ? 0.5 : 0.1)
}

/** A straight stretch of wall with merlons along its outer edge (+z of the frame). */
function wallRun(k: Maker, wall: Mat, cap: Mat, x: number, z: number, len: number, h: number, t: number, ry: number, merlons = true) {
  k.push(x, z, ry)
  k.blk(wall, 0, 0, 0, len, h, t)
  k.cub(cap, 0, h - 0.02, 0, len + 0.02, 0.08, t + 0.06)
  if (merlons) {
    const n = Math.max(1, Math.round(len / 0.42))
    for (let i = 0; i < n; i++) k.blk(wall, -len / 2 + (i + 0.5) * (len / n), h + 0.06, t / 2 - 0.08, 0.22, 0.24, 0.16)
  }
  k.pop()
}

/** A ring wall of radius R in parts, a gap of `gap` (radians, either side) at the front. */
function curtain(k: Maker, wall: Mat, cap: Mat, R: number, h: number, t: number, n: number, gap: number, groups: number) {
  const seg = (Math.PI * 2) / n
  const keep: number[] = []
  for (let i = 0; i < n; i++) {
    const a = i * seg
    const d = Math.min(a, Math.PI * 2 - a)
    if (d > gap) keep.push(a)
  }
  // build round from the right of the gate, in `groups` parts
  const per = Math.ceil(keep.length / groups)
  for (let g = 0; g < keep.length; g += per) {
    k.part()
    for (const a of keep.slice(g, g + per)) wallRun(k, wall, cap, Math.sin(a) * R, Math.cos(a) * R, 2 * R * Math.sin(seg / 2) + 0.06, h, t, a)
  }
}

// ---- instanced kits: the grand tiers and the heritage stones ------------------------------
//
// A kit gathers every shape of a build that shares a shape and a paint into one
// InstancedMesh (Layer colours ride on per-instance colour), so thousands of
// stones and hundreds of towers cost a few dozen draw calls. A kit piece's
// reveal only rewrites its own instances.

type ItemKind = 'pop' | 'flag' | 'drape'
interface KitGroup {
  g: Geo
  m: Mat
  colored: boolean
  shadow: boolean
  n: number
  mesh: THREE.InstancedMesh | null
}
interface Item {
  grp: KitGroup
  i: number
  x: number
  y: number
  z: number
  yaw: number
  rx: number
  rz: number
  sx: number
  sy: number
  sz: number
  /** Half its height: pops grow from the foot. */
  hb: number
  drop: number
  kind: ItemKind
  stage: number
  at: number
  len: number
  color: THREE.Color | null
}

const _km = new THREE.Matrix4()
const _kp = new THREE.Vector3()
const _kq = new THREE.Quaternion()
const _ks = new THREE.Vector3()
const _ke = new THREE.Euler(0, 0, 0, 'YXZ')

/** Writes an item's matrix at build progress t (0 hidden, 1 finished). */
function placeItem(it: Item, t: number) {
  const im = it.grp.mesh
  if (!im) return
  if (t <= 0) _km.makeScale(0, 0, 0)
  else {
    const done = t >= 1
    const e = done ? 1 : Math.max(0.001, backOut(t))
    const c = done ? 1 : cubicOut(t)
    let { sx, sy, sz, y, yaw } = it
    if (it.kind === 'flag') {
      sx *= e
      sy *= 0.35 + 0.65 * c
      if (!done) yaw += Math.sin(t * 10) * (1 - t) * 0.6
    } else if (it.kind === 'drape') sy *= e
    else {
      sx *= e
      sy *= e
      sz *= e
      y = it.y - it.hb + it.hb * e + (1 - c) * it.drop
    }
    _ke.set(it.rx, yaw, it.rz, 'YXZ')
    _kq.setFromEuler(_ke)
    _km.compose(_kp.set(it.x, y, it.z), _kq, _ks.set(sx, sy, sz))
  }
  im.setMatrixAt(it.i, _km)
}

const WHITE = () => paint(0xffffff, { rough: 0.55 })

class Kit {
  private groups = new Map<string, KitGroup>()
  group(g: Geo, m: Mat, colored: boolean, shadow: boolean) {
    const key = `${g.uuid}:${m.uuid}:${colored ? 1 : 0}:${shadow ? 1 : 0}`
    let grp = this.groups.get(key)
    if (!grp) this.groups.set(key, (grp = { g, m, colored, shadow, n: 0, mesh: null }))
    return grp
  }
  /** Makes the meshes, every instance finished. */
  build(into: THREE.Group, items: Item[], trash: { dispose(): void }[]) {
    for (const grp of this.groups.values()) {
      if (!grp.n) continue
      const im = new THREE.InstancedMesh(grp.g, grp.m, grp.n)
      im.castShadow = grp.shadow
      im.receiveShadow = true
      im.frustumCulled = false
      im.name = 'castle batch'
      grp.mesh = im
      into.add(im)
      trash.push(im)
    }
    for (const it of items) {
      placeItem(it, 1)
      if (it.color) it.grp.mesh?.setColorAt(it.i, it.color)
    }
    for (const grp of this.groups.values()) if (grp.mesh?.instanceColor) grp.mesh.instanceColor.needsUpdate = true
  }
}

const PROXY = new THREE.MeshBasicMaterial({ visible: false })

/** Draws one piece into the kit, in a frame like the Maker's. */
class KitMaker {
  readonly items: Item[] = []
  private f: Frame = { x: 0, y: 0, z: 0, yaw: 0 }
  private stack: Frame[] = []
  private st = 0
  constructor(private kit: Kit) {}

  push(x: number, z: number, yaw = 0, y = 0): this {
    this.stack.push(this.f)
    const c = Math.cos(this.f.yaw)
    const s = Math.sin(this.f.yaw)
    this.f = { x: this.f.x + x * c + z * s, y: this.f.y + y, z: this.f.z - x * s + z * c, yaw: this.f.yaw + yaw }
    return this
  }
  pop(): this {
    this.f = this.stack.pop() ?? { x: 0, y: 0, z: 0, yaw: 0 }
    return this
  }
  /** The next stage pops in after the ones before it. */
  stage(): this {
    if (this.items.some((it) => it.stage === this.st)) this.st++
    return this
  }
  add(g: Geo, m: Mat, x: number, y: number, z: number, sx: number, sy: number, sz: number, ry = 0, rx = 0, rz = 0, o: { color?: THREE.Color; shadow?: boolean; kind?: ItemKind; hb?: number } = {}): this {
    const shadow = o.shadow ?? true
    const grp = this.kit.group(g, o.color ? WHITE() : m, !!o.color, shadow)
    const c = Math.cos(this.f.yaw)
    const s = Math.sin(this.f.yaw)
    const kind = o.kind ?? 'pop'
    const hb = o.hb ?? 0
    this.items.push({
      grp,
      i: grp.n++,
      x: this.f.x + x * c + z * s,
      y: this.f.y + y,
      z: this.f.z - x * s + z * c,
      yaw: this.f.yaw + ry,
      rx,
      rz,
      sx,
      sy,
      sz,
      hb,
      drop: 0.15 + Math.min(0.35, hb * 0.4),
      kind,
      stage: kind === 'pop' ? this.st : -1,
      at: 0,
      len: 1,
      color: o.color ?? null,
    })
    return this
  }
  blk(m: Mat, x: number, y0: number, z: number, w: number, h: number, d: number, ry = 0, color?: THREE.Color) {
    return this.add(G.box(), m, x, y0 + h / 2, z, w, h, d, ry, 0, 0, { hb: h / 2, color })
  }
  cub(m: Mat, x: number, y0: number, z: number, w: number, h: number, d: number, ry = 0, shadow = true) {
    return this.add(G.cube(), m, x, y0 + h / 2, z, w, h, d, ry, 0, 0, { hb: h / 2, shadow })
  }
  cyl(m: Mat, x: number, y0: number, z: number, r: number, h: number, shadow = true) {
    return this.add(r > 3 ? G.drumHi() : r < 0.8 ? G.drumLo() : G.drum(), m, x, y0 + h / 2, z, r, h, r, 0, 0, 0, { hb: h / 2, shadow })
  }
  con(m: Mat, x: number, y0: number, z: number, r: number, h: number, color?: THREE.Color) {
    return this.add(r < 0.8 ? G.coneLo() : G.cone(), m, x, y0 + h / 2, z, r, h, r, 0, 0, 0, { hb: h / 2, color })
  }
  orb(m: Mat, x: number, y: number, z: number, r: number) {
    return this.add(G.ball(), m, x, y, z, r, r, r, 0, 0, 0, { shadow: false })
  }
  /** A lit arched window facing the frame's +z at (x, z). */
  win(m: Mat, x: number, y0: number, z: number, w: number, h: number) {
    return this.add(G.arch(), m, x, y0 + h / 2, z, w, h / 2, 0.08, 0, 0, 0, { shadow: false, hb: h / 2 })
  }
  pennant(m: Mat, x: number, y: number, z: number, len: number, h: number, color?: THREE.Color) {
    return this.add(G.pennant(), m, x, y, z, len, h, 0.035, WIND - this.f.yaw, 0, 0, { kind: 'flag', shadow: false, color })
  }
  banner(m: Mat, x: number, y: number, z: number, w: number, h: number) {
    return this.add(G.banner(), m, x, y, z, w, h, 0.04, 0, 0, 0, { kind: 'drape', shadow: false })
  }
  /** Times the stages and returns the piece's reveal and its box. */
  finish(): { reveal: (p: number) => void; box: THREE.Box3 } {
    const items = this.items
    const stages = Math.max(0, ...items.map((it) => it.stage)) + 1
    const tail = items.some((it) => it.kind !== 'pop') ? 0.16 : 0
    const len = stages <= 1 ? 1 - tail : Math.min(0.55, Math.max(0.14, 2.4 / (stages + 1.4)))
    for (const it of items) {
      if (it.kind === 'pop') {
        it.len = Math.max(0.01, len)
        it.at = stages <= 1 ? 0 : (it.stage / (stages - 1)) * (1 - tail - len)
      } else {
        it.at = 1 - tail
        it.len = tail || 1
      }
    }
    // the box: each item's reach, roughly
    const box = new THREE.Box3()
    for (const it of items) {
      const r = Math.max(Math.abs(it.sx), Math.abs(it.sz)) * (it.rx || it.rz ? 1 : 0.71) + (it.rx || it.rz ? Math.abs(it.sy) * 0.5 : 0)
      box.expandByPoint(_kp.set(it.x - r, it.y - Math.abs(it.sy) * 0.5, it.z - r))
      box.expandByPoint(_kp.set(it.x + r, it.y + Math.abs(it.sy) * (it.kind === 'drape' ? 0 : 0.5), it.z + r))
    }
    // which instances of which meshes it touches, to upload only those
    const spans = new Map<KitGroup, [number, number]>()
    for (const it of items) {
      const s = spans.get(it.grp)
      if (s) (s[0] = Math.min(s[0], it.i)), (s[1] = Math.max(s[1], it.i))
      else spans.set(it.grp, [it.i, it.i])
    }
    const list = [...spans.entries()]
    const reveal = (p: number) => {
      for (const it of items) placeItem(it, p >= 1 ? 1 : clamp01((p - it.at) / it.len))
      for (const [grp, [a, b]] of list) {
        const im = grp.mesh
        if (!im) continue
        im.instanceMatrix.addUpdateRange(a * 16, (b - a + 1) * 16)
        im.instanceMatrix.needsUpdate = true
      }
    }
    return { reveal, box }
  }
}

// ---- builds -------------------------------------------------------------------------

type Solid = { kind: 'box'; box: THREE.Box3 } | { kind: 'disc'; x: number; z: number; r: number } | { kind: 'ring'; r0: number; r1: number }

interface Made {
  piece: CastlePiece
  box: THREE.Box3
  solid: Solid | null
  fixed: boolean
}

interface Ctx {
  tier: CastleTier
  group: THREE.Group
  made: Made[]
  P: Pal
  kit: Kit
  items: Item[]
  trash: { dispose(): void }[]
  /** Builders stand at least this far out (the tier's solid core). */
  hull: number
}

interface MakeOpts {
  /** What builders cannot stand in: default the piece's box when it is on the ground. */
  solid?: Solid | 'none'
  /** Where builders stand (x, z), when the search would not find a good spot. */
  anchor?: [number, number]
}

function addMade(c: Ctx, kind: CastlePiece['kind'], layer: number, order: number, object: THREE.Object3D, box: THREE.Box3, reveal: (p: number) => void, o: MakeOpts) {
  object.name = kind === 'base' ? `${c.tier.name} base` : kind === 'heritage' ? 'heritage stones' : `Layer ${layer}`
  c.group.add(object)
  const solid: Solid | null = o.solid === 'none' ? null : (o.solid ?? (box.min.y < 0.3 ? { kind: 'box', box: box.clone() } : null))
  const piece: CastlePiece = {
    object,
    kind,
    layer,
    order,
    anchor: o.anchor ? new THREE.Vector3(o.anchor[0], 0, o.anchor[1]) : new THREE.Vector3(),
    top: box.isEmpty() ? 0 : box.max.y,
    reveal,
  }
  const m: Made = { piece, box, solid, fixed: !!o.anchor }
  c.made.push(m)
  return m
}

function make(c: Ctx, kind: CastlePiece['kind'], layer: number, order: number, draw: (k: Maker) => void, o: MakeOpts = {}): Made {
  const k = new Maker()
  draw(k)
  return addMade(c, kind, layer, order, k.root, k.box, k.finish(), o)
}

/** A piece drawn into the build's kit: its object is an invisible box (for picking and sizing). */
function makeKit(c: Ctx, kind: CastlePiece['kind'], layer: number, order: number, draw: (k: KitMaker) => void, o: MakeOpts = {}): Made {
  const k = new KitMaker(c.kit)
  draw(k)
  const { reveal, box } = k.finish()
  for (const it of k.items) c.items.push(it)
  const object = new THREE.Group()
  if (!box.isEmpty() && kind !== 'heritage') {
    const proxy = new THREE.Mesh(G.cube(), PROXY)
    box.getCenter(proxy.position)
    box.getSize(proxy.scale)
    proxy.visible = false
    object.add(proxy)
  }
  return addMade(c, kind, layer, order, object, box, reveal, o)
}

const inSolid = (s: Solid, x: number, z: number, pad: number) => {
  if (s.kind === 'box') return x > s.box.min.x - pad && x < s.box.max.x + pad && z > s.box.min.z - pad && z < s.box.max.z + pad
  if (s.kind === 'disc') return Math.hypot(x - s.x, z - s.z) < s.r + pad
  const d = Math.hypot(x, z)
  return d > s.r0 - pad && d < s.r1 + pad
}

/** Finds each piece a spot on the ground just outside it, clear of the building. */
function placeAnchors(c: Ctx) {
  const solids = c.made.map((m) => m.solid).filter((s): s is Solid => !!s)
  for (const m of c.made) {
    if (m.fixed) continue
    const b = m.box
    if (b.isEmpty()) continue
    const cx = (b.min.x + b.max.x) / 2
    const cz = (b.min.z + b.max.z) / 2
    const d = Math.hypot(cx, cz)
    let dx = 0
    let dz = 1
    if (d > 0.25) (dx = cx / d), (dz = cz / d)
    let x = cx
    let z = cz
    for (let t = 0; t < 30; t += 0.06) {
      x = cx + dx * t
      z = cz + dz * t
      const r = Math.hypot(x, z)
      if (r > c.tier.radius + 1.2) break
      if (r < c.hull) {
        // jump straight to the hull
        t = Math.max(t, c.hull - d - 0.06)
        continue
      }
      if (inSolid({ kind: 'box', box: b }, x, z, 0.3)) continue
      if (solids.some((s) => inSolid(s, x, z, 0.28))) continue
      break
    }
    m.piece.anchor.set(x, 0, z)
  }
}

export function buildCastle(tierIndex: number, layers: LayerPaint[]): CastleBuild {
  const t = Math.max(0, Math.floor(Number.isFinite(tierIndex) ? tierIndex : 0))
  const tier = tierOf(t)
  const group = new THREE.Group()
  group.name = `castle: ${tier.name}`
  const kit = new Kit()
  const c: Ctx = { tier, group, made: [], P: palette(), kit, items: [], trash: [], hull: t < HULL.length ? HULL[t] : grandPlan(t).Rp + 0.35 }
  const slots = Math.max(0, Math.min(layers.length - tier.minLayers + 1, gapAfter(t)))
  if (t < BASES.length) BASES[t](c)
  else grandBase(c, t)
  // the stones of earlier tiers' Layers, round the foot
  heritage(c, layers.slice(0, Math.max(0, tier.minLayers - 1)))
  // one piece per Layer in this tier
  for (let k = 0; k < slots; k++) {
    const n = tier.minLayers + k
    const lp = layers[n - 1]
    if (!lp) continue
    if (t < SLOTS.length) SLOTS[t](c, k, lp, n)
    else grandSlot(c, t, k, lp, n)
  }
  kit.build(group, c.items, c.trash)
  placeAnchors(c)
  const pieces = c.made.map((m) => m.piece)
  const top = pieces.reduce((a, p) => Math.max(a, p.top), 0)
  let disposed = false
  return {
    tier,
    group,
    pieces,
    top,
    dispose() {
      group.removeFromParent()
      if (disposed) return
      disposed = true
      for (const d of c.trash) d.dispose()
      group.clear()
    },
  }
}

const HULL = [0, 0, 0, 0, 2.95, 2.3]

/**
 * Layers of earlier tiers: one piece, a path of coloured tiles round the
 * platform's foot from the gate's right, in rows when there are many (the
 * tiles shrink so even thousands keep to a band about 1.5 wide).
 */
function heritage(c: Ctx, layers: LayerPaint[]) {
  const n = layers.length
  if (!n) return
  const grand = c.tier.level >= HAND.length
  const R0 = grand ? grandPlan(c.tier.level).Rp + 0.42 : c.tier.radius + 0.38
  const band = 1.5
  const pitch = Math.min(0.62, Math.max(0.17, Math.sqrt((Math.PI * 2 * (R0 + band / 2) * band) / n)))
  const size = Math.min(0.42, pitch * 0.78)
  makeKit(
    c,
    'heritage',
    0,
    0,
    (k) => {
      let placed = 0
      for (let row = 0; placed < n; row++) {
        const R = R0 + row * pitch
        const gap = 0.6 / R + 0.12
        const per = Math.max(1, Math.floor((Math.PI * 2 * R - 2 * gap * R) / pitch))
        const take = Math.min(per, n - placed)
        const step = pitch / R
        for (let j = 0; j < take; j++) {
          // odd rows run the other way, so the path snakes
          const a = row % 2 ? -gap - step * (j + 0.5) : gap + step * (j + 0.5)
          k.add(n > 160 ? G.tileLo() : G.tile(), c.P.white, Math.sin(a) * R, size * 0.15 + 0.004, Math.cos(a) * R, size, size, size, a, 0, 0, { color: layers[placed + j].color, shadow: false, hb: size * 0.15 })
        }
        placed += take
      }
    },
    { solid: 'none', anchor: [Math.sin(0.5) * (R0 + 0.6), Math.cos(0.5) * (R0 + 0.6)] },
  )
  // stagger: tile i pops in its turn
  const items = c.items.slice(-n)
  items.forEach((it, i) => {
    it.at = (i / Math.max(1, n)) * 0.8
    it.len = 0.2
  })
}

// ---- tier 0: the camp -------------------------------------------------------------------

function campBase(c: Ctx) {
  const P = c.P
  make(
    c,
    'base',
    0,
    0,
    (k) => {
      k.part()
      k.cyl(P.dirt, 0.72, 0, 0.58, 0.62, 0.03)
      k.cyl(P.dirt, -1.0, 0, 0.62, 0.45, 0.02)
      k.part()
      for (let i = 0; i < 7; i++) {
        const a = i * 0.9 + 0.3
        k.con(P.leaf, Math.sin(a) * 1.42, 0, Math.cos(a) * 1.42, 0.07, 0.16 + (i % 3) * 0.04, false)
      }
    },
    { solid: 'none' },
  )
  // the tent: canvas, royal bands, a door
  make(c, 'base', 0, 1, (k) => {
    k.push(-0.38, -0.3, 0.42)
    k.part()
    k.prism(P.canvas, 0, 0, 0, 1.45, 1.22, 1.6)
    for (const [x, z] of [[-0.82, 0.75], [0.82, 0.75], [-0.82, -0.75], [0.82, -0.75]]) k.cub(P.timber, x, 0, z, 0.06, 0.12, 0.06)
    k.part()
    for (const z of [-0.5, 0.5]) k.prism(P.royal, 0, -0.01, z, 1.53, 1.29, 0.22)
    k.add(G.rod(), P.timber, 0, 1.25, 0, 0.045, 1.8, 0.045, 0, Math.PI / 2)
    k.part()
    k.prism(P.rose, 0, 0, 0.805, 0.82, 0.96, 0.03)
    k.prism(P.dark, 0, 0, 0.82, 0.6, 0.76, 0.03)
    k.cub(P.gold, 0, 0.98, 0.84, 0.06, 0.06, 0.02, Math.PI / 4)
    k.pop()
  })
  // the campfire
  make(c, 'base', 0, 1, (k) => {
    k.push(0.72, 0.58)
    k.part()
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2
      k.orb(i % 2 ? P.stone : P.stoneDk, Math.sin(a) * 0.3, 0.05, Math.cos(a) * 0.3, 0.1, 0.6, true)
    }
    k.part()
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.4
      k.add(G.rod(), P.timber, -Math.sin(a) * 0.1, 0.17, -Math.cos(a) * 0.1, 0.04, 0.46, 0.04, a, 0.6)
    }
    k.part()
    k.con(P.fire, 0, 0.05, 0, 0.17, 0.48, false)
    k.con(P.fire, 0.09, 0.05, -0.05, 0.09, 0.3, false)
    k.con(P.fire, -0.08, 0.05, 0.06, 0.08, 0.26, false)
    k.con(P.flame, 0.03, 0.05, 0.05, 0.1, 0.32, false)
    k.orb(P.flame, 0.12, 0.42, -0.05, 0.03)
    k.orb(P.fire, -0.08, 0.55, 0.04, 0.025)
    k.pop()
  })
  // logs to sit on, and the builders' woodpile
  make(c, 'base', 0, 2, (k) => {
    for (const [x, z, a] of [[0.18, 1.22, 0.2], [1.45, 0.25, 1.55]]) {
      k.push(x, z, a)
      k.part()
      k.add(G.rod(), P.timber, 0, 0.12, 0, 0.12, 0.78, 0.12, 0, 0, Math.PI / 2)
      for (const s of [-1, 1]) k.add(G.drum(), P.thatch, s * 0.39, 0.12, 0, 0.1, 0.02, 0.1, 0, 0, Math.PI / 2, false)
      k.pop()
    }
  })
  make(c, 'base', 0, 2, (k) => {
    k.push(-1.08, 0.62, -0.5)
    k.part()
    k.blk(P.timber, 0, 0, 0, 0.44, 0.4, 0.44)
    k.cub(P.wood, 0, 0.18, 0.225, 0.46, 0.06, 0.02)
    k.cub(P.wood, 0, 0.18, -0.225, 0.46, 0.06, 0.02)
    k.part()
    for (let i = 0; i < 3; i++) k.cub(P.wood, 0.45, i * 0.065, 0.05 + (i % 2) * 0.03, 0.18, 0.06, 0.82, 0.05 * i)
    k.part()
    k.blk(P.stoneDk, 0, 0.4, 0, 0.3, 0.22, 0.24, 0.3)
    k.pop()
  })
  // main's flag, the camp's highest point
  make(c, 'base', 0, 4, (k) => {
    k.push(0.5, -0.88)
    k.part()
    for (let i = 0; i < 4; i++) k.orb(P.stone, Math.sin(i * 1.7) * 0.14, 0.06, Math.cos(i * 1.7) * 0.14, 0.11, 0.7, true)
    k.part()
    k.rod(P.timber, 0, 0, 0, 0.04, 2.0)
    mainPennant(k, P, 0, 2.0, 0, 0.08)
    k.pop()
  })
}

// ---- tier 1: the cottage ------------------------------------------------------------------

// the cottage: walls 2.1 × 1.6 at (0, -0.1), on a plinth 0.2 high, eaves at 1.6
const CZ = -0.1
const CFRONT = CZ + 0.8

function cottageBase(c: Ctx) {
  const P = c.P
  make(c, 'base', 0, 0, (k) => {
    k.part()
    k.cyl(P.stoneDk, 0, 0, 0, 1.93, 0.03, false)
    k.cyl(P.yard, 0, 0, 0, 1.88, 0.05, false)
    k.blk(P.stoneDk, 0, 0, CZ, 2.3, 0.22, 1.82)
    k.blk(P.stone, 0.4, 0, CFRONT + 0.2, 0.78, 0.12, 0.38)
    k.part()
    for (const [i, z] of [1.32, 1.66].entries()) k.add(G.tile(), P.sand, 0.42 + (i % 2) * 0.06, 0.03, z, 0.42, 0.4, 0.36, i * 0.3, 0, 0, false)
  }, { solid: { kind: 'box', box: new THREE.Box3(new THREE.Vector3(-1.2, 0, -1.05), new THREE.Vector3(1.2, 1, 0.95)) } })
  make(c, 'base', 0, 1, (k) => {
    k.part()
    k.blk(P.cream, 0, 0.2, CZ, 2.1, 1.42, 1.6)
    k.part()
    for (const x of [-1.04, 1.04]) for (const z of [CZ - 0.79, CZ + 0.79]) k.cub(P.timber, x, 0.2, z, 0.14, 1.42, 0.14)
    for (const z of [CZ - 0.81, CZ + 0.81]) k.cub(P.timber, -0.05, 0.2, z, 0.1, 1.42, 0.04)
    k.cub(P.timber, 0, 1.5, CZ, 2.18, 0.14, 1.68)
    k.cub(P.timber, 0, 0.2, CZ, 2.16, 0.1, 1.66)
    k.part()
    door(k, P, 0.4, 0.2, CFRONT, 0.58, 1.1, P.royal, P.timber)
    // the round window
    k.add(G.drum(), P.gold, -0.55, 0.98, CFRONT + 0.01, 0.28, 0.06, 0.28, 0, Math.PI / 2, 0, false)
    k.add(G.drum(), P.glow, -0.55, 0.98, CFRONT + 0.04, 0.21, 0.04, 0.21, 0, Math.PI / 2, 0, false)
    k.cub(P.timber, -0.55, 0.78, CFRONT + 0.07, 0.04, 0.4, 0.02, 0, false)
    k.cub(P.timber, -0.55, 0.96, CFRONT + 0.07, 0.4, 0.04, 0.02, 0, false)
    k.cub(P.timber, -0.55, 0.62, CFRONT + 0.1, 0.56, 0.1, 0.14, 0, false)
    for (let i = 0; i < 5; i++) k.orb(i % 2 ? P.rose : P.pink, -0.75 + i * 0.1, 0.71, CFRONT + 0.14, 0.05)
    // windows round the back and the gable ends
    k.push(0, CZ - 0.8, Math.PI)
    windowAt(k, P, 0.3, 0.7, 0, 0.36, 0.48, { shutters: P.royal, arched: false })
    k.pop()
    for (const s of [-1, 1]) {
      k.push(s * 1.05, CZ, (s * Math.PI) / 2)
      windowAt(k, P, 0, 0.72, 0, 0.32, 0.44, { shutters: P.royal, arched: false })
      k.pop()
    }
    k.part()
    k.add(G.drum(), P.timber, 1.42, 0.3, -0.75, 0.2, 0.6, 0.2)
    k.cyl(P.stoneDk, 1.42, 0.2, -0.75, 0.21, 0.04)
    k.cyl(P.stoneDk, 1.42, 0.45, -0.75, 0.21, 0.04)
    k.cyl(P.timberDk, 1.42, 0.6, -0.75, 0.19, 0.02)
  })
  make(c, 'base', 0, 3, (k) => {
    gable(k, P.royal, P.cream, 0, 1.62, CZ, 2.12, 1.66, 1.05, { oh: 0.22, ohx: 0.16, t: 0.24, cap: P.royal })
    k.part()
    k.orb(P.gold, 1.2, 2.66, CZ, 0.07)
  })
  make(c, 'base', 0, 4, (k) => mainPennant(k, P, -0.78, 2.7, CZ, 0.95))
}

function cottageSlot(c: Ctx, k0: number, lp: LayerPaint, n: number) {
  const P = c.P
  const A = accent(lp)
  if (k0 === 0) {
    // a chimney on the back slope, with smoke
    make(c, 'slot', n, 10 + k0, (k) => {
      k.push(0.55, CZ - 0.42)
      k.part()
      k.blk(P.stone, 0, 1.9, 0, 0.4, 0.62, 0.4)
      k.part()
      k.blk(P.stone, 0, 2.52, 0, 0.4, 0.46, 0.4)
      k.blk(A.m, 0, 2.86, 0, 0.48, 0.16, 0.48)
      k.part()
      k.cyl(A.dk, 0, 3.02, 0, 0.11, 0.16)
      k.part()
      k.orb(P.smoke, 0.05, 3.42, -0.02, 0.13)
      k.part()
      k.orb(P.smoke, 0.2, 3.74, -0.06, 0.17)
      k.part()
      k.orb(P.smoke, 0.44, 4.12, -0.1, 0.21)
      k.pop()
    }, { anchor: [1.15, -1.45] })
  } else if (k0 === 1) {
    // a flower garden with a picket fence, on the left
    make(c, 'slot', n, 10 + k0, (k) => {
      k.part()
      k.blk(P.dirt, -1.46, 0, 0.08, 0.44, 0.12, 1.42)
      k.part()
      for (let i = 0; i < 7; i++) {
        const z = -0.5 + i * 0.19
        k.orb(P.leaf, -1.46 + (i % 2 ? 0.06 : -0.06), 0.2, z, 0.12, 0.85, true)
        k.orb(i % 3 === 1 ? A.lt : A.m, -1.46 + (i % 2 ? -0.07 : 0.08), 0.33, z + 0.04, 0.065)
      }
      k.part()
      const post = (x: number, z: number) => {
        k.cub(P.white, x, 0, z, 0.06, 0.4, 0.05)
        k.prism(P.white, x, 0.4, z, 0.06, 0.06, 0.05)
      }
      for (let i = 0; i <= 8; i++) post(-1.8, -0.7 + i * 0.19)
      for (let i = 1; i <= 3; i++) post(-1.8 + i * 0.17, 0.82)
      k.cub(P.white, -1.8, 0.14, 0.06, 0.03, 0.04, 1.52)
      k.cub(P.white, -1.8, 0.3, 0.06, 0.03, 0.04, 1.52)
      k.cub(P.white, -1.55, 0.22, 0.82, 0.5, 0.04, 0.03)
      k.part()
      k.rod(P.timber, -1.8, 0, 0.84, 0.035, 0.85)
      k.orb(P.gold, -1.8, 0.88, 0.84, 0.04)
      k.pennant(A.m, -1.8, 0.82, 0.84, 0.32, 0.2)
    })
  } else {
    // a porch over the door, a lantern under it
    make(c, 'slot', n, 10 + k0, (k) => {
      k.part()
      k.blk(A.m, 0.4, 0.12, CFRONT + 0.2, 0.56, 0.03, 0.3)
      for (const s of [-1, 1]) k.rod(P.timber, 0.4 + s * 0.42, 0, CFRONT + 0.62, 0.05, 1.36)
      for (const s of [-1, 1]) {
        k.cyl(P.timberDk, 0.4 + s * 0.62, 0, CFRONT + 0.62, 0.09, 0.14)
        k.orb(P.leaf, 0.4 + s * 0.62, 0.22, CFRONT + 0.62, 0.11, 0.9, true)
        k.orb(A.lt, 0.4 + s * 0.62, 0.3, CFRONT + 0.66, 0.05)
      }
      gable(k, A.m, A.lt, 0.4, 1.36, CFRONT + 0.36, 0.78, 1.0, 0.34, { ry: Math.PI / 2, oh: 0.1, ohx: 0.06, t: 0.1, cap: P.gold })
      k.part()
      k.rod(P.gold, 0.4, 1.12, CFRONT + 0.48, 0.012, 0.28, false)
      k.con(P.gold, 0.4, 1.12, CFRONT + 0.48, 0.08, 0.08, false)
      k.orb(P.glow, 0.4, 1.06, CFRONT + 0.48, 0.07)
      k.cyl(P.gold, 0.4, 0.98, CFRONT + 0.48, 0.05, 0.03, false)
    })
  }
}

// ---- tier 2: the house ------------------------------------------------------------------

// two storeys: 2.6 × 2.0 at (0, -0.25); stone to 1.6, a band, cream to 2.94, eaves at 2.94
const HZ = -0.25
const HFRONT = HZ + 1.0

function houseBase(c: Ctx) {
  const P = c.P
  const flowers = [P.rose, P.pink, P.white]
  make(c, 'base', 0, 0, (k) => {
    k.part()
    k.cyl(P.stoneDk, 0.12, 0, -0.05, 2.5, 0.06)
    k.cyl(P.stone, 0.12, 0, -0.05, 2.44, 0.1)
    k.blk(P.stoneDk, 0, 0, HZ, 2.82, 0.2, 2.22)
    k.blk(P.stone, 0, 0, HFRONT + 0.18, 1.0, 0.16, 0.36)
    k.blk(P.stone, 0, 0, HFRONT + 0.42, 1.2, 0.08, 0.36)
    k.part()
    for (const [i, z] of [1.52, 1.86].entries()) k.add(G.tile(), P.sand, 0.04 * (i % 2 ? 1 : -1), 0.1, z, 0.5, 0.4, 0.34, 0.1 * i, 0, 0, false)
  }, { solid: { kind: 'box', box: new THREE.Box3(new THREE.Vector3(-1.45, 0, -1.4), new THREE.Vector3(1.45, 1, 1.0)) } })
  make(c, 'base', 0, 1, (k) => {
    k.part()
    k.blk(P.stone, 0, 0.18, HZ, 2.6, 1.44, 2.0)
    k.part()
    for (const x of [-1.27, 1.27])
      for (const z of [HZ - 0.97, HZ + 0.97]) for (let i = 0; i < 3; i++) k.blk(P.stoneDk, x, 0.24 + i * 0.46, z, i % 2 ? 0.16 : 0.26, 0.34, i % 2 ? 0.26 : 0.16)
    k.part()
    door(k, P, 0, 0.18, HFRONT, 0.66, 1.14, P.royal)
    for (const x of [-0.85, 0.85]) windowAt(k, P, x, 0.68, HFRONT, 0.42, 0.58, { shutters: P.royal, flowers })
    for (const s of [-1, 1]) {
      k.push(s * 1.3, HZ, (s * Math.PI) / 2)
      windowAt(k, P, -0.4, 0.68, 0, 0.36, 0.52, { arched: true })
      k.pop()
    }
    k.push(0, HZ - 1.0, Math.PI)
    for (const x of [-0.7, 0.7]) windowAt(k, P, x, 0.68, 0, 0.38, 0.52, {})
    k.pop()
  })
  make(c, 'base', 0, 2, (k) => {
    k.part()
    k.cub(P.timber, 0, 1.6, HZ, 2.7, 0.14, 2.1)
    k.part()
    k.blk(P.cream, 0, 1.72, HZ, 2.56, 1.24, 1.96)
    for (const x of [-1.27, 1.27]) for (const z of [HZ - 0.97, HZ + 0.97]) k.cub(P.timber, x, 1.72, z, 0.12, 1.22, 0.12)
    k.cub(P.timber, 0, 2.86, HZ, 2.64, 0.1, 2.04)
    k.part()
    for (const x of [-0.85, 0, 0.85]) windowAt(k, P, x, 2.08, HFRONT - 0.02, 0.38, 0.52, { shutters: x ? P.royal : undefined, flowers: x ? flowers : null })
    for (const s of [-1, 1]) {
      k.push(s * 1.28, HZ, (s * Math.PI) / 2)
      windowAt(k, P, 0.3, 2.1, 0, 0.34, 0.48, { shutters: P.royal, arched: false })
      k.pop()
    }
    k.push(0, HZ - 0.98, Math.PI)
    for (const x of [-0.6, 0.6]) windowAt(k, P, x, 2.1, 0, 0.36, 0.48, { arched: false })
    k.pop()
  })
  make(c, 'base', 0, 3, (k) => {
    gable(k, P.royal, P.cream, 0, 2.94, HZ, 2.56, 1.98, 1.22, { oh: 0.24, ohx: 0.18, t: 0.16, cap: P.gold })
    // a dormer on the front slope
    k.part()
    k.blk(P.cream, 0, 3.05, HZ + 0.52, 0.62, 0.66, 0.7)
    windowAt(k, P, 0, 3.18, HZ + 0.87, 0.3, 0.38, { arched: false })
    gable(k, P.royal, P.cream, 0, 3.7, HZ + 0.52, 0.8, 0.7, 0.34, { ry: Math.PI / 2, oh: 0.08, ohx: 0.08, t: 0.1, cap: P.royal })
    // the chimney, still smoking
    k.part()
    k.blk(P.stone, 0.9, 3.3, HZ - 0.72, 0.4, 1.3, 0.4)
    k.blk(P.stoneDk, 0.9, 4.56, HZ - 0.72, 0.48, 0.12, 0.48)
    k.cyl(P.timberDk, 0.9, 4.66, HZ - 0.72, 0.1, 0.14)
    k.part()
    k.orb(P.smoke, 0.98, 5.0, HZ - 0.76, 0.14)
    k.orb(P.smoke, 1.15, 5.32, HZ - 0.8, 0.18)
  })
  make(c, 'base', 0, 4, (k) => mainPennant(k, P, 0.32, 4.22, HZ, 1.12, 1.1))
}

function houseSlot(c: Ctx, k0: number, lp: LayerPaint, n: number) {
  const P = c.P
  const A = accent(lp)
  const order = 10 + k0
  if (k0 === 0) {
    // a side wing on the right, roofed in the Layer's colour
    make(c, 'slot', n, order, (k) => {
      k.push(1.8, HZ - 0.12)
      k.part()
      k.blk(P.stoneDk, 0, 0, 0, 1.15, 0.16, 1.5)
      k.part()
      k.blk(P.cream, 0, 0.14, 0, 1.04, 1.32, 1.38)
      for (const x of [0.5]) for (const z of [-0.68, 0.68]) k.cub(P.timber, x, 0.14, z, 0.12, 1.32, 0.12)
      k.cub(P.timber, 0, 1.4, 0, 1.08, 0.1, 1.42)
      k.part()
      windowAt(k, P, 0, 0.55, 0.69, 0.4, 0.52, { shutters: A.m, flowers: [A.m, A.lt, P.white] })
      k.push(0.52, 0, Math.PI / 2)
      windowAt(k, P, 0, 0.55, 0, 0.36, 0.5, { shutters: A.m })
      k.pop()
      gable(k, A.m, P.cream, 0, 1.46, 0, 1.4, 1.06, 0.62, { ry: Math.PI / 2, oh: 0.16, ohx: 0.14, t: 0.13, cap: P.gold })
      k.part()
      k.orb(P.gold, 0, 2.18, 0.78, 0.06)
      k.pop()
    })
  } else if (k0 === 1) {
    // a balcony with an awning, over the door
    make(c, 'slot', n, order, (k) => {
      k.part()
      for (const s of [-1, 1]) k.add(G.cube(), P.timber, s * 0.42, 1.48, HFRONT + 0.14, 0.08, 0.28, 0.08, 0, -0.6)
      k.blk(P.stone, 0, 1.6, HFRONT + 0.24, 1.16, 0.12, 0.52)
      k.part()
      for (let i = 0; i <= 6; i++) k.rod(A.m, -0.52 + i * 0.173, 1.72, HFRONT + 0.46, 0.022, 0.36, false)
      for (const s of [-1, 1]) for (let i = 0; i < 2; i++) k.rod(A.m, s * 0.52, 1.72, HFRONT + 0.06 + i * 0.2, 0.022, 0.36, false)
      k.cub(A.m, 0, 2.06, HFRONT + 0.46, 1.1, 0.05, 0.06)
      for (const s of [-1, 1]) k.cub(A.m, s * 0.52, 2.06, HFRONT + 0.24, 0.06, 0.05, 0.46)
      k.part()
      for (const s of [-1, 1]) {
        k.cyl(P.timberDk, s * 0.4, 1.72, HFRONT + 0.3, 0.07, 0.1)
        k.orb(P.leaf, s * 0.4, 1.86, HFRONT + 0.3, 0.1)
        k.orb(A.lt, s * 0.4, 1.94, HFRONT + 0.33, 0.05)
      }
      k.part()
      for (let i = 0; i < 4; i++) k.add(G.cube(), i % 2 ? P.white : A.m, -0.3 + i * 0.2, 2.74, HFRONT + 0.2, 0.2, 0.04, 0.46, 0, 0.45)
      k.cub(A.dk, 0, 2.86, HFRONT + 0.02, 0.86, 0.06, 0.06)
    })
  } else if (k0 === 2) {
    // a little bell tower on the ridge
    make(c, 'slot', n, order, (k) => {
      k.push(-0.82, HZ)
      k.part()
      k.blk(P.cream, 0, 3.86, 0, 0.6, 0.66, 0.6)
      k.cub(P.gold, 0, 4.48, 0, 0.66, 0.06, 0.66)
      k.part()
      for (const x of [-0.24, 0.24]) for (const z of [-0.24, 0.24]) k.cub(P.cream, x, 4.52, z, 0.1, 0.56, 0.1)
      k.con(P.gold, 0, 4.66, 0, 0.13, 0.22)
      k.orb(P.gold, 0, 4.68, 0, 0.05)
      k.part()
      k.pyr(A.m, 0, 5.06, 0, 0.84, 0.66, 0.84)
      k.cub(A.dk, 0, 5.04, 0, 0.8, 0.05, 0.8)
      k.orb(P.gold, 0, 5.74, 0, 0.05)
      k.rod(P.gold, 0, 5.72, 0, 0.018, 0.34, false)
      k.pennant(A.m, 0, 6.02, 0, 0.32, 0.18)
      k.pop()
    }, { anchor: [-1.75, 0.5] })
  } else {
    // a low garden wall in front, with a little roofed gate
    make(c, 'slot', n, order, (k) => {
      const z = 1.78
      k.part()
      for (const s of [-1, 1]) {
        k.blk(P.stone, s * 1.0, 0, z, 1.0, 0.5, 0.24)
        k.cub(P.stoneDk, s * 1.0, 0.48, z, 1.04, 0.07, 0.3)
        k.blk(P.stone, s * 1.5, 0, z - 0.36, 0.24, 0.5, 0.72)
        k.cub(P.stoneDk, s * 1.5, 0.48, z - 0.36, 0.3, 0.07, 0.76)
      }
      k.part()
      for (const s of [-1, 1]) {
        k.blk(P.stone, s * 0.5, 0, z, 0.3, 0.86, 0.3)
        k.blk(A.m, s * 0.5, 0.84, z, 0.36, 0.08, 0.36)
      }
      k.part()
      for (const s of [-1, 1]) k.cub(P.timber, s * 0.21, 0.08, z + 0.12, 0.38, 0.62, 0.05, s * -0.5)
      gable(k, A.m, P.timber, 0, 0.92, z, 1.12, 0.46, 0.28, { oh: 0.07, ohx: 0.06, t: 0.08, cap: P.gold, fill: true })
      k.part()
      k.rod(P.gold, 0, 0.74, z + 0.05, 0.01, 0.18, false)
      k.orb(P.glow, 0, 0.72, z + 0.05, 0.06)
    })
  }
}

// ---- tier 3: the manor ------------------------------------------------------------------

// an L: the hall along the back, the wing down the left, the courtyard in the crook
const HALL = { x: -0.1, z: -1.3, w: 4.0, d: 1.6 }
const WING = { x: -1.35, z: 0.4, w: 1.5, d: 2.4 }
const MTOWER = { x: -1.35, z: -1.3, r: 0.86 }

function manorBase(c: Ctx) {
  const P = c.P
  const flowers = [P.rose, P.pink, P.white]
  const fh = HALL.z + HALL.d / 2
  const wr = WING.x + WING.w / 2
  make(c, 'base', 0, 0, (k) => {
    k.part()
    k.cyl(P.stoneDk, 0, 0, -0.1, 3.18, 0.08)
    k.cyl(P.stone, 0, 0, -0.1, 3.0, 0.16)
    k.cyl(P.gold, 0, 0.11, -0.1, 3.02, 0.04, false)
    k.part()
    k.blk(P.stoneDk, HALL.x, 0, HALL.z, HALL.w + 0.2, 0.24, HALL.d + 0.2)
    k.blk(P.stoneDk, WING.x, 0, WING.z, WING.w + 0.2, 0.24, WING.d + 0.2)
    k.part()
    k.blk(P.stoneDk, 0.8, 0.14, 0.86, 2.86, 0.04, 2.72)
    k.blk(P.sand, 0.8, 0.15, 0.86, 2.7, 0.05, 2.56)
  }, { solid: { kind: 'box', box: new THREE.Box3(new THREE.Vector3(-2.2, 0, -2.2), new THREE.Vector3(-0.5, 1, 1.7)) } })
  // the ground floors, in stone
  make(c, 'base', 0, 1, (k) => {
    k.part()
    k.blk(P.stone, HALL.x, 0.14, HALL.z, HALL.w, 1.34, HALL.d)
    k.part()
    k.blk(P.stone, WING.x, 0.14, WING.z, WING.w, 1.34, WING.d)
    k.part()
    door(k, P, 0.1, 0.14, fh, 0.74, 1.14, P.royal)
    for (const x of [1.0, 1.65]) windowAt(k, P, x, 0.6, fh, 0.36, 0.5, { shutters: P.royal })
    k.push(wr, 0, Math.PI / 2)
    windowAt(k, P, 0.02, 0.6, 0, 0.36, 0.5, { flowers })
    door(k, P, -0.95, 0.14, 0, 0.6, 1.08, P.royal)
    k.pop()
    k.push(WING.x, WING.z + WING.d / 2)
    for (const x of [-0.4, 0.4]) windowAt(k, P, x, 0.6, 0, 0.34, 0.5, { flowers })
    k.pop()
    k.push(WING.x - WING.w / 2, WING.z, -Math.PI / 2)
    for (const x of [-0.7, 0.4]) windowAt(k, P, x, 0.6, 0, 0.34, 0.5, {})
    k.pop()
    k.push(HALL.x, HALL.z - HALL.d / 2, Math.PI)
    for (const x of [-1.2, -0.2, 0.8]) windowAt(k, P, x, 0.6, 0, 0.36, 0.5, {})
    k.pop()
  }, { solid: { kind: 'box', box: new THREE.Box3(new THREE.Vector3(-2.2, 0, -2.2), new THREE.Vector3(2.0, 1, -0.45)) } })
  // the upper floors, in cream
  make(c, 'base', 0, 2, (k) => {
    k.part()
    k.cub(P.timber, HALL.x, 1.46, HALL.z, HALL.w + 0.1, 0.12, HALL.d + 0.1)
    k.cub(P.timber, WING.x, 1.46, WING.z, WING.w + 0.1, 0.12, WING.d + 0.1)
    k.part()
    k.blk(P.cream, HALL.x, 1.56, HALL.z, HALL.w - 0.04, 1.2, HALL.d - 0.04)
    k.blk(P.cream, WING.x, 1.56, WING.z, WING.w - 0.04, 1.2, WING.d - 0.04)
    k.cub(P.timber, HALL.x, 2.68, HALL.z, HALL.w + 0.04, 0.08, HALL.d + 0.04)
    k.cub(P.timber, WING.x, 2.68, WING.z, WING.w + 0.04, 0.08, WING.d + 0.04)
    k.part()
    for (const x of [-0.3, 0.5, 1.3]) windowAt(k, P, x, 1.86, fh - 0.02, 0.36, 0.52, { shutters: P.royal, flowers: x === 0.5 ? null : flowers })
    k.push(wr - 0.02, 0, Math.PI / 2)
    for (const z of [-0.95, 0.02]) windowAt(k, P, z, 1.86, 0, 0.34, 0.5, { shutters: P.royal })
    k.pop()
    k.push(WING.x, WING.z + WING.d / 2 - 0.02)
    windowAt(k, P, 0, 1.86, 0, 0.4, 0.56, { shutters: P.royal, flowers })
    k.pop()
    k.push(HALL.x, HALL.z - HALL.d / 2 + 0.02, Math.PI)
    for (const x of [-1.2, -0.2, 0.8]) windowAt(k, P, x, 1.86, 0, 0.34, 0.5, { arched: false })
    k.pop()
  })
  // the roofs
  make(c, 'base', 0, 3, (k) => {
    gable(k, P.royal, P.cream, HALL.x, 2.76, HALL.z, HALL.w - 0.04, HALL.d - 0.04, 1.02, { oh: 0.24, ohx: 0.16, t: 0.15, cap: P.gold })
    gable(k, P.royal, P.cream, WING.x, 2.76, WING.z + 0.1, WING.d - 0.2, WING.w - 0.04, 0.98, { ry: Math.PI / 2, oh: 0.24, ohx: 0.16, t: 0.15, cap: P.gold })
    k.part()
    k.blk(P.stone, 1.2, 3.2, HALL.z - 0.42, 0.42, 1.0, 0.42)
    k.blk(P.stoneDk, 1.2, 4.16, HALL.z - 0.42, 0.5, 0.12, 0.5)
    k.cyl(P.timberDk, 1.2, 4.26, HALL.z - 0.42, 0.1, 0.14)
  })
  // the central tower at the crook of the L
  make(c, 'base', 0, 3, (k) => {
    k.push(MTOWER.x, MTOWER.z)
    k.part()
    k.cyl(P.stone, 0, 0, 0, MTOWER.r, 2.7)
    k.part()
    k.cyl(P.cream, 0, 2.7, 0, MTOWER.r, 1.9)
    k.cyl(P.gold, 0, 2.66, 0, MTOWER.r + 0.03, 0.08, false)
    drumWindows(k, P, MTOWER.r, 3.4, 0.28, 0.5, 3, Math.PI / 4, 0.9, { shutters: undefined })
    k.add(G.drum(), P.gold, Math.sin(Math.PI / 4) * MTOWER.r, 4.15, Math.cos(Math.PI / 4) * MTOWER.r, 0.2, 0.05, 0.2, Math.PI / 4, Math.PI / 2, 0, false)
    k.part()
    k.cyl(P.cream, 0, 4.6, 0, MTOWER.r + 0.1, 0.16)
    k.cyl(P.gold, 0, 4.72, 0, MTOWER.r + 0.12, 0.06, false)
    k.part()
    k.con(P.royal, 0, 4.78, 0, MTOWER.r * 1.24, 2.3)
    k.orb(P.gold, 0, 7.1, 0, 0.1)
    k.pop()
  }, { anchor: [-0.25, -0.1], solid: { kind: 'disc', x: MTOWER.x, z: MTOWER.z, r: MTOWER.r } })
  make(c, 'base', 0, 4, (k) => mainPennant(k, P, MTOWER.x, 7.12, MTOWER.z, 1.2, 1.25), { anchor: [-0.25, -0.1] })
}

function manorSlot(c: Ctx, k0: number, lp: LayerPaint, n: number) {
  const P = c.P
  const A = accent(lp)
  const order = 10 + k0
  if (k0 === 0) {
    // a turret on the wing's front corner
    make(c, 'slot', n, order, (k) => {
      tower(k, P, -2.02, 1.55, { r: 0.5, h: 3.3, wall: P.cream, foot: P.stone, roof: A.m, roofH: 1.5, flag: A.m, ring: P.gold })
    })
  } else if (k0 === 1) {
    // a glasshouse against the hall, right of the door
    make(c, 'slot', n, order, (k) => {
      k.push(1.45, -0.04)
      k.part()
      k.blk(P.stone, 0, 0.04, 0, 1.24, 0.3, 0.92)
      k.part()
      for (const [x, z] of [[-0.3, 0], [0.25, -0.1], [0.05, 0.22]]) k.orb(P.leaf, x, 0.5, z, 0.2, 0.9, true)
      for (const [x, z] of [[-0.25, 0.2], [0.32, 0.1], [0.0, -0.2]]) k.orb(A.m, x, 0.68, z, 0.07)
      k.part()
      k.blk(P.glass, 0, 0.34, 0, 1.16, 0.86, 0.86, 0, false)
      for (const x of [-0.58, -0.19, 0.19, 0.58]) k.cub(P.white, x, 0.34, 0.43, 0.05, 0.86, 0.05)
      for (const x of [-0.58, 0.58]) k.cub(P.white, x, 0.34, -0.43, 0.05, 0.86, 0.05)
      k.cub(P.white, 0, 1.18, 0, 1.2, 0.05, 0.9)
      k.part()
      k.prism(P.glass, 0, 1.2, 0, 0.9, 0.5, 1.16, Math.PI / 2)
      for (const x of [-0.58, -0.19, 0.19, 0.58]) k.prism(A.m, x, 1.2, 0, 0.92, 0.52, 0.04, Math.PI / 2)
      k.add(G.rod(), A.m, 0, 1.72, 0, 0.04, 1.24, 0.04, 0, 0, Math.PI / 2)
      for (const x of [-0.62, 0.62]) k.orb(P.gold, x, 1.74, 0, 0.05)
      k.pop()
    })
  } else if (k0 === 2) {
    // a timber stable at the courtyard's front corner, facing in
    make(c, 'slot', n, order, (k) => {
      k.push(2.18, 0.98, -Math.PI / 2)
      k.part()
      k.blk(P.timber, 0, 0, 0, 0.98, 1.0, 0.7)
      for (let i = 0; i < 3; i++) k.cub(P.timberDk, 0, 0.25 + i * 0.27, 0.355, 0.99, 0.03, 0.02, 0, false)
      k.part()
      for (const x of [-0.23, 0.23]) {
        k.cub(A.m, x, 0.02, 0.36, 0.38, 0.44, 0.05)
        k.cub(A.m, x, 0.5, 0.36, 0.38, 0.34, 0.05)
        k.cub(P.white, x, 0.24, 0.39, 0.05, 0.42, 0.02, 0.7, false)
        k.cub(P.white, x, 0.24, 0.39, 0.05, 0.42, 0.02, -0.7, false)
      }
      k.blk(P.thatch, 0.66, 0, 0.12, 0.32, 0.28, 0.42)
      gable(k, A.m, P.timber, 0, 1.0, 0, 0.98, 0.7, 0.46, { oh: 0.14, ohx: 0.12, t: 0.11, cap: P.gold })
      k.part()
      k.rod(P.gold, 0, 0.86, 0.48, 0.012, 0.12, false)
      k.orb(P.glow, 0, 0.82, 0.48, 0.06)
      k.pop()
    })
  } else if (k0 === 3) {
    // a fountain in the courtyard
    make(c, 'slot', n, order, (k) => {
      k.push(0.42, 1.0)
      k.part()
      k.add(G.frustum(), P.stone, 0, 0.17, 0, 0.58, 0.34, 0.58)
      k.cyl(P.stoneDk, 0, 0.3, 0, 0.56, 0.06)
      k.part()
      k.cyl(P.water, 0, 0.28, 0, 0.48, 0.05, false)
      k.part()
      k.cyl(P.stone, 0, 0.3, 0, 0.08, 0.46)
      k.add(G.frustum(), P.stone, 0, 0.75, 0, 0.24, 0.1, 0.24, 0, Math.PI)
      k.cyl(P.water, 0, 0.8, 0, 0.19, 0.03, false)
      k.part()
      k.orb(A.m, 0, 0.98, 0, 0.13, 1, true)
      k.con(P.gold, 0, 1.08, 0, 0.05, 0.14, false)
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + 0.4
        k.orb(P.white, Math.sin(a) * 0.28, 0.62, Math.cos(a) * 0.28, 0.04)
        k.orb(P.white, Math.sin(a) * 0.36, 0.42, Math.cos(a) * 0.36, 0.035)
      }
      k.pop()
    })
  } else if (k0 === 4) {
    // a raised terrace in front of the wing, with parasols
    make(c, 'slot', n, order, (k) => {
      k.push(-0.8, 2.1)
      k.part()
      k.blk(P.stone, 0, 0, 0, 1.3, 0.3, 0.7)
      k.cub(P.stoneDk, 0, 0.28, 0, 1.34, 0.05, 0.74)
      k.part()
      for (let i = 0; i <= 6; i++) k.rod(P.cream, -0.62 + i * 0.207, 0.32, 0.33, 0.03, 0.3, false)
      for (const s of [-1, 1]) for (let i = 1; i < 3; i++) k.rod(P.cream, s * 0.62, 0.32, 0.33 - i * 0.22, 0.03, 0.3, false)
      k.cub(A.m, 0, 0.62, 0.33, 1.28, 0.05, 0.07)
      for (const s of [-1, 1]) k.cub(A.m, s * 0.62, 0.62, 0.0, 0.07, 0.05, 0.7)
      k.part()
      for (const [x, z, a] of [[-0.3, -0.05, 0], [0.32, 0.02, 1]]) {
        k.rod(P.white, x, 0.32, z, 0.02, 0.86, false)
        k.cyl(P.wood, x, 0.6, z, 0.16, 0.04)
        k.con(a ? P.white : A.m, x, 1.08, z, 0.42, 0.22)
        k.cyl(a ? A.m : P.white, x, 1.06, z, 0.42, 0.03, false)
      }
      for (let i = 0; i < 3; i++) k.blk(P.stone, 0.75, 0, -0.18 + i * 0.12, 0.2, 0.26 - i * 0.08, 0.12)
      k.pop()
    })
  } else {
    // a banner hall: a tall gabled porch on the hall's front, its banner in the Layer's colour
    make(c, 'slot', n, order, (k) => {
      const z = HALL.z + HALL.d / 2
      k.push(0.1, z + 0.32)
      k.part()
      k.blk(P.stone, 0, 0.1, 0, 1.0, 1.36, 0.64)
      k.part()
      k.blk(P.cream, 0, 1.46, 0, 0.98, 1.28, 0.62)
      k.cub(P.gold, 0, 1.42, 0, 1.04, 0.07, 0.68, 0, false)
      door(k, P, 0, 0.1, 0.32, 0.62, 1.16, P.royal, P.gold)
      gable(k, A.m, P.cream, 0, 2.74, -0.05, 0.84, 1.04, 0.66, { ry: Math.PI / 2, oh: 0.14, ohx: 0.06, t: 0.13, cap: P.gold })
      k.part()
      k.orb(P.gold, 0, 3.5, 0.36, 0.07)
      k.banner(A.m, P.gold, 0, 2.6, 0.34, 0.56, 1.0)
      k.pop()
    })
  }
}

// ---- tier 4: the keep -------------------------------------------------------------------

const MOTTE = { r: 2.62, h: 0.8 }
const KEEP = { w: 2.6, y0: 0.8, top: 5.0 }
const KWALL = { R: 3.52, h: 1.15, t: 0.34 }

function keepBase(c: Ctx) {
  const P = c.P
  make(c, 'base', 0, 0, (k) => {
    k.part()
    k.add(G.frustum(), P.turf, 0, MOTTE.h / 2, 0, MOTTE.r, MOTTE.h, MOTTE.r)
    k.cyl(P.stone, 0, MOTTE.h - 0.04, 0, MOTTE.r * 0.78 + 0.02, 0.08)
    k.part()
    for (let i = 0; i < 4; i++) k.blk(P.stone, 0, 0, MOTTE.r - 0.08 - i * 0.16, 0.92, 0.2 * (i + 1) + 0.02, 0.2)
    for (let i = 0; i < 9; i++) {
      const a = 0.6 + i * 0.62
      k.orb(i % 2 ? P.leaf : P.pink, Math.sin(a) * (MOTTE.r - 0.25), 0.36, Math.cos(a) * (MOTTE.r - 0.25), i % 2 ? 0.14 : 0.06, 0.8)
    }
  }, { solid: { kind: 'disc', x: 0, z: 0, r: MOTTE.r } })
  make(c, 'base', 0, 1, (k) => {
    curtain(k, P.stone, P.stoneDk, KWALL.R, KWALL.h, KWALL.t, 18, 0.2, 4)
    k.part()
    for (const s of [-1, 1]) {
      const a = s * 0.2
      k.blk(P.stone, Math.sin(a) * KWALL.R, 0, Math.cos(a) * KWALL.R, 0.42, 1.5, 0.46, a)
      k.blk(P.stoneDk, Math.sin(a) * KWALL.R, 1.48, Math.cos(a) * KWALL.R, 0.5, 0.12, 0.54, a)
    }
  }, { solid: { kind: 'ring', r0: KWALL.R - KWALL.t / 2, r1: KWALL.R + KWALL.t / 2 } })
  const hw = KEEP.w / 2
  make(c, 'base', 0, 1, (k) => {
    k.part()
    k.blk(P.stone, 0, KEEP.y0, 0, KEEP.w, 2.1, KEEP.w)
    for (const x of [-hw, hw]) for (const z of [-hw, hw]) k.blk(P.stoneDk, x, KEEP.y0, z, 0.36, 2.1, 0.36)
    k.part()
    k.cub(P.cream, 0, KEEP.y0 + 2.06, 0, KEEP.w + 0.06, 0.12, KEEP.w + 0.06)
    for (let f = 0; f < 4; f++) {
      const a = (f * Math.PI) / 2
      k.push(Math.sin(a) * hw, Math.cos(a) * hw, a)
      if (f === 0) door(k, P, 0, KEEP.y0, 0, 0.7, 1.12, P.royal)
      else windowAt(k, P, 0, KEEP.y0 + 0.7, 0, 0.12, 0.5, { frame: P.stoneDk, sill: P.stoneDk })
      for (const x of [-0.7, 0.7]) windowAt(k, P, x, KEEP.y0 + 0.9, 0, 0.1, 0.42, { frame: P.stoneDk, sill: P.stoneDk })
      k.pop()
    }
  })
  make(c, 'base', 0, 2, (k) => {
    k.part()
    k.blk(P.stone, 0, KEEP.y0 + 2.12, 0, KEEP.w - 0.04, KEEP.top - KEEP.y0 - 2.12, KEEP.w - 0.04)
    for (const x of [-hw, hw]) for (const z of [-hw, hw]) k.blk(P.stoneDk, x, KEEP.y0 + 2.12, z, 0.34, KEEP.top - KEEP.y0 - 2.12, 0.34)
    k.part()
    for (let f = 0; f < 4; f++) {
      const a = (f * Math.PI) / 2
      k.push(Math.sin(a) * (hw - 0.02), Math.cos(a) * (hw - 0.02), a)
      for (const x of [-0.5, 0.5]) windowAt(k, P, x, 3.5, 0, 0.32, 0.56, { shutters: P.royal, frame: P.cream })
      k.pop()
    }
    k.part()
    k.blk(P.stoneDk, 0, KEEP.top, 0, KEEP.w + 0.28, 0.2, KEEP.w + 0.28)
    k.cub(P.gold, 0, KEEP.top - 0.06, 0, KEEP.w + 0.3, 0.06, KEEP.w + 0.3, 0, false)
    for (let f = 0; f < 4; f++) {
      const a = (f * Math.PI) / 2
      k.push(Math.sin(a) * (hw + 0.04), Math.cos(a) * (hw + 0.04), a)
      for (let i = 0; i < 5; i++) k.blk(P.stone, -1.12 + i * 0.56, KEEP.top + 0.2, 0, 0.3, 0.36, 0.2)
      k.pop()
    }
  })
  make(c, 'base', 0, 3, (k) => {
    k.part()
    k.pyr(P.royal, 0, KEEP.top + 0.2, 0, 2.2, 2.0, 2.2)
    k.orb(P.gold, 0, KEEP.top + 2.24, 0, 0.1)
  })
  make(c, 'base', 0, 4, (k) => mainPennant(k, P, 0, KEEP.top + 2.2, 0, 1.25, 1.3))
}

function keepSlot(c: Ctx, k0: number, lp: LayerPaint, n: number) {
  const P = c.P
  const A = accent(lp)
  const order = 10 + k0
  const hw = KEEP.w / 2 + 0.05
  const atWall = (deg: number): [number, number] => [Math.sin(deg * (Math.PI / 180)) * KWALL.R, Math.cos(deg * (Math.PI / 180)) * KWALL.R]
  const bartizan = (x: number, z: number) =>
    make(c, 'slot', n, order, (k) => tower(k, P, x, z, { r: 0.38, h: 1.5, y0: 3.7, wall: P.stone, roof: A.m, roofH: 1.05, flag: A.m, corbel: true, windows: 1, ring: P.gold }), {
      anchor: [Math.sign(x) * 2.1, Math.sign(z) * 2.1],
    })
  const wallTower = (deg: number, h: number, r: number) => {
    const [x, z] = atWall(deg)
    make(c, 'slot', n, order, (k) => tower(k, P, x, z, { r, h, wall: P.stone, roof: A.m, roofH: r * 2.7, flag: A.m, crenel: false, ring: P.gold }))
  }
  if (k0 === 0) bartizan(hw, hw)
  else if (k0 === 1) {
    // the gatehouse: two towers and an arch, the Layer's banner over it
    make(c, 'slot', n, order, (k) => {
      k.push(0, KWALL.R)
      k.part()
      k.blk(P.stone, 0, 0, 0, 1.2, 1.7, 0.66)
      arch(k, P.dark, 0, 0, 0.34, 0.66, 1.18, 0.04)
      for (let i = 0; i < 4; i++) k.cub(P.gold, -0.24 + i * 0.16, 0.5, 0.37, 0.025, 0.66, 0.025, 0, false)
      k.cub(P.gold, 0, 0.75, 0.37, 0.6, 0.025, 0.025, 0, false)
      k.part()
      k.cub(P.stoneDk, 0, 1.68, 0, 1.26, 0.08, 0.72)
      for (let i = 0; i < 3; i++) k.blk(P.stone, -0.4 + i * 0.4, 1.76, 0.24, 0.24, 0.26, 0.18)
      k.pop()
      for (const s of [-1, 1]) tower(k, P, s * 0.74, KWALL.R - 0.02, { r: 0.42, h: 2.1, wall: P.stone, roof: A.m, roofH: 1.1, flag: null, windows: 1, ring: P.gold })
      k.push(0, KWALL.R)
      k.banner(A.m, P.gold, 0, 1.6, 0.35, 0.42, 0.62)
      k.pop()
    })
  } else if (k0 === 2) wallTower(70, 2.0, 0.5)
  else if (k0 === 3) {
    // the drawbridge over the ditch, pennants on its posts
    make(c, 'slot', n, order, (k) => {
      k.push(0, KWALL.R + 0.78)
      k.part()
      k.blk(P.timber, 0, 0, 0, 0.82, 0.1, 0.96)
      for (let i = 0; i < 6; i++) k.cub(P.timberDk, 0, 0.1, -0.42 + i * 0.168, 0.84, 0.012, 0.025, 0, false)
      k.part()
      for (const s of [-1, 1]) {
        k.rod(P.timber, s * 0.46, 0, 0.42, 0.05, 0.9)
        k.orb(P.gold, s * 0.46, 0.93, 0.42, 0.05)
        k.add(G.rod(), P.gold, s * 0.42, 1.0, -0.06, 0.014, 1.2, 0.014, 0, -1.0, 0, false)
      }
      for (const s of [-1, 1]) k.pennant(A.m, s * 0.46, 0.84, 0.42, 0.3, 0.18)
      k.pop()
    })
  } else if (k0 === 4) bartizan(-hw, -hw)
  else if (k0 === 5) wallTower(-70, 2.0, 0.5)
  else if (k0 === 6) {
    // a tall watchtower at the back
    const [x, z] = atWall(180)
    make(c, 'slot', n, order, (k) => {
      tower(k, P, x, z, { r: 0.46, h: 3.9, wall: P.stone, foot: P.stoneDk, roof: A.m, roofH: 1.4, flag: A.m, crenel: true, windows: 2 })
      k.push(x, z)
      k.part()
      for (const s of [-1, 1]) k.add(G.cube(), P.timber, s * 0.32, 3.32, 0.4, 0.06, 0.4, 0.06, 0, -0.5 * s)
      k.pop()
    })
  } else {
    // hoardings: covered timber galleries on the wall either side of the gate
    make(c, 'slot', n, order, (k) => {
      for (const deg of [42, -42]) {
        const [x, z] = atWall(deg)
        k.push(x, z, deg * (Math.PI / 180))
        k.part()
        k.cub(P.timber, 0, KWALL.h + 0.06, 0.18, 1.18, 0.5, 0.36)
        for (let i = 0; i < 4; i++) k.cub(P.timberDk, -0.45 + i * 0.3, KWALL.h + 0.06, 0.37, 0.04, 0.5, 0.02, 0, false)
        for (let i = 0; i < 3; i++) k.add(G.cube(), P.timberDk, -0.4 + i * 0.4, KWALL.h - 0.14, 0.24, 0.06, 0.06, 0.4, 0, 0.7)
        k.part()
        k.add(G.box(), A.m, 0, KWALL.h + 0.66, 0.08, 1.3, 0.08, 0.66, 0, 0.42)
        k.cub(A.dk, 0, KWALL.h + 0.52, 0.39, 1.32, 0.05, 0.05, 0, false)
        k.pop()
      }
    })
  }
}

// ---- tier 5: the castle -----------------------------------------------------------------

const CWALL = { R: 3.95, h: 1.7, t: 0.38 }
const CKEEP = { r: 1.6, top: 4.6, ur: 1.05, utop: 7.3 }

/** A gatehouse at the front: two towers, an arch with gates. */
function gatehouse(k: Maker, P: Pal, R: number, roof: Mat, wall: Mat) {
  k.push(0, R)
  k.part()
  k.blk(wall, 0, 0, 0, 1.3, 2.2, 0.76)
  arch(k, P.dark, 0, 0, 0.39, 0.74, 1.36, 0.04)
  for (const s of [-1, 1]) k.cub(P.timber, s * 0.19, 0, 0.42, 0.34, 0.95, 0.04, 0, false)
  for (let i = 0; i < 4; i++) k.cub(P.gold, -0.27 + i * 0.18, 1.0, 0.43, 0.025, 0.42, 0.025, 0, false)
  k.part()
  k.cub(P.stone, 0, 2.18, 0, 1.36, 0.1, 0.82)
  for (let i = 0; i < 3; i++) k.blk(wall, -0.44 + i * 0.44, 2.28, 0.28, 0.26, 0.28, 0.2)
  k.cub(P.gold, 0, 2.12, 0.4, 1.36, 0.05, 0.03, 0, false)
  k.pop()
  for (const s of [-1, 1]) tower(k, P, s * 0.86, R, { r: 0.55, h: 2.7, wall, foot: P.stone, roof, roofH: 1.5, flag: null, crenel: false, ring: P.gold })
}

function castleBase(c: Ctx) {
  const P = c.P
  make(c, 'base', 0, 0, (k) => {
    // a round stone platform in a ring of moat, a bridge over it at the gate
    k.part()
    k.cyl(P.water, 0, 0, 0, 4.96, 0.03, false)
    k.cyl(P.stoneDk, 0, 0, 0, 4.66, 0.1)
    k.cyl(P.stone, 0, 0, 0, 4.58, 0.13)
    k.part()
    k.cyl(P.sand, 0, 0.1, 0, CWALL.R - 0.1, 0.04, false)
    k.cyl(P.stone, 0, 0.1, 0, 2.3, 0.06, false)
    for (let i = 0; i < 3; i++) k.blk(P.stone, 0, 0.1, CWALL.R - 0.5 - i * 0.55, 0.9, 0.05, 0.4)
    k.blk(P.stone, 0, 0, 4.78, 1.2, 0.16, 0.6)
    for (const s of [-1, 1]) k.cub(P.stoneDk, s * 0.56, 0.16, 4.78, 0.08, 0.14, 0.6)
  }, { solid: 'none' })
  make(c, 'base', 0, 1, (k) => curtain(k, P.cream, P.stone, CWALL.R, CWALL.h, CWALL.t, 24, 0.14, 6), { solid: { kind: 'ring', r0: CWALL.R - CWALL.t / 2, r1: CWALL.R + CWALL.t / 2 } })
  make(c, 'base', 0, 1, (k) => gatehouse(k, P, CWALL.R, P.royal, P.cream))
  make(c, 'base', 0, 1, (k) => {
    k.part()
    k.cyl(P.stoneDk, 0, 0, 0, 2.0, 0.36)
    for (let i = 0; i < 3; i++) k.blk(P.stone, 0, 0, 2.08 + i * 0.16 - 0.3, 1.1, 0.36 - i * 0.12, 0.2)
    k.part()
    k.cyl(P.cream, 0, 0.34, 0, CKEEP.r, 2.1)
    k.push(0, CKEEP.r - 0.02)
    door(k, P, 0, 0.34, 0, 0.86, 1.32, P.royal, P.gold)
    k.pop()
    drumWindows(k, P, CKEEP.r, 0.95, 0.3, 0.6, 4, Math.PI, 1.1, { shutters: P.royal })
    k.part()
    k.cyl(P.cream, 0, 2.44, 0, CKEEP.r - 0.01, CKEEP.top - 2.44)
    k.cyl(P.gold, 0, 2.42, 0, CKEEP.r + 0.03, 0.07, false)
    drumWindows(k, P, CKEEP.r, 3.0, 0.32, 0.66, 6, 0.5, Math.PI / 3, { shutters: P.royal })
    k.part()
    k.cyl(P.stone, 0, CKEEP.top, 0, CKEEP.r + 0.14, 0.24)
    k.cyl(P.gold, 0, CKEEP.top + 0.08, 0, CKEEP.r + 0.16, 0.06, false)
    merlonRing(k, P.cream, CKEEP.top + 0.24, CKEEP.r + 0.04, 18, 0.26, 0.3, 0.18)
  }, { solid: { kind: 'disc', x: 0, z: 0, r: 2.0 } })
  make(c, 'base', 0, 2, (k) => {
    k.part()
    k.cyl(P.blush, 0, CKEEP.top + 0.24, 0, CKEEP.ur, CKEEP.utop - CKEEP.top - 0.24)
    drumWindows(k, P, CKEEP.ur, 5.6, 0.28, 0.6, 4, Math.PI / 4, Math.PI / 2, { shutters: P.royal })
    k.cyl(P.gold, 0, CKEEP.utop - 0.1, 0, CKEEP.ur + 0.04, 0.08, false)
  }, { solid: 'none' })
  make(c, 'base', 0, 3, (k) => {
    k.part()
    k.cyl(P.gold, 0, CKEEP.utop, 0, CKEEP.ur * 1.22, 0.07, false)
    k.con(P.royal, 0, CKEEP.utop + 0.04, 0, CKEEP.ur * 1.22, 4.0)
    k.orb(P.gold, 0, CKEEP.utop + 4.08, 0, 0.13)
  }, { solid: 'none' })
  make(c, 'base', 0, 4, (k) => mainPennant(k, P, 0, CKEEP.utop + 4.06, 0, 1.4, 1.5), { solid: 'none' })
}

const CASTLE_RING = [30, -30, 75, -75, 120, -120, 162, -162]
const CASTLE_TURRETS = [45, -45, 135, -135]

function castleSlot(c: Ctx, k0: number, lp: LayerPaint, n: number) {
  const P = c.P
  const A = accent(lp)
  const order = 10 + k0
  if (k0 < 8) {
    const a = CASTLE_RING[k0] * (Math.PI / 180)
    const h = k0 % 4 < 2 ? 3.0 : 3.5
    const ar = CWALL.R - 0.85
    make(c, 'slot', n, order, (k) => tower(k, P, Math.sin(a) * CWALL.R, Math.cos(a) * CWALL.R, { r: 0.55, h, wall: P.cream, foot: P.stone, roof: A.m, roofH: 1.8, flag: A.m, crenel: true, ring: P.gold }), {
      anchor: [Math.sin(a) * ar, Math.cos(a) * ar],
    })
  } else {
    // a turret on the keep's battlements, its banner hanging below
    const a = CASTLE_TURRETS[k0 - 8] * (Math.PI / 180)
    const r = CKEEP.r + 0.02
    make(
      c,
      'slot',
      n,
      order,
      (k) => {
        tower(k, P, Math.sin(a) * r, Math.cos(a) * r, { r: 0.4, h: 1.5, y0: CKEEP.top - 0.1, wall: P.cream, roof: A.m, roofH: 1.2, flag: A.m, corbel: true, windows: 1, ring: P.gold })
        k.push(Math.sin(a) * (CKEEP.r + 0.02), Math.cos(a) * (CKEEP.r + 0.02), a)
        k.banner(A.m, P.gold, 0, CKEEP.top - 0.55, 0.02, 0.42, 1.3)
        k.pop()
      },
      { anchor: [Math.sin(a) * 2.6, Math.cos(a) * 2.6] },
    )
  }
}

// ---- tier 6 and on: the grand citadels ---------------------------------------------------
//
// One plan, driven by the level: a stepped platform (one more step a tier),
// concentric curtain walls (one more every 8 tiers) with gatehouses at the
// gates and paired towers at the inner gates, a wedding cake of terraces
// (more as it climbs) with banners and flying buttresses, bridges from the
// inner wall up to the first terrace, a core keep, a lantern and a spire that
// grow every time. Slot towers stand on the walls and the terrace rims,
// filled ring by ring from the outside in and upward.

interface Ring {
  R: number
  y0: number
  r: number
  h: [number, number]
  wall: boolean
  angles: number[]
}
interface GrandPlan {
  L: number
  g: number
  R: number
  Rp: number
  steps: number[]
  lift: number
  walls: { R: number; h: number; t: number }[]
  gates: number[]
  terraces: { r: number; y0: number; top: number }[]
  core: { r: number; y0: number; top: number }
  lantern: { r: number; h: number }
  spire: number
  rings: Ring[]
  /** Slot k stands on rings[order[k][0]] at angles[order[k][1]]. */
  order: [number, number][]
}

const plans = new Map<number, GrandPlan>()
const STEP_H = 0.16
const near = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)))

function grandPlan(L: number): GrandPlan {
  const hit = plans.get(L)
  if (hit) return hit
  const g = L - 6
  const R = tierOf(L).radius
  const Rp = R - 0.5
  const nSteps = grandSteps(L)
  const steps = Array.from({ length: nSteps }, (_, i) => Rp - i * 0.2)
  const lift = nSteps * STEP_H
  const Rtop = steps[nSteps - 1]
  const sg = Math.sqrt(g)
  const nw = grandWalls(L)
  const walls = Array.from({ length: nw }, (_, j) => ({ R: Rtop - 0.6 - j * 2.4, h: 1.6 + 0.15 * sg + j * 0.35, t: 0.42 }))
  const gates = [0, Math.PI, Math.PI / 2, -Math.PI / 2].slice(0, grandGates(L))
  const nT = grandTerraces(L)
  const rc = 1.15 + 0.22 * sg
  const r0 = walls[nw - 1].R - 1.25
  const th = 1.9 + 0.1 * sg
  const terraces = Array.from({ length: nT }, (_, i) => ({ r: r0 + ((rc + 0.8 - r0) * i) / Math.max(1, nT - 1), y0: lift + i * th, top: lift + (i + 1) * th }))
  const coreY0 = terraces[nT - 1].top
  const core = { r: rc, y0: coreY0, top: coreY0 + 2.2 + 0.5 * sg }
  const lantern = { r: rc * 0.7, h: 1.4 + 0.2 * sg }
  const spire = 3.9 + 1.2 * sg

  // where slot towers may stand
  const rings: Ring[] = []
  const caps: number[] = []
  walls.forEach((w, j) => {
    const cap = Math.floor((Math.PI * 2 * w.R) / 1.55)
    const angles: number[] = []
    for (let i = 0; i < cap; i++) {
      const a = ((i + 0.5) / cap) * Math.PI * 2 + j * 0.13
      if (gates.every((gt) => near(a, gt) > 2.1 / w.R)) angles.push(a)
    }
    rings.push({ R: w.R, y0: lift, r: 0.5, h: [w.h + 0.9 + 0.1 * sg, w.h + 1.35 + 0.1 * sg], wall: true, angles })
  })
  terraces.forEach((t, i) => {
    const inner = i + 1 < nT ? terraces[i + 1].r : rc
    const ledge = t.r - inner
    const r = Math.min(0.44, ledge * 0.42)
    const Rr = (t.r + inner) / 2
    const cap = Math.floor((Math.PI * 2 * Rr) / Math.max(1.25, r * 3.4))
    const angles: number[] = []
    for (let a0 = 0; a0 < cap; a0++) {
      const a = ((a0 + (i % 2 ? 0.5 : 0)) / cap) * Math.PI * 2
      if (gates.every((gt) => near(a, gt) > 0.75 / Rr + 0.12)) angles.push(a)
    }
    rings.push({ R: Rr, y0: t.top, r, h: [th * 0.72, th * 0.88], wall: false, angles })
  })
  // share the tier's slots among the rings by room, outer walls a little first
  for (const r of rings) caps.push(r.angles.length * (r.wall ? 1.3 : 1))
  const S = gapAfter(L)
  const total = caps.reduce((a, b) => a + b, 0)
  const want = caps.map((c) => (S * c) / total)
  const take = want.map((w, i) => Math.min(rings[i].angles.length, Math.floor(w)))
  let left = S - take.reduce((a, b) => a + b, 0)
  const byFrac = want.map((w, i) => [w - Math.floor(w), i]).sort((a, b) => b[0] - a[0])
  for (let pass = 0; left > 0 && pass < 50; pass++)
    for (const [, i] of byFrac) {
      if (left <= 0) break
      if (take[i] < rings[i].angles.length) take[i]++, left--
    }
  const order: [number, number][] = []
  rings.forEach((ring, ri) => {
    const m = take[ri]
    if (!m) return (ring.angles = [])
    const n = ring.angles.length
    const chosen = Array.from({ length: m }, (_, j) => ring.angles[Math.floor(((j + 0.5) * n) / m)])
    // front first, then round both sides
    chosen.sort((a, b) => near(a, 0) - near(b, 0) || b - a)
    ring.angles = chosen
    chosen.forEach((_, j) => order.push([ri, j]))
  })
  const plan: GrandPlan = { L, g, R, Rp, steps, lift, walls, gates, terraces, core, lantern, spire, rings, order }
  plans.set(L, plan)
  return plan
}

interface KitTowerSpec {
  r: number
  h: number
  y0: number
  wall: Mat
  foot?: Mat
  roof: Mat
  roofColor?: THREE.Color
  roofH: number
  flag?: THREE.Color | Mat | null
  windows: number
  crenel: boolean
  /** A stone ring at its foot (standing on the platform). */
  footRing?: boolean
}
/** An instanced tower at (x, z) of the frame: three stages and a pennant. */
function kitTower(k: KitMaker, P: Pal, x: number, z: number, s: KitTowerSpec) {
  const { r, h, y0 } = s
  const face = Math.atan2(x, z)
  k.push(x, z)
  k.stage()
  if (s.footRing) k.cyl(P.stoneDk, 0, y0, 0, r + 0.06, 0.16)
  k.cyl(s.foot ?? s.wall, 0, y0, 0, r, h * 0.5)
  k.stage()
  k.cyl(s.wall, 0, y0 + h * 0.5, 0, r, h * 0.5)
  for (let j = 0; j < s.windows; j++) {
    const a = face + (s.windows === 1 ? 0 : (j - (s.windows - 1) / 2) * 1.05)
    k.push(Math.sin(a) * (r - 0.02), Math.cos(a) * (r - 0.02), a)
    k.win(P.glow, 0, y0 + h * 0.58, 0, Math.min(0.22, r * 0.48), Math.min(0.44, r * 0.96))
    k.pop()
  }
  let top = y0 + h
  if (s.crenel) {
    k.cyl(s.wall, 0, top, 0, r + 0.09, 0.14)
    const n = Math.max(6, Math.round(r * 13))
    for (let i = 0; i < n; i++) {
      const a = face + (i / n) * Math.PI * 2
      k.cub(s.wall, Math.sin(a) * (r + 0.02), top + 0.14, Math.cos(a) * (r + 0.02), 0.17, 0.2, 0.14, a)
    }
    top += 0.34
  }
  k.stage()
  k.cyl(P.gold, 0, y0 + h - 0.09, 0, r + 0.03, 0.08, false)
  k.cyl(P.gold, 0, top, 0, r * 1.2, 0.07, false)
  k.con(s.roof, 0, top + 0.05, 0, r * 1.24, s.roofH, s.roofColor)
  const tip = top + 0.05 + s.roofH
  k.orb(P.gold, 0, tip + 0.03, 0, Math.max(0.05, r * 0.13))
  if (s.flag) {
    k.add(G.rod(), P.gold, 0, tip + 0.24, 0, 0.022, 0.48, 0.022, 0, 0, 0, { shadow: false, hb: 0.24 })
    if (s.flag instanceof THREE.Color) k.pennant(P.white, 0, tip + 0.44, 0, 0.44, 0.25, s.flag)
    else k.pennant(s.flag, 0, tip + 0.44, 0, 0.44, 0.25)
  }
  k.pop()
}

/** A ring of wall in segments, gaps at the gates, merlons on its outer edge. */
function kitWall(k: KitMaker, R: number, h: number, t: number, gates: number[], gapHalf: number, wall: Mat, cap: Mat, stages: number) {
  const n = Math.max(12, Math.round((Math.PI * 2 * R) / 1.05))
  const seg = (Math.PI * 2) / n
  const len = 2 * R * Math.sin(seg / 2) + 0.06
  const per = Math.ceil(n / stages)
  for (let i = 0; i < n; i++) {
    if (i % per === 0) k.stage()
    const a = i * seg + seg / 2
    if (gates.some((g) => near(a, g) < gapHalf)) continue
    k.push(Math.sin(a) * R, Math.cos(a) * R, a)
    k.blk(wall, 0, 0, 0, len, h, t)
    k.cub(cap, 0, h - 0.02, 0, len + 0.02, 0.08, t + 0.06)
    for (const x of [-len / 4, len / 4]) k.cub(wall, x, h + 0.06, t / 2 - 0.08, 0.22, 0.24, 0.16)
    k.pop()
  }
}

function grandBase(c: Ctx, L: number) {
  const P = c.P
  const p = grandPlan(L)
  const { lift } = p
  // the platform: one more step every tier, a gold lip on top
  makeKit(
    c,
    'base',
    0,
    0,
    (k) => {
      p.steps.forEach((r, i) => {
        k.stage()
        k.cyl(i % 2 ? P.stone : P.stoneDk, 0, i * STEP_H, 0, r, STEP_H + 0.01)
      })
      k.stage()
      k.cyl(P.gold, 0, lift - 0.07, 0, p.steps[p.steps.length - 1] + 0.02, 0.05, false)
      k.cyl(P.sand, 0, lift, 0, p.steps[p.steps.length - 1] - 0.08, 0.02, false)
    },
    { solid: { kind: 'disc', x: 0, z: 0, r: p.Rp } },
  )
  // the walls, outermost first; gatehouses on the outer one, paired towers at the inner gates
  p.walls.forEach((w, j) => {
    makeKit(c, 'base', 0, 1 + j * 0.1, (k) => {
      k.push(0, 0, 0, lift)
      kitWall(k, w.R, w.h, w.t, p.gates, j ? 0.85 / w.R : 0.7 / w.R, j % 2 ? P.blush : P.cream, P.stone, 6)
      if (j)
        for (const gt of p.gates)
          for (const s of [-1, 1]) {
            const a = gt + (s * 1.2) / w.R
            kitTower(k, P, Math.sin(a) * w.R, Math.cos(a) * w.R, { r: 0.5, h: w.h + 1.1, y0: 0, wall: P.cream, foot: P.stone, roof: P.royal, roofH: 1.5, flag: P.rose, windows: 1, crenel: true, footRing: true })
          }
      k.pop()
    })
  })
  for (const gt of p.gates)
    makeKit(c, 'base', 0, 1.5, (k) => {
      const R = p.walls[0].R
      k.push(0, 0, gt, lift)
      k.push(0, R)
      k.stage()
      k.blk(P.cream, 0, 0, 0, 1.3, 2.3, 0.78)
      k.add(G.arch(), P.dark, 0, 0.72, 0.4, 0.76, 0.72, 0.04, 0, 0, 0, { shadow: false, hb: 0.72 })
      for (let i = 0; i < 4; i++) k.cub(P.gold, -0.27 + i * 0.18, 0.95, 0.43, 0.025, 0.46, 0.025, 0, false)
      k.stage()
      k.cub(P.stone, 0, 2.28, 0, 1.36, 0.1, 0.84)
      for (let i = 0; i < 3; i++) k.blk(P.cream, -0.44 + i * 0.44, 2.38, 0.28, 0.26, 0.28, 0.2)
      k.banner(P.rose, 0, 2.2, 0.42, 0.5, 0.75)
      k.pop()
      for (const s of [-1, 1]) kitTower(k, P, s * 0.88, R, { r: 0.56, h: p.walls[0].h + 1.3, y0: 0, wall: P.cream, foot: P.stone, roof: P.royal, roofH: 1.6, flag: null, windows: 1, crenel: false, footRing: true })
      k.pop()
    })
  // the terraces
  p.terraces.forEach((t, i) => {
    makeKit(
      c,
      'base',
      0,
      2 + i * 0.1,
      (k) => {
        const wall = i % 2 ? P.blush : P.cream
        k.stage()
        k.cyl(i ? wall : P.stoneDk, 0, t.y0, 0, t.r + (i ? 0 : 0.08), i ? t.top - t.y0 : 0.3)
        if (!i) k.cyl(wall, 0, t.y0 + 0.28, 0, t.r, t.top - t.y0 - 0.28)
        const n = Math.max(8, 8 * Math.round((t.r * 3) / 8))
        for (let j = 0; j < n; j++) {
          const a = ((j + 0.5) / n) * Math.PI * 2
          k.push(Math.sin(a) * (t.r - 0.02), Math.cos(a) * (t.r - 0.02), a)
          k.win(P.glow, 0, t.y0 + (t.top - t.y0) * 0.32, 0, 0.28, 0.6)
          for (const s of [-1, 1]) k.cub(P.royal, s * 0.24, t.y0 + (t.top - t.y0) * 0.32, 0.03, 0.14, 0.52, 0.04, 0, false)
          k.pop()
        }
        k.stage()
        k.cyl(P.stone, 0, t.top - 0.02, 0, t.r + 0.1, 0.14)
        k.cyl(P.gold, 0, t.top - 0.08, 0, t.r + 0.12, 0.06, false)
        const m = Math.round(t.r * 8)
        for (let j = 0; j < m; j++) {
          const a = ((j + 0.5) / m) * Math.PI * 2
          k.cub(wall, Math.sin(a) * (t.r - 0.02), t.top + 0.12, Math.cos(a) * (t.r - 0.02), 0.24, 0.26, 0.16, a)
        }
        for (let j = 0; j < 4; j++) {
          const a = Math.PI / 4 + (j * Math.PI) / 2
          k.push(Math.sin(a) * (t.r + 0.03), Math.cos(a) * (t.r + 0.03), a)
          k.cub(P.gold, 0, t.top - 0.3, 0.02, 0.6, 0.06, 0.06, 0, false)
          k.banner(P.rose, 0, t.top - 0.3, 0.03, 0.5, Math.min(1.3, (t.top - t.y0) * 0.6))
          k.pop()
        }
      },
      { solid: i ? 'none' : { kind: 'disc', x: 0, z: 0, r: t.r + 0.1 } },
    )
  })
  // bridges from the inner wall up to the first terrace, buttresses up the cake
  makeKit(
    c,
    'base',
    0,
    2.8,
    (k) => {
      const w = p.walls[p.walls.length - 1]
      const t0 = p.terraces[0]
      for (const gt of p.gates) {
        k.push(0, 0, gt)
        k.stage()
        const z1 = w.R - 0.3
        const y1 = lift + w.h + 0.1
        const z2 = t0.r + 0.05
        const y2 = t0.top
        const run = z1 - z2
        const ang = Math.atan2(y2 - y1, run)
        const len = Math.hypot(run, y2 - y1)
        for (const f of [0.35, 0.7]) k.cyl(P.stone, 0, lift, z1 - run * f, 0.16, y1 + (y2 - y1) * f - lift - 0.1)
        k.add(G.box(), P.cream, 0, (y1 + y2) / 2, (z1 + z2) / 2, 0.95, 0.16, len, 0, ang, 0, { hb: 0.08 })
        for (const s of [-1, 1]) k.add(G.cube(), P.gold, s * 0.45, (y1 + y2) / 2 + 0.28, (z1 + z2) / 2, 0.05, 0.05, len, 0, ang, 0, { shadow: false })
        for (let i = 0; i + 1 < p.terraces.length; i++) {
          const a = p.terraces[i]
          const b = p.terraces[i + 1]
          for (const s of [-1, 1]) {
            k.push(0, 0, s * (0.9 / a.r))
            const zA = a.r - 0.1
            const zB = b.r + 0.05
            const yA = a.top + 0.05
            const yB = b.top - 0.4
            const bl = Math.hypot(zA - zB, yB - yA)
            k.add(G.box(), P.cream, 0, (yA + yB) / 2, (zA + zB) / 2, 0.2, 0.18, bl, 0, Math.atan2(yB - yA, zA - zB), 0, { hb: 0.09 })
            k.orb(P.gold, 0, yA + 0.12, zA, 0.08)
            k.pop()
          }
        }
        k.pop()
      }
    },
    { solid: 'none' },
  )
  // the core keep, its lantern and spire, main's pennant
  const { core, lantern } = p
  makeKit(
    c,
    'base',
    0,
    3,
    (k) => {
      k.stage()
      k.cyl(P.cream, 0, core.y0, 0, core.r, core.top - core.y0)
      const n = 6
      for (let j = 0; j < n; j++) {
        const a = (j / n) * Math.PI * 2
        k.push(Math.sin(a) * (core.r - 0.02), Math.cos(a) * (core.r - 0.02), a)
        for (let row = 0; row < Math.floor((core.top - core.y0) / 1.6); row++) k.win(P.glow, 0, core.y0 + 0.5 + row * 1.6, 0, 0.3, 0.64)
        k.pop()
      }
      k.stage()
      k.cyl(P.stone, 0, core.top, 0, core.r + 0.12, 0.2)
      k.cyl(P.gold, 0, core.top + 0.07, 0, core.r + 0.14, 0.06, false)
      const m = Math.round(core.r * 9)
      for (let j = 0; j < m; j++) {
        const a = ((j + 0.5) / m) * Math.PI * 2
        k.cub(P.cream, Math.sin(a) * core.r, core.top + 0.2, Math.cos(a) * core.r, 0.24, 0.28, 0.16, a)
      }
    },
    { solid: 'none' },
  )
  const ly = core.top + 0.2
  makeKit(
    c,
    'base',
    0,
    4,
    (k) => {
      k.stage()
      k.cyl(P.blush, 0, ly, 0, lantern.r, lantern.h)
      for (let j = 0; j < 4; j++) {
        const a = Math.PI / 4 + (j * Math.PI) / 2
        k.push(Math.sin(a) * (lantern.r - 0.02), Math.cos(a) * (lantern.r - 0.02), a)
        k.win(P.glow, 0, ly + lantern.h * 0.3, 0, 0.24, 0.52)
        k.pop()
      }
      k.cyl(P.gold, 0, ly + lantern.h - 0.08, 0, lantern.r + 0.04, 0.08, false)
      k.stage()
      k.cyl(P.gold, 0, ly + lantern.h, 0, lantern.r * 1.25, 0.07, false)
      k.con(P.royal, 0, ly + lantern.h + 0.04, 0, lantern.r * 1.25, p.spire)
      k.orb(P.gold, 0, ly + lantern.h + p.spire + 0.1, 0, 0.15)
    },
    { solid: 'none' },
  )
  const tip = ly + lantern.h + p.spire + 0.08
  const s = 1.6 + 0.2 * Math.sqrt(p.g)
  makeKit(
    c,
    'base',
    0,
    5,
    (k) => {
      k.stage()
      k.add(G.rod(), P.gold, 0, tip + 0.75 * s, 0, 0.032 * s, 1.5 * s, 0.032 * s, 0, 0, 0, { shadow: false, hb: 0.75 * s })
      k.orb(P.gold, 0, tip + 1.55 * s, 0, 0.075 * s)
      k.pennant(P.rose, 0, tip + 1.44 * s, 0, 0.78 * s, 0.44 * s)
    },
    { solid: 'none' },
  )
}

function grandSlot(c: Ctx, L: number, k0: number, lp: LayerPaint, n: number) {
  const p = grandPlan(L)
  const at = p.order[k0]
  if (!at) return
  const ring = p.rings[at[0]]
  const a = ring.angles[at[1]]
  const h = ring.h[at[1] % 4 < 2 ? 0 : 1]
  makeKit(c, 'slot', n, 10 + k0, (k) =>
    kitTower(k, c.P, Math.sin(a) * ring.R, Math.cos(a) * ring.R, {
      r: ring.r,
      h,
      y0: ring.y0,
      wall: at[0] % 2 ? c.P.blush : c.P.cream,
      foot: ring.wall ? c.P.stone : undefined,
      roof: c.P.white,
      roofColor: lp.color,
      roofH: ring.r * 3.1,
      flag: lp.color,
      windows: ring.r >= 0.4 ? 2 : 1,
      crenel: ring.wall || ring.r >= 0.38,
      footRing: ring.wall,
    }),
  )
}

const BASES: ((c: Ctx) => void)[] = [campBase, cottageBase, houseBase, manorBase, keepBase, castleBase]
const SLOTS: ((c: Ctx, k: number, lp: LayerPaint, n: number) => void)[] = [() => {}, cottageSlot, houseSlot, manorSlot, keepSlot, castleSlot]

// ---- scaffolding --------------------------------------------------------------------------

/** A timber scaffold round a cylinder of `radius` and `height`: poles, plank decks, braces, two ladders. */
export function makeScaffold(radius: number, height: number): { object: THREE.Object3D; reveal(p: number): void; dispose(): void } {
  const P = palette()
  const R = Math.max(0.35, radius) + 0.25
  const H = Math.max(0.6, height) + 0.35
  const n = Math.max(6, Math.round((Math.PI * 2 * R) / 1.15))
  const step = 1.1
  const levels = Math.max(1, Math.floor((H - 0.2) / step))
  const at = (i: number) => {
    const a = (i / n) * Math.PI * 2 + 0.2
    return [Math.sin(a) * R, Math.cos(a) * R] as const
  }
  // each instance: where it stands and from what height it shows
  interface Bit {
    x: number
    y: number
    z: number
    yaw: number
    rz: number
    sx: number
    sy: number
    sz: number
    from: number
  }
  const poles: Bit[] = []
  const decks: Bit[] = []
  const braces: Bit[] = []
  const rungs: Bit[] = []
  for (let i = 0; i < n; i++) {
    const [x, z] = at(i)
    poles.push({ x, y: 0, z, yaw: 0, rz: 0, sx: 0.05, sy: H, sz: 0.05, from: 0 })
    const [x2, z2] = at(i + 1)
    const len = Math.hypot(x2 - x, z2 - z)
    const yaw = Math.atan2(-(z2 - z), x2 - x)
    const mx = (x + x2) / 2
    const mz = (z + z2) / 2
    for (let l = 0; l < levels; l++) {
      const y = (l + 1) * step
      decks.push({ x: mx, y, z: mz, yaw, rz: 0, sx: len + 0.08, sy: 0.06, sz: 0.36, from: y })
      braces.push({ x: mx * 1.02, y: y + 0.48, z: mz * 1.02, yaw, rz: 0, sx: len, sy: 0.05, sz: 0.05, from: y + 0.3 })
      const d = Math.hypot(len, step)
      braces.push({ x: mx * 1.03, y: y - step / 2, z: mz * 1.03, yaw, rz: ((i + l) % 2 ? 1 : -1) * Math.atan2(step, len), sx: d, sy: 0.045, sz: 0.045, from: y - 0.2 })
    }
  }
  // two ladders, at the front and the back
  for (const a of [0.75, 0.75 + Math.PI]) {
    const lx = Math.sin(a) * (R + 0.22)
    const lz = Math.cos(a) * (R + 0.22)
    const yaw = a + Math.PI / 2
    const tx = Math.cos(yaw) * 0.17
    const tz = -Math.sin(yaw) * 0.17
    for (const s of [-1, 1]) poles.push({ x: lx + tx * s, y: 0, z: lz + tz * s, yaw: 0, rz: 0, sx: 0.03, sy: H - 0.2, sz: 0.03, from: 0 })
    for (let y = 0.3; y < H - 0.3; y += 0.3) rungs.push({ x: lx, y, z: lz, yaw, rz: 0, sx: 0.34, sy: 0.035, sz: 0.035, from: y })
  }
  const group = new THREE.Group()
  group.name = 'scaffold'
  const mesh = (g: Geo, m: Mat, bits: Bit[]) => {
    const im = new THREE.InstancedMesh(g, m, Math.max(1, bits.length))
    im.count = bits.length
    im.castShadow = true
    im.receiveShadow = true
    im.frustumCulled = false
    group.add(im)
    return im
  }
  const sets: [THREE.InstancedMesh, Bit[], boolean][] = [
    [mesh(G.rod(), P.timber, poles), poles, true],
    [mesh(G.cube(), P.wood, decks), decks, false],
    [mesh(G.cube(), P.timber, braces), braces, false],
    [mesh(G.cube(), P.wood, rungs), rungs, false],
  ]
  const m4 = new THREE.Matrix4()
  const pos = new THREE.Vector3()
  const scl = new THREE.Vector3()
  const q = new THREE.Quaternion()
  const eu = new THREE.Euler(0, 0, 0, 'YXZ')
  const reveal = (p: number) => {
    group.visible = p > 0
    if (p <= 0) return
    const Y = p >= 1 ? Infinity : p * (H + 0.6)
    for (const [im, bits, grow] of sets) {
      for (let i = 0; i < bits.length; i++) {
        const b = bits[i]
        eu.set(0, b.yaw, b.rz, 'YXZ')
        q.setFromEuler(eu)
        if (grow) {
          const h = Math.max(0.001, Math.min(b.sy, Y))
          pos.set(b.x, h / 2, b.z)
          scl.set(b.sx, h, b.sz)
        } else {
          const t = Y === Infinity ? 1 : clamp01((Y - b.from) / 0.5)
          const e = t <= 0 ? 0 : t >= 1 ? 1 : Math.max(0.001, backOut(t))
          pos.set(b.x, b.y + (1 - cubicOut(t)) * 0.25, b.z)
          scl.set(b.sx * e, b.sy * e, b.sz * e)
        }
        im.setMatrixAt(i, m4.compose(pos, q, scl))
      }
      im.instanceMatrix.needsUpdate = true
    }
  }
  reveal(1)
  return {
    object: group,
    reveal,
    dispose() {
      group.removeFromParent()
      for (const [im] of sets) im.dispose()
      group.clear()
    },
  }
}
