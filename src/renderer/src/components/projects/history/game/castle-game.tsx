// Timeline as a game: the project's history is a castle being built on an
// island by the website's heroes (three.js). It opens on the present; Replay
// builds it again from Init, one event at a time, and new Commits, forks,
// merges and publishes animate as they arrive. The simulator swaps in a busy
// made-up history, to watch the castle grow through every tier.
import { BookOpen, FlaskConical, Maximize2, Pause, Play, RotateCcw, Video } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

import { Button } from '@/components/ui/button'
import type { ForkTree } from '@/data/forks'

import { EVOLUTION_RULES, renewalLine, tierIndexFor } from './castle'
import { compareEvents, eventsOf } from './events'
import { type HistorySim, simPreset } from './simulator'
import type { GameEvent } from './types'
import { CastleWorld, LEAD, type PickInfo, RENEW_S, type WorldNote, tierAt } from './world'
import './game.css'

export interface CastleGameProps {
  tree: ForkTree
  /** A Branch clicked: open it (History). */
  onOpen?: (branch: string) => void
  /** Replay from Init (the camp) as soon as it opens, growing to the present. On unless turned off. */
  autoplay?: boolean
}

type Source = 'project' | 'live' | 'busy' | 'huge' | 'x10' | 'x30' | 'x100'
const SOURCES: { id: Source; label: string; hint: string }[] = [
  { id: 'project', label: 'This project', hint: "The project's own history" },
  { id: 'live', label: 'Simulate live', hint: 'Made-up agents fork, commit, merge and publish as you watch' },
  { id: 'busy', label: 'Busy history', hint: 'A made-up history of about 300 actions, replayed' },
  { id: 'huge', label: 'Huge history', hint: 'A made-up history of about 1,200 actions, replayed' },
  { id: 'x10', label: '10× history', hint: 'About 12,000 actions: hundreds of Layers' },
  { id: 'x30', label: '30× history', hint: 'About 36,000 actions: two thousand Layers' },
  { id: 'x100', label: '100× history', hint: 'About 120,000 actions: thousands of Layers' },
]
const SPEEDS = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024]
/** From this speed on, events are applied in batches each frame (a time-lapse), not animated one by one. */
const TIMELAPSE = 32
/** A replay aims to last about this long, so a long history picks a faster speed. */
const REPLAY_TARGET_S = 100

const isDark = () => document.documentElement.classList.contains('dark') || (matchMedia('(prefers-color-scheme: dark)').matches && !document.documentElement.classList.contains('light'))

interface Banner {
  id: number
  kind: 'publish' | 'renew'
  text: string
  color: string
}

interface Hud {
  cursor: number
  total: number
  playing: boolean
  speed: number
  tier: number
  layers: number
  open: number
}

interface Engine {
  world: CastleWorld
  events: GameEvent[]
  cursor: number
  playing: boolean
  speed: number
  nextAt: number
  /** New events arrived while live: a big burst is skipped through, not animated one by one. */
  catchUp: boolean
  follow: boolean
  seek: (n: number) => void
  replay: () => void
  fit: () => void
}

/** How long a replay of `events` takes at 1×, roughly, in seconds. */
function replayLength(events: GameEvent[]) {
  let s = 0
  let tier = 0
  let layers = 0
  for (const e of events) {
    s += LEAD[e.kind]
    if (e.kind === 'publish') {
      const t = tierIndexFor(++layers)
      if (t !== tier) (s += RENEW_S), (tier = t)
    }
  }
  return s
}

