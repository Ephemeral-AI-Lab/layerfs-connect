// The website's pixel-art agents as chunky voxel toys, with a small procedural rig.
//
// Each sprite cell (hero-sprites.ts, made by tools/voxelize-heroes.py) becomes a
// column of voxels. The column is deep in the middle of the body and shallow at
// the edges (a pillow, the same front and back), so a hero reads as a vinyl toy,
// not a cutout. Eyes and small details sit on the front only. The sprite is cut
// into parts the rig can move: legs (separate bottom protrusions), arms (side
// pieces: wings, claws, gills, cactus arms), tops (ears, hats, antennae, leaves,
// crowns) and the eyes, for blinking. Everything else is the body.
//
// Each part is one mesh of only its outer faces (faces between a filled and an
// empty cell), built once per hero name and detail level and shared by every hero
// of that name. 'high' keeps one face per voxel with tilted corner normals, which
// reads like a bevel at 2 triangles a face; 'low' merges same-coloured faces into
// big quads (same silhouette and colours) for crowds.
import * as THREE from 'three'
import { HERO_SPRITES, type HeroSprite } from './hero-sprites'
import { STONE, STONE_DARK, TIMBER, darker, hashOf, lighter } from './palette'
import type { Hero, HeroPose } from './types'

export const HERO_NAMES: readonly string[] = HERO_SPRITES.map((s) => s.name)

/** A stable hero for a key (an agent, a Branch): the same key, the same hero. */
export function heroNameFor(key: string): string {
  return HERO_NAMES[hashOf(key) % HERO_NAMES.length]
}

// ---- shared assets -------------------------------------------------------------

const HEIGHT = 0.9 // a hero's height at scale 1
const MAX_WIDTH = 1.45 // wide heroes (bat, axolotl) shrink to fit this
const BLEND = 0.15 // seconds to blend from one pose to the next

let cube: THREE.BufferGeometry | null = null
let plain: THREE.BufferGeometry | null = null
let material: THREE.MeshStandardMaterial | null = null
let skin: THREE.MeshStandardMaterial | null = null
const templates = new Map<string, Template>()

/**
 * A unit cube with chamfered edges and corners: 44 triangles, so a crowd of
 * heroes stays cheap, but the voxels still catch the light like moulded toys.
 */
function bevelledCube(r: number): THREE.BufferGeometry {
  const a = 0.5 - r
  const pos: number[] = []
  const nor: number[] = []
  const v = new THREE.Vector3()
  const w = new THREE.Vector3()
  const poly = (pts: number[][], n: number[]) => {
    const nn = new THREE.Vector3(n[0], n[1], n[2]).normalize()
    v.set(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1], pts[1][2] - pts[0][2])
    w.set(pts[2][0] - pts[0][0], pts[2][1] - pts[0][1], pts[2][2] - pts[0][2])
    const flip = v.cross(w).dot(nn) < 0
    for (let i = 1; i + 1 < pts.length; i++) {
      const tri = flip ? [pts[0], pts[i + 1], pts[i]] : [pts[0], pts[i], pts[i + 1]]
      for (const p of tri) {
        pos.push(p[0], p[1], p[2])
        nor.push(nn.x, nn.y, nn.z)
      }
    }
  }
  const at = (k: number, val: number, u: number, uv: number, l: number, lv: number) => {
    const p = [0, 0, 0]
    p[k] = val
    p[u] = uv
    p[l] = lv
    return p
  }
  for (let k = 0; k < 3; k++) {
    const u = (k + 1) % 3
    const l = (k + 2) % 3
    for (const s of [-1, 1]) {
      const n = [0, 0, 0]
      n[k] = s
      // the flat face
      poly([at(k, s * 0.5, u, -a, l, -a), at(k, s * 0.5, u, a, l, -a), at(k, s * 0.5, u, a, l, a), at(k, s * 0.5, u, -a, l, a)], n)
      // the bevel between this face and the next axis's faces
      for (const t of [-1, 1]) {
        const m = [0, 0, 0]
        m[k] = s
        m[u] = t
        poly([at(k, s * 0.5, u, t * a, l, -a), at(k, s * 0.5, u, t * a, l, a), at(k, s * a, u, t * 0.5, l, a), at(k, s * a, u, t * 0.5, l, -a)], m)
      }
    }
  }
  for (const sx of [-1, 1])
    for (const sy of [-1, 1])
      for (const sz of [-1, 1])
        poly(
          [
            [sx * 0.5, sy * a, sz * a],
            [sx * a, sy * 0.5, sz * a],
            [sx * a, sy * a, sz * 0.5],
          ],
          [sx, sy, sz],
        )
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  g.computeBoundingSphere()
  return g
}

function assets() {
  if (!cube) cube = bevelledCube(0.07)
  if (!plain) plain = new THREE.BoxGeometry(1, 1, 1)
  if (!material) material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.75, metalness: 0 })
  if (!skin) skin = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0 })
  return { cube, plain, material, skin }
}

/** Frees the shared cubes, materials and cached hero meshes. Heroes made before stop rendering properly. */
export function disposeHeroAssets(): void {
  cube?.dispose()
  plain?.dispose()
  material?.dispose()
  skin?.dispose()
  cube = plain = null
  material = skin = null
  for (const t of templates.values()) for (const p of t.parts) for (const g of Object.values(p.shape.geo)) g.dispose()
  templates.clear()
}

// ---- voxel batches ---------------------------------------------------------------

/** Instances of the shared cube: matrices and colours, ready to wrap in an InstancedMesh. */
class Batch {
  private m: number[] = []
  private c: number[] = []
  private readonly mat = new THREE.Matrix4()
  private readonly q = new THREE.Quaternion()
  private readonly p = new THREE.Vector3()
  private readonly s = new THREE.Vector3()

  add(x: number, y: number, z: number, sx: number, sy: number, sz: number, color: THREE.Color) {
    this.mat.compose(this.p.set(x, y, z), this.q, this.s.set(sx, sy, sz))
    for (const e of this.mat.elements) this.m.push(e)
    this.c.push(color.r, color.g, color.b)
  }

  get count() {
    return this.c.length / 3
  }

  done(): Instances {
    return { matrices: new Float32Array(this.m), colors: new Float32Array(this.c), count: this.count, sphere: null }
  }
}

interface Instances {
  matrices: Float32Array
  colors: Float32Array
  count: number
  sphere: THREE.Sphere | null
}

function instanced(data: Instances, name: string): THREE.InstancedMesh {
  const { cube, material } = assets()
  const mesh = new THREE.InstancedMesh(cube, material, data.count)
  mesh.name = name
  mesh.instanceMatrix = new THREE.InstancedBufferAttribute(data.matrices, 16)
  mesh.instanceColor = new THREE.InstancedBufferAttribute(data.colors, 3)
  if (!data.sphere) {
    mesh.computeBoundingSphere()
    data.sphere = mesh.boundingSphere!.clone()
  }
  mesh.boundingSphere = data.sphere.clone()
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}

