import { t, useI18n, getLocale } from '@/i18n'
// Timeline in 3D: the project's history as a fairy-tale castle (three.js),
// from the same fork tree the 2D map draws.
//   main       the castle keep, one round storey per Layer, Init at the bottom
//              with turrets around it. A storey is painted in the colour of the
//              Branch whose publish made it (cream when no Branch did), with a
//              gold trim and lit windows; a blue spire with a pennant on top.
//   a Branch   a bridge leaving the storey it forked from (main as it was
//              then), one rounded block per Commit; a Branch forked from a
//              Commit turns sideways off that Commit's block
//   published  a turret with a pointed roof and a flag at the tip, and a line
//              climbing to the storey it built
//   open       an unfinished turret with a gold sparkle; merged: paler
//   a fork     a gold gate where the bridge leaves its parent
//   a merge    an arc from the merged-in Commit to the merge Commit, ending
//              in a gold knot
// No text is on screen until a block is pointed at: then a card says what it
// is (a Layer's publisher and its Commits, a Commit's message and files, a
// fork's point, a merge's two sides). "Show cards" pins a short card to every
// Layer and Branch instead. Pointing at a storey shows the castle as of that
// Layer: it and the storeys under it (its full view) stay solid, and what came
// later turns to glass. "Pull apart" lifts every storey off the one below it,
// so each Layer's whole block is in view. A click opens the Branch in History. Blocks are drawn in batches
// (instanced), so thousands stay smooth; the scene draws only when something
// moves. Loaded on demand (React.lazy): 2D never loads three.
import { Layers, Maximize2, StickyNote } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js'

import { Button } from '@/components/ui/button'
import { type FileChange, type ForkBranch, type ForkTree, type HistoryCommit } from '@/data/forks'

export interface CitadelProps {
  tree: ForkTree
  /** The Branch in focus (kept for the 2D view's parity; the castle shows all). */
  focus: string
  /** The Branches the toolbar's search and filter leave (with their parents). */
  shown: Set<string>
  /** A Branch clicked: open it (History). */
  onOpen: (name: string) => void
}

// ---- sizes (scene units) -------------------------------------------------------
const KEEP_R = 2.2
const STOREY = 1.1
const BRIDGE_W = 0.82
const BRIDGE_T = 0.44
/** No bridge is drawn longer than this: a long Branch's Commits are drawn thinner. */
const ARM_MAX = 7.5
const BLOCK = 0.7
const DIRECTIONS = 8
const RISE_MS = 800

// storybook colours: pastels for Branches, cream walls, royal roofs, gold trim
const PASTELS = [0xff6fa8, 0x9b6bff, 0x4fb3ff, 0x3fd6a0, 0xff9f4a, 0xffd23f, 0xff5e7a, 0x2ec4c9, 0xc86bfa, 0x6c8cff, 0xff8c69, 0x8bd63f]
const CREAM = 0xfff0dc
const BLUSH = 0xffd9e6
const ROYAL = 0x3d55e8
const ROSE = 0xff4f9a
const GOLD = 0xf5c542
const GLOW = 0xffc94d
const GRASS = 0x7ed67a
const WATER = 0x5cc2ff

/** A Branch's colour, from its name: the same every time. */
function colorOf(name: string): THREE.Color {
  if (name === 'main') return new THREE.Color(CREAM)
  let h = 2166136261
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619)
  return new THREE.Color(PASTELS[(h >>> 0) % PASTELS.length])
}
const hex = (c: THREE.Color) => `#${c.getHexString()}`
const isDark = () => document.documentElement.classList.contains('dark') || (matchMedia('(prefers-color-scheme: dark)').matches && !document.documentElement.classList.contains('light'))

// ---- layout ----------------------------------------------------------------------

interface ArmPlan {
  b: ForkBranch
  origin: THREE.Vector3
  dir: THREE.Vector3
  seg: number
  commits: { id: string; at: THREE.Vector3 }[]
  tip: THREE.Vector3
  level: number
}

interface Floor {
  id: string
  from?: string
  message: string
  ago: string
  at: number
  y0: number
  y1: number
}

const dirOf = (k: number) => new THREE.Vector3(Math.cos((k / DIRECTIONS) * Math.PI * 2 + 0.3), 0, Math.sin((k / DIRECTIONS) * Math.PI * 2 + 0.3))

