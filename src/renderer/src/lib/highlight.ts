// Static syntax highlighting for the small read-only blocks of a conversation:
// no EditorView, no DOM. highlight(text, lang) gives one token list per line
// ('\n'-separated), each token [text, className]; a line's tokens join back
// to the line exactly, so a view can number and mark lines.
//
// Bash is a small hand-written lexer: it knows command position (`layerfs`,
// `jq`, `node` read as commands, and `layerfs workspace exec` as one), flags,
// quotes with $vars inside, $( … ), operators and comments, and it hands each
// heredoc body to its own language (node → js, `fs write x.tsx` → tsx, …).
// The other languages go through their Lezer parsers, already in the bundle.
// `node -e '…'` bodies read as js too.
//
// LayerFS operations stand out in every language: `lf.branch.fork(` in a
// script and `layerfs branch fork` in a command take the C.lfs mark (the
// operation's words; the receiver and `layerfs` keep their colours).

import { javascriptLanguage, tsxLanguage, typescriptLanguage } from '@codemirror/lang-javascript'
import { jsonLanguage } from '@codemirror/lang-json'
import { markdownLanguage } from '@codemirror/lang-markdown'
import { highlightCode, tagHighlighter, tags as t } from '@lezer/highlight'

/** Any Lezer parser (@lezer/common is not a direct dependency, so typed structurally). */
type Parser = { parse(input: string): Parameters<typeof highlightCode>[1] }

export type Token = [text: string, cls: string]
export type Lang = 'bash' | 'js' | 'ts' | 'tsx' | 'json' | 'md' | 'text'
/** A line-aligned slice of a bash command: [from, to) lines in one language. */
type Region = { lang: Lang; from: number; to: number }

/** Past this many characters a block (or heredoc body) is left plain. */
const MAX = 50_000

// Literal class names (Tailwind sees them); colours are the --hl-* tokens of styles.css.
const C = {
  keyword: 'text-(--hl-keyword)',
  string: 'text-(--hl-string)',
  number: 'text-(--hl-number)',
  comment: 'text-(--hl-comment) italic',
  fn: 'text-(--hl-function)',
  type: 'text-(--hl-type)',
  prop: 'text-(--hl-property)',
  variable: 'text-(--hl-type)',
  lfs: 'font-semibold text-(--lfs-dark) bg-(--lfs-dark)/10',
} as const

/** The SDK's call groups (`lf.<group>.<method>(`, `layerfs <group> <method>`). */
const GROUPS = 'project|branch|fs|workspace|sandbox|process|inspect|history'
const JS_OP = new RegExp(`(?<=\\.)(?:${GROUPS})\\.[a-z_]+(?=\\s*\\()|\\bLayerFS\\.open(?=\\s*\\()`, 'g')
const BASH_OP = new RegExp(`(?<=\\blayerfs[ \\t]+)(?:${GROUPS})[ \\t]+[a-z][\\w-]*`, 'g')

/** Gives the parts of each line that `re` matches the C.lfs mark, splitting tokens at the edges. */
function markOps(lines: Token[][], re: RegExp): Token[][] {
  return lines.map((tokens) => {
    const text = tokens.map((t) => t[0]).join('')
    const spans = [...text.matchAll(re)].map((m) => [m.index, m.index + m[0].length] as const)
    if (!spans.length) return tokens
    const out: Token[] = []
    let at = 0
    for (const [part, cls] of tokens) {
      let from = 0
      while (from < part.length) {
        const pos = at + from
        const span = spans.find(([a, b]) => pos < b && pos + (part.length - from) > a)
        if (!span) {
          out.push([part.slice(from), cls])
          break
        }
        const [a, b] = span
        if (pos < a) {
          out.push([part.slice(from, a - at), cls])
          from = a - at
          continue
        }
        const end = Math.min(part.length, b - at)
        const last = out[out.length - 1]
        // one operation spans several tokens (`branch` `.` `fork`): one span
        if (last?.[1] === C.lfs && pos > a) last[0] += part.slice(from, end)
        else out.push([part.slice(from, end), C.lfs])
        from = end
      }
      at += part.length
    }
    return out
  })
}

