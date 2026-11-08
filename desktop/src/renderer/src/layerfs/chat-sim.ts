// A read-only UI example. These records never create a host session, call a
// model, run a command, or write project files. Chat and Trace share the same
// messages so their links open the corresponding step.
import type { ChatDetail, ChatMessage, ChildRun } from './agent-api'
import type { TracePage, TraceRecord } from './trace-api'
import type { CommitInfo, FsEntry, ProjectState } from './host-api'

export const EXAMPLE_CHAT_ID = 'ui-example-chat'
export const EXAMPLE_CHAT_PATH = `/chat/${EXAMPLE_CHAT_ID}`
export const EXAMPLE_PROJECT = 'ui-example/search'
const start = Date.parse('2026-11-08T06:00:00Z')

const child: ChildRun = {
  id: 'example-review:0', runId: 'example-review', agent: 'reviewer',
  state: 'completed', task: 'Review project filtering for empty and mixed-case queries.',
  text: 'The filter handles empty queries and ignores case. The example checks pass.',
  conversation: true, turns: 1, toolCount: 1, durationMs: 2400,
  startedAt: start + 9000, endedAt: start + 11400,
}

const messages: ChatMessage[] = [
  { id: 'example-request', role: 'user', text: 'Add a search field to the project list. Match project names regardless of case.' },
  { id: 'example-plan', role: 'assistant', text: 'I’ll inspect the project list, add a name filter, and check empty and mixed-case searches.' },
  {
    id: 'example-inspect', role: 'tool', toolName: 'bash', status: 'done',
    args: { command: 'rg -n "projects.map|ProjectList" src/' },
    text: 'src/ProjectList.tsx:18: projects.map(project => <ProjectRow project={project} />)',
  },
  {
    id: 'example-write', role: 'tool', toolName: 'bash', status: 'done',
    args: { command: 'layerfs fs write --branch search --path src/filter.ts --text "export const matches = (name, query) => name.includes(query)"' },
    text: 'Example file write recorded. Checkpoint #1.',
    view: {
      segments: [{ kind: 'fs', form: 'cli', call: 'fs.write', text: 'Write the search filter', lines: [1, 1] }],
      calls: [{ id: 'example-write-call', method: 'fs.write', ok: true, kind: 'file', code: null, ms: 24, start: new Date(start + 3000).toISOString(), branch: 'search', path: 'src/filter.ts' }],
    },
  },
  {
    id: 'example-test-fail', role: 'tool', toolName: 'bash', status: 'error',
    args: { command: 'npm test -- filter' },
    text: 'FAIL mixed-case query\nExpected matches("Connect", "connect") to be true; received false.\n1 passed, 1 failed (simulated output).',
  },
  { id: 'example-progress', role: 'assistant', text: 'The mixed-case check caught a problem: the first filter compares the original strings. I’ll normalize both values before matching.' },
  {
    id: 'example-fix', role: 'tool', toolName: 'bash', status: 'done',
    args: { command: 'layerfs fs write --branch search --path src/filter.ts --text "export const matches = (name, query) => name.toLowerCase().includes(query.trim().toLowerCase())"' },
    text: 'Example file write recorded. Checkpoint #2.',
    view: {
      segments: [{ kind: 'fs', form: 'cli', call: 'fs.write', text: 'Normalize names and queries', lines: [1, 1] }],
      calls: [{ id: 'example-fix-call', method: 'fs.write', ok: true, kind: 'file', code: null, ms: 18, start: new Date(start + 6000).toISOString(), branch: 'search', path: 'src/filter.ts' }],
    },
  },
  { id: 'example-test-pass', role: 'tool', toolName: 'bash', status: 'done', args: { command: 'npm test -- filter' }, text: 'PASS empty query\nPASS mixed-case query\n2 passed, 0 failed (simulated output).' },
  { id: 'example-review', role: 'tool', toolName: 'subagent', status: 'done', args: { agent: child.agent, task: child.task }, details: { runId: child.runId }, text: child.text! },
  {
    id: 'example-answer', role: 'assistant',
    text: '**Search is ready in this example.**\n\n- Project names match regardless of case.\n- An empty query shows every project.\n- The simulated checks pass after correcting the filter.\n\n```ts\nexport const matches = (name: string, query: string) =>\n  name.toLowerCase().includes(query.trim().toLowerCase())\n```\n\nExpand **Worked** to inspect commands, open **Trace** for the full trajectory, or visit **Subagents** to read the review.\n\n*This is sample data. No files were changed and no model or commands ran.*',
  },
]

