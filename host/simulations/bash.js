// A genuine shell invokes the visible CLI command. Its private local shim forwards
// exactly one authenticated, compiled invocation to the host's existing CLI path.
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { stringify } from '../cli/json.js'

const cliShim = fileURLToPath(new URL('./cli-shim.cjs', import.meta.url))

export async function executeSimulationBash({ command, argv, input, stepKey, scriptPath, taskId, execute, signal, cwd }) {
  signal?.throwIfAborted()
  const directory = await mkdtemp('/tmp/lfs-sim-shell-'), token = randomBytes(32).toString('hex'), socketPath = join(directory, 'rpc.sock')
  let server, shell, work, receipt, calls = 0, protocolError
  const sockets = new Set()
  try {
    server = createServer({ allowHalfOpen: true }, socket => {
      let data = ''
      sockets.add(socket); socket.once('close', () => sockets.delete(socket))
      socket.setEncoding('utf8')
      socket.on('error', () => {})
      socket.on('data', part => { data += part; if (data.length > 8 * 1024 * 1024) { protocolError = new Error('Simulation CLI request exceeded its limit.'); socket.destroy() } })
      socket.on('end', () => {
        work = (async () => {
          try {
            const request = JSON.parse(data)
            if (request.token !== token || JSON.stringify(request.argv) !== JSON.stringify(argv) || request.input !== (input ?? '') || calls++) throw new Error('The shell invocation does not match its compiled simulation step.')
            signal?.throwIfAborted()
            receipt = await execute()
            if (!socket.destroyed) socket.end(stringify({ ok: true, receipt }))
          } catch (error) {
            protocolError = error
            if (!socket.destroyed) socket.end(JSON.stringify({ ok: false, error: error.message }))
          }
        })()
      })
    })
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(socketPath, resolve) })
    const output = await new Promise((resolve, reject) => {
      let stdout = '', stderr = ''
      shell = spawn('/bin/sh', ['-c', command], { cwd, env: { ...process.env, PATH: `${directory}:${process.env.PATH ?? ''}`, LAYERFS_CONNECT_CLI: cliShim, SIMULATION_RPC_SOCKET: socketPath, SIMULATION_RPC_TOKEN: token }, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' })
      const abort = () => { try { if (process.platform !== 'win32') process.kill(-shell.pid, 'SIGTERM'); else shell.kill('SIGTERM') } catch { /* The process group already ended. */ } }; signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort()
      shell.stdout.setEncoding('utf8'); shell.stderr.setEncoding('utf8')
      shell.stdout.on('data', data => { stdout += data }); shell.stderr.on('data', data => { stderr += data })
      shell.once('error', reject)
      shell.once('close', (exitCode, processSignal) => { signal?.removeEventListener('abort', abort); resolve({ stdout, stderr, exitCode, signal: processSignal }) })
    })
    await work
    signal?.throwIfAborted()
    if (protocolError) throw protocolError
    if (output.exitCode !== 0 || calls !== 1 || receipt === undefined) throw new Error(`Simulation shell did not complete its compiled CLI invocation: ${output.stderr || output.exitCode}`)
    return { content: [{ type: 'text', text: output.stdout + output.stderr }], details: { ...output, argv, stepKey, scriptPath, taskId, receipt } }
  } finally {
    await work
    for (const socket of sockets) socket.destroy()
    if (server) await new Promise(resolve => server.close(resolve))
    await rm(directory, { recursive: true, force: true })
  }
}