/** A small deterministic shade wobble, so big flat areas look hand-made. */
function shade(base: THREE.Color, seed: number): THREE.Color {
  const k = ((Math.imul(seed ^ 0x9e3779b9, 2654435761) >>> 0) % 1000) / 1000
  return base.clone().multiplyScalar(0.975 + 0.05 * k)
}

// ---- part meshes: only the outer faces -------------------------------------------

export type HeroDetail = 'high' | 'low'

/** One voxel (or a thin proud slab) in a part: a cell across, q0..q1 slots deep. */
interface Box {
  x: number
  /** Row, counting down (the sprite's way). */
  y: number
  q0: number
  q1: number
  /** Palette index: boxes with the same key merge in 'low'. */
  key: number
  /** With the hand-made shade wobble, for 'high'. */
  color: THREE.Color
}

/** The voxels of one part, and where they sit in the part's own space. */
interface Shape {
  boxes: Box[]
  /** key -> plain colour, for 'low'. */
  base: THREE.Color[]
  /** Local position of cell (0, 0)'s lower-left-back corner. */
  x0: number
  y0: number
  z0: number
  /** Cell size (x, y), and slot size (z). */
  s: number
  sz: number
  geo: Partial<Record<HeroDetail, THREE.BufferGeometry>>
}

const SLOTS = 4 // z slots per voxel: columns step in halves, details stand a quarter proud
const TILT = 0.32 // how far 'high' corner normals lean out: a soft bevel look

/**
 * The outer faces of a shape as one geometry with vertex colours. 'high': one
 * quad per voxel face (faces merge only inside one voxel), corner normals tilted
 * outwards. 'low': greedy-merged quads of one colour, flat normals.
 */
function meshShape(shape: Shape, detail: HeroDetail): THREE.BufferGeometry {
  const { boxes } = shape
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  let maxQ = 0
  for (const b of boxes) {
    minX = Math.min(minX, b.x)
    maxX = Math.max(maxX, b.x)
    minY = Math.min(minY, b.y)
    maxY = Math.max(maxY, b.y)
    maxQ = Math.max(maxQ, b.q1)
  }
  const dims = [maxX - minX + 1, maxY - minY + 1, maxQ]
  const at = new Int32Array(dims[0] * dims[1] * dims[2]).fill(-1)
  const idx = (c: number[]) => (c[2] * dims[1] + c[1]) * dims[0] + c[0]
  boxes.forEach((b, i) => {
    for (let q = b.q0; q < b.q1; q++) at[idx([b.x - minX, b.y - minY, q])] = i
  })
  const filled = (c: number[]) => c.every((v, k) => v >= 0 && v < dims[k]) && at[idx(c)] >= 0
  // half a voxel, per grid axis (z counts slots)
  const half = [0.5, 0.5, shape.s / shape.sz / 2]
  const solid = (p: number[]) => (filled(p.map(Math.floor)) ? 1 : 0)
  const key = (i: number) => (detail === 'high' ? i : boxes[i].key)
  // grid boundary coordinates -> local space (rows count down, so y flips)
  const local = (c: number[]) => [shape.x0 + (minX + c[0]) * shape.s, shape.y0 + shape.s - (minY + c[1]) * shape.s, shape.z0 + c[2] * shape.sz]
  const axisDir = (k: number) => {
    const d = [0, 0, 0]
    d[k] = k === 1 ? -1 : 1
    return d
  }

  const pos: number[] = []
  const nor: number[] = []
  const col: number[] = []
  const index: number[] = []
  const c = [0, 0, 0]
  const nb = [0, 0, 0]
  for (let d = 0; d < 3; d++) {
    const u = (d + 1) % 3
    const v = (d + 2) % 3
    const du = dims[u]
    const dv = dims[v]
    const mask = new Int32Array(du * dv)
    for (const sgn of [-1, 1]) {
      const n = axisDir(d).map((x) => x * sgn)
      const eu = axisDir(u)
      const ev = axisDir(v)
      for (let k = 0; k < dims[d]; k++) {
        for (let b = 0; b < dv; b++)
          for (let a = 0; a < du; a++) {
            c[d] = k
            c[u] = a
            c[v] = b
            nb[d] = k + sgn
            nb[u] = a
            nb[v] = b
            const here = at[idx(c)]
            mask[b * du + a] = here >= 0 && !filled(nb) ? here : -1
          }
        for (let b = 0; b < dv; b++)
          for (let a = 0; a < du; ) {
            const first = mask[b * du + a]
            if (first < 0) {
              a++
              continue
            }
            const kk = key(first)
            let w = 1
            while (a + w < du && mask[b * du + a + w] >= 0 && key(mask[b * du + a + w]) === kk) w++
            let h = 1
            grow: while (b + h < dv) {
              for (let i = 0; i < w; i++) {
                const m = mask[(b + h) * du + a + i]
                if (m < 0 || key(m) !== kk) break grow
              }
              h++
            }
            for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) mask[(b + j) * du + a + i] = -1
            // the quad, on the face plane
            const plane = k + (sgn > 0 ? 1 : 0)
            const corners: number[][] = []
            const sides: number[][] = []
            for (const [cu, cv, su, sv] of [
              [a, b, -1, -1],
              [a + w, b, 1, -1],
              [a + w, b + h, 1, 1],
              [a, b + h, -1, 1],
            ]) {
              const g = [0, 0, 0]
              g[d] = plane
              g[u] = cu
              g[v] = cv
              corners.push(local(g))
              sides.push([su, sv])
            }
            // wind it to face outwards
            const e1 = corners[1].map((x, i) => x - corners[0][i])
            const e2 = corners[2].map((x, i) => x - corners[0][i])
            const cross = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]
            const flip = cross[0] * n[0] + cross[1] * n[1] + cross[2] * n[2] < 0
            const color = detail === 'high' ? boxes[first].color : shape.base[boxes[first].key]
            const base = pos.length / 3
            const grid: number[][] = []
            for (const [cu, cv] of [
              [a, b],
              [a + w, b],
              [a + w, b + h],
              [a, b + h],
            ]) {
              const g = [0, 0, 0]
              g[d] = plane + sgn * half[d]
              g[u] = cu
              g[v] = cv
              grid.push(g)
            }
            for (let i = 0; i < 4; i++) {
              pos.push(...corners[i])
              let nx = n[0]
              let ny = n[1]
              let nz = n[2]
              if (detail === 'high') {
                const [su, sv] = sides[i]
                nx += TILT * (su * eu[0] + sv * ev[0])
                ny += TILT * (su * eu[1] + sv * ev[1])
                nz += TILT * (su * eu[2] + sv * ev[2])
                const l = Math.hypot(nx, ny, nz)
                nx /= l
                ny /= l
                nz /= l
              }
              nor.push(nx, ny, nz)
              // 'high': a little ambient occlusion where faces meet in a crease
              let ao = 1
              if (detail === 'high') {
                const [su, sv] = sides[i]
                const p = grid[i]
                const s1 = p.slice()
                s1[u] += su * half[u]
                s1[v] -= sv * half[v]
                const s2 = p.slice()
                s2[u] -= su * half[u]
                s2[v] += sv * half[v]
                const s3 = p.slice()
                s3[u] += su * half[u]
                s3[v] += sv * half[v]
                const n1 = solid(s1)
                const n2 = solid(s2)
                const occ = n1 && n2 ? 3 : n1 + n2 + solid(s3)
                ao = 1 - 0.11 * occ
              }
              col.push(color.r * ao, color.g * ao, color.b * ao)
            }
            if (flip) index.push(base, base + 2, base + 1, base, base + 3, base + 2)
            else index.push(base, base + 1, base + 2, base, base + 2, base + 3)
            a += w
          }
      }
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  g.setIndex(index)
  g.computeBoundingSphere()
  return g
}

