// The simulated LayerFS (LAYERFS_CONNECT_MODE=sim): the `layerfs` package's
// exports (client, close, doctor, table, LayerFSError) with no native
// library, machine or Docker behind them. The call table is the real one,
// saved in table.json (tools/sim-table.mjs writes it again), and each client
// function takes its arguments exactly as the real package's does: its
// positionals in the table's order, then an options object. The answers come
// from one simulated world per home (world.js), kept in
// <home>/sim-world.json; a call the simulator does not cover yet is refused
// `Unsupported`, naming it.
import { readFileSync } from 'node:fs'
import { closeWorlds, LayerFSError, PRESETS, worldOf } from './world.js'

/** The table: `[{ family, call, args, options, help }]`, as the real library answers it. */
export const table = JSON.parse(readFileSync(new URL('./table.json', import.meta.url), 'utf8'))
/** The families, in help order. */
export const families = [...new Set(table.map((c) => c.family))]
/** What the host shows as the LayerFS version. */
export const VERSION = '2.0.0 (simulated)'

export { LayerFSError, PRESETS }

const isPlain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value) && !ArrayBuffer.isView(value)
const invalid = (message) => new LayerFSError('InvalidInput', message, null)

/** One table entry as a function of `made`: the real package's argument rules (api/node/src/index.js bind). */
function bind(made, spec) {
  const name = `${spec.family}.${spec.call}`
  const handlers = spec.options.filter((o) => o.kind === 'function').map((o) => o.name)
  const known = new Set(spec.options.map((o) => o.name))
  return async function call(...given) {
    let options = {}
    const last = given[given.length - 1]
    const slot = spec.args[given.length - 1]
    const json = slot && slot.kind === 'json'
    if (given.length > spec.args.length || (isPlain(last) && slot && !json)) {
      options = given.pop() ?? {}
      if (!isPlain(options)) throw invalid(`${name}: options must be an object`)
    }
    if (given.length > spec.args.length) throw invalid(`${name}: takes ${spec.args.length} positional arguments`)
    const args = {}
    spec.args.forEach((arg, i) => {
      if (given[i] !== undefined && given[i] !== null) args[arg.name] = given[i]
    })
    const on = {}
    for (const [key, value] of Object.entries(options)) {
      if (!known.has(key)) throw invalid(`${name}: unknown option "${key}"`)
      if (handlers.includes(key)) {
        if (typeof value !== 'function') throw invalid(`${name}: ${key} must be a function`)
        on[key] = value
      } else if (value !== undefined) {
        args[key] = value
      }
    }
    for (const arg of spec.args) if (!arg.optional && args[arg.name] === undefined) throw invalid(`${name}: ${arg.name} is required`)
    return worldOf(made.home).call(name, args, on)
  }
}

/** A client of `home` (default LAYERFS_HOME): the real package's shape. A folder scope is accepted and not applied. */
export function client({ home, scope } = {}) {
  const made = { home: home ?? process.env.LAYERFS_HOME ?? null, scope }
  for (const family of families) made[family] = {}
  for (const spec of table) made[spec.family][spec.call] = bind(made, spec)
  return Object.freeze(made)
}

/** `layerfs doctor` on the simulated home: what needs the person, changing nothing. */
export async function doctor({ home } = {}) {
  return worldOf(home ?? process.env.LAYERFS_HOME ?? null).doctor()
}

/** Saves every world this process opened; answers 0 (the simulator holds no Store leases). */
export function close() {
  closeWorlds()
  return 0
}

/** Replaces `home`'s world with a fresh copy of `preset` (PRESETS); answers its summary. */
export function reset(home, preset) {
  return worldOf(home).reset(preset)
}

/** `{ preset, presets, speed, file }` of `home`'s world. */
export function info(home) {
  return worldOf(home).info()
}
