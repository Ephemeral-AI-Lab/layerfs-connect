// What the Storage page's project tiles show for each project: the machines
// its Sandboxes run on, and when it was made. One hook for every Store card,
// so the machines are read once. A simulated host (dev builds) answers with
// its sample projects.
import { useMemo } from 'react'
import { type StoreFacts, storeFacts, useStorageView } from '@/components/layerfs/StoreFacts'
import { useSimulation } from '@/components/layerfs/Simulation'
import { type RunsOn, runsOn, sandboxesByProject, useMachinesView } from '@/components/layerfs/WhereChips'
import { SIMULATIONS } from '@/layerfs/compute-sim'
import { toMs } from '@/layerfs/format'
import { simProjects, simStorage } from '@/layerfs/home-sim'
import { projectKey, type ProjectSummary } from '@/layerfs/host-api'
import type { ProjectCatalog } from '@/layerfs/use-projects'
import { useNow } from '@/layerfs/use-now'

export interface ProjectRowData {
  project: ProjectSummary
  facts: StoreFacts
  /** The machines its Sandboxes run on; null when the machines were not read. */
  runs: RunsOn[] | null
  sandboxCount: number | null
  workspaceCount: number | null
  /** When the project was made. */
  activity: number | null
}

export interface ProjectRows {
  /** Each project's row by its key (`<store>/<name>`); empty until the catalog is read. */
  byKey: Map<string, ProjectRowData>
  /** The clock the tiles' "ago" reads. */
  now: number
  loaded: boolean
  error: unknown
}

export function useProjectRows(projects: ProjectCatalog): ProjectRows {
  const simId = useSimulation()
  const simulated = simId ? SIMULATIONS[simId] : null
  const liveStorage = useStorageView()
  const storage = simulated ? simStorage(simulated) : liveStorage
  const data = simulated ? simProjects(simulated) : projects.data
  const machines = useMachinesView(simulated?.view ?? null)
  const sandboxes = useMemo(() => sandboxesByProject(machines), [machines])
  const now = useNow(true, 30_000)

  const byKey = useMemo(() => {
    const by = new Map<string, ProjectRowData>()
    for (const project of data ?? []) {
      const key = projectKey(project)
      const boxes = sandboxes?.get(key)?.filter(b => b.state !== 'gone') ?? []
      by.set(key, { project, facts: storeFacts(project, storage), runs: sandboxes ? runsOn(boxes) : null,
        sandboxCount: sandboxes ? boxes.length : null,
        workspaceCount: sandboxes && boxes.every(b => typeof b.workspaces === 'number') ? boxes.reduce((sum, b) => sum + b.workspaces!, 0) : null,
        activity: toMs(project.created) })
    }
    return by
  }, [data, sandboxes, storage])

  return { byKey, now, loaded: !!data, error: simulated ? undefined : projects.error }
}