const classes = tagHighlighter([
  { tag: [t.comment, t.lineComment, t.blockComment], class: C.comment },
  { tag: [t.keyword, t.controlKeyword, t.operatorKeyword, t.definitionKeyword, t.moduleKeyword], class: C.keyword },
  { tag: [t.string, t.special(t.string), t.regexp], class: C.string },
  { tag: [t.number, t.bool, t.null, t.atom], class: C.number },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName], class: C.fn },
  { tag: [t.typeName, t.className, t.tagName, t.angleBracket], class: C.type },
  { tag: [t.propertyName, t.attributeName], class: C.prop },
  { tag: [t.heading, t.strong], class: C.keyword },
  { tag: [t.link, t.url], class: C.fn },
  { tag: [t.emphasis], class: C.comment },
  { tag: [t.monospace], class: C.string },
])

const parsers: Partial<Record<Lang, Parser>> = {
  js: javascriptLanguage.parser,
  ts: typescriptLanguage.parser,
  tsx: tsxLanguage.parser,
  json: jsonLanguage.parser,
  md: markdownLanguage.parser,
}

const plain = (text: string): Token[][] => text.split('\n').map((l) => (l ? [[l, '']] : []))

function lezer(text: string, parser: Parser): Token[][] {
  const lines: Token[][] = [[]]
  highlightCode(
    text,
    parser.parse(text),
    classes,
    (s, cls) => lines[lines.length - 1].push([s, cls]),
    () => lines.push([]),
  )
  return lines
}


// Rows remount as the conversation scrolls; a small cache keeps that free.
const cache = new Map<string, Token[][]>()

function cached(key: string, make: () => Token[][]): Token[][] {
  let hit = cache.get(key)
  if (hit) {
    cache.delete(key)
    cache.set(key, hit)
    return hit
  }
  hit = make()
  cache.set(key, hit)
  if (cache.size > 400) cache.delete(cache.keys().next().value!)
  return hit
}

/** Lines of tokens for `text` in `lang`. Bash includes its heredoc bodies in their own language. */
export function highlight(text: string, lang: Lang): Token[][] {
  return cached(`${lang}\0${text}`, () => highlightNow(text, lang))
}

function highlightNow(text: string, lang: Lang): Token[][] {
  if (text.length > MAX || lang === 'text') return plain(text)
  if (lang === 'bash') return markOps(highlightBash(text), BASH_OP)
  const p = parsers[lang]
  if (!p) return plain(text)
  return lang === 'js' || lang === 'ts' || lang === 'tsx' ? markOps(lezer(text, p), JS_OP) : lezer(text, p)
}

// ---------------------------------------------------------------------------
// Bash: a small hand-written lexer. It knows command position (so `layerfs`, `jq`,
// `node` read as commands), flags, quotes with $vars inside, $(…), {{placeholders}},
// operators and comments, and it finds heredocs so their bodies can be handed to
// the right parser.

const KEYWORDS = new Set(
  'if then else elif fi for while until do done case esac in function select time ! { } [[ ]] return export local readonly declare unset'.split(' '),
)
/** Keywords after which the next word is a value, not a command. */
const KEYWORD_ARGS = new Set('for case in function select export local readonly declare unset return'.split(' '))
/** CLIs whose next N bare words are sub-commands (`layerfs workspace exec`). */
const SUBCOMMANDS: Record<string, number> = { layerfs: 2, git: 1, npm: 1, pnpm: 1, docker: 2, gh: 2 }

type Heredoc = { delim: string; strip: boolean; lang: Lang }
type Lexed = { tokens: Token[]; bodies: Region[] }

