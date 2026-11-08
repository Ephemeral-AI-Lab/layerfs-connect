import { useEffect, useState } from 'react'

/** Playback belongs to simulation entry points, not the shared resource view. */
export function useSandboxPlayback(duration: number, initialTime = 0, initialPlaying = false) {
  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const [time, setTime] = useState(initialTime)
  const [playing, setPlaying] = useState(initialPlaying && !reduced())
  useEffect(() => {
    if (!playing) return
    let last = performance.now()
    const timer = setInterval(() => {
      const now = performance.now(), delta = (now - last) / 1000
      last = now; setTime(t => Math.min(duration, t + delta))
    }, 100)
    return () => clearInterval(timer)
  }, [playing, duration])
  useEffect(() => { if (time >= duration) setPlaying(false) }, [time, duration])
  useEffect(() => {
    const pause = () => { if (document.hidden) setPlaying(false) }
    document.addEventListener('visibilitychange', pause)
    return () => document.removeEventListener('visibilitychange', pause)
  }, [])
  return { time, playing, duration,
    toggle: () => { if (time >= duration) setTime(0); setPlaying(p => !p) },
    seek: (next: number) => { setTime(Math.max(0,Math.min(duration,next))); setPlaying(false) },
    replay: () => { setTime(0); setPlaying(!reduced()) },
  }
}
