// Compute: the machines this Connect's LayerFS home runs on (LayerFS 2.0,
// layerfs#533). `native` and `docker` are built in; VMs are created
// (apple-container, microsandbox, lima, firecracker) and ssh hosts connected.
// A machine holds sqlite Stores, and a project's Sandboxes run on its
// Store's machine. Machines start on the first call that needs them and stop
// after 10 idle minutes.
//
// This file turns GET /api/machines (MachinesView) into what the page shows,
// and checks the New machine forms. It also keeps the Sandbox platform
// helpers the Sandbox lists use (layerfs#529).

import type { HostStatus, MachineCreatable, MachineInfo, MachineLive, MachinePlatform, MachinesView, SandboxInfo, SandboxPlatform } from '@shared/host-api'

export type Os = 'darwin' | 'linux' | 'win32'
export const OS_OF: Record<HostStatus['platform'], Os> = { macos: 'darwin', linux: 'linux', windows: 'win32' }

// ---------- machines ----------

export const GIB = 2 ** 30

/** The VM kinds a home creates; ssh hosts are connected. */
export const VM_KINDS = ['apple-container', 'microsandbox', 'lima', 'firecracker'] as const
export type VmKind = (typeof VM_KINDS)[number]
export const isVmKind = (p: string): p is VmKind => (VM_KINDS as readonly string[]).includes(p)
export const BUILT_IN = new Set(['native', 'docker'])

export const KIND_LABEL: Record<MachinePlatform, string> = {
  native: 'Native',
  docker: 'Docker',
  'apple-container': 'Apple Container',
  microsandbox: 'Microsandbox',
  lima: 'Lima',
  firecracker: 'Firecracker',
  ssh: 'SSH host',
}
export const kindLabel = (p: string) => KIND_LABEL[p as MachinePlatform] ?? p

/** What each kind is, in a few words, for the Add a machine rows. */
export const KIND_BLURB: Record<Exclude<MachinePlatform, 'native' | 'docker'>, string> = {
  'apple-container': 'A Linux VM from Apple’s container tool',
  microsandbox: 'A microVM from msb',
  lima: 'A Linux VM from Lima',
  firecracker: 'A Firecracker microVM inside a nested Lima machine',
  ssh: 'A Linux host you reach over SSH with a key',
}

/** LayerFS's defaults for a new VM (2.0's machine/record.rs). */
export const VM_DEFAULTS = { cpus: 2, memory: 4 * GIB, disk: 20 * GIB } as const
/** The default Sandbox image (owner decision O36): LayerFS's runtime image, sealed into the bundle. */
export const DEFAULT_SANDBOX_IMAGE = { label: 'layerfs runtime', tag: 'layerfs-352-runtime:node24-https-apt-20261024', digest: 'sha256:afa1ef9c27294f9c7298820c06483e6fb1ddafc43a7cc7d6dec8cd2e67abf38e' }
export const SSH_DEFAULTS = { port: 22, root: '/layerfs/data', user: 'root' } as const

/** Native and Docker first, then the rest by name. */
export function machineOrder(machines: MachineInfo[]): MachineInfo[] {
  const rank = (m: MachineInfo) => (m.platform === 'native' ? 0 : m.platform === 'docker' ? 1 : 2)
  return [...machines].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
}

export type MachineTone = 'success' | 'neutral' | 'warning' | 'danger'

/** A machine's state as a pill: answering is success, stopped is idle (it starts on use), down or failed is danger. */
export function machineState(m: MachineInfo, live?: MachineLive): { tone: MachineTone; label: string; key: 'ready' | 'running' | 'idle' | 'starting' | 'creating' | 'down' } {
  const state = (live?.state ?? m.state ?? '').toLowerCase()
  if (m.error || state === 'down' || state === 'failed' || live?.down) return { tone: 'danger', label: state === 'failed' ? 'Failed' : 'Down', key: 'down' }
  if (state === 'running') return { tone: 'success', label: 'Running', key: 'running' }
  if (state === 'ready') return { tone: 'success', label: 'Ready', key: 'ready' }
  if (state === 'starting') return { tone: 'warning', label: 'Starting', key: 'starting' }
  if (state === 'creating') return { tone: 'warning', label: 'Creating', key: 'creating' }
  return { tone: 'neutral', label: 'Idle · starts on use', key: 'idle' }
}

