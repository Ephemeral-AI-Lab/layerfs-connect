// Local, deterministic UI playback. Nothing here calls LayerFS or an agent.
export type Scenario = 'parallel' | 'shared' | 'conflict' | 'busy' | 'empty'
import type { Activity, Actor, Workspace } from '@/components/sandbox/model'
export type { Activity, Actor, Workspace, Outcome } from '@/components/sandbox/model'
export { workspaceState } from '@/components/sandbox/model'
export const DURATION = 36
export const SCENARIOS: { id: Scenario; label: string }[] = [
  { id: 'parallel', label: 'Parallel agents' }, { id: 'shared', label: 'Shared workspace' },
  { id: 'conflict', label: 'Commit conflict' }, { id: 'busy', label: 'Unmount refused' },
  { id: 'empty', label: 'Empty project' },
]
export function scene(scenario: Scenario, title: string) {
  const shared = scenario === 'shared'
  const actors: Actor[] = [
    { id: 'main', name: 'Main agent', task: title.replace(/^Example\s*[·-]\s*/, ''), parent: null, branch: 'search', workspace: 'dev:search' },
    { id: 'reviewer', name: 'Reviewer', task: 'Review query handling', parent: 'main', branch: 'search', workspace: shared ? 'dev:search' : 'dev:review' },
    { id: 'tests', name: 'Main agent', task: 'Improve search tests', parent: null, branch: 'search-tests', workspace: 'checks:tests' },
    { id: 'tester', name: 'Tester', task: 'Check empty and mixed-case queries', parent: 'tests', branch: 'search-tests', workspace: 'checks:tests' },
    { id: 'explorer', name: 'Explorer', task: 'Inspect existing coverage', parent: 'tests', branch: 'search-tests' },
  ]
  const workspaces: Workspace[] = [
    { id: 'dev:search', name: 'search', branch: 'search', sandbox: 'dev', users: shared ? ['main', 'reviewer'] : ['main'] },
    ...shared ? [] : [{ id: 'dev:review', name: 'review', branch: 'search', sandbox: 'dev', users: ['reviewer'] }],
    { id: 'checks:tests', name: 'tests', branch: 'search-tests', sandbox: 'checks', users: ['tests', 'tester'] },
  ]
  const review = shared ? 'dev:search' : 'dev:review'
  const events: Activity[] = [
    { id: 'read', start: 0, end: 3, actor: 'explorer', method: 'file.read', branch: 'search-tests', detail: '/test/filter.test.ts', result: 'Read existing test coverage from the branch. No mount needed.', outcome: 'ok' },
    { id: 'create', start: 0, end: 3, actor: 'tests', method: 'sandbox.create', branch: 'search-tests', sandbox: 'checks', detail: 'Create checks on Docker', result: 'Running · checks is bound to this project.', outcome: 'ok' },
    { id: 'edit', start: 2, end: 5, actor: 'main', method: 'workspace.exec', branch: 'search', workspace: 'dev:search', detail: 'node scripts/update-filter.mjs', result: 'exit:0 · Updated src/filter.ts. Changes remain uncommitted.', outcome: 'ok' },
    { id: 'mount', start: 3, end: 6, actor: 'tester', method: 'workspace.mount', branch: 'search-tests', workspace: 'checks:tests', sandbox: 'checks', detail: 'Mount search-tests as tests', result: 'Mounted · /workspaces/tests', outcome: 'ok' },
    { id: 'review', start: 6, end: 12, actor: 'reviewer', method: 'workspace.exec', branch: 'search', workspace: review, detail: 'npm test -- filter', result: 'exit:0\nPASS empty query\nPASS mixed-case query\n2 passed, 0 failed.', outcome: 'ok' },
    { id: 'test', start: 7, end: 14, actor: 'tester', method: 'workspace.exec', branch: 'search-tests', workspace: 'checks:tests', detail: 'npm test -- coverage', result: 'exit:0\n4 passed, 0 failed.\nCoverage report written.', outcome: 'ok' },
    { id: 'commit', start: 14, end: 17, actor: 'main', method: 'workspace.commit', branch: 'search', workspace: 'dev:search', detail: 'Normalize project search', result: 'Committed · example-search-3\nWorkspace stays mounted.', outcome: 'ok' },
    { id: 'tests-commit', start: 17, end: 20, actor: 'tests', method: 'workspace.commit', branch: 'search-tests', workspace: 'checks:tests', detail: 'Add query coverage', result: scenario === 'conflict' ? 'Conflict · Branch head moved.\nConflict markers written to /test/filter.test.ts. No commit published.' : 'Committed · example-tests-2\nCaptured changes from both agents using this workspace.', outcome: scenario === 'conflict' ? 'error' : 'ok' },
    { id: 'unmount', start: 23, end: 26, actor: 'tests', method: 'workspace.unmount', branch: 'search-tests', workspace: 'checks:tests', sandbox: 'checks', detail: 'Unmount tests', result: scenario === 'busy' ? 'Busy · A process still holds the mount.\nThe workspace remains mounted and usable.' : scenario === 'conflict' ? 'Dirty · Uncommitted conflict resolution remains.\nThe workspace remains mounted.' : 'Unmounted · Workspace overlay removed. Committed branch history is preserved.', outcome: scenario === 'busy' || scenario === 'conflict' ? 'error' : 'ok' },
    { id: 'close', start: 29, end: 32, actor: 'tests', method: 'sandbox.close', branch: 'search-tests', sandbox: 'checks', detail: 'Close checks', result: scenario === 'busy' || scenario === 'conflict' ? 'MountsActive · checks still has a mounted workspace.\nSandbox remains running.' : 'Closed · Runtime removed. Committed project history is preserved.', outcome: scenario === 'busy' || scenario === 'conflict' ? 'error' : 'ok' },
  ]
  return scenario === 'empty' ? { actors: [], workspaces: [], events: [] } : { actors, workspaces, events }
}
