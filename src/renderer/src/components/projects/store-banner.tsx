// The project page's banner for its Store (#537 §7): busy (a push or pull in
// flight: writes and new Sandboxes are refused), down (its machine is stopped
// or does not answer), unresolved (an operation's outcome was lost; the call
// that clears it). While the Store is busy or unresolved, LayerFS refuses
// Branch, Commit and file reads too (Busy, Unresolved): the page then shows
// what the home's records say, and the refusal in the SDK's words.
import { CircleAlert, Clock, Power, TriangleAlert } from 'lucide-react'

import { Notice } from '@/components/storage/notice'
import { Button } from '@/components/ui/button'
import { clearingCall, opWords } from '@/data/states'
import { t, useI18n } from '@/i18n'
import type { ProjectState } from '@shared/host-api'

export function StoreBanner({ state, onStart }: { state: ProjectState; onStart?: (machine: string) => void }) {
  useI18n()
  const p = state.project
  const store = p.store
  const op = p.storeOp ?? null
  const refusal = p.refusal ?? null
  const refused = refusal && (
    <span className="mt-1 block break-words text-muted-foreground">
      <span className="font-semibold">{refusal.code}</span>: {refusal.message}
    </span>
  )
  if (p.storeState === 'busy') {
    return (
      <Notice tone="warning" icon={Clock} title={t('Store {store} is busy: {op}', { store, op: opWords(op) ?? t('an operation') })}>
        {t('Writes and new Sandboxes are refused until it ends; this page updates when it does.')}
        {refused}
      </Notice>
    )
  }
  if (p.storeState === 'unresolved') {
    const calls = clearingCall('store', store, op)
    return (
      <Notice tone="danger" icon={TriangleAlert} title={t('Store {store} is unresolved: {op}', { store, op: opWords(op) ?? t('an operation') })}>
        {t('Its outcome was lost; Store calls are refused until the clearing call runs.')}
        <span className="mt-1 block font-mono text-[11.5px]">{t('see {status} · clear: {clear}', calls)}</span>
        {refused}
      </Notice>
    )
  }
  if (p.storeState === 'down') {
    const machine = p.machine
    return (
      <Notice
        tone="danger"
        icon={Power}
        title={machine ? t('Store {store} is down: {machine} is not running', { store, machine }) : t('Store {store} is down', { store })}
        actions={machine && onStart ? <Button size="sm" variant="outline" className="rounded-xl" onClick={() => onStart(machine)}>{t('Start {machine}', { machine })}</Button> : undefined}
      >
        {p.storeDown ?? t('Its machine does not answer.')}
        {refused}
      </Notice>
    )
  }
  if (refusal) {
    return (
      <Notice tone="warning" icon={CircleAlert} title={t('Some of this project could not be read')}>
        {refused}
      </Notice>
    )
  }
  return null
}
