// Fresh owned native receipt. No default homes, no durable profile, no replay.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { execute } from '../../host/cli/spawn.js'
const root = mkdtempSync(join(tmpdir(), 'connect-phase2-exec-'))
const spec = { cli: process.env.LAYERFS_CONNECT_CLI, home: join(root, 'home') }
const wall = setTimeout(() => { console.error('Explicit120s verification deadline'); process.exit(1) }, 120000)
const receipt = { identity: await execute(spec, ['--version', '--json'], { discovery: true }), started: new Date().toISOString(), calls: [], cleanup: [] }
const call = async (argv, options = {}) => {
  try { const result = await execute(spec, argv, { timeout: 20000, ...options }); receipt.calls.push({ argv, result }); return result }
  catch (error) { receipt.calls.push({ argv, refusal: { code: error.code, message: error.message, transport: error.transport } }); throw error }
}
let ws, sandbox = false
try {
 mkdirSync(join(root, 'input')); writeFileSync(join(root, 'input', 'seed'), 'seed\n')
 await call(['machine', 'list'])
 await call(['machine', 'update', 'native', '--daemon', join(spec.cli, '..', 'layerfs-daemon')])
 await call(['store', 'create', 'test'])
 await call(['project', 'init', 'test/p', join(root, 'input')])
 await call(['branch', 'fork', 'test/p', 'work', 'main'])
 await call(['sandbox', 'create', 'test/p', 'exec-proof', 'native']); sandbox = true
 ws = (await call(['workspace', 'mount', 'exec-proof', 'work', '--name', 'proof'])).ws
 const frames = []
 const result = await call(['workspace', 'exec', ws, 'printf hello; printf error >&2; exit 125', '--exec-id', 'proof-exit-125', '--events'], { onFrame: f => frames.push(f) })
 assert.equal(result.exit_code, 125); assert.equal(frames.filter(f => f.stream === 'stdout').map(f => f.bytes).join(''), 'hello')
 const pre = await call(['workspace', 'exec-cancel', ws, 'proof-before-start'])
 assert.equal(pre.outcome, 'ended')
 const cancelled = await call(['workspace', 'exec', ws, 'printf should-not-run > no-start', '--exec-id', 'proof-before-start', '--events'])
 assert.equal(cancelled.kind, 'cancelled')
 const started = Promise.withResolvers()
 const running = call(['workspace', 'exec', ws, 'printf partial > partial; sleep 30', '--exec-id', 'proof-running', '--events'], { onProgress: () => started.resolve() })
 await started.promise
 // Readiness here observes the command's own marker; it never replays a mutation.
 let seen = false
 for (let i = 0; i < 80 && !seen; i++) {
  const check = await call(['workspace', 'exec', ws, 'test -f partial', '--exec-id', `proof-observe-${i}`, '--events'])
  seen = check.exit_code === 0
  if (!seen) await new Promise(r => setTimeout(r, 25))
 }
 assert.equal(seen, true)
 const stop = await call(['workspace', 'exec-cancel', ws, 'proof-running'])
 assert.equal(stop.outcome, 'cancelled')
 assert.equal((await running).kind, 'cancelled')
 await call(['workspace', 'commit', ws, '--message', 'Partial writes after explicit cancel'])
 const bytes = []
 const big = await call(['workspace', 'exec', ws, "head -c 1048587 /dev/zero", '--exec-id', 'proof-large-binary', '--events'], { onFrame: f => { if (f.stream === 'stdout') bytes.push(typeof f.bytes === 'string' ? Buffer.from(f.bytes) : Buffer.from(f.bytes.base64, 'base64')) } })
 assert.equal(Buffer.concat(bytes).length, 1048587)
 assert.equal(big.stdout, null)
 receipt.verdict = 'PASS'
} catch (error) { receipt.verdict = 'FAIL'; receipt.error = error.message; process.exitCode = 1 }
finally {
 if (ws) try { await call(['workspace', 'unmount', ws]); receipt.cleanup.push('unmounted') } catch (e) { receipt.cleanup.push(e.message) }
 if (sandbox) try { await call(['sandbox', 'close', 'exec-proof']); receipt.cleanup.push('sandbox closed') } catch (e) { receipt.cleanup.push(e.message) }
 // Remove only the uniquely owned home after resource cleanup succeeds.
 if (!sandbox || receipt.cleanup.includes('sandbox closed')) { rmSync(root, { recursive: true, force: true }); receipt.cleanup.push('owned home removed') }
 clearTimeout(wall)
 receipt.ended = new Date().toISOString()
 writeFileSync(new URL('../../docs/evidence/phase-2/exec-native-second.json', import.meta.url), JSON.stringify(receipt, null, 2) + '\n')
 console.log(JSON.stringify({ verdict: receipt.verdict, error: receipt.error, cleanup: receipt.cleanup }))
}
