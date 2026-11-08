/** Local visualization fixtures, not LayerFS observations or an SDK implementation. */
import type { BranchInfo, FsEntry } from '@/layerfs/host-api'
import { alignAttribution } from './attribution-model'

export interface PreviewFile {
  text: string | null
  size: number
  inode: number
  mode: string
}
export interface PreviewCommit {
  id: string
  branch: string
  message: string
  time: string
  operation: 'Init' | 'Publish' | 'File write' | 'Workspace commit'
  parent: string | null
  source?: string
  tree: Record<string, PreviewFile>
}
export interface PreviewChange {
  path: string
  kind: 'Added' | 'Removed' | 'Modified'
  content: boolean
  metadata: boolean
  identity: boolean
}
export interface PreviewLine { op: ' ' | '+' | '-'; text: string; left: number | null; right: number | null }
const id = (kind: string, seed: string) => kind + seed.padEnd(64, seed)
const ids = {
  init: id('32', '9e41d7c3'), published: id('32', '4c92be10'), main: id('32', 'a81e30f2'),
  login: id('12', '5c2e8a90'), token: id('12', 'b7d04e11'), errors: id('12', '3f9a1c2e'),
  tests: id('12', 'c840a291'), docs: id('12', 'e72f108b'), orders: id('12', '6d1c90a4'),
  review: id('12', '8af210d6'),
  tracing: id('12', 'f104ac21'), responses: id('12', '2d614a87'),
}
const file = (text: string, inode: number, mode = '0644'): PreviewFile => ({ text, size: new TextEncoder().encode(text).length, inode, mode })
const originalLogin = `export function login(req, res) {
  const user = req.body?.username

  if (!user) {
    res.writeHead(400)
    return res.end('Username required')
  }

  res.writeHead(200)
  res.end('Welcome, ' + user)
}
`
const requestLogin = originalLogin.replace("  const user = req.body?.username", "  const user = req.body?.username\n  res.setHeader('X-Request-ID', req.id)")
const coreLogin = requestLogin.replace("  res.end('Welcome, ' + user)", "  res.setHeader('Content-Type', 'application/json')\n  res.end(JSON.stringify({ user, status: 'ready' }))")
const guardedLogin = coreLogin.replace('  const user = req.body?.username', "  const token = req.headers.authorization\n  const user = req.body?.username").replace("  if (!user) {", "  if (!token) {\n    res.writeHead(401)\n    return res.end('Token required')\n  }\n\n  if (!user) {")
const verifiedLogin = "import { verifyToken } from '../auth.js'\n\n" + guardedLogin.replace('if (!token)', 'if (!verifyToken(token))')
const finalLogin = verifiedLogin.replace("return res.end('Token required')", "return res.end(JSON.stringify({ error: 'unauthorized' }))")
const readme = '# Shop API\n\nThe core HTTP service for the shop.\n\n## Development\n\nnpm install\nnpm test\n\n## Routes\n\nPOST /login\nGET /orders\n'
const initial: Record<string, PreviewFile> = {
  '/README.md': file(readme, 2),
  '/package.json': file('{\n  "name": "shop-api",\n  "version": "1.0.0",\n  "scripts": { "test": "node --test test/*.test.js" }\n}\n', 3),
  '/src/routes/login.js': file(originalLogin, 4),
  '/src/routes/orders.js': file("export function orders(req, res) {\n  res.end(JSON.stringify({ items: [] }))\n}\n", 5),
  '/test/orders.test.js': file("import { test } from 'node:test'\n\ntest('orders returns a list', () => {\n  // Exercise the orders route.\n})\n", 6),
  '/assets/logo.bin': { text: null, size: 4096, inode: 7, mode: '0644' },
}
const commits: PreviewCommit[] = []
function save(key: keyof typeof ids, branch: string, message: string, time: string, operation: PreviewCommit['operation'], parent: PreviewCommit | null, changes: Record<string, PreviewFile | null>, source?: string) {
  const tree = { ...(parent?.tree ?? initial) }
  for (const [path, value] of Object.entries(changes)) { if (value) tree[path] = value; else delete tree[path] }
  const commit: PreviewCommit = { id: ids[key], branch, message, time: `2026-11-08T${time}:00Z`, operation, parent: parent?.id ?? null, tree, source }
  commits.push(commit)
  return commit
}
const init = save('init', 'main', 'Import the shop API', '06:00', 'Init', null, {})
const tracing = save('tracing', 'release-api', 'Add request tracing', '07:00', 'File write', init, { '/src/routes/login.js': file(requestLogin, 4) })
const published = save('published', 'main', 'Publish request tracing', '07:15', 'Publish', init, tracing.tree, tracing.id)
const responses = save('responses', 'release-api', 'Return structured login responses', '07:45', 'Workspace commit', tracing, {
  '/src/routes/login.js': file(coreLogin, 4),
  '/CHANGELOG.md': file('# Changes\n\n- Return structured login responses.\n- Include request IDs.\n', 8),
})
const main = save('main', 'main', 'Publish structured login responses', '08:00', 'Publish', published, responses.tree, responses.id)
const login = save('login', 'feature-login', 'Require an authorization header', '08:20', 'File write', main, { '/src/routes/login.js': file(guardedLogin, 4) })
const token = save('token', 'feature-login', 'Verify tokens against the store', '08:35', 'File write', login, {
  '/src/routes/login.js': file(verifiedLogin, 4),
  '/src/auth.js': file("export function verifyToken(token) {\n  return Boolean(token) && token === process.env.API_TOKEN\n}\n", 9),
})
const errors = save('errors', 'feature-login', 'Return a structured authorization error', '08:50', 'Workspace commit', token, { '/src/routes/login.js': file(finalLogin, 4) })
const tests = save('tests', 'feature-login', 'Cover missing and invalid tokens', '09:05', 'Workspace commit', errors, {
  '/test/login.test.js': file("import { test } from 'node:test'\nimport { strict as assert } from 'node:assert'\nimport { verifyToken } from '../src/auth.js'\n\ntest('rejects missing tokens', () => {\n  assert.equal(verifyToken(undefined), false)\n})\n", 10),
})
save('docs', 'feature-login', 'Document authenticated login requests', '09:20', 'File write', tests, { '/README.md': file(readme + '\n## Authentication\n\nPass the API token in the Authorization header.\n', 2) })
save('orders', 'fix-orders', 'Return the total alongside order items', '09:10', 'File write', main, { '/src/routes/orders.js': file("export function orders(req, res) {\n  const items = []\n  const total = items.reduce((sum, item) => sum + item.price, 0)\n  res.end(JSON.stringify({ items, total }))\n}\n", 5) })
// Same final login text as main, reached through a different branch history.
// Rewriting identical bytes at the same saved head would not establish new blame ownership.
save('review', 'review-login', 'Rebuild structured responses from earlier main', '09:25', 'Workspace commit', published, {
  '/src/routes/login.js': file(coreLogin, 4),
  '/CHANGELOG.md': file(main.tree['/CHANGELOG.md'].text!, 11),
})

