import { existsSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { CliError } from './outcome.js'
export function binary(spec = {}) {
  const path = spec.cli || process.env.LAYERFS_CONNECT_CLI
  if (!path || !isAbsolute(path) || !existsSync(path)) throw new CliError('CliUnavailable', 'Set LAYERFS_CONNECT_CLI to an absolute pinned LayerFS binary path', null, 'unavailable')
  return { command: path, prefix: [], key: path }
}
