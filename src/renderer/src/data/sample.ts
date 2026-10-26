// Sample data for the sidebar until the host process serves real projects
// and sessions. Same names as the Connect dashboard mock.

export type Agent = 'builder' | 'reviewer' | 'tester' | 'docs'

export interface Session {
  id: string
  title: string
  agent: Agent
  /** A call is in flight, so a Workspace is mounted for it. */
  busy: boolean
}

export interface Project {
  key: string
  sessions: Session[]
}

export const PROJECTS: Project[] = [
  {
    key: 'wayfare',
    sessions: [
      { id: 'checkout', title: 'Checkout refactor', agent: 'builder', busy: true },
      { id: 'review', title: 'Review checkout PR', agent: 'reviewer', busy: false },
      { id: 'flaky', title: 'Fix flaky cart test', agent: 'tester', busy: true },
      { id: 'notes', title: 'Release notes', agent: 'docs', busy: false },
    ],
  },
  {
    key: 'quarry',
    sessions: [
      { id: 'qdocs', title: 'Quarry docs', agent: 'docs', busy: true },
      { id: 'parser', title: 'Parser cleanup', agent: 'builder', busy: false },
    ],
  },
  {
    key: 'docs-site',
    sessions: [
      { id: 'docs', title: 'Docs pass', agent: 'docs', busy: false },
      { id: 'links', title: 'Link check', agent: 'reviewer', busy: false },
    ],
  },
  {
    key: 'archive',
    sessions: [{ id: 'import', title: 'Import old site', agent: 'builder', busy: false }],
  },
  {
    key: 'shop',
    sessions: [
      { id: 'pay', title: 'Payment tests', agent: 'builder', busy: true },
      { id: 'cartapi', title: 'Review cart API', agent: 'reviewer', busy: false },
      { id: 'load', title: 'Load test', agent: 'tester', busy: false },
      { id: 'apidocs', title: 'API docs', agent: 'docs', busy: false },
    ],
  },
  {
    key: 'depot',
    sessions: [{ id: 'inv', title: 'Inventory sync', agent: 'builder', busy: false }],
  },
]

/** Storage connectors and computes set up, for the sidebar counts. */
export const STORAGE_COUNT = 7
export const COMPUTE_COUNT = 5
