// Independent <=120s phases preserve custody across VM setup, flow and cleanup.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import assert from 'node:assert/strict'
import { execute } from '../../host/cli/spawn.js'
const phase = process.argv[2]
const contextFile = '/private/tmp/connect137-vm-proof-context.json'
const context = phase === 'setup' ? { root: mkdtempSync(join(tmpdir(), 'connect-phase2-vm-')), name: `connect137-${randomBytes(5).toString('hex')}` } : JSON.parse(readFileSync(contextFile, 'utf8'))
const spec = { cli: process.env.LAYERFS_CONNECT_CLI, home: join(context.root, 'home') }
const env = { LAYERFS_BUNDLE: '/private/tmp/connect137-linux-bundle/2.0.0/linux-aarch64' }
const receipt = { phase, context: contextFile, identity: await execute(spec, ['--version', '--json'], { discovery: true }), started: new Date().toISOString(), calls: [], cleanup: [] }
if (phase === 'setup') writeFileSync(contextFile, JSON.stringify(context), { mode: 0o600 })
const wall = setTimeout(() => { receipt.verdict = 'FAILED_TIMEOUT'; receipt.error = 'Explicit120s ceiling; owned context retained for fresh observation and cleanup'; save(); console.error(receipt.error); process.exit(1) }, 120000)
const save = () => writeFileSync(new URL(`../../docs/evidence/phase-2/vm-${phase}.json`, import.meta.url), JSON.stringify(receipt, null, 2)+'\n')
const call = async (argv, timeout = 25000) => {
 try { const result = await execute(spec, argv, { env, timeout }); receipt.calls.push({ argv, result }); return result }
 catch(e) { receipt.calls.push({ argv, refusal: { code: e.code, message: e.message, transport: e.transport } }); throw e }
}
try {
 if (phase === 'setup') {
  await call(['machine', 'list'])
  await call(['machine', 'create', context.name, 'lima', '--cpus', '2', '--memory', '2G', '--disk', '5G'], 100000)
 } else if (phase === 'flow') {
  await call(['machine', 'status', context.name])
  mkdirSync(join(context.root, 'input')); writeFileSync(join(context.root, 'input', 'readme'), 'VM proof\n')
  await call(['store', 'create', 'proof'])
  await call(['project', 'init', 'proof/p', join(context.root, 'input')])
  await call(['store', 'push', 'proof', context.name])
  await call(['branch', 'fork', 'proof/p', 'work', 'main'])
  await call(['sandbox', 'create', 'proof/p', 'vm-proof', context.name])
  context.sandbox = 'vm-proof'; writeFileSync(contextFile, JSON.stringify(context), { mode: 0o600 })
  context.ws = (await call(['workspace', 'mount', 'vm-proof', 'work', '--name', 'proof'])).ws; writeFileSync(contextFile, JSON.stringify(context), { mode: 0o600 })
  const result = await call(['workspace', 'exec', context.ws, 'printf vm > proof.txt', '--exec-id', 'vm-proof-write', '--events']); assert.equal(result.exit_code, 0)
  await call(['workspace', 'commit', context.ws, '--message', 'VM mounted write'])
  await call(['doctor', 'sandbox', 'vm-proof', '--timeout', '10s'])
  await call(['workspace', 'unmount', context.ws]); delete context.ws; writeFileSync(contextFile, JSON.stringify(context), { mode: 0o600 })
  await call(['sandbox', 'close', context.sandbox]); delete context.sandbox; writeFileSync(contextFile, JSON.stringify(context), { mode: 0o600 })
  await call(['store', 'pull', 'proof'])
  assert.equal((await call(['store', 'status', 'proof'])).state, 'idle')
 } else if (phase === 'cleanup') {
  // Fresh observation before retiring only the VM owned by this proof.
  await call(['machine', 'status', context.name])
  if (context.ws) await call(['workspace', 'unmount', context.ws])
  if (context.sandbox) await call(['sandbox', 'close', context.sandbox])
  const stores = await call(['store', 'list'])
  for (const store of stores.items ?? []) if (store.machine === context.name) await call(['store', 'remove', store.name])
  await call(['machine', 'stop', context.name])
  await call(['machine', 'remove', context.name])
  rmSync(context.root, { recursive: true, force: true }); rmSync(contextFile); receipt.cleanup.push('owned VM, home and context removed')
 } else throw new Error('Choose setup, flow or cleanup')
 receipt.verdict = 'PASS'
} catch(e) { receipt.verdict = 'FAIL'; receipt.error = e.message; process.exitCode = 1 }
finally { clearTimeout(wall); receipt.ended = new Date().toISOString(); save(); console.log(JSON.stringify({ phase, verdict: receipt.verdict, error: receipt.error, context: existsSync(contextFile) ? contextFile : null })) }
