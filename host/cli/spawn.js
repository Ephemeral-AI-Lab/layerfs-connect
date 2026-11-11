// All host CLI children pass here. Calls are attempted once, without replay.
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { binary } from './binary.js'
import { parse } from './json.js'
import { lines } from './progress.js'
import { CliError, outcome } from './outcome.js'
import { beginInvocation, registerInvocation } from '../activity/recorder.js'
import { capture } from '../activity/redact.js'
import { invocationLane } from './concurrency.js'
export const children = new Map()
const lanes = new Map()
async function admit(key, limit, run) {
  let lane = lanes.get(key)
  if (!lane) lanes.set(key, lane = { active: 0, waiting: [] })
  if (lane.active >= limit) await new Promise((resolve) => lane.waiting.push(resolve))
  else lane.active++
  try { return await run() } finally {
    const next = lane.waiting.shift()
    if (next) next()
    else if (--lane.active === 0) lanes.delete(key)
  }
}
export function execute(spec, argv, options = {}) {
  const activity = beginInvocation(spec, argv, options)
  let selected, lane
  try { selected = binary(spec); lane = invocationLane(selected.key, spec, argv, options) } catch (error) {
    activity?.finished({ status: 'launch-failed', code: error.code })
    throw error
  }
  const capturedOut = capture(), capturedErr = capture()
  let processExit = null, processSignal = null
  const launch = () => admit(lane.key, lane.limit, async () => {
    // Only calls holding an execution slot reserve lifecycle capture space.
    // Queued ordinary calls must not exhaust the room needed by cancellation.
    await activity?.ready?.()
    if (!options.discovery && !spec.home) throw new CliError('InvalidInput', 'LayerFS requires an explicit home')
    if (options.read && !existsSync(join(spec.home, 'layerfs.json'))) throw new CliError('Unavailable', 'LayerFS home is not initialized; reads will not create it')
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
          else if ('progress' in frame) { activity?.progress(frame.progress); options.onProgress?.(frame.progress) }
          else if (!['stdout', 'stderr'].includes(frame.stream) || !('bytes' in frame)) throw new Error('Unknown event')
          options.onFrame?.(frame)
        } catch { malformed = true }
      })
      const stderr = lines((line) => {
        try {
          const frame = parse(line)
          if ('progress' in frame) { activity?.progress(frame.progress); options.onProgress?.(frame.progress) }
          else if (!events && typeof frame.code === 'string') { if (refusal) malformed = true; refusal = frame }
          else malformed = true
        } catch { /* Usage is plain text; exit 2 classifies it without exposing argv/secrets. */ }
      })
      const child = spawn(selected.command, [...selected.prefix, ...argv], {
        shell: false, stdio: options.passthrough ? ['inherit', 'inherit', 'inherit'] : ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, ...options.env, ...(spec.home ? { LAYERFS_HOME: spec.home } : {}), LAYERFS_PROGRESS_JSON: '1' },
      })
      if (child.pid) children.set(child.pid, { child, home: spec.home, started: Date.now() })
      child.once('spawn', () => activity?.started(child, selected))
      child.once('error', (error) => { spawnError = error })
      child.stdin?.on('error', () => {})
      child.stdout?.on('data', (data) => { capturedOut.write(data); stdout.write(data) })
      child.stderr?.on('data', (data) => { capturedErr.write(data); stderr.write(data) })
      let deadline
      if (options.timeout) deadline = setTimeout(() => child.kill('SIGTERM'), options.timeout)
      child.once('close', (code, signal) => {
        processExit = code; processSignal = signal
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
  // The pinned CLI can race while closing/opening the same Store from separate
  // processes. Queue saved reads before taking a global slot; unrelated Stores
  // and exec/cancel remain independent. Every command still runs exactly once.
  const pending = (options.storeRead
    ? admit(JSON.stringify(['store-read', spec.home, options.storeRead]), 1, launch)
    : launch()).then(result => {
    activity?.finished({ status: 'success', exitCode: processExit, signal: processSignal, commandExitCode: result?.exit_code, stdout: capturedOut.finish(activity.scrub), stderr: capturedErr.finish(activity.scrub), outputUnavailable: !!options.passthrough })
    return result
  }, error => {
    activity?.finished({ status: error.transport === 'transport-unknown' ? 'uncertain' : error.transport === 'unavailable' ? 'launch-failed' : error.transport === 'usage-incompatible' ? 'usage-error' : error.transport === 'refusal' ? 'refused' : 'not-started', code: error.code, message: activity.scrub.bounded(error.message, 2048).text, exitCode: processExit, signal: processSignal, stdout: capturedOut.finish(activity.scrub), stderr: capturedErr.finish(activity.scrub) })
    throw error
  })
  registerInvocation(pending, activity)
  return pending
}
