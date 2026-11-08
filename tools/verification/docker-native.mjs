import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import assert from 'node:assert/strict'
import { execute } from '../../host/cli/spawn.js'
const root = mkdtempSync(join(tmpdir(), 'connect-phase2-docker-'))
const spec = { cli: process.env.LAYERFS_CONNECT_CLI, home: join(root, 'home') }
const env = { LAYERFS_BUNDLE: '/private/tmp/connect137-linux-bundle/2.0.0/linux-aarch64' }
const receipt = { identity: await execute(spec, ['--version', '--json'], { discovery: true }), started: new Date().toISOString(), calls: [], cleanup: [], bundle: env.LAYERFS_BUNDLE }
const wall = setTimeout(() => { console.error('Explicit120s verification deadline; retained owned home:', root); process.exit(1) }, 120000)
const call = async argv => {
 try { const result = await execute(spec, argv, { env, timeout: 40000 }); receipt.calls.push({ argv, result }); return result }
 catch(e) { receipt.calls.push({ argv, refusal: { code: e.code, message: e.message, transport: e.transport } }); throw e }
}
let started = false, made = false, ws
try {
 mkdirSync(join(root, 'input')); writeFileSync(join(root, 'input', 'readme'), 'Docker proof\n')
 await call(['machine', 'list'])
 await call(['machine', 'platforms'])
 await call(['machine', 'update', 'docker', '--daemon', join(env.LAYERFS_BUNDLE, 'layerfs-daemon'), '--image', 'layerfs-352-runtime:node24-https-apt-20261024'])
 await call(['machine', 'start', 'docker']); started = true
 await call(['store', 'create', 'proof'])
 await call(['project', 'init', 'proof/p', join(root, 'input')])
 await call(['store', 'push', 'proof', 'docker'])
 await call(['branch', 'fork', 'proof/p', 'work', 'main'])
 await call(['sandbox', 'create', 'proof/p', 'docker-proof', 'docker']); made = true
 ws = (await call(['workspace', 'mount', 'docker-proof', 'work', '--name', 'proof'])).ws
 const result = await call(['workspace', 'exec', ws, 'printf docker > proof.txt; cat proof.txt', '--exec-id', 'docker-proof-write', '--events'])
 assert.equal(result.exit_code, 0)
 await call(['workspace', 'commit', ws, '--message', 'Docker mounted write'])
 await call(['project', 'stats', 'proof/p', 'work'])
 await call(['doctor', 'sandbox', 'docker-proof', '--timeout', '10s'])
 await call(['workspace', 'unmount', ws]); ws = null
 await call(['sandbox', 'close', 'docker-proof']); made = false
 await call(['store', 'pull', 'proof'])
 const status = await call(['store', 'status', 'proof']); assert.equal(status.state, 'idle')
 receipt.verdict = 'PASS'
} catch(e) { receipt.verdict = 'FAIL'; receipt.error = e.message; process.exitCode = 1 }
finally {
 if (ws) try { await call(['workspace', 'unmount', ws]); receipt.cleanup.push('unmounted') } catch(e) { receipt.cleanup.push(e.message) }
 if (made) try { await call(['sandbox', 'close', 'docker-proof']); receipt.cleanup.push('sandbox closed') } catch(e) { receipt.cleanup.push(e.message) }
 try { await call(['machine', 'stop', 'docker']); receipt.cleanup.push('owned Docker machine stopped') } catch(e) { receipt.cleanup.push(e.message) }
 clearTimeout(wall)
 if (!receipt.cleanup.some(s => s.includes('failed') || s.includes('refused'))) { rmSync(root, { recursive: true, force: true }); receipt.cleanup.push('owned home removed') }
 receipt.ended = new Date().toISOString()
 writeFileSync(new URL('../../docs/evidence/phase-2/docker-native-second.json', import.meta.url), JSON.stringify(receipt, null, 2)+'\n')
 console.log(JSON.stringify({ verdict: receipt.verdict, error: receipt.error, cleanup: receipt.cleanup }))
}
