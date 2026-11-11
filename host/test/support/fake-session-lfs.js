// An in-memory stand-in for the LayerFS calls the session store uses:
// branch.get/fork/list and file.apply/read/list/stat with LayerFS's bounded
// read windows (2000 lines, 48 KiB, long lines clipped). `faults` can make a
// call apply and then lose its reply, or refuse before applying.
import { createHash } from 'node:crypto'

const LINES = 2000
const BUDGET = 48 * 1024
const id = (prefix, text) => prefix + createHash('sha256').update(text).digest('hex')

export function fakeLayerfs() {
  const branches = new Map([['main', { name: 'main', head: null, base: id('32', 'init'), files: new Map() }]])
  const faults = []
  const calls = []
  const refusal = (code, message) => Object.assign(new Error(message), { code, transport: 'refusal' })
  const lost = () => Object.assign(new Error('LayerFS ended without a complete result'), { code: 'Unknown', transport: 'transport-unknown' })
  const fault = (name) => {
    const i = faults.findIndex((f) => f.call === name)
    return i < 0 ? null : faults.splice(i, 1)[0]
  }
  const get = (name) => {
    const b = branches.get(name)
    if (!b) throw refusal('NoSuchBranch', `no branch ${name}`)
    return b
  }
  const lfs = {
    branches, faults, calls,
    branch: {
      async get(_project, name) { calls.push(['branch.get', name]); const b = get(name); return { name, head: b.head, base: b.base } },
      async fork(_project, name, from) {
        calls.push(['branch.fork', name])
        if (branches.has(name)) throw refusal('BranchExists', name)
        const source = get(from)
        branches.set(name, { name, head: source.head, base: source.base, files: new Map(source.files), dirs: [...(source.dirs ?? ['/'])] })
        return { kind: 'Forked', branch: name, base: source.base, head: source.head }
      },
      async list(_project, { page_size = 50, page_pos = 0 } = {}) {
        const all = [...branches.values()].sort((a, b) => a.name < b.name ? -1 : 1)
        const items = all.slice(page_pos, page_pos + page_size).map((b) => ({ name: b.name, head: b.head, base: b.base }))
        const more = page_pos + page_size < all.length
        return { items, has_more: more, next_page_pos: more ? page_pos + page_size : null }
      },
    },
    file: {
      async apply(_project, name, changes, { message } = {}) {
        calls.push(['file.apply', name, changes.map((c) => c.path)])
        const f = fault('file.apply')
        if (f?.kind === 'refuse') throw refusal('Busy', 'refused before applying')
        const b = get(name)
        const dirs = new Set(b.dirs ?? ['/'])
        for (const c of changes) {
          // as LayerFS: mkdir makes missing parents; a write needs its parent
          const parent = c.path.slice(0, c.path.lastIndexOf('/')) || '/'
          if (c.op === 'mkdir') { for (let p = c.path; p && p !== '/'; p = p.slice(0, p.lastIndexOf('/')) || '/') dirs.add(p); continue }
          if (!dirs.has(parent)) throw Object.assign(refusal('NoSuchPath', 'Content(PathNotFound)'), { detail: { index: changes.indexOf(c) } })
        }
        b.dirs = [...dirs]
        for (const c of changes) if (c.op === 'write') b.files.set(c.path, c.content)
        const parent = b.head
        b.head = id('12', `${b.head}:${message}:${JSON.stringify(changes)}`)
        if (f?.kind === 'lose') throw lost()
        // as LayerFS: a moved head is merged first, and the receipt names the actual parent
        if (f?.kind === 'race') return { kind: 'Committed', branch: name, head: b.head, commit: { id: b.head, parent: f.parent } }
        return { kind: 'Committed', branch: name, head: b.head, commit: { id: b.head, parent } }
      },
      async read(_project, name, path, _commit, { start_line = 1 } = {}) {
        const b = get(name)
        if (!b.files.has(path)) throw refusal('NoSuchPath', path)
        const lines = b.files.get(path).split(/(?<=\n)/)
        let text = '', n = start_line - 1, clipped = false
        while (n < lines.length && n - (start_line - 1) < LINES) {
          let line = lines[n]
          if (Buffer.byteLength(line) > BUDGET) { line = line.slice(0, BUDGET); clipped = true }
          if (text && Buffer.byteLength(text + line) > BUDGET) break
          text += line
          n++
        }
        return { kind: 'ok', text, start_line, line_truncated: clipped, truncated: n < lines.length, next_line: n < lines.length ? n + 1 : null }
      },
      async list(_project, name, dir, _commit, { page_size = 50, page_pos = 0 } = {}) {
        const b = get(name)
        const prefix = `${dir}/`
        const all = [...b.files.keys()].filter((p) => p.startsWith(prefix) && !p.slice(prefix.length).includes('/')).sort()
        if (!all.length) throw refusal('NoSuchPath', dir)
        const items = all.slice(page_pos, page_pos + page_size).map((p) => ({ name: p.slice(prefix.length), path: p, type: 'file' }))
        const more = page_pos + page_size < all.length
        return { kind: 'ok', items, has_more: more, next_page_pos: more ? page_pos + page_size : null }
      },
    },
  }
  return lfs
}
