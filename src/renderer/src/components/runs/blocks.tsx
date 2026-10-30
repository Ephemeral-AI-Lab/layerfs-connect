// The conversation's blocks: a call's script and output in one card, and the
// agents' messages as light Markdown.
//
// A script shows whole, syntax highlighted, once. Each line that makes a
// LayerFS call carries its kind's edge and tint, and after the code what the
// call returned ("Forked · 14 ms"). Long SDK scripts fold their setup lines
// (the heredoc, import, open, try/finally, close) until the reader opens
// them; long output keeps its head, or its tail when the call failed.
import type { SegmentKind, StepResult, StepView, TraceCall } from '@shared/host-api'
import { Check, Copy, Scissors } from 'lucide-react'
import { Fragment, memo, useMemo, useState } from 'react'

import { KIND, duration, methodKind } from '@/components/runs/run-format'
import { type Lang, type Token, highlight, highlightOutput } from '@/lib/highlight'
import { type Inline, blocks, inline } from '@/lib/markdown'
import { cn } from '@/lib/utils'
import { useI18n } from '@/i18n'

/** Lines a script shows before it folds its setup, and before it cuts. */
const FOLD_OVER = 8
const SCRIPT_ROWS = 22
/** Output lines shown before "N more lines". */
const OUTPUT_ROWS = 14

