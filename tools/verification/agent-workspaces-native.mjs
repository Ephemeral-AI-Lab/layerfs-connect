// Exercises Connect's mounted chat class through the real discovered CLI proxy.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import assert from 'node:assert/strict'
import { client } from '../../host/cli/calls.js'
import { execute } from '../../host/cli/spawn.js'
import { AgentWorkspaces } from '../../host/agents/workspaces.js'
const root = mkdtempSync(join(tmpdir(), 'connect-phase2-agent-proxy-'))
const spec = { cli: process.env.LAYERFS_CONNECT_CLI, home: join(root, 'home') }
const lfs = client(spec)
const record = { id: 'proxy-proof', project: 'proof/p', runs: 'mount' }
const manager = new AgentWorkspaces({ projects: { lfs, record: project => lfs.project.get(project) } })
const receipt = { identity: await execute(spec, ['--version', '--json'], { discovery: true }), started: new Date().toISOString(), checks: [], cleanup: [] }
const persist = () => writeFileSync(join(root, 'chat.json'), JSON.stringify(record), { mode: 0o600 })
const wall = setTimeout(() => { console.error(`Explicit120s deadline: owned chat custody retained at ${root}`); process.exit(1) }, 120000)
try {
 mkdirSync(join(root, 'input')); writeFileSync(join(root, 'input', 'seed'), 'seed\n')
 await execute(spec, ['machine', 'list'])
 await lfs.machine.update('native', { daemon: join(dirname(spec.cli), 'layerfs-daemon') })
 await lfs.store.create('proof')
 await lfs.project.init('proof/p', join(root, 'input'))
 const output = []
 const first = await manager.exec(record, { command: 'printf first > first; printf exact; exit 125', toolCallId: 'one' }, { onData: b => output.push(b), onChange: persist })
 assert.equal(first.exitCode, 125); assert.equal(Buffer.concat(output).toString(), 'exact')
 receipt.checks.push({ name: 'AgentWorkspaces.run real proxy, exit125, no duplicate output, Commit', result: first, bytes: Buffer.concat(output).length })
 const controller = new AbortController(), started = Promise.withResolvers()
 const running = manager.exec(record, { command: 'printf partial > partial; sleep 30', toolCallId: 'two' }, { signal: controller.signal, onChange: () => { persist(); if (record.workspace.execution?.pid && !record.workspace.execution.finished) started.resolve() } })
 await started.promise
 let ready = false
 for (let i = 0; i < 50 && !ready; i++) {
  const check = await lfs.workspace.exec(record.workspace.handle, 'test -f partial', { exec_id: `proxy-observe-${i}` })
  ready = check.exit_code === 0
  if (!ready) await new Promise(r => setTimeout(r, 25))
 }
 assert.equal(ready, true)
 controller.abort()
 const stopped = await running
 assert.equal(stopped.kind, 'cancelled'); assert.equal(stopped.exitCode, 143)
 assert.equal(record.workspace.state, 'ready'); assert.ok(record.workspace.sandbox); assert.ok(record.workspace.handle)
 assert.equal((await lfs.file.read('proof/p', record.workspace.branch, '/partial', record.workspace.head)).text, 'partial')
 receipt.checks.push({ name: 'real proxy cancel preserves mount/Sandbox and commits partial writes', result: stopped, cancel: record.workspace.execution.cancel })
 receipt.verdict = 'PASS'
} catch(e) { receipt.verdict = 'FAIL'; receipt.error = e.message; process.exitCode = 1 }
finally {
 try { await manager.release(record, persist); receipt.cleanup.push('owned Workspace unmounted and Sandbox closed') } catch(e) { receipt.cleanup.push(e.message) }
 if (!record.workspace?.sandbox) { rmSync(root, { recursive: true, force: true }); receipt.cleanup.push('owned home removed') }
 clearTimeout(wall); receipt.ended = new Date().toISOString()
 writeFileSync(new URL('../../docs/evidence/phase-2/agent-workspaces-native.json', import.meta.url), JSON.stringify(receipt, null, 2)+'\n')
 console.log(JSON.stringify({ verdict: receipt.verdict, error: receipt.error, cleanup: receipt.cleanup }))
}
