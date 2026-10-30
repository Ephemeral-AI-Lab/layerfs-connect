// Loaded with `node --import` by the host, agents' bash calls (NODE_OPTIONS)
// and the layerfs command. Connect links @layerfs/* to the LayerFS checkout's
// api/ packages (package.json, link:), and LayerFS's own folders have no
// node_modules of their own: Connect never installs into the LayerFS repo.
// So every @layerfs/* import, wherever it is written (an agent's script, or
// @layerfs/backend importing @layerfs/agent), resolves from Connect's
// node_modules: one copy of each package, so the worker the runtime hands
// @layerfs/agent is the one every client uses.
import { registerHooks } from 'node:module'

const FROM = new URL('./resolve-layerfs.js', import.meta.url).href

registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('@layerfs/')) return next(specifier, { ...context, parentURL: FROM })
    return next(specifier, context)
  },
})
