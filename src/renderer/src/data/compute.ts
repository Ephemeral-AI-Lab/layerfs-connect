// Compute: where a session's commands run and its Workspace is mounted.
//
// - Docker: a LayerFS Sandbox is a container running one daemon; Workspaces
//   mount inside it. The only compute LayerFS has today, and the default.
// - Native: mount on this machine and run commands without a container.
//   LayerFS can't mount on a host yet (Linux needs host mounts; macOS and
//   Windows need a mount driver backend).
// - Cloud sandboxes: a provider runs the Sandbox. They can't open a local
//   SQLite file, so in v1 they serve projects in PostgreSQL databases only.
//
// Sample data shaped like @layerfs/runtime's status() and sandbox.list(),
// until the host process serves the real ones.

export type TargetId = 'docker' | 'native' | CloudId
export type CloudId = 'modal' | 'e2b' | 'daytona' | 'aws'

export const TARGET_LABEL: Record<TargetId, string> = {
  docker: 'Docker',
  native: 'Native',
  modal: 'Modal',
  e2b: 'E2B',
  daytona: 'Daytona',
  aws: 'AWS',
}

/** Which databases a target's Sandboxes can open. */
export const STORAGE_FIT: Record<TargetId, string> = {
  docker: 'Local SQLite and PostgreSQL',
  native: 'Local SQLite and PostgreSQL',
  modal: 'PostgreSQL only',
  e2b: 'PostgreSQL only',
  daytona: 'PostgreSQL only',
  aws: 'PostgreSQL only',
}

export interface DockerInfo {
  status: 'ready' | 'not-running' | 'not-installed'
  engine: string
  version: string
  context: string
  cpus: number
  memory: string
  diskFree: string
  diskTotal: string
  /** Free share of Docker's disk, 0 to 1. */
  diskFreeRatio: number
  image: string
}

export const DOCKER: DockerInfo = {
  status: 'ready',
  engine: 'Docker Desktop',
  version: '29.1.2',
  context: 'desktop-linux',
  cpus: 8,
  memory: '8 GB',
  diskFree: '37 GB',
  diskTotal: '96 GB',
  diskFreeRatio: 37 / 96,
  image: 'sha256:4f1c…9a2e',
}

/** A Workspace mounted in a Sandbox, as sandbox.list_workspaces reports it. */
export interface WorkspaceRow {
  path: string
  branch: string
  base: string
  activity: 'idle' | 'busy'
  /** Connect's own record of what a busy Workspace is doing. */
  doing?: string
  /** Changed paths not yet committed. */
  changed: number
  /** The Connect session that mounted it; absent when another tool did. */
  session?: string
}

export interface SandboxRow {
  name: string
  project: string
  sandbox: string
  running: boolean
  started: string
  scratch: string
  workspaces: WorkspaceRow[]
  /** With no Workspace, a Sandbox closes itself after this many seconds. */
  closesIn?: number
}

/** LayerFS refuses a mount past this many Workspaces in one Sandbox. */
export const SANDBOX_CAPACITY = 16

export const SANDBOXES: SandboxRow[] = [
  {
    name: 'layerfs-wayfare-1',
    project: 'wayfare',
    sandbox: '1',
    running: true,
    started: '12 min ago',
    scratch: '220 MB',
    workspaces: [
      { path: '/workspaces/1', branch: 'feature/checkout', base: 'c34', activity: 'busy', doing: 'npm test', changed: 14, session: 'checkout' },
      { path: '/workspaces/2', branch: 'tests/flaky', base: 'c34', activity: 'idle', changed: 0, session: 'flaky' },
    ],
  },
  {
    name: 'layerfs-wayfare-2',
    project: 'wayfare',
    sandbox: '2',
    running: true,
    started: '4 min ago',
    scratch: '48 MB',
    workspaces: [],
    closesIn: 100,
  },
  {
    name: 'layerfs-quarry-1',
    project: 'quarry',
    sandbox: '1',
    running: true,
    started: '31 min ago',
    scratch: '96 MB',
    workspaces: [
      { path: '/workspaces/1', branch: 'docs/qdocs', base: 'c62', activity: 'busy', doing: 'Commit', changed: 3, session: 'qdocs' },
      { path: '/workspaces/2', branch: 'main', base: 'c62', activity: 'idle', changed: 0 },
    ],
  },
]

/** Stopped Sandboxes still holding disk. */
export const LEFTOVERS = { count: 2, size: '1.1 GB' }

export type Os = 'darwin' | 'linux' | 'win32'

export interface NativeInfo {
  os: string
  /** The mount driver LayerFS would need here. */
  driver: string
  driverFound: boolean
  /** Why LayerFS can't run natively here yet. */
  reason: string
}

export function nativeInfo(platform: string): NativeInfo {
  switch (platform) {
    case 'linux':
      return {
        os: 'Linux',
        driver: 'FUSE (/dev/fuse)',
        driverFound: true,
        reason: 'LayerFS mounts Workspaces only inside a Sandbox today; host mounts are not built.',
      }
    case 'win32':
      return {
        os: 'Windows',
        driver: 'WinFsp',
        driverFound: false,
        reason: 'LayerFS has no Windows mount backend yet.',
      }
    default:
      return {
        os: 'macOS',
        driver: 'macFUSE or FSKit',
        driverFound: false,
        reason: 'LayerFS has no macOS mount backend yet.',
      }
  }
}

export interface CloudProvider {
  id: CloudId
  blurb: string
  /** Set once connected: the account and where Sandboxes run. */
  account?: string
  region?: string
}

export const CLOUD: CloudProvider[] = [
  { id: 'modal', blurb: 'Sandboxes on Modal', account: 'team-workspace', region: 'us-east' },
  { id: 'e2b', blurb: 'Firecracker microVMs', account: 'personal', region: 'us-west' },
  { id: 'daytona', blurb: 'Dev environments as a service' },
  { id: 'aws', blurb: 'Fargate tasks in your AWS account' },
]

export interface ComputeSettings {
  enabled: Record<TargetId, boolean>
  /** Where new sessions run; always an enabled target. */
  defaultTarget: TargetId
}

export const COMPUTE_SETTINGS: ComputeSettings = {
  enabled: { docker: true, native: false, modal: true, e2b: false, daytona: false, aws: false },
  defaultTarget: 'docker',
}
