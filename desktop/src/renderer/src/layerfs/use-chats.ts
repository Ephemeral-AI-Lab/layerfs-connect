// One list of chats for the whole window: read from the host when the event
// stream connects, then kept current by its `chat` events. The host sends no
// event when a chat is deleted, so removal updates the list here.
import { useSyncExternalStore } from 'react'
import { chatHost, type ChatSummary } from '@/layerfs/agent-api'
import { onHostEvent } from '@/layerfs/client'

interface ChatsState {
  chats: ChatSummary[]
  loaded: boolean
  error: string | null
}

let state: ChatsState = { chats: [], loaded: false, error: null }
const listeners = new Set<() => void>()
const deleted = new Set<string>()
let started = false

const newestFirst = (chats: ChatSummary[]) => [...chats].sort((a, b) => b.updated - a.updated)

function set(next: Partial<ChatsState>) {
  state = { ...state, ...next }
  listeners.forEach((l) => l())
}

function reload() {
  void chatHost.list().then(
    (chats) => set({ chats: newestFirst(chats.filter((c) => !deleted.has(c.id))), loaded: true, error: null }),
    (cause: Error) => set({ loaded: true, error: cause.message }),
  )
}

/** Adds or replaces one chat (a host event, or a chat this window just made). */
export function upsertChat(chat: ChatSummary) {
  if (deleted.has(chat.id)) return
  const { messages: _m, queued: _q, approvals: _a, ...summary } = chat as ChatSummary & Record<string, unknown>
  set({ chats: newestFirst([summary as ChatSummary, ...state.chats.filter((c) => c.id !== chat.id)]) })
}

export async function deleteChat(id: string) {
  await chatHost.remove(id)
  deleted.add(id)
  set({ chats: state.chats.filter((c) => c.id !== id) })
}

export async function renameChat(id: string, title: string) {
  upsertChat(await chatHost.update(id, { title }))
}

export async function archiveChat(id: string) {
  upsertChat(await chatHost.update(id, { archived: true }))
}

function start() {
  if (started) return
  started = true
  onHostEvent((event) => {
    if (event.type === 'chat') upsertChat(event.session)
  }, reload)
  reload()
}

function subscribe(listener: () => void) {
  start()
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Every chat, newest first (archived ones too; groupChats leaves them out). */
export function useChats(): ChatsState {
  return useSyncExternalStore(subscribe, () => state)
}
