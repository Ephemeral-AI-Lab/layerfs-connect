import type { LucideIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

export type Tone = 'neutral' | 'success' | 'info' | 'warning' | 'danger'

// Literal class names, so Tailwind sees them.
const TONE: Record<Tone, string> = {
  neutral: 'bg-muted text-muted-foreground ring-foreground/10',
  success: 'bg-success/10 text-success ring-success/25',
  info: 'bg-primary/10 text-accent-foreground ring-primary/25 dark:text-primary',
  warning: 'bg-warning/10 text-warning ring-warning/25',
  danger: 'bg-destructive/10 text-destructive ring-destructive/25',
}

const DOT: Record<Tone, string> = {
  neutral: 'bg-idle',
  success: 'bg-success',
  info: 'bg-primary',
  warning: 'bg-warning',
  danger: 'bg-destructive',
}

interface ChipProps {
  tone: Tone
  icon?: LucideIcon
  /** A pulsing dot in place of an icon, for live connections. */
  live?: boolean
  className?: string
  children: React.ReactNode
}

/** A small status label: tinted, with a hairline ring and one icon. */
export function Chip({ tone, icon: Icon, live, className, children }: ChipProps) {
  return (
    <span
      className={cn(
        'inline-flex h-[22px] items-center gap-1 rounded-md px-1.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset',
        TONE[tone],
        className,
      )}
    >
      {live && (
        <span aria-hidden="true" className="relative mx-0.5 flex size-1.5">
          <span className={cn('absolute inset-0 animate-ping rounded-full opacity-60', DOT[tone])} />
          <span className={cn('relative size-1.5 rounded-full', DOT[tone])} />
        </span>
      )}
      {Icon && <Icon aria-hidden="true" className="size-3" strokeWidth={2.5} />}
      {children}
    </span>
  )
}

export function Dot({ tone, label }: { tone: Tone; label: string }) {
  return <span role="img" aria-label={label} className={cn('size-2 shrink-0 rounded-full', DOT[tone])} />
}
