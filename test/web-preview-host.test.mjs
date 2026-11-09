import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'

const require = createRequire(new URL('../desktop/package.json', import.meta.url))
const ts = require('typescript')
const root = mkdtempSync(join(tmpdir(), 'connect-web-host-test-'))
const source = readFileSync(new URL('../desktop/tools/web-host.ts', import.meta.url), 'utf8')
writeFileSync(join(root, 'web-host.mjs'), ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText)
const { WebHosts, parseMode } = await import(pathToFileURL(join(root, 'web-host.mjs')))
const fake = join(root, 'fake.mjs')
writeFileSync(fake, `import { appendFileSync } from 'node:fs';
appendFileSync(process.env.CALLS, process.argv.at(-1)+'\\n');
if (process.env.FAIL) { console.log('{"ready":false}'); setTimeout(()=>{console.error("code: 'CliIncompatible', credential=CANARY");process.exit(1)},30) }
else { console.log(JSON.stringify({ready:true,url:'http://127.0.0.1:1',token:'fixture',mode:process.env.LAYERFS_CONNECT_MODE})); process.stdin.resume();process.stdin.on('end',()=>process.exit(0)) }
`)
function fixture(name, extra = {}) {
  const calls = join(root, name + '.calls')
  const hosts = new WebHosts(fake, { ...process.env, LFS_STATE: join(root, name), LAYERFS_CONNECT_CLI: '/explicit/fixture', CALLS: calls, ...extra })
  return { hosts, calls }
}
const instances = []
test('mode validation refuses unknown values', () => {
  assert.equal(parseMode(null), 'sim'); assert.equal(parseMode('real'), 'real')
  assert.throws(() => parseMode('production'))
})
test('hosts reuse only same-mode endpoint; states and scratch folders remain separate', { timeout: 5000 }, async () => {
  const { hosts, calls } = fixture('isolation'); instances.push(hosts)
  const sim = hosts.start('sim')
  assert.equal(hosts.start('sim'), sim)
  assert.equal((await sim).mode, 'sim')
  assert.equal((await hosts.start('real')).mode, 'real')
  assert.match(hosts.scratch('sim'), /isolation\/sim\/scratch\//)
  assert.match(hosts.scratch('real'), /isolation\/real\/scratch\//)
  assert.equal(readFileSync(calls, 'utf8').trim().split('\n').length, 2)
})
test('real mode requires explicit CLI and does not start a process', { timeout: 5000 }, async () => {
  const { hosts } = fixture('missing', { LAYERFS_CONNECT_CLI: '' }); instances.push(hosts)
  await assert.rejects(hosts.start('real'), /Set LAYERFS_CONNECT_CLI/)
  assert.equal((await hosts.start('sim')).mode, 'sim')
})
test('startup classifies drained stderr safely and never automatically respawns failed host', { timeout: 5000 }, async () => {
  const { hosts, calls } = fixture('incompatible', { FAIL: '1' }); instances.push(hosts)
  await assert.rejects(hosts.start('real'), error => {
    assert.match(error.message, /CLI incompatible/)
    assert.doesNotMatch(error.message, /credential|CANARY/)
    return true
  })
  await assert.rejects(hosts.start('real'), /Restart the preview/)
  assert.equal(readFileSync(calls, 'utf8').trim().split('\n').length, 1)
})
test.after(async () => {
  const { setTimeout } = await import('node:timers/promises')
  instances.forEach(hosts => hosts.close())
  await setTimeout(100)
  rmSync(root, { recursive: true, force: true })
})