/** Why a machine is down, in LayerFS's words: its status's reason, else its record's error. */
export const downReason = (m: MachineInfo, live?: MachineLive) => live?.down ?? m.error ?? null

/** Binary sizes as LayerFS gives them (8 GiB, 40 GiB). */
export function gib(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  const g = n / GIB
  if (g >= 1) return `${Number.isInteger(g) ? g : g.toFixed(1)} GiB`
  return `${Math.round(n / 2 ** 20)} MiB`
}

/** The Size column: a VM's CPUs, memory and disk; the built-ins and ssh hosts in words. */
export function sizeOf(m: MachineInfo, os: Os, live?: MachineLive): { text: string; values?: Record<string, string | number> } {
  if (m.platform === 'native') return { text: os === 'darwin' ? 'this Mac' : os === 'win32' ? 'this PC' : 'this host' }
  if (m.platform === 'docker') {
    if (os === 'linux') return { text: 'this host’s Docker' }
    return live?.freeDisk != null ? { text: 'Docker’s VM · {free} free', values: { free: gib(live.freeDisk) } } : { text: 'Docker’s VM' }
  }
  if (m.platform === 'ssh') return { text: 'host’s own' }
  return { text: '{cpus} CPU · {memory} · {disk}', values: { cpus: m.cpus ?? VM_DEFAULTS.cpus, memory: gib(m.memory ?? VM_DEFAULTS.memory), disk: gib(m.disk ?? VM_DEFAULTS.disk) } }
}

/** The facts line's numbers: each state counted as it is (only `running` is running). */
export function factsOf(view: Extract<MachinesView, { available: true }>) {
  const n = { ready: 0, running: 0, idle: 0, starting: 0, down: 0 }
  for (const m of view.machines) {
    const s = machineState(m, view.status[m.name]).key
    n[s === 'creating' ? 'starting' : s]++
  }
  const sandboxes = view.machines.reduce((total, m) => total + m.sandboxes.length, 0)
  return { ...n, sandboxes }
}

/** A machine `remove`/`disconnect` refuses while it holds Stores or running Sandboxes (InUse): the reason, or null. */
export function inUse(m: MachineInfo): { stores: number; sandboxes: number } | null {
  return m.stores.length || m.sandboxes.length ? { stores: m.stores.length, sandboxes: m.sandboxes.length } : null
}

/** The machines a Store on `from` can move to: every other machine that is not down (an ssh host takes Stores too). */
export function moveTargets(view: Extract<MachinesView, { available: true }>, from: string): MachineInfo[] {
  return machineOrder(view.machines).filter((m) => m.name !== from && machineState(m, view.status[m.name]).key !== 'down')
}

/** A can_create need in words (2.0's machine/probe.rs names), as a template and its values for t(). */
export function needWords(need: string): { text: string; values?: Record<string, string> } {
  if (need.startsWith('tool:')) return { text: '{tool} not found', values: { tool: need.slice(5) } }
  if (need.startsWith('bundle:')) return { text: 'Needs the LayerFS Linux bundle' }
  const host: Record<string, string> = {
    'host:apple-m3': 'Needs an M3 or later Mac for nested virtualization',
    'host:macos15': 'Needs macOS 15 or later for nested virtualization',
    'host:apple-silicon': 'Needs Apple silicon',
    'host:macos': 'Needs macOS',
    'host:macos-or-linux': 'Needs macOS or Linux',
    'host:wsl2': 'Needs WSL2',
    'host:root': 'Needs Connect to run as root',
    'host:/dev/fuse': 'Needs /dev/fuse',
    'host:cgroup2': 'Needs cgroup v2',
  }
  if (host[need]) return { text: host[need] }
  if (need.startsWith('host:')) return { text: 'This host needs {thing}', values: { thing: need.slice(5) } }
  return { text: need }
}

/** The hardware or OS needs no install fixes (nested virtualization, Apple silicon, the OS itself). */
export const hardwareNeed = (need: string) => need.startsWith('host:')

