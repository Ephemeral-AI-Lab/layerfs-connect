import type { Segment } from '@shared/host-api'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { memo, useState } from 'react'

import { KindChip } from '@/components/runs/run-badges'
import { KIND } from '@/components/runs/run-format'
import { cn } from '@/lib/utils'

/** Scripts longer than this collapse to one key line per segment. */
const SHORT = 6

const norm = (s: string) => s.toLowerCase().replace(/[_-]/g, '')

/** The line that shows what a segment does: its call, else its first code line. */
export function keyLine(seg: Segment): string {
  const lines = seg.text.split('\n')
  if (seg.call) {
    const [family, method = ''] = seg.call.split('.')
    const sdk = norm(`.${method}(`)
    const cli = norm(`${family} ${method}`)
    const hit = lines.find((l) => {
      const n = norm(l)
      return n.includes(sdk) || n.includes(cli)
    })
    if (hit) return hit.trim()
  }
  const code = lines.map((l) => l.trim()).find((l) => l && !l.startsWith('#'))
  return code ?? lines[0]?.trim() ?? ''
}

// Lines that only frame an SDK script: the heredoc, opening and closing LayerFS, comments.
const FRAME = /^(#.*|node\b.*<<-?\s*'?\w+'?|[A-Z]+|const \{[^}]*\} = await import\(.*|const \w+ = await LayerFS\.open\(.*|try \{|\} finally \{|await \w+\.close\(\);?|\}|)$/

/** A local segment that only frames the script, hidden from the key-line view. */
const framing = (seg: Segment) => seg.kind === 'local' && seg.text.split('\n').every((l) => FRAME.test(l.trim()))

const lineCount = (segments: Segment[]) => segments.reduce((n, s) => n + s.text.split('\n').length, 0)

function FormMark({ form }: { form: Segment['form'] }) {
  return (
    <span className="rounded border border-border/80 px-1 font-mono text-[10px] leading-4 tracking-wide text-faint uppercase">
      {form}
    </span>
  )
}

function Detail({ seg }: { seg: Segment }) {
  if (!seg.detail) return null
  if (seg.call === 'workspace.exec')
    return (
      <div className="mx-3 mb-1.5 flex flex-col gap-0.5 rounded-md bg-card px-2.5 py-1.5 font-mono text-[13px] leading-snug font-medium text-foreground ring-1 ring-primary/20">
        {seg.detail.split('\n').map((cmd, i) => (
          <span key={i} className="flex items-start gap-2">
            <span aria-hidden="true" className="text-primary select-none">
              $
            </span>
            <span className="min-w-0 break-all whitespace-pre-wrap">{cmd}</span>
          </span>
        ))}
      </div>
    )
  return (
    <span className="truncate font-mono text-xs text-foreground" title={seg.detail}>
      {seg.detail}
    </span>
  )
}

const SegmentBlock = memo(function SegmentBlock({ seg, full }: { seg: Segment; full: boolean }) {
  const style = KIND[seg.kind]
  const exec = seg.call === 'workspace.exec'
  const [first, last] = seg.lines
  return (
    <div className={cn('border-l-[3px]', style.edge, style.tint)}>
      <div className="flex min-w-0 items-center gap-2 px-3 pt-1.5 pb-1">
        <KindChip kind={seg.kind}>{seg.call ?? style.label}</KindChip>
        <FormMark form={seg.form} />
        {!exec && <Detail seg={seg} />}
        <span className="ml-auto shrink-0 font-mono text-[10px] text-faint tabular-nums">
          {first === last ? `L${first}` : `L${first}–${last}`}
        </span>
      </div>
      {exec && <Detail seg={seg} />}
      <pre className="overflow-x-auto px-3 pb-2 font-mono text-xs leading-[1.55] text-muted-foreground">
        {full ? seg.text.replace(/\n+$/, '') : keyLine(seg)}
      </pre>
    </div>
  )
})

/** A command split into its parsed segments, each a block coloured by kind. */
export function SegmentList({ segments, className }: { segments: Segment[]; className?: string }) {
  const total = lineCount(segments)
  const long = total > SHORT
  const [open, setOpen] = useState(false)
  const full = !long || open
  if (segments.length === 0) return null
  return (
    <div className={cn('overflow-hidden rounded-lg border', className)}>
      <div className="flex flex-col divide-y divide-border/70">
        {segments.map((seg, i) =>
          full || !framing(seg) || segments.every(framing) ? <SegmentBlock key={i} seg={seg} full={full} /> : null,
        )}
      </div>
      {long && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex w-full items-center justify-center gap-1 border-t bg-muted/30 py-1 text-[11px] font-medium text-muted-foreground outline-none hover:bg-muted/60 hover:text-foreground focus-visible:bg-muted/60"
        >
          {open ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
          {open ? 'Show key lines' : `Show all ${total} lines`}
        </button>
      )}
    </div>
  )
}
