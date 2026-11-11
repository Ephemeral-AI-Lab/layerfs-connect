import { discover } from './capabilities.js'
import { execute } from './spawn.js'
import { bytes } from './json.js'
import { CliError } from './outcome.js'
import { shareInvocation } from '../activity/recorder.js'
import { isAbsolute } from 'node:path'
const invalid = (message) => new CliError('InvalidInput', message)
const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && !ArrayBuffer.isView(v)
const reads = new Set(['list', 'get', 'status', 'platforms', 'images', 'stats', 'storage_report', 'commits', 'get_commit', 'read', 'stat', 'glob', 'grep', 'blame', 'diff', 'revision'])
export function client(spec) {
  const flying = new Map()
  const families = new Map()
  return new Proxy({ home: spec.home, supportsOption: async (family, call, option) => (await discover(spec)).calls.find(entry => entry.family === family && entry.call === call)?.options.some(entry => entry.name === option) === true }, { get(target, family) {
    if (family in target) return target[family]
    if (family === 'then') return undefined
    if (!families.has(family)) families.set(family, new Proxy({}, { get(_unused, call) {
      return async (...given) => {
        const help = await discover(spec)
        const entry = help.calls.find((c) => c.family === family && c.call === call)
        if (!entry) {
          if (family === 'machine' && call === 'images') throw new CliError('Unsupported', 'Image discovery needs a LayerFS CLI with machine.images support. You can still select Default image.')
          throw invalid(`No CLI call ${String(family)}.${String(call)}`)
        }
        const args = [...given]
        let options = {}
        const last = args.at(-1), slot = entry.args[args.length - 1]
        if (args.length > entry.args.length || (isPlain(last) && slot?.kind !== 'json')) options = args.pop() ?? {}
        // SDK-shaped archive input maps to the CLI's explicit archive option.
        if (family === 'sandbox' && call === 'create' && isPlain(options.image)) {
          const { archive, digest, ...extra } = options.image
          if (Object.keys(extra).length || typeof archive !== 'string' || !isAbsolute(archive) || archive.includes('\0')) throw invalid('image.archive must be an absolute caller-local path')
          if (digest !== undefined && (typeof digest !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(digest))) throw invalid('image.digest must be a full sha256 digest')
          options = { ...options, image_archive: archive, image: digest }
        }
        if (!isPlain(options) || args.length > entry.args.length) throw invalid('Invalid CLI arguments')
        // a conversation's operation id (sessions/recorder.js) is the child's environment, never a CLI flag
        const operationId = options.connect_operation_id
        if (operationId !== undefined) {
          if (typeof operationId !== 'string' || !/^op-[0-9a-f-]{36}$/.test(operationId)) throw invalid('connect_operation_id must be an operation id')
          options = { ...options }
          delete options.connect_operation_id
        }
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
        else if (options.on_progress || ((family === 'machine' && ['start', 'create'].includes(call) || family === 'sandbox' && call === 'create') && entry.options.some((o) => o.name === 'on_progress'))) words.push('--progress')
        if (spec.scope) words.push('--scope', spec.scope.folder, '--scope-project', spec.scope.project, ...(spec.scope.branch ? ['--scope-branch', spec.scope.branch] : []))
        words.push('--', ...positionals)
        const read = reads.has(call)
        const storeRead = read && args[0] && (entry.args[0]?.kind === 'project' || family === 'store')
          ? String(args[0]).split('/')[0] : undefined
        const invoke = () => execute(spec, words, { input, read, storeRead, events, ...(operationId ? { env: { LAYERFS_CONNECT_OPERATION_ID: operationId } } : {}), onProgress: options.on_progress, beforeSpawn: options.before_spawn, onSpawn: (child) => options.on_spawn?.(child.pid), onFrame: (frame) => { if (frame.stream) options[frame.stream]?.(bytes(frame.bytes)) } })
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
