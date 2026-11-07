// One chip for a machine's, Store's or Sandbox's state as the SDK gives it.
// An operation in flight (`op`) overrides the word with its name and phase;
// an uncertain one is marked. See data/states.ts.
import type { SdkOperation } from '@/layerfs/host-api'

import { Chip } from '@/components/layerfs/Chips'
import { type Entity, opWords, stateLook } from '@/layerfs/states'
import { cn } from '@/lib/utils'

export function StateChip({ entity, state, op, className }: { entity: Entity; state: string | null | undefined; op?: SdkOperation | null; className?: string }) {
  const look = stateLook(entity, state)
  const words = opWords(op)
  return (
    // an op's words truncate inside the chip (its title holds them all), so a long one never spills into the next column
    <span className={cn('inline-flex max-w-full min-w-0', className)} title={words ? `Operation ${words}${op?.uncertain ? ' (outcome uncertain)' : ''}` : undefined}>
      <Chip tone={look.tone} live={look.live} dashed={look.dashed} className="max-w-full min-w-0">
        {look.label}
        {words && <span className="min-w-0 truncate font-mono font-normal opacity-80">· {words}</span>}
      </Chip>
    </span>
  )
}
