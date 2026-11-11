import { fill } from '@/lib/text'
// Storage's "Needs attention" (#537 §5, §8.7): what `layerfs doctor` finds in
// the home, as a badge in the page's summary row that opens its findings.
// Doctor is report-only: it reads records, leases, intents and workers, starts
// no machine and changes nothing. Each finding names its entity and the call
// that fixes it, in LayerFS's words; Connect runs none of them for you. Read
// when the page loads or is refreshed, never on a timer.
import { ChevronRight, Info, LoaderCircle, Stethoscope } from 'lucide-react'

import { Refusal } from '@/components/layerfs/Refusal'
import { Chip } from '@/components/layerfs/Chips'
import { Card } from '@/pages/storage/RowParts'
import { ago } from '@/layerfs/format'
import { host } from '@/layerfs/client'
import { type Loaded, useHostQuery } from '@/layerfs/use-host'
import { cn } from '@/lib/utils'
import type { DoctorReport } from '@/layerfs/host-api'

/** Reads `layerfs doctor` again whenever `tick` changes. */
export const useDoctor = (tick: number) => useHostQuery(() => host.doctor(), [tick], 'doctor')

/** The summary badge: checking, nothing found, or how many findings; a button that opens them. */
export function DoctorBadge({ read, open, onToggle }: { read: Loaded<DoctorReport>; open: boolean; onToggle: () => void }) {
  const findings = read.data?.findings ?? []
  const errors = findings.filter((f) => f.severity === 'error').length
  const words = read.error ? 'Doctor did not answer' : !read.data ? 'Doctor: checking…' : findings.length === 0 ? `Home checks: no findings · ${ago(read.data.at)}` : fill(findings.length === 1 ? 'Doctor: 1 finding' : 'Doctor: {count} findings', { count: findings.length })
  const openable = !!read.error || findings.length > 0
  return (
    <button
      type="button"
      disabled={!openable}
      aria-expanded={openable ? open : undefined}
      onClick={onToggle}
      title={read.data ? `layerfs doctor · checked ${ago(read.data.at)}` : 'layerfs doctor'}
      className={cn('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-sm whitespace-nowrap transition-colors', openable ? 'hover:bg-foreground/[0.05]' : 'cursor-default', errors || read.error ? 'text-destructive' : findings.length ? 'text-amber-600' : 'text-muted-foreground')}
    >
      {!read.data && !read.error ? <LoaderCircle className="size-3.5 animate-spin" /> : findings.length === 0 && !read.error ? <Info className="size-3.5" /> : <Stethoscope className="size-3.5" />}
      {words}
      {openable && <ChevronRight className={cn('size-3.5 transition-transform', open && 'rotate-90')} />}
    </button>
  )
}

/** The findings, each with its entity and fix; the badge opens them. */
export function DoctorFindings({ read }: { read: Loaded<DoctorReport> }) {
  const report = read.data
  const findings = report?.findings ?? []
  const errors = findings.filter((f) => f.severity === 'error').length
  if (read.error) return <Refusal error={read.error} className="px-1 text-sm text-warning" />
  if (!report || findings.length === 0) return null
  return (
    <Card index={0} className="overflow-hidden" aria-label={'Needs attention'}>
      <p className="border-b px-4 py-2 text-sm text-muted-foreground">
        {'Needs attention'} <span className="font-mono">(layerfs doctor)</span> · {`${findings.length} findings (${errors} refusing calls) · checked ${ago(report.at)}`}
      </p>
      <ul>
        {findings.map((f, i) => (
          <li key={`${f.entity?.kind}:${f.entity?.name}:${i}`} className={cn('flex min-w-0 flex-col gap-1 px-4 py-2.5', i > 0 && 'border-t')}>
            <span className="flex min-w-0 flex-wrap items-center gap-2 text-md">
              <Chip tone={f.severity === 'error' ? 'danger' : 'warning'}>{fill(f.severity === 'error' ? 'error' : 'warning')}</Chip>
              {f.entity && (
                <span>
                  <span className="text-muted-foreground">{f.entity.kind}</span> <span className="font-mono font-strong">{f.entity.name}</span>
                </span>
              )}
            </span>
            <span className="text-sm break-words">{f.message}</span>
            {f.fix && <span className="font-mono text-xs-plus break-words text-muted-foreground">{`fix: ${f.fix}`}</span>}
          </li>
        ))}
      </ul>
    </Card>
  )
}
