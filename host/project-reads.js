import { projectRef } from './config.js'
import { commitInfo, savedRef } from './projects.js'
// Saved-query replies have a byte budget as well as an item limit. Twenty
// compact records fit dense merge/publication metadata; PAGE is for list APIs.
export const HISTORY_PAGE_SIZE = 20
const fail = message => Object.assign(new Error(message), { code: 'InvalidInput', status: 400 })
const integer = (q, k, fallback, max = 2000) => {
  const n = Number(q.get(k) ?? fallback)
  if (!Number.isSafeInteger(n) || n < 1 || n > max) throw fail(`${k} must be an integer from 1 to ${max}`)
  return n
}
const reportOptions = async (self, family) => ({ max_objects: 10000, max_canonical_bytes: 67108864, ...(await self.lfs.supportsOption?.(family, 'storage_report', 'include_encoding') ? { include_encoding: true } : {}) })
const pinOf = b => b.saved_head?.id ?? (b.name === 'main' ? b.base : b.head ?? b.base)
const validate = (branch, path) => {
  if (typeof branch !== 'string' || !branch || branch.includes('\0')) throw fail('Name a Branch.')
  if (typeof path !== 'string' || !path.startsWith('/') || path.includes('\0') || path.split('/').includes('..')) throw fail('Use an absolute path.')
}
const saved = async (self, project, branch, pin) => {
  if (pin) {
    if (!/^[0-9a-f]{66}$/.test(pin)) throw fail('A saved pin must be a full 66-hex id.')
    return pin
  }
  return pinOf(await self.lfs.branch.get(project, branch))
}
export const projectReads = {
  async storeStorageReport(name, q) {
    const record = await this.lfs.store.get(name)
    const available = [...new Set(record.projects ?? [])].sort()
    const requested = q.getAll('project')
    if (requested.length > 20 || new Set(requested).size !== requested.length) throw fail('Select 1..20 distinct project names.')
    for (const project of requested) if (!available.includes(project)) throw fail(`Project ${JSON.stringify(project)} does not belong to this Store.`)
    const selected = requested.length ? [...requested].sort() : available.slice(0, 20)
    if (!selected.length) throw Object.assign(fail('This Store has no saved projects to analyze.'), { code: 'Unavailable', status: 409 })
    // Capture one immutable main head per selected project. No history scan or Workspace read.
    const snapshots = []
    for (const project of selected) {
      const key = `${name}/${project}`, head = pinOf(await this.lfs.branch.get(key, 'main'))
      if (typeof head !== 'string' || !/^[0-9a-f]{66}$/.test(head)) throw Object.assign(fail(`Project ${JSON.stringify(project)} has no saved main snapshot.`), { code: 'Unavailable', status: 409 })
      snapshots.push({ project: key, branch: 'main', commit: head })
    }
    let report
    try {
      if (typeof this.lfs.store.storage_report !== 'function') throw Object.assign(new Error('No CLI call store.storage_report'), { code: 'InvalidInput' })
      report = await this.lfs.store.storage_report(name, snapshots, await reportOptions(this, 'store'))
    } catch (error) {
      if (error.code === 'InvalidInput' && error.message === 'No CLI call store.storage_report') throw Object.assign(new Error('This LayerFS CLI does not support bounded Store storage analysis. Select an updated pinned CLI.'), { code: 'Unsupported', status: 501 })
      throw error
    }
    return { ...report, selection: { scope: 'store_main_heads', limit: 20, selected: snapshots.length, availableProjects: available.length, excludedProjects: available.length - selected.length, projects: snapshots.map(snapshot => snapshot.project) } }
  },
  async storageReport(key, q) {
    const { key: project } = projectRef(key)
    const branch = q.get('branch') ?? 'main', size = integer(q, 'size', 20, 20)
    const query = new URLSearchParams({ branch, size: String(size) })
    if (q.has('at')) query.set('at', q.get('at'))
    const page = await projectReads.storageHistory.call(this, project, query, false)
    const snapshots = page.items.map(item => ({ branch, commit: item.id }))
    if (!snapshots.length) throw Object.assign(fail('There are no saved revisions to analyze.'), { code: 'Unavailable', status: 409 })
    let report
    try {
      if (typeof this.lfs.project?.storage_report !== 'function') throw Object.assign(new Error('No CLI call project.storage_report'), { code: 'InvalidInput' })
      report = await this.lfs.project.storage_report(project, snapshots, await reportOptions(this, 'project'))
    } catch (error) {
      if (error.code === 'InvalidInput' && error.message === 'No CLI call project.storage_report') {
        throw Object.assign(new Error('This LayerFS CLI does not support bounded storage analysis. Select an updated pinned CLI to analyze saved revisions.'), { code: 'Unsupported', status: 501 })
      }
      throw error
    }
    return { ...report, selection: { scope: 'project_saved_revisions', limit: size, selected: snapshots.length, hasEarlier: page.next !== null, head: page.head } }
  },
  async storageHistory(key, q, includeStorage = true) {
    const project = projectRef(key).key, branch = q.get('branch') ?? 'main'
    validate(branch, '/')
    const at = q.get('at')
    if (at && !/^[0-9a-f]{66}$/.test(at)) throw fail('A saved pin must be a full 66-hex id.')
    const size = integer(q, 'size', 20, 20)
    const fork = branch === 'main' ? null : (await this.lfs.branch.get(project, branch)).forked_from
    const page = await this.lfs.branch.commits(project, branch, { page: 1, page_size: size, ...(includeStorage ? { include_storage: true } : {}), ...(at ? { at_commit: at } : {}) })
    const all = page.items ?? [], boundary = fork ? all.findIndex(c => c.id === fork) : -1
    const items = boundary < 0 ? all : all.slice(0, boundary)
    const parent = items.at(-1)?.parent
    const head = typeof page.at_commit === 'object' ? page.at_commit : savedRef(page.at_commit ?? at ?? items[0]?.id, branch)
    return { items: items.map(c => commitInfo(c, branch)), head, next: page.has_more && boundary < 0 && parent !== fork ? parent ?? null : null }
  },
  async history(key, q) {
    const project = projectRef(key).key
    const branch = q.get('branch')
    if (!branch) {
      const pos = Number(q.get('pos') ?? 0)
      if (!Number.isSafeInteger(pos) || pos < 0) throw fail('pos must be a nonnegative integer')
      const page = await this.lfs.branch.list(project, { page_size: 100, page_pos: pos })
      const items = [...page.items]
      if (pos === 0 && !items.some(b => b.name === 'main')) items.unshift(await this.lfs.branch.get(project, 'main'))
      return { branches: items.map(b => ({ name: b.name, head: pinOf(b), base: b.base, forkedFrom: b.forked_from ?? null })), next: page.next_page_pos ?? null }
    }
    const commit = q.get('commit')
    if (commit) {
      const c = await this.lfs.branch.get_commit(project, branch, commit)
      const from = q.get('from') ?? c.parent ?? c.base
      if (!from) return { item: commitInfo(c, branch), changes: [], nextChanges: null }
      const diff = await this.lfs.commit.diff(project, from, c.id, { paths_only: true, page_size: 100, ...(q.get('cursor') ? { cursor: q.get('cursor') } : {}) })
      return { item: commitInfo(c, branch), changes: diff.items ?? [], nextChanges: diff.next_cursor ?? null }
    }
    // Resume from the immutable last parent, rather than re-reading a moving head.
    const at = q.get('at') ?? q.get('head')
    const fork = branch === 'main' ? null : (await this.lfs.branch.get(project, branch)).forked_from
    const page = await this.lfs.branch.commits(project, branch, { page: 1, page_size: HISTORY_PAGE_SIZE, ...(at ? { at_commit: at } : {}) })
    const all = page.items ?? []
    const boundary = fork ? all.findIndex(c => c.id === fork) : -1
    const items = boundary < 0 ? all : all.slice(0, boundary)
    const parent = items.at(-1)?.parent
    return { items: items.map(c => commitInfo(c, branch)), head: page.at_commit?.id ?? (typeof page.at_commit === 'string' ? page.at_commit : null) ?? at ?? items[0]?.id ?? null, next: page.has_more && boundary < 0 && parent !== fork ? parent ?? null : null }
  },
  async listDir(key, branch, path, pin, pos = 0) {
    validate(branch, path)
    const project = projectRef(key).key
    const at = await saved(this, project, branch, pin)
    if (!Number.isSafeInteger(Number(pos)) || Number(pos) < 0) throw fail('pos must be a nonnegative integer')
    const page = await this.lfs.file.list(project, branch, path, at, { page_size: 1000, page_pos: Number(pos) })
    return { items: page.items.map(i => ({ name: i.name, path: i.path, kind: i.type ?? 'file', size: i.size ?? null, mode: i.mode ?? null })), next: page.has_more ? page.next_page_pos ?? null : null, at: page.at ?? { id: at } }

  },
  async file(key, branch, path, pin, line = 1) {
    validate(branch, path)
    const project = projectRef(key).key
    const at = await saved(this, project, branch, pin)
    if (!Number.isSafeInteger(Number(line)) || Number(line) < 1) throw fail('line must be a positive integer')
    const stat = await this.lfs.file.stat(project, branch, path, at)
    try {
      const window = await this.lfs.file.read(project, branch, path, at, { start_line: Number(line), end_line: Number(line) + 999 })
      return { ...window, path, size: stat.size, mode: stat.mode, binary: false, at: window.at ?? { id: at } }
    } catch (e) {
      if (e.code === 'Binary') return { path, size: stat.size, binary: true, text: null, at: { id: at } }
      throw e
    }
  },
  async fileQuery(key, q) {
    const project = projectRef(key).key, branch = q.get('branch') ?? 'main', path = q.get('path')
    validate(branch, path)
    const at = await saved(this, project, branch, q.get('pin'))
    const kind = q.get('kind'), pageSize = integer(q, 'size', 50, 1000)
    if (kind === 'blame') return this.lfs.file.blame(project, branch, path, at, { from_line: integer(q, 'line', 1, Number.MAX_SAFE_INTEGER), line_count: 1000 })
    if (kind === 'revisions') return this.lfs.file.revision(project, branch, path, { at_commit: at, traversal: q.get('traversal') ?? 'provenance', page_size: pageSize, ...(q.get('continuation') ? { continuation: q.get('continuation') } : { page: integer(q, 'page', 1) }) })
    if (kind === 'compare' || kind === 'attribution') {
      const left = q.get('left'), rightBranch = q.get('rightBranch') ?? branch
      const leftPin = await saved(this, project, rightBranch, left)
      return this.lfs.file.diff(project, rightBranch, path, branch, path, { left_commit: leftPin, right_commit: at, allow_missing: true, include_attribution: kind === 'attribution', page: integer(q, 'page', 1), page_size: pageSize })
    }
    if (kind === 'branch-diff') {
      const left = await saved(this, project, q.get('rightBranch') ?? branch, q.get('left'))
      return this.lfs.branch.diff(project, q.get('rightBranch') ?? branch, branch, { from_commit: left, to_commit: at, include_attribution: true, path_prefix: path, page_size: pageSize, ...(q.get('continuation') ? { continuation: q.get('continuation') } : { page: integer(q, 'page', 1) }) })
    }
    throw fail('Unknown saved-file query.')
  },
  async branches(key, q) {
    const project = projectRef(key).key
    if (q.get('branch')) return this.lfs.branch.get(project, q.get('branch'))
    const pos = Number(q.get('pos') ?? 0)
    if (!Number.isSafeInteger(pos) || pos < 0) throw fail('pos must be a nonnegative integer')
    const page = await this.lfs.branch.list(project, { page_size: 100, page_pos: pos })
    return { items: page.items.map(b => ({ name: b.name, head: pinOf(b), parent: null, forkedFrom: b.forked_from ?? null, state: 'open', commits: null })), next: page.next_page_pos ?? null }
  },
  async projectStats(key, q) {
    const project = projectRef(key).key, branch = q.get('branch') ?? 'main'
    const at = await saved(this, project, branch, q.get('pin'))
    return { ...await this.lfs.project.stats(project, branch, at), projectKey: project }
  },
}
