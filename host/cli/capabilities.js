import { execute } from './spawn.js'
import { binary } from './binary.js'
import { CliError } from './outcome.js'
const known = new Map()
export let lastIdentity = null
export function discover(spec = {}) {
  const key = binary(spec).key
  if (!known.has(key)) known.set(key, (async () => {
    const identity = await execute(spec, ['--version', '--json'], { discovery: true, timeout: 15000 })
    const help = await execute(spec, ['help', '--json'], { discovery: true, timeout: 15000 })
    if (!identity || !/^[a-f0-9]{40}$/.test(identity.commit ?? '') || typeof identity.dirty !== 'boolean' || !Array.isArray(identity.features) || !Array.isArray(help.calls) || !Array.isArray(help.commands) || !Array.isArray(help.switches)) throw new CliError('CliIncompatible', 'The selected LayerFS CLI has no compatible JSON discovery', null, 'usage-incompatible')
    for (const name of ['workspace.exec_cancel', 'branch.commits', 'branch.get_commit', 'store.stats', 'project.stats', 'file.revision']) {
      if (!help.calls.some((c) => `${c.family}.${c.call}` === name)) throw new CliError('CliIncompatible', `The selected CLI lacks ${name}`, null, 'usage-incompatible')
    }
    if (!help.switches.some((s) => s.name === '--events' && s.calls.includes('workspace.exec'))) throw new CliError('CliIncompatible', 'The selected CLI lacks framed execution', null, 'usage-incompatible')
    lastIdentity = identity
    return { identity, ...help }
  })())
  return known.get(key)
}