function heredocLang(words: string[]): Lang {
  const w = words.filter((x) => !/^[A-Za-z_]\w*=/.test(x)) // drop env assignments
  if (w.some((x) => /^(node|bun|deno)$/.test(x))) return 'js'
  if (w.some((x) => /^(tsx|ts-node)$/.test(x))) return 'ts'
  if (w[0] === 'read' || w.some((x) => /^(bash|sh|zsh)$/.test(x))) return 'bash'
  if (w[0] === 'cat' || w[0] === 'tee' || (w[0] === 'layerfs' && w[1] === 'fs')) {
    const file = [...w].reverse().find((x) => /\.\w+$/.test(x))
    const ext = file?.match(/\.(\w+)$/)?.[1]
    if (ext === 'json') return 'json'
    if (ext === 'md') return 'md'
    if (ext === 'tsx' || ext === 'jsx') return 'tsx'
    if (ext === 'ts' || ext === 'mts') return 'ts'
    if (ext === 'js' || ext === 'mjs' || ext === 'cjs') return 'js'
    if (ext === 'sh') return 'bash'
  }
  return 'text'
}

function lexBash(src: string): Lexed {
  const tokens: Token[] = []
  const bodies: Region[] = []
  const total = countNl(src, 0, src.length) + 1
  const emit = (s: string, cls = '') => {
    if (!s) return
    const last = tokens[tokens.length - 1]
    if (last && last[1] === cls) last[0] += s
    else tokens.push([s, cls])
  }
  let i = 0
  let line = 0
  let cmdPos = true // the next word is a command
  let sub = 0 // sub-command words still to colour
  let words: string[] = [] // words of the current simple command (for heredoc language)
  let pending: Heredoc[] = []
  let parens = 0 // open $( … )
  const n = src.length

  const newCommand = () => {
    cmdPos = true
    sub = 0
    words = []
  }

  // A double-quoted string: string-coloured, with $var / ${…} / $(…) as variables.
  const dquote = () => {
    let j = i + 1
    let start = i
    while (j < n && src[j] !== '"') {
      if (src[j] === '\\') j += 2
      else if (src[j] === '$' || (src[j] === '{' && src[j + 1] === '{')) {
        const m = /^(\$(\{[^}]*\}|\([^)]*\)|[A-Za-z_]\w*|[0-9@#?$!*-])|\{\{[\w.-]+\}\})/.exec(src.slice(j, j + 200))
        if (m) {
          emit(src.slice(start, j), C.string)
          emit(m[0], C.variable)
          j += m[0].length
          start = j
        } else j++
      } else j++
    }
    j = Math.min(j + 1, n)
    emit(src.slice(start, j), C.string)
    line += countNl(src, i, j)
    i = j
  }

  while (i < n) {
    const c = src[i]

    if (c === '\n') {
      emit('\n')
      line++
      i++
      newCommand()
      // Heredoc bodies start on the line after their `<<`.
      for (const h of pending) {
        const bodyStart = line
        while (i < n) {
          const end = src.indexOf('\n', i)
          const text = src.slice(i, end < 0 ? n : end)
          if ((h.strip ? text.replace(/^\t+/, '') : text) === h.delim) break
          i = end < 0 ? n : end + 1
          line++
        }
        const to = Math.min(line, total)
        if (to > bodyStart) {
          bodies.push({ lang: h.lang, from: bodyStart, to })
          tokens.push(['\u0000', String(bodies.length - 1)]) // marker, replaced by highlightBash
        }
        if (i < n) {
          // the terminator line
          const end = src.indexOf('\n', i)
          emit(src.slice(i, end < 0 ? n : end), C.comment)
          i = end < 0 ? n : end
        }
      }
      pending = []
      continue
    }
    if (c === ' ' || c === '\t') {
      let j = i
      while (j < n && (src[j] === ' ' || src[j] === '\t')) j++
      emit(src.slice(i, j))
      i = j
      continue
    }
    if (c === '\\') {
      emit(src.slice(i, i + 2))
      if (src[i + 1] === '\n') line++
      i += 2
      continue
    }
    if (c === '#' && (i === 0 || /[\s;&|(]/.test(src[i - 1]))) {
      const end = src.indexOf('\n', i)
      emit(src.slice(i, end < 0 ? n : end), C.comment)
      i = end < 0 ? n : end
      continue
    }
    if (c === "'" && words.some((x) => /^(node|bun|deno)$/.test(x)) && /^(-e|-p|--eval|--print)$/.test(words[words.length - 1] ?? '')) {
      // a script in one quote: no '…' inside it, so the quote ends the script
      let j = src.indexOf("'", i + 1)
      j = j < 0 ? n : j
      emit("'", C.string)
      const body = src.slice(i + 1, j)
      const lang: Lang = words.some((x) => /^--input-type=module$/.test(x)) || /\b(import|await)\b/.test(body) ? 'js' : 'js'
      if (body.length <= MAX) for (const [k, l] of highlightNow(body, lang).entries()) for (const tok of k ? [['\n', ''] as Token, ...l] : l) emit(tok[0], tok[1])
      else emit(body, C.string)
      if (j < n) emit("'", C.string)
      line += countNl(src, i, j + 1)
      words.push(body)
      cmdPos = false
      i = Math.min(j + 1, n)
      continue
    }
    if (c === "'" || (c === '$' && src[i + 1] === "'")) {
      let j = src.indexOf("'", i + (c === '$' ? 2 : 1))
      if (c === '$') while (j > 0 && src[j - 1] === '\\') j = src.indexOf("'", j + 1)
      j = j < 0 ? n : j + 1
      emit(src.slice(i, j), C.string)
      line += countNl(src, i, j)
      words.push(src.slice(i + 1, j - 1))
      cmdPos = false
      i = j
      continue
    }
    if (c === '"') {
      const from = i
      dquote()
      words.push(src.slice(from + 1, i - 1))
      cmdPos = false
      continue
    }
    if (c === '`') {
      let j = src.indexOf('`', i + 1)
      j = j < 0 ? n : j + 1
      emit(src.slice(i, j), C.variable)
      line += countNl(src, i, j)
      i = j
      continue
    }
    if (c === '$') {
      if (src[i + 1] === '(') {
        emit('$(', C.variable)
        parens++
        i += 2
        newCommand()
        continue
      }
      const m = /^\$(\{[^}\n]*\}|[A-Za-z_]\w*|[0-9@#?$!*-])/.exec(src.slice(i, i + 200))
      if (m) {
        emit(m[0], C.variable)
        words.push(m[0])
        cmdPos = false
        i += m[0].length
        continue
      }
    }
    if (c === '{' && src[i + 1] === '{') {
      const end = src.indexOf('}}', i)
      if (end > 0 && end - i < 60 && !src.slice(i, end).includes('\n')) {
        emit(src.slice(i, end + 2), C.variable)
        words.push(src.slice(i, end + 2))
        cmdPos = false
        i = end + 2
        continue
      }
    }
    if (c === ')' && parens > 0) {
      emit(')', C.variable)
      parens--
      cmdPos = false
      i++
      continue
    }
    // heredoc: << or <<- then a (possibly quoted) delimiter; <<< is a here-string
    if (c === '<' && src[i + 1] === '<' && src[i + 2] !== '<') {
      const m = /^<<(-?)[ \t]*(?:'([^'\n]+)'|"([^"\n]+)"|\\?([A-Za-z_][\w-]*))/.exec(src.slice(i, i + 200))
      if (m) {
        emit('<<' + m[1], C.keyword)
        emit(m[0].slice(2 + m[1].length), C.comment)
        pending.push({ delim: m[2] ?? m[3] ?? m[4], strip: m[1] === '-', lang: heredocLang(words) })
        i += m[0].length
        continue
      }
    }
    // operators and redirections
    const op = /^(&&|\|\||;;|\|&|[|;&()]|\d*>>?&?\d*|&>>?|<<<|<&?\d*|<)/.exec(src.slice(i, i + 6))
    if (op) {
      emit(op[0], C.keyword)
      if (/^(&&|\|\||;;|\|&|[|;&(])$/.test(op[0])) newCommand()
      i += op[0].length
      continue
    }
    // a word
    let j = i
    while (j < n && !/[\s|&;()<>'"`$\\]/.test(src[j])) j++
    if (j === i) {
      emit(c)
      i++
      continue
    }
    const w = src.slice(i, j)
    const assign = /^[A-Za-z_]\w*\+?=/.exec(w)
    if (cmdPos && assign) {
      // NAME=value before (or instead of) a command
      emit(assign[0].replace(/\+?=$/, ''), C.variable)
      emit(assign[0].slice(assign[0].replace(/\+?=$/, '').length))
      i += assign[0].length
      words.push(w)
      continue
    }
    words.push(w)
    if (cmdPos && KEYWORDS.has(w)) {
      emit(w, C.keyword)
      if (KEYWORD_ARGS.has(w)) cmdPos = false
    } else if (cmdPos) {
      emit(w, C.fn)
      cmdPos = false
      sub = SUBCOMMANDS[w] ?? 0
    } else if (w[0] === '-') {
      const eq = w.indexOf('=')
      emit(eq > 0 ? w.slice(0, eq) : w, C.prop)
      if (eq > 0) emit(w.slice(eq))
      sub = 0
    } else if (sub > 0 && /^[a-z][\w-]*$/.test(w)) {
      emit(w, C.fn)
      sub--
    } else {
      sub = 0
      emit(w, /^\d+(\.\d+)?$/.test(w) ? C.number : '')
    }
    i = j
  }
  return { tokens, bodies }
}

function countNl(s: string, from: number, to: number) {
  let k = 0
  for (let x = from; x < to; x++) if (s.charCodeAt(x) === 10) k++
  return k
}

/** Split a flat token stream into lines. */
function toLines(tokens: Token[]): Token[][] {
  const lines: Token[][] = [[]]
  for (const [text, cls] of tokens) {
    const parts = text.split('\n')
    parts.forEach((p, k) => {
      if (k > 0) lines.push([])
      if (p) lines[lines.length - 1].push([p, cls])
    })
  }
  return lines
}

function highlightBash(src: string): Token[][] {
  const { tokens, bodies } = lexBash(src)
  if (!bodies.length) return toLines(tokens)
  const srcLines = src.split('\n')
  const out: Token[][] = []
  let chunk: Token[] = []
  const flush = () => {
    const ls = toLines(chunk)
    if (out.length) out[out.length - 1].push(...ls.shift()!) // continue the open line
    out.push(...ls)
    chunk = []
  }
  for (const tok of tokens) {
    if (tok[0] !== '\u0000') {
      chunk.push(tok)
      continue
    }
    flush() // ends with the empty line the body starts on
    out.pop()
    const r = bodies[Number(tok[1])]
    out.push(...highlightNow(srcLines.slice(r.from, r.to).join('\n'), r.lang), [])
  }
  flush()
  // a body that ran to the end leaves an extra open line
  return out.length > srcLines.length ? out.slice(0, srcLines.length) : out
}

// ---------------------------------------------------------------------------
// Output: deliberately light. Per line: `$ cmd` echoes get bash colours, `[exit N]`
// gets ok/fail, a line that is a JSON object/array gets JSON colours. Everything
// else stays plain (stderr is already tinted by its container).

export function highlightOutput(text: string): Token[][] {
  return cached(`out\0${text}`, () => (text.length > MAX ? plain(text) : outputLines(text)))
}

function outputLines(text: string): Token[][] {
  return text.split('\n').map((l): Token[] => {
    if (l.startsWith('$ ')) return [['$ ', C.comment], ...highlightBash(l.slice(2))[0]]
    const exit = /^\[exit (\d+)\]$/.exec(l)
    if (exit) return [[l, exit[1] === '0' ? 'text-faint' : 'text-destructive']]
    if (/^[[{].*[\]}]$/.test(l) && l.length < 5000) return lezer(l, jsonLanguage.parser)[0]
    return l ? [[l, '']] : []
  })
}