/** How to get what a kind is missing: steps to copy and a line of words; null when nothing can be done here (the hardware or OS). */
export function installHelp(missing: string[], layerfs: string | null = null): { words: string; values?: Record<string, string>; commands: string[]; label: 'How to install' | 'How to get it' } | null {
  if (missing.some(hardwareNeed)) return null
  const tool = missing.find((n) => n.startsWith('tool:'))?.slice(5)
  if (tool === 'msb') return { label: 'How to install', words: 'Install msb, or put ~/.microsandbox/bin on PATH if it is installed', commands: ['curl -fsSL https://install.microsandbox.dev | sh', 'export PATH="$HOME/.microsandbox/bin:$PATH"'] }
  if (tool === 'container') return { label: 'How to install', words: 'Install Apple’s container tool (macOS 26, Apple silicon), then start it', commands: ['https://github.com/apple/container/releases', 'container system start'] }
  if (tool === 'limactl') return { label: 'How to install', words: 'Install Lima', commands: ['brew install lima'] }
  if (tool === 'ssh') return { label: 'How to install', words: 'Install an OpenSSH client', commands: [] }
  if (tool) return { label: 'How to install', words: 'Install {tool}', values: { tool }, commands: [] }
  if (missing.some((n) => n.startsWith('bundle:'))) {
    // the sealed Linux bundle (2.0 O16): a build places it; fetching it is not built yet
    const version = layerfs ?? '<version>'
    return {
      label: 'How to get it',
      words: 'The sealed Linux bundle for LayerFS {version} goes in {folder}. In a dev build, the layerfs repository places it, one step per command:',
      values: { version, folder: `~/.cache/layerfs/bundle/${version}/` },
      commands: ['daemon', 'worker', 'helper', 'seal'].map((step) => `python3 tools/linux_bundle.py ${step} --resources <resources.json>`),
    }
  }
  return null
}

/** `8G`, `512M`, `40` (GiB) or a byte count -> bytes; null when it can't be read. */
export function parseSize(text: string): number | null {
  const m = /^\s*(\d+(?:\.\d+)?)\s*([kmgt]?)i?b?\s*$/i.exec(text)
  if (!m) return null
  const n = Number(m[1])
  const unit = m[2].toLowerCase()
  const scale = unit === 'k' ? 2 ** 10 : unit === 'm' ? 2 ** 20 : unit === 't' ? 2 ** 40 : GIB
  const out = Math.round(n * scale)
  return out > 0 ? out : null
}

const NAME = /^[a-z0-9][a-z0-9-]{0,30}$/

/** Each kind's short name, as 2.0's cell runner names machines (ac1, msb1, lima1, fc1, ssh1). */
export const KIND_SHORT: Record<string, string> = { 'apple-container': 'ac', microsandbox: 'msb', lima: 'lima', firecracker: 'fc', ssh: 'ssh' }

/** A free name for a new machine of `kind`: `<short><n>`, the lowest n no machine (nor `also`) takes. */
export function freeMachineName(kind: string, machines: MachineInfo[], also: string[] = []): string {
  const taken = new Set([...machines.map((m) => m.name), ...also])
  const short = KIND_SHORT[kind] ?? kind
  for (let n = 1; ; n++) if (!taken.has(`${short}${n}`)) return `${short}${n}`
}

/** A new machine's name: required, valid, not built in, not taken. */
export function nameError(name: string, machines: MachineInfo[]): string | null {
  const n = name.trim()
  if (!n) return 'A name is required'
  if (BUILT_IN.has(n)) return '{name} is built in: choose another name'
  if (!NAME.test(n)) return 'Use lowercase letters, digits and dashes (up to 31), starting with a letter or digit'
  if (machines.some((m) => m.name === n)) return 'A machine named {name} exists'
  return null
}

export interface VmForm {
  name: string
  cpus: string
  memory: string
  disk: string
  /** '' for the default Sandbox image, else a digest or an archive path. */
  image: string
  osImage: string
  /** firecracker: an existing nested lima machine, or `new:<name>` to create one with --nested first. */
  host: string
}
export interface SshForm {
  name: string
  /** user＠host */
  host: string
  port: string
  identity: string
  root: string
}
export type FormErrors<F> = Partial<Record<keyof F, { text: string; values?: Record<string, string> }>>

export const emptyVm = (): VmForm => ({ name: '', cpus: String(VM_DEFAULTS.cpus), memory: '4G', disk: '20G', image: '', osImage: '', host: '' })
export const emptySsh = (): SshForm => ({ name: '', host: '', port: String(SSH_DEFAULTS.port), identity: '', root: SSH_DEFAULTS.root })

