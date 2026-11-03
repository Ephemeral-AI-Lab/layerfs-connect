// One chip for a machine's, Store's or Sandbox's state as the SDK gives it.
// An operation in flight (`op`) overrides the word with its name and phase;
// an uncertain one is marked. See data/states.ts.
import type { SdkOperation } from '@shared/host-api'

import { Chip } from '@/components/storage/chips'
import { type Entity, opWords, stateLook } from '@/data/states'
import { t, useI18n } from '@/i18n'

export function StateChip({ entity, state, op, className }: { entity: Entity; state: string | null | undefined; op?: SdkOperation | null; className?: string }) {
  useI18n()
  const look = stateLook(entity, state)
  const words = opWords(op)
  return (
    <span className={className} title={words ? t('Operation {op}{uncertain}', { op: words, uncertain: op?.uncertain ? t(' (outcome uncertain)') : '' }) : undefined}>
      <Chip tone={look.tone} live={look.live} dashed={look.dashed}>
        {t(look.label)}
        {words && <span className="font-mono font-normal opacity-80">· {words}</span>}
      </Chip>
    </span>
  )
}
