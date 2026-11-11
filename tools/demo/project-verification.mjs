import { projectHistoryPlan, projectHistorySteps, assertProjectStep } from './recipe.mjs'

const fail = message => { throw Object.assign(new Error(message), { code: 'PresetVerificationFailed' }) }
const PAGE_SIZE = 20
const idOf = value => typeof value === 'string' ? value : value?.id

/** Fully read one immutable saved history. Small pages preserve complete activity output. */
export async function savedHistory(query, project, branch) {
  const items = [], ids = new Set(); let page = 1, anchor = null
  while (true) {
    const argv = ['branch', 'commits', project, branch, '--page', String(page), '--page-size', String(PAGE_SIZE)]
    if (anchor) argv.push('--at-commit', anchor)
    const result = await query(argv)
    if (!Array.isArray(result?.items) || result.scan?.complete === false) fail(`${project}/${branch}: incomplete saved history page`)
    const returnedAnchor = idOf(result.at_commit)
    if (anchor && returnedAnchor && returnedAnchor !== anchor) fail(`${project}/${branch}: saved history anchor moved`)
    anchor ??= returnedAnchor
    for (const item of result.items) {
      const id = idOf(item.ref) ?? item.id
      if (!id || ids.has(id)) fail(`${project}/${branch}: duplicate or missing saved history ID`)
      ids.add(id); items.push({ ...item, id })
    }
    if (!result.has_more) break
    if (!anchor || !result.items.length) fail(`${project}/${branch}: saved history continuation is missing its immutable anchor`)
    page++
  }
  return items
}