function geometryOf(shape: Shape, detail: HeroDetail): THREE.BufferGeometry {
  return (shape.geo[detail] ??= meshShape(shape, detail))
}

// ---- reading a sprite: parts, depth, colours -------------------------------------

type PartKind = 'body' | 'leg' | 'arm' | 'top'

interface PartTemplate {
  kind: PartKind | 'eyes'
  /** Where the part turns, in its parent's space (legs, body: the rig; the rest: the body). */
  pivot: THREE.Vector3
  /** -1 left, 1 right, 0 middle. */
  side: number
  /** A big flat side part (bat wings): flaps more. */
  wing: boolean
  /** Arms: the angle it points at, up from outward-horizontal (radians). */
  rest: number
  shape: Shape
}

interface Template {
  name: string
  /** Height of the body's pivot (the top of the legs), at scale 1. */
  hip: number
  /** Top of the head, in body space. */
  head: number
  parts: PartTemplate[]
  /** Where the hammer is held, in body space. */
  hand: THREE.Vector3
  /** Where the flag pole stands (on the back), in body space. */
  flag: THREE.Vector3
}

const N4 = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
]
const N8 = [...N4, [1, 1], [1, -1], [-1, 1], [-1, -1]]

/** Connected groups of cells (indices), in scan order. */
function groups(w: number, h: number, inside: (i: number) => boolean, nbrs: number[][]): number[][] {
  const seen = new Uint8Array(w * h)
  const out: number[][] = []
  for (let i = 0; i < w * h; i++) {
    if (seen[i] || !inside(i)) continue
    const group: number[] = []
    const todo = [i]
    seen[i] = 1
    while (todo.length) {
      const j = todo.pop()!
      group.push(j)
      const x = j % w
      const y = (j / w) | 0
      for (const [dx, dy] of nbrs) {
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
        const k = ny * w + nx
        if (!seen[k] && inside(k)) {
          seen[k] = 1
          todo.push(k)
        }
      }
    }
    out.push(group.sort((a, b) => a - b))
  }
  return out
}

/** The most common value (the smallest, on a tie). */
function mostOf(xs: number[]): number {
  const n = new Map<number, number>()
  for (const x of xs) n.set(x, (n.get(x) ?? 0) + 1)
  let best = -1
  let count = 0
  for (const [x, c] of n) if (c > count || (c === count && x < best)) [best, count] = [x, c]
  return best
}

const meanX = (w: number, cells: number[]) => cells.reduce((s, i) => s + (i % w) + 0.5, 0) / cells.length
const meanY = (w: number, cells: number[]) => cells.reduce((s, i) => s + ((i / w) | 0) + 0.5, 0) / cells.length

/**
 * Legs: the separate bottom protrusions. From the bottom row up, narrow runs of
 * cells that stand on the ground or on a leg below. Kept in pairs (mirrored
 * about the body) or alone in the middle, so a lightning bolt is not a leg.
 */
function findLegs(w: number, h: number, mask: Uint8Array): number[][] {
  let widest = 0
  for (let y = 0; y < h; y++) {
    let n = 0
    for (let x = 0; x < w; x++) n += mask[y * w + x]
    widest = Math.max(widest, n)
  }
  const narrow = Math.max(1, widest * 0.4)
  const leg = new Uint8Array(w * h)
  const lowest = h - Math.max(1, Math.floor(h * 0.4))
  for (let y = h - 1; y >= lowest; y--) {
    let any = false
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue
      let b = x
      while (b + 1 < w && mask[y * w + b + 1]) b++
      if (b - x + 1 <= narrow) {
        let ok = y === h - 1
        let floating = y === h - 2
        for (let k = x; k <= b; k++) {
          if (leg[(y + 1) * w + k]) ok = true
          if (y + 1 < h && mask[(y + 1) * w + k]) floating = false
        }
        if (ok || floating) {
          for (let k = x; k <= b; k++) leg[y * w + k] = 1
          any = true
        }
      }
      x = b
    }
    if (!any) break
  }
  const found = groups(w, h, (i) => leg[i] === 1, N4)
  if (!found.length) return []
  const rest: number[] = []
  for (let i = 0; i < w * h; i++) if (mask[i] && !leg[i]) rest.push(i)
  const mid = meanX(w, rest)
  const xs = found.map((g) => meanX(w, g))
  return found.filter((g, i) => {
    if (Math.abs(xs[i] - mid) <= 1) return true
    return xs.some((x, j) => j !== i && Math.sign(x - mid) !== Math.sign(xs[i] - mid) && Math.abs(x + xs[i] - 2 * mid) <= 2.5 && found[j].length * 3 >= g.length && g.length * 3 >= found[j].length)
  })
}

/** Morphological opening with a (2r+1) square: what is left once thin bits are shaved off. */
function opening(w: number, h: number, mask: Uint8Array, r: number): Uint8Array {
  let m = mask
  const step = (src: Uint8Array, all: boolean) => {
    const out = new Uint8Array(w * h)
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let hit = all
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx
            const ny = y + dy
            const v = nx >= 0 && ny >= 0 && nx < w && ny < h ? src[ny * w + nx] : 0
            if (all && !v) hit = false
            if (!all && v) hit = true
          }
        out[y * w + x] = hit ? 1 : 0
      }
    return out
  }
  for (let i = 0; i < r; i++) m = step(m, true)
  for (let i = 0; i < r; i++) m = step(m, false)
  for (let i = 0; i < w * h; i++) m[i] &= mask[i]
  return m
}

/** Chamfer distance (cells) from each filled cell to the nearest empty one; the rim is 1. */
function distances(w: number, h: number, mask: Uint8Array): Float32Array {
  const d = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) d[i] = mask[i] ? 1e6 : 0
  const get = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : d[y * w + x])
  const pass = (fwd: boolean) => {
    for (let yy = 0; yy < h; yy++) {
      const y = fwd ? yy : h - 1 - yy
      for (let xx = 0; xx < w; xx++) {
        const x = fwd ? xx : w - 1 - xx
        const i = y * w + x
        if (!mask[i]) continue
        const s = fwd ? -1 : 1
        d[i] = Math.min(d[i], get(x + s, y) + 1, get(x, y + s) + 1, get(x + s, y + s) + 1.4, get(x - s, y + s) + 1.4)
      }
    }
  }
  pass(true)
  pass(false)
  return d
}

