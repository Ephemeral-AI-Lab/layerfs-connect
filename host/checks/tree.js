// The tracked files of a saved snapshot and their SHA-256: what a replay's
// final.json records and what the final-tree check compares a run's main
// with. A tracked path is one the project's own .gitignore files do not
// exclude (Git decides, with `git check-ignore --no-index` over a scratch
// repository holding only those files); .git itself is never tracked. Ignored
// folders are not walked, so a build's target/ or node_modules costs nothing.
// The SDK reads text only, and a build leaves binary files that are not
// ignored (databases, test data), so a file's SHA-256 is of its bytes, taken
// by sha256sum in a Workspace. main cannot be mounted, so the check forks a
// Branch from it (CHECK_PREFIX, which the order check leaves out), mounts it,
// and unmounts it without a Commit. Ported from dsh-layerfs tools/checks/tree.mjs.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { CHECK_PREFIX } from './history.js'

/** Every entry of `dir` in `ref`, page by page. */
export async function listAll(lf, ref, dir) {
  const items = []
  for (let pos = 0; ; ) {
    const page = await lf.fs.list(ref, dir, 1000, pos)
    items.push(...page.items)
    if (!page.hasMore) return items
    pos += page.items.length
  }
}

/** A file's whole text in `ref`, window by window: { text, size } or { problem }. */
export async function readAll(lf, ref, path) {
  let text = ''
  let line = 1
  let size = 0
  for (;;) {
    let r
    try {
      r = await lf.fs.read(ref, path, line)
    } catch (error) {
      if (error.code === 'Binary') return { problem: 'binary' }
      throw error
    }
    if (r.lineTruncated) return { problem: 'a line longer than one reply' }
    text += r.text
    size = r.size
    if (r.nextLine == null) break
    line = r.nextLine
  }
  if (Buffer.byteLength(text) !== size) return { problem: `read ${Buffer.byteLength(text)} of ${size} bytes` }
  return { text, size }
}

/**
 * The tracked entries of `ref` (a Branch, Commit or Layer), by path. With
 * `root` (a scenario run's folder, /<run>), only what is under it, by its
 * path from there: the folder is the run's project root, .gitignore files
 * and all.
 * @returns {Promise<Map<string, 'file' | 'dir' | 'symlink'>>}
 */
