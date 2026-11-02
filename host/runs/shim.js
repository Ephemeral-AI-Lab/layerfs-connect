// What a run's (or a scenario chat's) bash calls find for LayerFS:
//   <dir>/bin/layerfs                the command: cli-shim.mjs, which runs the
//                                    native binary (spec.cli,
//                                    LAYERFS_CONNECT_CLI), its arguments put
//                                    through the run's scope when there is one
//   <dir>/node_modules/layerfs       the package for scripts run from the
//                                    run's folder: scope-client.js, the real
//                                    package with each call scoped
// LAYERFS_HOME comes from the call's environment.
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const q = (s) => `'${String(s).replaceAll("'", "'\\''")}'`
const CLI_SHIM = fileURLToPath(new URL('./cli-shim.mjs', import.meta.url))
const CLIENT = pathToFileURL(fileURLToPath(new URL('./scope-client.js', import.meta.url))).href

/** Writes <dir>/bin/layerfs and <dir>/node_modules/layerfs; without a CLI the command says so and exits 127. */
export function writeShims(spec, dir) {
  const bin = join(dir, 'bin')
  mkdirSync(bin, { recursive: true })
  const body = spec.cli ? `exec ${q(process.execPath)} ${q(CLI_SHIM)} ${q(spec.cli)} "$@"` : `echo 'layerfs: no native layerfs binary (set LAYERFS_CONNECT_CLI)' >&2\nexit 127`
  writeFileSync(join(bin, 'layerfs'), `#!/bin/sh\n${body}\n`)
  chmodSync(join(bin, 'layerfs'), 0o755)
  const pkg = join(dir, 'node_modules', 'layerfs')
  mkdirSync(pkg, { recursive: true })
  writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: 'layerfs', type: 'module', exports: './index.js' }))
  writeFileSync(join(pkg, 'index.js'), `export * from ${JSON.stringify(CLIENT)}\nexport { default } from ${JSON.stringify(CLIENT)}\n`)
}
