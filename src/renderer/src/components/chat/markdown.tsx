// An agent's or the user's words as light Markdown (paragraphs, headings,
// lists, fenced code), the agent's words streamed in as they arrive, and the
// line that shows while it thinks.
import { LoaderCircle } from 'lucide-react'
import { Fragment, useEffect, useMemo, useState } from 'react'

import { type Lang, type Token, highlight } from '@/lib/highlight'
import { type Inline, blocks } from '@/lib/markdown'
import { cn } from '@/lib/utils'
import { useI18n } from '@/i18n'

const FENCE_LANG: Record<string, Lang> = { sh: 'bash', bash: 'bash', shell: 'bash', zsh: 'bash', js: 'js', javascript: 'js', ts: 'ts', typescript: 'ts', tsx: 'tsx', jsx: 'tsx', json: 'json', md: 'md' }

/** A fenced block in a message: highlighted, no gutter. */
function FencedCode({ text, lang }: { text: string; lang: string }) {
  const lines = useMemo(() => highlight(text, FENCE_LANG[lang] ?? 'text'), [text, lang])
  return (
    <div className="my-1 overflow-hidden rounded-xl border border-foreground/[0.08] bg-background/65 font-mono text-[12.5px] leading-[1.65] shadow-2xs backdrop-blur-xs">
      <div className="overflow-x-auto">
        <div className="w-max min-w-full py-1.5">
          {lines.map((tokens: Token[], n) => (
            <div key={n} className="flex pr-4">
              <span className="whitespace-pre pl-3">
                {tokens.map(([text, cls], k) => <span key={k} className={cls || undefined}>{text}</span>)}
              </span>
            </div>
          ))}
        </div>
      </div>
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

/** Words shown per tick and the tick: about 20 words a second, a model's pace. */
const STREAM_TOKENS = 2
const STREAM_MS = 45

const Cursor = () => <span aria-hidden="true" className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[2px] animate-pulse bg-foreground/60" />

/**
 * `text` as Markdown, streamed word by word when `stream` is true as it
 * mounts (text that arrived while the reader watched); whole otherwise. A
 * later change of `stream` does not restart or cut it.
 */
function Streamed({ text, stream, className }: { text: string; stream?: boolean; className?: string }) {
  const [animate] = useState(!!stream)
  const tokens = animate ? text.split(/(\s+)/) : []
  const [shown, setShown] = useState(0)
  const done = !animate || shown >= tokens.length
  useEffect(() => {
    if (done) return
    const t = setInterval(() => setShown((n) => n + STREAM_TOKENS), STREAM_MS)
    return () => clearInterval(t)
  }, [done])
  if (done) return <Markdown text={text} className={className} />
  return <Markdown text={tokens.slice(0, shown).join('')} tail={<Cursor />} className={className} />
}

/** Plain text the agent says before its calls. */
export function SayText({ text, stream }: { text: string; stream?: boolean }) {
  return <Streamed text={text} stream={stream} className="px-1 text-[14.5px] leading-relaxed text-foreground/90" />
}

/** The agent between steps: a model thinking. */
export function ThinkingLine() {
  const { t } = useI18n()
  return (
    <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
      <LoaderCircle aria-label={t('Running')} className="size-3.5 shrink-0 animate-spin text-primary" />
      <span className="animate-pulse">{t('Thinking…')}</span>
    </p>
  )
}
