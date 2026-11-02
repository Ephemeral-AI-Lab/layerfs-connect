// The one plain line that stands in for a feature LayerFS 2.0 cannot support
// yet (owner decision C2, docs/layerfs-2.0-integration.md §9): the feature is
// hidden, not faked, and the line says what comes later.
import { Clock } from 'lucide-react'

import { t, useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

export function GapLine({ what, className }: { what: string; className?: string }) {
  useI18n()
  return (
    <p className={cn('flex items-center gap-1.5 text-xs text-muted-foreground', className)}>
      <Clock aria-hidden="true" className="size-3.5 shrink-0 opacity-70" />
      <span>{t('{what} comes with a later LayerFS.', { what: t(what) })}</span>
    </p>
  )
}