const chat: ChatDetail = {
  id: EXAMPLE_CHAT_ID, title: 'Example · Add project search', cwd: '/example/workspace',
  project: EXAMPLE_PROJECT, created: start, updated: start + 12000, state: 'idle',
  provider: 'scenario', modelId: null, error: null,
  scenario: { id: 'ui-preview', title: 'UI preview', project: EXAMPLE_PROJECT, state: 'simulated', error: null },
  messages, queued: [], approvals: [], children: [child], contextUsage: null,
}

// Build the trajectory from the transcript rather than a second set of steps.
const records: TraceRecord[] = [{
  id: 'example-system', kind: 'system', turn: 0, step: null,
  title: 'Read-only UI simulation', status: 'ok', start, ms: 0,
  text: 'Sample conversation and execution history. No model, tools, or files are used.', scripted: true,
}]
messages.forEach((message, index) => {
  const tool = message.role === 'tool'
  const row: TraceRecord = {
    id: message.id, kind: tool ? message.toolName === 'subagent' ? 'subagent' : 'tool' : message.role,
    turn: 1, step: index, title: tool ? String(message.args?.command ?? message.args?.task ?? message.toolName) : message.text.split('\n')[0],
    status: message.status === 'error' ? 'failed' : 'ok', start: start + 1000 + index * 1000, ms: tool ? 240 : 0,
    text: tool ? message.toolName === 'subagent' ? JSON.stringify(message.args) : String(message.args?.command) : message.text,
    output: tool ? message.text : undefined, tool: message.toolName,
    callId: tool ? message.id : undefined, exitCode: message.toolName === 'bash' ? message.status === 'error' ? 1 : 0 : undefined,
    scripted: true, final: message.id === 'example-answer', source: message.role === 'user' ? 'user' : 'scenario',
  }
  const checkpoint = message.id === 'example-write' ? 1 : message.id === 'example-fix' ? 2 : null
  if (checkpoint) {
    row.checkpoints = [checkpoint]
    row.writes = [{
      kind: 'file', method: 'fs.write', status: 'ok', outcome: 'written', checkpoint,
      commit: checkpoint === 1 ? 'example-write' : 'example-fixed', branch: 'search', path: 'src/filter.ts', workspace: null,
      from: null, onto: null, with: null, layer: null, trunk: null,
      message: 'Simulated checkpoint', sizes: null, start: row.start, ms: 24,
    }]
  }
  records.push(row)
  for (const call of message.view?.calls ?? []) records.push({
    id: call.id, kind: 'layerfs', turn: 1, step: index, title: call.method,
    status: 'ok', start: Date.parse(call.start), ms: call.ms, parent: row.id,
    args: { branch: call.branch ?? '', path: call.path ?? '' }, outcome: 'written', writeKind: 'file',
  })
})

const sampleProject: ProjectState = {
  project: { name: 'search', key: EXAMPLE_PROJECT, store: 'ui-example', kind: 'sqlite', machine: null, created: start },
  branches: [
    { name: 'main', head: 'example-initial', parent: null, forkedFrom: null, state: 'open', commits: 1 },
    { name: 'search', head: 'example-fixed', parent: 'main', forkedFrom: 'example-initial', state: 'open', commits: 2 },
  ],
  layers: [], sandboxes: [], last: null, commits: 3, store: { path: null, bytes: null }, storage: null,
}

