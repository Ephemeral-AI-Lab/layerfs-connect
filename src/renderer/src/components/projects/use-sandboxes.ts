// A project's Sandboxes with their mounted Workspaces (host.projectSandboxes):
// the one project read that asks Sandbox daemons, each with its own short
// limit on the host, so a busy Sandbox shows as busy instead of holding the
// page. The project read (host.project) lists the same Sandboxes without
// their Workspaces and stays fast.
import type { SandboxInfo } from '@shared/host-api'
import { useEffect, useState } from 'react'

import { host } from '@/host/client'
import { type Loaded, useHostQuery } from '@/host/use-host'

/** The Sandboxes of `project`, reread every `pollMs` while the window shows (null: only when `tick` moves). */
export function useProjectSandboxes(project: string, pollMs: number | null, tick: unknown = 0): Loaded<SandboxInfo[]> {
  const [n, setN] = useState(0)
  useEffect(() => {
    if (!pollMs) return
    const timer = setInterval(() => document.hidden || setN((x) => x + 1), pollMs)
    return () => clearInterval(timer)
  }, [pollMs])
  return useHostQuery(() => host.projectSandboxes(project), [project, tick, n], `sandboxes:${project}`)
}
