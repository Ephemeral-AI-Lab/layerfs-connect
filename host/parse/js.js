// An inline SDK script (the body of a `node <<'JS'` heredoc) split into
// pieces, one per LayerFS call: lf.<family>.<call>(…) on a client from
// LayerFS.open (any name it is given), a family taken from it
// (`const { fs } = lf`, `const f = lf.fs`), be.<store|daemon>.<group>.<call>(…)
// on LayerFSBackend.of(…), and LayerFS.init(…).
//
// The script is cut into statements; a statement's lines are one unit (units
// sharing a line are one). A unit with a call is that call's piece. The rest
// go with a call:
//   - before the first call, with the first; after the last, with the last
//   - between two calls A and B: what sets B up goes with B (a block that
//     holds B, and statements before it that declare a name B or its setup
//     uses); the rest, mostly A's result handling, goes with A
//   - comments with what follows; blank lines and closing braces
//     (`}`, `} catch (e) {`, `} finally {`) with what precedes
// A script with no call is one local piece.
import { BACKEND_CALLS, FAMILIES, KIND } from './families.js'
import { lexJs } from './jslex.js'

const OPENERS_BEFORE = new Set(['try', 'else', 'finally', 'do'])
const CONTINUES = new Set(['.', '?.', ',', '=', '=>', '(', '[', '+', '-', '*', '/', '%', '&&', '||', '??', '?', ':', '==', '===', '!=', '!==', '<', '>', '<=', '>=', '+=', '-=', '|', '&', '...'])
const LEADS = new Set(['.', '?.', ')', ']', ',', '+', '*', '/', '%', '&&', '||', '??', '?', ':', '==', '===', '!=', '!==', '=>', '}$'])
const AFTER_CLOSER = new Set(['else', 'catch', 'finally', 'while'])

/** Statements of `tokens`: { tokens, start, end, opener, closer }. */
function statements(tokens) {
  const out = []
  const stack = []
  let cur = null
  const atStatement = () => !stack.length || stack.at(-1) === 'block'
  const finish = () => {
    if (cur?.tokens.length) out.push(cur)
    cur = null
  }
  for (let k = 0; k < tokens.length; k++) {
    const tk = tokens[k]
    if (tk.t === 'comment') continue
    const prev = cur?.tokens.at(-1)
    // a new line at statement level may end the statement before it (no semicolon)
    if (cur && prev && tk.line > prev.end && atStatement()) {
      const header = /^(if|for|while)$/.test(cur.tokens[0].v) && prev.v === ')' && cur.parenClosedAt === cur.tokens.length - 1
      const closerGoesOn = cur.closer && tk.t === 'id' && AFTER_CLOSER.has(tk.v)
      if (!header && !closerGoesOn && !(prev.t === 'punct' && CONTINUES.has(prev.v)) && !(prev.t === 'id' && prev.v === 'else') && !(tk.t === 'punct' && LEADS.has(tk.v))) finish()
    }
    if (tk.t === 'punct' && tk.v === '}' && stack.at(-1) === 'block') {
      // a block's closing brace starts a closer statement
      finish()
      stack.pop()
      cur = { tokens: [tk], closer: true, opener: false }
      continue
    }
    if (!cur) cur = { tokens: [], closer: false, opener: false }
    cur.tokens.push(tk)
    if (tk.t !== 'punct') continue
    const v = tk.v
    if (v === '(' || v === '[' || v === '${') stack.push(v)
    else if (v === ')' || v === ']' || v === '}$') {
      stack.pop()
      if (v === ')' && atStatement()) cur.parenClosedAt = cur.tokens.length - 1
    } else if (v === '{') {
      const before = cur.tokens.at(-2)
      const block = atStatement() && (!before || (before.t === 'punct' && (before.v === ')' || before.v === '=>')) || (before.t === 'id' && OPENERS_BEFORE.has(before.v)))
      if (block) {
        stack.push('block')
        cur.opener = true
        finish()
      } else stack.push('{')
    } else if (v === '}') stack.pop()
    else if (v === ';' && atStatement()) finish()
  }
  finish()
  for (const s of out) {
    s.start = s.tokens[0].line
    s.end = s.tokens.at(-1).end
  }
  return out
}

