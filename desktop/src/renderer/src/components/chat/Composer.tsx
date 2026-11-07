// The message box: a growing text area over a row of chips and the send
// button. Enter sends, Shift+Enter starts a new line.
import { ArrowUp, LoaderCircle } from 'lucide-react'
import { type ReactNode, useLayoutEffect, useRef } from 'react'
import { Tip } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

export function Composer({ value, onChange, onSend, chips, end, busy, sendBlocked, placeholder }: {
  value: string
  onChange: (text: string) => void
  onSend: () => void
  /** Left of the chip row: project, workspace. */
  chips: ReactNode
  /** Right of the chip row, before send: the model. */
  end?: ReactNode
  busy: boolean
  /** Why send is off (no model yet); null when it can send. */
  sendBlocked: string | null
  placeholder: string
}) {
  const box = useRef<HTMLTextAreaElement>(null)
  const canSend = !busy && !sendBlocked && value.trim().length > 0

  // grow with the text, up to about twelve lines, then scroll
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 280)}px`
  }, [value])

  return (
    <div className="rounded-md border border-[var(--border-default)] bg-[var(--card)] shadow-[0_1px_2px_rgb(20_40_80/0.04)] transition-colors focus-within:border-[color-mix(in_srgb,var(--ring)_45%,var(--border-default))]">
      <textarea
        ref={box}
        autoFocus
        rows={2}
        value={value}
        disabled={busy}
        placeholder={placeholder}
        aria-label="Message"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            if (canSend) onSend()
          }
        }}
        className="block max-h-[280px] min-h-[64px] w-full resize-none bg-transparent px-4 pb-1 pt-3.5 text-15 leading-6 text-[var(--text-primary)] outline-none placeholder:text-[var(--text-placeholder)]"
      />
      <div className="flex items-center gap-1.5 px-3 pb-3 pt-1">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">{chips}</div>
        {end}
        <Tip label={sendBlocked ?? 'Send'}>
          <span>
            <button
              type="button"
              aria-label="Send"
              disabled={!canSend}
              onClick={onSend}
              className={cn(
                'flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-[background-color,opacity] hover:bg-[var(--primary-hover)]',
                !canSend && 'opacity-35',
              )}
            >
              {busy ? <LoaderCircle className="size-4 animate-spin" /> : <ArrowUp className="size-4" strokeWidth={2.2} />}
            </button>
          </span>
        </Tip>
      </div>
    </div>
  )
}
