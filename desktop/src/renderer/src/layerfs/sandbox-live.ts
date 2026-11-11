import type { ChatDetail, ChatSummary, ChildRun } from './agent-api'
import type { SandboxInfo } from './host-api'
import type { SandboxMapData } from '@/components/sandbox/SandboxMap'

export interface LiveCall {
  id: string; agent: string; step: string; method: string; start: string; ms: number | null; ok: boolean | null
  branch?: string | null; sandbox?: string | null; path?: string | null; ws?: string | null; kind?: string | null; code?: string | null
}
export interface LiveMount { sandbox: string; path: string; ws?: string | null; branch: string; agent: string; users?: string[]; since: number }
export interface LiveActor { id: string; name: string; childId: string | null; task: string; state: string }
export interface SandboxLive {
  calls: LiveCall[]
  actors?: LiveActor[]
  live: { mounts: LiveMount[]; running: { id: string; agent: string; method: string; sandbox?: string | null; path?: string | null; ws?: string | null; branch?: string | null }[]; last: Record<string, { branch?: string | null }> }
}
export interface ConversationLive { chat: ChatSummary; detail?: ChatDetail; value: SandboxLive }
export const actorKey = (chat: string, actor: string) => `${chat}/${actor}`
export function traceActor(child: ChildRun): string {
  const trace = child as ChildRun & { traceAgent?: string; sessionFile?: string }
  return trace.traceAgent ?? (trace.sessionFile?.match(/_([^/]+)\.jsonl$/)?.[1] ? `child-${trace.sessionFile.match(/_([^/]+)\.jsonl$/)![1]}` : `pending-${child.id}`)
}

/** Merge actual trace attribution with inventory; no inferred ownership from project membership. */
export function sandboxLiveData(sandboxes: SandboxInfo[], branches: { name: string }[], feeds: ConversationLive[], epoch: number): SandboxMapData {
  const actors: SandboxMapData['actors'] = [], events: SandboxMapData['events'] = [], links: Record<string, string> = {}
  const workspaces = new Map<string, SandboxMapData['workspaces'][number]>()
  for (const sandbox of sandboxes) for (const workspace of sandbox.workspaces) workspaces.set(workspace.ws, { id: workspace.ws, name: workspace.name ?? workspace.path, path: workspace.path, sandbox: sandbox.name, branch: workspace.branch, users: [] })
  for (const { chat, detail, value } of feeds) {
    const key = (agent: string) => actorKey(chat.id, agent)
    const metadata = value.actors ?? [{ id: 'root', name: 'Main', childId: null, task: chat.title, state: chat.state }, ...(detail?.children ?? []).map(child => ({ id: traceActor(child), name: child.agent, childId: child.id, task: child.task ?? '', state: child.state }))]
    const mountFor = (call: { ws?: string | null; sandbox?: string | null; path?: string | null }) => value.live.mounts.find(m => (call.ws && call.ws === m.ws) || (call.sandbox === m.sandbox && call.path === m.path))
    for (const mount of value.live.mounts) {
      const id = mount.ws ?? `${mount.sandbox}:${mount.path}`
      const existing = workspaces.get(id)
      workspaces.set(id, { id, name: existing?.name ?? mount.path.split('/').at(-1) ?? id, path: mount.path, branch: mount.branch, sandbox: mount.sandbox, users: [...new Set([...(existing?.users ?? []), ...(mount.users ?? [mount.agent]).map(key)])] })
    }
    for (const actor of metadata) {
      const active = value.live.running.find(call => call.agent === actor.id)
      const mount = active ? mountFor(active) : value.live.mounts.find(m => (m.users ?? [m.agent]).includes(actor.id))
      const latest = [...value.calls].reverse().find(call => call.agent === actor.id && call.branch)
      const branch = active?.branch ?? mount?.branch ?? value.live.last[actor.id]?.branch ?? latest?.branch ?? ''
      actors.push({ id: key(actor.id), name: actor.name, task: actor.task, parent: actor.childId === null ? null : key('root'), branch, workspace: mount ? mount.ws ?? `${mount.sandbox}:${mount.path}` : undefined, state: actor.state })
      links[key(actor.id)] = `/chat/${encodeURIComponent(chat.id)}${actor.childId ? `/subagents/${encodeURIComponent(actor.childId)}` : ''}`
    }
    const running = new Set(value.live.running.map(call => `${call.agent}/${call.id}`))
    for (const call of value.calls) {
      const active = running.has(`${call.agent}/${call.id}`)
      // A start with no result after an interrupted chat is not a live operation.
      if (call.ok === null && !active) continue
      const mount = mountFor(call)
      const start = Date.parse(call.start) / 1000 - epoch
      if (!Number.isFinite(start)) continue
      events.push({ id: `${key(call.agent)}/${call.id}`, actor: key(call.agent), method: call.method, branch: call.branch ?? mount?.branch ?? '', sandbox: call.sandbox ?? mount?.sandbox ?? undefined, workspace: call.ws ?? (mount ? mount.ws ?? `${mount.sandbox}:${mount.path}` : undefined), start, end: active ? Infinity : start + (call.ms ?? 0) / 1000, detail: call.method, result: call.kind ?? call.code ?? (call.ok ? 'Succeeded' : 'Interrupted'), outcome: call.ok === false ? 'error' : call.ok === true ? 'ok' : 'unknown' })
    }
  }
  const linkedBranches = new Set([...actors.map(a => a.branch), ...[...workspaces.values()].map(w => w.branch)].filter(Boolean))
  return { actors, events: events.sort((a, b) => a.start - b.start || a.id.localeCompare(b.id)), links, workspaces: [...workspaces.values()], branches: actors.length ? [...linkedBranches].map(name => ({ name })) : branches, sandboxes: sandboxes.map(s => ({ name: s.name, machine: s.machine, backend: s.backend, state: s.state, refusal: s.refusal ? `${s.refusal.code}: ${s.refusal.message}` : undefined, unread: s.unread })) }
}