// Dense, read-only branch history for exercising groups and fork families.
const historyCommits: Record<string, CommitInfo[]> = {
  search: [
    { id: 'example-fixed', branch: 'search', message: 'Normalize names and queries', at: start + 6000, parent: 'example-write', changes: [{ path: '/src/filter.ts', kind: 'modified' }] },
    { id: 'example-write', branch: 'search', message: 'Write the search filter', at: start + 3000, parent: null },
  ],
}
let checkpointNumber = 3
for (const [name, parent, fork, count] of [
  ['indexing', 'main', 'example-initial', 240],
  ['search-tests', 'search', 'example-fixed', 125],
  ['edge-cases', 'search-tests', 'example-search-tests-60', 24],
  ['documentation', 'main', 'example-initial', 80],
  ['accessibility', 'main', 'example-initial', 15],
] as const) {
  const ascending: CommitInfo[] = Array.from({ length: count }, (_, i) => ({
    id: `example-${name}-${i + 1}`, branch: name, message: `${name}: intermediate write ${i + 1}`,
    at: start + 15000 + i * 40, parent: i ? `example-${name}-${i}` : fork,
    changes: [{ path: `/src/${name}.ts`, kind: 'modified' }],
  }))
  historyCommits[name] = [...ascending].reverse()
  sampleProject.branches.push({ name, head: ascending.at(-1)!.id, parent, forkedFrom: fork, state: 'open', commits: count })
  for (let i = 0; i < count; i += 40) {
    const batch = ascending.slice(i, i + 40)
    const id = `example-batch-${name}-${i}`
    const first = checkpointNumber
    checkpointNumber += batch.length
    records.push({ id, callId: id, kind: 'tool', tool: 'bash', turn: 2, step: i / 40,
      title: `Sample: ${name} writes ${i + 1}–${i + batch.length}`, text: 'Read-only sample of many small LayerFS writes.',
      status: 'ok', start: batch[0].at, ms: 40, checkpoints: batch.map((_, k) => first + k),
      writes: batch.map((c, k) => ({ kind: 'file', method: 'file.write', status: 'ok', outcome: 'written', commit: c.id, branch: name,
        path: `/src/${name}.ts`, checkpoint: first + k, workspace: null, from: null, onto: null, with: null, layer: null, trunk: null, message: c.message, sizes: null, start: c.at, ms: 1 })),
    })
  }
}
historyCommits.combined = [{ id: 'example-merged', branch: 'combined', message: 'Merge search and documentation', at: start + 60000,
  parent: 'example-fixed', merged: 'example-documentation-80', kind: 'merge', changes: [{ path: '/src/filter.ts', kind: 'modified' }] }]
sampleProject.branches.push({ name: 'combined', head: 'example-merged', parent: 'search', forkedFrom: 'example-fixed', state: 'open', commits: 1 })
sampleProject.commits = Object.values(historyCommits).reduce((sum, c) => sum + c.length, 0)

function sampleFiles(branch: string): Record<string, string> {
  return {
    '/README.md': '# Project search — UI example\n\nThese are simulated LayerFS files, shared by the chat and Storage file views.\n\nOpen src/filter.ts to inspect the example change. Switch between main and search to compare the filter.\n\nNo files on your machine are read or changed.\n',
    '/package.json': '{\n  "name": "search-example",\n  "private": true,\n  "scripts": { "test": "node --test" }\n}\n',
    '/src/filter.ts': branch === 'main'
      ? 'export const matches = (name: string, query: string) =>\n  name.includes(query)\n'
      : 'export const matches = (name: string, query: string) =>\n  name.toLowerCase().includes(query.trim().toLowerCase())\n',
    '/src/ProjectList.tsx': 'import { matches } from "./filter"\n\nexport function ProjectList({ projects, query }) {\n  return projects\n    .filter(project => matches(project.name, query))\n    .map(project => <div key={project.name}>{project.name}</div>)\n}\n',
    '/test/filter.test.ts': 'import assert from "node:assert/strict"\nimport { test } from "node:test"\nimport { matches } from "../src/filter"\n\ntest("empty query", () => assert.ok(matches("Connect", "")))\ntest("mixed-case query", () => assert.ok(matches("Connect", "connect")))\n',
  }
}