/** The names LayerFS clients, backends and families go by in this script. */
function aliases(tokens) {
  const lf = new Set(['lf'])
  const be = new Set()
  const families = new Map()
  const v = (k) => tokens[k]?.v
  for (let k = 0; k < tokens.length; k++) {
    if (tokens[k].t !== 'id' || v(k + 1) !== '=') continue
    let j = k + 2
    if (v(j) === 'await') j++
    if (v(j) === 'LayerFS' && v(j + 1) === '.' && (v(j + 2) === 'open' || v(j + 2) === 'init')) lf.add(v(k))
    if (v(j) === 'LayerFSBackend' && v(j + 1) === '.' && v(j + 2) === 'of') be.add(v(k))
  }
  for (let k = 0; k < tokens.length; k++) {
    // const { fs, workspace: ws } = lf
    if (v(k) === '{' && ['const', 'let', 'var'].includes(v(k - 1))) {
      let j = k + 1
      const names = []
      while (j < tokens.length && v(j) !== '}') {
        if (tokens[j].t === 'id') names.push(v(j + 1) === ':' ? [v(j), v(j + 2)] : [v(j), v(j)])
        if (v(j + 1) === ':') j += 2
        j++
      }
      if (v(j + 1) === '=' && lf.has(v(j + 2))) for (const [family, name] of names) if (FAMILIES.has(family)) families.set(name, family)
    }
    // const f = lf.fs
    if (tokens[k].t === 'id' && v(k + 1) === '=' && lf.has(v(k + 2)) && v(k + 3) === '.' && FAMILIES.has(v(k + 4)) && v(k + 5) !== '.') families.set(v(k), v(k + 4))
  }
  return { lf, be, families }
}

/** The LayerFS calls in `tokens[from..to)`: [{ call, family, at, span }] (`at`: index of its '('; `span`: source offsets from callee to '('). */
function callsIn(tokens, from, to, names) {
  const out = []
  const v = (k) => tokens[k]?.v
  const id = (k) => tokens[k]?.t === 'id'
  for (let k = from; k < to; k++) {
    if (!id(k) || v(k - 1) === '.' || v(k - 1) === '?.') continue
    const name = v(k)
    if (names.lf.has(name) && v(k + 1) === '.' && FAMILIES.has(v(k + 2)) && v(k + 3) === '.' && id(k + 4) && v(k + 5) === '(' && FAMILIES.get(v(k + 2)).has(v(k + 4))) {
      out.push({ family: v(k + 2), call: `${v(k + 2)}.${v(k + 4)}`, at: k + 5, span: [tokens[k].from, tokens[k + 5].to] })
    } else if (names.be.has(name) && v(k + 1) === '.' && v(k + 3) === '.' && v(k + 5) === '.' && v(k + 7) === '(' && BACKEND_CALLS.has(`${v(k + 2)}.${v(k + 4)}.${v(k + 6)}`)) {
      out.push({ family: 'backend', call: `backend.${v(k + 2)}.${v(k + 4)}.${v(k + 6)}`, at: k + 7, span: [tokens[k].from, tokens[k + 7].to] })
    } else if (names.families.has(name) && v(k + 1) === '.' && id(k + 2) && v(k + 3) === '(' && FAMILIES.get(names.families.get(name)).has(v(k + 2))) {
      const family = names.families.get(name)
      out.push({ family, call: `${family}.${v(k + 2)}`, at: k + 3, span: [tokens[k].from, tokens[k + 3].to] })
    } else if (name === 'LayerFS' && v(k + 1) === '.' && v(k + 2) === 'init' && v(k + 3) === '(') {
      out.push({ family: 'project', call: 'project.init', at: k + 3, span: [tokens[k].from, tokens[k + 3].to] })
    }
  }
  return out
}