export default function CastleGame({ tree, onOpen, autoplay = true }: CastleGameProps) {
  const box = useRef<HTMLDivElement>(null)
  const eng = useRef<Engine | null>(null)
  const open = useRef(onOpen)
  open.current = onOpen
  const [dark, setDark] = useState(isDark)
  const [failed, setFailed] = useState(false)
  const [hud, setHud] = useState<Hud>({ cursor: 0, total: 0, playing: true, speed: 1, tier: 0, layers: 0, open: 0 })
  const [notes, setNotes] = useState<(WorldNote & { id: number })[]>([])
  const [banner, setBanner] = useState<Banner | null>(null)
  const [card, setCard] = useState<(PickInfo & { x: number; y: number }) | null>(null)
  const [rules, setRules] = useState(false)
  const [follow, setFollow] = useState(true)

  // ---- where the history comes from: the project, or the simulator ----
  const [source, setSource] = useState<Source>('project')
  const sim = useRef<HistorySim | null>(null)
  const [simTree, setSimTree] = useState<ForkTree | null>(null)
  const [making, setMaking] = useState(false)
  useEffect(() => {
    if (source === 'project') {
      sim.current = null
      setSimTree(null)
      return
    }
    if (source !== 'live') {
      // a big history takes a moment to make: say so first, then make it and replay it
      setMaking(true)
      let replay = 0
      const id = setTimeout(() => {
        const s = simPreset(source, 11)
        sim.current = s
        setSimTree(s.tree())
        setMaking(false)
        replay = window.setTimeout(() => eng.current?.replay(), 60)
      }, 30)
      return () => {
        clearTimeout(id)
        clearTimeout(replay)
      }
    }
    const s = simPreset('tiny', Date.now() % 9973)
    s.setClock(Date.now())
    sim.current = s
    setSimTree(s.tree())
    // live: an action about every 1.4 s of game time
    const id = setInterval(() => {
      const e = eng.current
      if (!e || !e.playing || e.cursor < e.events.length) return
      s.setClock(Date.now())
      s.step()
      setSimTree(s.tree())
    }, 700)
    return () => clearInterval(id)
  }, [source])
  const active = source === 'project' ? tree : (simTree ?? tree)
  const events = useMemo(() => eventsOf(active), [active])
  // the scrubber's ticks: every renewal, and the publishes while there are few enough to see
  const marks = useMemo(() => {
    const out: { at: number; renew: boolean }[] = []
    let layers = 0
    events.forEach((e, i) => {
      if (e.kind !== 'publish') return
      const before = tierIndexFor(layers)
      layers++
      out.push({ at: i, renew: tierIndexFor(layers) !== before })
    })
    return out.length > 240 ? out.filter((m) => m.renew) : out
  }, [events])

  // running counts per event, so the HUD reads them without recounting a huge history
  const tally = useMemo(() => {
    const n = events.length
    const commits = new Uint32Array(n + 1)
    const forks = new Uint32Array(n + 1)
    const merges = new Uint32Array(n + 1)
    events.forEach((e, i) => {
      commits[i + 1] = commits[i] + (e.kind === 'commit' || e.kind === 'merge' ? 1 : 0)
      forks[i + 1] = forks[i] + (e.kind === 'fork' ? 1 : 0)
      merges[i + 1] = merges[i] + (e.kind === 'merge' ? 1 : 0)
    })
    return (at: number) => {
      const i = Math.max(0, Math.min(at, n))
      return { commits: commits[i], forks: forks[i], merges: merges[i] }
    }
  }, [events])

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

  // ---- the engine: renderer, world, director (rebuilt only on a theme change) ----
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
    // resolution: up to 1.5× (Retina at 2× costs nearly twice the pixels), lowered while frames run slow
    const dprMax = Math.min(window.devicePixelRatio || 1, 1.5)
    let dpr = dprMax
    renderer.setPixelRatio(dpr)
    renderer.setClearColor(0x000000, 0)
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = dark ? 0.95 : 0.98
    renderer.shadowMap.enabled = true
    // shadows are redrawn every other frame: half the cost, and nothing moves fast enough to show it
    renderer.shadowMap.autoUpdate = false
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    host.appendChild(renderer.domElement)
    const canvas = renderer.domElement

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 600)
    const controls = new OrbitControls(camera, canvas)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.maxPolarAngle = Math.PI * 0.47
    controls.minDistance = 4
    controls.maxDistance = 140
    controls.autoRotateSpeed = 0.35
    scene.add(new THREE.HemisphereLight(dark ? 0x8f8cff : 0xd6ecff, dark ? 0x40305a : 0xffe0c8, dark ? 1.15 : 1.25))
    const sun = new THREE.DirectionalLight(dark ? 0xffd9f0 : 0xfff1d6, dark ? 1.7 : 2.5)
    sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
    sun.shadow.bias = -0.0004
    sun.shadow.normalBias = 0.02
    sun.shadow.radius = 4
    scene.add(sun, sun.target)
    // a warm fill from the other side, so the shady faces are not flat
    const fill = new THREE.DirectionalLight(dark ? 0x9b8cff : 0xffd6e8, dark ? 0.35 : 0.45)
    fill.position.set(-20, 12, -14)
    scene.add(fill)

    const world = new CastleWorld(dark)
    scene.add(world.root)
    const pendingNotes: WorldNote[] = []
    let noteId = 0
    world.onNote = (n) => {
      pendingNotes.push(n)
      if (n.kind === 'renew' || n.kind === 'publish') setBanner({ id: ++noteId, kind: n.kind, text: n.text, color: n.color })
    }

    let shadowR = 0
    const fitShadow = () => {
      const r = world.radius + 3
      if (Math.abs(r - shadowR) < 0.5) return
      shadowR = r
      const s = sun.shadow.camera
      s.left = s.bottom = -r
      s.right = s.top = r
      s.near = 0.5
      s.far = r * 6
      s.updateProjectionMatrix()
      sun.position.set(0.7 * r * 1.6, 2.2 * r, 0.9 * r * 1.6)
      sun.target.position.set(0, 0, 0)
    }

    /** Where the camera stands to see the whole island as it is now, from about 30° up. */
    const view = () => {
      const r = world.radius + 0.6
      const h = world.height
      const up = Math.PI / 6
      const halfV = Math.tan((camera.fov * Math.PI) / 360)
      const halfH = halfV * camera.aspect
      const across = r / halfH
      // aim a third of the way up the castle: the island's near and far edges below, the spire above
      const ty = h * 0.33
      const tall = Math.max(r * Math.sin(up) + ty * Math.cos(up), (h - ty) * Math.cos(up) + 0.8) / halfV
      return { dist: Math.max(9, across, tall) * 1.06, ty }
    }
    const lens = (dist: number) => {
      camera.near = dist / 100
      camera.far = dist * 10
      camera.updateProjectionMatrix()
    }
    const fit = () => {
      const { dist, ty } = view()
      const look = new THREE.Vector3(0.476, 0.5, 0.723).normalize()
      controls.target.set(0, ty, 0)
      camera.position.copy(controls.target).addScaledVector(look, dist)
      lens(dist)
      controls.update()
      wake()
    }
    const offset = new THREE.Vector3()

    // a change while paused: draw for a moment
    let awake = 0
    function wake() {
      awake = performance.now() + 700
    }
    const e: Engine = {
      world,
      events: [],
      cursor: 0,
      playing: true,
      speed: 1,
      nextAt: 0,
      catchUp: false,
      follow: true,
      seek: (n) => {
        world.reset()
        n = Math.max(0, Math.min(n, e.events.length))
        for (let i = 0; i < n; i++) world.apply(e.events[i], false)
        world.flush()
        e.cursor = n
        e.catchUp = false
        wake()
        e.nextAt = world.tl.time
        pendingNotes.length = 0
        setNotes([])
        setBanner(null)
      },
      replay: () => {
        const len = replayLength(e.events)
        e.speed = SPEEDS.find((s) => len / s <= REPLAY_TARGET_S) ?? SPEEDS[SPEEDS.length - 1]
        e.seek(0)
        e.playing = true
        fit()
      },
      fit,
    }
    eng.current = e
    // dev aid: drive it from the console (window.castleGame.seek(40) …)
    if (import.meta.env.DEV) (window as unknown as { castleGame?: Engine & { renderer: THREE.WebGLRenderer; camera: THREE.Camera } }).castleGame = Object.assign(e, { renderer, camera })

    const resize = () => {
      const w = host.clientWidth
      const h = host.clientHeight
      if (!w || !h) return
      renderer.setSize(w, h)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      wake()
    }
    const ro = new ResizeObserver(resize)
    ro.observe(host)
    resize()

    // ---- the loop ----
    let frame = 0
    let last = performance.now()
    let shown = true
    const io = new IntersectionObserver(([entry]) => (shown = entry.isIntersecting))
    io.observe(host)
    // Frame pacing: 60 a second while something happens, 30 while only the heroes
    // breathe, none while paused and still (a camera move wakes it for a moment).
    let lastDraw = 0
    // the person moving the camera (drag, zoom): draw at full rate, and a moment after for the damping
    let held = false
    const hold = () => (held = true)
    const release = () => {
      held = false
      wake()
    }
    controls.addEventListener('start', hold)
    controls.addEventListener('end', release)
    let slow = 0
    let quick = 0
    const tick = () => {
      frame = requestAnimationFrame(tick)
      const now = performance.now()
      if (!shown || document.hidden) {
        last = now
        return
      }
      // (paused, the tweens in flight are frozen: nothing to draw)
      const acting = (e.playing && (world.busy || e.cursor < e.events.length)) || held || now < awake
      const every = acting ? 1000 / 60 : e.playing ? 1000 / 30 : Infinity
      if (now - lastDraw < every - 3) return
      const gap = now - lastDraw
      lastDraw = now
      const real = Math.min(0.1, (now - last) / 1000)
      last = now
      step(real)
      // adapt the resolution: frames that come late for a second lower it, a calm stretch raises it again
      if (acting && gap < 200) {
        if (gap > 24) slow++
        else if (gap < 18) quick++
        if (slow > 45 && dpr > 1) {
          dpr = Math.max(1, dpr - 0.25)
          renderer.setPixelRatio(dpr)
          resize()
          slow = quick = 0
        } else if (quick > 600 && dpr < dprMax) {
          dpr = Math.min(dprMax, dpr + 0.25)
          renderer.setPixelRatio(dpr)
          resize()
          slow = quick = 0
        }
        if (slow + quick > 900) slow = quick = 0
      }
    }
    let shadowTurn = 0
    /** One frame: `real` seconds of wall time. */
    const step = (real: number) => {
      const dt = e.playing ? real * e.speed : 0
      // the director: start the next event once the last one's lead is over
      if (e.playing && e.speed >= TIMELAPSE && !reduce) {
        // a time-lapse: this frame's share of game time, applied at once
        let budget = world.tl.time + dt - e.nextAt
        while (e.cursor < e.events.length && budget > 0) {
          const ev = e.events[e.cursor++]
          const was = world.tierIndex
          world.apply(ev, false)
          if (ev.kind === 'publish') world.cheer(ev)
          if (world.tierIndex !== was) world.onNote?.({ kind: 'renew', text: renewalLine(was, world.tierIndex), color: '#f5c542' })
          budget -= LEAD[ev.kind]
        }
        e.nextAt = world.tl.time + dt + Math.max(0, -budget)
        world.flush(true)
      } else if (e.playing) {
        for (let k = 0; k < 8 && e.cursor < e.events.length && world.tl.time >= e.nextAt; k++) {
          // far behind live (a burst arrived): catch up instantly, keep the last few animated
          if (e.catchUp && e.events.length - e.cursor > 60) {
            while (e.events.length - e.cursor > 12) world.apply(e.events[e.cursor++], false)
            world.flush()
            e.nextAt = world.tl.time
          }
          const lead = world.apply(e.events[e.cursor++], !reduce)
          e.nextAt = world.tl.time + (reduce ? 0 : lead)
        }
        if (e.cursor >= e.events.length) e.catchUp = false
      }
      world.update(dt)
      if (e.follow) {
        // the whole island as it grows; closer in on a big moment
        const k = Math.min(1, real * 1.6)
        const v = view()
        if (world.zoom < 1) controls.target.lerp(world.focus, k)
        else controls.target.lerp(offset.set(0, v.ty, 0), k)
        offset.subVectors(camera.position, controls.target)
        // turn round to the side being built on, a little off-centre so it reads in 3/4 view
        if (world.look !== null) {
          const now = Math.atan2(offset.x, offset.z)
          const turn = Math.atan2(Math.sin(world.look + 0.45 - now), Math.cos(world.look + 0.45 - now))
          offset.applyAxisAngle(THREE.Object3D.DEFAULT_UP, turn * Math.min(1, real * 2.2))
        }
        const want = Math.max(controls.minDistance, v.dist * world.zoom)
        offset.setLength(offset.length() + (want - offset.length()) * k * 0.8)
        camera.position.copy(controls.target).add(offset)
        if (Math.abs(camera.far - want * 10) > want) lens(want)
        // a slow orbit while the history plays out; still once it has caught up
        controls.autoRotate = e.playing && !reduce && world.look === null && (e.cursor < e.events.length || world.busy)
      } else controls.autoRotate = false
      controls.update()
      fitShadow()
      renderer.shadowMap.needsUpdate = shadowTurn++ % 2 === 0 || !world.busy
      renderer.render(scene, camera)
    }
    frame = requestAnimationFrame(tick)
    // dev aid: step frames by hand (a hidden window gets no animation frames) and look at one
    if (import.meta.env.DEV)
      Object.assign(e, {
        advance: (seconds: number) => {
          for (let t = 0; t < seconds; t += 1 / 30) step(1 / 30)
        },
        snap: () => {
          step(0)
          return canvas.toDataURL('image/jpeg', 0.85)
        },
      })

    // ---- the HUD, about eight times a second ----
    const hudTimer = setInterval(() => {
      const next: Hud = { cursor: e.cursor, total: e.events.length, playing: e.playing, speed: e.speed, tier: world.tierIndex, layers: world.layerCount, open: world.openPlots }
      setHud((h) => ((Object.keys(next) as (keyof Hud)[]).every((k) => h[k] === next[k]) ? h : next))
      if (pendingNotes.length) {
        const fresh = pendingNotes.splice(0).slice(-4).map((n) => ({ ...n, id: ++noteId }))
        setNotes((old) => [...old, ...fresh].slice(-4))
      }
    }, 125)

    // ---- pointing and clicking ----
    const ray = new THREE.Raycaster()
    const pointer = new THREE.Vector2()
    let down: { x: number; y: number } | null = null
    const hit = (ev: PointerEvent) => {
      const r = canvas.getBoundingClientRect()
      pointer.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1)
      ray.setFromCamera(pointer, camera)
      const found = world.pick(ray)
      return found ? { ...found, x: ev.clientX - r.left, y: ev.clientY - r.top } : null
    }
    const onDown = (ev: PointerEvent) => (down = { x: ev.clientX, y: ev.clientY })
    const onMove = (ev: PointerEvent) => {
      if (down) return
      const h = hit(ev)
      canvas.style.cursor = h?.branch ? 'pointer' : 'grab'
      setCard(h)
    }
    const onUp = (ev: PointerEvent) => {
      const was = down
      down = null
      if (!was || Math.hypot(ev.clientX - was.x, ev.clientY - was.y) > 4) return
      const h = hit(ev)
      if (h?.branch && h.branch !== 'main') open.current?.(h.branch)
    }
    const onLeave = () => setCard(null)
    // a drag takes the camera: stop following the action
    const onStart = () => {
      e.follow = false
      setFollow(false)
    }
    canvas.style.cursor = 'grab'
    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerup', onUp)
    canvas.addEventListener('pointerleave', onLeave)
    controls.addEventListener('start', onStart)

    return () => {
      cancelAnimationFrame(frame)
      clearInterval(hudTimer)
      ro.disconnect()
      io.disconnect()
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointerleave', onLeave)
      controls.removeEventListener('start', onStart)
      controls.removeEventListener('start', hold)
      controls.removeEventListener('end', release)
      controls.dispose()
      world.dispose()
      renderer.dispose()
      canvas.remove()
      eng.current = null
    }
  }, [dark])

  // ---- new history: animate what was added; anything else, rebuild to the present ----
  const autoplayed = useRef(false)
  useEffect(() => {
    const e = eng.current
    if (!e) return
    const how = compareEvents(e.events, events)
    const atEnd = e.cursor >= e.events.length
    const fresh = e.events.length === 0
    e.events = events
    if (fresh) {
      if (autoplay && !autoplayed.current && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
        autoplayed.current = true
        e.replay()
      } else {
        e.seek(events.length)
        e.world.update(0)
        e.fit()
      }
    } else if (how === 'changed') {
      e.seek(atEnd ? events.length : Math.min(e.cursor, events.length))
    }
    else if (how === 'append' && atEnd) e.catchUp = true
    // 'append' while replaying: the director reaches them in turn
  }, [events, autoplay, dark])

  // banners leave after a while
  useEffect(() => {
    if (!banner) return
    const id = setTimeout(() => setBanner((b) => (b?.id === banner.id ? null : b)), banner.kind === 'renew' ? 3600 : 2800)
    return () => clearTimeout(id)
  }, [banner])

  if (failed)
    return <p className="m-auto max-w-sm p-8 text-center text-sm text-muted-foreground">This computer could not start WebGL, so the castle cannot be drawn. The 2D view shows the same history.</p>

  const tier = tierAt(hud.tier)
  const next = tierAt(hud.tier + 1)
  const toNext = next ? next.minLayers - hud.layers : 0
  const counts = tally(hud.cursor)
  const live = hud.cursor >= hud.total
  const sky = dark ? 'linear-gradient(180deg, #1c1f4f 0%, #4a2d72 55%, #8a4a7c 100%)' : 'linear-gradient(180deg, #8fd0ff 0%, #c9e8ff 38%, #ffe1ef 78%, #fff1dc 100%)'
  const setPlaying = (on: boolean) => {
    if (eng.current) eng.current.playing = on
    setHud((h) => ({ ...h, playing: on }))
  }

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden" style={{ background: sky }}>
      <div ref={box} className="absolute inset-0" role="img" aria-label={`The history as a castle being built: ${tier?.name}, ${hud.layers} published Layers, ${hud.open} Branches being worked on.`} />

      {making && (
        <div className="absolute inset-0 z-20 grid place-items-center bg-background/40 backdrop-blur-[2px]">
          <p className="rounded-full border bg-card/90 px-4 py-2 text-sm shadow-sm">Making up a {SOURCES.find((x) => x.id === source)?.label.toLowerCase()}…</p>
        </div>
      )}

      {/* where the castle stands */}
      <div className="pointer-events-none absolute top-3 left-3 flex max-w-[22rem] flex-col gap-2">
        <div className="pointer-events-auto rounded-2xl border bg-card/85 px-3 py-2 shadow-sm backdrop-blur-sm">
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-semibold">{tier?.name}</span>
            <span className="text-xs text-muted-foreground">
              {hud.layers} Layer{hud.layers === 1 ? '' : 's'} on main
            </span>
          </div>
          {next ? (
            <>
              {next.minLayers - tier.minLayers <= 24 ? (
                <div className="mt-1.5 flex gap-0.5" aria-hidden>
                  {Array.from({ length: next.minLayers - tier.minLayers }, (_, i) => (
                    <i key={i} className={`h-1.5 flex-1 rounded-full ${tier.minLayers + i < hud.layers ? 'bg-amber-400' : 'bg-muted'}`} />
                  ))}
                </div>
              ) : (
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                  <i className="block h-full rounded-full bg-amber-400 transition-[width]" style={{ width: `${((hud.layers - tier.minLayers) / (next.minLayers - tier.minLayers)) * 100}%` }} />
                </div>
              )}
              <p className="mt-1 text-[11px] text-muted-foreground">
                {toNext} more Layer{toNext === 1 ? '' : 's'} and it renews into {tier.level < 6 ? `a ${next.name.toLowerCase()}` : `the ${next.name}`}
              </p>
            </>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-1.5 text-[11px]">
          {[
            ['Branches open', hud.open],
            ['Forks', counts.forks],
            ['Commits', counts.commits],
            ['Merges', counts.merges],
          ].map(([label, n]) => (
            <span key={label} className="rounded-full border bg-card/80 px-2 py-0.5 tabular-nums shadow-sm backdrop-blur-sm">
              <b className="font-semibold">{n}</b> <span className="text-muted-foreground">{label}</span>
            </span>
          ))}
        </div>
      </div>

      {/* what just happened */}
      <ul className="pointer-events-none absolute top-3 right-3 flex w-72 flex-col items-end gap-1" aria-live="polite">
        {notes.map((n) => (
          <li key={n.id} className="game-note flex max-w-full items-center gap-1.5 rounded-full border bg-card/85 px-2.5 py-1 text-[11px] shadow-sm backdrop-blur-sm">
            <i className="size-2 shrink-0 rounded-full ring-1 ring-black/10" style={{ background: n.color }} />
            <span className="truncate">{n.text}</span>
          </li>
        ))}
      </ul>

      {/* the big moments */}
      {banner && (
        <div key={banner.id} className="game-banner pointer-events-none absolute top-[22%] left-1/2 z-10 text-center">
          <div className="rounded-2xl border-2 bg-card/90 px-5 py-2.5 shadow-lg backdrop-blur-sm" style={{ borderColor: banner.color }}>
            <p className="text-[10px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">{banner.kind === 'renew' ? 'Renewal' : 'Published'}</p>
            <p className="mt-0.5 max-w-md text-sm font-medium">{banner.text}</p>
          </div>
        </div>
      )}

      {/* the card for what is pointed at */}
      {card && (
        <div className="pointer-events-none absolute z-10 w-64 overflow-hidden rounded-xl border bg-card/95 text-xs shadow-lg backdrop-blur-sm" style={{ left: Math.min(card.x + 14, (box.current?.clientWidth ?? 9999) - 270), top: Math.max(8, card.y - 70) }}>
          <div className="h-1" style={{ background: card.color }} />
          <div className="space-y-0.5 px-3 py-2">
            <p className="font-medium">{card.title}</p>
            {card.lines.filter(Boolean).map((l, i) => (
              <p key={i} className="text-muted-foreground">
                {l}
              </p>
            ))}
            {card.branch && card.branch !== 'main' && onOpen && <p className="pt-1 text-[10px] text-primary">Click to open in History</p>}
          </div>
        </div>
      )}

      {/* how the castle grows */}
      {rules && (
        <div className="absolute right-3 bottom-16 z-10 w-[23rem] rounded-2xl border bg-card/95 p-3 text-xs shadow-lg backdrop-blur-sm">
          <p className="mb-1.5 text-sm font-semibold">How the castle grows</p>
          <ul className="space-y-1">
            {EVOLUTION_RULES.map((r, i) => (
              <li key={i} className={`flex gap-2 ${i === hud.tier ? 'font-medium text-foreground' : 'text-muted-foreground'}`}>
                <span className="w-3 shrink-0 text-amber-500">{i === hud.tier ? '▸' : ''}</span>
                <span>{r}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 border-t pt-2 text-muted-foreground">
            A fork opens a plot with a road from its parent. A Commit drops a block on the plot. A merge carries a crate to the other plot. A publish takes the plot&apos;s blocks to the castle and builds that Layer&apos;s piece in its Branch&apos;s colour. When a building is full, the builders renew it into the next, bigger one; stones around its foot keep every older Layer&apos;s colour.
          </p>
        </div>
      )}

      {/* replay controls */}
      <div className="absolute inset-x-3 bottom-3 flex items-center gap-2 rounded-2xl border bg-card/85 px-2 py-1.5 shadow-sm backdrop-blur-sm">
        <Button variant="ghost" size="icon" className="size-8" aria-label="Replay the castle from Init" title="Replay from Init" onClick={() => eng.current?.replay()}>
          <RotateCcw />
        </Button>
        <Button variant="ghost" size="icon" className="size-8" aria-label={hud.playing ? 'Pause' : 'Play'} title={hud.playing ? 'Pause' : 'Play'} onClick={() => setPlaying(!hud.playing)}>
          {hud.playing ? <Pause /> : <Play />}
        </Button>
        <div className="relative flex h-8 min-w-0 flex-1 items-center">
          <div className="pointer-events-none absolute inset-x-1.5 top-1/2 h-3 -translate-y-1/2" aria-hidden>
            {hud.total > 0 &&
              marks.map((m) => (
                <i
                  key={m.at}
                  className={`absolute top-0 -translate-x-1/2 rounded-full ${m.renew ? 'h-3 w-1 bg-rose-400' : 'h-2 w-0.5 translate-y-0.5 bg-amber-400'}`}
                  style={{ left: `${(m.at / Math.max(1, hud.total)) * 100}%` }}
                />
              ))}
          </div>
          <input
            type="range"
            min={0}
            max={Math.max(1, hud.total)}
            value={hud.cursor}
            aria-label="Position in the history"
            className="game-scrub relative w-full"
            onChange={(ev) => {
              eng.current?.seek(Number(ev.target.value))
              setHud((h) => ({ ...h, cursor: Number(ev.target.value) }))
            }}
          />
        </div>
        <span className="w-20 shrink-0 text-right text-[11px] text-muted-foreground tabular-nums">
          {live ? (
            <span className="inline-flex items-center gap-1 text-foreground">
              <i className="size-1.5 animate-pulse rounded-full bg-rose-500" /> Live
            </span>
          ) : (
            `${hud.cursor} / ${hud.total}`
          )}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-11 shrink-0 px-0 text-xs tabular-nums"
          aria-label={`Speed ${hud.speed}×, click for faster`}
          title="Speed"
          onClick={() => {
            const s = SPEEDS[(SPEEDS.indexOf(hud.speed) + 1) % SPEEDS.length]
            if (eng.current) eng.current.speed = s
            setHud((h) => ({ ...h, speed: s }))
          }}
        >
          {hud.speed >= 1000 ? `${hud.speed / 1000}k` : hud.speed}×
        </Button>
        <span className="mx-0.5 h-5 w-px shrink-0 bg-border" />
        <label className="flex shrink-0 items-center gap-1 text-xs" title={SOURCES.find((s) => s.id === source)?.hint}>
          <FlaskConical className="size-3.5 text-muted-foreground" />
          <select className="h-8 rounded-md bg-transparent pr-1 text-xs outline-none" aria-label="History to show" value={source} onChange={(ev) => setSource(ev.target.value as Source)}>
            {SOURCES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <Button
          variant="ghost"
          size="icon"
          className={`size-8 shrink-0 ${follow ? 'bg-primary/15 text-primary' : ''}`}
          aria-pressed={follow}
          aria-label={follow ? 'Stop following the action' : 'Follow the action'}
          title={follow ? 'Following the action' : 'Follow the action'}
          onClick={() => {
            const on = !follow
            setFollow(on)
            if (eng.current) eng.current.follow = on
          }}
        >
          <Video />
        </Button>
        <Button variant="ghost" size="icon" className={`size-8 shrink-0 ${rules ? 'bg-primary/15 text-primary' : ''}`} aria-pressed={rules} aria-label="How the castle grows" title="How the castle grows" onClick={() => setRules(!rules)}>
          <BookOpen />
        </Button>
        <Button variant="ghost" size="icon" className="size-8 shrink-0" aria-label="Fit the island in view" title="Fit" onClick={() => eng.current?.fit()}>
          <Maximize2 />
        </Button>
      </div>
    </div>
  )
}
