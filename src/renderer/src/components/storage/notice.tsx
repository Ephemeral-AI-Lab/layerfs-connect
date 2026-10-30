import { useI18n } from '@/i18n'
import type { LucideIcon } from 'lucide-react'

import { spotlight } from '@/components/motion'
import { cn } from '@/lib/utils'

type NoticeTone = 'info' | 'warning' | 'danger'

const TONE: Record<NoticeTone, { box: string; icon: string }> = {
  info: {
    box: 'border-primary/20 bg-linear-to-r from-primary/[0.08] to-primary/[0.02]',
    icon: 'glass-strong border border-primary/30 text-primary shadow-xs',
  },
  warning: {
    box: 'border-amber-500/25 bg-linear-to-r from-amber-500/[0.08] to-amber-500/[0.02]',
    icon: 'glass-strong border border-amber-500/35 text-amber-600 dark:text-amber-400 shadow-xs',
  },
  danger: {
    box: 'border-destructive/25 bg-linear-to-r from-destructive/[0.08] to-destructive/[0.02]',
    icon: 'glass-strong border border-destructive/35 text-destructive shadow-xs',
  },
}

interface NoticeProps {
  tone: NoticeTone
  icon: LucideIcon
  title: string
  children: React.ReactNode
  /** Buttons on the right. */
  actions?: React.ReactNode
}

/** A banner for a state that needs the reader's attention: a tinted liquid glass layer with optical highlights. */
export function Notice({ tone, icon: Icon, title, children, actions }: NoticeProps) {
  useI18n()
  return (
    <div
      role="status"
      onPointerMove={spotlight}
      className={cn(
        'glass-liquid card-hover spotlight reveal flex items-center justify-between gap-3.5 rounded-2xl px-4.5 py-3 shadow-xs',
        TONE[tone].box,
      )}
    >
      <div className="flex items-center gap-3.5 min-w-0">
        <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-xl', TONE[tone].icon)}>
          <Icon aria-hidden="true" className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-foreground tracking-tight">{title}</p>
          <p className="mt-0.5 text-xs text-muted-foreground leading-normal">{children}</p>
        </div>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  )
}
