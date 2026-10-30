import { useEffect, useState } from 'react'
import { useReducedMotion } from '@/components/motion/reduced-motion'
import { cn } from '@/lib/utils'

interface RunAuraProps {
  /** True when a run is live/executing */
  active?: boolean
  className?: string
}

/**
 * A luminous multi-color breathing background that activates when a run is executing.
 * Smoothly fades in and out with 1s duration, and respects prefers-reduced-motion.
 */
export function RunAura({ active = false, className }: RunAuraProps) {
  const reducedMotion = useReducedMotion()
  // Keep mounted during the 1s fade-out transition
  const [rendered, setRendered] = useState(active)

  useEffect(() => {
    if (active) {
      setRendered(true)
    } else {
      const timer = setTimeout(() => setRendered(false), 1050)
      return () => clearTimeout(timer)
    }
  }, [active])

  if (!rendered && !active) return null

  return (
    <div
      aria-hidden="true"
      data-active={active || undefined}
      className={cn(
        'pointer-events-none absolute inset-0 z-0 overflow-hidden transition-opacity duration-1000 ease-out',
        active ? 'opacity-100' : 'opacity-0',
        className,
      )}
    >
      {/* Orb 1: DeepMind Lavender-Iris Bloom */}
      <span
        className="aura-orb absolute -top-1/4 -left-1/4 size-[48rem] rounded-full blur-[115px]"
        style={{
          background: 'radial-gradient(circle, rgba(199, 210, 254, 0.4) 0%, rgba(224, 231, 255, 0.2) 40%, transparent 70%)',
          animation: reducedMotion ? 'none' : 'aura-pulse-1 4.5s ease-in-out infinite',
        }}
      />

      {/* Orb 2: Cyber Mint & Cyan Wave */}
      <span
        className="aura-orb absolute top-1/4 right-[-15%] size-[50rem] rounded-full blur-[110px]"
        style={{
          background: 'radial-gradient(circle, rgba(167, 243, 208, 0.35) 0%, rgba(204, 251, 241, 0.2) 45%, transparent 70%)',
          animation: reducedMotion ? 'none' : 'aura-pulse-2 6.5s ease-in-out infinite',
        }}
      />

      {/* Orb 3: Soft Rose Peach Aura */}
      <span
        className="aura-orb absolute -bottom-1/4 left-1/3 size-[44rem] rounded-full blur-[120px]"
        style={{
          background: 'radial-gradient(circle, rgba(254, 205, 211, 0.35) 0%, rgba(255, 228, 230, 0.2) 45%, transparent 70%)',
          animation: reducedMotion ? 'none' : 'aura-pulse-3 8s ease-in-out infinite',
        }}
      />

      {/* Orb 4: Honey Amber Sunlight */}
      <span
        className="aura-orb absolute top-1/3 left-1/4 size-[38rem] rounded-full blur-[125px]"
        style={{
          background: 'radial-gradient(circle, rgba(254, 240, 138, 0.32) 0%, rgba(254, 243, 199, 0.18) 40%, transparent 70%)',
          animation: reducedMotion ? 'none' : 'aura-pulse-4 5.5s ease-in-out infinite',
        }}
      />

      {/* Orb 5: Delicate Mint Jade Accent */}
      <span
        className="aura-orb absolute bottom-0 right-1/4 size-[36rem] rounded-full blur-[110px]"
        style={{
          background: 'radial-gradient(circle, rgba(167, 243, 208, 0.28) 0%, transparent 70%)',
          animation: reducedMotion ? 'none' : 'aura-pulse-1 7s ease-in-out infinite reverse',
        }}
      />
    </div>
  )
}
