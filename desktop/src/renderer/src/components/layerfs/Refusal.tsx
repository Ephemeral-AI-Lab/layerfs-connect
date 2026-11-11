import { fill } from '@/lib/text'
// A LayerFS refusal as Connect shows it (#537 §1 "every refusal is
// actionable"): its code, the SDK's own text (which names any status or
// clearing call), the entity and phase it stopped at, and what is in the way
// (`detail.related`), each by kind and name. Nothing is reworded.
import type { RefusalDetail, SdkRefusal } from '@/layerfs/host-api'

import { HostError } from '@/layerfs/client'
import { cn } from '@/lib/utils'

/** The refusal in an error a call threw, or a plain error's words. */
export function refusalOf(error: unknown): SdkRefusal {
  if (error instanceof HostError) return { code: error.code, message: error.message, detail: error.detail }
  if (error && typeof error === 'object' && 'code' in error && 'message' in error) return error as SdkRefusal
  return { code: 'Failed', message: error instanceof Error ? error.message : String(error), detail: null }
}

const KIND: Record<string, string> = { sandbox: 'Sandbox', store: 'Store', lease: 'process', machine: 'machine', project: 'project', workspace: 'Workspace' }

/** `related` as words: "Sandbox a1, process 4242". */
export function relatedWords(detail: RefusalDetail | null | undefined): string[] {
  return (detail?.related ?? []).map((r) => `${fill(KIND[r.kind] ?? r.kind)} ${r.name}`)
}

export function Refusal({ error, className, compact }: { error: unknown; className?: string; compact?: boolean }) {
  const r = refusalOf(error)
  const d = r.detail ?? null
  const related = d?.related ?? []
  const transport = (error as { transport?: string })?.transport
  const category = transport === 'usage-incompatible' ? 'Usage / incompatible CLI' : transport === 'unavailable' ? 'CLI unavailable' : transport === 'transport-unknown' ? 'Final result unavailable' : 'LayerFS refusal'
  const extra = d ? Object.entries(d).filter(([key]) => ['authority', 'source', 'retired', 'needed', 'free', 'missing', 'vm_exists', 'execs'].includes(key)) : []
  const where = [d?.entity && `${fill(KIND[d.entity.kind] ?? d.entity.kind)} ${d.entity.name}`, d?.phase && `phase ${d.phase}`, typeof d?.op === 'string' && `operation ${d.op}`].filter(Boolean)
  return (
    <div role="alert" className={cn('min-w-0 break-words text-sm leading-relaxed', className)}>
      {!compact && <p className="text-xs text-muted-foreground">{category}</p>}
      {error instanceof HostError && error.activityId && <a className="text-xs underline underline-offset-2" href={`#/activity?action=${encodeURIComponent(error.activityId)}`}>View CLI activity</a>}
      <p>
        <span className="font-strong">{r.code}</span>
        {': '}
        {r.message}
      </p>
      {!compact && where.length > 0 && <p className="mt-0.5 text-muted-foreground">{where.join(' · ')}</p>}
      {!compact && extra.map(([key, value]) => <p key={key} className="text-xs text-muted-foreground">{key}: {typeof value === 'object' ? JSON.stringify(value) : String(value)}</p>)}
      {related.length > 0 && (
        <div className="mt-1">
          <span className="text-muted-foreground">{'In the way:'}</span>
          <ul className="mt-0.5 flex flex-col gap-0.5">
            {related.map((x) => (
              <li key={`${x.kind}:${x.name}`} className="font-mono text-xs-plus">
                {fill(KIND[x.kind] ?? x.kind)} {x.name}
                {x.why && <span className="font-sans text-muted-foreground"> — {x.why}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
