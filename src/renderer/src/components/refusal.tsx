// A LayerFS refusal as Connect shows it (#537 §1 "every refusal is
// actionable"): its code, the SDK's own text (which names any status or
// clearing call), the entity and phase it stopped at, and what is in the way
// (`detail.related`), each by kind and name. Nothing is reworded.
import type { RefusalDetail, SdkRefusal } from '@shared/host-api'

import { HostError } from '@/host/client'
import { t, useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

/** The refusal in an error a call threw, or a plain error's words. */
export function refusalOf(error: unknown): SdkRefusal {
  if (error instanceof HostError) return { code: error.code, message: error.message, detail: error.detail }
  if (error && typeof error === 'object' && 'code' in error && 'message' in error) return error as SdkRefusal
  return { code: 'Failed', message: error instanceof Error ? error.message : String(error), detail: null }
}

const KIND: Record<string, string> = { sandbox: 'Sandbox', store: 'Store', lease: 'process', machine: 'machine', project: 'project', workspace: 'Workspace', firecracker: 'Firecracker machine' }

/** `related` as words: "Sandbox a1, process 4242". */
export function relatedWords(detail: RefusalDetail | null | undefined): string[] {
  return (detail?.related ?? []).map((r) => `${t(KIND[r.kind] ?? r.kind)} ${r.name}`)
}

export function Refusal({ error, className, compact }: { error: unknown; className?: string; compact?: boolean }) {
  useI18n()
  const r = refusalOf(error)
  const d = r.detail ?? null
  const related = d?.related ?? []
  const where = [d?.entity && `${t(KIND[d.entity.kind] ?? d.entity.kind)} ${d.entity.name}`, d?.phase && t('phase {phase}', { phase: d.phase }), typeof d?.op === 'string' && t('operation {op}', { op: d.op })].filter(Boolean)
  return (
    <div role="alert" className={cn('min-w-0 break-words text-xs leading-relaxed', className)}>
      <p>
        <span className="font-semibold">{r.code}</span>
        {': '}
        {r.message}
      </p>
      {!compact && where.length > 0 && <p className="mt-0.5 text-muted-foreground">{where.join(' · ')}</p>}
      {related.length > 0 && (
        <div className="mt-1">
          <span className="text-muted-foreground">{t('In the way:')}</span>
          <ul className="mt-0.5 flex flex-col gap-0.5">
            {related.map((x) => (
              <li key={`${x.kind}:${x.name}`} className="font-mono text-[11.5px]">
                {t(KIND[x.kind] ?? x.kind)} {x.name}
                {x.why && <span className="font-sans text-muted-foreground"> — {x.why}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