/** Only reserved example resources are intercepted; ordinary calls use the host. */
export function exampleChatReply(method: string, path: string): { value: unknown } | null {
  const url = new URL(path, 'http://example.invalid')
  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
  if (parts[0] === 'api' && parts[1] === 'projects' && parts[2] === EXAMPLE_PROJECT) {
    if (method !== 'GET') return { value: new Error('These are read-only example files.') }
    if (parts.length === 3) return { value: sampleProject }
    const branch = url.searchParams.get('branch') ?? 'main'
    if (!sampleProject.branches.some(b => b.name === branch)) return { value: new Error('This example branch does not exist.') }
    const files = sampleFiles(branch)
    const at = `/${(url.searchParams.get('path') ?? '').replace(/^\/+|\/+$/g, '')}`
    if (parts[3] === 'history') {
      const pos = Number(url.searchParams.get('pos') ?? 0)
      if (!url.searchParams.has('branch')) return { value: { branches: sampleProject.branches.map(b => ({ name: b.name, head: b.head, forkedFrom: b.forkedFrom, base: 'example-initial' })), next: null } }
      const all = historyCommits[branch] ?? []
      const id = url.searchParams.get('commit')
      if (id) {
        const item = all.find(c => c.id === id)
        return { value: item ? { item, changes: item.changes ?? null, nextChanges: null } : new Error('This example checkpoint is unavailable.') }
      }
      return { value: { items: all.slice(pos, pos + 100), next: pos + 100 < all.length ? pos + 100 : null, head: all[0]?.id ?? null } }
    }
    if (parts[3] === 'file') {
      const text = files[at]
      return { value: text === undefined ? new Error('This example file does not exist.') : { path: at, text, binary: false, size: new TextEncoder().encode(text).length } }
    }
    if (parts[3] === 'fs') {
      const prefix = at === '/' ? '/' : `${at}/`
      const entries = new Map<string, FsEntry>()
      for (const [name, text] of Object.entries(files)) {
        if (!name.startsWith(prefix)) continue
        const rest = name.slice(prefix.length)
        const dir = rest.includes('/')
        const leaf = rest.split('/')[0]
        entries.set(leaf, { name: leaf, path: `${prefix}${leaf}`, kind: dir ? 'dir' : 'file', size: dir ? null : new TextEncoder().encode(text).length })
      }
      return { value: [...entries.values()] }
    }
    return { value: new Error('This resource is not part of the example project.') }
  }
  const base = `/api/agent/sessions/${EXAMPLE_CHAT_ID}`
  if (url.pathname !== base && !url.pathname.startsWith(`${base}/`)) return null
  if (method !== 'GET') return { value: new Error('This example is read-only. Start a new chat to work with a model.') }
  if (url.pathname === base) return { value: chat }
  if (url.pathname === `${base}/trace`) {
    const before = Number(url.searchParams.get('before') ?? records.length)
    const limit = Number(url.searchParams.get('limit') ?? 300)
    const from = Math.max(0, before - limit)
    const page: TracePage = { agent: 'main', kind: 'replay', total: records.length, from, records: records.slice(from, before), agents: [{ name: 'main', parent: null, state: 'completed' }], checkpoints: records.reduce((n, r) => n + (r.checkpoints?.length ?? 0), 0) }
    return { value: page }
  }
  if (decodeURIComponent(url.pathname) === `${base}/children/${child.id}/trace`) {
    const rows: TraceRecord[] = [
      { id: 'review-task', kind: 'user', source: 'parent', turn: 1, step: null, title: child.task!, text: child.task, status: 'ok', start: child.startedAt!, ms: null },
      { id: 'review-model', kind: 'assistant', turn: 1, step: 1, title: 'Run the filter checks', text: null, toolOnly: true, status: 'ok', start: child.startedAt!, ms: null },
      { id: 'review-tool', callId: 'review-command', kind: 'tool', tool: 'bash', turn: 1, step: 1, title: 'npm test -- filter', text: 'npm test -- filter', output: '2 passed, 0 failed (simulated output).', status: 'ok', start: child.startedAt!, ms: 24 },
      { id: 'review-answer', kind: 'assistant', turn: 1, step: 2, title: 'Review complete', text: child.text, final: true, status: 'ok', start: child.endedAt!, ms: null },
    ]
    const before = Math.min(rows.length, Number(url.searchParams.get('before') ?? rows.length))
    const from = Math.max(0, before - Number(url.searchParams.get('limit') ?? 300))
    return { value: { agent: child.agent, kind: 'replay', total: rows.length, from, records: rows.slice(from, before), agents: [{ name: child.agent, parent: 'main', state: child.state }], checkpoints: 0 } satisfies TracePage }
  }
  if (url.pathname === `${base}/children/${encodeURIComponent(child.id)}` || url.pathname === `${base}/children/${child.id}`) return {
    value: { child, messages: [
      { id: 'review-task', role: 'user', text: child.task },
      { id: 'review-command', role: 'tool', toolName: 'bash', status: 'done', args: { command: 'npm test -- filter' }, text: '2 passed, 0 failed (simulated output).' },
      { id: 'review-answer', role: 'assistant', text: child.text },
    ] },
  }
  return { value: new Error('This resource is not part of the example chat.') }
}
