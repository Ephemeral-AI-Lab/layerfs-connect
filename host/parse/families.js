// The LayerFS calls the parser recognises, read from LayerFS's own call table
// (the `layerfs` package's `table`, engine/crates/layerfs-api/src/calls/table.rs)
// rather than written down here: the nine families' 57 calls, each a
// `layerfs <family> <call>` command and a `layerfs.<family>.<call>(…)`
// function, with each command's positional names and option kinds.
import { table } from '../cli/table.js'

/** What each family's call is: the kind the UI shows. Setup families (machine, store, backup) show as project-level calls. */
export const KIND = { workspace: 'workspace', file: 'fs', branch: 'branch', commit: 'branch', sandbox: 'sandbox', project: 'project', machine: 'project', store: 'project', backup: 'project' }

/** family -> Set of calls. */
export const FAMILIES = new Map()
/** "family.call" -> the command entry: { args, options: { <flag name>: kind } } (flags as the CLI writes them, `start-line`). */
export const COMMANDS = new Map()
for (const entry of table) {
  if (!FAMILIES.has(entry.family)) FAMILIES.set(entry.family, new Set())
  FAMILIES.get(entry.family).add(entry.call)
  const options = Object.fromEntries(entry.options.map((o) => [o.name.replaceAll('_', '-'), o.kind]))
  COMMANDS.set(`${entry.family}.${entry.call}`, { ...entry, options })
}

/** 1.1.0's @layerfs/backend calls: 2.0 has none (O25). */
export const BACKEND_CALLS = new Set()

export const isCall = (family, call) => FAMILIES.get(family)?.has(call) === true
