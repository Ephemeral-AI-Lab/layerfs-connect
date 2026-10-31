// Render Markdown as React elements, including during streaming.
import { Check, Copy, LoaderCircle } from 'lucide-react'
import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react'

import { type Lang, highlight } from '@/lib/highlight'
import { type Token, type MarkedToken, blocks, decodeText } from '@/lib/markdown'
import { cn } from '@/lib/utils'
import { useI18n } from '@/i18n'
import './markdown.css'

const FENCE_LANG: Record<string, Lang> = { sh: 'bash', bash: 'bash', shell: 'bash', zsh: 'bash', js: 'js', javascript: 'js', mjs: 'js', cjs: 'js', ts: 'ts', typescript: 'ts', tsx: 'tsx', jsx: 'tsx', json: 'json', md: 'md', markdown: 'md' }

/** A fenced block in a message: highlighted, no gutter. */
function FencedCode({ text, lang = '' }: { text: string; lang?: string }) {
  const { t } = useI18n()
  const language = lang.trim().split(/\s+/)[0].toLowerCase()
  const lines = useMemo(() => highlight(text, FENCE_LANG[language] ?? 'text'), [text, language])
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle')
  useEffect(() => {
    if (copyState === 'idle') return
    const timer = setTimeout(() => setCopyState('idle'), 1800)
    return () => clearTimeout(timer)
  }, [copyState])
  const copyLabel = t(copyState === 'copied' ? 'Copied' : copyState === 'error' ? 'Could not copy code' : 'Copy code')
  return (
    <div className="chat-md-code">
      <div className="chat-md-code-header">
        <span className="min-w-0 truncate">{language || t('Code')}</span>
        <button type="button" className="chat-md-copy" aria-label={copyLabel} title={copyLabel} onClick={() => {
          void navigator.clipboard.writeText(text).then(() => setCopyState('copied'), () => setCopyState('error'))
        }}>
          {copyState === 'copied' ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          <span aria-live="polite">{copyLabel}</span>
        </button>
      </div>
      <pre tabIndex={0} aria-label={language || t('Code')}><code>{lines.map((tokens, n) => <Fragment key={n}>
        {n > 0 && '\n'}
        {tokens.map(([text, cls], k) => <span key={k} className={cls || undefined}>{text}</span>)}
      </Fragment>)}</code></pre>
    </div>
  )
}

function linkHref(value: string) {
  const href = decodeText(value).trim()
  return /^(https?:\/\/|mailto:)/i.test(href) ? href : undefined
}

function MarkdownImage({ href, alt, title }: { href: string; alt: string; title?: string | null }) {
  const [failed, setFailed] = useState(false)
  const src = decodeText(href).trim()
  const allowed = /^https:\/\//i.test(src) || /^data:image\/(?:png|jpeg|gif|webp);base64,/i.test(src)
  if (!allowed || failed) return <span>{decodeText(alt)}</span>
  return <img className="chat-md-image" src={src} alt={decodeText(alt)} title={title ? decodeText(title) : undefined} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
}

function MarkdownTokens({ tokens, tail }: { tokens: Token[]; tail?: ReactNode }) {
  const visible = tokens.filter((token) => token.type !== 'space' && token.type !== 'def')
  if (!visible.length) return tail
  return visible.map((raw, index) => {
    const token = raw as MarkedToken
    const end = index === visible.length - 1 ? tail : null
    switch (token.type) {
      case 'heading': {
        const Heading = `h${token.depth}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'
        return <Heading key={index}><MarkdownTokens tokens={token.tokens} />{end}</Heading>
      }
      case 'paragraph': return <p key={index}><MarkdownTokens tokens={token.tokens} />{end}</p>
      case 'text': return <Fragment key={index}>{token.tokens ? <MarkdownTokens tokens={token.tokens} /> : decodeText(token.text)}{end}</Fragment>
      case 'escape': return <Fragment key={index}>{decodeText(token.text)}{end}</Fragment>
      case 'strong': return <strong key={index}><MarkdownTokens tokens={token.tokens} />{end}</strong>
      case 'em': return <em key={index}><MarkdownTokens tokens={token.tokens} />{end}</em>
      case 'del': return <del key={index}><MarkdownTokens tokens={token.tokens} />{end}</del>
      case 'codespan': return <code key={index} className="chat-md-inline-code">{token.text}{end}</code>
      case 'br': return <Fragment key={index}><br />{end}</Fragment>
      case 'hr': return <Fragment key={index}><hr />{end}</Fragment>
      case 'blockquote': return <blockquote key={index}><MarkdownTokens tokens={token.tokens} tail={end} /></blockquote>
      case 'code': return <Fragment key={index}><FencedCode text={token.text} lang={token.lang} />{end}</Fragment>
      case 'list': {
        const List = token.ordered ? 'ol' : 'ul'
        return <List key={index} start={token.ordered ? Number(token.start) : undefined}>
          {token.items.map((item, i) => <li key={i} className={item.task ? 'chat-md-task' : undefined}>
            {item.task && <input type="checkbox" checked={!!item.checked} disabled aria-label={item.text} />}
            <MarkdownTokens tokens={item.tokens} tail={i === token.items.length - 1 ? end : null} />
          </li>)}
        </List>
      }
      case 'table': return <div key={index} className="chat-md-table" tabIndex={0}>
        <table>
          <thead><tr>{token.header.map((cell, i) => <th key={i} scope="col" style={{ textAlign: token.align[i] ?? undefined }}><MarkdownTokens tokens={cell.tokens} /></th>)}</tr></thead>
          <tbody>{token.rows.map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j} style={{ textAlign: token.align[j] ?? undefined }}><MarkdownTokens tokens={cell.tokens} /></td>)}</tr>)}</tbody>
        </table>{end}
      </div>
      case 'link': {
        const href = linkHref(token.href)
        const label = <MarkdownTokens tokens={token.tokens} />
        return <Fragment key={index}>{href ? <a href={href} title={token.title ? decodeText(token.title) : undefined} target="_blank" rel="noopener noreferrer">{label}</a> : label}{end}</Fragment>
      }
      case 'image': return <Fragment key={index}><MarkdownImage key={token.href} href={token.href} alt={token.text} title={token.title} />{end}</Fragment>
      // HTML from a response remains text; it never becomes executable markup.
      case 'html': return <Fragment key={index}>{token.text}{end}</Fragment>
      default: return <Fragment key={index}>{token.raw}{end}</Fragment>
    }
  })
}

export function Markdown({ text, tail, className }: { text: string; tail?: ReactNode; className?: string }) {
  const parts = useMemo(() => blocks(text), [text])
  return <div className={cn('chat-markdown', className)}><MarkdownTokens tokens={parts} tail={tail} /></div>
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
