// Simulated machines for designing the Machines page on hosts this machine is
// not. Each case is GET /api/machines as host/machines.js builds it from
// LayerFS 2.0's machine.list() (machine/calls.rs), store.list(),
// sandbox.list() and machine.status(), with each Sandbox's Workspaces
// (sandbox.get) and the chats using them; `older` is a Connect linked to a
// LayerFS with no machines. Dev builds switch between them on the page; the
// harness takes ?page=compute&case=<id>. The page's actions work on a copy in
// memory (simulate below), refused as LayerFS would refuse them.

import { BUILT_IN, GIB, type Os } from '@/data/compute'
import type { AgentSessionSummary } from '@shared/agent-api'
import type { MachineInfo, MachineLive, MachinePgStore, MachinePlatformInfo, MachineSandbox, MachinesView, MachineStore, MachineSupports, NewMachine, PlatformOption, SandboxInfo, WorkspaceInfo } from '@shared/host-api'

export type SimId = 'mac-fresh' | 'mac-mixed' | 'mac-busy' | 'windows' | 'older'
export const SIM_IDS: SimId[] = ['mac-fresh', 'mac-mixed', 'mac-busy', 'windows', 'older']
export const isSimId = (v: unknown): v is SimId => typeof v === 'string' && (SIM_IDS as string[]).includes(v)

/** A simulated host: its machines view, each Sandbox's Workspaces by Sandbox name, and the chats on them. */
export interface SimHost {
  view: MachinesView
  workspaces: Record<string, WorkspaceInfo[]>
  chats: AgentSessionSummary[]
}

export interface Simulation extends SimHost {
  label: string
  os: Os
}

// the sample machines' image: a made-up digest (a real machine reports the bundle's)
const IMAGE = 'sha256:5a3b1e0c9d7f2468ace13579bdf02468ace13579bdf02468ace13579bdf0246'
// a Sandbox made from its own image (sandbox.create's `image`), not its machine's
const CUSTOM_IMAGE = 'sha256:9c1f7d3e5b2a4680fedcba9876543210fedcba9876543210fedcba98765432'
const LAYERFS = '2.0.0'
const PG: MachineSupports = { sqlite: true, postgresql_sandbox: true, reason: null }

type Available = Extract<MachinesView, { available: true }>

const native = (stores: string[] = [], sandboxes: string[] = [], over: Partial<MachineInfo> = {}): MachineInfo => ({ name: 'native', platform: 'native', backend: 'native', state: 'ready', supports: PG, cpus: null, memory: null, disk: null, stores, sandboxes, ...over })
const docker = (stores: string[] = [], sandboxes: string[] = [], over: Partial<MachineInfo> = {}): MachineInfo => ({
  name: 'docker',
  platform: 'docker',
  backend: 'docker',
  state: 'ready',
  supports: PG,
  cpus: null,
  memory: null,
  disk: null,
  stores,
  sandboxes,
  image: IMAGE,
  docker: '/var/run/docker.sock',
  ...over,
})
const vm = (name: string, platform: MachineInfo['platform'], state: string, size: [number, number, number], stores: string[] = [], sandboxes: string[] = [], over: Partial<MachineInfo> = {}): MachineInfo => ({
  name,
  platform,
  backend: 'namespaces',
  state,
  supports: PG,
  cpus: size[0],
  memory: size[1] * GIB,
  disk: size[2] * GIB,
  stores,
  sandboxes,
  image: IMAGE,
  ...over,
})
const live = (name: string, state: string, freeGib: number | null, tool: string | null, down: string | null = null): MachineLive => ({ name, state, freeDisk: freeGib === null ? null : freeGib * GIB, toolVersion: tool, down })
const store = (name: string, machine: string, projects: number | string[], sizeGb: number): MachineStore => ({ name, machine, projects: typeof projects === 'number' ? projects : projects.length, ...(typeof projects === 'number' ? {} : { names: projects }), size: sizeGb * 1e9 })
const pg = (name: string, names: string[]): MachinePgStore => ({ name, projects: names.length, names, state: 'idle' })
const ROUTE: Record<string, [string, string]> = { native: ['native', 'nfs'], docker: ['docker', 'fuse'] }
// native Sandboxes are host processes: no image
const box = (name: string, machine: string, project: string, workspaces: number, state = 'running', image?: string): MachineSandbox => {
  const [backend, route] = ROUTE[machine] ?? ['namespaces', 'fuse']
  return { name, machine, project, workspaces, state, backend, route, image: image ?? (machine === 'native' ? null : IMAGE) }
}
/** The create options each platform declares (as machine.platforms lists them), for sample rows. */
const VM_OPTIONS: PlatformOption[] = [{ name: 'cpus', kind: 'int' }, { name: 'memory', kind: 'size' }, { name: 'disk', kind: 'size' }, { name: 'image', kind: 'text' }]
const OPTIONS: Record<string, PlatformOption[]> = {
  'apple-container': VM_OPTIONS,
  microsandbox: VM_OPTIONS,
  lima: VM_OPTIONS,
}
const can = (platform: string, version: string | null, missing: string[] = []): MachinePlatformInfo => ({
  platform,
  how: 'created',
  backend: 'namespaces',
  kernel: 'fuse',
  sqlite: 'worker',
  postgresql: { store_calls: 'in_process', sandbox: true, reason: null },
  ready: missing.length === 0,
  missing,
  version,
  options: OPTIONS[platform] ?? [],
  description: '',
})

