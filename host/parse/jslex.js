// A small JavaScript lexer for agents' inline SDK scripts: identifiers,
// punctuation, strings, template literals (their ${ … } code lexed too),
// numbers, regex literals and comments, each with its 0-based line. It is
// enough to find statements and LayerFS calls; it is not a JS parser.
//   lexJs(src) -> [{ t: id | str | tpl | num | punct | regex | comment, v, line, end, from, to }]
// A template literal is one `tpl` token when it has no ${ }; otherwise the
// tokens are tpl-open, its code between punct '${' and '}$', and tpl-close.

const PUNCT = ['>>>=', '...', '===', '!==', '**=', '<<=', '>>=', '>>>', '&&=', '||=', '??=', '=>', '==', '!=', '<=', '>=', '&&', '||', '??', '?.', '++', '--', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '**', '<<', '>>']
/** After these a `/` starts a regex, not a division. */
const REGEX_AFTER = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^', '=>', '==', '===', '!=', '!==', '&&', '||', '??', '+=', '-=', 'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'await', 'yield'])

export function lexJs(src) {
  const tokens = []
  let i = 0
  let line = 0
  const push = (t, v, from, startLine) => tokens.push({ t, v, line: startLine, end: line, from, to: i })
  const prev = () => {
    for (let k = tokens.length - 1; k >= 0; k--) if (tokens[k].t !== 'comment') return tokens[k]
    return null
  }
  // the brace depth of each open ${ … }, so its closing } is told from a block's
  const holes = []
  let braces = 0

  const template = () => {
    // at a ` or just after a ${ … }'s }: reads text up to ${ or the closing `
    const from = i
    const startLine = line
    let text = ''
    for (;;) {
      if (i >= src.length) return push('tpl', text, from, startLine)
      const c = src[i]
      if (c === '\\') { text += src.slice(i, i + 2); if (src[i + 1] === '\n') line++; i += 2; continue }
      if (c === '`') { i++; return push(tokens.length && tokens.at(-1).v === '}$' ? 'tpl-close' : 'tpl', text, from, startLine) }
      if (c === '$' && src[i + 1] === '{') {
        push(tokens.length && tokens.at(-1).v === '}$' ? 'tpl-mid' : 'tpl-open', text, from, startLine)
        const at = i
        i += 2
        push('punct', '${', at, line)
        holes.push(braces)
        return
      }
      if (c === '\n') line++
      text += c
      i++
    }
  }

  while (i < src.length) {
    const c = src[i]
    if (c === '\n') { line++; i++; continue }
    if (c === ' ' || c === '\t' || c === '\r') { i++; continue }
    const from = i
    const startLine = line
    if (c === '/' && src[i + 1] === '/') {
      const nl = src.indexOf('\n', i)
      i = nl < 0 ? src.length : nl
      push('comment', src.slice(from, i), from, startLine)
      continue
    }
    if (c === '/' && src[i + 1] === '*') {
      const close = src.indexOf('*/', i + 2)
      const end = close < 0 ? src.length : close + 2
      for (let k = i; k < end; k++) if (src[k] === '\n') line++
      i = end
      push('comment', src.slice(from, i), from, startLine)
      continue
    }
    if (c === '"' || c === "'") {
      let value = ''
      i++
      while (i < src.length && src[i] !== c && src[i] !== '\n') {
        if (src[i] === '\\') { value += unescape(src[i + 1]); i += 2; continue }
        value += src[i++]
      }
      i++
      push('str', value, from, startLine)
      continue
    }
    if (c === '`') { i++; template(); continue }
    if (/[A-Za-z_$]/.test(c)) {
      while (i < src.length && /[\w$]/.test(src[i])) i++
      push('id', src.slice(from, i), from, startLine)
      continue
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      while (i < src.length && /[\w.]/.test(src[i])) i++
      push('num', src.slice(from, i), from, startLine)
      continue
    }
    if (c === '/') {
      const p = prev()
      if (!p || (p.t === 'punct' && REGEX_AFTER.has(p.v)) || (p.t === 'id' && REGEX_AFTER.has(p.v))) {
        i++
        let inClass = false
        while (i < src.length && src[i] !== '\n') {
          if (src[i] === '\\') { i += 2; continue }
          if (src[i] === '[') inClass = true
          else if (src[i] === ']') inClass = false
          else if (src[i] === '/' && !inClass) break
          i++
        }
        i++
        while (i < src.length && /[a-z]/.test(src[i])) i++
        push('regex', src.slice(from, i), from, startLine)
        continue
      }
    }
    if (c === '}' && holes.length && holes.at(-1) === braces) {
      holes.pop()
      i++
      push('punct', '}$', from, startLine)
      template()
      continue
    }
    if (c === '{') braces++
    if (c === '}') braces--
    const op = PUNCT.find((p) => src.startsWith(p, i)) ?? c
    i += op.length
    push('punct', op, from, startLine)
  }
  return tokens
}

const unescape = (c) => ({ n: '\n', t: '\t', r: '\r', 0: '\0' })[c] ?? c ?? ''
