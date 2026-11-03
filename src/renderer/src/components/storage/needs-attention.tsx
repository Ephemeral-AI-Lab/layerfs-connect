// Storage's "Needs attention" (#537 §5, §8.7): what `layerfs doctor` finds in
// the home. Doctor is report-only: it reads records, leases, intents and
// workers, starts no machine and changes nothing. Each finding names its
// entity and the call that fixes it, in LayerFS's words; Connect runs none of
// them for you. Read when the page loads or is refreshed, never on a timer.
import { ChevronDown, CircleCheck, LoaderCircle } from 'lucide-react'
import { useState } from 'react'

import { Refusal } from '@/components/refusal'
import { Chip } from '@/components/storage/chips'
import { Card } from '@/components/storage/overview/row-parts'
import { Button } from '@/components/ui/button'
import { ago } from '@/data/format'
import { host } from '@/host/client'
import { useHostQuery } from '@/host/use-host'
import { t, useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

export function NeedsAttention({ tick }: { tick: number }) {
  useI18n()
  const read = useHostQuery(() => host.doctor(), [tick])
  const [open, setOpen] = useState(false)
  const report = read.data
  const findings = report?.findings ?? []
  const errors = findings.filter((f) => f.severity === 'error').length
  return (
    <section className="flex flex-col gap-2.5 pt-2" aria-labelledby="doctor-title">
      <div className="flex items-center justify-between gap-3 px-1">
        <h2 id="doctor-title" className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
          {t('Needs attention')} <span className="font-mono font-normal normal-case">(layerfs doctor)</span>
        </h2>
        {findings.length > 0 && (
          <Button size="sm" variant="ghost" className="h-7 rounded-xl px-2 text-xs" aria-expanded={open} onClick={() => setOpen(!open)}>
            {t(open ? 'Hide' : 'Show')}
            <ChevronDown className={cn('size-3.5 transition-transform', open && 'rotate-180')} />
          </Button>
        )}
      </div>
      {read.error ? (
        <Refusal error={read.error} className="px-1 text-warning" />
      ) : !report ? (
        <p className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
          <LoaderCircle className="size-3.5 animate-spin" /> {t('Checking the home…')}
        </p>
      ) : findings.length === 0 ? (
        <p className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
          <CircleCheck className="size-3.5 text-success" /> {t('Nothing found · checked {when}', { when: ago(report.at) })}
        </p>
      ) : (
        <>
          <p className="px-1 text-xs text-muted-foreground">
            {t('{count} findings ({errors} refusing calls) · checked {when}', { count: findings.length, errors, when: ago(report.at) })}
          </p>
          {open && (
            <Card index={0} className="overflow-hidden">
              <ul>
                {findings.map((f, i) => (
                  <li key={`${f.entity?.kind}:${f.entity?.name}:${i}`} className={cn('flex min-w-0 flex-col gap-1 px-4 py-2.5', i > 0 && 'border-t')}>
                    <span className="flex min-w-0 flex-wrap items-center gap-2 text-[13px]">
                      <Chip tone={f.severity === 'error' ? 'danger' : 'warning'}>{t(f.severity === 'error' ? 'error' : 'warning')}</Chip>
                      {f.entity && (
                        <span>
                          <span className="text-muted-foreground">{f.entity.kind}</span> <span className="font-mono font-semibold">{f.entity.name}</span>
                        </span>
                      )}
                    </span>
                    <span className="text-xs break-words">{f.message}</span>
                    {f.fix && <span className="font-mono text-[11.5px] break-words text-muted-foreground">{t('fix: {call}', { call: f.fix })}</span>}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </section>
  )
}
