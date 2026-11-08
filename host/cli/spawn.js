// All host CLI children pass here. Calls are attempted once, without replay.
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { binary } from './binary.js'
import { parse } from './json.js'
import { lines } from './progress.js'
import { CliError, outcome } from './outcome.js'
export const children = new Map()
const lanes = new Map()
async function admit(key, limit, run) {
  let lane = lanes.get(key)
  if (!lane) lanes.set(key, lane = { active: 0, waiting: [] })
  if (lane.active >= limit) await new Promise((resolve) => lane.waiting.push(resolve))
  else lane.active++
  try { return await run() } finally { const next = lane.waiting.shift(); if (next) next(); else lane.active-- }
}
export function execute(spec, argv, options = {}) {
  const selected = binary(spec)
  const control = argv[0] === 'workspace' && argv[1] === 'exec-cancel'
  return admit(`${selected.key}:${control ? 'cancel' : 'calls'}`, control ? 4 : selected.key === 'sim' ? 1 : 4, () => {
    if (!options.discovery && !spec.home) throw new CliError('InvalidInput', 'LayerFS requires an explicit home')
    if (options.read && spec.mode !== 'sim' && !existsSync(join(spec.home, 'layerfs.json'))) throw new CliError('Unavailable', 'LayerFS home is not initialized; reads will not create it')
    options.beforeSpawn?.()
    return new Promise((resolve, reject) => {
      let result, refusal, spawnError, malformed = false, finals = 0
      const events = options.events || argv.includes('--events')
      const stdout = lines((line) => {
        try {
          const frame = parse(line)
          if (!events) { if (++finals !== 1) throw new Error('Extra result'); result = frame; return }
          if (finals) throw new Error('Frame after final')
          if ('result' in frame || 'refusal' in frame) { finals++; result = frame.result; refusal = frame.refusal }
          else if ('progress' in frame) options.onProgress?.(frame.progress)
          else if (!['stdout', 'stderr'].includes(frame.stream) || !('bytes' in frame)) throw new Error('Unknown event')
          options.onFrame?.(frame)
        } catch { malformed = true }
      })
      const stderr = lines((line) => {
        try {
          const frame = parse(line)
          if ('progress' in frame) options.onProgress?.(frame.progress)
          else if (!events && typeof frame.code === 'string') { if (refusal) malformed = true; refusal = frame }
          else malformed = true
        } catch { /* Usage is plain text; exit 2 classifies it without exposing argv/secrets. */ }
      })
      const child = spawn(selected.command, [...selected.prefix, ...argv], {
        shell: false, stdio: options.passthrough ? ['inherit', 'inherit', 'inherit'] : ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, ...options.env, ...(spec.home ? { LAYERFS_HOME: spec.home } : {}), LAYERFS_PROGRESS_JSON: '1', LAYERFS_CONSTRUCTION_WORKERS: '1' },
      })
      if (child.pid) children.set(child.pid, { child, home: spec.home, started: Date.now() })
      child.once('error', (error) => { spawnError = error })
      child.stdin?.on('error', () => {})
      child.stdout?.on('data', (data) => stdout.write(data))
      child.stderr?.on('data', (data) => stderr.write(data))
      let deadline
      if (options.timeout) deadline = setTimeout(() => child.kill('SIGTERM'), options.timeout)
      child.once('close', (code, signal) => {
        clearTimeout(deadline)
        children.delete(child.pid)
        if (options.passthrough && !spawnError) { resolve({ exit_code: code ?? 1, signal }); return }
        stdout.end(); stderr.end()
        try { resolve(outcome({ code, signal, result, refusal, error: spawnError, malformed: malformed || (events && finals !== 1) })) } catch (error) { reject(error) }
      })
      try { options.onSpawn?.(child) } catch { malformed = true; child.kill('SIGTERM') }
      child.stdin?.end(options.input)
    })
  })
}