/** Read actual saved files and graph records. Does not execute application code. */
export async function verifyProject(query, store, name, receipt, options = {}) {
  const project = `${store}/${name}`, plan = projectHistoryPlan(name, options), receipts = receipt?.steps ?? receipt
  const list = async argv => {
    const items = []; let position = 0
    do {
      const result = await query([...argv, '--page-size', String(PAGE_SIZE), '--page-pos', String(position)])
      if (!Array.isArray(result?.items)) fail(`${project}: invalid list response for ${argv.join(' ')}`)
      items.push(...result.items)
      const next = result.next_page_pos
      if (result.has_more && next == null) fail(`${project}: incomplete resource page`)
      if (next != null && (next === position || !result.items.length)) fail(`${project}: resource pagination did not advance`)
      position = next ?? null
    } while (position !== null)
    return items
  }
  const branches = await list(['branch', 'list', project]), byName = new Map(branches.map(branch => [branch.name, branch]))
  const expectedNames = ['main', ...plan.branches]
  if (branches.length !== expectedNames.length || byName.size !== expectedNames.length || expectedNames.some(branch => !byName.has(branch))) fail(`${project}: expected ${expectedNames.length} retained branches`)
  const histories = new Map(), unique = new Map()
  for (const branch of plan.branches) {
    const commits = await savedHistory(query, project, branch)
    histories.set(branch, commits)
    for (const commit of commits) unique.set(commit.id, commit)
    if (commits[0]?.id !== idOf(byName.get(branch).head)) fail(`${project}/${branch}: saved head does not match history`)
  }
  if (unique.size !== plan.commits) fail(`${project}: expected ${plan.commits} distinct Commits, found ${unique.size}`)
  const main = await savedHistory(query, project, 'main')
  if (main.length !== plan.layers) fail(`${project}: expected ${plan.layers} complete main publication Layers, found ${main.length}`)

  // Assign each recipe mutation to its persisted own-branch Commit. Do not sum shared ancestry.
  const steps = projectHistorySteps(store, name, options).map(step => step.historyArgv ? { ...step, argv: step.historyArgv } : step), ownCounts = new Map()
  for (const step of steps) if (step.argv[1] === 'write' || step.argv[1] === 'merge') ownCounts.set(step.argv[3], (ownCounts.get(step.argv[3]) ?? 0) + 1)
  const own = new Map(), assignedIds = new Set()
  for (const [branch, count] of ownCounts) {
    const history = histories.get(branch)
    if (history.length < count) fail(`${project}/${branch}: missing own-branch saved Commits`)
    const records = history.slice(0, count).reverse()
    own.set(branch, { records, index: 0 })
    for (const record of records) {
      if (assignedIds.has(record.id)) fail(`${project}: distinct recipe mutations share a saved Commit`)
      assignedIds.add(record.id)
    }
  }
  if (assignedIds.size !== plan.commits || [...unique.keys()].some(id => !assignedIds.has(id))) fail(`${project}: saved graph does not match unique recipe mutations`)
  const heads = new Map(), bases = new Map(), publicationRows = [...main].reverse()
  let mainLayer = publicationRows.shift()?.id, publications = 0, merges = 0, writes = 0
  const receiptIds = new Set()
  for (const step of steps) {
    const [, call, , branch, left, right] = step.argv, result = receipts?.[step.key]
    if (receipts) assertProjectStep(step, result)
    if (call === 'fork') {
      heads.set(branch, left === 'main' ? null : heads.get(left))
      bases.set(branch, left === 'main' ? mainLayer : bases.get(left))
      continue
    }
    if (call === 'write' || call === 'merge') {
      const sequence = own.get(branch), record = sequence.records[sequence.index++]
      if (call === 'merge') {
        merges++
        const expectedParent = left === 'main' ? null : heads.get(left)
        if ((idOf(record.parent) ?? null) !== (expectedParent ?? null) || idOf(record.second_parent) !== heads.get(right)) fail(`${project}/${branch}: merge did not preserve both expected parents`)
        bases.set(branch, left === 'main' ? mainLayer : bases.get(left))
        if (receipts) {
          const sources = result.sources ?? []
          if (sources.length !== 2 || sources[0].ref !== left || sources[1].ref !== right) fail(`${project}/${branch}: merge receipt sources do not match the recipe`)
          for (const [index, ref] of [[0, left], [1, right]]) {
            const expected = ref === 'main' ? mainLayer : heads.get(ref)
            if (sources[index].node && idOf(sources[index].node) !== expected) fail(`${project}/${branch}: merge receipt source node does not match saved history`)
          }
        }
      } else {
        writes++
        if ((idOf(record.parent) ?? null) !== (heads.get(branch) ?? null) || record.second_parent != null) fail(`${project}/${branch}: write Commit has unexpected ancestry`)
      }
      if (record.base && idOf(record.base) !== bases.get(branch)) fail(`${project}/${branch}: saved Commit has an unexpected base Layer`)
      heads.set(branch, record.id)
      if (receipts) {
        if (result.head !== record.id) fail(`${project}/${branch}: successful mutation receipt does not match saved Commit history`)
        receiptIds.add(result.head)
      }
      continue
    }
    if (call === 'publish') {
      const layer = publicationRows.shift(), source = heads.get(branch)
      if (!layer || layer.source_branch !== branch || layer.source_commit !== source) fail(`${project}/${branch}: publication provenance does not match the recipe`)
      if (layer.overwrote_count != null && layer.overwrote_count !== 0) fail(`${project}/${branch}: publication overwrote main Layers`)
      if (layer.parent != null && idOf(layer.parent) !== mainLayer) fail(`${project}: main publication Layer chain is broken`)
      if (receipts && (result.source?.branch !== branch || result.source?.commit !== source)) fail(`${project}/${branch}: publication receipt does not match saved Layer provenance`)
      if (receipts && result.published_layer?.id && result.published_layer.id !== layer.id) fail(`${project}/${branch}: publication receipt has a different Layer ID`)
      mainLayer = layer.id; publications++
    }
  }
  if (publicationRows.length || publications !== plan.publications || merges !== plan.merges || writes !== plan.writes) fail(`${project}: saved graph operation counts do not match the recipe`)
  if (receipts && receiptIds.size !== unique.size) fail(`${project}: successful mutation receipts do not match all saved Commits`)

  let files = 0
  const readExact = async (branch, path, content) => {
    const result = await query(['file', 'read', project, branch, `/${path}`])
    if (result.text !== content || result.truncated || result.line_truncated) fail(`${project}/${branch}/${path}: saved content does not match the recipe`)
    files++
  }
  for (const [path, content] of Object.entries(plan.expectedMain)) await readExact('main', path, content)
  const mainPaths = new Set((await list(['file', 'glob', project, 'main', '/', '**'])).map(path => path.replace(/^\//, '')))
  const expectedPaths = new Set(Object.keys(plan.expectedMain))
  for (const path of Object.keys(plan.expectedMain)) {
    const parts = path.split('/')
    for (let depth = 1; depth < parts.length; depth++) expectedPaths.add(parts.slice(0, depth).join('/'))
  }
  if (mainPaths.size !== expectedPaths.size || [...mainPaths].some(path => !expectedPaths.has(path))) fail(`${project}: main file and directory inventory does not match the recipe`)
  for (const item of plan.definition.explorations) {
    const expected = new Map(item.commits.map(commit => [commit.path, commit.content]))
    for (const [path, content] of expected) await readExact(item.name, path, content)
    for (const path of expected.keys()) if (!Object.hasOwn(plan.expectedMain, path) && mainPaths.has(path)) fail(`${project}: unfinished ${item.name}/${path} was unexpectedly published`)
  }
  return { project, tier: plan.tier, cycles: plan.cycles, branches: branches.length, commits: unique.size, merges, publications, layers: main.length, filesVerified: files, publicationReceiptsVerified: !!receipts }
}

/** First-page read plan; execution follows every immutable continuation. */
export function projectVerificationSteps(store, name, options = {}) {
  const project = `${store}/${name}`, plan = projectHistoryPlan(name, options), commands = []
  const add = argv => commands.push({ argv })
  add(['branch', 'list', project, '--page-size', String(PAGE_SIZE), '--page-pos', '0'])
  for (const branch of [...plan.branches, 'main']) add(['branch', 'commits', project, branch, '--page', '1', '--page-size', String(PAGE_SIZE)])
  for (const path of Object.keys(plan.expectedMain)) add(['file', 'read', project, 'main', `/${path}`])
  add(['file', 'glob', project, 'main', '/', '**', '--page-size', String(PAGE_SIZE), '--page-pos', '0'])
  for (const item of plan.definition.explorations) for (const path of new Set(item.commits.map(commit => commit.path))) add(['file', 'read', project, item.name, `/${path}`])
  return commands
}
