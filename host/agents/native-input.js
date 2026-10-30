import { AsyncLocalStorage } from 'node:async_hooks'

const scope = new AsyncLocalStorage()
const wrapped = Symbol('connect.native-input')
const stopped = () => Object.assign(new Error('The session is stopping. Send the message again after it stops.'), { status: 409, code: 'stopping' })

/** Keep a plugin command/input operation separate from the model's running task. */
export function currentNativeControl(active) {
  const control = scope.getStore()
  return control?.active === active ? control : null
}

export function staleNativeControl(active) {
  const control = currentNativeControl(active)
  return Boolean(control && (control.signal.aborted || control.generation !== active.inputGeneration))
}

export function assertNativeControl(active) {
  if (staleNativeControl(active)) throw stopped()
}

/** A finished model dispatch can outlive its idle event by one finally microtask. */
export function pendingNativeInput(active) {
  return [...(active.controls ?? [])].some((control) => control.kind !== 'model' && !control.dispatchSettled && control.disposition !== 'handled' && !control.signal.aborted)
}

export function runNativeControl(active, kind, work, { skipInput = false } = {}) {
  active.controls ??= new Set()
  active.inputGeneration ??= 0
  const controller = new AbortController()
  const control = { active, kind, controller, signal: controller.signal, generation: active.inputGeneration, skipInput, task: null, error: null, disposition: null }
  active.controls.add(control)
  control.task = scope.run(control, () => Promise.resolve().then(() => work(control))).finally(() => active.controls.delete(control))
  return control
}

/** Abort waiting UI/input immediately; a command's own cleanup must not await itself. */
export function cancelNativeControls(active, except = currentNativeControl(active)) {
  active.inputGeneration = (active.inputGeneration ?? 0) + 1
  if (except) except.generation = active.inputGeneration
  const tasks = []
  for (const control of active.controls ?? []) {
    if (control === except) continue
    control.controller.abort(stopped())
    if (control.task) tasks.push(control.task)
  }
  return tasks
}

function cancellable(signal, promise) {
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(signal.reason ?? stopped()) }
    if (signal.aborted) abort()
    else signal.addEventListener('abort', abort, { once: true })
    Promise.resolve(promise).then((value) => { signal.removeEventListener('abort', abort); resolve(value) }, (error) => { signal.removeEventListener('abort', abort); reject(error) })
  })
}

function controlContext(context, control) {
  const descriptors = Object.getOwnPropertyDescriptors(context)
  descriptors.ui = { ...descriptors.ui, get: () => new Proxy(context.ui, {
    get(target, key) {
      const value = Reflect.get(target, key, target)
      if (typeof value !== 'function') return value
      return (...args) => {
        if (control.signal.aborted || control.generation !== control.active.inputGeneration) throw control.signal.reason ?? stopped()
        if (['select', 'confirm', 'input'].includes(key)) {
          const options = args[2] ?? {}
          args[2] = { ...options, signal: options.signal ? AbortSignal.any([control.signal, options.signal]) : control.signal }
        }
        const result = value.apply(target, args)
        return ['select', 'confirm', 'input', 'editor', 'custom'].includes(key) ? cancellable(control.signal, result) : result
      }
    },
  }) }
  // Pi copies descriptors for before_agent_start and command contexts. Preserve
  // the guarded lazy UI getter across those copies instead of proxying reads.
  return Object.defineProperties({}, descriptors)
}

/** Pi awaits input before marking itself busy. Cancel that wait rather than only aborting its agent. */
export function bindNativeInput(active) {
  const runner = active.session.extensionRunner
  if (runner[wrapped]) return
  runner[wrapped] = true
  const createContext = runner.createContext.bind(runner)
  runner.createContext = (...args) => {
    const context = createContext(...args)
    const control = currentNativeControl(active)
    return control ? controlContext(context, control) : context
  }
  const emitInput = runner.emitInput.bind(runner)
  runner.emitInput = (...args) => {
    const control = currentNativeControl(active)
    if (!control) return emitInput(...args)
    assertNativeControl(active)
    if (control.skipInput) { control.skipInput = false; return Promise.resolve({ action: 'continue' }) }
    return cancellable(control.signal, emitInput(...args))
  }
  const getCommand = runner.getCommand.bind(runner)
  runner.getCommand = (name) => {
    const command = getCommand(name)
    if (!command) return command
    return { ...command, handler: (args, context) => {
      const control = currentNativeControl(active)
      if (!control) return command.handler(args, context)
      assertNativeControl(active)
      return cancellable(control.signal, command.handler(args, context))
    } }
  }
  if (!active.session[wrapped]) {
    active.session[wrapped] = true
    const reload = active.session.reload.bind(active.session)
    active.session.reload = (options) => reload({ ...options, beforeSessionStart: async () => {
      bindNativeInput(active)
      await options?.beforeSessionStart?.()
    } })
  }
}

export function nativeCommand(active, text) {
  return text.startsWith('/') && Boolean(active.session.extensionRunner.getCommand(text.slice(1).split(' ')[0]))
}
