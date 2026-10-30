import { useEffect, useRef } from 'react'
import { useReducedMotion } from '@/components/motion/reduced-motion'
import { cn } from '@/lib/utils'

interface CursorAuraProps {
  className?: string
}

/** Shortest arc circular angular lerp (degrees) */
function lerpAngle(current: number, target: number, factor: number): number {
  let diff = (target - current) % 360
  if (diff < -180) diff += 360
  if (diff > 180) diff -= 360
  return (current + diff * factor + 360) % 360
}

/**
 * Global monochromatic cursor-following aura.
 * Renders a single-hue chromatic light that tracks the cursor and diffuses through
 * frosted glass surfaces (backdrop-filter: blur).
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

    // Cache container bounds and update on resize/scroll
    let containerRect: DOMRect = container.getBoundingClientRect()
    const updateRect = () => {
      containerRect = container.getBoundingClientRect()
    }

    const onPointerMove = (e: PointerEvent) => {
      const x = e.clientX - containerRect.left
      const y = e.clientY - containerRect.top

      const dx = e.clientX - lastX
      const dy = e.clientY - lastY
      const moveDist = Math.sqrt(dx * dx + dy * dy)
      lastX = e.clientX
      lastY = e.clientY

      targetX = x
      targetY = y

      // Initial entrance: snap positions to avoid jarring fly-in from corner
      if (!isInside) {
        currentX = x
        currentY = y
      }

      isInside = true
      targetOpacity = 0.22

      // Hue calculation:
      // 1. Position on screen maps gracefully across soft pastel spectrum (180° to 340°)
      // 2. Accumulated travel distance smoothly rotates the color wheel
      const posHue =
        (e.clientX / Math.max(1, window.innerWidth)) * 160 +
        (e.clientY / Math.max(1, window.innerHeight)) * 60 +
        185
      accumulatedDistance = (accumulatedDistance + moveDist * 0.08) % 360
      targetHue = (posHue + accumulatedDistance) % 360

      // Idle fade-out: smoothly fade when cursor rests
      if (idleTimer) clearTimeout(idleTimer)
      idleTimer = setTimeout(() => {
        targetOpacity = 0
      }, 1600)
    }

    const onPointerLeave = () => {
      isInside = false
      targetOpacity = 0
      if (idleTimer) clearTimeout(idleTimer)
    }

    const onPointerEnter = () => {
      isInside = true
      targetOpacity = 0.22
    }

    const animate = () => {
      // Smooth opacity fade
      currentOpacity += (targetOpacity - currentOpacity) * 0.08
      if (currentOpacity < 0.005) {
        currentOpacity = 0
      }

      if (currentOpacity > 0) {
        // Smooth cursor tracking
        currentX += (targetX - currentX) * 0.12
        currentY += (targetY - currentY) * 0.12

        // Smooth shortest-arc hue shift
        currentHue = lerpAngle(currentHue, targetHue, 0.07)
        const h = currentHue.toFixed(1)

        // Center monochromatic orbs at cursor position
        orbWide.style.transform = `translate3d(${currentX - 280}px, ${currentY - 280}px, 0)`
        orbCore.style.transform = `translate3d(${currentX - 140}px, ${currentY - 140}px, 0)`

        // Single monochromatic color gradient (only ONE hue with varying opacity)
        orbWide.style.background = `radial-gradient(circle, hsla(${h}, 80%, 65%, 0.30) 0%, hsla(${h}, 80%, 65%, 0.12) 45%, hsla(${h}, 80%, 65%, 0.02) 70%, transparent 85%)`
        orbCore.style.background = `radial-gradient(circle, hsla(${h}, 85%, 72%, 0.38) 0%, hsla(${h}, 85%, 72%, 0.15) 45%, transparent 75%)`

        container.style.opacity = currentOpacity.toFixed(3)

        // Broadcast single hue to all spotlight cards
        document.documentElement.style.setProperty('--cursor-hue', `${h}`)
      } else {
        container.style.opacity = '0'
      }

      rafId = requestAnimationFrame(animate)
    }

    window.addEventListener('pointermove', onPointerMove, { passive: true })
    window.addEventListener('resize', updateRect, { passive: true })
    window.addEventListener('scroll', updateRect, { passive: true })
    document.addEventListener('pointerleave', onPointerLeave)
    document.addEventListener('pointerenter', onPointerEnter)

    rafId = requestAnimationFrame(animate)

    return () => {
      if (rafId) cancelAnimationFrame(rafId)
      if (idleTimer) clearTimeout(idleTimer)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('resize', updateRect)
      window.removeEventListener('scroll', updateRect)
      document.removeEventListener('pointerleave', onPointerLeave)
      document.removeEventListener('pointerenter', onPointerEnter)
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
        className="cursor-orb absolute top-0 left-0 size-[560px] rounded-full blur-[105px] will-change-transform"
      />

      {/* Monochromatic Specular Core: Exact same single-color hue */}
      <span
        ref={orbCoreRef}
        className="cursor-orb absolute top-0 left-0 size-[280px] rounded-full blur-[65px] will-change-transform"
      />
    </div>
  )
}