/** Names a statement declares or assigns, and names it reads. */
function names(tokens) {
  const declares = new Set()
  const uses = new Set()
  const v = (k) => tokens[k]?.v
  for (let k = 0; k < tokens.length; k++) {
    const tk = tokens[k]
    if (tk.t !== 'id') continue
    if (['const', 'let', 'var'].includes(tk.v)) {
      // the binding pattern, up to its = (or of/in in a for header)
      let depth = 0
      for (let j = k + 1; j < tokens.length; j++) {
        const t = tokens[j]
        if (t.t === 'punct' && ['{', '['].includes(t.v)) depth++
        else if (t.t === 'punct' && ['}', ']'].includes(t.v)) depth--
        else if (depth === 0 && (t.v === '=' || t.v === 'of' || t.v === 'in' || t.v === ';' || t.v === ')')) break
        else if (t.t === 'id' && v(j + 1) !== ':') declares.add(t.v)
      }
      continue
    }
    if (v(k - 1) === '.' || v(k - 1) === '?.') continue
    uses.add(tk.v)
    // x = …, ({ a } = …): assigned names count as declared here
    if (v(k + 1) === '=' && (k === 0 || ['(', '{', ',', ';'].includes(v(k - 1)))) declares.add(tk.v)
    if (v(k - 1) === 'catch' || (v(k - 1) === '(' && v(k - 2) === 'catch')) declares.add(tk.v)
  }
  return { declares, uses }
}

/** The text of a call's argument `n` (0-based): a string's value, or a const string it names, or its source. */
function argument(tokens, open, n, src, consts) {
  let depth = 0
  let index = 0
  let first = -1
  let last = -1
  for (let k = open + 1; k < tokens.length; k++) {
    const t = tokens[k]
    if (t.t === 'punct' && ['(', '[', '{', '${'].includes(t.v)) depth++
    else if (t.t === 'punct' && [')', ']', '}', '}$'].includes(t.v)) {
      if (depth === 0) break
      depth--
    } else if (depth === 0 && t.v === ',' && t.t === 'punct') { index++; continue }
    if (index === n) {
      if (first < 0) first = k
      last = k
    }
  }
  if (first < 0) return null
  if (first === last && (tokens[first].t === 'str' || tokens[first].t === 'tpl')) return tokens[first].v
  if (first === last && tokens[first].t === 'id' && consts.has(tokens[first].v)) return consts.get(tokens[first].v)
  return src.slice(tokens[first].from, tokens[last].to)
}

/** const NAME = "literal" in the script. */
function constants(tokens) {
  const out = new Map()
  for (let k = 0; k + 3 < tokens.length; k++) {
    if (tokens[k].v === 'const' && tokens[k + 1].t === 'id' && tokens[k + 2].v === '=' && ['str', 'tpl'].includes(tokens[k + 3].t)) out.set(tokens[k + 1].v, tokens[k + 3].v)
  }
  return out
}

/** The command an exec or a Sandbox process runs: the detail its segment shows. */
const DETAIL = { 'workspace.exec': 1, 'backend.daemon.process.start': 1 }

/**
 * Pieces of the script `src`, whose first line is line `first` of the
 * command: [{ start, end, kind, call?, detail?, attach? }] in line order,
 * covering every line once. `attach` is 'prev' or 'next' for a piece that
 * joins a neighbouring call's.
 */
