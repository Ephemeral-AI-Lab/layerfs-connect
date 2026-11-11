import type { ChatDetail, ChatMessage, ChatSummary, ChildRun } from './agent-api'

/** Stable persisted messages let completed work/replies skip React rendering. */
function sameMessage(previous: ChatMessage, next: ChatMessage) {
  if (previous.role !== next.role || previous.text !== next.text || previous.status !== next.status || previous.thinking !== next.thinking || previous.entryId !== next.entryId) return false
  // Simulation tool arguments/receipts are immutable after completion. Trace
  // results can arrive just after their shell receipt, so compare call values.
  const a = previous.view?.calls, b = next.view?.calls
  if ((a?.length ?? 0) !== (b?.length ?? 0)) return false
  if (a && b && a.some((call, index) => call.id !== b[index].id || call.ok !== b[index].ok || call.ms !== b[index].ms || call.code !== b[index].code)) return false
  return true
}
export function shareSimulationMessages(previous: ChatDetail | null, next: ChatDetail): ChatDetail {
  if (!previous?.simulation || previous.id !== next.id) return next
  const byId = new Map(previous.messages.map(message => [message.id, message]))
  let unchanged = previous.messages.length === next.messages.length
  const messages = next.messages.map((message, index) => {
    const old = byId.get(message.id)
    const shared = old && sameMessage(old, message) ? old : message
    if (shared !== previous.messages[index]) unchanged = false
    return shared
  })
  return { ...next, messages: unchanged ? previous.messages : messages }
}
export function shareChildMessages(previous: ChatMessage[] | undefined, next: ChatMessage[]) {
  if (!previous) return next
  const byId = new Map(previous.map(message => [message.id, message]))
  let unchanged = previous.length === next.length
  const messages = next.map((message, index) => {
    const old = byId.get(message.id), shared = old && sameMessage(old, message) ? old : message
    if (shared !== previous[index]) unchanged = false
    return shared
  })
  return unchanged ? previous : messages
}

/** Keep fresh headers while accepting a valid transcript response from before it. */
export function mergeChatDetail(previous: ChatDetail | null, next: ChatDetail, metadata: { session: ChatSummary; children?: ChildRun[] } | null) {
  const shared = shareSimulationMessages(previous, next)
  return metadata?.session.id === next.id && metadata.session.updated > next.updated
    ? { ...shared, ...metadata.session, messages: shared.messages, children: metadata.children ?? shared.children }
    : shared
}
