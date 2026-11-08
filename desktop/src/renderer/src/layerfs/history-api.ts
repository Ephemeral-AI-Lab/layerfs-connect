import { call } from '@/layerfs/client'
import type { CommitInfo } from '@/layerfs/host-api'
import type { BranchPage, HistoryBranch } from '@/components/history/model'
const path = (project: string, params: Record<string, string | number | undefined>) => `/api/projects/${encodeURIComponent(project)}/history?${new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]))}`
export const historyApi = {
  branches: (project: string, pos = 0) => call<{ branches: HistoryBranch[]; next: number | null }>('GET', path(project, { pos })),
  commits: (project: string, branch: string, pos = 0, head?: string) => call<BranchPage>('GET', path(project, { branch, pos, head })),
  detail: (project: string, branch: string, commit: string, from?: string, pos = 0) => call<{ item: CommitInfo; changes: CommitInfo['changes'] | null; nextChanges: number | null }>('GET', path(project, { branch, commit, from, pos })),
}
