// Loaded with `node --import` by the host, agents' bash calls (NODE_OPTIONS)
// and the layerfs command. Connect links @layerfs/* to the LayerFS checkout's
// api/ packages (package.json, link:), and LayerFS's own folders have no
// node_modules of their own: Connect never installs into the LayerFS repo.
// So every @layerfs/* import, wherever it is written (an agent's script, or
// @layerfs/backend importing @layerfs/agent), resolves from Connect's
// node_modules: one copy of each package, so the worker the runtime hands
// @layerfs/agent is the one every client uses.
//
// In a scenario run's bash call (LAYERFS_CONNECT_SCOPE set) the SDK's
// client.js is runs/scope-client.js, which puts each call in the run's scope
// (runs/scope.js) before the real client.js traces and sends it.
import { registerHooks } from 'node:module'

const FROM = new URL('./resolve-layerfs.js', import.meta.url).href
const SCOPED = !!process.env.LAYERFS_CONNECT_SCOPE
const WRAPPER = new URL('./runs/scope-client.js', import.meta.url).href
const REAL = 'layerfs-connect:real-client'
let client = null

registerHooks({
  resolve(specifier, context, next) {
    if (SCOPED && specifier === REAL) {
      client ??= new URL('./client.js', next('@layerfs/agent', { ...context, parentURL: FROM }).url).href
      return { url: client, shortCircuit: true }
    }
    const found = specifier.startsWith('@layerfs/') ? next(specifier, { ...context, parentURL: FROM }) : next(specifier, context)
    if (SCOPED && context.parentURL !== WRAPPER && found.url.endsWith('/agent/src/client.js')) return { ...found, url: WRAPPER }
    return found
  },
})
