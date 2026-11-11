import { CliError } from './outcome.js'

/** Higher load concurrency is private to one preset action/home, never host-wide. */
export function invocationLane(binaryKey, spec, argv, options = {}) {
  if (argv[0] === 'workspace' && argv[1] === 'exec-cancel') return { key: `${binaryKey}:cancel`, limit: 4 }
  if (options.concurrency === undefined) return { key: `${binaryKey}:calls`, limit: 4 }
  if (!Number.isInteger(options.concurrency) || options.concurrency < 1 || options.concurrency > 16 || !spec.home || !options.concurrencyGroup) {
    throw new CliError('InvalidInput', 'Project load concurrency needs an action, explicit home, and a limit from 1 to 16.')
  }
  return { key: JSON.stringify(['project-load', binaryKey, spec.home, options.concurrencyGroup]), limit: options.concurrency }
}
