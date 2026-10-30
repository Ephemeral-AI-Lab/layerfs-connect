// Live's layout, worked out from the data before anything draws: the
// sessions' agents as trees (with what is folded and where each agent's calls
// start), the open Sandboxes joined with the Workspaces the sessions mounted,
// the project's Branch rows grouped by run, and where each call travels.
import type { AgentRun, BranchInfo, LiveMount, ProjectState } from '@shared/host-api'

import type { FlowRoute } from '@/components/runs/live-flow'
import { type LiveSession, branchRun } from '@/components/runs/live-data'
import { type AgentColor, isLive } from '@/components/runs/run-format'
import { treeOrder } from '@/components/runs/thread'

/** Subagents at this depth or deeper start folded under their parent. */
const FOLD_DEPTH = 3
/** Sessions shown open by default; playing ones first. */
const OPEN_SESSIONS = 2

/** One session drawn in Live. */
export interface Group {
  session: LiveSession
  /** Its run's name: the folder (`crew_2`). */
  name: string
  colorOf: (agent: string) => AgentColor
}

export const wsKey = (sandbox: string, path: string) => `${sandbox}:${path}`
export const agentKey = (run: string, name: string) => `${run}/${name}`

/** A command as its script wrote it: without the `cd <run> || exit 97` a run's scope puts first (host/runs/scope.js). */
export const shownCommand = (command: string | null | undefined) => (command ? command.replace(/^cd [A-Za-z0-9_.-]+ \|\| exit 97\n/, '') : command)

/** An agent still at work in its session: root, or started and not finished. */
export const activeAgent = (a: AgentRun) => !a.parent || !['done', 'failed', 'stopped'].includes(a.state)

// ---------- folds ----------

/**
 * What the user folded or opened, over the defaults: "s:<run id>" for a
 * session, "a:<scenario>:<agent>" for an agent (by scenario, so the next run
 * of it keeps the fold).
 */
export type Folds = Record<string, boolean>

// ---------- Sandboxes ----------

export interface WsView {
  key: string
  sandbox: string
  path: string
  branch: string | null
  mount: (LiveMount & { run: string }) | null
}

export interface SandboxView {
  id: string
  name: string | null
  state: string
  madeBy: { run: string; agent: string } | null
  workspaces: WsView[]
}

/** Open Sandboxes: the project's, joined with the ones the sessions' agents made and the Workspaces they mounted. */
export function sandboxViews(state: ProjectState | undefined, groups: Group[]): SandboxView[] {
  const out = new Map<string, SandboxView>()
  const made = new Map<string, { run: string; agent: string }>()
  for (const g of groups) for (const s of g.session.live.sandboxes) made.set(s.id, { run: g.session.run.id, agent: s.agent })
  for (const s of state?.sandboxes ?? []) {
    if (s.state === 'gone' || s.state === 'exited') continue
    out.set(s.id, {
      id: s.id,
      name: s.name,
      state: s.state,
      madeBy: made.get(s.id) ?? null,
      workspaces: s.workspaces.map((w) => ({ key: wsKey(s.id, w.path), sandbox: s.id, path: w.path, branch: w.branch || null, mount: null })),
    })
  }
  for (const [id, by] of made) if (!out.has(id)) out.set(id, { id, name: null, state: 'running', madeBy: by, workspaces: [] })
  // an ended session's Workspaces were unmounted when it ended
  for (const g of groups) {
    if (!isLive(g.session.run.state)) continue
    for (const m of g.session.live.mounts) {
      let s = out.get(m.sandbox)
      if (!s) out.set(m.sandbox, (s = { id: m.sandbox, name: null, state: 'running', madeBy: null, workspaces: [] }))
      const key = wsKey(m.sandbox, m.path)
      const mount = { ...m, run: g.session.run.id }
      const w = s.workspaces.find((x) => x.key === key)
      // the newest mount of a place is the one there; its Branch is the one the call named
      if (w) {
        if (!w.mount || w.mount.since <= m.since) Object.assign(w, { mount, branch: m.branch ?? w.branch })
      } else s.workspaces.push({ key, sandbox: m.sandbox, path: m.path, branch: m.branch, mount })
    }
  }
  return [...out.values()].sort((a, b) => Number(a.id) - Number(b.id) || a.id.localeCompare(b.id))
}

// ---------- the project's Branch rows ----------

export interface HubRows {
  main: BranchInfo | undefined
  /** Each session's open Branches, in the sessions' order; `name` is the Branch's name inside its run. */
  runs: { group: Group; rows: { branch: BranchInfo; name: string }[] }[]
  /** Open Branches of no session shown here. */
  others: number
  /** Every Branch with a row, so calls can pass through it. */
  names: Set<string>
}

