// Compute: where a run's commands run with a Workspace mounted.
//
// - Docker: a LayerFS Sandbox is a container running one daemon; Workspaces
//   mount inside it. The only compute LayerFS has today, and the default.
// - Native: mount on this machine and run commands without a container.
//   LayerFS can't mount on a host yet (Linux needs host mounts; macOS and
//   Windows need a mount driver backend).
// - Cloud sandboxes: a provider runs the Sandbox. They can't open a local
//   SQLite file, so they wait on PostgreSQL storage as well.
//
// Static descriptions only; what runs comes from the host (HostStatus and
// each project's Sandboxes).

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
  docker: 'Local SQLite',
  native: 'Local SQLite',
  modal: 'PostgreSQL only',
  e2b: 'PostgreSQL only',
  daytona: 'PostgreSQL only',
  aws: 'PostgreSQL only',
}

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
}

export const CLOUD: CloudProvider[] = [
  { id: 'modal', blurb: 'Sandboxes on Modal' },
  { id: 'e2b', blurb: 'Firecracker microVMs' },
  { id: 'daytona', blurb: 'Dev environments as a service' },
  { id: 'aws', blurb: 'Fargate tasks in your AWS account' },
]