const luma = (c: THREE.Color) => {
  const s = c.clone().convertLinearToSRGB()
  return 255 * (0.3 * s.r + 0.59 * s.g + 0.11 * s.b)
}

function buildTemplate(sprite: HeroSprite): Template {
  const { width: w, height: h } = sprite
  const n = w * h
  const pal = sprite.palette.map((c) => new THREE.Color(c))
  const cell = new Int16Array(n)
  const mask = new Uint8Array(n)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const ch = sprite.rows[y][x]
      const k = ch === '.' ? -1 : parseInt(ch, 36)
      cell[y * w + x] = k
      mask[y * w + x] = k >= 0 ? 1 : 0
    }

  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? -1 : y * w + x)

  // -- parts
  const part = new Int16Array(n).fill(-1) // index into kinds below; -1 empty
  const kinds: { kind: PartKind; cells: number[] }[] = [{ kind: 'body', cells: [] }]
  for (const g of findLegs(w, h, mask)) {
    for (const i of g) part[i] = kinds.length
    kinds.push({ kind: 'leg', cells: g })
  }
  const upper = new Uint8Array(n)
  let upperCount = 0
  for (let i = 0; i < n; i++)
    if (mask[i] && part[i] < 0) {
      upper[i] = 1
      upperCount++
    }

  // the core: the body with thin bits shaved off (r = 2 when that leaves enough)
  let r = 2
  let core: number[] = []
  for (; r >= 1; r--) {
    const open = opening(w, h, upper, r)
    core = groups(w, h, (i) => open[i] === 1, N8).sort((a, b) => b.length - a.length)[0] ?? []
    if (core.length >= upperCount * (r === 2 ? 0.35 : 0.2)) break
  }
  if (r < 1) core = []
  const isCore = new Uint8Array(n)
  for (const i of core) isCore[i] = 1
  let x0 = w
  let x1 = 0
  let y0 = h
  let y1 = 0
  for (const i of core.length ? core : Array.from({ length: n }, (_, i) => i).filter((i) => upper[i])) {
    x0 = Math.min(x0, i % w)
    x1 = Math.max(x1, i % w)
    y0 = Math.min(y0, (i / w) | 0)
    y1 = Math.max(y1, (i / w) | 0)
  }
  const mid = (x0 + x1 + 1) / 2
  const cw = x1 - x0 + 1
  const ch = y1 - y0 + 1

  // what the shave left: arms, tops, or just rounded fringe (body)
  const dist = new Int16Array(n).fill(-1)
  if (core.length) {
    const queue: number[] = []
    for (let i = 0; i < n; i++)
      if (upper[i] && !isCore[i]) {
        const x = i % w
        const y = (i / w) | 0
        if (N8.some(([dx, dy]) => x + dx >= 0 && y + dy >= 0 && x + dx < w && y + dy < h && isCore[(y + dy) * w + x + dx])) {
          dist[i] = 1
          queue.push(i)
        }
      }
    for (let q = 0; q < queue.length; q++) {
      const i = queue[q]
      const x = i % w
      const y = (i / w) | 0
      for (const [dx, dy] of N8) {
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
        const k = ny * w + nx
        if (upper[k] && !isCore[k] && dist[k] < 0) {
          dist[k] = dist[i] + 1
          queue.push(k)
        }
      }
    }
  }
  const isEye = new Uint8Array(n)
  for (const g of groups(w, h, (i) => mask[i] === 1 && luma(pal[cell[i]]) < 70, N4)) if (g.length <= 12) for (const i of g) isEye[i] = 1
  const loose = core.length ? groups(w, h, (i) => upper[i] === 1 && !isCore[i], N8) : []
  const sideArms: { cells: number[]; x: number }[] = []
  for (const g of loose) {
    const touches = g.some((i) => dist[i] === 1)
    const far = Math.max(...g.map((i) => dist[i]))
    const gx = meanX(w, g)
    const gy = meanY(w, g)
    const hasEye = g.some((i) => isEye[i])
    if (!touches) {
      if (gy < y0 + 0.5 && !hasEye) kinds.push({ kind: 'top', cells: g })
      continue
    }
    // a limb sticks out past the core by 3+ columns, or is drawn in its own colour
    const cols = new Set(g.filter((i) => i % w < x0 || i % w > x1).map((i) => i % w)).size
    const next = g.flatMap((i) => N4.map(([dx, dy]) => at(i % w + dx, ((i / w) | 0) + dy)).filter((j) => j >= 0 && isCore[j]))
    const limb = cols >= 3 || (cols >= 1 && mostOf(g.map((i) => cell[i])) !== mostOf(next.map((j) => cell[j])))
    const side = gx < x0 + 0.2 * cw || gx > x1 + 1 - 0.2 * cw
    if (side && g.length >= 3 && limb && gy > y0 + 0.15 * ch) sideArms.push({ cells: g, x: gx })
    else if (far > r && gy < y0 + 0.25 * ch && !hasEye) kinds.push({ kind: 'top', cells: g })
  }
  // arms come in pairs, one each side
  for (const a of sideArms) {
    const paired = sideArms.some((b) => b !== a && Math.sign(b.x - mid) !== Math.sign(a.x - mid) && Math.abs(a.x + b.x - 2 * mid) <= 3)
    if (paired) kinds.push({ kind: 'arm', cells: a.cells })
  }
  for (let k = 1; k < kinds.length; k++) for (const i of kinds[k].cells) part[i] = k
  for (let i = 0; i < n; i++) if (mask[i] && part[i] < 0) part[i] = 0
  for (let i = 0; i < n; i++) if (part[i] === 0) kinds[0].cells.push(i)

  // -- colours: details (small enclosed patches: eyes, beaks, spots, bellies) go
  // on the front only; behind them the colour around them carries on
  const detail = new Uint8Array(n)
  const enclosed = (i: number) => {
    const x = i % w
    const y = (i / w) | 0
    return N4.every(([dx, dy]) => x + dx >= 0 && y + dy >= 0 && x + dx < w && y + dy < h && mask[(y + dy) * w + x + dx])
  }
  const total = mask.reduce((s, v) => s + v, 0)
  for (let c = 0; c < pal.length; c++)
    for (const g of groups(w, h, (i) => cell[i] === c, N4)) if (g.every(enclosed) && g.length <= total * 0.3) for (const i of g) detail[i] = 1
  for (let i = 0; i < n; i++) if (isEye[i]) detail[i] = 1
  // the colour behind a detail: the nearest plain cell's
  const back = new Int16Array(n).fill(-1)
  const queue: number[] = []
  for (let i = 0; i < n; i++)
    if (mask[i] && !detail[i]) {
      back[i] = cell[i]
      queue.push(i)
    }
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q]
    const x = i % w
    const y = (i / w) | 0
    for (const [dx, dy] of N4) {
      const nx = x + dx
      const ny = y + dy
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
      const k = ny * w + nx
      if (mask[k] && back[k] < 0) {
        back[k] = back[i]
        queue.push(k)
      }
    }
  }
  for (let i = 0; i < n; i++) if (mask[i] && back[i] < 0) back[i] = cell[i]

  // -- depth: a pillow over the body; thin parts stay thin
  const s = HEIGHT / Math.max(h, (w * HEIGHT) / MAX_WIDTH) // voxel size
  const maxDepth = Math.max(3, Math.min(8, Math.round(0.34 / s)))
  const bodyDist = distances(w, h, mask)
  const depth = new Uint8Array(n)
  for (let k = 0; k < kinds.length; k++) {
    const { kind, cells } = kinds[k]
    if (kind === 'body') {
      const reach = (maxDepth - 2) * 0.7 + 1
      for (const i of cells) {
        const t = Math.min(1, (bodyDist[i] - 1) / reach)
        depth[i] = Math.round(2 + (maxDepth - 2) * Math.sqrt(1 - (1 - t) * (1 - t)))
      }
    } else {
      const own = new Uint8Array(n)
      for (const i of cells) own[i] = 1
      const d = distances(w, h, own)
      const thick = Math.max(...cells.map((i) => d[i]))
      for (const i of cells) {
        if (kind === 'leg') depth[i] = Math.min(maxDepth - 1, 2 + Math.round(Math.min(d[i], 2) - 1))
        else depth[i] = thick <= 1 ? 1 : 2
      }
    }
  }

  // -- voxels
  const X = (x: number) => (x + 0.5 - mid) * s
  const Y = (y: number) => (h - y - 0.5) * s
  const legTop = kinds.some((k) => k.kind === 'leg') ? Math.min(...kinds.filter((k) => k.kind === 'leg').flatMap((k) => k.cells.map((i) => (i / w) | 0))) : h
  const hip = (h - legTop) * s
  // a part's voxels in its own space, origin at its pivot (rig space)
  const frame = (boxes: Box[], ox: number, oy: number): Shape => ({
    boxes,
    base: pal,
    x0: -mid * s - ox,
    y0: (h - 1) * s - oy,
    z0: -(maxDepth / 2) * s,
    s,
    sz: s / SLOTS,
    geo: {},
  })
  const eyeCells: number[] = []
  const parts: PartTemplate[] = []
  let head = 0
  for (let k = 0; k < kinds.length; k++) {
    const { kind, cells } = kinds[k]
    // pivot, in the parent's space
    const pivot = new THREE.Vector3()
    let side = 0
    if (kind === 'body') pivot.set(0, hip, 0)
    else if (kind === 'leg') {
      const top = Math.min(...cells.map((i) => (i / w) | 0))
      const row = cells.filter((i) => ((i / w) | 0) === top)
      pivot.set(X(meanX(w, row) - 0.5), Y(top) + s / 2, 0)
      side = Math.sign(pivot.x)
    } else {
      // where it joins the body
      const joins = cells.filter((i) => {
        const x = i % w
        const y = (i / w) | 0
        return N8.some(([dx, dy]) => {
          const j = at(x + dx, y + dy)
          return j >= 0 && part[j] === 0
        })
      })
      const base = joins.length ? joins : cells
      if (kind === 'arm') {
        const ax = meanX(w, base) - 0.5
        side = Math.sign(meanX(w, cells) - mid)
        pivot.set(X(ax) - side * 0.5 * s, Y(meanY(w, base) - 0.5), 0)
      } else {
        const bottom = Math.max(...cells.map((i) => (i / w) | 0))
        pivot.set(X(meanX(w, base) - 0.5), joins.length ? Y(bottom) - s / 2 : Y(meanY(w, cells) - 0.5), 0)
      }
      pivot.y -= hip
    }
    const origin = kind === 'body' ? new THREE.Vector3(0, hip, 0) : kind === 'leg' ? pivot : pivot.clone().add(new THREE.Vector3(0, hip, 0))
    const boxes: Box[] = []
    for (const i of cells) {
      const x = i % w
      const y = (i / w) | 0
      const d = depth[i]
      // a carried prop rides above everything on the head (antennae, ears, hats)
      if (kind === 'body' || kind === 'top') head = Math.max(head, Y(y) + s / 2 - hip)
      // the column, centred on z = 0, one box per voxel
      const q = (maxDepth - d) * (SLOTS / 2)
      for (let j = 0; j < d; j++) {
        const k = detail[i] ? back[i] : cell[i]
        boxes.push({ x, y, q0: q + j * SLOTS, q1: q + (j + 1) * SLOTS, key: k, color: shade(pal[k], hashOf(sprite.name) ^ (i * 131 + j * 7919)) })
      }
      // a detail stands a little proud of the front
      if (detail[i] && !isEye[i]) boxes.push({ x, y, q0: q + d * SLOTS, q1: q + d * SLOTS + 1, key: cell[i], color: pal[cell[i]] })
      if (isEye[i]) eyeCells.push(i)
    }
    const rest = kind === 'arm' ? Math.atan2(Y(meanY(w, cells) - 0.5) - hip - pivot.y, Math.abs(X(meanX(w, cells) - 0.5) - pivot.x)) : 0
    parts.push({ kind, pivot, side, wing: kind === 'arm' && cells.length >= 14, rest, shape: frame(boxes, origin.x, origin.y) })
  }

  // eyes: proud of the front, in their own part so they can blink
  if (eyeCells.length) {
    const ey = Y(meanY(w, eyeCells) - 0.5)
    const boxes: Box[] = eyeCells.map((i) => {
      const q = (maxDepth - depth[i]) * (SLOTS / 2) + depth[i] * SLOTS
      return { x: i % w, y: (i / w) | 0, q0: q - 1, q1: q + 1, key: cell[i], color: pal[cell[i]] }
    })
    parts.push({ kind: 'eyes', pivot: new THREE.Vector3(0, ey - hip, 0), side: 0, wing: false, rest: 0, shape: frame(boxes, 0, ey) })
  }

  // the hammer hand: the right arm's shoulder, or the right side of the body
  const right = parts.filter((p) => p.kind === 'arm' && p.side > 0).sort((a, b) => b.pivot.y - a.pivot.y)[0]
  const midY = Y(y0 + ch * 0.55) - hip
  const hand = right ? right.pivot.clone() : new THREE.Vector3(X(x1) + s, midY, 0)
  const handCell = at(Math.min(x1, Math.round(hand.x / s + mid - 0.5)), Math.round(h - 0.5 - (hand.y + hip) / s))
  hand.z = ((handCell >= 0 ? depth[handCell] : 2) / 2) * s * 0.6
  // the flag: on the back, left of centre
  const fx = Math.max(x0, Math.round(mid - cw * 0.3))
  const fy = Math.round(y0 + ch * 0.45)
  const fc = at(fx, fy)
  const flag = new THREE.Vector3(X(fx), Y(fy) - hip, -((fc >= 0 && mask[fc] ? depth[fc] : maxDepth) / 2) * s - 0.01)

  return { name: sprite.name, hip, head, parts, hand, flag }
}

