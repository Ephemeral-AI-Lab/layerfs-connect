// A place's health as a dot and words (storage-redesign §3.1): a bucket's
// last check, or a PostgreSQL connection's. Never colour alone.
import { LoaderCircle } from 'lucide-react'

import { Dot, type Tone } from '@/components/storage/chips'
import { ago, when } from '@/data/format'
import { t, useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import type { Health } from '@shared/host-api'

const WORDS: Record<Health['state'], { tone: Tone; label: string }> = {
  ok: { tone: 'success', label: 'reachable' },
  unreachable: { tone: 'danger', label: 'unreachable' },
  denied: { tone: 'danger', label: 'denied' },
  checking: { tone: 'info', label: 'checking…' },
  unknown: { tone: 'neutral', label: 'status unknown' },
}

export const healthWords = (h: Health | null | undefined) => WORDS[h?.state ?? 'unknown'] ?? WORDS.unknown

/** The dot and its words; the tooltip says when it was checked and why it failed. */
export function HealthDot({ health, className, quiet }: { health: Health | null | undefined; className?: string; quiet?: boolean }) {
  useI18n()
  const w = healthWords(health)
  const label = t(w.label)
  const title = [health?.message, health?.at ? t('Checked {ago} ({when})', { ago: ago(health.at), when: when(health.at) }) : t('Not checked yet')].filter(Boolean).join(' · ')
  return (
    <span title={title} className={cn('inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap', quiet ? 'text-faint' : 'text-muted-foreground', className)}>
      {health?.state === 'checking' ? <LoaderCircle aria-hidden="true" className="size-3 motion-safe:animate-spin text-primary" /> : <Dot tone={w.tone} label={label} />}
      <span aria-hidden={health?.state !== 'checking'}>{label}</span>
    </span>
  )
}
