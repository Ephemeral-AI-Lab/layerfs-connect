// Stateful test-only CLI model. Stores the bytes and graph created by each call;
// verification reads these records rather than the recipe's expected result.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

export class DemoHistory {
  constructor() { this.projects = new Map(); this.serial = 0 }
  init(project, folder) {
    const files = {}
    const visit = (root, prefix = '') => { for (const name of readdirSync(root)) { const path = prefix ? `${prefix}/${name}` : name, file = join(root, name); if (statSync(file).isDirectory()) visit(file, path); else files[path] = readFileSync(file, 'utf8') } }
    visit(folder)
    const layer = { id: `layer-${++this.serial}`, parent: null, source_commit: null, source_branch: null, overwrote_count: 0 }
    this.projects.set(project, { branches: new Map([['main', { files, history: [], baseFiles: structuredClone(files), base: layer.id }]]), layers: [layer], trees: new Map() })
  }
  removeStore(store) { for (const name of this.projects.keys()) if (name.startsWith(`${store}/`)) this.projects.delete(name) }
  invoke(argv, options = {}) {
    const [family, call, project, name, left, right] = argv, state = this.projects.get(project)
    if (!state) throw new Error(`Missing test project ${project}`)
    const branch = state.branches.get(name)
    const option = (flag, fallback) => argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : fallback
    const listPage = items => {
      const position = Number(option('--page-pos', 0)), size = Number(option('--page-size', items.length || 1))
      const next = position + size < items.length ? position + size : null
      return { items: items.slice(position, position + size), next_page_pos: next, has_more: next != null }
    }
    if (family === 'branch' && call === 'list') return listPage([...state.branches].map(([name, value]) => ({ name, head: value.history[0]?.id ?? null, base: value.base })))
    if (family === 'commit' && call === 'list') return { items: structuredClone(branch.history), next_page_pos: null }
    if (family === 'branch' && call === 'commits') {
      const all = name === 'main' ? state.layers : branch.history, requestedAnchor = option('--at-commit', null)
      const anchor = requestedAnchor ?? all[0]?.id ?? branch.base
      const start = requestedAnchor ? all.findIndex(item => item.id === requestedAnchor) : 0
      if (requestedAnchor && start < 0) throw new Error(`Unknown saved anchor ${requestedAnchor}`)
      const items = all.slice(Math.max(0, start)), size = Number(option('--page-size', 50)), page = Number(option('--page', 1)), offset = (page - 1) * size
      return { branch: name, at_commit: { id: anchor, kind: name === 'main' ? 'Layer' : 'Commit' }, items: structuredClone(items.slice(offset, offset + size)), page, page_size: size, scan: { complete: true }, has_more: offset + size < items.length }
    }
    if (family === 'branch' && call === 'fork') {
      const source = state.branches.get(left)
      if (!source) throw new Error(`Missing fork source ${left}`)
      state.branches.set(name, { files: structuredClone(source.files), baseFiles: structuredClone(source.files), history: left === 'main' ? [] : structuredClone(source.history), base: left === 'main' ? state.layers[0].id : source.base })
      return { kind: 'Forked' }
    }
    if (family === 'branch' && call === 'publish') {
      const source = left ?? branch.history[0]?.id
      if (!branch.history.some(commit => commit.id === source)) throw new Error(`Commit ${source} is not on ${name}'s history`)
      if (source !== branch.history[0]?.id) throw Object.assign(new Error('Publication commit must still be the branch head'), { code: 'HeadMoved' })
      const files = state.trees.get(source)
      state.layers.unshift({ id: `layer-${++this.serial}`, parent: state.layers[0].id, source_branch: name, source_commit: source, overwrote_count: 0 })
      state.branches.set('main', { files: { ...files }, history: [], baseFiles: { ...files }, base: state.layers[0].id })
      return { kind: 'Added', source: { branch: name, commit: source }, overwrote_count: 0 }
    }
    if (family === 'branch' && call === 'merge') {
      const a = state.branches.get(left), b = state.branches.get(right), files = structuredClone(a.files)
      for (const [path, content] of Object.entries(b.files)) if (b.baseFiles[path] !== content) files[path] = content
      const commit = { id: `commit-${++this.serial}`, parent: left === 'main' ? null : a.history[0]?.id ?? null, second_parent: b.history[0]?.id ?? null, base: left === 'main' ? state.layers[0].id : a.base }
      state.branches.set(name, { files, baseFiles: structuredClone(a.files), history: [commit, ...structuredClone(a.history)], base: commit.base })
      state.trees.set(commit.id, { ...files })
      return { kind: 'Merged', head: commit.id, fast_forward: false, sources: [{ ref: left }, { ref: right }] }
    }
    const path = left?.replace(/^\//, '')
    if (family === 'file' && call === 'write') {
      const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
      if (parent && !Object.keys(branch.files).some(file => file.startsWith(`${parent}/`))) throw Object.assign(new Error(`Parent directory does not exist: ${parent}`), { code: 'NoSuchPath' })
      const content = options.input
      if (branch.files[path] === content) return { kind: 'UpToDate', head: branch.history[0]?.id }
      branch.files[path] = content
      const commit = { id: `commit-${++this.serial}`, parent: branch.history[0]?.id ?? null, second_parent: null, base: branch.base }
      branch.history.unshift(commit)
      state.trees.set(commit.id, { ...branch.files })
      return { kind: 'Committed', head: commit.id }
    }
    if (family === 'file' && call === 'read') return { text: branch.files[path], truncated: false }
    if (family === 'file' && call === 'stat') return { size: Buffer.byteLength(branch.files[path] ?? '') }
    if (family === 'file' && call === 'glob') {
      const paths = new Set(Object.keys(branch.files))
      for (const path of Object.keys(branch.files)) {
        const parts = path.split('/')
        for (let depth = 1; depth < parts.length; depth++) paths.add(parts.slice(0, depth).join('/'))
      }
      return listPage([...paths].map(path => `/${path}`))
    }
    throw new Error(`Unexpected test history command ${argv.join(' ')}`)
  }
}
