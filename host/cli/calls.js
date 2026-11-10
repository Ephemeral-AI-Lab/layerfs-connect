import { discover } from './capabilities.js'
import { execute } from './spawn.js'
import { bytes } from './json.js'
import { CliError } from './outcome.js'
import { shareInvocation } from '../activity/recorder.js'
const invalid = (message) => new CliError('InvalidInput', message)
const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && !ArrayBuffer.isView(v)
const reads = new Set(['list', 'get', 'status', 'platforms', 'stats', 'commits', 'get_commit', 'read', 'stat', 'glob', 'grep', 'blame', 'diff', 'revision'])
export function client(spec) {
  const flying = new Map()
  const families = new Map()
  return new Proxy({ home: spec.home }, { get(target, family) {
    if (family in target) return target[family]
    if (family === 'then') return undefined
    if (!families.has(family)) families.set(family, new Proxy({}, { get(_unused, call) {
      return async (...given) => {
        const help = await discover(spec)
        const entry = help.calls.find((c) => c.family === family && c.call === call)
        if (!entry) throw invalid(`No CLI call ${String(family)}.${String(call)}`)
        const args = [...given]
        let options = {}
        const last = args.at(-1), slot = entry.args[args.length - 1]
        if (args.length > entry.args.length || (isPlain(last) && slot?.kind !== 'json')) options = args.pop() ?? {}
        if (!isPlain(options) || args.length > entry.args.length) throw invalid('Invalid CLI arguments')
        for (const name of Object.keys(options)) if (!['on_spawn', 'before_spawn'].includes(name) && !entry.options.some((o) => o.name === name)) throw invalid(`${family}.${call}: unknown option ${name}`)
        for (const [name,value] of Object.entries(options)) {
          const option = entry.options.find((o)=>o.name===name)
          if (option?.kind === 'bool' && value !== undefined && typeof value !== 'boolean') throw invalid(`${name} must be true or false`)
          if ((option?.kind==='function' || ['on_spawn','before_spawn'].includes(name)) && value !== undefined && typeof value !== 'function') throw invalid(`${name} must be a function`)
          if (typeof value === 'number' && (!Number.isFinite(value) || Number.isInteger(value) && !Number.isSafeInteger(value))) throw invalid(`${name} must preserve exact numeric values`)
        }
        for (const value of args) if (typeof value === 'number' && (!Number.isFinite(value) || Number.isInteger(value) && !Number.isSafeInteger(value))) throw invalid('Unsafe numeric positional argument')
        const words = [family, call.replaceAll('_', '-')], positionals = []
        let input
        for (let i = 0; i < entry.args.length; i++) {
          const arg = entry.args[i], value = args[i]
          if (value === undefined || value === null) { if (!arg.optional) throw invalid(`${arg.name} is required`); continue }
          if (['content', 'json'].includes(arg.kind)) input = arg.kind === 'json' ? JSON.stringify(value) : value
          else positionals.push(String(value))
        }
        const events = family === 'workspace' && call === 'exec'
        for (const [name, value] of Object.entries(options)) {
          if (value === undefined || typeof value === 'function' || name === 'stream' && events) continue
          if (name === 'password' || name === 'key') {
            if (typeof value !== 'string' || !/^(env:[A-Za-z_][A-Za-z0-9_]*|file:\/.+)$/.test(value)) throw invalid(`${name} requires an env: or file: reference`)
          }
          const flag = `--${name.replaceAll('_', '-')}`
          if (entry.options.find((o)=>o.name===name)?.kind === 'bool') words.push(`${flag}=${value}`)
          else words.push(flag, typeof value === 'object' ? JSON.stringify(value) : String(value))
        }
        if (events) words.push('--events')
        else if (options.on_progress || (family === 'machine' && ['start', 'create'].includes(call) && entry.options.some((o) => o.name === 'on_progress'))) words.push('--progress')
        if (spec.scope) words.push('--scope', spec.scope.folder, '--scope-project', spec.scope.project, ...(spec.scope.branch ? ['--scope-branch', spec.scope.branch] : []))
        words.push('--', ...positionals)
        const read = reads.has(call)
        const invoke = () => execute(spec, words, { input, read, events, onProgress: options.on_progress, beforeSpawn: options.before_spawn, onSpawn: (child) => options.on_spawn?.(child.pid), onFrame: (frame) => { if (frame.stream) options[frame.stream]?.(bytes(frame.bytes)) } })
        if (!reads.has(call)) return invoke()
        const key = JSON.stringify([words, input ?? null])
        if (!flying.has(key)) {
          const pending = invoke()
          flying.set(key, pending)
          pending.finally(() => flying.delete(key)).catch(() => {})
        } else shareInvocation(flying.get(key))
        return flying.get(key)
      }
    } }))
    return families.get(family)
  } })
}
