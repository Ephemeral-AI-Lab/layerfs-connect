// Build a relocatable local macOS app using the installed Electron distribution.
// https://www.electronjs.org/docs/latest/tutorial/application-distribution
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, renameSync, symlinkSync, writeFileSync, lstatSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const root = resolve(desktop, '..')
const require = createRequire(join(desktop, 'package.json'))
const readJSON = (path) => JSON.parse(readFileSync(path, 'utf8'))
const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit' })
if (process.platform !== 'darwin') throw new Error('package:mac must run on macOS.')
if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Use Node.js 24 or newer to bundle the host runtime.')
const output = join(desktop, 'dist', `mac-${process.arch}`)
const app = join(output, 'LayerFS Connect.app')
const resources = join(app, 'Contents', 'Resources')
const backend = join(resources, 'backend')
const manifest = readJSON(join(desktop, 'package.json'))

// Only this command's generated app is replaced; other output stays intact.
mkdirSync(output, { recursive: true })
rmSync(app, { recursive: true, force: true })
const electron = dirname(require.resolve('electron/package.json'))
cpSync(join(electron, 'dist', 'Electron.app'), app, { recursive: true, verbatimSymlinks: true })
renameSync(join(app, 'Contents', 'MacOS', 'Electron'), join(app, 'Contents', 'MacOS', 'LayerFS Connect'))
rmSync(join(resources, 'default_app.asar'), { force: true })
mkdirSync(join(resources, 'app'), { recursive: true })
cpSync(join(desktop, 'out'), join(resources, 'app', 'out'), { recursive: true })
writeFileSync(join(resources, 'app', 'package.json'), JSON.stringify({
  name: manifest.name, productName: 'LayerFS Connect', version: manifest.version,
  type: 'module', main: './out/main/index.js',
}, null, 2) + '\n')

// Keep host code and its data files intact: Pi loads extension modules at runtime.
for (const dir of ['host', 'scenarios', 'fixtures', 'tools/lib', 'tools/demo', 'tools/simulation']) {
  cpSync(join(root, dir), join(backend, dir), {
    recursive: true,
    filter: (path) => basename(path) !== 'test',
  })
}
writeFileSync(join(backend, 'package.json'), JSON.stringify({ private: true, type: 'module' }) + '\n')
const bin = join(resources, 'runtime', 'bin')
mkdirSync(bin, { recursive: true })
cpSync(realpathSync(process.execPath), join(bin, 'node'))
const nodeLicense = resolve(dirname(realpathSync(process.execPath)), '..', 'LICENSE')
if (existsSync(nodeLicense)) cpSync(nodeLicense, join(resources, 'runtime', 'NODE-LICENSE'))

// Materialize the installed production dependency graph, preserving each
// package's exact dependency/peer versions. All links are relative and stay
// inside the app; no pnpm store or source checkout is needed at runtime.
const modules = join(backend, 'node_modules')
const copied = new Map()
function locate(name, from) {
  const loader = createRequire(join(from, 'package.json'))
  for (const search of loader.resolve.paths(name) ?? []) {
    const candidate = join(search, name)
    if (existsSync(join(candidate, 'package.json'))) return realpathSync(candidate)
  }
  return null
}
function linkPackage(name, source, into) {
  const target = copyPackage(source)
  const link = join(into, name)
  mkdirSync(dirname(link), { recursive: true })
  if (!existsSync(link)) symlinkSync(relative(dirname(link), target), link)
}
function copyPackage(source) {
  if (copied.has(source)) return copied.get(source)
  const pkg = readJSON(join(source, 'package.json'))
  const target = join(modules, '.bundled', `${copied.size}-${pkg.name.replaceAll('/', '-')}`)
  copied.set(source, target)
  cpSync(source, target, {
    recursive: true, verbatimSymlinks: true,
    filter: (path) => path === source || basename(path) !== 'node_modules',
  })
  const dependencies = new Set([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.optionalDependencies ?? {}),
    ...Object.keys(pkg.peerDependencies ?? {}),
  ])
  for (const name of dependencies) {
    const found = locate(name, source)
    if (found) linkPackage(name, found, join(target, 'node_modules'))
    else if (pkg.dependencies?.[name] && !pkg.optionalDependencies?.[name]) {
      throw new Error(`Missing installed dependency ${name} of ${pkg.name}`)
    }
  }
  return target
}
for (const name of [
  '@earendil-works/pi-coding-agent', '@earendil-works/pi-agent-core',
  '@earendil-works/pi-ai', '@earendil-works/pi-tui', 'pi-subagents', 'typebox',
]) {
  const source = locate(name, root)
  if (!source) throw new Error(`Install root dependencies first: missing ${name}`)
  linkPackage(name, source, modules)
}

// Ship only the explicit pinned CLI and its matching daemon; no Node addon.
for (const name of ['layerfs', 'layerfs-daemon']) {
  const source = name === 'layerfs' ? process.env.LAYERFS_CONNECT_CLI : process.env.LAYERFS_CONNECT_DAEMON
  if (!source || !source.startsWith('/') || !existsSync(source)) throw new Error(`Set an absolute LAYERFS_CONNECT_${name === 'layerfs' ? 'CLI' : 'DAEMON'} before packaging.`)
  cpSync(source, join(bin, name))
}
const identity = JSON.parse(execFileSync(join(bin, 'layerfs'), ['--version', '--json'], { encoding: 'utf8' }))
if (identity.dirty !== false || !identity.features?.includes('postgresql')) throw new Error('Packaging requires a clean pinned CLI with the postgresql feature.')
writeFileSync(join(resources, 'runtime', 'layerfs-build.json'), JSON.stringify(identity, null, 2)+'\n')

// Reject a package that silently relies on the source tree or package store.
function validateLinks(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (lstatSync(path).isSymbolicLink()) {
      const dest = realpathSync(path)
      const rel = relative(app, dest)
      if (rel.startsWith('..') || resolve(app, rel) === app) throw new Error(`External bundle link: ${path}`)
    } else if (entry.isDirectory()) validateLinks(path)
  }
}
validateLinks(app)
const plist = join(app, 'Contents', 'Info.plist')
for (const [key, value] of Object.entries({
  CFBundleDisplayName: 'LayerFS Connect', CFBundleName: 'LayerFS Connect',
  CFBundleIdentifier: 'ai.ephemeral.layerfs-connect', CFBundleExecutable: 'LayerFS Connect',
  CFBundleShortVersionString: manifest.version, CFBundleVersion: manifest.version,
})) run('/usr/bin/plutil', ['-replace', key, '-string', value, plist])
// Local ad-hoc signing makes the modified bundle runnable. This is not
// Developer ID signing or notarization for public distribution.
run('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', app])
run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app])
writeFileSync(join(output, 'BUILD.json'), JSON.stringify({
  app: basename(app), platform: process.platform, arch: process.arch,
  node: process.version, electron: readJSON(join(electron, 'package.json')).version,
  packages: copied.size, builtAt: new Date().toISOString(), signing: 'ad-hoc', defaultMode: 'real',
}, null, 2) + '\n')
console.log(`Packaged ${copied.size} runtime packages into ${app}`)
if (process.argv.includes('--zip')) {
  const archive = join(output, 'LayerFS Connect.zip')
  rmSync(archive, { force: true })
  run('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', app, archive])
  console.log(`Archive: ${archive}`)
}
