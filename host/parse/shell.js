// A bash script as top-level units. A unit is the lines of one complete
// command list at the top level: a simple command, a pipeline or && chain, a
// `\` continuation, a quoted string or $( … ) over several lines, a whole
// if/for/while/case/{ } block, each with its heredoc bodies. Comment-only and
// blank lines between units are units of their own. Each unit lists the
// simple commands it runs, also those inside $( … ), backticks, double
// quotes and subshells, with their words unquoted, so a caller can find the
// `layerfs` and `node` commands wherever they stand.
//
//   shellUnits(text) -> [{ type: command | comment | blank, start, end, commands }]
//   command: { words: [{ raw, value, quoted, offset }], heredocs: [{ delim, value, start, end }], offset }
// Lines are 1-based. A heredoc's body is lines start..end (end < start when
// empty); its terminator is the line after.

const META = new Set([' ', '\t', '\n', ';', '&', '|', '(', ')', '<', '>'])
/** Reserved words at a command's start, and how they change the block depth. */
const OPENS = new Set(['if', 'while', 'until', 'for', 'case', 'select', '{'])
const CLOSES = new Set(['fi', 'done', 'esac', '}'])
const PASS = new Set(['then', 'do', 'else', 'elif', '!', 'time'])
/** After these the rest of the command is a header, not a command. */
const HEADERS = new Set(['for', 'case', 'select', 'function'])

export class Lexer {
  constructor(src) {
    this.src = src
    this.i = 0
    /** heredocs waiting for the end of their line: { delim, strip, cmd } */
    this.pending = []
    /** every simple command, nested ones too */
    this.commands = []
  }

  /** At a newline just consumed: reads the bodies of the heredocs started on that line. */
  bodies() {
    const { src } = this
    for (const doc of this.pending.splice(0)) {
      const start = this.i
      let end = start
      for (;;) {
        if (this.i >= src.length) { end = src.length; break }
        const nl = src.indexOf('\n', this.i)
        const lineEnd = nl < 0 ? src.length : nl
        const line = src.slice(this.i, lineEnd)
        if ((doc.strip ? line.replace(/^\t+/, '') : line) === doc.delim) {
          end = this.i
          this.i = nl < 0 ? src.length : nl + 1
          break
        }
        this.i = nl < 0 ? src.length : nl + 1
        end = this.i
      }
      doc.cmd.heredocs.push({ delim: doc.delim, quoted: doc.quoted, from: start, to: end, value: src.slice(start, end).replace(/\n$/, '') })
    }
  }

  /** Skips a quoted span opened by `quote` at this.i, reading nested $( ) in double quotes. */
  double() {
    const { src } = this
    let value = ''
    this.i++
    while (this.i < src.length && src[this.i] !== '"') {
      const c = src[this.i]
      if (c === '\\' && '"\\$`\n'.includes(src[this.i + 1])) {
        if (src[this.i + 1] !== '\n') value += src[this.i + 1]
        this.i += 2
      } else if (c === '$' || c === '`') {
        const from = this.i
        this.expansion()
        value += src.slice(from, this.i)
      } else {
        value += c
        this.i++
      }
    }
    this.i++
    return value
  }

  /** A $…, ${…}, $(…), $((…)) or `…` at this.i; nested commands are parsed. */
  expansion() {
    const { src } = this
    if (src[this.i] === '`') {
      let j = this.i + 1
      while (j < src.length && src[j] !== '`') j += src[j] === '\\' ? 2 : 1
      const inner = new Lexer(src.slice(this.i + 1, j))
      inner.list(null)
      for (const cmd of inner.commands) this.commands.push(shift(cmd, this.i + 1))
      this.i = j + 1
      return
    }
    const next = src[this.i + 1]
    if (next === '(' && src[this.i + 2] === '(') {
      let depth = 0
      for (this.i += 1; this.i < src.length; this.i++) {
        if (src[this.i] === '(') depth++
        else if (src[this.i] === ')' && --depth === 0) { this.i++; break }
      }
      return
    }
    if (next === '(') {
      this.i += 2
      this.list(')')
      return
    }
    if (next === '{') {
      let depth = 0
      for (this.i += 1; this.i < src.length; this.i++) {
        const c = src[this.i]
        if (c === '\\') { this.i++; continue }
        if (c === "'") { this.i = Math.max(this.i, src.indexOf("'", this.i + 1)); continue }
        if (c === '"') { this.double(); this.i--; continue }
        if (c === '{') depth++
        else if (c === '}' && --depth === 0) { this.i++; break }
      }
      return
    }
    if (next === "'") {
      let j = this.i + 2
      while (j < src.length && src[j] !== "'") j += src[j] === '\\' ? 2 : 1
      this.i = j + 1
      return
    }
    this.i++
  }

