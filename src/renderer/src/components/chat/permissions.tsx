import { useI18n } from '@/i18n'
import { LoaderCircle, ShieldQuestion, ShieldX, Terminal } from 'lucide-react'
import { useState } from 'react'
import type { ApprovalRequest } from '@shared/agent-api'

import { spotlight } from '@/components/motion/spotlight'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const STATUS = { reviewing: 'Reviewing command', pending: 'Waiting for approval', approved: 'Approved', rejected: 'Rejected', cancelled: 'Cancelled' }

function ApprovalCard({ request, onDecision }: {
  request: ApprovalRequest
  onDecision: (id: string, decision: 'approve' | 'reject') => Promise<void>
}) {
  const { t } = useI18n()
  const [busy, setBusy] = useState(false)
  const active = request.status === 'pending' || request.status === 'reviewing'
  const reviewing = request.status === 'reviewing'
  async function decide(decision: 'approve' | 'reject') {
    setBusy(true)
    try { await onDecision(request.id, decision) } finally { setBusy(false) }
  }
  const actor = request.agent === 'root' ? t('Main agent') : request.agent.startsWith('child-') ? t('Child agent · {id}', { id: request.agent.slice(-6) }) : request.agent
  return <article data-state={request.status} onPointerMove={spotlight} className={cn('chat-approval-card chat-glass-card glass-liquid spotlight overflow-hidden rounded-2xl', active ? 'border-warning/25' : 'border-foreground/[0.08]')}>
    <div className="flex flex-wrap items-center gap-2 px-4 pt-3.5 pb-2.5 text-xs">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-xl bg-background/45">
        {reviewing ? <LoaderCircle className="size-3.5 animate-spin text-primary" /> : request.status === 'rejected' ? <ShieldX className="size-3.5 text-destructive" /> : <Terminal className="size-3.5 text-muted-foreground" />}
      </span>
      <span className="font-medium text-foreground" title={request.agent}>{actor}</span>
      <span className={cn('ml-auto rounded-full px-2.5 py-1 text-[10.5px] font-medium', active ? 'bg-warning/10 text-warning' : request.status === 'rejected' ? 'bg-destructive/10 text-destructive' : request.status === 'approved' ? 'bg-success/10 text-success' : 'bg-foreground/[0.05] text-muted-foreground')}>{t(STATUS[request.status])}</span>
      {request.source && <span className="text-[10.5px] text-muted-foreground">{request.source === 'model' ? t("Model review") : t("Manual decision")}</span>}
    </div>
    <div className="truncate px-4 pb-2.5 font-mono text-[10.5px] text-muted-foreground" title={request.cwd}>{request.cwd}</div>
    <pre className="mx-3.5 mb-3 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-foreground/[0.06] bg-background/45 px-3.5 py-3 font-mono text-[12px] leading-relaxed text-foreground">{request.command}</pre>
    {request.reason && <p className="px-4 pb-3 text-[11.5px] leading-relaxed text-muted-foreground">{request.reason}</p>}
    {active && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-foreground/[0.06] px-4 py-3">
      {reviewing && <span className="mr-auto text-[11px] text-muted-foreground">{t("You can decide directly")}</span>}
      <Button size="sm" variant="outline" className="rounded-xl" disabled={busy} onClick={() => void decide('reject')}>{t("Reject")}</Button>
      <Button size="sm" className="rounded-xl" disabled={busy} onClick={() => void decide('approve')}>{busy && <LoaderCircle className="size-3 animate-spin" />} {t("Approve once")}</Button>
    </div>}
  </article>
}

export function ApprovalPanel({ approvals, onDecision }: {
  approvals: ApprovalRequest[]
  onDecision: (id: string, decision: 'approve' | 'reject') => Promise<void>
}) {
  const { t } = useI18n()
  const waiting = approvals.filter((request) => request.status === 'pending' || request.status === 'reviewing')
  const history = approvals.filter((request) => request.status !== 'pending' && request.status !== 'reviewing')
  if (!approvals.length) return null
  return <section aria-label={t("Command approvals")} className="space-y-3 sm:ml-11">
    {waiting.length > 0 && <>
      <div className="flex items-center gap-2 px-1 text-[11px] font-medium text-muted-foreground"><ShieldQuestion className="size-3.5 text-warning" /> {t("{count} commands awaiting approval or review", { count: waiting.length })}</div>
      {waiting.map((request) => <ApprovalCard key={request.id} request={request} onDecision={onDecision} />)}
    </>}
    {history.length > 0 && <details onPointerMove={spotlight} className="chat-approval-log chat-glass-card glass-liquid spotlight rounded-2xl px-4 py-3">
      <summary className="cursor-pointer text-[11.5px] font-medium text-muted-foreground">{t("Approval history ·")} {history.length}{history.some((request) => request.source === 'model' && request.status === 'approved') && t(" · Model approved {count}", { count: history.filter((request) => request.source === 'model' && request.status === 'approved').length })}</summary>
      <div className="mt-3 space-y-2">{[...history].reverse().map((request) => <ApprovalCard key={request.id} request={request} onDecision={onDecision} />)}</div>
    </details>}
  </section>
}
