import type { LucideIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

type NoticeTone = 'info' | 'warning' | 'danger'

const TONE: Record<NoticeTone, { box: string; icon: string }> = {
  info: { box: 'border-primary/20 bg-primary/[0.05]', icon: 'bg-primary/10 text-primary ring-primary/20' },
  warning: { box: 'border-warning/25 bg-warning/[0.05]', icon: 'bg-warning/10 text-warning ring-warning/25' },
  danger: { box: 'border-destructive/25 bg-destructive/[0.05]', icon: 'bg-destructive/10 text-destructive ring-destructive/25' },
}

interface NoticeProps {
  tone: NoticeTone
  icon: LucideIcon
  title: string
  children: React.ReactNode
  /** Buttons on the right. */
  actions?: React.ReactNode
}

/** A banner for a state that needs the reader's attention: a tinted layer that rises in, its icon on a small tile. */
export function Notice({ tone, icon: Icon, title, children, actions }: NoticeProps) {
  return (
    <div role="status" className={cn('reveal flex items-start gap-3 rounded-xl border px-4 py-3 shadow-highlight', TONE[tone].box)}>
      <span className={cn('flex size-7 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset', TONE[tone].icon)}>
        <Icon aria-hidden="true" className="size-4" />
      </span>
      <div className="min-w-0 flex-1 pt-px">
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-0.5 text-[13px] text-muted-foreground">{children}</p>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2 self-center">{actions}</div>}
    </div>
  )
}
