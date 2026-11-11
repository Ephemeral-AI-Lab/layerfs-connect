// LayerFS operations as a conversation records them (docs/specs/chat-session-store.md).
// One supported-call table decides which operations can link saved versions;
// receipts alone decide which versions they link. No string prefix, `ok: true`,
// later branch head or timestamp grants a checkpoint.

/** SDK/CLI method -> canonical class. Only these classes can carry checkpoint links. */
export const CANONICAL = Object.freeze({
  'file.write': 'fs.write_like',
  'file.edit': 'fs.write_like',
  'file.apply': 'fs.write_like',
  'file.rm': 'fs.write_like',
  'file.mkdir': 'fs.write_like',
  'file.mv': 'fs.write_like',
  'file.cp': 'fs.write_like',
  // internal Store method names of the same calls (older trace lines use them)
  'fs.write': 'fs.write_like',
  'fs.edit': 'fs.write_like',
  'fs.apply': 'fs.write_like',
  'fs.rm': 'fs.write_like',
  'fs.mkdir': 'fs.write_like',
  'fs.mv': 'fs.write_like',
  'fs.cp': 'fs.write_like',
  'workspace.commit': 'workspace.commit',
  'branch.fork': 'branch.fork',
  'branch.merge': 'branch.merge',
  'branch.publish': 'branch.publish',
})

export const canonical = (method) => CANONICAL[method] ?? null
export const eligible = (method) => canonical(method) !== null

const text = (v) => (typeof v === 'string' && v.length > 0 ? v : null)

/** `<store>/<project>` -> its two API identifiers; null when it is not one. */
export function projectIds(key) {
  const value = text(key)
  const at = value ? value.indexOf('/') : -1
  if (at <= 0 || at === value.length - 1) return null
  return { store_id: value.slice(0, at), project_id: value.slice(at + 1) }
}

/** A complete SavedVersionRef, or null when any identity is missing. */
export function versionRef(project, branch, commit, kind) {
  const ids = typeof project === 'string' ? projectIds(project) : project
  if (!ids || !text(branch) || !text(commit) || (kind !== 'Commit' && kind !== 'Layer')) return null
  return { store_id: ids.store_id, project_id: ids.project_id, branch_id: branch, commit_id: commit, version_kind: kind }
}

export const refKey = (ref) => ref ? [ref.store_id, ref.project_id, ref.branch_id, ref.commit_id, ref.version_kind].join('\u0000') : ''
export const sameVersion = (a, b) => !!a && !!b && a.store_id === b.store_id && a.project_id === b.project_id && a.commit_id === b.commit_id && a.version_kind === b.version_kind

/** Definite refusals change nothing; anything else that did not answer is unknown. */
export function errorStatus(error) {
  if (!error) return 'succeeded'
  return ['refusal', 'usage-incompatible', 'unavailable'].includes(error.transport) ? 'failed' : 'unknown'
}

export function errorFacts(error) {
  if (!error) return null
  return { code: error.code ?? 'Unknown', message: String(error.message ?? error), transport: error.transport ?? null, detail: error.detail ?? null }
}

/**
 * The typed result of one finished operation.
 * @param {object} o
 * @param {string} o.method   e.g. `file.write`, `workspace.commit`
 * @param {object} o.args     named arguments as the call received them
 * @param {object} [o.value]  the call's answer
 * @param {object} [o.error]  its refusal or failure
 * @param {object} [o.mount]  confirmed mount facts for a Workspace call: { project, branch, base_layer? }
 * @returns {{ canonical: string|null, status: string, checkpoints: object[], inputs: object[], pending: object[], unresolved: string|null, outcome: string|null }}
 */
