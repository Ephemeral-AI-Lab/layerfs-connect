export class CliError extends Error {
  constructor(code, message, detail = null, transport = 'refusal') {
    super(message)
    Object.assign(this, { name: 'LayerFSError', code, detail, transport })
  }
}
export function outcome({ code, signal, result, refusal, error, malformed = false }) {
  if (error) throw new CliError('CliUnavailable', 'The configured LayerFS CLI could not be started', null, 'unavailable')
  if (signal || malformed) throw new CliError('Unknown', 'LayerFS ended without a complete result; inspect state before another action', { signal }, 'transport-unknown')
  if (code === 0 && result !== undefined && !refusal) return result
  if (code === 125 && refusal && typeof refusal.code === 'string' && typeof refusal.message === 'string') throw new CliError(refusal.code, refusal.message, refusal.detail, 'refusal')
  if (code === 2) throw new CliError('CliIncompatible', 'LayerFS rejected the command syntax; check the selected binary and capabilities', null, 'usage-incompatible')
  throw new CliError('Unknown', 'LayerFS returned no valid final result; inspect state before another action', { exit: code }, 'transport-unknown')
}
