/** Adapts the same local saved trees used by Files to the existing History graph. */
import type { CommitInfo } from '@/layerfs/host-api'
import { previewBranches, previewCommits, previewOwn, type PreviewCommit } from '@/components/files/file-preview-data'
import type { GraphNode, HistoryBranch } from './model'

export const previewGroupId = 'group:feature-login'
export const previewGroupCommits = previewOwn('feature-login').toReversed().slice(1, -1)
export const previewParent = (commit: PreviewCommit) => previewCommits.find(c => c.id === commit.parent) ?? null
export const previewFind = (id: string | null | undefined) => previewCommits.find(c => c.id === id) ?? null
const info = (c: PreviewCommit): CommitInfo => ({ id: c.id, branch: c.branch, message: c.message, at: Date.parse(c.time), parent: c.parent, kind: c.operation })

export function previewGraph(expanded: boolean): { nodes: GraphNode[]; branches: HistoryBranch[]; lanes: Map<string, number> } {
  const branches = previewBranches.map(b => ({ name: b.name, head: b.head, base: b.forkedFrom ?? previewOwn('main')[0].id, forkedFrom: b.forkedFrom }))
  const nodes = previewCommits.flatMap<GraphNode>(c => {
    if (!expanded && previewGroupCommits.some(g => g.id === c.id)) {
      if (c.id !== previewGroupCommits[0].id) return []
      return [{ id: previewGroupId, branch: c.branch, label: `${previewGroupCommits.length} commits`, commits: previewGroupCommits.map(info), parent: c.parent, second: null, kind: 'group', at: Date.parse(c.time) }]
    }
    return [{ id: c.id, branch: c.branch, label: c.message, commits: [info(c)], parent: c.source ?? c.parent, second: null, kind: c.branch === 'main' ? 'layer' : 'checkpoint', at: Date.parse(c.time) }]
  })
  return { nodes, branches, lanes: new Map([['main', 0], ['feature-login', -1], ['fix-orders', 1], ['review-login', -2], ['release-api', 2]]) }
}
