import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'

const contexts = new AsyncLocalStorage()
export const protectedActivity = name => /^(?:demo|simulation)\./.test(name ?? '')
export const activityContext = () => contexts.getStore()
export const withActivity = (context, run) => contexts.run(context, run)

/** Only correlation metadata crosses process boundaries; never request bodies. */
export function activityEnv(state) {
  const context = activityContext()
  return {
    LAYERFS_CONNECT_ACTIVITY_STATE: state,
    ...(context ? { LAYERFS_CONNECT_ACTIVITY_CONTEXT: JSON.stringify(context.action) } : {}),
  }
}

export function inheritedAction() {
  try { return validateAction(JSON.parse(process.env.LAYERFS_CONNECT_ACTIVITY_CONTEXT)) } catch { return null }
}

export function validateAction(value) {
  if (!value || typeof value !== 'object' || typeof value.id !== 'string' || !/^[\w-]{1,80}$/.test(value.id)) return null
  const text = (v) => typeof v === 'string' ? v.slice(0, 200) : undefined
  return { id: value.id, name: text(value.name) ?? 'desktop.action', label: text(value.label) ?? 'Desktop action', target: text(value.target), page: text(value.page), origin: value.origin === 'user' ? 'user' : 'background' }
}

export function requestAction(value, method, path) {
  const valid = validateAction(value)
  return valid ?? { id: randomUUID(), name: 'host.request', label: `${method} ${path}`, origin: 'background' }
}