  /** One word at this.i: { raw, value, quoted, offset }. */
  word() {
    const { src } = this
    const offset = this.i
    let value = ''
    let quoted = false
    while (this.i < src.length && !META.has(src[this.i])) {
      const c = src[this.i]
      if (c === '\\') {
        if (src[this.i + 1] !== '\n') value += src[this.i + 1] ?? ''
        this.i += 2
        quoted = true
      } else if (c === "'") {
        const j = src.indexOf("'", this.i + 1)
        const end = j < 0 ? src.length : j
        value += src.slice(this.i + 1, end)
        this.i = end + 1
        quoted = true
      } else if (c === '"') {
        value += this.double()
        quoted = true
      } else if (c === '$' || c === '`') {
        const from = this.i
        this.expansion()
        value += src.slice(from, this.i)
      } else {
        value += c
        this.i++
      }
    }
    return { raw: src.slice(offset, this.i), value, quoted, offset }
  }

  /**
   * Parses commands until `stop` (')' or end). At the top level, `unit`
   * is told about each newline so it can close a unit.
   */
  list(stop, unit = null) {
    const { src } = this
    let cmd = null
    let parens = 0
    let target = false
    const end = () => {
      if (!cmd) return
      if (cmd.words.length || cmd.heredocs.length || cmd.pendingDocs) this.commands.push(cmd)
      unit?.command(cmd)
      cmd = null
    }
    const open = () => {
      if (!cmd) cmd = { words: [], heredocs: [], offset: this.i, pendingDocs: 0 }
      return cmd
    }
    while (this.i < src.length) {
      const c = src[this.i]
      if (c === ' ' || c === '\t') { this.i++; continue }
      if (c === '\\' && src[this.i + 1] === '\n') { this.i += 2; continue }
      if (c === '\n') {
        end()
        const at = this.i
        this.i++
        if (this.pending.length) this.bodies()
        unit?.newline(at, this.i)
        continue
      }
      if (c === '#') {
        const nl = src.indexOf('\n', this.i)
        unit?.comment(this.i, cmd !== null)
        this.i = nl < 0 ? src.length : nl
        continue
      }
      if (c === ')') {
        if (parens === 0 && stop === ')') { end(); this.i++; return }
        end()
        parens = Math.max(0, parens - 1)
        unit?.op(')')
        this.i++
        continue
      }
      if (c === '(') {
        end()
        parens++
        unit?.op('(')
        this.i++
        continue
      }
      if (c === ';' || c === '&' || c === '|') {
        let op = c
        const two = src.slice(this.i, this.i + 2)
        if (['&&', '||', ';;', '|&', '&>'].includes(two)) op = two
        if (op === '&>') { open(); this.i += 2; target = true; continue }
        end()
        this.i += op.length
        unit?.op(op)
        continue
      }
      if (c === '<' || c === '>') {
        const here = src.slice(this.i, this.i + 3)
        open()
        if (here.startsWith('<<') && here !== '<<<') {
          const strip = here === '<<-'
          this.i += strip ? 3 : 2
          while (src[this.i] === ' ' || src[this.i] === '\t') this.i++
          const delim = this.word()
          this.pending.push({ delim: delim.value, strip, quoted: delim.quoted, cmd })
          cmd.pendingDocs++
          continue
        }
        // any other redirection: its target is no command word
        while (this.i < src.length && '<>&|'.includes(src[this.i])) this.i++
        if (/^[0-9-]/.test(src[this.i] ?? '') && src[this.i - 1] === '&') { this.word(); continue }
        target = true
        continue
      }
      const w = this.word()
      if (target) { target = false; continue }
      // a word of digits right before a redirection is its file descriptor
      if (/^[0-9]+$/.test(w.raw) && (src[this.i] === '<' || src[this.i] === '>')) continue
      open().words.push(w)
    }
    end()
  }
}

/** A command parsed from a substring, with offsets moved to the outer text. */
function shift(cmd, by) {
  return {
    ...cmd,
    offset: cmd.offset + by,
    words: cmd.words.map((w) => ({ ...w, offset: w.offset + by })),
    heredocs: cmd.heredocs.map((h) => ({ ...h, from: h.from + by, to: h.to + by })),
  }
}

/** The command words of a simple command: assignments, prefixes and reserved words dropped. */
export function commandWords(cmd) {
  const words = cmd.words.slice()
  for (;;) {
    const w = words[0]
    if (!w) return []
    if (!w.quoted && /^[A-Za-z_][A-Za-z0-9_]*(\[[^\]]*\])?\+?=/.test(w.raw)) { words.shift(); continue }
    if (!w.quoted && (PASS.has(w.value) || OPENS.has(w.value) || CLOSES.has(w.value))) {
      if (HEADERS.has(w.value)) return []
      words.shift()
      continue
    }
    if (!w.quoted && ['command', 'exec', 'nohup', 'env'].includes(w.value) && words.length > 1) { words.shift(); continue }
    return words
  }
}