const MAC_CAN = (over: Partial<Record<string, MachinePlatformInfo>> = {}): MachinePlatformInfo[] =>
  [
    can('apple-container', 'container CLI version 0.6.1'),
    can('microsandbox', 'msb 0.2.6'),
    can('lima', 'limactl version 2.0.1'),
  ].map((c) => over[c.platform as string] ?? c)

const view = (machines: MachineInfo[], platforms: MachinePlatformInfo[], stores: MachineStore[], sandboxes: MachineSandbox[], status: MachineLive[], postgresql: MachinePgStore[] = []): Available => ({
  available: true,
  layerfs: LAYERFS,
  machines,
  platforms,
  stores,
  postgresql,
  sandboxes,
  status: Object.fromEntries(status.map((s) => [s.name, s])),
})

// mac-fresh: a new home on an M1 Mac, the built-ins alone; every kind's create state (2.0's
// machine/probe.rs names): ready, a missing tool, the Linux bundle missing
const macFresh = view(
  [native(['default'], []), docker([], [])],
  MAC_CAN({
    microsandbox: can('microsandbox', null, ['tool:msb']),
    lima: can('lima', null, ['tool:limactl']),
    'apple-container': can('apple-container', 'container CLI version 0.6.1', ['bundle:~/.cache/layerfs/bundle/2.0.0']),
  }),
  [store('default', 'native', 0, 0.001)],
  [],
  [live('docker', 'ready', 51.2, 'Docker 29.5.2')],
)

// mac-mixed: the mockup's five machines; one Lima machine is down
const macMixed = view(
  [
    native(['shop'], ['1', '2']),
    docker(['team'], ['3', '6']),
    // '6': the PostgreSQL Store's app, also running on docker
    vm('dev', 'lima', 'running', [4, 8, 40], ['agents'], ['4', '5', '7']),
    vm('scratch', 'microsandbox', 'stopped', [2, 4, 20], ['scratch'], [], { supports: { sqlite: true, postgresql_sandbox: false, reason: 'microsandbox has no network route to a PostgreSQL server' } }),
    vm('ml', 'lima', 'unresolved', [8, 16, 80], ['models'], []),
  ],
  MAC_CAN(),
  [store('shop', 'native', ['admin', 'api', 'web'], 2.4), store('team', 'docker', ['todo', 'wiki'], 1.1), store('agents', 'dev', ['crawler', 'evals', 'indexer', 'planner'], 6.8), store('scratch', 'scratch', ['play'], 0.3), store('models', 'ml', ['train', 'serve'], 41.5)],
  // a sqlite project runs on its Store's machine; the PostgreSQL Store's app runs on dev and docker
  [box('1', 'native', 'shop/api', 2), box('2', 'native', 'shop/web', 1), box('3', 'docker', 'team/todo', 1), box('4', 'dev', 'agents/crawler', 3, 'running', CUSTOM_IMAGE), box('5', 'dev', 'agents/indexer', 0, 'creating'), box('6', 'docker', 'pg/app', 1), box('7', 'dev', 'pg/app', 1)],
  [
    live('docker', 'ready', 43.7, 'Docker 29.5.2'),
    live('dev', 'running', 31.2, 'limactl version 2.0.1'),
    live('scratch', 'stopped', 18.9, 'msb 0.2.6'),
    { ...live('ml', 'unresolved', null, 'limactl version 2.0.1', 'lima: instance "ml" did not answer its guest agent'), op: { id: 'op-7', name: 'machine.start', phase: 'boot', started: null, uncertain: true } },
  ],
  [pg('pg', ['app'])],
)

