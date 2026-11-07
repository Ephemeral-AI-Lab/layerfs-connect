// The states LayerFS gives machines, Stores and Sandboxes (#536 §7.2, #537 §4),
// as Connect shows them. Connect never derives a state: it shows the SDK's
// `state`, and an `op` in flight (an SDK operation) overrides it with its name
// and phase. `failed`, `missing` and `unresolved` need the person.
import type { SdkOperation } from '@/layerfs/host-api'

import type { Tone } from '@/components/layerfs/Chips'

export type Entity = 'machine' | 'store' | 'sandbox'

export interface StateLook {
  tone: Tone
  label: string
  /** An operation or a live process: the chip pulses. */
  live?: boolean
  /** Not known now. */
  dashed?: boolean
  /** Counts as "needs you". */
  attention?: boolean
}

const LOOK: Record<Entity, Record<string, StateLook>> = {
  machine: {
    creating: { tone: 'warning', label: 'Creating', live: true },
    running: { tone: 'success', label: 'Running' },
    // native: always answering
    ready: { tone: 'success', label: 'Running' },
    stopped: { tone: 'neutral', label: 'Stopped' },
    removing: { tone: 'warning', label: 'Removing', live: true },
    failed: { tone: 'danger', label: 'Failed', attention: true },
    missing: { tone: 'danger', label: 'Missing', attention: true },
    unresolved: { tone: 'danger', label: 'Unresolved', attention: true },
    unknown: { tone: 'neutral', label: 'Unknown', dashed: true },
  },
  store: {
    idle: { tone: 'success', label: 'Idle' },
    in_use: { tone: 'info', label: 'In use', live: true },
    busy: { tone: 'warning', label: 'Busy', live: true },
    down: { tone: 'danger', label: 'Down' },
    unresolved: { tone: 'danger', label: 'Unresolved', attention: true },
    unknown: { tone: 'neutral', label: 'Unknown', dashed: true },
  },
  sandbox: {
    creating: { tone: 'warning', label: 'Creating', live: true },
    running: { tone: 'success', label: 'Running', live: true },
    closing: { tone: 'warning', label: 'Closing', live: true },
    gone: { tone: 'neutral', label: 'Gone' },
    unresolved: { tone: 'danger', label: 'Unresolved', attention: true },
    unknown: { tone: 'neutral', label: 'Unknown', dashed: true },
  },
}

/** How `state` of an `entity` looks; an unknown word is shown as it came. */
export function stateLook(entity: Entity, state: string | null | undefined): StateLook {
  return LOOK[entity][state ?? 'unknown'] ?? { tone: 'neutral', label: state || 'Unknown', dashed: !state }
}

/** Whether a state needs the person (`failed`, `missing`, `unresolved`). */
export const needsYou = (entity: Entity, state: string | null | undefined) => !!stateLook(entity, state).attention

/** An operation in words: `store.push · send`, marked when its outcome is uncertain. */
export function opWords(op: SdkOperation | null | undefined): string | null {
  if (!op) return null
  return [op.name, op.phase].filter(Boolean).join(' · ')
}

/**
 * The status call that shows an unresolved entity, and the call that clears
 * it, as LayerFS documents them (#536: store push or pull clears a Store's
 * transfer, store remove its removal; machine remove;
 * sandbox close). A refusal's own text names them too, and wins when shown.
 */
export function clearingCall(entity: Entity, name: string, op?: SdkOperation | null): { status: string; clear: string } {
  if (entity === 'store') {
    const clear = op?.name === 'store.remove' ? `layerfs store remove ${name}` : op?.name === 'store.pull' ? `layerfs store pull ${name}` : `layerfs store push ${name} <machine> (or store pull ${name})`
    return { status: `layerfs store status ${name}`, clear }
  }
  if (entity === 'machine') return { status: `layerfs machine status ${name}`, clear: `layerfs machine remove ${name}` }
  return { status: `layerfs sandbox get ${name}`, clear: `layerfs sandbox close ${name}` }
}
