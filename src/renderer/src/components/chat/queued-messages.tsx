import { useI18n } from '@/i18n'
import type { QueuedAgentMessage } from '@shared/agent-api'
import { ChevronDown, CornerDownRight, ListEnd, LoaderCircle, Trash2, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { cn } from '@/lib/utils'

interface QueuedMessagesProps {
  messages: QueuedAgentMessage[]
  disabled?: boolean
  onSteer: (id: string) => Promise<void>
  onRemove: (id: string) => Promise<void>
}

export function QueuedMessages({ messages, disabled, onSteer, onRemove }: QueuedMessagesProps) {
  const { t } = useI18n()
  const [expanded, setExpanded] = useState<string | null>(null)
  const [pending, setPending] = useState<{ id: string; action: 'steer' | 'remove' } | null>(null)
  const [error, setError] = useState('')
  const inFlight = useRef(false)

  async function act(id: string, action: 'steer' | 'remove') {
    if (disabled || inFlight.current) return
    inFlight.current = true
    setPending({ id, action })
    setError('')
    try {
      await (action === 'steer' ? onSteer(id) : onRemove(id))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      inFlight.current = false
      setPending(null)
    }
  }

  if (!messages.length && !error) return null

  return (
    <section aria-label={t("Queued messages")} className="glass-liquid chat-glass-card mx-3 -mb-4 overflow-hidden rounded-t-2xl rounded-b-xl pb-4">
      {messages.length > 0 && (
        <>
          <div className="flex items-center justify-between gap-2 px-4 pt-2.5 pb-1.5 text-[10.5px] text-muted-foreground">
            <span className="flex items-center gap-1.5 font-medium">
              {t("Next up")}<span className="rounded-full bg-foreground/[0.05] px-1.5 text-[10px] tabular-nums">{messages.length}</span>
            </span>
            <span role="status" className="truncate">{t("Continues automatically")}</span>
          </div>
          <ul className="max-h-[min(25vh,10rem)] overflow-y-auto overscroll-contain px-2 pb-1">
            {messages.map((message) => {
              const isExpanded = expanded === message.id
              const busy = pending?.id === message.id
              const steering = message.mode === 'steer'
              return (
                <li key={message.id} className="flex items-start gap-2 rounded-xl px-2 py-1.5 transition-colors hover:bg-foreground/[0.025]">
                  <ListEnd aria-hidden="true" className={cn('mt-2 size-3.5 shrink-0', steering ? 'text-primary' : 'text-muted-foreground')} />
                  <button
                    type="button"
                    aria-expanded={isExpanded}
                    title={isExpanded ? t("Collapse message") : t("Show full message")}
                    onClick={() => setExpanded(isExpanded ? null : message.id)}
                    className="group flex min-w-0 flex-1 items-start gap-1.5 rounded-lg py-1.5 text-left text-[13px] leading-5 text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className={cn('min-w-0 flex-1', isExpanded ? 'max-h-24 overflow-y-auto whitespace-pre-wrap break-words [overflow-wrap:anywhere]' : 'truncate')}>{message.text}</span>
                    <ChevronDown aria-hidden="true" className={cn('mt-1 size-3 shrink-0 text-muted-foreground opacity-0 transition-[opacity,transform] group-hover:opacity-100 group-focus-visible:opacity-100', isExpanded && 'rotate-180 opacity-100')} />
                  </button>
                  <div className="flex shrink-0 items-center gap-0.5 pt-0.5">
                    {steering ? (
                      <span title={t("The agent will pick this up during the current task.")} className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-[11px] font-medium text-primary">
                        <CornerDownRight aria-hidden="true" className="size-3" /> {t("Guiding")}</span>
                    ) : (
                      <button
                        type="button"
                        aria-label={t("Steer queued message")}
                        title={t("Guide this task after its current step finishes")}
                        disabled={disabled || !!pending}
                        onClick={() => void act(message.id, 'steer')}
                        className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-[11px] font-medium text-muted-foreground outline-none transition-colors hover:bg-primary/10 hover:text-primary focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
                      >
                        {busy && pending.action === 'steer' ? <LoaderCircle aria-hidden="true" className="size-3 animate-spin" /> : <CornerDownRight aria-hidden="true" className="size-3" />}
                        {t("Steer")}</button>
                    )}
                    <button
                      type="button"
                      aria-label={t("Remove queued message")}
                      title={t("Remove from queue")}
                      disabled={disabled || !!pending}
                      onClick={() => void act(message.id, 'remove')}
                      className="flex size-7 items-center justify-center rounded-lg text-muted-foreground outline-none transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
                    >
                      {busy && pending.action === 'remove' ? <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" /> : <Trash2 aria-hidden="true" className="size-3.5" />}
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        </>
      )}
      {error && (
        <div role="alert" className="mx-3 mb-2 flex items-center gap-2 rounded-lg bg-destructive/[0.06] px-2.5 py-2 text-[11px] leading-relaxed text-destructive">
          <span className="min-w-0 flex-1 break-words">{t(error)}</span>
          <button type="button" aria-label={t("Dismiss queue error")} onClick={() => setError('')} className="inline-flex size-5 shrink-0 items-center justify-center rounded outline-none hover:bg-destructive/10 focus-visible:ring-2 focus-visible:ring-ring"><X className="size-3" /></button>
        </div>
      )}
    </section>
  )
}
