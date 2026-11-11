// The `layerfs` package as a scenario run's scripts load it: the real
// package, with every call put through the run's scope (scope.js) when
// LAYERFS_CONNECT_SCOPE names one. A run's folder holds
// node_modules/layerfs, which re-exports this module (shim.js). The call
// table names each positional, so the scope sees named arguments and the
// real call gets its positionals back in the table's order.
import { client as cliClient } from '../cli/calls.js'
import { table as cliTable } from '../cli/table.js'
import { CliError } from '../cli/outcome.js'
const real = { client: (options = {}) => cliClient({ ...options, cli: process.env.LAYERFS_CONNECT_CLI, home: options.home ?? process.env.LAYERFS_HOME }), table: cliTable, families: [...new Set(cliTable.map(c => c.family))], LayerFSError: CliError }
real.default = real.client()
import { Scope, SCOPE_ENV } from './scope.js'
import { traced } from './trace-line.js'
import { OPS_ENV } from '../sessions/recorder.js'

const scopeDir = process.env[SCOPE_ENV]
const scope = scopeDir ? Scope.open(scopeDir) : null

/** `client`'s families with each call scoped, and traced (trace-line.js). */
function scoped(client) {
  if (!scope && !process.env.LAYERFS_TRACE && !process.env[OPS_ENV]) return client
  const out = { ...client }
  for (const spec of real.table) {
    out[spec.family] ??= { ...client[spec.family] }
    out[spec.family][spec.call] = async (...given) => {
      const options = given.length > spec.args.length || (given.length && typeof given.at(-1) === 'object' && given.at(-1) !== null && !Array.isArray(given.at(-1)) && spec.args[given.length - 1]?.kind !== 'json') ? given.pop() : {}
      const named = Object.fromEntries(spec.args.map((a, i) => [a.name, given[i]]).filter(([, v]) => v !== undefined))
      const settings = Object.fromEntries(Object.entries(options).filter(([, v]) => typeof v !== 'function'))
      // the operation id travels to the CLI child, so a nested observer does not record it again
      const send = (op, args) => traced(op, { ...settings, ...args }, (operationId) => {
        const [family, call] = op.split('.')
        const target = real.table.find((t) => t.family === family && t.call === call)
        return client[family][call](...target.args.map((a) => args[a.name]), operationId ? { ...options, connect_operation_id: operationId } : options)
      })
      const op = `${spec.family}.${spec.call}`
      return scope ? scope.call(op, named, send) : send(op, named)
    }
  }
  return Object.freeze(out)
}

export const table = real.table
export const families = real.families
export const LayerFSError = real.LayerFSError
export const client = (options) => scoped(real.client(options))
const fallback = scoped(real.default)
export const { project, branch, commit, file, sandbox, workspace, machine, store, backup } = fallback
export default { ...fallback, client, table, families, LayerFSError }