export async function trackedTree(lf, ref, root = '/') {
  const scratch = mkdtempSync(join(tmpdir(), 'lfc-ignore-'))
  const tree = new Map()
  const base = root === '/' ? '' : root
  const local = (path) => path.slice(base.length)
  try {
    execFileSync('git', ['init', '-q', scratch])
    const dirs = [root]
    while (dirs.length) {
      const dir = dirs.shift()
      const items = (await listAll(lf, ref, dir)).filter((item) => item.name !== '.git')
      const ignore = items.find((item) => item.name === '.gitignore' && item.type === 'file')
      if (ignore) {
        const read = await readAll(lf, ref, ignore.path)
        if (read.problem) throw new Error(`${ignore.path}: ${read.problem}`)
        const target = join(scratch, local(ignore.path))
        mkdirSync(dirname(target), { recursive: true })
        writeFileSync(target, read.text)
      }
      const key = (item) => local(item.path).slice(1) + (item.type === 'dir' ? '/' : '')
      const ignored = ignoredOf(scratch, items.map(key))
      for (const item of items) {
        if (ignored.has(key(item))) continue
        tree.set(local(item.path), item.type)
        if (item.type === 'dir') dirs.push(item.path)
      }
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
  return tree
}

/**
 * A Commit's tracked changes from its parent (a Branch's first Commit: from
 * its base Layer): entries added, removed or of another type, and files whose
 * content differs (fs.diff_files, which compares binary files too), in
 * diff_commits' order. Ignored folders are never walked.
 * @param {{ id: string, parent?: string, base?: string }} commit as list_commits lists it
 * @param {(ref: string) => Promise<Map<string, string>>} treeOf trackedTree, perhaps cached
 */
export async function trackedChanges(lf, commit, treeOf = (ref) => trackedTree(lf, ref), root = '/') {
  const before = commit.parent ?? commit.base
  const [a, b] = [await treeOf(before), await treeOf(commit.id)]
  const at = (path) => (root === '/' ? path : `${root}${path}`)
  const out = []
  for (const [path, type] of b) {
    const was = a.get(path)
    if (!was) out.push({ path, kind: 'Added', type })
    else if (was !== type) out.push({ path, kind: 'Removed', type: was }, { path, kind: 'Added', type })
    else if (type === 'file' && !(await lf.fs.diff_files(before, at(path), commit.id, at(path))).contentEqual) out.push({ path, kind: 'Modified', type })
    else if (type === 'symlink') throw new Error(`${path}: a symlink in the tracked tree is not compared yet`)
  }
  for (const [path, type] of a) if (!b.has(path)) out.push({ path, kind: 'Removed', type })
  const segments = (p) => p.split('/')
  return out.sort((x, y) => {
    const [p, q] = [segments(x.path), segments(y.path)]
    for (let i = 0; i < Math.min(p.length, q.length); i++) if (p[i] !== q[i]) return p[i] < q[i] ? -1 : 1
    return p.length - q.length
  })
}

const quote = (text) => `'${text.replaceAll("'", "'\\''")}'`

/**
 * The SHA-256 of each of `paths` on `branch`, from its bytes, in a Sandbox
 * and Workspace of its own, unmounted without a Commit and closed after.
 * @returns {Promise<Record<string, string>>}
 */
export async function byteHashes(lf, branch, paths) {
  const hashes = {}
  if (!paths.length) return hashes
  const { sandbox } = await lf.sandbox.create()
  let ws
  try {
    ws = await lf.workspace.mount(sandbox, branch)
    for (let i = 0; i < paths.length; i += 200) {
      const chunk = paths.slice(i, i + 200)
      const r = await lf.workspace.exec(ws, `timeout 100 sha256sum -- ${chunk.map((p) => quote(`.${p}`)).join(' ')}`)
      if (r.exitCode !== 0) throw new Error(`sha256sum exited ${r.exitCode}: ${String(r.stderr ?? '').slice(0, 400)}`)
      const lines = String(r.stdout).split('\n').filter(Boolean)
      if (lines.length !== chunk.length) throw new Error(`sha256sum listed ${lines.length} of ${chunk.length} files`)
      lines.forEach((line, k) => {
        const [, sha, name] = /^([0-9a-f]{64}) [ *](.*)$/.exec(line) ?? []
        if (name !== `.${chunk[k]}`) throw new Error(`sha256sum answered ${line} for ${chunk[k]}`)
        hashes[chunk[k]] = sha
      })
    }
  } finally {
    if (ws) await lf.workspace.unmount(ws, true)
    await lf.sandbox.close(sandbox)
  }
  return hashes
}

/**
 * The tracked files of main with their SHA-256 (symlinks: "symlink"). A
 * scenario run's: of its folder `root` on its last trunk `ref`, by path from
 * the folder.
 * @returns {Promise<{ files: Record<string, string> }>}
 */
export async function trackedHashes(lf, { ref = 'main', root = '/' } = {}) {
  const tree = await trackedTree(lf, ref, root)
  const files = {}
  const at = (path) => (root === '/' ? path : `${root}${path}`)
  const regular = [...tree].filter(([, type]) => type === 'file').map(([path]) => path)
  if (regular.length) {
    const branch = `${CHECK_PREFIX}${root === '/' ? '' : `${root.slice(1)}-`}${Date.now().toString(36)}`
    await lf.branch.fork(branch, ref)
    const hashes = await byteHashes(lf, branch, regular.map(at))
    for (const path of regular) files[path] = hashes[at(path)]
  }
  for (const [path, type] of tree) if (type === 'symlink') files[path] = 'symlink'
  return { files: sortKeys(files) }
}

/** Which of `paths` (relative, folders ending in /) the scratch repository's .gitignore files exclude. */
export function ignoredOf(scratch, paths) {
  if (!paths.length) return new Set()
  let out = ''
  try {
    out = execFileSync('git', ['-C', scratch, 'check-ignore', '--no-index', '-z', '--stdin'], {
      input: paths.join('\0') + '\0',
      encoding: 'utf8',
      maxBuffer: 1 << 30,
    })
  } catch (error) {
    // exit 1: none of the paths is ignored
    if (error.status !== 1) throw error
    out = error.stdout ?? ''
  }
  return new Set(out.split('\0').filter(Boolean))
}

const sortKeys = (object) => Object.fromEntries(Object.entries(object).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
