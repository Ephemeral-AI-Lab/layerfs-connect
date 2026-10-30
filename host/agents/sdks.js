// Settings → SDKs: the libraries agents can work with, kept in
// <state>/sdks.json. Until that file exists, the defaults beside this file
// (sdks.default.json, the LayerFS SDK and its calls) stand in for it. Connect
// writes the file only to switch an SDK on or off, or to open it for editing.
// Each SDK that is on and found adds a section, written from its entry, to the
// system prompt of the agents its `agents` names (child-extension.js).
//
// Each SDK's `root` is absolute or relative to Connect's folder. Connect looks
// there (two folders deep) for each package's package.json, and for each doc,
// to show what it found and the version.
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const fail = (status, message) => Object.assign(new Error(message), { status })
const DEFAULTS = fileURLToPath(new URL('./sdks.default.json', import.meta.url))
const APP = fileURLToPath(new URL('../..', import.meta.url))
const AGENTS = ['main', 'worker', 'lead']

const text = (value) => typeof value === 'string' ? value.trim() : ''
const texts = (value) => Array.isArray(value) ? value.map(text).filter(Boolean) : []

/** One entry as written, with anything malformed dropped; null without an id. */
function entry(raw) {
  if (!raw || typeof raw !== 'object' || !text(raw.id)) return null
  return {
    id: text(raw.id),
    title: text(raw.title) || text(raw.id),
    description: text(raw.description),
    enabled: raw.enabled !== false,
    root: text(raw.root),
    packages: texts(raw.packages),
    command: text(raw.command) || null,
    docs: texts(raw.docs),
    agents: texts(raw.agents).filter((agent) => AGENTS.includes(agent)),
    calls: (Array.isArray(raw.calls) ? raw.calls : [])
      .filter((call) => call && typeof call === 'object' && text(call.name) && text(call.signature))
      .map((call) => ({ name: text(call.name), signature: text(call.signature), description: text(call.description) })),
  }
}

/** package name -> { dir, version }, for every package.json up to two folders under root. */
function packagesUnder(root) {
  const found = new Map()
  const visit = (dir, depth) => {
    try {
      const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
      if (typeof manifest.name === 'string' && !found.has(manifest.name)) found.set(manifest.name, { dir, version: manifest.version ?? null })
    } catch {}
    if (depth === 2) return
    let children = []
    try { children = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const child of children) {
      if (child.isDirectory() && child.name !== 'node_modules' && !child.name.startsWith('.')) visit(join(dir, child.name), depth + 1)
    }
  }
  visit(root, 0)
  return found
}

/** An SDK's system prompt section, from its sdks.json entry: what it is, its packages, command, docs and calls. */
export function sdkPrompt(sdk) {
  const lines = [`## SDK: ${sdk.title}`]
  if (sdk.description) lines.push(sdk.description)
  if (sdk.packages.length) lines.push(`- Packages: ${sdk.packages.map((pkg) => pkg.name).join(', ')}`)
  if (sdk.command) lines.push(`- Command: \`${sdk.command}\``)
  const docs = sdk.docs.filter((doc) => doc.found).map((doc) => resolve(sdk.rootPath, doc.path))
  if (docs.length) lines.push(`- Docs: ${docs.join(', ')}`)
  if (sdk.calls.length) {
    lines.push('- Calls (`<group>.<call>`: signature, what it does):')
    for (const call of sdk.calls) lines.push(`  - ${call.name}: \`${call.signature}\`${call.description ? ` ${call.description}` : ''}`)
  }
  return lines.join('\n')
}

export class SdkSettings {
  /** @param {string} file <state>/sdks.json  @param {{ app?: string, defaults?: string }} [options] */
  constructor(file, { app = APP, defaults = DEFAULTS } = {}) {
    this.file = file
    this.app = app
    this.defaults = defaults
  }

  /** The file as written (or the defaults), or why it cannot be read. */
  read() {
    const source = existsSync(this.file) ? this.file : this.defaults
    let parsed
    try { parsed = JSON.parse(readFileSync(source, 'utf8')) }
    catch (error) { return { error: `${source} is not valid JSON: ${error.message}` } }
    if (!parsed || !Array.isArray(parsed.sdks)) return { error: `${source} needs an "sdks" list.` }
    return { config: parsed }
  }

  /** What Settings → SDKs shows: each SDK, with what Connect found on disk. */
  view() {
    const { config, error } = this.read()
    if (error) return { file: this.file, custom: existsSync(this.file), error, sdks: [] }
    const seen = new Set()
    const sdks = config.sdks.map(entry).filter((sdk) => sdk && !seen.has(sdk.id) && seen.add(sdk.id)).map((sdk) => {
      const rootPath = sdk.root ? (isAbsolute(sdk.root) ? sdk.root : resolve(this.app, sdk.root)) : null
      const installed = rootPath ? packagesUnder(rootPath) : new Map()
      const packages = sdk.packages.map((name) => ({ name, found: installed.has(name) }))
      const docs = sdk.docs.map((path) => ({ path, found: !!rootPath && existsSync(resolve(rootPath, path)) }))
      const version = sdk.packages.map((name) => installed.get(name)?.version).find(Boolean) ?? null
      return { ...sdk, rootPath, version, packages, docs, found: !!rootPath && packages.every((pkg) => pkg.found) }
    })
    return { file: this.file, custom: existsSync(this.file), error: null, sdks }
  }

  /** Each agent kind's system prompt section: the SDKs that are on, found, and list that kind in `agents`. */
  prompts() {
    const sdks = this.view().sdks.filter((sdk) => sdk.enabled && sdk.found)
    return Object.fromEntries(AGENTS.map((kind) => [kind, sdks.filter((sdk) => sdk.agents.includes(kind)).map(sdkPrompt).join('\n\n')]))
  }

  /** Switches one SDK on or off, writing sdks.json (from the defaults the first time). */
  setEnabled(input) {
    const id = text(input?.id)
    if (!id || typeof input.enabled !== 'boolean') throw fail(400, 'Name an SDK and whether it is on.')
    const { config, error } = this.read()
    if (error) throw fail(409, `Fix sdks.json first: ${error}`)
    const target = config.sdks.find((sdk) => text(sdk?.id) === id)
    if (!target) throw fail(404, `No SDK “${id}” in sdks.json.`)
    target.enabled = input.enabled
    this.write(config)
    return this.view()
  }

  write(config) {
    writeFileSync(`${this.file}.tmp`, JSON.stringify(config, null, 2) + '\n')
    renameSync(`${this.file}.tmp`, this.file)
  }

  /** Opens sdks.json in the system's text editor, writing the defaults first if it is new. */
  openConfig() {
    if (!existsSync(this.file)) {
      const { config, error } = this.read()
      if (error) throw fail(500, error)
      this.write(config)
    }
    const [cmd, args] = process.platform === 'darwin' ? ['open', ['-t', this.file]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', this.file]] : ['xdg-open', [this.file]]
    spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref()
    return { path: this.file }
  }
}
