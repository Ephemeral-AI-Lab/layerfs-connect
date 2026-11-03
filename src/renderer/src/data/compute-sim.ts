// Simulated machines for designing the Compute page on hosts this machine is
// not. Each case is GET /api/machines as host/machines.js builds it from
// LayerFS 2.0's machine.list() (machine/calls.rs), store.list(),
// sandbox.list() and machine.status(); `older` is a Connect linked to a
// LayerFS with no machines. Dev builds switch between them on the page; the
// harness takes ?page=compute&case=<id>. The page's actions work on a copy in
// memory (simulate below), refused as LayerFS would refuse them.

import { BUILT_IN, DEFAULT_SANDBOX_IMAGE, GIB, type Os } from '@/data/compute'
import type { MachineInfo, MachineLive, MachinePlatformInfo, MachineSandbox, MachinesView, MachineStore, NewMachine, PlatformOption } from '@shared/host-api'

export type SimId = 'mac-fresh' | 'mac-mixed' | 'mac-nested' | 'mac-busy' | 'windows' | 'older'
export const SIM_IDS: SimId[] = ['mac-fresh', 'mac-mixed', 'mac-nested', 'mac-busy', 'windows', 'older']
export const isSimId = (v: unknown): v is SimId => typeof v === 'string' && (SIM_IDS as string[]).includes(v)

export interface Simulation {
  label: string
  os: Os
  view: MachinesView
}

const IMAGE = DEFAULT_SANDBOX_IMAGE.digest
const LAYERFS = '2.0.0'

type Available = Extract<MachinesView, { available: true }>