export function normalize({ method, args = {}, value = null, error = null, mount = null }) {
  const cls = canonical(method)
  const status = errorStatus(error)
  const result = { canonical: cls, status, checkpoints: [], inputs: [], pending: [], unresolved: null, outcome: error ? (error.code ?? 'Unknown') : text(value?.kind) ?? (Number.isInteger(value?.exit_code) ? `exit:${value.exit_code}` : null) }
  if (!cls || status !== 'succeeded') {
    if (cls && status === 'unknown') result.unresolved = 'No confirmed receipt; reconcile before relying on this operation.'
    return result
  }
  const link = (ref, effect) => { if (ref) result.checkpoints.push({ ref, effect }) }
  const project = args.project ?? mount?.project ?? null
  if (cls === 'fs.write_like') {
    const branch = text(value?.branch) ?? text(args.branch)
    const head = text(value?.head) ?? text(value?.commit?.id)
    if (value?.kind === 'Committed') link(versionRef(project, branch, head, 'Commit'), 'created')
    else if (value?.kind === 'UpToDate' && head) link(versionRef(project, branch, head, 'Commit'), 'unchanged')
    else result.unresolved = value?.kind === 'UpToDate' ? 'Unchanged on a branch without Commits; the receipt does not name its base Layer.' : `Unrecognized write result ${value?.kind ?? 'without kind'}.`
  } else if (cls === 'workspace.commit') {
    const branch = text(mount?.branch)
    if (!branch || !projectIds(project)) result.unresolved = 'No confirmed mount facts name this Workspace’s project and branch.'
    else if (value?.kind === 'Committed') link(versionRef(project, branch, text(value.head) ?? text(value.commit?.id), 'Commit'), 'created')
    else if (value?.kind === 'UpToDate' && text(value.head)) link(versionRef(project, branch, value.head, 'Commit'), 'unchanged')
    else if (value?.kind === 'UpToDate' && text(mount?.base_layer)) link(versionRef(project, branch, mount.base_layer, 'Layer'), 'unchanged')
    else result.unresolved = value?.kind === 'UpToDate' ? 'Unchanged before any Commit; the Workspace base Layer was not confirmed.' : `Unrecognized commit result ${value?.kind ?? 'without kind'}.`
  } else if (cls === 'branch.fork') {
    const branch = text(value?.branch) ?? text(args.name)
    const start = text(value?.head) ? { id: value.head, kind: 'Commit' } : text(value?.base) ? { id: value.base, kind: 'Layer' } : null
    if (!start) result.unresolved = 'The fork receipt names no starting version.'
    else {
      link(versionRef(project, branch, start.id, start.kind), 'referenced')
      // from a branch: that branch admits the same version. From an id: the Store resolves the
      // id's own context, so only a caller's confirmed saved reference names it.
      if (!text(args.from_commit)) {
        const ref = versionRef(project, text(args.from_branch) ?? 'main', start.id, start.kind)
        if (ref) result.inputs.push(ref)
      }
      for (const ref of mount?.inputs ?? []) if (ref?.commit_id === start.id) result.inputs.push(ref)
    }
  } else if (cls === 'branch.merge') {
    const head = text(value?.head)
    if (head) link(versionRef(project, text(value?.branch) ?? text(args.name), head, 'Commit'), value?.fast_forward ? 'referenced' : 'created')
    else result.unresolved = 'The merge receipt names no result Commit.'
    for (const source of Array.isArray(value?.sources) ? value.sources : []) {
      const ref = text(source?.ref), node = text(source?.node)
      if (!ref || !node) continue
      // main's node is its head Layer; a side branch's is its head Commit, or its base Layer when it has none
      if (ref === 'main') result.inputs.push(versionRef(project, ref, node, 'Layer'))
      else if (node === head && value?.fast_forward) result.inputs.push(versionRef(project, ref, node, 'Commit'))
      else result.pending.push({ project, branch: ref, commit: node, role: 'merge-source' })
    }
    result.inputs = result.inputs.filter(Boolean)
  } else if (cls === 'branch.publish') {
    if (value?.kind === 'Added') {
      link(versionRef(project, 'main', text(value.published_layer?.id), 'Layer'), 'published')
      const source = versionRef(project, text(value.source?.branch) ?? text(args.branch), text(value.source?.commit), 'Commit')
      if (source) result.inputs.push(source)
    } else if (value?.kind === 'UpToDate') {
      link(versionRef(project, 'main', text(value.layer), 'Layer'), 'unchanged')
      const source = versionRef(project, text(args.branch), text(args.commit), 'Commit')
      if (source) result.inputs.push(source)
    } else if (value?.kind === 'NoChanges') link(versionRef(project, 'main', text(value.head_layer), 'Layer'), 'unchanged')
    else result.unresolved = `Unrecognized publish result ${value?.kind ?? 'without kind'}.`
  }
  if (!result.checkpoints.length && !result.unresolved) result.unresolved = 'The receipt did not contain a complete saved-version identity.'
  return result
}

/** Pending merge-source kinds, resolved through `branch.get_commit` in the source branch's context. */
export async function resolvePending(lfs, pending) {
  const inputs = [], failures = []
  for (const item of pending) {
    try {
      const detail = await lfs.branch.get_commit(item.project, item.branch, item.commit)
      const kind = detail?.ref?.kind
      const ref = versionRef(item.project, item.branch, item.commit, kind)
      if (ref) inputs.push(ref)
      else failures.push({ ...item, reason: 'get_commit returned no typed ref' })
    } catch (error) { failures.push({ ...item, reason: `${error.code ?? 'Unknown'}: ${error.message}` }) }
  }
  return { inputs, failures }
}

/** Arguments with bodies replaced by their sizes (bounded preview; the full receipt is an artifact). */
const BODIES = new Set(['content', 'old', 'new', 'changes', 'stdout', 'stderr', 'units'])
export function shownArguments(args) {
  const out = {}
  for (const [k, v] of Object.entries(args ?? {})) {
    if (v === undefined || typeof v === 'function') continue
    if (BODIES.has(k)) {
      out[`${k}_bytes`] = typeof v === 'string' ? Buffer.byteLength(v) : ArrayBuffer.isView(v) ? v.byteLength : Buffer.byteLength(JSON.stringify(v) ?? '')
      if (Array.isArray(v)) out[`${k}_count`] = v.length
      continue
    }
    out[k] = typeof v === 'string' && v.length > 2000 ? `${v.slice(0, 1999)}…` : v
  }
  return out
}