export function jsPieces(src, first) {
  const lineCount = src.split('\n').length
  const tokens = lexJs(src)
  const code = tokens.filter((t) => t.t !== 'comment')
  const names_ = aliases(code)
  const consts = constants(code)
  const stmts = statements(tokens)
  // statements as line units; statements sharing a line are one unit
  const units = []
  let si = 0
  for (const s of stmts) {
    const last = units.at(-1)
    const info = { ...names(s.tokens), calls: callsIn(s.tokens, 0, s.tokens.length, names_), stmt: si++ }
    if (last && s.start <= last.end) {
      last.end = Math.max(last.end, s.end)
      last.stmts.push(s)
      last.calls.push(...info.calls.map((c) => ({ ...c, tokens: s.tokens })))
      for (const n of info.declares) last.declares.add(n)
      for (const n of info.uses) last.uses.add(n)
      last.opener = s.opener || (last.opener && !s.closer)
      continue
    }
    units.push({ start: s.start, end: s.end, stmts: [s], calls: info.calls.map((c) => ({ ...c, tokens: s.tokens })), declares: info.declares, uses: info.uses, opener: s.opener, closer: s.closer })
  }
  // blocks: for each unit that opens one, the unit index where it closes
  const stack = []
  for (const [u, unit] of units.entries()) {
    unit.closes = Infinity
    for (const s of unit.stmts) {
      if (s.closer && stack.length) units[stack.pop()].closes = u
      if (s.opener) stack.push(u)
    }
  }
  const pieces = []
  const covered = new Array(lineCount).fill(false)
  const callUnits = units.map((u, i) => (u.calls.length ? i : -1)).filter((i) => i >= 0)
  if (!callUnits.length) return [{ start: first, end: first + lineCount - 1, kind: 'local' }]
  const side = new Map()
  // what goes with which call between two calls
  for (let c = -1; c < callUnits.length; c++) {
    const a = callUnits[c]
    const b = callUnits[c + 1]
    const gap = units.slice(a === undefined ? 0 : a + 1, b === undefined ? units.length : b).map((_, k) => (a === undefined ? 0 : a + 1) + k)
    if (a === undefined) { for (const g of gap) side.set(g, 'next'); continue }
    if (b === undefined) { for (const g of gap) side.set(g, 'prev'); continue }
    const candidates = gap.filter((g) => !units[g].closer)
    let split = candidates.length
    const holder = candidates.findIndex((g) => units[g].opener && units[g].closes > b)
    if (holder >= 0) split = holder
    const needed = new Set(units[b].uses)
    for (const g of candidates.slice(split)) for (const n of units[g].uses) needed.add(n)
    while (split > 0) {
      const unit = units[candidates[split - 1]]
      if (![...unit.declares].some((n) => needed.has(n))) break
      for (const n of unit.uses) needed.add(n)
      split--
    }
    for (const [k, g] of candidates.entries()) side.set(g, k < split ? 'prev' : 'next')
    for (const g of gap) if (units[g].closer) side.set(g, 'prev')
  }
  for (const [i, unit] of units.entries()) {
    const piece = { start: first + unit.start, end: first + unit.end }
    if (unit.calls.length) {
      const [call] = unit.calls
      piece.kind = call.family === 'backend' ? 'backend' : KIND[call.family] ?? 'local'
      piece.call = call.call
      const details = unit.calls
        .filter((c) => c.call === call.call && DETAIL[c.call] !== undefined)
        .map((c) => argument(c.tokens, c.at, DETAIL[c.call], src, consts))
        .filter((d) => d !== null)
      if (details.length) piece.detail = details.join('\n')
      piece.at = unit.calls.map((c) => ({ call: c.call, from: c.span[0], to: c.span[1] }))
    } else {
      piece.kind = 'local'
      piece.attach = unit.closer ? 'prev' : side.get(i) ?? 'prev'
    }
    for (let l = unit.start; l <= unit.end; l++) covered[l] = true
    pieces.push(piece)
  }
  // comment lines go with what follows; blank lines with what precedes
  const comments = new Set(tokens.filter((t) => t.t === 'comment').flatMap((t) => range(t.line, t.end)))
  for (let l = 0; l < lineCount; l++) {
    if (covered[l]) continue
    pieces.push({ start: first + l, end: first + l, kind: 'local', attach: comments.has(l) ? 'next' : 'prev' })
  }
  return pieces.sort((x, y) => x.start - y.start)
}

const range = (a, b) => Array.from({ length: b - a + 1 }, (_, k) => a + k)