const native = (stores: string[] = [], sandboxes: string[] = []): MachineInfo => ({ name: 'native', platform: 'native', backend: 'native', state: 'ready', cpus: null, memory: null, disk: null, stores, sandboxes })
const docker = (stores: string[] = [], sandboxes: string[] = [], over: Partial<MachineInfo> = {}): MachineInfo => ({
  name: 'docker',
  platform: 'docker',
  backend: 'docker',
  state: 'ready',
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
  cpus: size[0],
  memory: size[1] * GIB,
  disk: size[2] * GIB,
  stores,
  sandboxes,
  image: IMAGE,
  ...over,
})
const live = (name: string, state: string, freeGib: number | null, tool: string | null, down: string | null = null): MachineLive => ({ name, state, freeDisk: freeGib === null ? null : freeGib * GIB, toolVersion: tool, down })
const store = (name: string, machine: string, projects: number, sizeGb: number): MachineStore => ({ name, machine, projects, size: sizeGb * 1e9 })
const box = (name: string, machine: string, project: string, workspaces: number): MachineSandbox => ({ name, machine, project, workspaces })
/** The create options each platform declares (as machine.platforms lists them), for sample rows. */
const VM_OPTIONS: PlatformOption[] = [{ name: 'cpus', kind: 'int' }, { name: 'memory', kind: 'size' }, { name: 'disk', kind: 'size' }, { name: 'image', kind: 'text' }]
const OPTIONS: Record<string, PlatformOption[]> = {
  'apple-container': VM_OPTIONS,
  microsandbox: VM_OPTIONS,
  lima: [...VM_OPTIONS, { name: 'nested', kind: 'bool' }],
  firecracker: [...VM_OPTIONS, { name: 'host', kind: 'name' }],
  ssh: [{ name: 'user', kind: 'text' }, { name: 'port', kind: 'int' }, { name: 'identity', kind: 'text' }, { name: 'known_hosts', kind: 'text' }, { name: 'root', kind: 'text' }],
}
const can = (platform: string, version: string | null, missing: string[] = []): MachinePlatformInfo => ({
  platform,
  how: platform === 'ssh' ? 'connected' : 'created',
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
    can('firecracker', 'firecracker v1.12.1 (in Lima)'),
    can('ssh', 'OpenSSH_10.0p2'),
  ].map((c) => over[c.platform as string] ?? c)

const view = (machines: MachineInfo[], platforms: MachinePlatformInfo[], stores: MachineStore[], sandboxes: MachineSandbox[], status: MachineLive[]): Available => ({
  available: true,
  layerfs: LAYERFS,
  machines,
  platforms,
  stores,
  sandboxes,
  status: Object.fromEntries(status.map((s) => [s.name, s])),
})

// mac-fresh: a new home on an M1 Mac, the built-ins alone; every kind's create state (2.0's
// machine/probe.rs names): ready, a missing tool, the Linux bundle missing, hardware that can't nest
const macFresh = view(
  [native(['default'], []), docker([], [])],
  MAC_CAN({
    microsandbox: can('microsandbox', null, ['tool:msb']),
    lima: can('lima', null, ['tool:limactl']),
    firecracker: can('firecracker', null, ['host:apple-m3', 'tool:limactl']),
    'apple-container': can('apple-container', 'container CLI version 0.6.1', ['bundle:~/.cache/layerfs/bundle/2.0.0']),
  }),
  [store('default', 'native', 0, 0.001)],
  [],
  [live('docker', 'ready', 51.2, 'Docker 29.5.2')],
)

// mac-mixed: the mockup's five machines; the ssh host is down
const macMixed = view(
  [
    native(['shop'], ['3', '4']),
    docker(['team'], ['1']),
    vm('dev', 'lima', 'running', [4, 8, 40], ['agents'], ['1', '2'], { nested: true }),
    vm('scratch', 'microsandbox', 'stopped', [2, 4, 20], ['scratch'], []),
    { name: 'gpu-box', platform: 'ssh', backend: 'namespaces', state: 'down', cpus: null, memory: null, disk: null, stores: ['models'], sandboxes: [], ssh: { host: 'gpu-box.lan', user: 'ubuntu', port: 22, identity: '~/.ssh/id_ed25519', root: '/layerfs/data' } },
  ],
  MAC_CAN(),
  [store('shop', 'native', 3, 2.4), store('team', 'docker', 2, 1.1), store('agents', 'dev', 4, 6.8), store('scratch', 'scratch', 1, 0.3), store('models', 'gpu-box', 2, 41.5)],
  [box('3', 'native', 'shop/api', 2), box('4', 'native', 'shop/web', 1), box('1', 'docker', 'team/todo', 1), box('1', 'dev', 'agents/crawler', 3), box('2', 'dev', 'agents/indexer', 1)],
  [
    live('docker', 'ready', 43.7, 'Docker 29.5.2'),
    live('dev', 'running', 31.2, 'limactl version 2.0.1'),
    live('scratch', 'stopped', 18.9, 'msb 0.2.6'),
    live('gpu-box', 'down', null, null, 'ssh: connect to host gpu-box.lan port 22: Operation timed out'),
  ],
)

// mac-nested: an M3 Mac that can nest, whose one Lima machine was made without --nested: Firecracker
// is ready, and its form makes a nested Lima machine first
const macNested = view(
  [native(['shop'], ['1']), docker([], []), vm('dev', 'lima', 'running', [4, 8, 40], ['agents'], ['1'])],
  MAC_CAN(),
  [store('shop', 'native', 2, 1.4), store('agents', 'dev', 3, 4.2)],
  [box('1', 'native', 'shop/api', 1), box('1', 'dev', 'agents/crawler', 2)],
  [live('docker', 'ready', 47.9, 'Docker 29.5.2'), live('dev', 'running', 30.4, 'limactl version 2.0.1')],
)

// mac-busy: many Stores on each machine, many Sandboxes
const busyStores = [
  ...['shop', 'blog', 'docs', 'infra', 'ml-lab', 'mobile', 'site', 'billing'].map((n, i) => store(n, 'native', 1 + (i % 4), 0.4 + i * 0.7)),
  ...['team', 'ci', 'demo'].map((n, i) => store(n, 'docker', 2 + i, 1.2 + i)),
  ...['agents', 'evals', 'crawl', 'search', 'notebooks', 'data'].map((n, i) => store(n, 'build', 1 + i, 3.1 + i * 2.2)),
  store('fc-runs', 'fc1', 5, 9.4),
]
const busyBoxes = [
  ...Array.from({ length: 6 }, (_, i) => box(String(i + 1), 'native', ['shop/api', 'blog/main', 'docs/site', 'infra/tf', 'ml-lab/nb', 'site/web'][i], 1 + (i % 3))),
  ...Array.from({ length: 4 }, (_, i) => box(String(i + 1), 'docker', ['team/todo', 'ci/runner', 'ci/runner', 'demo/app'][i], 1)),
  ...Array.from({ length: 9 }, (_, i) => box(String(i + 1), 'build', ['agents/a', 'agents/b', 'evals/x', 'crawl/q', 'search/idx', 'notebooks/n', 'data/etl', 'data/etl', 'evals/y'][i], 1 + (i % 4))),
  ...Array.from({ length: 3 }, (_, i) => box(String(i + 1), 'fc1', 'fc-runs/job', 1)),
]
const macBusy = view(
  [
    native(busyStores.filter((s) => s.machine === 'native').map((s) => s.name), busyBoxes.filter((b) => b.machine === 'native').map((b) => b.name)),
    docker(busyStores.filter((s) => s.machine === 'docker').map((s) => s.name), busyBoxes.filter((b) => b.machine === 'docker').map((b) => b.name)),
    vm('build', 'lima', 'running', [8, 16, 120], busyStores.filter((s) => s.machine === 'build').map((s) => s.name), busyBoxes.filter((b) => b.machine === 'build').map((b) => b.name), { nested: true }),
    vm('fc1', 'firecracker', 'running', [2, 2, 20], ['fc-runs'], ['1', '2', '3'], { host: 'build' }),
    vm('ac1', 'apple-container', 'starting', [2, 4, 20], [], []),
  ],
  MAC_CAN(),
  busyStores,
  busyBoxes,
  [live('docker', 'ready', 12.4, 'Docker 29.5.2'), live('build', 'running', 64.2, 'limactl version 2.0.1'), live('fc1', 'running', 8.1, 'firecracker v1.12.1'), live('ac1', 'starting', 20, 'container CLI version 0.6.1')],
)

// windows: native keeps records only (no Sandboxes run there); docker runs through WSL2
const windows = view(
  [native(['notes'], []), docker(['shop'], ['1', '2'], { wsl: 'Ubuntu-24.04', docker: 'npipe:////./pipe/docker_engine' })],
  [
    can('apple-container', null, ['host:macos']),
    can('microsandbox', null, ['tool:msb']),
    can('lima', null, ['host:macos', 'tool:limactl']),
    can('firecracker', null, ['host:macos', 'tool:limactl']),
    can('ssh', 'OpenSSH_for_Windows_9.5p1'),
  ],
  [store('notes', 'native', 1, 0.05), store('shop', 'docker', 2, 2.2)],
  [box('1', 'docker', 'shop/api', 2), box('2', 'docker', 'shop/web', 1)],
  [live('docker', 'ready', 88.0, 'Docker 29.4.0 (WSL2)')],
)

const older: MachinesView = { available: false, layerfs: '1.1.0', reason: 'This LayerFS has no machines: they come with LayerFS 2.0.' }

export const SIMULATIONS: Record<SimId, Simulation> = {
  'mac-fresh': { label: 'Mac, fresh home', os: 'darwin', view: macFresh },
  'mac-mixed': { label: 'Mac, five machines, one down', os: 'darwin', view: macMixed },
  'mac-nested': { label: 'Mac M3, no nested Lima machine', os: 'darwin', view: macNested },
  'mac-busy': { label: 'Mac, many Stores', os: 'darwin', view: macBusy },
  windows: { label: 'Windows (Docker via WSL2)', os: 'win32', view: windows },
  older: { label: 'Older LayerFS (no machines)', os: 'darwin', view: older },
}

// ---------- actions on a simulated view ----------

export type MachineAction =
  | { kind: 'create'; input: NewMachine }
  | { kind: 'remove'; name: string }
  | { kind: 'move'; store: string; machine: string }
  | { kind: 'start'; name: string }
  | { kind: 'stop'; name: string }
  | { kind: 'update'; name: string; changes: { image?: string; docker?: string; wsl?: string } }

const refuse = (code: string, message: string) => Object.assign(new Error(message), { code })

/** The view after `action`, refused as LayerFS refuses it (InUse, Exists, InvalidInput). */
export function simulate(v: MachinesView, action: MachineAction): MachinesView {
  if (!v.available) throw refuse('Unsupported', 'machines need Connect on LayerFS 2.0')
  const machines = v.machines.map((m) => ({ ...m, stores: [...m.stores], sandboxes: [...m.sandboxes] }))
  const find = (name: string) => machines.find((m) => m.name === name)
  if (action.kind === 'create') {
    const i = action.input
    if (find(i.name) || BUILT_IN.has(i.name)) throw refuse('Exists', `a machine named ${i.name} exists`)
    if (i.platform === 'ssh') {
      const [user, host] = i.host.includes('@') ? i.host.split('@') : [i.user ?? 'root', i.host]
      machines.push({ name: i.name, platform: 'ssh', backend: 'namespaces', state: 'stopped', cpus: null, memory: null, disk: null, stores: [], sandboxes: [], ssh: { host, user, port: i.port ?? 22, identity: i.identity ?? null, root: i.root ?? '/layerfs/data' } })
    } else {
      if (i.platform === 'firecracker' && !machines.some((m) => m.name === i.host && m.platform === 'lima' && m.nested)) throw refuse('InvalidInput', `${i.host} is not a lima machine made with --nested`)
      machines.push({ name: i.name, platform: i.platform, backend: 'namespaces', state: 'stopped', cpus: i.cpus ?? 2, memory: i.memory ?? 4 * GIB, disk: i.disk ?? 20 * GIB, stores: [], sandboxes: [], image: i.image ?? IMAGE, ...(i.nested ? { nested: true } : {}), ...(i.host ? { host: i.host } : {}) })
    }
    return { ...v, machines, status: { ...v.status, [i.name]: { name: i.name, state: 'stopped', freeDisk: i.platform === 'ssh' ? null : (i.disk ?? 20 * GIB), toolVersion: v.platforms.find((c) => c.platform === i.platform)?.version ?? null, down: null } } }
  }
  if (action.kind === 'remove') {
    const m = find(action.name)
    if (!m) throw refuse('NotFound', `no machine named ${action.name}`)
    if (BUILT_IN.has(m.platform)) throw refuse('InvalidInput', `${m.name} is built in and can't be removed`)
    if (m.stores.length || m.sandboxes.length) throw refuse('InUse', `${m.name} holds ${m.stores.length} Stores; move them first`)
    if (machines.some((x) => x.host === m.name)) throw refuse('InUse', `${m.name} hosts Firecracker machines`)
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
  if (action.kind === 'move') {
    const from = machines.find((m) => m.stores.includes(action.store))
    const to = find(action.machine)
    if (!from || !to) throw refuse('NotFound', 'no such Store or machine')
    if (from.sandboxes.length && v.sandboxes.some((b) => b.machine === from.name && b.project?.startsWith(`${action.store}/`))) throw refuse('InUse', `${action.store} has running Sandboxes on ${from.name}`)
    from.stores = from.stores.filter((s) => s !== action.store)
    to.stores.push(action.store)
    return { ...v, machines, stores: v.stores.map((s) => (s.name === action.store ? { ...s, machine: to.name } : s)) }
  }
  const m = find(action.name)
  if (!m) throw refuse('NotFound', `no machine named ${action.name}`)
  Object.assign(m, Object.fromEntries(Object.entries(action.changes).filter(([, x]) => x)))
  return { ...v, machines }
}
