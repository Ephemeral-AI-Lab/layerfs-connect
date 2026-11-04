// A simulated host's answers to the reads a project page makes (dev builds,
// components/simulation.tsx), so a sample project opens with content: its
// state (Branches, Commits, Sandboxes, Store totals), each Branch's Commits,
// a file tree and files, and its chats' Live. The Storage and machine views
// answer from the same sample home (data/home-sim.ts, data/compute-sim.ts).
// Any call that would change something on a sample project, Sandbox or
// Workspace is refused: nothing reaches the host.

import { simSandbox, type Simulation } from '@/data/compute-sim'
import { simProjects, simStorage } from '@/data/home-sim'
import type { BranchInfo, CommitInfo, FsEntry, ProjectState, ProjectSummary, SandboxInfo, StoreStats } from '@shared/host-api'

const HOUR = 3_600_000
const MESSAGES = ['Add the product list', 'Wire the cart total', 'Fix the login form', 'Write tests for checkout', 'Tidy the header', 'Speed up search', 'Bump dependencies', 'Document the API']
const KINDS = ['exec', 'fs', 'exec', 'merge']

/** A small stable number from a name, so each sample project differs but stays the same. */
const seedOf = (s: string) => [...s].reduce((n, c) => (n * 31 + c.charCodeAt(0)) % 9973, 7)

/** A route's answer: a value, a promise of one, or a refusal. */
export type SimAnswer = { value: unknown } | null
export const simRefusal = () => Object.assign(new Error('This is sample data: nothing is sent to the host. Pick Live host to act.'), { code: 'Simulated' })

function commitsOf(key: string, branch: string, n: number, at: number): CommitInfo[] {
  const seed = seedOf(`${key}:${branch}`)
  return Array.from({ length: n }, (_, i) => {
    const id = `${branch.replace(/\W/g, '')}-${(seed + i).toString(16).padStart(4, '0')}`
    const kind = KINDS[(seed + i) % KINDS.length]
    return {
      id,
      branch,
      message: MESSAGES[(seed + i) % MESSAGES.length],
      at: at - (n - 1 - i) * 2.5 * HOUR,
      parent: i === 0 ? null : `${branch.replace(/\W/g, '')}-${(seed + i - 1).toString(16).padStart(4, '0')}`,
      kind,
      changes: [{ path: ['src/app.ts', 'src/cart.ts', 'README.md', 'test/cart.test.ts'][(seed + i) % 4], kind: i % 3 ? 'modified' : 'added' }],
    }
  })
}

function statsOf(commits: CommitInfo[], bytes: number): StoreStats {
  let logical = 0
  const rows = commits.map((c, i) => {
    logical += 4e6 * (1 + (i % 5))
    const canonical = Math.round(1.2e5 * (1 + (i % 7)))
    return { id: c.id, branch: c.branch, message: c.message, at: c.at, kind: c.kind ?? null, logical, canonical, stored: Math.round(canonical / 2.7) }
  })
  const canonical = rows.reduce((n, r) => n + r.canonical, 0) + bytes * 0.6
  const stored = canonical / 2.7
  return { logical: logical + bytes * 40, canonical, stored, metadata: stored * 0.08, file: bytes, free: 0, dedupe: (logical + bytes * 40) / canonical, compression: 2.7, init: { files: 42, bytes: bytes * 0.5, stored: bytes * 0.18, millis: 380 }, main: bytes * 0.8, commits: rows }
}

interface Built {
  state: ProjectState
  commits: Record<string, CommitInfo[]>
}

function build(sim: Simulation, p: ProjectSummary): Built {
  const now = Date.now()
  const chats = sim.chats.filter((c) => (c.project ?? c.scenario?.project) === p.key)
  const side = [...new Set(chats.map((c) => c.workspace?.branch).filter((b): b is string => !!b))]
  const names = ['main', ...side, ...(side.length ? [] : ['experiment'])]
  const commits: Record<string, CommitInfo[]> = {}
  names.forEach((b, i) => (commits[b] = commitsOf(p.key, b, b === 'main' ? 8 : 2 + (i % 3), now - i * 37 * 60_000)))
  const branches: BranchInfo[] = names.map((b) => ({ name: b, head: commits[b].at(-1)?.id ?? null, parent: b === 'main' ? null : 'main', forkedFrom: b === 'main' ? null : (commits.main[4]?.id ?? null), state: 'open', commits: commits[b].length }))
  const all = Object.values(commits).flat()
  const last = all.reduce<CommitInfo | null>((a, c) => (!a || (c.at ?? 0) > (a.at ?? 0) ? c : a), null)
  const store = simStorage(sim).stores.find((s) => s.name === p.store)
  const bytes = store?.size?.bytes ?? 0
  return {
    state: { project: p, branches, layers: [], sandboxes: sandboxesOf(sim, p.key), last, commits: all.length, store: { path: store?.kind === 'sqlite' ? `/layerfs/stores/${p.store}.sqlite` : null, bytes: store?.size?.bytes ?? null }, storage: store?.kind === 'sqlite' ? statsOf(all, bytes) : null },
    commits,
  }
}