function template(name: string): Template {
  let t = templates.get(name)
  if (!t) {
    const sprite = HERO_SPRITES.find((s) => s.name === name) ?? HERO_SPRITES[0]
    t = buildTemplate(sprite)
    templates.set(name, t)
  }
  return t
}

// ---- small voxel things: hammer, flag, props -------------------------------------

const GREY = new THREE.Color(0x8c95a1)

function hammer(): THREE.InstancedMesh {
  const b = new Batch()
  const wood = new THREE.Color(TIMBER)
  // the grip is at the origin; the head is up the handle (+Y)
  b.add(0, 0.13, 0, 0.045, 0.36, 0.045, wood)
  // the head runs front to back, so a forward swing lands a face on the work
  b.add(0, 0.32, 0, 0.11, 0.11, 0.21, GREY)
  b.add(0, 0.32, 0.112, 0.125, 0.125, 0.035, lighter(GREY, 0.35))
  b.add(0, 0.32, -0.112, 0.125, 0.125, 0.035, darker(GREY, 0.15))
  return instanced(b.done(), 'hammer')
}

/** A little flag on a pole, in the Branch's colour: which Branch a worker belongs to. */
function flagOf(tint: THREE.Color, height: number): { pole: THREE.Group; cloth: THREE.Group } {
  const pole = new THREE.Group()
  const cloth = new THREE.Group()
  const b = new Batch()
  b.add(0, height / 2, 0, 0.025, height, 0.025, new THREE.Color(TIMBER))
  b.add(0, height + 0.012, 0, 0.045, 0.045, 0.045, new THREE.Color(0xf5c542))
  pole.add(instanced(b.done(), 'flag-pole'))
  // a stepped pennant, flying outwards (-X)
  const c = new Batch()
  const v = 0.045
  const cols = [3, 3, 2, 1]
  cols.forEach((rows, i) => {
    for (let j = 0; j < rows; j++) {
      const shadeK = (i + j) % 2 ? 0.92 : 1
      c.add(-(i + 0.5) * v - 0.012, -(j - (rows - 1) / 2) * v, 0, v, v, v * 0.45, tint.clone().multiplyScalar(shadeK))
    }
  })
  cloth.add(instanced(c.done(), 'flag-cloth'))
  cloth.position.y = height - 1.6 * v
  pole.add(cloth)
  return { pole, cloth }
}