// mac-busy: many Stores on each machine, many Sandboxes
const busyStores = [
  ...['shop', 'blog', 'docs', 'infra', 'ml-lab', 'mobile', 'site', 'billing'].map((n, i) => store(n, 'native', 1 + (i % 4), 0.4 + i * 0.7)),
  ...['team', 'ci', 'demo'].map((n, i) => store(n, 'docker', 2 + i, 1.2 + i)),
  ...['agents', 'evals', 'crawl', 'search', 'notebooks', 'data'].map((n, i) => store(n, 'build', 1 + i, 3.1 + i * 2.2)),
  store('runs', 'msb1', 5, 9.4),
]
// Sandbox names are unique in a home: numbered across the machines
const busyBoxes = [
  ...['shop/api', 'blog/main', 'docs/site', 'infra/tf', 'ml-lab/nb', 'site/web'].map((p, i) => ['native', p, 1 + (i % 3)] as const),
  ...['team/todo', 'ci/runner', 'ci/runner', 'demo/app'].map((p) => ['docker', p, 1] as const),
  ...['agents/a', 'agents/b', 'evals/x', 'crawl/q', 'search/idx', 'notebooks/n', 'data/etl', 'data/etl', 'evals/y'].map((p, i) => ['build', p, 1 + (i % 4)] as const),
  ...['runs/job', 'runs/job', 'runs/job'].map((p) => ['msb1', p, 1] as const),
  // the PostgreSQL Store's app runs on several machines: docker, build and msb1
  ...([['docker', 'pg/app', 1], ['build', 'pg/app', 2], ['msb1', 'pg/app', 1]] as const),
].map(([machine, project, n], i) => box(String(i + 1), machine, project, n))
const macBusy = view(
  [
    native(busyStores.filter((s) => s.machine === 'native').map((s) => s.name), busyBoxes.filter((b) => b.machine === 'native').map((b) => b.name)),
    docker(busyStores.filter((s) => s.machine === 'docker').map((s) => s.name), busyBoxes.filter((b) => b.machine === 'docker').map((b) => b.name)),
    vm('build', 'lima', 'running', [8, 16, 120], busyStores.filter((s) => s.machine === 'build').map((s) => s.name), busyBoxes.filter((b) => b.machine === 'build').map((b) => b.name)),
    vm('msb1', 'microsandbox', 'running', [2, 2, 20], ['runs'], busyBoxes.filter((b) => b.machine === 'msb1').map((b) => b.name)),
    vm('ac1', 'apple-container', 'starting', [2, 4, 20], [], []),
  ],
  MAC_CAN(),
  busyStores,
  busyBoxes,
  [live('docker', 'ready', 12.4, 'Docker 29.5.2'), live('build', 'running', 64.2, 'limactl version 2.0.1'), live('msb1', 'running', 8.1, 'msb 0.2.6'), live('ac1', 'starting', 20, 'container CLI version 0.6.1')],
  [pg('pg', ['app']), pg('warehouse', ['etl', 'reports', 'dash'])],
)

// windows: native keeps records only (no Sandboxes run there); docker runs through WSL2
const windows = view(
  [native(['notes'], [], { supports: { sqlite: true, postgresql_sandbox: false, reason: 'native on Windows keeps records only; Sandboxes run on docker' } }), docker(['shop'], ['1', '2'], { wsl: 'Ubuntu-24.04', docker: 'npipe:////./pipe/docker_engine' })],
  [
    can('apple-container', null, ['host:macos']),
    can('microsandbox', null, ['tool:msb']),
    can('lima', null, ['host:macos', 'tool:limactl']),
  ],
  [store('notes', 'native', 1, 0.05), store('shop', 'docker', 2, 2.2)],
  [box('1', 'docker', 'shop/api', 2), box('2', 'docker', 'shop/web', 1)],
  [live('docker', 'ready', 88.0, 'Docker 29.4.0 (WSL2)')],
  [pg('pg', ['crm'])],
)