export const previewCommits = commits
export const previewBranches: BranchInfo[] = ['main', 'feature-login', 'fix-orders', 'review-login', 'release-api'].map(name => ({
  name, head: commits.filter(c => c.branch === name).at(-1)!.id, state: 'open',
  parent: name === 'main' ? null : 'main', forkedFrom: name === 'main' ? null : name === 'review-login' ? published.id : name === 'release-api' ? init.id : main.id,
  commits: commits.filter(c => c.branch === name).length,
}))
export const previewShort = (value: string) => value.slice(2, 10)
export const previewTime = (value: string) => new Date(value).toLocaleString('en-GB', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC'
export function previewHead(branch: string) { return commits.filter(c => c.branch === branch).at(-1)! }
export function previewAt(branch: string, commit = 'latest') { return commits.find(c => c.id === commit) ?? previewHead(branch) }
export function previewAncestry(commit: PreviewCommit): PreviewCommit[] { return [commit, ...(commit.parent ? previewAncestry(commits.find(c => c.id === commit.parent)!) : [])] }
export function previewOwn(branch: string) { return commits.filter(c => c.branch === branch).toReversed() }
export function previewChanges(before: PreviewCommit | null, after: PreviewCommit | null): PreviewChange[] {
  return [...new Set([...Object.keys(before?.tree ?? {}), ...Object.keys(after?.tree ?? {})])].sort().flatMap(path => {
    const a = before?.tree[path], b = after?.tree[path]
    if (a && b && a.text === b.text && a.size === b.size && a.mode === b.mode && a.inode === b.inode) return []
    return [{ path, kind: !a ? 'Added' : !b ? 'Removed' : 'Modified', content: !a || !b || a.text !== b.text || a.size !== b.size, metadata: !!a && !!b && a.mode !== b.mode, identity: !!a && !!b && a.inode !== b.inode }]
  })
}
export function previewRevisions(commit: PreviewCommit, path: string) {
  return previewAncestry(commit).filter(c => previewChanges(commits.find(p => p.id === c.parent) ?? null, c).some(change => change.path === path))
}
export function previewEntries(branch: string, commit: string, path: string): FsEntry[] {
  const entries = new Map<string, FsEntry>()
  const prefix = path === '/' ? '/' : path + '/'
  for (const [full, value] of Object.entries(previewAt(branch, commit).tree)) {
    if (!full.startsWith(prefix)) continue
    const [name, ...rest] = full.slice(prefix.length).split('/')
    entries.set(name, { name, path: prefix + name, kind: rest.length ? 'dir' : 'file', size: rest.length ? null : value.size })
  }
  return [...entries.values()]
}

/** Small exact line LCS for these short fixtures; not a substitute for the native diff engine. */
export function previewDiff(before: string, after: string): PreviewLine[] {
  const split = (text: string) => text ? text.replace(/\n$/, '').split('\n') : []
  const a = split(before), b = split(after)
  const scores = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1))
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) scores[i][j] = a[i] === b[j] ? 1 + scores[i + 1][j + 1] : Math.max(scores[i + 1][j], scores[i][j + 1])
  const lines: PreviewLine[] = []
  let i = 0, j = 0
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { lines.push({ op: ' ', text: a[i], left: ++i, right: ++j }) }
    else if (i < a.length && (j === b.length || scores[i + 1][j] >= scores[i][j + 1])) { lines.push({ op: '-', text: a[i], left: ++i, right: null }) }
    else { lines.push({ op: '+', text: b[j], left: null, right: ++j }) }
  }
  return lines
}
export function previewBlame(commit: PreviewCommit, path: string): { text: string; owner: PreviewCommit }[] {
  const text = commit.tree[path]?.text
  if (text == null) return []
  const parent = commits.find(c => c.id === (commit.operation === 'Publish' && commit.source ? commit.source : commit.parent))
  const older = parent ? previewBlame(parent, path) : []
  return previewDiff(parent?.tree[path]?.text ?? '', text).filter(line => line.op !== '-').map(line => ({
    text: line.text,
    owner: line.op === ' ' && line.left ? older[line.left - 1]?.owner ?? commit : commit,
  }))
}

