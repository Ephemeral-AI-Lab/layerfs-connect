// Deterministic simulated saved-query responses. These model CLI shapes only;
// they do not qualify the real LayerFS content/attribution algorithms.
import { createHash } from 'node:crypto'
const refusal = message => Object.assign(new Error(message), { code: 'InvalidInput' })
const ref = (p, id, branch) => ({ id, kind: p.layers[id] ? 'Layer' : 'Commit', branch: p.layers[id] ? 'main' : p.commits[id]?.branch ?? branch, root: (p.layers[id] ?? p.commits[id])?.root })
const record = (w, p, id, branch) => { const c = p.commits[id] ?? p.layers[id]; if (!c) throw refusal('Unknown saved id'); return { ...w.commitRecord(c), id, branch: p.layers[id] ? 'main' : c.branch ?? branch, parent: c.parent ?? null, time: c.time ?? null, message: c.message ?? null, ref: ref(p, id, branch) } }
const head = (p, branch) => p.branches[branch]?.head ?? p.branches[branch]?.base
const chain = (w, p, id, branch) => { const out = []; for (; id && (p.commits[id] || p.layers[id]);) { const c = record(w, p, id, branch); out.push(c); id = c.parent ?? (!p.layers[id] ? p.commits[id].base : null) } return out }
const paging = (items, a) => { const size = a.page_size ?? 50, pos = a.page_pos ?? ((a.page ?? 1) - 1) * size; return { items: items.slice(pos, pos + size), has_more: pos + size < items.length, next_page_pos: pos + size < items.length ? pos + size : null } }
const owner = (p, id, branch) => ({ ref: ref(p, id, branch), message: p.commits[id]?.message ?? null })
const text = (w, snap, path) => snap.tree[path] ? w.blob(snap.tree[path].blob).toString('utf8') : ''
const facts = (w, snap, path) => snap.tree[path] ? { type: snap.tree[path].type, size: w.sizeOf(snap.tree[path]) } : null
const coverage = { status: 'complete', reasons: [] }
function queryPage(items, a, identity) {
  const hash = createHash('sha256').update(JSON.stringify(identity)).digest('hex')
  let page = a.page ?? 1
  if (a.continuation) {
    const parts = a.continuation.split(':')
    if (parts[0] !== 'lfq1' || parts[1] !== hash || !/^[1-9][0-9]*$/.test(parts[2])) throw refusal('Continuation does not match saved query')
    page = Number(parts[2])
  }
  const out = paging(items, { ...a, page })
  return { ...out, page, page_size: a.page_size ?? 50, end_of_query: !out.has_more, continuation: out.has_more ? `lfq1:${hash}:${page + 1}` : null, scan: { complete: true, reasons: [], candidates_examined: items.length } }
}
export const SAVED_HANDLERS = {
  'branch.diff': (w, a) => {
    const p = w.projectData(a.project), leftId = a.from_commit ?? head(p,a.from_branch), rightId = a.to_commit ?? head(p,a.to_branch), l = w.snapshot(p,a.from_branch,leftId), r = w.snapshot(p,a.to_branch,rightId)
    const items = [...new Set([...Object.keys(l.tree), ...Object.keys(r.tree)])].sort().filter(path => path.startsWith(a.path_prefix ?? '/') && JSON.stringify(l.tree[path]) !== JSON.stringify(r.tree[path])).map(path => ({ path, kind: !l.tree[path] ? 'Added' : !r.tree[path] ? 'Removed' : 'Modified', changes: { content: l.tree[path]?.blob !== r.tree[path]?.blob, attribution: false } }))
    return { ...queryPage(items,a,[a.project,a.from_branch,a.to_branch,leftId,rightId,a.path_prefix,a.include_attribution,a.page_size ?? 50]), coverage: { complete: true } }
  },
  'branch.commits': (w, a) => { const p = w.projectData(a.project), at = a.at_commit ?? head(p, a.branch); return { at_commit: ref(p,at,a.branch), ...paging(chain(w, p, at, a.branch).filter(c => a.branch === 'main' ? !!p.layers[c.id] : !!p.commits[c.id]), a), scan: { complete: true } } },
  'branch.get_commit': (w, a) => record(w, w.projectData(a.project), a.commit, a.branch),
  'store.stats': (w, a) => {
    const s = w.usable(a.name), trees = w.projectsOf(s.name).flatMap(p => [...Object.values(p.layers), ...Object.values(p.commits)])
    const seen = new Set(), history = trees.reduce((n, c) => n + Object.values(c.tree).reduce((n, e) => n + w.sizeOf(e), 0), 0)
    let canonical = 0
    for (const c of trees) for (const e of Object.values(c.tree)) if (e.blob && !seen.has(e.blob)) { seen.add(e.blob); canonical += w.sizeOf(e) }
    const stored = canonical, metadata = trees.reduce((n, c) => n + Object.keys(c.tree).length * 64, 0)
    return { name: a.name, kind: s.kind, history_logical: history, canonical, stored, metadata, file: w.storeBytes(s), free: s.kind === 'postgresql' ? null : 0, init: null }
  },
  'project.stats': (w, a) => { const p = w.projectData(a.project), id = a.commit ?? head(p, a.branch ?? 'main'), snap = w.snapshot(p, a.branch ?? 'main', id), entries = Object.values(snap.tree); return { project: p.name, at: ref(p, id, a.branch ?? 'main'), files: entries.filter(e => e.type === 'file').length, directories: entries.filter(e => e.type === 'dir').length, symlinks: entries.filter(e => e.type === 'symlink').length, others: entries.filter(e => !['file','dir','symlink'].includes(e.type)).length, logical: entries.reduce((n, e) => n + w.sizeOf(e), 0), complete: true } },
  'file.revision': (w, a) => {
    const p = w.projectData(a.project), at = a.at_commit ?? head(p, a.branch)
    const rows = chain(w, p, at, a.branch).flatMap(c => { const current = w.snapshot(p, a.branch, c.id), parent = c.parent ?? (!p.layers[c.id] ? p.commits[c.id].base : null), before = parent ? w.snapshot(p, a.branch, parent) : { tree: {} }; if (current.tree[a.path]?.blob === before.tree[a.path]?.blob && current.tree[a.path]?.type === before.tree[a.path]?.type) return []; return [{ ref: ref(p, c.id, a.branch), compared_to: parent ? ref(p, parent, a.branch) : null, kind: !before.tree[a.path] ? 'Added' : !current.tree[a.path] ? 'Removed' : 'Modified', message: c.message, before: facts(w, before, a.path), after: facts(w, current, a.path), recorded_at: c.time, time_status: c.time ? 'recorded' : 'unavailable' }] })
    return { at: ref(p, at, a.branch), ...queryPage(rows, a, [a.project, a.branch, a.path, at, a.traversal ?? 'provenance', a.page_size ?? 50]) }
  },
  'file.blame': (w, a) => {
    const p = w.projectData(a.project), id = a.commit ?? head(p, a.branch), snap = w.snapshot(p, a.branch, id), data = text(w, snap, a.path)
    if (!snap.tree[a.path]) throw Object.assign(new Error('Path does not exist at saved pin'), { code: 'NoSuchPath' })
    if (data.includes('\0')) throw Object.assign(new Error('Binary file'), { code: 'Binary' })
    const all = data.split('\n'), start = a.from_line ?? 1, end = Math.min(all.length, start + (a.line_count ?? 1000) - 1)
    return { at: ref(p, id, a.branch), lines: all.slice(start - 1, end).map((v, i) => ({ n: start + i, text: v, owner: owner(p, id, a.branch), clipped: false })), coverage, comparison_coarse: false, next_line: end < all.length ? end + 1 : null }
  },
  'file.diff': (w, a) => {
    const p = w.projectData(a.project), leftId = a.left_commit ?? head(p, a.left_branch), rightId = a.right_commit ?? head(p, a.right_branch), l = w.snapshot(p, a.left_branch, leftId), r = w.snapshot(p, a.right_branch, rightId), left = text(w, l, a.left_path), right = text(w, r, a.right_path)
    const lines = left === right ? left.split('\n').map((text,i) => ({ op: ' ', text, left_line: i + 1, right_line: i + 1, before_owner: a.include_attribution ? owner(p,leftId,a.left_branch) : null, after_owner: a.include_attribution ? owner(p,rightId,a.right_branch) : null, owner_changed: a.include_attribution ? leftId !== rightId : null })) : [...left.split('\n').map((text,i) => ({ op: '-', text, left_line: i + 1, right_line: null })), ...right.split('\n').map((text,i) => ({ op: '+', text, left_line: null, right_line: i + 1 }))]
    return { kind: left === right ? 'Equal' : 'Text', before: facts(w,l,a.left_path), after: facts(w,r,a.right_path), content_coverage: coverage, attribution_coverage: a.include_attribution ? coverage : { status: 'not_requested' }, omission_reason: null, hunks_omitted: true, rows: paging(lines,a).items, has_more: paging(lines,a).has_more }
  },
}
