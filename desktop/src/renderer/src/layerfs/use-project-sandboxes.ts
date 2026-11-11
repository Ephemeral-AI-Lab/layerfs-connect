// A project's Sandboxes with their mounted Workspaces (host.projectSandboxes):
// the one project read that asks Sandbox daemons, each with its own short
// limit on the host, so a busy Sandbox shows as busy instead of holding the
// page. The project read (host.project) lists the same Sandboxes without
// their Workspaces and stays fast.
import type { SandboxInfo } from '@/layerfs/host-api'

import { host } from '@/layerfs/client'
import { type Loaded, useHostQuery, usePoll } from '@/layerfs/use-host'

/** The Sandboxes of `project`, reread every `pollMs` while the window shows (null: only when `tick` moves). */
export function useProjectSandboxes(project: string, pollMs: number | null, tick: unknown = 0): Loaded<SandboxInfo[]> {
  const query = useHostQuery(() => host.projectSandboxes(project), [project, tick], `sandboxes:${project}`)
  // Poll through reload: changing dependencies discarded reads slower than the poll.
  usePoll(query.reload, pollMs ?? 5000, pollMs !== null)
  return query
}