const older: MachinesView = { available: false, layerfs: '1.1.0', reason: 'This LayerFS has no machines: they come with LayerFS 2.0.' }

// each Sandbox's Workspaces (sandbox.get), numbered paths on Branches from this list
const BRANCHES: [string, string][] = [
  ['fix-login', 'Fix the login form'],
  ['health', 'Add a health check'],
  ['header', 'Tidy the header'],
  ['search', 'Speed up search'],
  ['onboarding', 'Rework onboarding'],
  ['cache-warm', 'Warm the cache'],
  ['docs-pass', 'Proofread the docs'],
  ['retry-flaky', 'Retry the flaky tests'],
]
const seed = (v: MachinesView): Record<string, WorkspaceInfo[]> => {
  if (!v.available) return {}
  let n = 0
  return Object.fromEntries(
    v.sandboxes.map((b) => [
      b.name,
      Array.from({ length: b.workspaces ?? 0 }, (_, i) => {
        const [branch] = BRANCHES[n++ % BRANCHES.length]
        const path = `/workspaces/${i + 1}`
        return { ws: `${b.name}:${path}`, name: null, branch, path }
      }),
    ]),
  )
}
const sim = (label: string, os: Os, v: MachinesView): Simulation => {
  const workspaces = seed(v)
  return { label, os, view: v, workspaces, chats: chatsOf(v, workspaces) }
}

export const SIMULATIONS: Record<SimId, Simulation> = {
  'mac-fresh': sim('Mac, fresh home', 'darwin', macFresh),
  'mac-mixed': sim('Mac, five machines, one down', 'darwin', macMixed),
  'mac-busy': sim('Mac, many Stores', 'darwin', macBusy),
  windows: sim('Windows (Docker via WSL2)', 'win32', windows),
  older: sim('Older LayerFS (no machines)', 'darwin', older),
}

/** sandbox.get on a simulated host. */
export function simSandbox(h: SimHost, name: string): SandboxInfo {
  const b = h.view.available ? h.view.sandboxes.find((x) => x.name === name) : undefined
  if (!b) throw refuse('NotFound', `no Sandbox named ${name}`)
  return { id: b.name, name: b.name, state: b.state ?? 'running', op: b.op ?? null, backend: b.backend, route: b.route, project: b.project, image: b.image ?? null, machine: b.machine, workspaces: h.workspaces[name] ?? [] }
}

/** The chats on a simulated host's Workspaces: every fourth Workspace has none, every third chat is working, one is a scenario's. */
function chatsOf(v: MachinesView, workspaces: Record<string, WorkspaceInfo[]>): AgentSessionSummary[] {
  const project = (sandbox: string) => (v.available ? v.sandboxes.find((b) => b.name === sandbox)?.project : null) ?? null
  return Object.entries(workspaces)
    .flatMap(([sandbox, list]) => list.map((w) => ({ sandbox, w })))
    .flatMap(({ sandbox, w }, i) => {
      if (i % 4 === 3) return []
      const title = BRANCHES.find(([b]) => b === w.branch)?.[1] ?? w.branch
      const key = project(sandbox)
      const chat: AgentSessionSummary = {
        id: `sim-${w.ws}`,
        title,
        cwd: '/',
        project: key,
        workspace: { branch: w.branch, state: 'ready', sandbox, path: w.path, head: null, commitCount: 0, lastSaved: null, error: null },
        created: Date.now() - (i + 1) * 3_600_000,
        updated: Date.now() - i * 37 * 60_000,
        state: i % 3 === 0 ? 'running' : 'idle',
        provider: null,
        modelId: null,
        thinkingLevel: 'medium',
        permissionMode: 'ask',
        error: null,
        ...(i === 2 && key ? { scenario: { id: 'shop-tour', title: 'Shop tour, three agents', project: key, folder: 'shop-tour_1', state: 'playing' as const, phase: null, checks: [], error: null } } : {}),
      }
      return [chat]
    })
}

// ---------- actions on a simulated view ----------

export type MachineAction =
  | { kind: 'create'; input: NewMachine }
  | { kind: 'remove'; name: string }
  | { kind: 'start'; name: string }
  | { kind: 'stop'; name: string }
  | { kind: 'update'; name: string; changes: { image?: string; docker?: string; wsl?: string } }
  | { kind: 'close'; sandbox: string; force: boolean }
  | { kind: 'unmount'; ws: string }

