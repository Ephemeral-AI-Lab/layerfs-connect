// A reply's Markdown as React elements (no HTML strings), safe while it is
// still streaming: marked's lexer copes with half-written blocks. Code blocks
// get a copy button; links open only for http(s) and mailto.
import { decodeHTML } from 'entities'
import { Check, Copy } from 'lucide-react'
import { marked, type Token, type Tokens } from 'marked'
import { Fragment, type ReactNode, useMemo, useState } from 'react'

const decode = (text: string) => decodeHTML(text)

function CodeBlock({ text, lang }: { text: string; lang?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="md-code">
      <div className="md-code-head">
        <span>{lang?.split(/\s+/)[0] || 'code'}</span>
        <button
          type="button"
          onClick={() =>
            void navigator.clipboard.writeText(text).then(() => {
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            })
          }
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre>
        <code>{text}</code>
      </pre>
    </div>
  )
}

function Inline({ tokens }: { tokens?: Token[] }): ReactNode {
  if (!tokens) return null
  return tokens.map((token, i) => {
    switch (token.type) {
      case 'strong':
        return <strong key={i}><Inline tokens={(token as Tokens.Strong).tokens} /></strong>
      case 'em':
        return <em key={i}><Inline tokens={(token as Tokens.Em).tokens} /></em>
      case 'del':
        return <del key={i}><Inline tokens={(token as Tokens.Del).tokens} /></del>
      case 'codespan':
        return <code key={i} className="md-inline-code">{decode((token as Tokens.Codespan).text)}</code>
      case 'br':
        return <br key={i} />
      case 'link': {
        const link = token as Tokens.Link
        const href = /^(https?:\/\/|mailto:)/i.test(link.href) ? link.href : undefined
        return href ? (
          <a key={i} href={href} target="_blank" rel="noreferrer">
            <Inline tokens={link.tokens} />
          </a>
        ) : (
          <Fragment key={i}><Inline tokens={link.tokens} /></Fragment>
        )
      }
      case 'text': {
        const text = token as Tokens.Text
        return text.tokens ? <Inline key={i} tokens={text.tokens} /> : <Fragment key={i}>{decode(text.text)}</Fragment>
      }
      default:
        return <Fragment key={i}>{decode((token as { raw: string }).raw)}</Fragment>
    }
  })
}

function Blocks({ tokens }: { tokens: Token[] }): ReactNode {
  return tokens.map((token, i) => {
    switch (token.type) {
      case 'space':
      case 'def':
        return null
      case 'heading': {
        const h = token as Tokens.Heading
        const Tag = `h${Math.min(h.depth + 1, 6)}` as 'h2'
        return <Tag key={i}><Inline tokens={h.tokens} /></Tag>
      }
      case 'paragraph':
        return <p key={i}><Inline tokens={(token as Tokens.Paragraph).tokens} /></p>
      case 'code': {
        const code = token as Tokens.Code
        return <CodeBlock key={i} text={code.text} lang={code.lang} />
      }
      case 'blockquote':
        return <blockquote key={i}><Blocks tokens={(token as Tokens.Blockquote).tokens} /></blockquote>
      case 'hr':
        return <hr key={i} />
      case 'list': {
        const list = token as Tokens.List
        const List = list.ordered ? 'ol' : 'ul'
        return (
          <List key={i}>
            {list.items.map((item, k) => (
              <li key={k}>
                <Blocks tokens={item.tokens} />
              </li>
            ))}
          </List>
        )
      }
      case 'table': {
        const table = token as Tokens.Table
        return (
          <div key={i} className="md-table">
            <table>
              <thead>
                <tr>{table.header.map((cell, k) => <th key={k}><Inline tokens={cell.tokens} /></th>)}</tr>
              </thead>
              <tbody>
                {table.rows.map((row, r) => (
                  <tr key={r}>{row.map((cell, k) => <td key={k}><Inline tokens={cell.tokens} /></td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      }
      case 'text': {
        const text = token as Tokens.Text
        return text.tokens ? <p key={i}><Inline tokens={text.tokens} /></p> : <p key={i}>{decode(text.text)}</p>
      }
      default:
        return <p key={i}>{decode((token as { raw: string }).raw)}</p>
    }
  })
}

export function Markdown({ text, live }: { text: string; live?: boolean }) {
  const tokens = useMemo(() => marked.lexer(text, { gfm: true }), [text])
  return (
    <div className="md">
      <Blocks tokens={tokens} />
      {live && <span aria-hidden="true" className="md-caret" />}
    </div>
  )
}
