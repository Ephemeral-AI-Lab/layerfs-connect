// Connect's change to the ported "tour", "merge" and "conflicts" scenarios:
// their in-place sed runs in a Sandbox, which may be a Mac (`-platform mac`,
// BSD sed) as well as Linux (GNU sed). dsh-layerfs writes GNU's forms:
//   sed -i "<expr>" <file>         BSD reads the expression as -i's suffix
//   '/a\|b/d'                      \| is a GNU extension of basic regexps
// Each becomes the form both read: -i.bak with the backup removed after, and
// -E with a plain | for an alternation:
//   sed [-E] -i.bak "<expr>" <file> && rm <file>.bak
//
// Only a command's `"sed -i ..."` (a script's `lf.workspace.exec(ws, ...)`, a
// cli scenario's `layerfs workspace exec <ws> "..."`) is rewritten. Each
// scenario expects its own count; a count that no longer matches stops the
// port, so a changed upstream script is looked at, not half-moved.

/** The in-place seds each scenario's commands run. */
export const SEDS = { tour: 1, merge: 3, conflicts: 2 }

// in the parsed text: "sed -i <expr quoted as \"...\" or '...'> <file>"
const SED = /"sed -i (\\".*?\\"|'.*?') ([\w./-]+)"/g

/** One command's in-place seds, portable; answers the text and how many it rewrote. */
export function portableSedText(text) {
  let n = 0
  const out = text.replace(SED, (_, expr, file) => {
    n++
    // a GNU alternation: `\\|` inside a script's JS string, `\|` in a shell command
    const bar = expr.includes('\\\\|') ? '\\\\|' : expr.includes('\\|') ? '\\|' : null
    return `"sed${bar ? ' -E' : ''} -i.bak ${bar ? expr.replaceAll(bar, '|') : expr} ${file} && rm ${file}.bak"`
  })
  return { out, n }
}

/** A ported scenario's agents' commands, with portable seds (see the top). */
export function portableSed(id) {
  return (scenario, counts = {}) => {
    let total = 0
    const agents = Object.fromEntries(
      Object.entries(scenario.agents ?? {}).map(([name, steps]) => [
        name,
        steps.map((step) => {
          if (typeof step?.bash?.command !== 'string') return step
          const { out, n } = portableSedText(step.bash.command)
          total += n
          return n ? { ...step, bash: { ...step.bash, command: out } } : step
        }),
      ]),
    )
    if (total !== SEDS[id]) throw new Error(`${id}: expected ${SEDS[id]} in-place sed(s) to make portable, found ${total}: look at tools/lib/portable-sed.mjs`)
    counts['sed -i (GNU) -> sed -i.bak && rm (BSD and GNU)'] = total
    return { ...scenario, agents }
  }
}
