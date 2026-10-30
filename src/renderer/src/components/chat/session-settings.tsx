import { useI18n } from '@/i18n'
import { LoaderCircle } from 'lucide-react'
import { useRef, useState } from 'react'
import type { AgentLimits, AgentSessionSummary } from '@shared/agent-api'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'

export type SessionSettingsTarget = { session?: AgentSessionSummary; limits?: AgentLimits; mode: 'rename' | 'limits'; returnFocus?: HTMLElement | null }
export function SessionSettingsDialog({ target, onClose, onSave }: { target: SessionSettingsTarget; onClose: () => void; onSave: (value: { title: string } | AgentLimits) => Promise<void> }) {
  const { t } = useI18n()
  const [title, setTitle] = useState(target.session?.title ?? '')
  const [limits, setLimits] = useState<AgentLimits>(target.session?.limits ?? target.limits ?? { maxTurns: 32, maxRuntimeSeconds: 1800, bashTimeoutSeconds: 120, maxRetries: 2, instructions: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const inFlight = useRef(false)
  const rename = target.mode === 'rename'
  async function save() {
    if (inFlight.current) return
    if (rename && !title.trim()) { setError('Enter a conversation name.'); return }
    if (!rename && (Object.entries(limits).some(([key, value]) => key !== 'instructions' && (!Number.isInteger(value) || Number(value) < (key === 'bashTimeoutSeconds' ? 1 : 0))) || new TextEncoder().encode(limits.instructions ?? '').length > 32 * 1024)) { setError('Use whole, non-negative limits, a positive command timeout, and instructions under 32 KiB.'); return }
    inFlight.current = true; setBusy(true); setError('')
    try { await onSave(rename ? { title: title.trim() } : limits); onClose() }
    catch (e) { setError((e as Error).message) }
    finally { inFlight.current = false; setBusy(false) }
  }
  return <Dialog open onOpenChange={(open) => { if (!open && !inFlight.current) onClose() }}>
    <DialogContent showCloseButton={!busy} className="max-h-[calc(100svh-2rem)] overflow-y-auto rounded-3xl [--dialog-inset:1.5rem] sm:max-w-lg" onEscapeKeyDown={(e) => { if (inFlight.current) e.preventDefault() }} onInteractOutside={(e) => { if (inFlight.current) e.preventDefault() }} onCloseAutoFocus={(e) => { e.preventDefault(); (target.returnFocus?.isConnected ? target.returnFocus : document.querySelector<HTMLElement>('[data-conversation-actions]'))?.focus() }}>
      <DialogHeader><DialogTitle>{rename ? t("Rename chat") : t("Run settings")}</DialogTitle><DialogDescription className="text-xs leading-relaxed">{rename ? t("Give this conversation a name you can find later.") : t("Limits and additional instructions for this conversation and its agents. Changes apply to the next run.")}</DialogDescription></DialogHeader>
      {rename ? <label className="grid gap-2 text-xs">{t("Name")}<Input aria-label={t("Conversation name")} maxLength={120} value={title} disabled={busy} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); void save() } }} /></label> : <>
        <div className="grid grid-cols-2 gap-3">{([
          ['maxTurns', t("Maximum turns"), t("Main agent; 0 disables this limit")], ['maxRuntimeSeconds', t("Run time (seconds)"), '0 disables this limit'],
          ['bashTimeoutSeconds', t("Command timeout (seconds)"), t("Default when a command has no explicit timeout")], ['maxRetries', t("Automatic retries"), t("Main agent; 0 disables retries")],
        ] as const).map(([key, label, help]) => <label key={key} className="grid gap-1.5 text-xs"><span>{t(label)}</span><Input type="number" min={key === 'bashTimeoutSeconds' ? 1 : 0} step={1} aria-label={t(label)} value={limits[key]} disabled={busy} onChange={(e) => setLimits({ ...limits, [key]: e.target.value === '' ? 0 : Number(e.target.value) })} /><span className="text-[10px] leading-relaxed text-muted-foreground">{t(help)}</span></label>)}</div>
        <label className="grid gap-2 text-xs">{t("Additional instructions")}<textarea aria-label={t("Additional instructions")} value={limits.instructions ?? ''} disabled={busy} onChange={(e) => setLimits({ ...limits, instructions: e.target.value })} rows={3} placeholder={t("Optional instructions for this conversation…")} className="max-h-44 min-h-24 w-full resize-y rounded-xl border border-foreground/[0.1] bg-background/40 px-3 py-2 text-xs leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring" /></label>
      </>}
      {error && <p role="alert" className="text-xs leading-relaxed text-destructive">{t(error)}</p>}
      <div className="flex justify-end gap-2"><Button variant="outline" disabled={busy} onClick={onClose}>{t("Cancel")}</Button><Button disabled={busy || (rename && !title.trim())} onClick={() => void save()}>{busy && <LoaderCircle className="size-3.5 animate-spin" />}{busy ? t("Saving…") : t("Save")}</Button></div>
    </DialogContent>
  </Dialog>
}
