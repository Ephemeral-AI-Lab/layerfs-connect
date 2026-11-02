// The `layerfs` command a run's (or a scenario chat's) bash calls find on
// PATH: <dir>/bin/layerfs, which runs the native `layerfs` binary
// (spec.cli, LAYERFS_CONNECT_CLI). LAYERFS_HOME comes from the call's
// environment.
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const q = (s) => `'${String(s).replaceAll("'", "'\\''")}'`

/** Writes <dir>/bin/layerfs; without a CLI it says so and exits 127. */
export function writeShims(spec, dir) {
  const bin = join(dir, 'bin')
  mkdirSync(bin, { recursive: true })
  const body = spec.cli ? `exec ${q(spec.cli)} "$@"` : `echo 'layerfs: no native layerfs binary (set LAYERFS_CONNECT_CLI)' >&2\nexit 127`
  writeFileSync(join(bin, 'layerfs'), `#!/bin/sh\n${body}\n`)
  chmodSync(join(bin, 'layerfs'), 0o755)
}
