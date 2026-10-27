// A scenario's fixture given as a seed file (format layerfs-demo-seed v1):
// the files a recorded run's project was Inited from, as JSON, because some
// of them (a .git/HEAD) cannot live in a repository as files. A run writes
// the seed out to a folder first, and that folder is the project's Init
// source. Ported from dsh-layerfs packages/mock/src/seed.js.
//
// seed.json: { format: "layerfs-demo-seed", version: 1, entries: {
//   "/<path>": { type: "file", mode?, text } | { type: "file", mode?, base64 }
//            | { type: "dir", mode? } | { type: "symlink", target } } }
import { chmodSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const FIELDS = ['type', 'mode', 'text', 'base64', 'target']

/** Checks a parsed seed; throws naming the entry at fault (`where` names the file). */
export function checkSeed(seed, where = 'seed') {
  if (seed?.format !== 'layerfs-demo-seed' || seed.version !== 1) throw new Error(`${where}: not a layerfs-demo-seed v1`)
  for (const [path, e] of Object.entries(seed.entries ?? {})) {
    if (!path.startsWith('/') || path === '/' || path.split('/').slice(1).some((p) => !p || p === '.' || p === '..')) {
      throw new Error(`${where}: entry ${path} is not a plain absolute path`)
    }
    if (typeof e !== 'object' || e === null) throw new Error(`${where}: entry ${path} is not an object`)
    for (const k of Object.keys(e)) if (!FIELDS.includes(k)) throw new Error(`${where}: entry ${path} has an unknown field ${k}`)
    if (!['file', 'dir', 'symlink'].includes(e.type)) throw new Error(`${where}: entry ${path} has an unknown type ${e.type}`)
  }
  return seed
}

/** Reads and checks a seed file. */
export const readSeed = (file) => checkSeed(JSON.parse(readFileSync(file, 'utf8')), file)

/**
 * Writes a seed's entries into `dir`, replacing whatever was there, and
 * answers `dir`. `seed` is a seed.json path or a parsed seed.
 */
export function writeSeed(seed, dir) {
  const value = typeof seed === 'string' ? readSeed(seed) : checkSeed(seed)
  const entries = Object.entries(value.entries ?? {}).sort(([a], [b]) => a.localeCompare(b))
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  for (const [path, e] of entries) {
    const at = join(dir, path)
    if (e.type === 'dir') mkdirSync(at, { recursive: true })
    else if (e.type === 'symlink') {
      mkdirSync(dirname(at), { recursive: true })
      symlinkSync(e.target, at)
    } else {
      mkdirSync(dirname(at), { recursive: true })
      writeFileSync(at, e.text !== undefined ? e.text : Buffer.from(e.base64 ?? '', 'base64'))
    }
  }
  // modes last, deepest first, so a read-only folder does not stop its own files
  for (const [path, e] of entries.reverse()) if (e.type !== 'symlink' && e.mode !== undefined) chmodSync(join(dir, path), e.mode)
  return dir
}
