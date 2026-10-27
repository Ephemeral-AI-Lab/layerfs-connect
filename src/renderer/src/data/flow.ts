// The Projects page's live flow: a project's sessions, the database that
// holds its history, and the computes where its Workspaces mount.
//
// Each agent call mounts a Workspace from the head, runs its command and
// commits; the Workspace then unmounts. Sample data drives that loop on a
// timer until the host process reports the real one.

import type { Agent, Project } from '@/data/sample'
import type { Database } from '@/data/storage'

export interface FlowCompute {
  id: string
  label: string
  kind: 'docker' | 'native'
  os: 'darwin' | 'linux' | 'win32'
  /** The Sandbox container, for Docker. */
  container?: string
}

/**
 * A PostgreSQL project is reachable from any machine, so its sample spans
 * three. A local SQLite file opens only on this machine.
 */
export function computesFor(project: Project, db: Database | undefined): FlowCompute[] {
  const here: FlowCompute = {
    id: 'docker',
    label: 'Docker · this machine',
    kind: 'docker',
    os: 'darwin',
    container: `layerfs-${project.key}-1`,
  }
  if (db?.kind !== 'postgres') return [here]
  return [
    here,
    { id: 'build-box', label: 'Linux · build-box', kind: 'native', os: 'linux' },
    { id: 'wsl', label: 'Windows · WSL2', kind: 'docker', os: 'win32', container: `layerfs-${project.key}-2` },
  ]
}

export const COMMANDS: Record<Agent, string[]> = {
  builder: ['npm test', 'pnpm build', 'npm run lint'],
  reviewer: ['git diff main', 'rg TODO src'],
  tester: ['k6 run load.js', 'npm test -- cart'],
  docs: ['vale docs/', 'npm run docs'],
}

export type Phase = 'idle' | 'mounting' | 'exec' | 'commit'

export const PHASE_LABEL: Record<Phase, string> = {
  idle: 'between calls',
  mounting: 'mounting',
  exec: 'call in flight',
  commit: 'committing',
}

/** One session's place in its loop. */
export interface Live {
  phase: Phase
  /** Simulated milliseconds when this phase ends. */
  until: number
  compute?: string
  workspace?: string
  /** The head Commit the Workspace mounted from. */
  from?: number
  command?: string
  /** Which compute the next mount goes to. */
  next: number
}

/** The sketch's opening frame for shop; other projects start from the sessions' busy flags. */
export const OPENING: Record<string, Partial<Record<string, Omit<Live, 'next'>>>> = {
  shop: {
    pay: { phase: 'exec', until: 3200, compute: 'docker', workspace: 'ws-c04d', from: 43, command: 'npm test' },
    cartapi: { phase: 'mounting', until: 1500, compute: 'wsl', workspace: 'ws-e71b', from: 43 },
    load: { phase: 'idle', until: 5200 },
    apidocs: { phase: 'idle', until: 8800 },
  },
}
