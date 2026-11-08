// Future acceptance only: a person must click Choose. No native selection is claimed here.
// Usage: Node24 resume-native-directory-selection.mjs /absolute/retained.app /tmp/fresh-receipt.json
import { spawn } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { connect } from './connect-cdp-library.mjs'
const app = resolve(process.argv[2] ?? '')
const output = resolve(process.argv[3] ?? '/tmp/connect-directory-selection-receipt.json')
if (!existsSync(join(app, 'Contents/MacOS/LayerFS Connect'))) throw Error('Supply the retained macOS app directory.')
if (existsSync(output) || existsSync(output + '.log')) throw Error('Receipt or log already exists; select fresh output paths.')
// A TCP bind also detects non-HTTP listeners; never attach to another owner's port.
const probe = createServer()
await new Promise((resolvePort, reject) => {
  const timer = setTimeout(() => { probe.close(); reject(Error('Debug-port bind check exceeded 1 second.')) }, 1000)
  probe.once('error', () => { clearTimeout(timer); reject(Error('Loopback port 19325 is occupied; leave its owner alone.')) })
  probe.listen({ host: '127.0.0.1', port: 19325, exclusive: true }, () => {
    clearTimeout(timer)
    probe.close(error => error ? reject(error) : resolvePort())
  })
})
const receiptFd = openSync(output, 'wx', 0o600)
let logFd
try { logFd = openSync(output + '.log', 'wx', 0o600) }
catch (error) { closeSync(receiptFd); unlinkSync(output); throw error }
const root = mkdtempSync(join(tmpdir(), 'connect-native-directory-check-'))
const expected = join(root, 'directory with spaces')
mkdirSync(expected)
const receipt = { app, root, expected, source: 'da2986c4771b9edb89db0b6761b3781ae8a1d7fa', scope: 'Real native chooseDirectory IPC, manual selection; no simulated backend/result' }
let c, logs = '', closed = false, persisted = false, finishing
const child = spawn(join(app, 'Contents/MacOS/LayerFS Connect'), [
  '--remote-debugging-port=19325', `--user-data-dir=${root}/electron-data`,
], { env: { ...process.env, PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LAYERFS_CONNECT_MODE: 'real', LAYERFS_CONNECT_STATE: join(root, 'state'), LAYERFS_CONNECT_NODE: '', LAYERFS_CONNECT_CLI: '', LAYERFS_CONNECT_DAEMON: '' } })
const childClosed = new Promise(resolveClose => child.once('close', () => { closed = true; resolveClose(true) }))
child.on('error', error => { receipt.spawnError = error.message })
child.stdout.on('data', value => { logs += value })
child.stderr.on('data', value => { logs += value })
const persist = () => {
  if (persisted) return
  persisted = true
  writeFileSync(receiptFd, JSON.stringify(receipt, null, 2) + '\n')
  writeFileSync(logFd, logs)
  closeSync(receiptFd); closeSync(logFd)
}
const waitClose = async milliseconds => {
  let timer
  try { return await Promise.race([childClosed, new Promise(resolveWait => { timer = setTimeout(() => resolveWait(false), milliseconds) })]) }
  finally { clearTimeout(timer) }
}
const finish = () => finishing ??= (async () => {
  c?.close()
  if (!closed) { child.kill('SIGTERM'); await waitClose(3000) }
  if (!closed) { child.kill('SIGKILL'); await waitClose(3000) }
  if (closed) {
    // No Store, Sandbox, Workspace, or command is created by this picker driver.
    rmSync(root, { recursive: true, force: true })
    receipt.cleanup = 'Owned Electron close observed; temporary state removed.'
  } else {
    receipt.verdict = 'BLOCKED'
    receipt.cleanup = 'Owned process close unconfirmed; state retained for reconciliation.'
  }
  persist()
})()
// Preflight <=1s, hard deadline118s; graceful+forced cleanup fits below120s overall.
const hard = setTimeout(() => {
  receipt.verdict = 'BLOCKED'; receipt.error = '118-second hard deadline; owned state retained.'
  c?.close(); if (!closed) child.kill('SIGKILL')
  receipt.cleanup = 'State retained; inspect exact owned PID before removal.'
  receipt.pid = child.pid
  persist(); process.exit(1)
}, 118000)
const wall = setTimeout(async () => {
  receipt.verdict = 'BLOCKED'
  receipt.error = 'The real native dialog did not return an accepted directory within 110 seconds.'
  await finish(); clearTimeout(hard); process.exit(1)
}, 110000)
try {
  for (let n = 0; n < 150 && !closed; n++) {
    try { c = await connect(19325); break } catch { await new Promise(r => setTimeout(r, 100)) }
  }
  if (!c) throw Error(receipt.spawnError ?? 'Owned Electron renderer was not ready.')
  console.log(`Choose this owned directory in the actual native dialog: ${expected}`)
  const result = await c.call('Runtime.evaluate', { expression: `window.desktop.layerfs.chooseDirectory(${JSON.stringify(expected)})`, awaitPromise: true, returnByValue: true })
  if (result.exceptionDetails) throw Error(result.exceptionDetails.text)
  receipt.actual = result.result.value
  receipt.verdict = receipt.actual === expected ? 'PASS' : 'BLOCKED'
  if (receipt.verdict !== 'PASS') receipt.error = 'The actual native picker did not return the expected owned directory.'
} catch (error) { receipt.verdict = 'BLOCKED'; receipt.error = error.message }
finally {
  clearTimeout(wall)
  await finish(); clearTimeout(hard)
  console.log(JSON.stringify(receipt))
  if (receipt.verdict !== 'PASS') process.exitCode = 1
}