// Lines that only frame an SDK script: the heredoc, opening and closing LayerFS, a leading comment.
const FRAME =
  /^(#.*|(timeout \S+ )?node\b.*<<-?\s*'?\w+'?|[A-Z]+|const \{[^}]*\} = await import\(.*|const \w+ = await (LayerFS|Backend)\.open\(.*|try \{|\} finally \{|await \w+\.close\(\);?|\}|)$/

/** A line's lines of text, without the empty one a final newline leaves. */
const linesOf = (text: string) => text.replace(/\n$/, '').split('\n')

// ---------------------------------------------------------------------------
// Call marks: where each LayerFS call is, and what it returned.

interface Mark {
  kind: SegmentKind
  cols: [number, number]
  calls: TraceCall[]
  /** workspace.exec: the command it runs, when the line only names it ("$cmd"). */
  exec?: string
}

/** Each call line's mark, by 0-based line; trace calls no line made go in `extra`. */
function marksOf(view: StepView | undefined, trace: TraceCall[]): { marks: Map<number, Mark>; extra: TraceCall[] } {
  const marks = new Map<number, Mark>()
  const places: { method: string; mark: Mark }[] = []
  const lines = view ? linesOf(view.text) : []
  for (const seg of view?.segments ?? []) {
    // the commands no exec line spells out itself ("$cmd", a heredoc read earlier)
    const execLines = (seg.at ?? []).filter((a) => a.call === 'workspace.exec').map((a) => lines[a.line - 1] ?? '')
    const unseen = seg.call === 'workspace.exec' ? (seg.detail ?? '').split('\n').filter((d) => d && !execLines.some((l) => l.includes(d))) : []
    let detail = unseen.length ? unseen.join('\n') : undefined
    for (const at of seg.at ?? []) {
      const line = at.line - 1
      if (marks.has(line)) continue
      const mark: Mark = { kind: methodKind(at.call), cols: at.cols, calls: [] }
      if (at.call === 'workspace.exec' && detail && !/["'`](?!\$)[^"'`]*\w/.test(lines[line]?.slice(at.cols[1]) ?? '')) {
        mark.exec = detail
        detail = undefined
      }
      marks.set(line, mark)
      places.push({ method: at.call, mark })
    }
  }
  // trace calls go to the lines of their method in order; a loop's extra calls stay on the last
  const extra: TraceCall[] = []
  const left = new Map<string, Mark[]>()
  for (const p of places) left.set(p.method, [...(left.get(p.method) ?? []), p.mark])
  for (const c of trace) {
    const queue = left.get(c.method)
    if (!queue?.length) {
      const last = places.findLast((p) => p.method === c.method)
      if (last) last.mark.calls.push(c)
      else extra.push(c)
      continue
    }
    queue.shift()!.calls.push(c)
  }
  return { marks, extra }
}

/** Calls grouped by method, in first-call order. */
function byMethod(calls: TraceCall[]): [string, TraceCall[]][] {
  const out = new Map<string, TraceCall[]>()
  for (const c of calls) out.set(c.method, [...(out.get(c.method) ?? []), c])
  return [...out]
}

const callResult = (c: TraceCall) => (c.ok === null ? '…' : c.ok ? (c.kind ?? 'ok') : (c.code ?? c.kind ?? 'failed'))

/** A call's facts for its tooltip. */
const callTitle = (c: TraceCall) =>
  [
    `${c.method} → ${callResult(c)}${c.ms != null ? ` · ${duration(c.ms)}` : ''}`,
    c.branch && `branch ${c.branch}`,
    c.commit && `commit ${c.commit}`,
    c.sandbox && `sandbox ${c.sandbox}`,
    c.path && `path ${c.path}`,
  ]
    .filter(Boolean)
    .join('\n')

/** "→ Forked · 14 ms", or "→ ×3 Committed · 40 ms" for a loop. */
function CallNote({ calls }: { calls: TraceCall[] }) {
  if (calls.length === 0) return null
  const failed = calls.some((c) => c.ok === false)
  const total = calls.reduce((n, c) => n + (c.ms ?? 0), 0)
  const results = [...new Set(calls.map(callResult))].join(', ')
  return (
    <span
      title={calls.map(callTitle).join('\n\n')}
      className={cn('ml-4 font-sans text-[11px] not-italic select-none', failed ? 'text-destructive' : 'text-faint')}
    >
      → {calls.length > 1 && `×${calls.length} `}
      {results}
      {total > 0 && ` · ${duration(total)}`}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Lines

/** A line's tokens, with the call's columns set apart. */
function Tokens({ tokens, cols }: { tokens: Token[]; cols?: [number, number] }) {
  if (!cols) return tokens.map(([text, cls], k) => <span key={k} className={cls || undefined}>{text}</span>)
  const out: React.ReactNode[] = []
  let at = 0
  tokens.forEach(([text, cls], k) => {
    const end = at + text.length
    const cuts = [at, Math.min(Math.max(cols[0], at), end), Math.min(Math.max(cols[1], at), end), end]
    for (let p = 0; p < 3; p++) {
      const piece = text.slice(cuts[p] - at, cuts[p + 1] - at)
      if (piece) out.push(<span key={`${k}:${p}`} className={cn(cls, p === 1 && 'font-semibold')}>{piece}</span>)
    }
    at = end
  })
  return out
}

/** A row that folds lines away: "⋯ 5 setup lines". */
function FoldRow({ label, onClick }: { label: string; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 bg-muted/50 py-0.5 pl-3 text-left font-sans text-[11px] text-faint outline-none hover:bg-muted hover:text-muted-foreground focus-visible:bg-muted"
    >
      <span aria-hidden="true" className="tracking-widest">⋯</span>
      {label}
    </button>
  )
}

type Row = { type: 'line'; n: number } | { type: 'fold'; label: string }

interface LinesProps {
  lines: Token[][]
  rows: Row[]
  /** The gutter: line numbers, a `$` prompt on each command line, or none. */
  gutter: 'numbers' | 'prompt' | 'none'
  marks?: Map<number, Mark>
  onFold?: () => void
  source?: string[]
}

function Lines({ lines, rows, gutter, marks, onFold, source }: LinesProps) {
  const width = String(lines.length).length
  return (
    <div className="overflow-x-auto">
      <div className="w-max min-w-full py-1.5">
        {rows.map((row) => {
          if (row.type === 'fold') return <FoldRow key={`f:${row.label}`} label={row.label} onClick={onFold} />
          const mark = marks?.get(row.n)
          const text = source?.[row.n] ?? ''
          return (
            <Fragment key={row.n}>
              <div className={cn('relative flex pr-4', mark && KIND[mark.kind].tint)}>
                {mark && <span aria-hidden="true" className={cn('absolute inset-y-0 left-0 w-[2px]', KIND[mark.kind].dot)} />}
                {gutter !== 'none' && (
                  <span
                    aria-hidden="true"
                    style={{ width: `${width + 2.5}ch` }}
                    className="shrink-0 pr-3 text-right text-faint/70 tabular-nums select-none"
                  >
                    {gutter === 'numbers' ? row.n + 1 : text.trim() && !text.trimStart().startsWith('#') ? '$' : ''}
                  </span>
                )}
                <span className={cn('whitespace-pre', gutter === 'none' && 'pl-3')}>
                  <Tokens tokens={lines[row.n] ?? []} cols={mark?.cols} />
                  {mark && <CallNote calls={mark.calls} />}
                </span>
              </div>
              {mark?.exec && (
                <div className={cn('relative flex pr-4', KIND[mark.kind].tint)}>
                  <span aria-hidden="true" className={cn('absolute inset-y-0 left-0 w-[2px]', KIND[mark.kind].dot)} />
                  {gutter !== 'none' && <span style={{ width: `${width + 2.5}ch` }} className="shrink-0" />}
                  <span className={cn('whitespace-pre-wrap text-muted-foreground', gutter === 'none' && 'pl-3')}>
                    <span className="text-faint select-none">↳ runs </span>
                    <Tokens tokens={highlight(mark.exec, 'bash').flatMap((l, k) => (k ? [['\n', ''] as Token, ...l] : l))} />
                  </span>
                </div>
              )}
            </Fragment>
          )
        })}
      </div>
    </div>
  )
}

/** The rows of a script: all of it, or its setup runs folded and its length cut. */
function scriptRows(source: string[], marks: Map<number, Mark>, full: boolean, sdk: boolean): { rows: Row[]; folded: boolean } {
  const all: Row[] = source.map((_, n) => ({ type: 'line', n }))
  if (full || source.length <= FOLD_OVER) return { rows: all, folded: false }
  const rows: Row[] = []
  let folded = false
  for (let n = 0; n < source.length; ) {
    let end = n
    if (sdk) while (end < source.length && !marks.has(end) && FRAME.test(source[end].trim())) end++
    if (end - n >= 3) {
      rows.push({ type: 'fold', label: `${end - n} setup lines` })
      folded = true
      n = end
    } else rows.push({ type: 'line', n: n++ })
  }
  if (rows.length > SCRIPT_ROWS) {
    const hidden = rows.slice(SCRIPT_ROWS - 1).reduce((k, r) => k + (r.type === 'line' ? 1 : 0), 0)
    return { rows: [...rows.slice(0, SCRIPT_ROWS - 1), { type: 'fold', label: `${hidden} more lines` }], folded: true }
  }
  return { rows, folded }
}

// ---------------------------------------------------------------------------
// Output

/** Output rows: all, else its head (or, when the call failed, its tail) and a fold. */
function outputRows(count: number, full: boolean, tail: boolean): { rows: Row[]; folded: boolean } {
  const all: Row[] = Array.from({ length: count }, (_, n) => ({ type: 'line', n }))
  if (full || count <= OUTPUT_ROWS + 2) return { rows: all, folded: false }
  const fold: Row = { type: 'fold', label: `${count - OUTPUT_ROWS} ${tail ? 'earlier' : 'more'} lines` }
  return tail ? { rows: [fold, ...all.slice(-OUTPUT_ROWS)], folded: true } : { rows: [...all.slice(0, OUTPUT_ROWS), fold], folded: true }
}

function Output({ text, stderr, full, tail, onFull }: { text: string; stderr?: boolean; full: boolean; tail: boolean; onFull: () => void }) {
  const lines = useMemo(() => (stderr ? linesOf(text).map((l): Token[] => (l ? [[l, '']] : [])) : highlightOutput(text.replace(/\n$/, ''))), [text, stderr])
  const { rows } = outputRows(lines.length, full, tail)
  return (
    <div className={cn('border-t', stderr && 'bg-destructive/[0.04] text-destructive dark:bg-destructive/[0.08]')}>
      {stderr && <div className="px-3 pt-1.5 font-sans text-[10px] font-medium tracking-wide text-destructive/80 uppercase">stderr</div>}
      <Lines lines={lines} rows={rows} gutter="none" onFold={onFull} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// The card

function CopyButton({ text }: { text: string }) {
  const { t } = useI18n()
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      aria-label={t('Copy the script')}
      title={t('Copy')}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setDone(true)
          setTimeout(() => setDone(false), 1500)
        })
      }}
      className="flex size-6 items-center justify-center rounded-md text-faint outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
    >
      {done ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
    </button>
  )
}

/** What the script is: SDK, CLI or bash, else the tool. */
function labelOf(view?: StepView) {
  if (view && view.tool !== 'bash') return view.tool.replaceAll('_', ' ')
  const forms = new Set(view?.segments.map((s) => s.form))
  return forms.has('sdk') ? 'node · sdk' : forms.has('cli') ? 'cli' : 'bash'
}

interface StepBlockProps {
  view?: StepView
  result?: StepResult
  /** Everything shown: setup lines and all output. Kept by the conversation, so it outlives scrolling. */
  full: boolean
  onFull: () => void
}

/** One call: its script, the LayerFS calls marked on their lines, and its output, in one card. */
export const StepBlock = memo(function StepBlock({ view, result, full, onFull }: StepBlockProps) {
  const text = view?.text ?? ''
  const bash = !view || view.tool === 'bash'
  const source = useMemo(() => linesOf(text), [text])
  const lines = useMemo(() => highlight(text.replace(/\n$/, ''), bash ? 'bash' : 'text'), [text, bash])
  const { marks, extra } = useMemo(() => marksOf(view, result?.calls ?? []), [view, result?.calls])
  const sdk = !!view?.segments.some((s) => s.form === 'sdk')
  const script = scriptRows(source, marks, full, sdk)
  const short = source.length < 3 && bash && !sdk

  const stdout = result?.stdout?.trim() ? result.stdout : ''
  const stderr = result?.stderr?.trim() ? result.stderr : ''
  const answer = result?.output?.trim() ? result.output : ''
  const failed = result?.state === 'failed' || (result?.exitCode ?? 0) !== 0
  const outLines = [stdout, answer, stderr].reduce((n, t) => n + (t ? linesOf(t).length : 0), 0)
  const cuts = scriptRows(source, marks, false, sdk).folded || [stdout, answer, stderr].some((t) => t && outputRows(linesOf(t).length, false, false).folded)
  const exit = result?.exitCode
  const footer = result && (exit != null || extra.length > 0 || result.truncated || (full && cuts))

  return (
    <div className="group/card relative overflow-hidden rounded-xl border border-foreground/[0.08] bg-background/65 font-mono text-[12.5px] leading-[1.65] shadow-2xs backdrop-blur-xs">
      {text.trim() && (
        <>
          <div className="absolute top-1.5 right-2 z-10 flex items-center gap-1 rounded-lg bg-card/90 px-1.5 py-0.5 opacity-0 shadow-2xs ring-1 ring-foreground/[0.06] backdrop-blur-xs transition-opacity group-hover/card:opacity-100 focus-within:opacity-100">
            <span className="font-sans text-[10px] font-medium tracking-wider text-faint uppercase select-none">{labelOf(view)}</span>
            <CopyButton text={text} />
          </div>
          <Lines lines={lines} rows={script.rows} gutter={short ? 'prompt' : bash ? 'numbers' : 'none'} marks={marks} onFold={onFull} source={source} />
        </>
      )}
      {stdout && <Output text={stdout} full={full} tail={failed} onFull={onFull} />}
      {answer && <Output text={answer} full={full} tail={false} onFull={onFull} />}
      {stderr && <Output text={stderr} stderr full={full} tail onFull={onFull} />}
      {footer && (
        <div className="flex min-h-7 flex-wrap items-center gap-x-3 gap-y-1 border-t border-foreground/[0.06] bg-foreground/[0.02] px-3 py-1 font-sans text-[11px] text-faint">
          {exit != null && (
            <span className={cn('font-mono', exit !== 0 && 'rounded-md bg-destructive/10 px-1.5 py-0.5 font-medium text-destructive')}>exit {exit}</span>
          )}
          {outLines === 0 && exit != null && <span>no output</span>}
          {extra.length > 0 && (
            <span className="flex min-w-0 flex-wrap items-center gap-x-2">
              <span>also</span>
              {byMethod(extra).map(([method, calls]) => (
                <span key={method} title={calls.map(callTitle).join('\n\n')} className={cn('font-mono', calls.some((c) => c.ok === false) && 'text-destructive')}>
                  {method}
                  {calls.length > 1 && <span className="font-sans"> ×{calls.length}</span>}
                </span>
              ))}
            </span>
          )}
          {result.truncated && (
            <span title="The host kept only the first part of this output" className="flex items-center gap-1 text-warning">
              <Scissors aria-hidden="true" className="size-3" /> output cut by the host
            </span>
          )}
          {full && cuts && (
            <button type="button" onClick={onFull} className="ml-auto text-muted-foreground outline-none hover:text-foreground focus-visible:underline">
              Fold again
            </button>
          )}
        </div>
      )}
    </div>
  )
})

// ---------------------------------------------------------------------------
// Messages

const FENCE_LANG: Record<string, Lang> = { sh: 'bash', bash: 'bash', shell: 'bash', zsh: 'bash', js: 'js', javascript: 'js', ts: 'ts', typescript: 'ts', tsx: 'tsx', jsx: 'tsx', json: 'json', md: 'md' }

/** A fenced block in a message: highlighted, no gutter. */
function FencedCode({ text, lang }: { text: string; lang: string }) {
  const lines = useMemo(() => highlight(text, FENCE_LANG[lang] ?? 'text'), [text, lang])
  return (
    <div className="my-1 overflow-hidden rounded-xl border border-foreground/[0.08] bg-background/65 font-mono text-[12.5px] leading-[1.65] shadow-2xs backdrop-blur-xs">
      <Lines lines={lines} rows={lines.map((_, n) => ({ type: 'line', n }))} gutter="none" />
    </div>
  )
}

const CODE = 'rounded-md bg-foreground/[0.055] px-1.5 py-0.5 font-mono text-[0.85em] text-foreground/90'

function Inlines({ items }: { items: Inline[] }) {
  return items.map((x, k) => {
    switch (x.t) {
      case 'text':
        return <Fragment key={k}>{x.s}</Fragment>
      case 'code':
        return <code key={k} className={CODE}>{x.s}</code>
      case 'strong':
        return <strong key={k} className="font-semibold">{x.s}</strong>
      case 'em':
        return <em key={k}>{x.s}</em>
      case 'link':
        return (
          <a key={k} href={x.href} target="_blank" rel="noreferrer" className="text-primary underline-offset-2 hover:underline">
            {x.s}
          </a>
        )
    }
  })
}

/** One line of text with its calls and paths as code: a row title, a folded preview. */
export function InlineText({ text }: { text: string }) {
  const items = useMemo(() => inline(text), [text])
  return <Inlines items={items} />
}

/** An agent's or the user's words: paragraphs, lists, code. `tail` ends the last paragraph (a streaming cursor). */
export function Markdown({ text, tail, className }: { text: string; tail?: React.ReactNode; className?: string }) {
  const parts = useMemo(() => blocks(text), [text])
  const last = parts.length - 1
  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {parts.map((b, k) => {
        const end = k === last ? tail : null
        switch (b.t) {
          case 'h': {
            const Tag = b.level === 1 ? 'h3' : b.level === 2 ? 'h4' : 'h5'
            return (
              <Tag
                key={k}
                className={cn(
                  'font-semibold tracking-tight text-foreground',
                  b.level === 1 ? 'text-[16px] leading-6' : b.level === 2 ? 'text-[15px] leading-5' : 'text-[14px] leading-5',
                )}
              >
                <Inlines items={b.inl} />
                {end}
              </Tag>
            )
          }
          case 'p':
            return (
              <p key={k} className="whitespace-pre-wrap">
                <Inlines items={b.inl} />
                {end}
              </p>
            )
          case 'list': {
            const List = b.ordered ? 'ol' : 'ul'
            return (
              <List key={k} className={cn('flex flex-col gap-1 pl-5 marker:text-faint', b.ordered ? 'list-decimal' : 'list-disc')}>
                {b.items.map((item, i) => (
                  <li key={i}>
                    <Inlines items={item} />
                    {i === b.items.length - 1 && end}
                  </li>
                ))}
              </List>
            )
          }
          case 'code':
            return <FencedCode key={k} text={b.text} lang={b.lang} />
        }
      })}
      {parts.length === 0 && tail}
    </div>
  )
}