/** The nested lima machines a Firecracker machine can run in. */
export const nestedHosts = (machines: MachineInfo[]) => machines.filter((m) => m.platform === 'lima' && m.nested)

export function vmErrors(kind: VmKind, f: VmForm, machines: MachineInfo[]): FormErrors<VmForm> {
  const e: FormErrors<VmForm> = {}
  const named = nameError(f.name, machines)
  if (named) e.name = { text: named, values: { name: f.name.trim() } }
  const cpus = Number(f.cpus)
  if (!Number.isInteger(cpus) || cpus < 1 || cpus > 64) e.cpus = { text: 'A whole number from 1 to 64' }
  const memory = parseSize(f.memory)
  if (memory === null || memory < 512 * 2 ** 20) e.memory = { text: 'At least 512M, such as 4G' }
  const disk = parseSize(f.disk)
  if (disk === null || disk < 2 * GIB) e.disk = { text: 'At least 2G, such as 20G' }
  if (f.image && !/^sha256:[0-9a-f]{12,64}$/.test(f.image) && !f.image.startsWith('/')) e.image = { text: 'A sha256: digest, or an archive’s absolute path' }
  if (kind === 'firecracker') {
    if (!f.host) e.host = { text: 'Choose the Lima machine it runs in' }
    else if (f.host.startsWith('new:')) {
      const hostName = f.host.slice(4)
      const bad = nameError(hostName, machines) ?? (hostName === f.name.trim() ? 'A machine named {name} exists' : null)
      if (bad) e.host = { text: bad, values: { name: hostName } }
    } else if (!nestedHosts(machines).some((m) => m.name === f.host)) e.host = { text: '{name} is not a Lima machine made with --nested', values: { name: f.host } }
  }
  return e
}

export function sshErrors(f: SshForm, machines: MachineInfo[]): FormErrors<SshForm> {
  const e: FormErrors<SshForm> = {}
  const named = nameError(f.name, machines)
  if (named) e.name = { text: named, values: { name: f.name.trim() } }
  if (!/^([a-z_][a-z0-9_.-]*@)?[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/i.test(f.host.trim())) e.host = { text: 'user@host, or a host name' }
  const port = Number(f.port)
  if (!Number.isInteger(port) || port < 1 || port > 65535) e.port = { text: 'A port from 1 to 65535' }
  if (f.identity && !/^(~\/|\/)/.test(f.identity.trim())) e.identity = { text: 'A key file’s path, such as ~/.ssh/id_ed25519' }
  if (!f.root.trim().startsWith('/')) e.root = { text: 'An absolute path on the host' }
  return e
}

/** The ready kinds the New machine menu offers, in can_create's order. */
export const readyKinds = (can: MachineCreatable[]) => can.filter((c) => c.ready)

// ---------- Sandbox platforms (layerfs#529) ----------

/** Every Sandbox platform. */
export const PLATFORMS: readonly SandboxPlatform[] = ['docker', 'mac', 'linux', 'apple-container', 'microsandbox', 'lima', 'firecracker', 'ssh']

export const PLATFORM_LABEL: Record<SandboxPlatform, string> = {
  docker: 'Docker',
  mac: 'Mac',
  linux: 'Linux',
  'apple-container': 'Apple Container',
  microsandbox: 'Microsandbox',
  lima: 'Lima',
  firecracker: 'Firecracker',
  ssh: 'SSH host',
}

const isPlatform = (v: unknown): v is SandboxPlatform => typeof v === 'string' && (PLATFORMS as readonly string[]).includes(v)

/**
 * A Sandbox's platform. A host built against an older LayerFS leaves it out;
 * then it is read from where and how the Sandbox runs: a VM placement's
 * provider, a native one on this Mac (`mac`) or a Linux host (`linux`), else Docker.
 */
export function platformOfSandbox(s: SandboxInfo, os: Os): SandboxPlatform {
  if (isPlatform(s.platform)) return s.platform
  if (s.runtime === 'native') return os === 'darwin' ? 'mac' : 'linux'
  return s.runtime === 'namespaces' ? 'linux' : 'docker'
}
