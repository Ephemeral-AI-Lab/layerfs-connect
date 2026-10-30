// A place's health as a dot and words (storage-redesign §3.1): a copy
// location's last check, or a PostgreSQL connection's. Never colour alone.
import { LoaderCircle } from 'lucide-react'

import { ago, when } from '@/data/format'
import { Dot, type Tone } from '@/components/storage/chips'
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
  const w = healthWords(health)
  const title = [health?.message, health?.at ? `Checked ${ago(health.at)} (${when(health.at)})` : 'Not checked yet'].filter(Boolean).join(' · ')
  return (
    <span title={title} className={cn('inline-flex items-center gap-1.5 text-xs whitespace-nowrap', quiet ? 'text-faint' : 'text-muted-foreground', className)}>
      {health?.state === 'checking' ? <LoaderCircle aria-hidden="true" className="size-3 animate-spin text-primary" /> : <Dot tone={w.tone} label={w.label} />}
      <span aria-hidden={health?.state !== 'checking'}>{w.label}</span>
    </span>
  )
}
