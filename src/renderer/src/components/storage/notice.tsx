import type { LucideIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

type NoticeTone = 'info' | 'warning' | 'danger'

const TONE: Record<NoticeTone, { box: string; icon: string }> = {
  info: { box: 'border-primary/20 bg-primary/5', icon: 'text-primary' },
  warning: { box: 'border-warning/25 bg-warning/5', icon: 'text-warning' },
  danger: { box: 'border-destructive/25 bg-destructive/5', icon: 'text-destructive' },
}

interface NoticeProps {
  tone: NoticeTone
  icon: LucideIcon
  title: string
  children: React.ReactNode
  /** Buttons on the right. */
  actions?: React.ReactNode
}

/** A banner for a state that needs the reader's attention. */
export function Notice({ tone, icon: Icon, title, children, actions }: NoticeProps) {
  return (
    <div role="status" className={cn('flex items-start gap-3 rounded-xl border px-4 py-3', TONE[tone].box)}>
      <Icon aria-hidden="true" className={cn('mt-0.5 size-4 shrink-0', TONE[tone].icon)} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-0.5 text-[13px] text-muted-foreground">{children}</p>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2 self-center">{actions}</div>}
    </div>
  )
}
