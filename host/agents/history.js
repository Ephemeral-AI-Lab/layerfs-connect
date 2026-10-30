import { cpSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { SessionManager } from '@earendil-works/pi-coding-agent'

export const CHECKPOINT_TYPE = 'connect.user-checkpoint'

export function checkpointFor(manager, entry) {
  let parent = entry.parentId && manager.getEntry(entry.parentId)
  while (parent) {
    if (parent.type === 'custom' && parent.customType === CHECKPOINT_TYPE) return parent.data?.checkpoint ?? null
    if (parent.type === 'message' && parent.message.role === 'user') break
    parent = parent.parentId && manager.getEntry(parent.parentId)
  }
  return null
}

/** The clone has a new Pi identity and its own files; old pending wakes must not launch work in it. */
export function cloneSession(source, cwd, dir) {
  const sourceDir = dirname(source)
  if (resolve(sourceDir) !== resolve(dir) && existsSync(join(sourceDir, 'tool-output'))) cpSync(join(sourceDir, 'tool-output'), join(dir, 'tool-output'), { recursive: true })
  const clone = SessionManager.forkFrom(source, cwd, dir)
  const file = clone.getSessionFile()
  const entries = readFileSync(file, 'utf8').trimEnd().split('\n').map((line) => JSON.parse(line))
  let changed = false
  for (const entry of entries) {
    if (entry.type === 'custom' && entry.customType === 'subagent-notify-pending') {
      entry.customType = 'connect.copied-subagent-notice'
      changed = true
    }
  }
  if (changed) writeFileSync(file, entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n', { mode: 0o600 })
  return SessionManager.open(file, dir, cwd)
}