/**
 * A small carryable voxel prop, about 0.3 across, standing on its own origin:
 * a building block, a crate, or a stone. The caller owns it.
 */
export function makeProp(kind: 'block' | 'crate' | 'stone', color?: THREE.Color): THREE.Object3D {
  const g = new THREE.Group()
  g.name = `prop:${kind}`
  // voxels on a small grid: x across, y up, z front to back
  const cells: { x: number; y: number; z: number; c: THREE.Color }[] = []
  let v = 0.1
  if (kind === 'block') {
    const base = color ?? new THREE.Color(STONE)
    v = 0.14
    for (let x = 0; x < 2; x++) for (let y = 0; y < 2; y++) for (let z = 0; z < 2; z++) cells.push({ x, y, z, c: shade(y ? lighter(base, 0.12) : base, x * 4 + y * 2 + z + 11) })
  } else if (kind === 'crate') {
    const frame = darker(new THREE.Color(TIMBER), 0.18)
    const panel = color ? lighter(color, 0.1) : lighter(new THREE.Color(TIMBER), 0.22)
    for (let x = 0; x < 3; x++)
      for (let y = 0; y < 3; y++)
        for (let z = 0; z < 3; z++) {
          const edges = (x !== 1 ? 1 : 0) + (y !== 1 ? 1 : 0) + (z !== 1 ? 1 : 0)
          if (edges) cells.push({ x, y, z, c: shade(edges >= 2 ? frame : panel, x * 9 + y * 3 + z + 40) })
        }
  } else {
    // a lumpy pile: a ragged 3x3 footprint, a smaller second layer, a cap
    const base = color ?? new THREE.Color(STONE_DARK)
    const light = lighter(base, 0.25)
    const layers = ['.##|###|##.', '...|##.|.#.', '...|.#.|...']
    layers.forEach((layer, y) =>
      layer.split('|').forEach((row, z) =>
        [...row].forEach((ch, x) => {
          if (ch === '#') cells.push({ x, y, z, c: shade((x + y + z) % 3 ? base : light, x * 7 + y * 3 + z + 70) })
        }),
      ),
    )
  }
  const n = kind === 'block' ? 2 : 3
  const shape: Shape = {
    boxes: cells.map((p) => ({ x: p.x, y: -p.y, q0: p.z, q1: p.z + 1, key: 0, color: p.c })),
    base: [cells[0].c],
    x0: (-n / 2) * v,
    y0: 0,
    z0: (-n / 2) * v,
    s: v,
    sz: v,
    geo: {},
  }
  const mesh = new THREE.Mesh(meshShape(shape, 'high'), assets().skin)
  mesh.name = `prop:${kind}`
  mesh.castShadow = true
  mesh.receiveShadow = true
  g.add(mesh)
  return g
}

// ---- the rig ---------------------------------------------------------------------

const POSES: readonly HeroPose[] = ['idle', 'walk', 'hammer', 'carry', 'cheer']

interface Rig {
  y: number
  tiltX: number
  tiltZ: number
  squash: number
  legLift: number[]
  legSwing: number[]
  armRaise: number[]
  armSwing: number[]
  tool: number
  toolAngle: number
  prop: number
  topSway: number
}

function rig(legs: number, arms: number): Rig {
  return {
    y: 0,
    tiltX: 0,
    tiltZ: 0,
    squash: 0,
    legLift: new Array(legs).fill(0),
    legSwing: new Array(legs).fill(0),
    armRaise: new Array(arms).fill(0),
    armSwing: new Array(arms).fill(0),
    tool: 0,
    toolAngle: 0,
    prop: 0,
    topSway: 0,
  }
}

const TAU = Math.PI * 2
/** Arms up (carry, cheer): this far above outward-horizontal. */
const UP = 1.2
const frac = (x: number) => x - Math.floor(x)
const smooth = (x: number) => x * x * (3 - 2 * x)

let serial = 0

class VoxelHero implements Hero {
  readonly name: string
  readonly root = new THREE.Group()
  pose: HeroPose = 'idle'

