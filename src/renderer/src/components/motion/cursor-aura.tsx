import { useEffect, useRef } from 'react'
import { useReducedMotion } from '@/components/motion/reduced-motion'
import { cn } from '@/lib/utils'

interface CursorAuraProps {
  className?: string
}

/** How often the hue may restyle the page. */
const HUE_MS = 120

/** Shortest arc circular angular lerp (degrees) */
function lerpAngle(current: number, target: number, factor: number): number {
  let diff = (target - current) % 360
  if (diff < -180) diff += 360
  if (diff > 180) diff -= 360
  return (current + diff * factor + 360) % 360
}

/**
 * Global monochromatic cursor-following aura.
 * Renders a soft, single-hue light behind the workspace's glass surfaces.
 * Cards, text, controls and dialogs are always painted above it.
 *
 * Requirements:
 * - Single monochromatic hue at any given instant (no multi-colored rainbow collisions).
 * - Smoothly shifts hue across the pastel/macaron spectrum as the cursor moves.
 * - Broadcasts the active `--cursor-hue` CSS variable to :root for synchronized card spotlights.
 *
 * Performance:
 * - requestAnimationFrame with spring/lerp interpolation.
 * - Zero React re-renders (direct DOM ref updates).
 * - Respects prefers-reduced-motion.
 */
export function CursorAura({ className }: CursorAuraProps) {
  const reducedMotion = useReducedMotion()
  const containerRef = useRef<HTMLDivElement>(null)
  const orbWideRef = useRef<HTMLSpanElement>(null)
  const orbCoreRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (reducedMotion) return

    const container = containerRef.current
    const orbWide = orbWideRef.current
    const orbCore = orbCoreRef.current
    if (!container || !orbWide || !orbCore) return

    let targetX = -1000
    let targetY = -1000
    let currentX = -1000
    let currentY = -1000

    let currentHue = 215 // Default signature calm azure
    let targetHue = 215
    let accumulatedDistance = 0
    let lastX = 0
    let lastY = 0

    let isInside = false
    let currentOpacity = 0
    let targetOpacity = 0
    let rafId: number | null = null
    let idleTimer: ReturnType<typeof setTimeout> | null = null

    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return
      const x = e.clientX
      const y = e.clientY

      const moveDist = isInside ? Math.hypot(x - lastX, y - lastY) : 0
      lastX = x
      lastY = y

      targetX = x
      targetY = y

      // Initial entrance: snap positions to avoid jarring fly-in from corner
      if (!isInside) {
        currentX = x
        currentY = y
      }

      isInside = true
      targetOpacity = 0.5

      // Hue calculation:
      // 1. Position on screen maps gracefully across soft pastel spectrum (180° to 340°)
      // 2. Accumulated travel distance smoothly rotates the color wheel
      const posHue =
        (e.clientX / Math.max(1, window.innerWidth)) * 160 +
        (e.clientY / Math.max(1, window.innerHeight)) * 60 +
        185
      accumulatedDistance = (accumulatedDistance + moveDist * 0.08) % 360
      targetHue = (posHue + accumulatedDistance) % 360

      // Rest softly at the cursor; leaving the window fades the light out.
      if (idleTimer) clearTimeout(idleTimer)
      idleTimer = setTimeout(() => {
        targetOpacity = 0.16
        wake()
      }, 1600)
      wake()
    }

    const onPointerLeave = () => {
      isInside = false
      targetOpacity = 0
      if (idleTimer) clearTimeout(idleTimer)
      wake()
    }

    // The loop runs only while something moves and stops when the glow has
    // settled; a pointer event starts it again. The hue is written (orbs and
    // the root's --cursor-hue, which restyles every element that reads it)
    // only when it moves a whole degree, at most every HUE_MS.
    let shownHue = -1
    let hueAt = 0
    let shownOpacity = ''
    const animate = (now: number) => {
      rafId = null
      currentOpacity += (targetOpacity - currentOpacity) * 0.08
      if (Math.abs(targetOpacity - currentOpacity) < 0.005) currentOpacity = targetOpacity

      if (currentOpacity > 0) {
        currentX += (targetX - currentX) * 0.2
        currentY += (targetY - currentY) * 0.2
        currentHue = lerpAngle(currentHue, targetHue, 0.07)

        orbWide.style.transform = `translate3d(${(currentX - 360).toFixed(1)}px, ${(currentY - 360).toFixed(1)}px, 0)`
        orbCore.style.transform = `translate3d(${(currentX - 160).toFixed(1)}px, ${(currentY - 160).toFixed(1)}px, 0)`

        const hue = Math.round(currentHue) % 360
        if (hue !== shownHue && now - hueAt >= HUE_MS) {
          shownHue = hue
          hueAt = now
          const isDark = document.documentElement.classList.contains('dark')
          const sat = isDark ? 42 : 58
          const light = isDark ? 58 : 80
          const op1 = isDark ? 0.08 : 0.18
          const op2 = isDark ? 0.025 : 0.06
          orbWide.style.background = `radial-gradient(circle, hsla(${hue}, ${sat}%, ${light}%, ${op1}), hsla(${hue}, ${sat}%, ${light}%, ${op2}) 42%, transparent 72%)`
          orbCore.style.background = `radial-gradient(circle, hsla(${hue}, ${sat}%, ${light + 6}%, ${op1 * 0.7}), hsla(${hue}, ${sat}%, ${light + 6}%, ${op2 * 0.5}) 40%, transparent 72%)`
          document.documentElement.style.setProperty('--cursor-hue', String(hue))
        }
      }
      const opacity = currentOpacity.toFixed(3)
      if (opacity !== shownOpacity) {
        shownOpacity = opacity
        container.style.opacity = opacity
      }

      const moving =
        currentOpacity !== targetOpacity ||
        (currentOpacity > 0 &&
          (Math.abs(targetX - currentX) > 0.5 ||
            Math.abs(targetY - currentY) > 0.5 ||
            Math.abs(((targetHue - currentHue + 540) % 360) - 180) > 0.5 ||
            Math.round(currentHue) % 360 !== shownHue))
      if (moving) rafId = requestAnimationFrame(animate)
    }
    const wake = () => {
      if (rafId === null) rafId = requestAnimationFrame(animate)
    }

    window.addEventListener('pointermove', onPointerMove, { passive: true })
    window.addEventListener('blur', onPointerLeave)
    document.addEventListener('pointerleave', onPointerLeave)

    wake()

    return () => {
      if (rafId) cancelAnimationFrame(rafId)
      if (idleTimer) clearTimeout(idleTimer)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('blur', onPointerLeave)
      document.removeEventListener('pointerleave', onPointerLeave)
    }
  }, [reducedMotion])

  if (reducedMotion) return null

  return (
    <div
      ref={containerRef}
      aria-hidden="true"
      style={{ opacity: 0 }}
      className={cn(
        'pointer-events-none fixed inset-0 z-0 overflow-hidden will-change-[opacity]',
        className,
      )}
    >
      {/* Monochromatic Outer Diffusion: Single-color fade */}
      <span
        ref={orbWideRef}
        className="cursor-orb absolute top-0 left-0 size-[720px] rounded-full will-change-transform"
      />

      {/* Monochromatic Specular Core: Exact same single-color hue */}
      <span
        ref={orbCoreRef}
        className="cursor-orb absolute top-0 left-0 size-[320px] rounded-full will-change-transform"
      />
    </div>
  )
}