/** `gap`: room between storeys (the castle pulled apart). */
function plan(tree: ForkTree, shown: Set<string>, gap = 0) {
  const layers = [...tree.layers].reverse() // oldest first: Init at the bottom
  const lh = layers.length > 30 ? Math.max(0.45, 33 / layers.length) : STOREY
  const floors: Floor[] = layers.map((l, i) => ({ id: l.id, from: l.from, message: l.message, ago: l.ago, at: l.at, y0: i * (lh + gap), y1: i * (lh + gap) + lh }))
  const floorOf = new Map(layers.map((l, i) => [l.id, i]))
  const levelAt = (b: ForkBranch) => {
    if (b.forkedFrom?.kind === 'layer' && floorOf.has(b.forkedFrom.id)) return floorOf.get(b.forkedFrom.id)!
    const first = b.commits[b.commits.length - 1]?.at ?? 0
    let at = 0
    layers.forEach((l, i) => {
      if (l.at <= first) at = i
    })
    return at
  }
  const used = new Map<number, number[]>()
  const arms = new Map<string, ArmPlan>()
  const sideways = new Map<string, number>()
  const out: ArmPlan[] = []
  for (const name of tree.order) {
    if (name === 'main' || !shown.has(name)) continue
    const b = tree.branches.get(name)
    if (!b) continue
    const own = [...b.commits].reverse()
    const seg = Math.min(BLOCK, ARM_MAX / Math.max(own.length, 1))
    let origin: THREE.Vector3
    let dir: THREE.Vector3
    let level: number
    const parentArm = b.forkedFrom?.kind === 'commit' ? arms.get(tree.commits.get(b.forkedFrom.id)?.branch ?? '') : undefined
    const at = parentArm?.commits.find((c) => c.id === b.forkedFrom?.id)
    if (parentArm && at) {
      const n = sideways.get(parentArm.b.name) ?? 0
      sideways.set(parentArm.b.name, n + 1)
      const turn = n % 2 === 0 ? 1 : -1
      dir = new THREE.Vector3(-parentArm.dir.z * turn, 0, parentArm.dir.x * turn)
      origin = at.at.clone().add(new THREE.Vector3(0, BRIDGE_T * 0.9, 0))
      level = parentArm.level
    } else {
      level = levelAt(b)
      const near = [level - 1, level, level + 1].flatMap((l) => used.get(l) ?? [])
      let best = 0
      let bestScore = Infinity
      for (let k = 0; k < DIRECTIONS; k++) {
        const close = near.filter((d) => Math.abs(d - k) === 1 || Math.abs(d - k) === DIRECTIONS - 1).length
        const score = near.filter((d) => d === k).length * 10 + close + (used.get(level)?.includes(k) ? 100 : 0)
        if (score < bestScore) (best = k), (bestScore = score)
      }
      used.set(level, [...(used.get(level) ?? []), best])
      dir = dirOf(best)
      origin = dir.clone().multiplyScalar(KEEP_R * 0.96).setY((floors[level]?.y1 ?? lh) - BRIDGE_T / 2 - 0.05)
    }
    const commits = own.map((c, i) => ({ id: c.id, at: origin.clone().addScaledVector(dir, seg * (i + 0.5)) }))
    const tip = origin.clone().addScaledVector(dir, seg * own.length)
    const arm = { b, origin, dir, seg, commits, tip, level }
    arms.set(name, arm)
    out.push(arm)
  }
  return { floors, lh, arms: out, floorOf }
}

// ---- batches: one instanced mesh per shape and colour ---------------------------

/** What pointing at a block shows. */
interface Card {
  title: string
  /** What it is: Layer, Commit, Branch, Fork, Merge. */
  kind: string
  color: string
  lines: string[]
  files?: FileChange[]
}

interface Info {
  /** The Branch a click opens, and the card pointing at it shows. */
  branch?: string
  card?: Card
  /** The storey it came with: it is glass while the castle is shown as of an older one. */
  era?: number
  /** A storey's own index. */
  floor?: number
}

class Batches {
  private batches = new Map<string, { geo: THREE.BufferGeometry; mat: THREE.Material; items: (Info & { matrix: THREE.Matrix4 })[]; shadow: boolean; era: number }>()
  private q = new THREE.Quaternion()
  private up = new THREE.Vector3(0, 1, 0)

  add(geo: THREE.BufferGeometry, mat: THREE.Material, at: THREE.Vector3, size: THREE.Vector3, turn = 0, info: Info = {}, shadow = true) {
    const era = info.era ?? 0
    const key = `${geo.uuid}:${mat.uuid}:${era}`
    let b = this.batches.get(key)
    if (!b) this.batches.set(key, (b = { geo, mat, items: [], shadow, era }))
    this.q.setFromAxisAngle(this.up, turn)
    b.items.push({ matrix: new THREE.Matrix4().compose(at, this.q, size), ...info })
  }

  /** Adds the meshes to `into`; each knows its era, own material and shadow. */
  build(into: THREE.Group, pick: THREE.Object3D[]) {
    for (const { geo, mat, items, shadow, era } of this.batches.values()) {
      const mesh = new THREE.InstancedMesh(geo, mat, items.length)
      items.forEach((it, i) => mesh.setMatrixAt(i, it.matrix))
      mesh.instanceMatrix.needsUpdate = true
      mesh.castShadow = shadow
      mesh.receiveShadow = true
      mesh.userData = { items, era, mat, shadow }
      into.add(mesh)
      if (items.some((it) => it.branch)) pick.push(mesh)
    }
  }
}

// ---- cards ------------------------------------------------------------------------

const SIGN: Record<string, [string, string]> = {
  added: ['+', 'text-success'],
  modified: ['~', 'text-warning'],
  deleted: ['−', 'text-destructive'],
  removed: ['−', 'text-destructive'],
  changed: ['~', 'text-warning'],
  renamed: ['→', 'text-primary'],
}
const FILES_SHOWN = 6
const plural = (n: number, word: string) => getLocale() === 'zh-CN' ? `${n} ${t(word)}` : `${n} ${n === 1 ? word : word === 'Branch' ? 'Branches' : `${word}s`}`
const short = (id: string) => id.slice(0, 8)
const el = (tag: string, className: string, text?: string) => {
  const e = document.createElement(tag)
  e.className = className
  if (text !== undefined) e.textContent = text
  return e
}
const dot = (color: string) => {
  const d = el('i', 'inline-block size-2.5 shrink-0 rounded-full ring-1 ring-black/10')
  d.style.background = color
  return d
}

/** Every file some of `commits` changed, as the newest of them left it. */
function filesOf(commits: HistoryCommit[]): FileChange[] {
  const files = new Map<string, FileChange>()
  for (const c of [...commits].reverse()) for (const f of c.changes) files.set(f.path, f)
  return [...files.values()]
}

