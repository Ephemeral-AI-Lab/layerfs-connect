// A project's history in a form two runs can be compared by: each Branch's
// Commits in first-parent order (their messages, how they were made and what
// they merged), where each Branch was forked from, and which Commit each Layer
// of main published. Ids differ between runs, so a node is named by its place:
// "L3" is main's fourth Layer (L0 is Init's), "orders#2" the third Commit on
// orders. A recorded run's history is in its scenario's final.json; a run's
// must equal it (the order check). Ported from dsh-layerfs tools/checks/history.mjs.

async function pages(read) {
  const items = []
  for (let pos = 0; ; ) {
    const page = await read(1000, pos)
    items.push(...page.items)
    if (!page.hasMore) return items
    pos += page.items.length
  }
}

/** The prefix of the Branch the final-tree check forks from main to read its bytes (tree.js); not part of a run. */
export const CHECK_PREFIX = 'final-tree-check-'

/**
 * Reads the history of the project `lf` names.
 * @param {object} lf LayerFS client (@layerfs/agent)
 * @param {object} backend its LayerFSBackend (@layerfs/backend), for the Layers
 * @returns {Promise<{ branches: Record<string, { forkedFrom: string | null, commits: object[] }>, layers: object[], ids: Map<string, string>, items: Map<string, object> }>}
 */
export async function historyOf(lf, backend) {
  const snap = await backend.store.project.get_history()
  if (snap.moreLayers) throw new Error('more Layers than one History read lists')
  // main's Layers from Init's, each the parent of the next
  const byParent = new Map(snap.layers.map((l) => [l.parent ?? null, l]))
  const layers = []
  for (let l = byParent.get(null); l; l = byParent.get(l.id)) layers.push(l)
  if (layers.length !== snap.layers.length) throw new Error("main's Layers are not one line")
  const ids = new Map(layers.map((l, i) => [l.id, `L${i}`]))

  const branches = (await pages((size, pos) => lf.project.list_branches(size, pos))).filter(
    (b) => b.name !== 'main' && !b.name.startsWith(CHECK_PREFIX),
  )
  const chains = {}
  for (const b of branches) {
    // a Branch made by a merge lists its first input's Commits too, up to the
    // one it was forked from; those belong to that input
    const listed = await pages((size, pos) => lf.branch.list_commits(b.name, size, pos))
    const cut = listed.findIndex((c) => c.id === b.forkedFrom)
    const newest = cut < 0 ? listed : listed.slice(0, cut)
    chains[b.name] = { branch: b, commits: newest.reverse() }
    chains[b.name].commits.forEach((c, i) => ids.set(c.id, `${b.name}#${i}`))
  }
  const name = (id) => (id == null ? null : (ids.get(id) ?? `unknown:${id}`))
  const out = { branches: {}, layers: layers.map((l, i) => (i === 0 ? { source: null } : { source: name(l.sourceCommit) })) }
  for (const [branch, { branch: b, commits }] of Object.entries(chains).sort(([x], [y]) => (x < y ? -1 : 1))) {
    out.branches[branch] = {
      forkedFrom: name(b.forkedFrom ?? b.base),
      commits: commits.map((c) => ({ id: c.id, message: c.message, via: c.via, merged: name(c.secondParent) })),
    }
  }
  const items = new Map(Object.values(chains).flatMap(({ commits }) => commits.map((c) => [c.id, c])))
  return { ...out, ids, items }
}

/**
 * Differences between a recorded history and a run's, as messages. A
 * recorded Commit marked `optional` (a command step whose changes were all
 * generated files: Committed or UpToDate) may be missing from the run, and a
 * Branch's `extras` (a recorded UpToDate, after its `after`-th Commit) may be
 * present in it; the returned array's `extras` names those the run has, which
 * the caller must show change no tracked file.
 */
export function compareHistory(recorded, run) {
  const failures = []
  const names = new Set([...Object.keys(recorded.branches), ...Object.keys(run.branches)])
  // a recorded name ("orders#3") is the run's name after missing optional Commits
  const shift = new Map()
  const extras = []
  for (const branch of names) {
    const want = recorded.branches[branch]
    const got = run.branches[branch]
    if (!want) {
      failures.push(`Branch ${branch} is not in the record`)
      continue
    }
    if (!got) {
      failures.push(`Branch ${branch} is missing`)
      continue
    }
    let j = 0
    const extra = (i) => {
      for (const e of want.extras ?? []) if (e.after === i && got.commits[j]?.message === e.message) extras.push(`${branch}#${j++}`)
    }
    extra(-1)
    want.commits.forEach((c, i) => {
      const actual = got.commits[j]
      if (actual && actual.message === c.message) {
        shift.set(`${branch}#${i}`, `${branch}#${j}`)
        j++
      }
      // a missing optional first Commit leaves the Branch at its fork point
      else if (c.optional) shift.set(`${branch}#${i}`, j ? `${branch}#${j - 1}` : { base: branch })
      else failures.push(`${branch}#${i}: recorded "${c.message}", the run has ${actual ? `"${actual.message}"` : 'no Commit'} there`)
      extra(i)
    })
    if (j < got.commits.length) failures.push(`${branch}: ${got.commits.length - j} Commit(s) after the recorded ones, first "${got.commits[j].message}"`)
  }
  const mapped = (ref) => {
    const to = ref && shift.has(ref) ? shift.get(ref) : ref
    return to?.base ? mapped(recorded.branches[to.base].forkedFrom) : to
  }
  for (const branch of names) {
    const want = recorded.branches[branch]
    const got = run.branches[branch]
    if (!want || !got) continue
    if (mapped(want.forkedFrom) !== got.forkedFrom) failures.push(`${branch} forked from ${got.forkedFrom}, recorded ${want.forkedFrom}`)
    want.commits.forEach((c, i) => {
      const at = shift.get(`${branch}#${i}`)
      const k = typeof at === 'string' && Number(at.split('#')[1])
      if (typeof at === 'string' && at.startsWith(`${branch}#`) && got.commits[k]?.message === c.message) {
        const actual = got.commits[k]
        if (actual.via !== c.via) failures.push(`${branch}#${i} "${c.message}" was made by ${actual.via}, recorded ${c.via}`)
        if (mapped(c.merged) !== actual.merged) failures.push(`${branch}#${i} "${c.message}" merged ${actual.merged}, recorded ${c.merged}`)
      }
    })
  }
  if (recorded.layers.length !== run.layers.length) failures.push(`main has ${run.layers.length} Layers, recorded ${recorded.layers.length}`)
  recorded.layers.forEach((l, i) => {
    const got = run.layers[i]
    if (got && mapped(l.source) !== got.source) failures.push(`L${i} published ${got.source}, recorded ${l.source}`)
  })
  failures.extras = extras
  return failures
}
