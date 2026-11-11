import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { ActivityStore } from './store.js'
import { activityContext, inheritedAction, protectedActivity } from './context.js'
import { sanitizer } from './redact.js'
import { activityGeneration, activityLease } from './gate.js'

const recorders = new Map()
const identities = new Map()
const invocations = new WeakMap()
export const registerInvocation = (promise, activity) => { if (activity) invocations.set(promise, activity) }
export function invocationIdentity(promise) {
  const invocation = invocations.get(promise)
  return invocation ? { id: invocation.id, actionId: invocation.action.id } : null
}
export function shareInvocation(promise) {
  const invocation = invocations.get(promise), context = activityContext()
  if (!invocation || !context || invocation.action.id === context.action.id) return
  const scrub = sanitizer()
  const action = Object.fromEntries(Object.entries(context.action).map(([key, value]) => [key, typeof value === 'string' ? scrub.bounded(value, 200).text : value]))
  activityRecorder(context.state)?.record(action, 'cli.shared', { shared: true }, invocation.id)
}
export const recordBinaryIdentity = (cli, identity) => identities.set(cli, identity)
let fallbackState
export const configureActivity = (state) => { fallbackState = state; return activityRecorder(state) }
export function activityRecorder(state) {
  if (!state) return null
  if (!recorders.has(state)) recorders.set(state, new ActivityRecorder(state))
  return recorders.get(state)
}

class ActivityRecorder extends EventEmitter {
  constructor(state) { super(); this.state = state; this.store = new ActivityStore(state); this.seq = 0; this.generations = new Map(); this.notifications = new Map() }
  record(action, type, data = {}, invocationId) {
    try { if (!this.generations.has(action.id)) this.generations.set(action.id, activityGeneration(this.state)) }
    catch { this.store.error = 'CLI activity could not be saved. Check the state directory permissions and free disk space.'; return null }
    const generation = this.generations.get(action.id)
    const event = { v: 1, id: randomUUID(), at: Date.now(), seq: ++this.seq, generation, action, type, invocationId, data }
    const persisted = this.store.append(event, generation)
    Object.defineProperty(event, 'persisted', { value: persisted, enumerable: false })
    // Listeners are observers; they cannot affect the operation.
    if (event.at - (this.notifications.get(action.id) ?? 0) >= 250 || type === 'action.finished') {
      this.notifications.set(action.id, event.at)
      try { this.emit('event', { type: 'cli-activity', actionId: action.id }) } catch { /* Best effort live notification. */ }
    }
    return event
  }
  read(query) { return this.store.read(query) }
  summaries(query) { return this.store.summaries(query) }
  invocationPage(actionId, query) { return this.store.invocationPage(actionId, query) }
  invocation(actionId, id) { return this.store.invocation(actionId, id) }
  capture(actionId, query) { return this.store.capture(actionId, query) }
  flush() { return this.store.pending }
  async clear() { const generation = await this.store.clear(); this.emit('event', { type: 'cli-activity', cleared: true }); return generation }
}

export function beginInvocation(spec, argv, options) {
  const context = activityContext()
  const state = context?.state || process.env.LAYERFS_CONNECT_ACTIVITY_STATE || spec.state || fallbackState
  const recorder = activityRecorder(state)
  if (!recorder) return null
  let release = () => {}
  try { release = activityLease(state) } catch (error) {
    if (error.code === 'ConnectBusy') throw error
    recorder.store.error = 'CLI activity could not be saved. Check the state directory permissions and free disk space.'
  }
  const scrub = sanitizer(argv, { ...process.env, ...options.env })
  const raw = context?.action || inheritedAction() || { id: randomUUID(), name: options.discovery ? 'cli.discovery' : 'host.background', label: options.discovery ? 'CLI discovery' : 'Background CLI call', origin: 'background' }
  const action = Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, typeof value === 'string' ? scrub.bounded(value, 200).text : value]))
  const id = randomUUID()
  const emit = (type, data) => recorder.record(action, type, data, id)
  const queued = Date.now()
  let queuedEvent
  try { queuedEvent = emit('cli.queued', { binary: scrub.bounded(spec.cli || process.env.LAYERFS_CONNECT_CLI || '', 2048).text, argv: scrub.argv, stdin: options.input === undefined ? null : scrub.bounded(Buffer.isBuffer(options.input) ? options.input.toString('utf8') : options.input), mode: 'real', ownerPid: process.pid }) }
  catch (error) { release(); throw error }
  let started, lastProgress = 0, lastStage = '', readyPromise
  return {
    id, action,
    scrub,
    // Called lazily from inside the process-admission lane. Waiting CLI calls
    // retain identity/queued records but cannot steal active terminal capacity.
    ready() {
      return readyPromise ??= Promise.resolve(queuedEvent?.persisted).then(() => recorder.store.reserveInvocation(id, {
          protectedAction: protectedActivity(action.name),
          control: ['cancel', 'kill', 'exec-cancel', 'exec-kill', 'close', 'stop'].includes(argv[1]),
        }))
    },
    started(child, binary) { started = Date.now(); emit('cli.started', { started, pid: child.pid, binary: scrub.bounded(binary.command, 2048).text, identity: identities.get(binary.command), waitMs: started - queued }) },
    progress(value) {
      const now = Date.now()
      const stage = typeof value?.stage === 'string' && typeof value?.state === 'string' ? `${value.stage}:${value.state}` : ''
      if (now - lastProgress < 250 && (!stage || stage === lastStage)) return
      lastProgress = now
      lastStage = stage
      // Only operational progress fields, never arbitrary nested payloads.
      const progress = Object.fromEntries(Object.entries(value ?? {}).filter(([key, v]) => ['phase', 'stage', 'state', 'elapsed_ms', 'done', 'total', 'bytes', 'rate', 'unit'].includes(key) && ['string', 'number'].includes(typeof v)).map(([key, v]) => [key, typeof v === 'string' ? scrub.bounded(v, 200).text : v]))
      emit('cli.progress', { progress })
    },
    finished(data) { try { emit('cli.finished', { ...data, ended: Date.now(), durationMs: started ? Date.now() - started : 0 }) } finally { release() } },
  }
}
