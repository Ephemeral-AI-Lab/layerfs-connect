// A tool call's output under its step: folded to a line count, open to its
// last 40 lines, and "Show all" fetches the full output the host kept aside.
import { ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { chatHost, type ChatMessage } from '@/layerfs/agent-api'
import { cn } from '@/lib/utils'

const TAIL = 40

export function ShellOutput({ chatId, message }: { chatId: string; message: ChatMessage }) {
  const [open, setOpen] = useState(false)
  const [full, setFull] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const text = (full ?? message.text ?? '').replace(/\s+$/, '')
  if (!text) return null
  const lines = text.split('\n')
  const artifact = message.details?.outputArtifact
  const shown = full !== null ? lines : lines.slice(-TAIL)

  async function loadAll() {
    if (!artifact) return setFull(message.text)
    setLoading(true)
    let out = ''
    let offset = 0
    try {
      for (let page = 0; page < 50; page++) {
        const part = await chatHost.output(chatId, artifact.id, offset)
        out += part.text
        if (part.done || part.nextOffset === null) break
        offset = part.nextOffset
      }
      setFull(out)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="border-t border-[var(--border-default)]">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex h-8 w-full items-center gap-1.5 px-3 text-12 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
      >
        <ChevronRight className={cn('size-3 transition-transform', open && 'rotate-90')} />
        Output · {lines.length} {lines.length === 1 ? 'line' : 'lines'}
        {message.status === 'error' && <span className="text-destructive">· failed</span>}
      </button>
      {open && (
        <div className="px-3 pb-2.5">
          {(lines.length > shown.length || (full === null && artifact?.truncated)) && (
            <button type="button" disabled={loading} onClick={() => void loadAll()} className="mb-1 text-12 text-[var(--text-link,#417CDD)] hover:underline">
              {loading ? 'Loading…' : `Show all ${lines.length} lines`}
            </button>
          )}
          <pre className="max-h-[320px] overflow-auto rounded-2xs bg-[var(--surface-soft,#E8EFF8)] px-3 py-2 font-mono text-12 leading-5 text-[var(--text-secondary)]">
            {shown.join('\n')}
          </pre>
        </div>
      )}
    </div>
  )
}