/** The card shown while a block is pointed at. */
function fullCard(card: Card): HTMLElement {
  const box = el('div', 'w-72 overflow-hidden rounded-xl border bg-card/95 text-xs text-foreground shadow-lg backdrop-blur-sm')
  const stripe = el('div', 'h-1')
  stripe.style.background = card.color
  const body = el('div', 'space-y-1 px-3 py-2')
  const head = el('div', 'flex items-center gap-1.5')
  head.append(dot(card.color), el('span', 'truncate font-medium', card.title), el('span', 'ml-auto shrink-0 rounded-full bg-muted px-1.5 py-px text-[10px] text-muted-foreground', t(card.kind)))
  body.append(head)
  card.lines.forEach((line, i) => body.append(el('p', i === 0 ? 'line-clamp-2 text-foreground' : 'line-clamp-2 text-muted-foreground', line)))
  if (card.files?.length) {
    const list = el('ul', 'mt-1.5 space-y-0.5 border-t pt-1.5 font-mono text-[11px]')
    for (const f of card.files.slice(0, FILES_SHOWN)) {
      const [sign, tone] = SIGN[f.kind.toLowerCase()] ?? ['·', 'text-muted-foreground']
      const row = el('li', 'flex gap-1.5')
      row.append(el('span', `w-2 shrink-0 ${tone}`, sign), el('span', 'truncate', f.path))
      list.append(row)
    }
    if (card.files.length > FILES_SHOWN) list.append(el('li', 'pl-3.5 font-sans text-muted-foreground', t(card.files.length - FILES_SHOWN === 1 ? 'and {count} more file' : 'and {count} more files', { count: card.files.length - FILES_SHOWN })))
    body.append(list)
  }
  box.append(stripe, body)
  return box
}

/** The one-line card "Show cards" pins. */
function pinCard(color: string, title: string, line: string): HTMLElement {
  const pill = el('div', 'flex max-w-[15rem] items-center gap-1.5 rounded-full border bg-card/90 px-2 py-0.5 text-[11px] whitespace-nowrap text-foreground shadow-sm backdrop-blur-sm')
  pill.append(dot(color), el('span', 'shrink-0 font-medium', title), el('span', 'truncate text-muted-foreground', line))
  return pill
}

