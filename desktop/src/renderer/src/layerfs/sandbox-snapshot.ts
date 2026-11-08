import type { MachineInfo, SandboxInfo } from './host-api'
import type { SandboxSnapshot } from '@/components/sandbox/types'

export function sandboxSnapshot(sandbox: SandboxInfo, project?: string, machine?: MachineInfo): SandboxSnapshot {
  const name = sandbox.machine ?? machine?.name
  return {
    name: sandbox.name, project: sandbox.project ?? project ?? 'Not recorded', runtimeId: sandbox.runtimeId ?? null,
    image: sandbox.image, backend: sandbox.backend ?? null,
    machine: { name: name ?? 'Unknown', state: machine?.state ?? 'Not reported',
      platform: machine?.platform ?? sandbox.platform ?? 'Not reported', architecture: 'Not reported',
      description: 'LayerFS resource record', href: name ? `/machines/${encodeURIComponent(name)}?view=sandboxes` : '/machines' },
    actors: [], events: [], links: {}, duration: 0,
    workspaces: sandbox.workspaces.map(w => ({ ...w, id: w.ws, name: w.name ?? w.path.split('/').at(-1) ?? w.ws,
      path: w.path, activity: w.activity ?? undefined, branch: w.branch, sandbox: sandbox.name, users: [] })),
    scratch: { path: null, files: [] }, workspaceFiles: [],
    recorded: { created: sandbox.created, op: sandbox.op, state: sandbox.state, route: sandbox.route ?? null,
      downReason: sandbox.downReason ?? sandbox.refusal?.message ?? (sandbox.unread ? 'Workspace status has not been read.' : undefined),
      workspacesKnown: !sandbox.downReason && !sandbox.refusal && !sandbox.unread },
  }
}
