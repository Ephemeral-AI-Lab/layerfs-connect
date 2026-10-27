// The LayerFS calls the parser recognises, read from LayerFS's own sources
// rather than written down here:
//   CLI      @layerfs/cli/calls: the `layerfs <family> <call>` table, with each
//            command's positional names and option kinds (layerfs init too)
//   SDK      api/agent/sdk/src/<family>/: the `lf.<family>.<call>` methods
//            (the CLI mirrors them one to one; the folder adds nothing new
//            today, but a call the SDK gains before the CLI is still known)
//   backend  api/backend/src/<store|daemon>/<group>/<call>.js: the
//            `be.<store|daemon>.<group>.<call>` methods of LayerFSBackend
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CALLS, INIT } from '@layerfs/cli/calls'

const SDK = fileURLToPath(new URL('.', import.meta.resolve('@layerfs/agent')))
const BACKEND = fileURLToPath(new URL('.', import.meta.resolve('@layerfs/backend')))

/** What each family's call is: the kind the UI shows. */
export const KIND = { workspace: 'workspace', fs: 'fs', branch: 'branch', sandbox: 'sandbox', project: 'project' }

const isDir = (path) => existsSync(path) && statSync(path).isDirectory()

/** The calls a family folder of the SDK exports: its index.js re-exports, else one per file. */
function sdkCalls(family) {
  const dir = join(SDK, family)
  if (!isDir(dir)) return []
  const index = join(dir, 'index.js')
  if (existsSync(index)) {
    const text = readFileSync(index, 'utf8')
    return [...text.matchAll(/export\s*\{\s*([A-Za-z_]\w*)\s*\}\s*from/g)].map((m) => m[1])
  }
  return readdirSync(dir)
    .filter((f) => f.endsWith('.js'))
    .map((f) => f.slice(0, -3))
    .filter((name) => new RegExp(`export\\s+(?:async\\s+)?function\\s+${name}\\s*\\(`).test(readFileSync(join(dir, `${name}.js`), 'utf8')))
}

/** family -> Set of calls (CLI and SDK). */
export const FAMILIES = new Map()
/** "family.call" -> the CLI command entry ({ args, options }). */
export const COMMANDS = new Map()
for (const entry of CALLS) {
  if (!FAMILIES.has(entry.family)) FAMILIES.set(entry.family, new Set())
  FAMILIES.get(entry.family).add(entry.call)
  COMMANDS.set(`${entry.family}.${entry.call}`, entry)
}
for (const family of FAMILIES.keys()) for (const call of sdkCalls(family)) FAMILIES.get(family).add(call)
// layerfs init / LayerFS.init: the project family's one constructor
FAMILIES.get('project')?.add(INIT.call)
COMMANDS.set(`project.${INIT.call}`, INIT)

/** "store.project.get_history", "daemon.process.start", … */
export const BACKEND_CALLS = new Set()
for (const tier of ['store', 'daemon']) {
  const dir = join(BACKEND, tier)
  if (!isDir(dir)) continue
  for (const group of readdirSync(dir)) {
    if (!isDir(join(dir, group))) continue
    for (const file of readdirSync(join(dir, group))) if (file.endsWith('.js')) BACKEND_CALLS.add(`${tier}.${group}.${file.slice(0, -3)}`)
  }
}

export const isCall = (family, call) => FAMILIES.get(family)?.has(call) === true