const PINS_KEY = 'connect.timeline.cards'
const APART_KEY = 'connect.timeline.apart'
const readFlag = (key: string) => {
  try {
    return localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}
const saveFlag = (key: string, on: boolean) => {
  try {
    localStorage.setItem(key, on ? '1' : '0')
  } catch {
    // not remembered
  }
}

// ---- the component ------------------------------------------------------------------

export default function Citadel({ tree, shown, onOpen }: CitadelProps) {
  const { locale } = useI18n()
  const box = useRef<HTMLDivElement>(null)
  const api = useRef<{ fit: () => void; pins: (on: boolean) => void } | null>(null)
  const [pinsShown, setPinsShown] = useState(() => readFlag(PINS_KEY))
  const pinsOn = useRef(pinsShown)
  const [apart, setApart] = useState(() => readFlag(APART_KEY))
  // where the camera was, so a rebuild (new Commits, pulled apart) keeps the view
  const camera0 = useRef<{ position: THREE.Vector3; target: THREE.Vector3; apart: boolean } | null>(null)
  const open = useRef(onOpen)
  open.current = onOpen
  const [failed, setFailed] = useState(false)
  const [dark, setDark] = useState(isDark)

  useEffect(() => {
    const again = () => setDark(isDark())
    const media = matchMedia('(prefers-color-scheme: dark)')
    media.addEventListener('change', again)
    const watch = new MutationObserver(again)
    watch.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] })
    return () => {
      media.removeEventListener('change', again)
      watch.disconnect()
    }
  }, [])

  useEffect(() => {
    const host = box.current
    if (!host) return
    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    } catch {
      setFailed(true)
      return
    }
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.setClearColor(0x000000, 0)
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = dark ? 0.95 : 0.92
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    host.appendChild(renderer.domElement)
    const labels = new CSS2DRenderer()
    labels.domElement.className = 'pointer-events-none absolute inset-0'
    host.appendChild(labels.domElement)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 4000)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = !reduce
    controls.dampingFactor = 0.08
    controls.maxPolarAngle = Math.PI * 0.48
    scene.add(new THREE.HemisphereLight(dark ? 0x8f8cff : 0xcfe8ff, dark ? 0x40305a : 0xffd0e0, dark ? 1.2 : 1.15))
    const sun = new THREE.DirectionalLight(dark ? 0xffd9f0 : 0xfff1d6, dark ? 1.6 : 2.4)
    sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
    sun.shadow.bias = -0.0005
    sun.shadow.radius = 4
    scene.add(sun, sun.target)

    // ---- materials and shapes ----
    const disposables: { dispose: () => void }[] = []
    const keep = <T extends { dispose: () => void }>(x: T) => (disposables.push(x), x)
    const mats = new Map<string, THREE.MeshStandardMaterial>()
    const paint = (color: THREE.Color | number, o: { opacity?: number; glow?: number; rough?: number } = {}) => {
      const c = new THREE.Color(color)
      const key = `${c.getHexString()}:${o.opacity ?? 1}:${o.glow ?? 0}:${o.rough ?? 0.55}`
      let m = mats.get(key)
      if (!m)
        mats.set(
          key,
          (m = keep(
            new THREE.MeshStandardMaterial({
              color: c,
              roughness: o.rough ?? 0.55,
              metalness: o.rough !== undefined && o.rough < 0.3 ? 0.35 : 0,
              transparent: (o.opacity ?? 1) < 1,
              opacity: o.opacity ?? 1,
              emissive: o.glow ? c : new THREE.Color(0),
              emissiveIntensity: o.glow ?? 0,
            }),
          )),
        )
      return m
    }
    const gold = paint(GOLD, { rough: 0.25 })
    const block = keep(new RoundedBoxGeometry(1, 1, 1, 3, 0.12))
    const drum = keep(new THREE.CylinderGeometry(1, 1, 1, 40))
    const cone = keep(new THREE.ConeGeometry(1, 1, 32))
    const ring = keep(new THREE.TorusGeometry(1, 0.035, 8, 64))
    const ball = keep(new THREE.SphereGeometry(1, 16, 12))
    const star = keep(new THREE.OctahedronGeometry(1))
    const pennant = keep(new THREE.ConeGeometry(1, 1, 3))
    const gate = keep(new THREE.TorusGeometry(1, 0.11, 10, 32, Math.PI))
    const batches = new Batches()
    // the spire, apart: it sits on whichever storey the castle is shown as of
    const crown = new Batches()
    const spire = new THREE.Group()
    const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)
    const lighter = (c: THREE.Color, k: number) => c.clone().lerp(new THREE.Color(0xffffff), k)

    /** A turret: a drum, a pointed roof, a gold tip and a pennant. */
    const turret = (at: THREE.Vector3, r: number, h: number, wall: THREE.Color, roof: THREE.Color | number, flag: THREE.Color | number, info: Info) => {
      batches.add(drum, paint(wall), at.clone().setY(at.y + h / 2), v(r, h, r), 0, info)
      batches.add(ring, gold, at.clone().setY(at.y + h), v(r * 1.04, r * 1.04, r * 1.04), 0, info, false)
      const rh = r * 2.6
      batches.add(cone, paint(roof), at.clone().setY(at.y + h + rh / 2), v(r * 1.25, rh, r * 1.25), 0, info)
      batches.add(ball, gold, at.clone().setY(at.y + h + rh + 0.06), v(0.07, 0.07, 0.07), 0, info, false)
      batches.add(pennant, paint(flag), at.clone().add(v(r * 0.45, h + rh * 0.92, 0)), v(0.12, r * 0.9, 0.02), Math.PI / 2, info, false)
    }

    // ---- the world ----
    const p = plan(tree, shown, apart ? 1 : 0)
    const world = new THREE.Group()
    scene.add(world)
    /** The first storey published at or after `t` (past the top: after every Layer). */
    const eraOf = (t: number) => {
      const i = p.floors.findIndex((f) => f.at >= t)
      return i < 0 ? p.floors.length : i
    }
    const pick: THREE.Object3D[] = []
    const colorFor = (b: ForkBranch) => (b.state === 'merged' ? lighter(colorOf(b.name), 0.45) : colorOf(b.name))
    const top = p.floors[p.floors.length - 1]?.y1 ?? STOREY
    const floorName = (i: number | undefined) => (i === undefined ? t('a Layer') : i === 0 ? t('Init') : t('Layer {index}', { index: i }))
    // the Branches each Branch's Commits were merged into
    const mergedInto = new Map<string, Set<string>>()
    for (const c of tree.commits.values()) {
      const from = c.merged ? tree.commits.get(c.merged) : undefined
      if (from && from.branch !== c.branch) mergedInto.set(from.branch, (mergedInto.get(from.branch) ?? new Set()).add(c.branch))
    }
    const forkPoint = (b: ForkBranch) => {
      const f = b.forkedFrom
      if (!f) return `${b.parent ?? 'main'}`
      if (f.kind === 'layer') return t('main at {layer}', { layer: floorName(p.floorOf.get(f.id)) })
      const c = tree.commits.get(f.id)
      return c ? t('{branch} at Commit {id}: {message}', { branch: c.branch, id: short(c.id), message: c.message }) : t('Commit {id}', { id: short(f.id) })
    }
    const stateLine = (b: ForkBranch) =>
      b.state === 'published'
        ? t('Published as {layer} of main', { layer: floorName(b.publishedAs !== undefined ? p.floorOf.get(b.publishedAs) : undefined) })
        : b.state === 'merged'
          ? t('Merged into {branches}', { branches: [...(mergedInto.get(b.name) ?? [b.parent ?? t('its parent')])].join(', ') })
          : t('Open: still being worked on')
    const branchCard = (b: ForkBranch): Card => ({
      kind: 'Branch',
      title: b.name,
      color: hex(colorOf(b.name)),
      lines: [
        stateLine(b),
        t('Forked from {point}', { point: forkPoint(b) }),
        `${plural(b.commits.length, 'Commit')}${b.agent ? t(' by {agent}', { agent: b.agent }) : ''}${b.children.length ? t(' · {forks} off it', { forks: plural(b.children.length, 'fork') }) : ''}`,
        ...(b.commits[0] ? [t('Last: {message}', { message: b.commits[0].message })] : []),
      ],
      files: filesOf(b.commits),
    })
    const pins: { obj: CSS2DObject; era: number; side?: number; y?: number }[] = []
    const pinGroup = new THREE.Group()
    pinGroup.visible = pinsOn.current
    world.add(pinGroup)
    const pin = (pill: HTMLElement, at: THREE.Vector3, center: [number, number], era: number, side?: number) => {
      const obj = new CSS2DObject(pill)
      obj.position.copy(at)
      obj.center.set(...center)
      pinGroup.add(obj)
      pins.push({ obj, era, side, y: at.y })
    }

    // the keep: one storey per Layer, in its publisher's colour
    p.floors.forEach((f, i) => {
      const publisher = f.from ? tree.branches.get(f.from) : undefined
      const name = publisher?.name ?? 'main'
      const wall = publisher ? colorOf(publisher.name) : new THREE.Color(i % 2 ? BLUSH : CREAM)
      const shownCommits = publisher?.commits.slice(0, 4) ?? []
      const more = (publisher?.commits.length ?? 0) - shownCommits.length
      const card: Card = {
        kind: 'Layer',
        title: floorName(i),
        color: hex(publisher ? wall : new THREE.Color(ROYAL)),
        lines: [
          f.message,
          `${i === 0 ? t('Where main begins') : publisher ? t('Published by {name}{agent}', { name: publisher.name, agent: publisher.agent ? ` (${publisher.agent})` : '' }) : t('Published by a Branch no longer listed')} · ${f.ago}`,
          ...(publisher ? [t('{commits} went into it:', { commits: plural(publisher.commits.length, 'Commit') }), ...shownCommits.map((c) => `• ${c.message}`), ...(more > 0 ? [t('and {count} more', { count: more })] : [])] : []),
        ],
        files: publisher ? filesOf(publisher.commits) : undefined,
      }
      const info: Info = { branch: name, card, era: i, floor: i }
      const r = KEEP_R * (1 - i * 0.004)
      const h = f.y1 - f.y0
      batches.add(drum, paint(wall), v(0, (f.y0 + f.y1) / 2, 0), v(r, h - 0.02, r), 0, info)
      batches.add(ring, gold, v(0, f.y1 - 0.01, 0), v(r * 1.01, r * 1.01, r * 1.01), 0, info, false)
      // lit windows, turned a little each storey
      if (h > 0.5)
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2 + i * 0.5
          const at = v(Math.cos(a) * r, (f.y0 + f.y1) / 2, Math.sin(a) * r)
          batches.add(block, paint(GLOW, { glow: dark ? 0.9 : 0.5 }), at, v(0.1, h * 0.36, 0.2), -a, info, false)
        }
      const side = i % 2 ? -1 : 1
      pin(pinCard(card.color, card.title, f.message), v(0, (f.y0 + f.y1) / 2, 0), [side > 0 ? 0 : 1, 0.5], i, side)
    })
    // the spire on top, with main's pennant
    {
      const info: Info = {
        branch: 'main',
        card: { kind: 'Branch', title: 'main', color: hex(new THREE.Color(ROYAL)), lines: [t('{layers} on Init', { layers: plural(Math.max(0, p.floors.length - 1), 'published Layer') }), t('{branches} around it', { branches: plural(p.arms.length, 'Branch') })] },
      }
      const rh = KEEP_R * 2.2
      crown.add(cone, paint(ROYAL), v(0, top + rh / 2, 0), v(KEEP_R * 1.12, rh, KEEP_R * 1.12), 0, info)
      crown.add(ball, gold, v(0, top + rh + 0.12, 0), v(0.16, 0.16, 0.16), 0, info, false)
      crown.add(drum, gold, v(0, top + rh + 0.55, 0), v(0.03, 0.8, 0.03), 0, info, false)
      crown.add(pennant, paint(ROSE), v(0.32, top + rh + 0.78, 0), v(0.2, 0.62, 0.03), Math.PI / 2, info, false)
      // turrets around the foot of the keep
      const h = Math.min(Math.max(top * 0.45, 1.6), 4.5)
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2 + Math.PI / 4
        turret(v(Math.cos(a) * (KEEP_R + 0.55), 0, Math.sin(a) * (KEEP_R + 0.55)), 0.62, h, new THREE.Color(CREAM), k % 2 ? ROSE : ROYAL, k % 2 ? ROYAL : ROSE, info)
      }
    }

    // the bridges: one block per Commit, a gate where each forks
    const at = new Map<string, THREE.Vector3>()
    const levelOf = new Map<string, number>()
    for (const a of p.arms) {
      const color = colorFor(a.b)
      const n = a.b.commits.length
      const built = a.b.publishedAs !== undefined ? p.floorOf.get(a.b.publishedAs) : undefined
      const info: Info = { branch: a.b.name, card: branchCard(a.b), era: Math.max(a.level, built ?? eraOf(a.b.commits[0]?.at ?? 0)) }
      const turn = -Math.atan2(a.dir.z, a.dir.x)
      const own = [...a.b.commits].reverse()
      a.commits.forEach((c, i) => {
        const commit = own[i]
        at.set(c.id, c.at)
        levelOf.set(c.id, a.level)
        const from = commit?.merged ? tree.commits.get(commit.merged) : undefined
        const card: Card = {
          kind: from ? 'Merge' : 'Commit',
          title: t('{branch} · {index} of {count}', { branch: a.b.name, index: i + 1, count: n }),
          color: hex(colorOf(a.b.name)),
          lines: [commit?.message ?? '', `${short(c.id)} · ${commit?.ago ?? ''}${commit?.by ? t(' · by {agent}', { agent: commit.by }) : ''}`, ...(from ? [t('Brings in {branch} at {id}: {message}', { branch: from.branch, id: short(from.id), message: from.message })] : [])],
          files: commit?.changes,
        }
        batches.add(block, paint(i % 2 ? lighter(color, 0.18) : color), c.at, v(Math.max(0.05, a.seg - 0.05), BRIDGE_T, BRIDGE_W), turn, { branch: a.b.name, card, era: Math.max(a.level, eraOf(commit?.at ?? 0)) })
      })
      // the gate it leaves through
      const gateInfo: Info = { branch: a.b.name, era: Math.max(a.level, eraOf(own[0]?.at ?? 0)), card: { kind: 'Fork', title: t('{branch} forks', { branch: a.b.name }), color: hex(colorOf(a.b.name)), lines: [t('From {point}', { point: forkPoint(a.b) }), t('{commits} on it since · {state}', { commits: plural(n, 'Commit'), state: t(a.b.state) })] } }
      const base = a.origin.clone().setY(a.origin.y + BRIDGE_T / 2)
      batches.add(gate, gold, base.clone().addScaledVector(a.dir, 0.12), v(BRIDGE_W * 0.62, 0.62, 0.7), turn + Math.PI / 2, gateInfo, false)
      batches.add(ball, gold, a.origin.clone().setY(a.origin.y - BRIDGE_T / 2 + 0.02), v(0.16, 0.08, 0.16), 0, gateInfo, false)
      const end = a.tip.clone().addScaledVector(a.dir, 0.42)
      const floor = a.origin.y - BRIDGE_T / 2
      if (a.b.state === 'published') {
        turret(end.clone().setY(floor), 0.4, 1.0, lighter(color, 0.15), color.clone().multiplyScalar(0.78), color, info)
        // the line it climbs to the storey it built
        const to = a.b.publishedAs !== undefined ? p.floorOf.get(a.b.publishedAs) : undefined
        if (to !== undefined) {
          const f = p.floors[to]
          const y = (f.y0 + f.y1) / 2
          const wall = new THREE.Vector3(end.x, 0, end.z).setLength(KEEP_R).setY(y)
          const curve = new THREE.CatmullRomCurve3([end.clone().setY(floor + 2.3), end.clone().setY(Math.max(y, floor + 2.3) + 0.4), wall], false, 'catmullrom', 0.3)
          const line = new THREE.Mesh(keep(new THREE.TubeGeometry(curve, 40, 0.035, 6)), paint(color, { opacity: 0.85, glow: 0.25 }))
          line.userData = { items: [info], era: info.era, mat: line.material, shadow: false }
          world.add(line)
          pick.push(line)
        }
      } else if (a.b.state === 'open') {
        // an unfinished turret, a sparkle over it
        batches.add(drum, paint(lighter(color, 0.2), { opacity: 0.7 }), end.clone().setY(floor + 0.3), v(0.4, 0.6, 0.4), 0, info, false)
        batches.add(star, paint(GOLD, { glow: 0.8, rough: 0.3 }), end.clone().setY(floor + 1.05), v(0.14, 0.2, 0.14), 0.4, info, false)
      } else batches.add(block, paint(lighter(color, 0.2)), end.clone().setY(floor + 0.2), v(0.42, 0.4, 0.42), turn, info)
      const high = a.b.state === 'published' ? 2.5 : a.b.state === 'open' ? 1.3 : 0.6
      pin(pinCard(hex(colorOf(a.b.name)), a.b.name, `${plural(n, 'Commit')} · ${t(a.b.state)}`), end.clone().setY(floor + high), [0.5, 1], info.era ?? 0)
    }

    // the merges: an arc from the merged-in Commit to the merge, a gold knot where it lands
    for (const c of tree.commits.values()) {
      const from = c.merged ? tree.commits.get(c.merged) : undefined
      const a0 = from && at.get(from.id)
      const b0 = at.get(c.id)
      if (!from || !a0 || !b0) continue
      const s = a0.clone().setY(a0.y + BRIDGE_T / 2)
      const e = b0.clone().setY(b0.y + BRIDGE_T / 2)
      const mid = s.clone().lerp(e, 0.5).setY(Math.max(s.y, e.y) + 0.8 + s.distanceTo(e) * 0.3)
      const info: Info = {
        branch: c.branch,
        era: Math.max(eraOf(c.at), levelOf.get(c.id) ?? 0, levelOf.get(from.id) ?? 0),
        card: {
          kind: 'Merge',
          title: `${from.branch} → ${c.branch}`,
          color: hex(colorOf(from.branch)),
          lines: [c.message, t('Merge Commit {id} · {time}', { id: short(c.id), time: c.ago }), t('Brings in {id}: {message}', { id: short(from.id), message: from.message })],
          files: c.changes,
        },
      }
      const arc = new THREE.Mesh(keep(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(s, mid, e), 48, 0.06, 8)), paint(colorOf(from.branch), { glow: 0.35 }))
      arc.castShadow = true
      arc.userData = { items: [info], era: info.era, mat: arc.material, shadow: true }
      world.add(arc)
      pick.push(arc)
      batches.add(ball, gold, e, v(0.17, 0.17, 0.17), 0, info, false)
      batches.add(ball, paint(colorOf(from.branch)), s, v(0.1, 0.1, 0.1), 0, info, false)
    }

    // the island and its moat
    const reach = Math.max(KEEP_R + 4, ...p.arms.map((a) => Math.hypot(a.tip.x, a.tip.z) + 1.6))
    batches.add(drum, paint(dark ? 0x5fae7a : GRASS, { rough: 0.9 }), v(0, -0.25, 0), v(reach, 0.5, reach), 0, {}, false)
    batches.add(drum, paint(dark ? 0x3f7fb8 : WATER, { rough: 0.2 }), v(0, -0.42, 0), v(reach + 1.6, 0.3, reach + 1.6), 0, {}, false)
    batches.add(drum, paint(dark ? 0x7a6a5a : 0xe9d7b8, { rough: 0.95 }), v(0, -0.9, 0), v(reach + 0.4, 0.7, reach + 0.4), 0, {}, false)
    batches.build(world, pick)
    crown.build(spire, pick)
    world.add(spire)

    // the castle as of storey `n` (null: as it is now)
    const glass = keep(new THREE.MeshStandardMaterial({ color: dark ? 0xc9c3ff : 0xffffff, transparent: true, opacity: dark ? 0.1 : 0.16, depthWrite: false, roughness: 0.2 }))
    let asOfNow: number | null = null
    const asOf = (n: number | null) => {
      if (n === asOfNow) return
      asOfNow = n
      world.traverse((o: THREE.Object3D) => {
        const d = o.userData as { era?: number; mat?: THREE.Material; shadow?: boolean }
        if (!(o instanceof THREE.Mesh) || d.mat === undefined) return
        const later = n !== null && (d.era ?? 0) > n
        o.material = later ? glass : d.mat
        o.castShadow = !later && !!d.shadow
      })
      spire.position.y = n === null ? 0 : p.floors[n].y1 - top
      for (const pin of pins) pin.obj.visible = n === null || pin.era <= n
      invalidate()
    }

    // the card for what is pointed at
    const tagEl = el('div', '')
    const tag = new CSS2DObject(tagEl)
    tag.visible = false
    world.add(tag)

    // ---- drawing on demand ----
    let frame = 0
    let started = performance.now()
    const draw = () => {
      frame = 0
      const moving = controls.update()
      let rising = false
      if (!reduce) {
        const k = Math.min(1, (performance.now() - started) / RISE_MS)
        world.scale.set(1, Math.max(0.0001, 1 - Math.pow(1 - k, 3)), 1)
        rising = k < 1
      }
      if (pinGroup.visible) placePins()
      renderer.render(scene, camera)
      labels.render(scene, camera)
      if (pinGroup.visible) declutter()
      tagEl.style.zIndex = '100000'
      if (moving || rising) invalidate()
    }
    // A storey's card sits beside the keep, on the side facing the viewer's
    // left or right (alternating), wherever the camera has turned.
    const right = new THREE.Vector3()
    const placePins = () => {
      camera.updateMatrixWorld()
      right.setFromMatrixColumn(camera.matrixWorld, 0).setY(0).normalize()
      for (const pin of pins) if (pin.side) pin.obj.position.copy(right).multiplyScalar((KEEP_R + 0.2) * pin.side).setY(pin.y ?? 0)
    }
    // Cards that would cover one already shown are hidden: storeys from the
    // top first, then the Branches.
    const declutter = () => {
      const kept: DOMRect[] = []
      for (const pin of pins) {
        const e = pin.obj.element
        if (e.style.display === 'none') continue
        const r = e.getBoundingClientRect()
        const covers = kept.some((k) => r.left < k.right + 2 && r.right > k.left - 2 && r.top < k.bottom + 1 && r.bottom > k.top - 1)
        e.style.visibility = covers ? 'hidden' : ''
        if (!covers) kept.push(r)
      }
    }
    pins.sort((x, y) => (x.side ? 0 : 1) - (y.side ? 0 : 1) || (y.side ? (y.y ?? 0) - (x.y ?? 0) : 0))
    const invalidate = () => {
      if (!frame) frame = requestAnimationFrame(draw)
    }
    controls.addEventListener('change', invalidate)

    const fit = () => {
      world.scale.set(1, 1, 1)
      asOf(null)
      const box = new THREE.Box3().setFromObject(world)
      const sphere = box.getBoundingSphere(new THREE.Sphere())
      // Step back until every corner of the castle's box is on screen, with a margin.
      const corners = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => new THREE.Vector3(k & 1 ? box.max.x : box.min.x, k & 2 ? box.max.y : box.min.y, k & 4 ? box.max.z : box.min.z))
      const look = new THREE.Vector3(1, 0.5, 1.2).normalize()
      controls.target.copy(box.getCenter(new THREE.Vector3()))
      let dist = (sphere.radius / Math.sin((camera.fov * Math.PI) / 360)) * 0.8
      for (let k = 0; k < 6; k++) {
        camera.position.copy(controls.target).addScaledVector(look, dist)
        camera.lookAt(controls.target)
        camera.near = dist / 200
        camera.far = dist * 10
        camera.updateProjectionMatrix()
        camera.updateMatrixWorld()
        const reach = Math.max(...corners.map((c) => {
          const n = c.clone().project(camera)
          return Math.max(Math.abs(n.x), Math.abs(n.y))
        }))
        dist *= Math.max(0.5, Math.min(2, reach / 0.88))
      }
      camera.position.copy(controls.target).addScaledVector(look, dist)
      camera.near = dist / 200
      camera.far = dist * 10
      camera.updateProjectionMatrix()
      const s = sun.shadow.camera
      s.left = s.bottom = -sphere.radius
      s.right = s.top = sphere.radius
      s.far = sphere.radius * 6
      s.updateProjectionMatrix()
      sun.position.copy(sphere.center).add(new THREE.Vector3(0.8, 2, 0.9).multiplyScalar(sphere.radius))
      sun.target.position.copy(sphere.center)
      controls.update()
      invalidate()
    }
    api.current = {
      fit,
      pins: (on) => {
        pinGroup.visible = on
        invalidate()
      },
    }

    const resize = () => {
      const w = host.clientWidth
      const h = host.clientHeight
      if (!w || !h) return
      renderer.setSize(w, h)
      labels.setSize(w, h)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      invalidate()
    }
    const ro = new ResizeObserver(resize)
    ro.observe(host)
    resize()
    fit()
    // A rebuild keeps the camera (pulled apart or together: fitted again, no rise).
    const was = camera0.current
    if (was?.apart === apart) {
      camera.position.copy(was.position)
      controls.target.copy(was.target)
      controls.update()
    }
    started = performance.now()
    if (!reduce && !was) world.scale.set(1, 0.0001, 1)
    else started -= RISE_MS
    invalidate()

    // ---- pointing and clicking ----
    const ray = new THREE.Raycaster()
    const pointer = new THREE.Vector2()
    let pointed: Card | undefined
    const hit = (e: PointerEvent) => {
      const r = renderer.domElement.getBoundingClientRect()
      pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
      ray.setFromCamera(pointer, camera)
      for (const found of ray.intersectObjects(pick, false)) {
        const items = found.object.userData.items as Info[] | undefined
        const it = items?.[found.instanceId ?? 0]
        if (it?.branch) return { ...it, at: found.point }
      }
      return undefined
    }
    let down: { x: number; y: number } | null = null
    const onDown = (e: PointerEvent) => (down = { x: e.clientX, y: e.clientY })
    const onMove = (e: PointerEvent) => {
      if (down) return
      const h = hit(e)
      if (h?.card === pointed) return
      pointed = h?.card
      canvas.style.cursor = h ? 'pointer' : 'grab'
      asOf(h?.floor ?? null)
      if (h?.card) {
        // the card opens away from the nearer edges, so it stays in view
        const r = canvas.getBoundingClientRect()
        const leftward = e.clientX - r.left > r.width * 0.6
        const below = e.clientY - r.top < r.height * 0.45
        tag.center.set(leftward ? 1 : 0, below ? 0 : 1)
        tagEl.className = `${leftward ? 'pr-3' : 'pl-3'} ${below ? 'pt-3' : 'pb-3'}`
        tagEl.replaceChildren(fullCard(h.card))
        tag.position.copy(world.worldToLocal(h.at.clone()))
        tag.visible = true
      } else tag.visible = false
      invalidate()
    }
    const onUp = (e: PointerEvent) => {
      const was = down
      down = null
      if (!was || Math.hypot(e.clientX - was.x, e.clientY - was.y) > 4) return
      const h = hit(e)
      if (h?.branch) open.current(h.branch)
    }
    const onLeave = () => {
      asOf(null)
      pointed = undefined
      tag.visible = false
      invalidate()
    }
    const canvas = renderer.domElement
    canvas.style.cursor = 'grab'
    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerup', onUp)
    canvas.addEventListener('pointerleave', onLeave)

    return () => {
      camera0.current = { position: camera.position.clone(), target: controls.target.clone(), apart }
      if (frame) cancelAnimationFrame(frame)
      ro.disconnect()
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointerleave', onLeave)
      controls.dispose()
      for (const d of disposables) d.dispose()
      world.traverse((o: THREE.Object3D) => {
        if (o instanceof THREE.InstancedMesh) o.dispose()
      })
      renderer.dispose()
      canvas.remove()
      labels.domElement.remove()
      api.current = null
    }
  }, [tree, shown, dark, apart, locale])

  if (failed)
    return <p className="m-auto max-w-sm p-8 text-center text-sm text-muted-foreground">{t("This computer could not start WebGL, so the 3D view cannot be drawn. The 2D view shows the same history.")}</p>

  // a storybook sky behind the castle: day in light, dusk in dark
  const sky = dark ? 'linear-gradient(180deg, #1c1f4f 0%, #4a2d72 55%, #8a4a7c 100%)' : 'linear-gradient(180deg, #a9d8ff 0%, #d9ecff 40%, #ffe1ef 78%, #fff1dc 100%)'
  return (
    <div className="relative min-h-0 flex-1" style={{ background: sky }}>
      <div ref={box} className="absolute inset-0 overflow-hidden" role="img" aria-label={t("3D castle of the history: {value1} Layers on main and {value2} Branches. Point at a block to see its card; click to open its Branch in History.", {value1: tree.layers.length, value2: tree.branches.size - 1})} />
      <Button
        variant="outline"
        size="icon"
        aria-label={pinsShown ? t("Hide the cards") : t("Show a card on every Layer and Branch")}
        aria-pressed={pinsShown}
        title={pinsShown ? t("Hide cards") : t("Show cards")}
        className={`absolute right-13 bottom-3 size-8 backdrop-blur-sm ${pinsShown ? 'bg-primary text-primary-foreground hover:bg-primary/90' : 'bg-card/80'}`}
        onClick={() => {
          const on = !pinsShown
          setPinsShown(on)
          pinsOn.current = on
          api.current?.pins(on)
          saveFlag(PINS_KEY, on)
        }}
      >
        <StickyNote />
      </Button>
      <Button
        variant="outline"
        size="icon"
        aria-label={apart ? t("Put the storeys back together") : t("Pull the storeys apart, so each Layer is in view")}
        aria-pressed={apart}
        title={apart ? t("Put together") : t("Pull apart")}
        className={`absolute right-23 bottom-3 size-8 backdrop-blur-sm ${apart ? 'bg-primary text-primary-foreground hover:bg-primary/90' : 'bg-card/80'}`}
        onClick={() => {
          setApart(!apart)
          saveFlag(APART_KEY, !apart)
        }}
      >
        <Layers />
      </Button>
      <Button variant="outline" size="icon" aria-label={t("Fit the castle in view")} title={t("Fit")} className="absolute right-3 bottom-3 size-8 bg-card/80 backdrop-blur-sm" onClick={() => api.current?.fit()}>
        <Maximize2 />
      </Button>
    </div>
  )
}