const sandboxesOf = (sim: Simulation, key: string): SandboxInfo[] => (sim.view.available ? sim.view.sandboxes.filter((b) => b.project === key).map((b) => simSandbox(sim, b.name)) : [])

const TREE: Record<string, [string, 'file' | 'dir'][]> = {
  '': [['src', 'dir'], ['test', 'dir'], ['README.md', 'file'], ['package.json', 'file']],
  src: [['app.ts', 'file'], ['cart.ts', 'file'], ['index.ts', 'file']],
  test: [['cart.test.ts', 'file']],
}
const fileText = (key: string, path: string) =>
  path.endsWith('.md')
    ? `# ${key}\n\nSample project on a simulated host: nothing here is on this machine.\n`
    : path.endsWith('.json')
      ? `{\n  "name": "${key.split('/').pop()}",\n  "private": true,\n  "scripts": { "test": "node --test" }\n}\n`
      : `// ${path} (sample)\nexport function total(items: { price: number; qty: number }[]) {\n  return items.reduce((n, i) => n + i.price * i.qty, 0)\n}\n`

const cache = new WeakMap<Simulation, Map<string, Built>>()

/**
 * The simulated host's answer to `method path`, or null when the call is not
 * about the sample home (it goes to the host as usual).
 */
export function simRoute(sim: Simulation, method: string, path: string): SimAnswer {
  const url = new URL(path, 'http://sim')
  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
  const projects = simProjects(sim)
  const sandboxNames = new Set(sim.view.available ? sim.view.sandboxes.map((b) => b.name) : [])
  if (parts[0] !== 'api') return null
  const [, group, id, sub] = parts
  if (method === 'GET' && group === 'storage' && !id) return { value: simStorage(sim) }
  if (method === 'GET' && group === 'machines' && !id) return { value: sim.view }
  if (group === 'sandboxes' && id && sandboxNames.has(id)) return method === 'GET' && !sub ? { value: simSandbox(sim, id) } : { value: simRefusal() }
  if (group === 'workspaces' && id && sandboxNames.has(id.slice(0, id.indexOf(':')))) return { value: simRefusal() }
  if (group === 'agent' && id === 'sessions' && parts[3]?.startsWith('sim-')) return method === 'GET' && parts[4] === 'live' ? { value: { calls: [], live: { running: [], mounts: [], sandboxes: [], last: {} } } } : { value: simRefusal() }
  if (group !== 'projects' || !id) return null
  const p = projects.find((x) => x.key === id)
  if (!p) return null
  if (method !== 'GET') return { value: simRefusal() }
  let built = cache.get(sim)?.get(p.key)
  if (!built) {
    if (!cache.has(sim)) cache.set(sim, new Map())
    cache.get(sim)!.set(p.key, (built = build(sim, p)))
  }
  const branch = url.searchParams.get('branch') ?? 'main'
  if (!sub) return { value: built.state }
  if (sub === 'sandboxes') return { value: built.state.sandboxes }
  if (sub === 'commits') return { value: [...(built.commits[branch] ?? [])].reverse() }
  if (sub === 'branch-commits') return { value: Object.fromEntries(url.searchParams.getAll('branch').filter((b) => built!.commits[b]).map((b) => [b, b === 'main' ? [] : built!.commits[b]])) }
  // paths as the Files tab asks for them: the root is `/`, the rest `/src/app.ts`
  const at = (url.searchParams.get('path') ?? '').replace(/^\/+|\/+$/g, '')
  if (sub === 'fs') return { value: (TREE[at] ?? []).map(([name, kind]): FsEntry => ({ name, path: `/${at ? `${at}/` : ''}${name}`, kind, size: kind === 'file' ? 400 + name.length * 37 : null })) }
  if (sub === 'file') {
    const text = fileText(p.key, at)
    return { value: { path: url.searchParams.get('path') ?? at, size: text.length, binary: false, text } }
  }
  return { value: sub.endsWith('s') ? [] : {} }
}

/** The sample chats to add to the host's list (GET /api/agent/sessions), so a sample project's Chats tab has them. */
export const simChats = (sim: Simulation) => sim.chats
