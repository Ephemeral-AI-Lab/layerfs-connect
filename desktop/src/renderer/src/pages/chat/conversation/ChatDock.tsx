// What sits on top of the message box: a command waiting for approval, what
// the agent is doing now (with Stop), messages queued while it works, and
// Continue when a run stopped part-way.
import { CornerDownRight, LoaderCircle, Play, ShieldAlert, Square, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { chatHost, type ChatDetail } from '@/layerfs/agent-api'
import { duration } from '@/layerfs/call-labels'

const PHASE: Record<string, string> = {
  preparing: 'Starting…',
  thinking: 'Thinking…',
  tool: 'Running a command…',
  approval: 'Waiting for your approval',
  children: 'Waiting for subagents…',
  retrying: 'Retrying…',
  compacting: 'Summarizing older turns…',
  stopping: 'Stopping…',
}

function useElapsed(since: number | null | undefined) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!since) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [since])
  return since ? now - since : null
}

export function ChatDock({ chat, onChange }: { chat: ChatDetail; onChange: (next: ChatDetail) => void }) {
  const [error, setError] = useState<string | null>(null)
  const run = (action: Promise<ChatDetail>) =>
    void action.then(onChange, (cause: Error) => setError(cause.message))

  const pending = chat.approvals.filter((a) => a.status === 'pending')
  const phase = chat.execution?.phase ?? 'idle'
  const working = chat.state === 'running' || !['idle', 'interrupted', 'error'].includes(phase)
  const elapsed = useElapsed(working ? chat.execution?.startedAt : null)
  const runningTool = [...chat.messages].reverse().find((m) => m.role === 'tool' && m.status === 'running')
  const toolLine = runningTool?.toolName === 'bash' ? String(runningTool.args?.command ?? '').split('\n').find((l) => l.trim() && !l.trim().startsWith('#')) : runningTool?.toolName
  const status = phase === 'tool' && toolLine ? `Running ${toolLine.trim().slice(0, 80)}` : (PHASE[phase] ?? (working ? 'Working…' : ''))

  if (!pending.length && !working && !chat.queued.length && !chat.recovery?.required && !error) return null
  return (
    <div className="mb-2 flex flex-col overflow-hidden rounded-md border border-[var(--border-default)] bg-[var(--card)] text-13">
      {pending.map((approval) => (
        <div key={approval.id} className="flex flex-col gap-2 border-b border-[var(--border-default)] bg-[color-mix(in_srgb,var(--warning)_8%,transparent)] px-3.5 py-2.5 last:border-b-0">
          <div className="flex items-center gap-1.5 font-medium text-[var(--text-primary)]">
            <ShieldAlert className="size-4 text-warning" /> Approve this command?
            <span className="ml-auto truncate text-12 font-normal text-[var(--text-tertiary)]">in {approval.cwd}</span>
          </div>
          <pre className="max-h-32 overflow-auto rounded-2xs bg-[var(--surface-soft,#E8EFF8)] px-2.5 py-1.5 font-mono text-12 leading-5">{approval.command}</pre>
          {approval.reason && <p className="text-12 text-[var(--text-secondary)]">{approval.reason}</p>}
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={() => run(chatHost.approve(chat.id, approval.id, 'reject'))}>Reject</Button>
            <Button size="sm" onClick={() => run(chatHost.approve(chat.id, approval.id, 'approve'))}>Approve</Button>
          </div>
        </div>
      ))}
      {working && (
        <div className="flex h-10 items-center gap-2 border-b border-[var(--border-default)] px-3.5 last:border-b-0">
          <LoaderCircle className="size-3.5 shrink-0 animate-spin text-[var(--text-tertiary)]" />
          <span className="min-w-0 truncate text-[var(--text-secondary)]">{status}</span>
          {elapsed !== null && <span className="shrink-0 tabular-nums text-12 text-[var(--text-tertiary)]">{duration(elapsed)}</span>}
          <Button size="sm" variant="outline" className="ml-auto h-7" onClick={() => run(chatHost.stop(chat.id))}>
            <Square className="size-3" /> Stop
          </Button>
        </div>
      )}
      {chat.queued.map((queued) => (
        <div key={queued.id} className="flex h-9 items-center gap-2 border-b border-[var(--border-default)] px-3.5 last:border-b-0">
          <CornerDownRight className="size-3.5 shrink-0 text-[var(--text-tertiary)]" />
          <span className="min-w-0 flex-1 truncate text-[var(--text-secondary)]">{queued.text}</span>
          <button type="button" className="shrink-0 text-12 text-[var(--text-link,#417CDD)] hover:underline" onClick={() => run(chatHost.steer(chat.id, queued.id))}>
            Steer now
          </button>
          <button type="button" aria-label="Remove queued message" className="shrink-0 text-[var(--text-tertiary)] hover:text-[var(--text-primary)]" onClick={() => run(chatHost.unqueue(chat.id, queued.id))}>
            <X className="size-3.5" />
          </button>
        </div>
      ))}
      {chat.recovery?.required && !working && (
        <div className="flex h-10 items-center gap-2 px-3.5">
          <span className="min-w-0 flex-1 truncate text-[var(--text-secondary)]">The last run stopped part-way.</span>
          {chat.recovery.canContinue && (
            <Button size="sm" variant="outline" className="h-7" onClick={() => run(chatHost.continue(chat.id))}>
              <Play className="size-3" /> Continue
            </Button>
          )}
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 px-3.5 py-2 text-12 text-destructive">
          <span className="min-w-0 flex-1">{error}</span>
          <button type="button" aria-label="Dismiss" onClick={() => setError(null)}>
            <X className="size-3.5" />
          </button>
        </div>
      )}
    </div>
  )
}
