// The animation timeline: tweens on the game's own clock. The clock runs at
// the playback speed, so 4× replays every tween four times as fast, and a
// seek simply drops what is in flight (the world is rebuilt instantly).

export type Ease = (t: number) => number

const c1 = 1.70158
const c3 = c1 + 1
export const ease = {
  linear: (t: number) => t,
  in: (t: number) => t * t * t,
  out: (t: number) => 1 - Math.pow(1 - t, 3),
  inOut: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  /** Overshoots a little, then settles: things popping into place. */
  outBack: (t: number) => 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2),
  inBack: (t: number) => c3 * t * t * t - c1 * t * t,
  /** A dropped block landing. */
  outBounce: (t: number) => {
    const n = 7.5625
    const d = 2.75
    if (t < 1 / d) return n * t * t
    if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75
    if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375
    return n * (t -= 2.625 / d) * t + 0.984375
  },
  outElastic: (t: number) => (t === 0 || t === 1 ? t : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1),
} satisfies Record<string, Ease>

/** 0 before `a`, 1 after `b`, linear between: a sub-range of a tween's progress. */
export const span = (p: number, a: number, b: number) => (p <= a ? 0 : p >= b ? 1 : (p - a) / (b - a))
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
/** Up and back down over 0..1: a hop. */
export const hop = (t: number) => 4 * t * (1 - t)

interface Track {
  start: number
  dur: number
  tick?: (p: number) => void
  done?: () => void
  started: boolean
}

export class Timeline {
  /** Seconds on the game clock. */
  time = 0
  private tracks: Track[] = []

  /** A tween starting `delay` seconds from now, `dur` long; `tick` gets 0..1 (ends on exactly 1). */
  tween(delay: number, dur: number, tick: (p: number) => void, done?: () => void) {
    this.tracks.push({ start: this.time + Math.max(0, delay), dur: Math.max(1e-4, dur), tick, done, started: false })
  }

  /** Something to do `delay` seconds from now. */
  call(delay: number, fn: () => void) {
    this.tracks.push({ start: this.time + Math.max(0, delay), dur: 0, done: fn, started: false })
  }

  update(dt: number) {
    this.time += dt
    const now = this.time
    let finished = false
    // tracks added while ticking run from the next update
    const list = this.tracks.slice()
    for (const t of list) {
      if (now < t.start) continue
      t.started = true
      const p = t.dur === 0 ? 1 : Math.min(1, (now - t.start) / t.dur)
      t.tick?.(p)
      if (p >= 1) {
        t.done?.()
        t.dur = -1
        finished = true
      }
    }
    if (finished) this.tracks = this.tracks.filter((t) => t.dur !== -1)
  }

  /** Drops everything in flight (a seek or a reset follows). */
  clear() {
    this.tracks = []
  }

  get busy() {
    return this.tracks.length > 0
  }
}