/** Open Branches as the project card lists them: main, then each session's, by run. */
export function hubRows(state: ProjectState | undefined, groups: Group[]): HubRows {
  const open = (state?.branches ?? []).filter((b) => b.state === 'open')
  const main = open.find((b) => b.name === 'main')
  const folders = groups.map((g) => g.name)
  const byRun = new Map<string, { branch: BranchInfo; name: string }[]>()
  let others = 0
  for (const b of open) {
    if (b.name === 'main') continue
    const at = branchRun(b.name, folders)
    if (!at) others++
    else byRun.set(at.folder, [...(byRun.get(at.folder) ?? []), { branch: b, name: at.name }])
  }
  const runs = groups.flatMap((g) => {
    const rows = byRun.get(g.name)
    byRun.delete(g.name) // two runs with one folder list it once
    return rows ? [{ group: g, rows }] : []
  })
  const names = new Set([...(main ? ['main'] : []), ...runs.flatMap((r) => r.rows.map((x) => x.branch.name))])
  return { main, runs, others, names }
}

// ---------- the agents' trees ----------

/** A session's agent as a card: where it sits in the tree, and what it hides. */
export interface TreeNode {
  agent: AgentRun
  key: string
  depth: number
  parent: string | null
  /** Subagents at any depth, still at work. */
  below: AgentRun[]
  hasKids: boolean
  folded: boolean
  visible: boolean
}

export interface GroupLayout {
  group: Group
  folded: boolean
  nodes: TreeNode[]
  /** The anchor an agent's calls start from, for every agent of the session (finished ones too). */
  origin: (name: string) => string
}

/** Lays one session out; `rank` is its place among the sessions (playing ones first). */
export function layoutGroup(group: Group, folds: Folds, rank: number, many: boolean): GroupLayout {
  const { run } = group.session
  const rid = run.id
  const folded = many && (folds[`s:${rid}`] ?? (!isLive(run.state) || rank >= OPEN_SESSIONS))
  const shown = run.agents.filter(activeAgent)
  const order = treeOrder(shown, (a) => a.name, (a) => a.parent)
  const names = new Set(shown.map((a) => a.name))
  const parentOf = new Map<string, string | null>()
  for (const { item } of order) parentOf.set(item.name, item.parent && names.has(item.parent) && item.parent !== item.name ? item.parent : null)
  const kids = new Map<string, AgentRun[]>()
  for (const { item } of order) {
    const p = parentOf.get(item.name)
    if (p) kids.set(p, [...(kids.get(p) ?? []), item])
  }
  const below = (name: string): AgentRun[] => (kids.get(name) ?? []).flatMap((k) => [k, ...below(k.name)])
  const foldedAgent = new Map<string, boolean>()
  for (const { item, depth } of order) foldedAgent.set(item.name, folds[`a:${run.demo}:${item.name}`] ?? (depth >= FOLD_DEPTH - 1 && kids.has(item.name)))

  const originShown = new Map<string, string>()
  const nodes: TreeNode[] = order.map(({ item, depth }) => {
    const chain: string[] = []
    for (let p = parentOf.get(item.name); p; p = parentOf.get(p) ?? null) chain.unshift(p)
    const top = chain.find((p) => foldedAgent.get(p))
    const key = agentKey(rid, item.name)
    originShown.set(item.name, folded ? `session-${rid}` : top ? `agent-${agentKey(rid, top)}` : `agent-${key}`)
    return {
      agent: item,
      key,
      depth,
      parent: parentOf.get(item.name) ?? null,
      below: below(item.name),
      hasKids: kids.has(item.name),
      folded: foldedAgent.get(item.name) ?? false,
      visible: !folded && !top,
    }
  })
  const all = new Map(run.agents.map((a) => [a.name, a]))
  const origin = (name: string): string => {
    const seen = new Set<string>()
    for (let n: string | null = name; n && !seen.has(n); n = all.get(n)?.parent ?? null) {
      seen.add(n)
      const o = originShown.get(n)
      if (o) return o
    }
    return folded ? `session-${rid}` : `agent-${agentKey(rid, order[0]?.item.name ?? 'root')}`
  }
  return { group, folded, nodes, origin }
}

// ---------- calls ----------

/** Where a call travels on the graph; null for calls that do not reach LayerFS (subagent tools, jobs). */
export function routeOf(
  g: Group,
  c: { agent: string; method: string; branch?: string | null; sandbox?: string | null; path?: string | null },
  rows: Set<string>,
  workspaces: Set<string>,
): FlowRoute | null {
  const family = c.method.split('.')[0]
  if (family === 'agent' || family === 'job') return null
  let branch = c.branch ?? null
  let to: string | null = null
  if (c.sandbox && family === 'workspace' && c.path) {
    const key = wsKey(c.sandbox, c.path)
    to = workspaces.has(key) ? `ws-${key}` : `sandbox-${c.sandbox}`
    branch ??= g.session.live.mounts.find((m) => m.sandbox === c.sandbox && m.path === c.path)?.branch ?? null
  } else if (c.sandbox && (family === 'sandbox' || family === 'workspace')) to = `sandbox-${c.sandbox}`
  return { agent: agentKey(g.session.run.id, c.agent), via: branch && rows.has(branch) ? `branch-${branch}` : null, to }
}

/** The four calls every Workspace use makes, in order. */
export const CYCLE = ['mount', 'exec', 'commit', 'unmount'] as const
