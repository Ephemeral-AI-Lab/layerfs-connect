import { useI18n } from '@/i18n'
import type { LucideIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

export type Tone = 'neutral' | 'success' | 'info' | 'warning' | 'danger'

// Literal class names, so Tailwind sees them.
const TONE: Record<Tone, string> = {
  neutral: 'bg-muted/80 text-muted-foreground ring-foreground/10',
  success: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 ring-emerald-500/25',
  info: 'bg-primary/10 text-primary ring-primary/25',
  warning: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 ring-amber-500/25',
  danger: 'bg-destructive/10 text-destructive ring-destructive/25',
}

/** A dot's fill, and its text colour, which a live dot's ring and glow take (`pulse-ring`). */
export const DOT: Record<Tone, string> = {
  neutral: 'bg-idle text-idle',
  success: 'bg-emerald-500 text-emerald-500',
  info: 'bg-primary text-primary',
  warning: 'bg-amber-500 text-amber-500',
  danger: 'bg-destructive text-destructive',
}

/** A live chip's glow, in its tone: the same breathing glow (live-glow), tinted. */
const GLOW: Record<Tone, string> = {
  neutral: '',
  success: 'live-glow [--live-c:rgb(16_185_129)]',
  info: 'live-glow',
  warning: 'live-glow [--live-c:rgb(245_158_11)]',
  danger: 'live-glow [--live-c:var(--destructive)]',
}

interface ChipProps {
  tone: Tone
  icon?: LucideIcon
  /** A pulsing dot in place of an icon, for live connections. */
  live?: boolean
  /** A dashed ring: a state that is not known now (Storage's "Sync unknown", a last-known state). */
  dashed?: boolean
  /** The icon turns (a check or transfer in flight); it settles under reduced motion. */
  spin?: boolean
  className?: string
  children: React.ReactNode
}

/** A small status label: tinted, with a hairline ring and one icon. A live chip glows and its dot pulses. */
export function Chip({ tone, icon: Icon, live, dashed, spin, className, children }: ChipProps) {
  useI18n()
  return (
    <span
      className={cn(
        'inline-flex h-[22px] items-center gap-1.5 rounded-full px-2.5 text-[11px] font-semibold tracking-tight whitespace-nowrap ring-1 ring-inset shadow-2xs transition-shadow duration-(--dur-base)',
        TONE[tone],
        live && GLOW[tone],
        dashed && 'border border-dashed border-current/35 shadow-none ring-0',
        className,
      )}
    >
      {live && (
        <span aria-hidden="true" className={cn('pulse-ring mx-0.5 size-1.5 rounded-full', DOT[tone])} />
      )}
      {Icon && <Icon aria-hidden="true" className={cn('size-3', spin && 'motion-safe:animate-spin')} strokeWidth={2.5} />}
      {children}
    </span>
  )
}

/** A still state dot, with a soft halo of its own colour. */
export function Dot({ tone, label }: { tone: Tone; label: string }) {
  useI18n()
  return (
    <span
      role="img"
      aria-label={label}
      className={cn('size-2 shrink-0 rounded-full shadow-[0_0_0_3px_color-mix(in_oklab,currentColor_14%,transparent)]', DOT[tone])}
    />
  )
}