const refuse = (code: string, message: string) => Object.assign(new Error(message), { code })

/** The host after `action`, refused as LayerFS refuses it (InUse, Exists, InvalidInput, NotFound). */
export function simulate(h: SimHost, action: MachineAction): SimHost {
  const v = h.view
  if (!v.available) throw refuse('Unsupported', 'machines need Connect on LayerFS 2.0')
  if (action.kind === 'close') {
    const b = v.sandboxes.find((x) => x.name === action.sandbox)
    if (!b) throw refuse('NotFound', `no Sandbox named ${action.sandbox}`)
    const workspaces = { ...h.workspaces }
    delete workspaces[b.name]
    const machines = v.machines.map((m) => (m.name === b.machine ? { ...m, sandboxes: m.sandboxes.filter((x) => x !== b.name) } : m))
    return { ...h, view: { ...v, machines, sandboxes: v.sandboxes.filter((x) => x !== b) }, workspaces }
  }
  if (action.kind === 'unmount') {
    const sandbox = action.ws.slice(0, action.ws.indexOf(':'))
    const list = h.workspaces[sandbox] ?? []
    if (!list.some((w) => w.ws === action.ws)) throw refuse('NotFound', `no Workspace ${action.ws}`)
    const left = list.filter((w) => w.ws !== action.ws)
    return { ...h, view: { ...v, sandboxes: v.sandboxes.map((b) => (b.name === sandbox ? { ...b, workspaces: left.length } : b)) }, workspaces: { ...h.workspaces, [sandbox]: left } }
  }
  return { ...h, view: simulateView(v, action) }
}

function simulateView(v: MachinesView, action: Exclude<MachineAction, { kind: 'close' | 'unmount' }>): MachinesView {
  if (!v.available) throw refuse('Unsupported', 'machines need Connect on LayerFS 2.0')
  const machines = v.machines.map((m) => ({ ...m, stores: [...m.stores], sandboxes: [...m.sandboxes] }))
  const find = (name: string) => machines.find((m) => m.name === name)
  if (action.kind === 'create') {
    const i = action.input
    if (find(i.name) || BUILT_IN.has(i.name)) throw refuse('Exists', `a machine named ${i.name} exists`)
    machines.push({ name: i.name, platform: i.platform, backend: 'namespaces', state: 'stopped', cpus: i.cpus ?? 2, memory: i.memory ?? 4 * GIB, disk: i.disk ?? 20 * GIB, stores: [], sandboxes: [], image: i.image ?? IMAGE })
    return { ...v, machines, status: { ...v.status, [i.name]: { name: i.name, state: 'stopped', freeDisk: i.disk ?? 20 * GIB, toolVersion: v.platforms.find((c) => c.platform === i.platform)?.version ?? null, down: null } } }
  }
  if (action.kind === 'remove') {
    const m = find(action.name)
    if (!m) throw refuse('NotFound', `no machine named ${action.name}`)
    if (BUILT_IN.has(m.platform)) throw refuse('InvalidInput', `${m.name} is built in and can't be removed`)
    if (m.stores.length || m.sandboxes.length) throw refuse('InUse', `${m.name} holds ${m.stores.length} Stores; move them first`)
    const status = { ...v.status }
    delete status[m.name]
    return { ...v, machines: machines.filter((x) => x !== m), status }
  }
  if (action.kind === 'start' || action.kind === 'stop') {
    const m = find(action.name)
    if (!m) throw refuse('NotFound', `no machine named ${action.name}`)
    if (action.kind === 'stop' && m.sandboxes.length) throw Object.assign(refuse('InUse', `machine ${m.name} runs Sandboxes ${m.sandboxes.join(', ')}; close them first`), { detail: { related: m.sandboxes.map((name) => ({ kind: 'sandbox', name })) } })
    if (m.platform !== 'native') m.state = action.kind === 'start' ? 'running' : 'stopped'
    return { ...v, machines, status: { ...v.status, [m.name]: { ...(v.status[m.name] ?? { name: m.name, freeDisk: null, toolVersion: null }), state: m.state, down: action.kind === 'stop' ? 'the machine is stopped' : null } } }
  }
  const m = find(action.name)
  if (!m) throw refuse('NotFound', `no machine named ${action.name}`)
  Object.assign(m, Object.fromEntries(Object.entries(action.changes).filter(([, x]) => x)))
  return { ...v, machines }
}