  private readonly t: Template
  private readonly rigGroup = new THREE.Group()
  private readonly body = new THREE.Group()
  private readonly legs: { group: THREE.Group; pivot: THREE.Vector3; side: number }[] = []
  private readonly arms: { group: THREE.Group; side: number; wing: boolean; rest: number }[] = []
  private readonly tops: THREE.Group[] = []
  private eyes: THREE.Group | null = null
  private readonly tool = new THREE.Group()
  private readonly holder = new THREE.Group()
  private cloth: THREE.Group | null = null
  /** Small instanced bits (hammer, flag): their cube follows the detail level. */
  private readonly meshes: THREE.InstancedMesh[] = []
  /** The parts' meshes, with their shapes, so detail can swap geometry. */
  private readonly skins: { mesh: THREE.Mesh; shape: Shape }[] = []
  private level: HeroDetail
  private held: THREE.Object3D | null = null
  private readonly weights: number[] = POSES.map((p) => (p === 'idle' ? 1 : 0))
  private readonly out: Rig
  private readonly one: Rig
  private readonly phase: number
  private readonly rate: number
  private readonly blinkEvery: number
  private readonly hammerArm: number
  private last = -1

  constructor(name: string, scale: number, tint: THREE.Color | undefined, detail: HeroDetail) {
    this.level = detail
    this.t = template(HERO_NAMES.includes(name) ? name : HERO_NAMES[0])
    this.name = this.t.name
    const seed = hashOf(`${this.name}#${serial++}`)
    this.phase = (seed % 1000) / 37
    this.rate = 0.92 + ((seed >>> 10) % 100) / 625
    this.blinkEvery = 2.8 + ((seed >>> 17) % 100) / 40

    this.root.name = `hero:${this.name}`
    this.rigGroup.scale.setScalar(scale)
    this.root.add(this.rigGroup)
    this.rigGroup.add(this.body)
    for (const p of this.t.parts) {
      const mesh = new THREE.Mesh(geometryOf(p.shape, detail), assets().skin)
      mesh.name = p.kind
      mesh.castShadow = true
      mesh.receiveShadow = true
      this.skins.push({ mesh, shape: p.shape })
      if (p.kind === 'body') {
        this.body.position.copy(p.pivot)
        this.body.add(mesh)
        continue
      }
      const g = new THREE.Group()
      g.name = p.kind
      g.position.copy(p.pivot)
      g.add(mesh)
      if (p.kind === 'leg') {
        this.rigGroup.add(g)
        this.legs.push({ group: g, pivot: p.pivot.clone(), side: p.side })
      } else {
        this.body.add(g)
        if (p.kind === 'arm') this.arms.push({ group: g, side: p.side, wing: p.wing, rest: p.rest })
        else if (p.kind === 'top') this.tops.push(g)
        else this.eyes = g
      }
    }
    this.legs.sort((a, b) => a.pivot.x - b.pivot.x)
    this.hammerArm = this.arms.reduce((best, a, i) => (a.side > 0 && (best < 0 || a.group.position.y > this.arms[best].group.position.y) ? i : best), -1)

    const hm = hammer()
    this.meshes.push(hm)
    this.tool.add(hm)
    this.tool.position.copy(this.t.hand)
    this.tool.visible = false
    this.body.add(this.tool)

    this.holder.position.y = this.t.head + 0.02
    // props keep their own size, whatever the hero's scale
    this.holder.scale.setScalar(1 / scale)
    this.body.add(this.holder)

    if (tint) {
      const { pole, cloth } = flagOf(tint, this.t.head - this.t.flag.y + 0.2)
      pole.position.copy(this.t.flag)
      pole.rotation.z = 0.12
      this.body.add(pole)
      this.cloth = cloth
      pole.traverse((o) => {
        if (o instanceof THREE.InstancedMesh) this.meshes.push(o)
      })
    }

    this.out = rig(this.legs.length, this.arms.length)
    this.one = rig(this.legs.length, this.arms.length)
    this.applyDetail(detail)
    this.update(0)
  }

  /** 'high' up close, 'low' for crowds: the same silhouette and colours, fewer triangles. Cheap to switch. */
  get detail(): HeroDetail {
    return this.level
  }

  set detail(d: HeroDetail) {
    if (d !== this.level) this.applyDetail(d)
  }

  private applyDetail(d: HeroDetail) {
    this.level = d
    for (const { mesh, shape } of this.skins) mesh.geometry = geometryOf(shape, d)
    const { cube, plain } = assets()
    for (const m of this.meshes) m.geometry = d === 'high' ? cube : plain
  }

  hold(prop: THREE.Object3D | null): void {
    if (this.held && this.held !== prop) {
      // let go where it is: keep its place in the world when we can
      const world = this.root.parent
      if (world && this.held.parent === this.holder) world.attach(this.held)
      else if (this.held.parent === this.holder) this.holder.remove(this.held)
    }
    this.held = prop
    if (prop) {
      this.holder.add(prop)
      prop.position.set(0, 0, 0)
      prop.rotation.set(0, 0, 0)
    }
  }

  update(time: number): void {
    const dt = this.last < 0 ? 0 : Math.min(0.1, Math.max(0, time - this.last))
    this.last = time
    // blend: the current pose fades in over BLEND seconds, the rest fade out
    const target = POSES.indexOf(this.pose)
    const k = dt > 0 ? dt / BLEND : 0
    let sum = 0
    for (let i = 0; i < POSES.length; i++) {
      const w = this.weights[i]
      this.weights[i] = i === target ? Math.min(1, w + k) : Math.max(0, w - k)
      sum += this.weights[i]
    }
    if (sum <= 0) {
      this.weights[target] = 1
      sum = 1
    }
    const t = time * this.rate + this.phase
    const out = this.out
    clear(out)
    for (let i = 0; i < POSES.length; i++) {
      const w = this.weights[i] / sum
      if (w <= 0) continue
      clear(this.one)
      this.posed(POSES[i], t, this.one)
      mix(out, this.one, w)
    }
    this.apply(out, t)
  }

