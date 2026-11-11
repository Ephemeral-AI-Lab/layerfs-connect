// One list of chats for the whole window: read from the host when the event
// stream connects, then kept current by its `chat` events. The host sends no
// event when a chat is deleted, so removal updates the list here.
import { useSyncExternalStore } from 'react'
import { chatHost, type ChatSummary } from '@/layerfs/agent-api'
import { onHostEvent } from '@/layerfs/client'
import { ChatListIndex } from '@/layerfs/chat-list-state'

interface ChatsState {
  chats: ChatSummary[]
  loaded: boolean
  error: string | null
}

let state: ChatsState = { chats: [], loaded: false, error: null }
const listeners = new Set<() => void>()
const deleted = new Set<string>()
let started = false
const index = new ChatListIndex()
const pending = new Map<string, ChatSummary>()
let timer: ReturnType<typeof setTimeout> | undefined

function set(next: Partial<ChatsState>) {
  state = { ...state, ...next }
  listeners.forEach((l) => l())
}

function reload() {
  void chatHost.list().then(
    (chats) => { index.merge(chats.filter(c => !deleted.has(c.id))); set({ chats: index.list(), loaded: true, error: null }) },
    (cause: Error) => set({ loaded: true, error: cause.message }),
  )
}

/** Adds or replaces one chat (a host event, or a chat this window just made). */
export function upsertChat(chat: ChatSummary) {
  if (deleted.has(chat.id)) return
  if (index.merge([chat])) set({ chats: index.list() })
}

function receive(chat: ChatSummary) {
  if (deleted.has(chat.id)) return
  const previous = pending.get(chat.id)
  if (!previous || previous.updated <= chat.updated) pending.set(chat.id, chat)
  if (timer) return
  timer = setTimeout(() => {
    timer = undefined
    const updates = [...pending.values()]; pending.clear()
    if (index.merge(updates)) set({ chats: index.list() })
  }, 100)
}

export async function deleteChat(id: string) {
  await chatHost.remove(id)
  deleted.add(id)
  pending.delete(id); index.remove(id)
  set({ chats: index.list() })
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
    if (event.type === 'chat' || event.type === 'chat-summary') receive(event.session)
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
