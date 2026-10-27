// segments(command): a bash command as classified segments. Every line is in
// exactly one segment, and neighbouring lines of the same kind, form and
// call are one segment.
//   - a top-level unit (shell.js) that runs `layerfs <family> <call>` (also
//     inside $( … ), a pipe or a block) is a cli segment of that call; with
//     several calls on its lines, the first names it
//   - a `node <<'JS'` heredoc is split per LayerFS call (js.js): sdk
//     segments; its `node …` line goes with the first, its terminator with
//     the last
//   - other shell is local; a comment line goes with what follows it, a
//     blank line with what precedes it
// workspace exec's inner command is the segment's detail; "$cmd" is read
// from an earlier `cmd=…` or `read … cmd <<'X'` heredoc of the same script.
import { COMMANDS, isCall, KIND } from './families.js'
import { jsPieces } from './js.js'
import { commandWords, lineIndex, linesOf, shellUnits } from './shell.js'

const basename = (word) => word.value.slice(word.value.lastIndexOf('/') + 1)

/** A `layerfs` command's call: { family, call, kind, args, from, to } or null (`from`/`to`: offsets of `layerfs … <call>`). */
function layerfsCall(cmd) {
  const words = commandWords(cmd)
  if (!words.length || words[0].quoted || basename(words[0]) !== 'layerfs') return null
  let k = 1
  // global options before the family (argv.js globals)
  while (words[k] && /^--(text|project)(=|$)/.test(words[k].value)) k += words[k].value === '--project' ? 2 : 1
  const family = words[k]?.value
  const from = words[0].offset
  if (family === 'init') return { family: 'project', call: 'project.init', kind: 'project', args: words.slice(k + 1), from, to: words[k].offset + words[k].raw.length }
  const call = words[k + 1]?.value?.replaceAll('-', '_')
  if (!family || !call || !isCall(family, call)) return null
  return { family, call: `${family}.${call}`, kind: KIND[family], args: words.slice(k + 2), from, to: words[k + 1].offset + words[k + 1].raw.length }
}

/** The positional arguments of a CLI call, its options (and their values) skipped. */
function positional(found) {
  const entry = COMMANDS.get(found.call)
  const out = []
  for (let k = 0; k < found.args.length; k++) {
    const t = found.args[k].value
    if (t === '--') { out.push(...found.args.slice(k + 1)); break }
    if (t === '-m' || (t.startsWith('--') && !t.includes('='))) {
      const name = t === '-m' ? 'message' : t.slice(2)
      if (entry?.options?.[name] !== 'bool') k++
      continue
    }
    if (t.startsWith('--')) continue
    out.push(found.args[k])
  }
  return out
}

/** Shell variables a script sets before a line: NAME=literal, and read … NAME <<'X' heredocs. */
function remember(vars, cmd) {
  for (const w of cmd.words) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(w.raw)
    if (!m) break
    if (!w.value.slice(m[1].length + 1).includes('$')) vars.set(m[1], w.value.slice(m[1].length + 1))
  }
  const words = commandWords(cmd)
  if (words[0]?.value === 'read' && cmd.heredocs.length) {
    const name = words.filter((w) => !w.value.startsWith('-')).at(-1)?.value
    if (name && name !== 'read') vars.set(name, cmd.heredocs[0].value)
  }
}

/** The text an argument stands for: its value, or what "$name" was set to. */
function resolve(word, vars) {
  const m = /^\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?$/.exec(word.value)
  return m && vars.has(m[1]) ? vars.get(m[1]) : word.value
}

/** A unit that runs `node` with a heredoc: its script. */
function nodeScript(unit) {
  if (unit.commands.length !== 1) return null
  const [cmd] = unit.commands
  const words = commandWords(cmd)
  if (!words.length || basename(words[0]) !== 'node' || cmd.heredocs.length !== 1) return null
  if (words.some((w) => w.value === '-e' || w.value === '--eval')) return null
  return cmd.heredocs[0]
}

