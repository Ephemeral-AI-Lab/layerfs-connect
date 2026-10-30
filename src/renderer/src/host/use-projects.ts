import { useCallback, useEffect, useRef, useState } from 'react'
import type { ProjectSummary } from '@shared/host-api'

import { toMs } from '@/data/format'
import { host } from '@/host/client'
import type { Loaded } from '@/host/use-host'

export interface ProjectCatalog extends Loaded<ProjectSummary[]> {
  add: (project: ProjectSummary) => void
  remove: (name: string) => Promise<void>
  removed: ReadonlySet<string>
}

const ordered = (projects: ProjectSummary[]) => projects
  .filter((project) => !project.demo && !project.run)
  .sort((a, b) => (toMs(b.created) ?? 0) - (toMs(a.created) ?? 0) || a.name.localeCompare(b.name))

/** One directory for the sidebar, Projects page and Chat workspace picker. */
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
    setData((current) => ordered([project, ...(current ?? []).filter((item) => item.name !== project.name)]))
    setRemoved((current) => new Set([...current].filter((name) => name !== project.name)))
    reload()
  }, [reload])

  const remove = useCallback(async (name: string) => {
    await host.removeProject(name)
    request.current += 1
    setData((current) => current?.filter((project) => project.name !== name))
    setRemoved((current) => new Set([...current, name]))
    reload()
  }, [reload])

  useEffect(() => {
    reload()
    return () => { request.current += 1 }
  }, [reload])

  return { data, error, loading, reload, add, remove, removed }
}
