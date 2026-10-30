import { useCallback, useEffect, useRef, useState } from 'react'
import { projectKey, type ProjectSummary } from '@shared/host-api'

import { toMs } from '@/data/format'
import { host, onProjectsChanged } from '@/host/client'
import type { Loaded } from '@/host/use-host'

export interface ProjectCatalog extends Loaded<ProjectSummary[]> {
  add: (project: ProjectSummary) => void
  /** Deletes the project with this key (projectKey: `store/name` in a shared Store). */
  remove: (key: string) => Promise<void>
  /** Keys of projects deleted in this app since the directory was read. */
  removed: ReadonlySet<string>
}

const ordered = (projects: ProjectSummary[]) => projects
  .filter((project) => !project.demo && !project.run)
  .sort((a, b) => (toMs(b.created) ?? 0) - (toMs(a.created) ?? 0) || projectKey(a).localeCompare(projectKey(b)))

/** One directory for the sidebar, Projects page and Chat workspace picker; a project goes by its key (layerfs#506). */
export function useProjects(): ProjectCatalog {
  const [data, setData] = useState<ProjectSummary[]>()
  const [error, setError] = useState<Error>()
  const [loading, setLoading] = useState(true)
  const [removed, setRemoved] = useState<ReadonlySet<string>>(new Set())
  const request = useRef(0)

  const reload = useCallback(() => {
    const version = ++request.current
    setLoading(true)
    setError(undefined)
    void host.projects().then(
      (projects) => {
        if (version !== request.current) return
        setData(ordered(projects))
        setLoading(false)
      },
      (cause: Error) => {
        if (version !== request.current) return
        setError(cause)
        setLoading(false)
      },
    )
  }, [])

  const add = useCallback((project: ProjectSummary) => {
    // An older directory read must not erase a project that just finished creating.
    request.current += 1
    const key = projectKey(project)
    setData((current) => ordered([project, ...(current ?? []).filter((item) => projectKey(item) !== key)]))
    setRemoved((current) => new Set([...current].filter((item) => item !== key)))
    reload()
  }, [reload])

  const remove = useCallback(async (key: string) => {
    await host.removeProject(key)
    request.current += 1
    setData((current) => current?.filter((project) => projectKey(project) !== key))
    setRemoved((current) => new Set([...current, key]))
    reload()
  }, [reload])

  // read again when a project or Store is made or removed anywhere in the app (an Init ended, Storage removed a Store)
  useEffect(() => {
    reload()
    const off = onProjectsChanged(reload)
    return () => { off(); request.current += 1 }
  }, [reload])

  return { data, error, loading, reload, add, remove, removed }
}