/** The block depth a simple command changes: +1 for if/for/while/case/{, -1 for fi/done/esac/}. */
function depthOf(cmd) {
  let depth = 0
  for (const w of cmd.words) {
    if (w.quoted) break
    if (/^[A-Za-z_][A-Za-z0-9_]*\+?=/.test(w.raw)) continue
    if (OPENS.has(w.value)) { depth++; if (HEADERS.has(w.value)) break; continue }
    if (CLOSES.has(w.value)) { depth--; continue }
    if (PASS.has(w.value)) continue
    break
  }
  return depth
}

/** Line number (1-based) of each offset. */
export function lineIndex(text) {
  const starts = [0]
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1)
  return (offset) => {
    let lo = 0
    let hi = starts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (starts[mid] <= offset) lo = mid
      else hi = mid - 1
    }
    return lo + 1
  }
}

/** The lines of `text`, without the empty one a final newline leaves. */
export const linesOf = (text) => {
  const lines = text.split('\n')
  if (lines.length > 1 && lines.at(-1) === '') lines.pop()
  return lines
}

export function shellUnits(text) {
  const lineAt = lineIndex(text)
  const total = linesOf(text).length
  const lexer = new Lexer(text)
  const units = []
  let current = null
  let depth = 0
  let continued = false
  // commands found since the last unit closed belong to the next one (a
  // $( … ) ends before the command holding it)
  let mark = 0
  const start = (offset) => {
    if (!current) current = { type: 'command', from: offset, to: offset, commands: [] }
  }
  const close = (to) => {
    if (!current) return
    current.to = to
    current.commands = lexer.commands.slice(mark).sort((a, b) => a.offset - b.offset)
    mark = lexer.commands.length
    units.push(current)
    current = null
  }
  lexer.list(null, {
    command(cmd) {
      start(cmd.offset)
      depth += depthOf(cmd)
      continued = false
    },
    op(op) {
      start(lexer.i)
      if (op === '(') depth++
      if (op === ')') depth--
      continued = ['|', '||', '&&', '|&'].includes(op)
    },
    comment(offset, inCommand) {
      if (current || inCommand) return start(offset)
      units.push({ type: 'comment', from: offset, to: offset, commands: [] })
    },
    newline(at, after) {
      if (current && depth <= 0 && !continued) close(Math.max(at, after - 1))
      else if (!current && lexer.src[at - 1] !== undefined && /^[ \t]*$/.test(lineText(text, at))) {
        units.push({ type: 'blank', from: at, to: at, commands: [] })
      }
    },
  })
  close(text.length - 1)
  // to lines; a comment or blank unit is its own line
  const out = units.map((u) => ({ type: u.type, start: lineAt(u.from), end: lineAt(Math.max(u.from, u.to)), commands: u.commands.map((c) => withLines(c, lineAt)) }))
  // a leading blank line has no newline before it to report; fill any line no unit holds
  return fill(out, total)
}

/** The text of the line holding offset `at` (a newline). */
function lineText(text, at) {
  const from = text.lastIndexOf('\n', at - 1) + 1
  return text.slice(from, at)
}

function withLines(cmd, lineAt) {
  return {
    words: cmd.words,
    offset: cmd.offset,
    line: lineAt(cmd.offset),
    heredocs: cmd.heredocs.map((h) => ({ delim: h.delim, quoted: h.quoted, value: h.value, start: lineAt(h.from), end: h.to > h.from ? lineAt(h.to - 1) : lineAt(h.from) - 1 })),
  }
}

/** Units sorted, overlaps folded, every line from 1 to `total` in exactly one unit. */
function fill(units, total) {
  const out = []
  for (const u of units.sort((a, b) => a.start - b.start)) {
    const last = out.at(-1)
    if (last && u.start <= last.end) {
      // a unit that shares a line with the one before belongs to it
      last.end = Math.max(last.end, u.end)
      last.commands.push(...u.commands)
      if (last.type !== 'command' && u.type === 'command') last.type = 'command'
      continue
    }
    for (let line = (last?.end ?? 0) + 1; line < u.start; line++) out.push({ type: 'blank', start: line, end: line, commands: [] })
    out.push({ ...u })
  }
  for (let line = (out.at(-1)?.end ?? 0) + 1; line <= total; line++) out.push({ type: 'blank', start: line, end: line, commands: [] })
  return out.filter((u) => u.start <= total).map((u) => ({ ...u, end: Math.min(u.end, total) }))
}