  /** One pose's rig at time t (already phase-shifted). */
  private posed(pose: HeroPose, t: number, r: Rig) {
    const nArms = this.arms.length
    r.squash = 1
    if (pose === 'idle') {
      const breath = Math.sin((TAU * t) / 2.6)
      r.squash = 1 + 0.028 * breath
      r.tiltZ = 0.035 * Math.sin((TAU * t) / 4.3)
      r.tiltX = 0.015 * Math.sin((TAU * t) / 3.1)
      for (let i = 0; i < nArms; i++) r.armRaise[i] = 0.08 + 0.07 * breath + (this.arms[i].wing ? 0.1 * Math.sin(TAU * t * 0.9) : 0)
      r.topSway = 0.09 * Math.sin((TAU * t) / 1.9)
      return
    }
    if (pose === 'walk' || pose === 'carry') {
      const k = pose === 'carry' ? 0.75 : 1
      const phi = TAU * 1.9 * t
      const s = Math.sin(phi)
      r.y = 0.045 * k * Math.abs(s)
      r.tiltZ = -0.12 * k * s
      r.tiltX = 0.07 * k
      r.squash = 0.95 + 0.09 * Math.abs(s)
      this.legs.forEach((_, i) => {
        const ls = i % 2 ? -s : s
        r.legLift[i] = 0.05 * k * Math.max(0, ls)
        r.legSwing[i] = 0.45 * k * ls
      })
      for (let i = 0; i < nArms; i++) {
        const a = this.arms[i]
        if (pose === 'carry') {
          r.armRaise[i] = UP - a.rest + 0.06 * Math.sin(phi * 2)
          r.armSwing[i] = 0
        } else if (a.wing) {
          r.armRaise[i] = 0.35 + 0.45 * Math.sin(phi * 2)
        } else {
          r.armRaise[i] = 0.2 + 0.15 * Math.sin(phi * 2)
          r.armSwing[i] = 0.5 * s * a.side
        }
      }
      r.topSway = 0.18 * s
      if (pose === 'carry') r.prop = 0.09 * Math.sin(phi + 0.6)
      return
    }
    if (pose === 'hammer') {
      // anticipation (slow raise) -> strike (fast) -> recoil, every 0.45 s
      const u = frac(t / 0.45)
      const up = -1.05
      const hit = 1.75
      const rest = 0.3
      let a: number
      let impact = 0
      if (u < 0.55) a = rest + (up - rest) * smooth(u / 0.55)
      else if (u < 0.68) {
        const v = (u - 0.55) / 0.13
        a = up + (hit - up) * v * v
      } else {
        const v = (u - 0.68) / 0.32
        a = rest + (hit - rest) * (1 - v) * (1 - v) + 0.18 * Math.sin(Math.PI * v) * (1 - v)
        impact = Math.exp(-v * 9)
      }
      const windUp = u < 0.55 ? smooth(u / 0.55) : u < 0.68 ? 1 - (u - 0.55) / 0.13 : 0
      r.toolAngle = a
      r.tool = 1
      r.tiltX = -0.13 + 0.38 * ((a - up) / (hit - up))
      r.tiltZ = -0.05
      r.squash = 1 + 0.05 * windUp - 0.16 * impact
      r.y = 0.015 * windUp
      for (let i = 0; i < nArms; i++) r.armRaise[i] = i === this.hammerArm ? 1.0 * (1 - (a - up) / (hit - up)) + 0.1 : 0.25 + 0.1 * windUp
      r.topSway = 0.25 * impact - 0.1 * windUp
      return
    }
    // cheer: jumps, arms up, a happy squash on landing
    const u = frac(t / 0.78)
    if (u < 0.58) {
      const v = u / 0.58
      r.y = 0.2 * 4 * v * (1 - v)
      r.squash = 1 + 0.07 * Math.sin(Math.PI * v)
      this.legs.forEach((_, i) => {
        r.legLift[i] = 0.02
        r.legSwing[i] = (i % 2 ? -1 : 1) * 0.25
      })
    } else {
      const v = (u - 0.58) / 0.42
      r.squash = 1 - 0.17 * Math.sin(Math.PI * v) * (1 - v * 0.3)
    }
    r.tiltZ = 0.09 * Math.sin((TAU * t) / 1.56)
    for (let i = 0; i < nArms; i++) r.armRaise[i] = UP + 0.15 - this.arms[i].rest + 0.3 * Math.sin(TAU * t * 3 + i * 1.3)
    r.topSway = 0.2 * Math.sin(TAU * t * 1.4)
  }

  private apply(r: Rig, t: number) {
    const g = this.rigGroup
    g.position.y = r.y * g.scale.y
    g.rotation.set(r.tiltX, 0, r.tiltZ)
    const sq = Math.max(0.6, r.squash)
    const side = 1 / Math.sqrt(sq)
    this.body.scale.set(side, sq, side)
    this.legs.forEach((leg, i) => {
      leg.group.position.set(leg.pivot.x, leg.pivot.y + r.legLift[i], leg.pivot.z)
      leg.group.rotation.x = r.legSwing[i]
    })
    this.arms.forEach((arm, i) => {
      arm.group.rotation.set(r.armSwing[i], 0, arm.side * r.armRaise[i])
    })
    this.tops.forEach((top, i) => {
      top.rotation.z = r.topSway * (1 + 0.35 * i) * (i % 2 ? -1 : 1)
    })
    if (this.eyes) {
      // a quick blink every few seconds
      const b = frac(t / this.blinkEvery)
      this.eyes.scale.y = b < 0.045 ? 1 - 0.88 * Math.sin((Math.PI * b) / 0.045) : 1
    }
    this.tool.visible = r.tool > 0.02
    this.tool.scale.setScalar(Math.max(0.001, r.tool))
    this.tool.rotation.x = r.toolAngle
    this.holder.rotation.z = r.prop
    if (this.cloth) this.cloth.rotation.y = 0.35 * Math.sin(TAU * t * 1.3) - 0.15
  }

  dispose(): void {
    if (this.held?.parent === this.holder) this.holder.remove(this.held)
    this.held = null
    for (const m of this.meshes) m.dispose()
    this.root.removeFromParent()
  }
}

function clear(r: Rig) {
  r.y = r.tiltX = r.tiltZ = r.squash = r.tool = r.toolAngle = r.prop = r.topSway = 0
  r.legLift.fill(0)
  r.legSwing.fill(0)
  r.armRaise.fill(0)
  r.armSwing.fill(0)
}

function mix(out: Rig, r: Rig, w: number) {
  out.y += r.y * w
  out.tiltX += r.tiltX * w
  out.tiltZ += r.tiltZ * w
  out.squash += r.squash * w
  out.tool += r.tool * w
  // the hammer keeps its swing while it shrinks away
  if (r.tool > 0) out.toolAngle = r.toolAngle
  out.prop += r.prop * w
  out.topSway += r.topSway * w
  for (let i = 0; i < out.legLift.length; i++) {
    out.legLift[i] += r.legLift[i] * w
    out.legSwing[i] += r.legSwing[i] * w
  }
  for (let i = 0; i < out.armRaise.length; i++) {
    out.armRaise[i] += r.armRaise[i] * w
    out.armSwing[i] += r.armSwing[i] * w
  }
}

/** A hero whose level of detail can be switched at any time. */
export interface DetailedHero extends Hero {
  detail: HeroDetail
}

/**
 * A hero: one of the website's agents as a voxel toy. `tint` adds a little flag
 * in that colour on its back (a Branch's colour, say). `detail` starts it at
 * 'high' (the default) or 'low'; change `hero.detail` any time.
 */
export function makeHero(name: string, opts: { scale?: number; tint?: THREE.Color; detail?: HeroDetail } = {}): DetailedHero {
  return new VoxelHero(name, opts.scale ?? 1, opts.tint, opts.detail ?? 'high')
}
