import type { ReactNode } from 'react'

import { CountUp } from '@/components/motion/count-up'
import { revealStyle } from '@/components/motion/reveal'
import { cn } from '@/lib/utils'

interface Stat {
  label: string
  value: number | null
  /** One line under the number. */
  note?: ReactNode
  /** A live number: brand light, a pulsing dot and a lit top edge. */
  live?: boolean
}

/** The home's facts in one strip: numbers count up as they arrive and ease as they change. */
export function StatsStrip({ stats }: { stats: Stat[] }) {
  return (
    <dl aria-label="At a glance" className="home-stats surface reveal rounded-xl" style={revealStyle(1)}>
      {stats.map((s, i) => (
        <div key={s.label} className="home-stat reveal" data-live={s.live || undefined} style={revealStyle(i + 2)}>
          <dt className="flex items-center gap-1.5 text-[11px] font-medium tracking-[0.06em] text-faint uppercase">
            {s.live && <span aria-hidden="true" className="pulse-ring size-1.5 rounded-full bg-primary text-primary" />}
            {s.label}
          </dt>
          <dd className="mt-1">
            <CountUp
              value={s.value}
              className={cn('block text-[26px] leading-8 font-semibold tracking-[-0.03em]', s.live && 'text-brand')}
            />
            {s.note && <span className="mt-0.5 block truncate text-xs text-muted-foreground">{s.note}</span>}
          </dd>
        </div>
      ))}
    </dl>
  )
}