export function previewAttribution(before: PreviewCommit | null, after: PreviewCommit | null, path: string) {
  return alignAttribution(previewDiff(before?.tree[path]?.text ?? '', after?.tree[path]?.text ?? ''), before ? previewBlame(before, path) : [], after ? previewBlame(after, path) : [])
}

/** The fixture is tiny and complete; a real SDK query needs explicit scan bounds and coverage. */
export function previewAttributionPaths(before: PreviewCommit | null, after: PreviewCommit | null) {
  return [...new Set([...Object.keys(before?.tree ?? {}), ...Object.keys(after?.tree ?? {})])].flatMap(path => {
    if (before?.tree[path]?.text == null || after?.tree[path]?.text == null) return []
    const lines = previewAttribution(before, after, path).filter(line => line.ownerChanged).length
    return lines ? [{ path, lines }] : []
  })
}

export function previewComparisonChanges(before: PreviewCommit | null, after: PreviewCommit | null) {
  const content = previewChanges(before, after).map(change => ({ ...change, attributionLines: 0 }))
  const owners: (Omit<PreviewChange, 'kind'> & { kind: 'Attribution'; attributionLines: number })[] = []
  for (const attribution of previewAttributionPaths(before, after)) {
    const found = content.find(change => change.path === attribution.path)
    if (found) found.attributionLines = attribution.lines
    else owners.push({ path: attribution.path, kind: 'Attribution', content: false, metadata: false, identity: false, attributionLines: attribution.lines })
  }
  return [...content, ...owners].sort((a, b) => a.path.localeCompare(b.path))
}
