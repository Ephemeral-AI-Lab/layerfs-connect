// The sidebar's chat groups: one per LayerFS project that has chats, newest
// first, then "Scratch" for chats with no project. Archived chats are left out.
import { chatProject, type ChatSummary } from '@/layerfs/agent-api'

export interface ChatGroup {
  /** The project key (`store/name`), or 'scratch'. */
  key: string
  kind: 'project' | 'scratch'
  /** The project's name, or "Scratch". */
  name: string
  /** The project's Store; empty for Scratch. */
  store: string
  chats: ChatSummary[]
}

export const SCRATCH = 'scratch'

/** `store/name` → its two parts (a key with no slash is all name). */
export function splitProjectKey(key: string): { store: string; name: string } {
  const at = key.indexOf('/')
  return at < 0 ? { store: '', name: key } : { store: key.slice(0, at), name: key.slice(at + 1) }
}

export function groupChats(chats: ChatSummary[]): ChatGroup[] {
  const projects = new Map<string, ChatSummary[]>()
  const scratch: ChatSummary[] = []
  for (const chat of chats) {
    if (chat.archived) continue
    const project = chatProject(chat)
    if (!project) scratch.push(chat)
    else projects.set(project, [...(projects.get(project) ?? []), chat])
  }
  const newest = (list: ChatSummary[]) => Math.max(...list.map((c) => c.updated))
  const groups: ChatGroup[] = [...projects]
    .sort((a, b) => newest(b[1]) - newest(a[1]))
    .map(([key, list]) => ({ key, kind: 'project', ...splitProjectKey(key), chats: list }))
  if (scratch.length) groups.push({ key: SCRATCH, kind: 'scratch', name: 'Scratch', store: '', chats: scratch })
  return groups
}
