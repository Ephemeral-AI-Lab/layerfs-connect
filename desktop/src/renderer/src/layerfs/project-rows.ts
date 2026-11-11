// What the Storage page's project tiles show for each project: the machines
// its Sandboxes run on, and when it was made. One hook for every Store card,
// its sample projects.
import { useMemo } from 'react'
import { type StoreFacts, storeFacts, useStorageView } from '@/components/layerfs/StoreFacts'
import { type RunsOn, runsOn, sandboxesByProject, useMachinesView } from '@/components/layerfs/WhereChips'
import { toMs } from '@/layerfs/format'
import { projectKey, type ProjectSummary, type StorageView, type MachinesView } from '@/layerfs/host-api'
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

/** Derive card facts from existing inventory reads without adding subscriptions. */
export function deriveProjectRows(data: ProjectSummary[] | undefined, storage: StorageView | null | undefined, machines: MachinesView | null | undefined): Map<string, ProjectRowData> {
  const sandboxes = sandboxesByProject(machines)
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
}

export function useProjectRows(projects: ProjectCatalog): ProjectRows {
  const storage = useStorageView()
  const data = projects.data
  const machines = useMachinesView()
  const now = useNow(true, 30_000)
  const byKey = useMemo(() => deriveProjectRows(data, storage, machines), [data, storage, machines])
  return { byKey, now, loaded: !!data, error: projects.error }
}