/** Pieces of one shell unit: { start, end, kind, form, call?, detail?, attach? }. */
function unitPieces(unit, vars) {
  if (unit.type === 'comment') return [{ start: unit.start, end: unit.end, kind: 'local', form: 'shell', attach: 'next' }]
  if (unit.type === 'blank') return [{ start: unit.start, end: unit.end, kind: 'local', form: 'shell', attach: 'prev' }]
  const script = nodeScript(unit)
  if (script) {
    const body = script.end >= script.start ? jsPieces(script.value, script.start) : []
    const pieces = body.map((p) => ({ ...p, form: 'sdk', at: p.at?.map((a) => ({ ...a, from: a.from + script.from, to: a.to + script.from })) }))
    if (!pieces.length || pieces.every((p) => p.attach)) {
      return [{ start: unit.start, end: unit.end, kind: 'local', form: 'sdk' }]
    }
    if (script.start > unit.start) pieces.unshift({ start: unit.start, end: script.start - 1, kind: 'local', form: 'sdk', attach: 'next' })
    if (unit.end > script.end) pieces.push({ start: script.end + 1, end: unit.end, kind: 'local', form: 'sdk', attach: 'prev' })
    return pieces
  }
  const calls = unit.commands.map(layerfsCall).filter(Boolean)
  const [found] = calls
  const piece = { start: unit.start, end: unit.end, kind: found ? found.kind : 'local', form: found ? 'cli' : 'shell' }
  if (found) {
    piece.call = found.call
    piece.at = calls.map(({ call, from, to }) => ({ call, from, to }))
  }
  if (found?.call === 'workspace.exec') {
    const args = positional(found)
    if (args[1]) piece.detail = resolve(args[1], vars)
  }
  for (const cmd of unit.commands) remember(vars, cmd)
  return [piece]
}

/** Folds attached pieces into their neighbours, then merges equal neighbours. */
function assemble(pieces) {
  const out = []
  let pending = []
  for (const p of pieces) {
    if (p.attach === 'next') { pending.push(p); continue }
    if (p.attach === 'prev') {
      if (out.length) {
        for (const q of [...pending, p]) out.at(-1).end = Math.max(out.at(-1).end, q.end)
        pending = []
      } else pending.push(p)
      continue
    }
    const seg = { ...p, start: Math.min(p.start, ...pending.map((q) => q.start)), details: p.detail !== undefined ? [p.detail] : [], at: p.at ?? [] }
    delete seg.attach
    delete seg.detail
    pending = []
    const last = out.at(-1)
    if (last && last.kind === seg.kind && last.form === seg.form && last.call === seg.call) {
      last.end = seg.end
      last.details.push(...seg.details)
      last.at.push(...seg.at)
    } else out.push(seg)
  }
  if (pending.length) {
    if (out.length) out.at(-1).end = Math.max(out.at(-1).end, ...pending.map((q) => q.end))
    else out.push({ start: pending[0].start, end: pending.at(-1).end, kind: 'local', form: pending[0].form, details: [], at: [] })
  }
  return out
}

/**
 * The command's segments: [{ kind, form, call?, text, lines: [first, last], detail?, at? }].
 * `at` places each LayerFS call of a segment: { call, line, cols: [from, to] },
 * `cols` spanning `lf.branch.fork(` or `layerfs branch fork` on that line.
 */
export function segments(command) {
  const lines = linesOf(String(command ?? ''))
  const joined = lines.join('\n')
  const lineAt = lineIndex(joined)
  const starts = lines.reduce((acc, l) => (acc.push(acc.at(-1) + l.length + 1), acc), [0])
  const place = ({ call, from, to }) => {
    const line = lineAt(from)
    const at = from - starts[line - 1]
    return { call, line, cols: [at, Math.min(to - starts[line - 1], lines[line - 1].length)] }
  }
  const vars = new Map()
  const pieces = shellUnits(joined, lines.length).flatMap((unit) => unitPieces(unit, vars))
  return assemble(pieces).map((s) => {
    const seg = { kind: s.kind, form: s.form }
    if (s.call) seg.call = s.call
    seg.text = lines.slice(s.start - 1, s.end).join('\n')
    seg.lines = [s.start, s.end]
    const details = [...new Set(s.details)]
    if (details.length) seg.detail = details.join('\n')
    if (s.at.length) seg.at = s.at.map(place)
    return seg
  })
}
