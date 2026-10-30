import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { checkpointFor } from './history.js'
import { assertNativeControl } from './native-input.js'

const fail = (status, message) => Object.assign(new Error(message), { status })
const hasWork = (record) => record.state === 'running' || record.children.some((child) => ['running', 'pending', 'queued', 'paused'].includes(child.state))

/** Forking at a node includes it; the regular conversation action forks before a user entry. */
export function commandForkTarget(manager, record, source, entryId, position = 'before') {
  if (position === 'before') return manager.historyTarget(record, source, entryId)
  if (position !== 'at') throw fail(400, 'Choose before or at for the fork position.')
  const entry = source.getEntry(entryId)
  if (!entry) throw fail(400, 'Choose an existing conversation entry.')
  const checkpoint = record.project && entry.type === 'message' && entry.message.role === 'user' ? checkpointFor(source, entry) : null
  if (record.project && !checkpoint) throw fail(409, 'This entry has no exact LayerFS checkpoint.')
  return { entry, checkpoint, draft: '', attachments: [] }
}

/** Keep Pi's command context tied to Connect conversations and their LayerFS branches. */
export function commandContextActions(manager, id, active) {
  const idle = (work) => manager.withControlIdle(id, work)
  const beforeSwitch = async (reason, targetSessionFile) => {
    const result = await active.session.extensionRunner.emit({
      type: 'session_before_switch', reason, ...(targetSessionFile ? { targetSessionFile } : {}),
    })
    assertNativeControl(active)
    return result?.cancel === true
  }
  const startEvent = (reason) => ({ type: 'session_start', reason, previousSessionFile: active.session.sessionFile })

  async function finishReplacement(nextId, options) {
    assertNativeControl(active)
    const next = manager.live.get(nextId)
    active.replacedBy = nextId
    manager.changed(nextId, true)
    manager.emit('event', { type: 'chat-navigate', fromId: id, sessionId: nextId })
    if (options?.withSession) {
      await manager.withCommandControl(nextId, next, () => options.withSession(next.session.createReplacedSessionContext()))
      manager.changed(next.replacedBy ?? nextId, true)
      if (next.replacedBy) active.replacedBy = next.replacedBy
    }
    return { cancelled: false }
  }

  return {
    waitForIdle: () => active.session.waitForIdle(),

    async newSession(options = {}) {
      const nextId = await idle(async () => {
        if (await beforeSwitch('new')) return null
        const record = manager.record(id)
        const checkpoint = record.project ? await manager.projectWorkspaces.checkpoint(record, () => manager.changed(id, true)) : null
        assertNativeControl(active)
        const previousSessionFile = active.session.sessionFile
        await manager.stop(id)
        assertNativeControl(active)
        await manager.closeHistorySession(id, { reason: 'new' })
        assertNativeControl(active)
        const copyId = randomUUID()
        const barrier = Promise.withResolvers()
        manager.historyOperations.set(copyId, barrier.promise)
        try {
          await manager.createRecord(copyId, {
            cwd: record.cwd, project: record.project,
            provider: record.provider, modelId: record.modelId, thinkingLevel: record.thinkingLevel,
            permissionMode: record.permissionMode, limits: record.limits,
          }, { publish: false })
          assertNativeControl(active)
          const copy = manager.record(copyId)
          if (copy.project) await manager.projectWorkspaces.fork(copy, checkpoint, () => manager.save(copyId))
          assertNativeControl(active)
          await manager.open(copyId, {
            history: true, setup: options.setup, parentSession: options.parentSession,
            sessionStartEvent: { type: 'session_start', reason: 'new', previousSessionFile },
          })
          assertNativeControl(active)
          manager.permissions.resume(copyId)
          return copyId
        } catch (error) {
          if (manager.records.has(copyId)) {
            try {
              manager.historyOperations.delete(copyId)
              await manager.remove(copyId)
            } catch (cleanupError) {
              const copy = manager.record(copyId)
              copy.needsStop = true
              copy.state = 'error'
              copy.error = `New conversation failed: ${error.message}. Cleanup incomplete: ${cleanupError.message}`
              manager.changed(copyId, true)
            }
          }
          throw error
        } finally {
          barrier.resolve()
          if (manager.historyOperations.get(copyId) === barrier.promise) manager.historyOperations.delete(copyId)
        }
      })
      return nextId ? finishReplacement(nextId, options) : { cancelled: true }
    },

    async fork(entryId, options = {}) {
      const nextId = await idle(async () => {
        const position = options.position ?? 'before'
        const before = await active.session.extensionRunner.emit({ type: 'session_before_fork', entryId, position })
        assertNativeControl(active)
        if (before?.cancel) return null
        const record = manager.record(id)
        const source = active.session.sessionManager
        if (record.project && position === 'at') {
          const entry = source.getEntry(entryId)
          if (!entry) throw fail(400, 'Choose an existing conversation entry.')
          if (entry.type !== 'message' || entry.message.role !== 'user' || !checkpointFor(source, entry)) return null
        }
        const event = startEvent('fork')
        const result = await manager.fork(id, { entryId, position })
        await manager.open(result.session.id, { sessionStartEvent: event })
        manager.permissions.resume(result.session.id)
        return result.session.id
      })
      return nextId ? finishReplacement(nextId, options) : { cancelled: true }
    },

    async switchSession(sessionPath, options = {}) {
      const target = [...manager.records.values()].find((record) => record.sessionFile && resolve(record.sessionFile) === resolve(sessionPath))
      if (!target || target.archived || hasWork(target) || manager.controlMutations.has(target.id) || manager.live.get(target.id)?.controls?.size) return { cancelled: true }
      if (target.id === id) return { cancelled: true }
      const nextId = await idle(async () => {
        if (await beforeSwitch('resume', target.sessionFile)) return null
        const event = startEvent('resume')
        manager.checkHistoryAvailable(target.id)
        manager.checkProjectAvailable(target.project)
        await manager.stop(id)
        assertNativeControl(active)
        await manager.closeHistorySession(id, { reason: 'resume', targetSessionFile: target.sessionFile })
        assertNativeControl(active)
        await manager.stop(target.id)
        assertNativeControl(active)
        await manager.closeHistorySession(target.id, { reason: 'resume', targetSessionFile: target.sessionFile })
        assertNativeControl(active)
        await manager.open(target.id, { sessionStartEvent: event })
        assertNativeControl(active)
        manager.permissions.resume(target.id)
        return target.id
      })
      return nextId ? finishReplacement(nextId, options) : { cancelled: true }
    },

    navigateTree(targetId, options) {
      return idle(async () => {
        if (manager.record(id).project) return { cancelled: true }
        const result = await active.session.navigateTree(targetId, options)
        manager.changed(id, true)
        return { cancelled: result.cancelled === true || result.aborted === true }
      })
    },

    reload() {
      return idle(async () => {
        await active.session.reload()
        await active.refreshChildren()
        manager.changed(id, true)
      })
    },
  }
}
