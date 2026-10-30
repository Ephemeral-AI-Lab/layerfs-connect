const fail = (status, message) => Object.assign(new Error(message), { status })
const working = (record) => record.state === 'running' || record.children.some((child) => ['running', 'pending', 'queued', 'paused'].includes(child.state))

/** Conversation organization never removes its Pi files or LayerFS history. */
export function updateSession(manager, id, input = {}) {
  manager.checkHistoryAvailable(id)
  const record = manager.record(id)
  manager.checkProjectAvailable(record.project)
  const stopping = manager.stopping.get(id)
  if (stopping?.pending || stopping?.removing) throw fail(409, 'Wait for this conversation to stop.')
  const title = typeof input.title === 'string' ? input.title.trim() : undefined
  if (input.title !== undefined && (typeof input.title !== 'string' || !title || title.length > 120)) throw fail(400, 'Enter a conversation title of 1–120 characters.')
  if (input.archived !== undefined && typeof input.archived !== 'boolean') throw fail(400, 'Choose whether to archive this conversation.')
  if (input.archived && working(record)) throw fail(409, 'Stop this conversation and its subagents before archiving it.')

  const task = Promise.resolve().then(async () => {
    if (input.archived && !record.archived) await manager.stop(id, { history: true })
    if (title !== undefined) record.title = title
    if (input.archived !== undefined) {
      record.archived = input.archived
      record.archivedAt = input.archived ? Date.now() : null
    }
    manager.changed(id, true)
    return manager.detail(id)
  })
  manager.historyOperations.set(id, task)
  return task.finally(() => { if (manager.historyOperations.get(id) === task) manager.historyOperations.delete(id) })
}
