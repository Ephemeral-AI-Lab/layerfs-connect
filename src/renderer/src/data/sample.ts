// Sample data until the host process serves real projects and sessions.
// Same names as the Connect dashboard mock.

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
  /** The database holding its history; exactly one. */
  database: string
  lastCommit: { id: string; ago: string }
  size: string
  sessions: Session[]
}

export const PROJECTS: Project[] = [
  {
    key: 'wayfare',
    database: 'team',
    lastCommit: { id: 'c15', ago: '4 min ago' },
    size: '12.4 MB',
    sessions: [
      { id: 'checkout', title: 'Checkout refactor', agent: 'builder', busy: true },
      { id: 'review', title: 'Review checkout PR', agent: 'reviewer', busy: false },
      { id: 'flaky', title: 'Fix flaky cart test', agent: 'tester', busy: true },
      { id: 'notes', title: 'Release notes', agent: 'docs', busy: false },
    ],
  },
  {
    key: 'quarry',
    database: 'default',
    lastCommit: { id: 'c62', ago: '9 min ago' },
    size: '48.1 MB',
    sessions: [
      { id: 'qdocs', title: 'Quarry docs', agent: 'docs', busy: true },
      { id: 'parser', title: 'Parser cleanup', agent: 'builder', busy: false },
    ],
  },
  {
    key: 'docs-site',
    database: 'lab',
    lastCommit: { id: 'c4', ago: '2 h ago' },
    size: '3.2 MB',
    sessions: [
      { id: 'docs', title: 'Docs pass', agent: 'docs', busy: false },
      { id: 'links', title: 'Link check', agent: 'reviewer', busy: false },
    ],
  },
  {
    key: 'archive',
    database: 'archive',
    lastCommit: { id: 'c1', ago: '3 days ago' },
    size: '210 MB',
    sessions: [{ id: 'import', title: 'Import old site', agent: 'builder', busy: false }],
  },
  {
    key: 'shop',
    database: 'pg-team',
    lastCommit: { id: 'c31', ago: '1 min ago' },
    size: '27.9 MB',
    sessions: [
      { id: 'pay', title: 'Payment tests', agent: 'builder', busy: true },
      { id: 'cartapi', title: 'Review cart API', agent: 'reviewer', busy: false },
      { id: 'load', title: 'Load test', agent: 'tester', busy: false },
      { id: 'apidocs', title: 'API docs', agent: 'docs', busy: false },
    ],
  },
  {
    key: 'depot',
    database: 'pg-lab',
    lastCommit: { id: 'c12', ago: '1 day ago' },
    size: '6.5 MB',
    sessions: [{ id: 'inv', title: 'Inventory sync', agent: 'builder', busy: false }],
  },
]
