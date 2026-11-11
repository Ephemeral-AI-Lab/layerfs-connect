import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { EventEmitter } from 'node:events'
import { resolve } from 'node:path'

const require = createRequire(new URL('../desktop/package.json', import.meta.url))
const ts = require('typescript')
const root = mkdtempSync(join(tmpdir(), 'connect-web-host-test-'))
const source = readFileSync(new URL('../desktop/tools/web-host.ts', import.meta.url), 'utf8')
writeFileSync(join(root, 'web-host.mjs'), ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText)
const { WebHosts } = await import(pathToFileURL(join(root, 'web-host.mjs')))
const fake = join(root, 'fake.mjs')
writeFileSync(fake, `import { appendFileSync } from 'node:fs';
appendFileSync(process.env.CALLS, process.argv.at(-1)+'\\n');
if (process.env.FAIL) { console.log('{"ready":false}'); setTimeout(()=>{console.error("code: 'CliIncompatible', credential=CANARY");process.exit(1)},30) }
else { console.log(JSON.stringify({ready:true,url:'http://127.0.0.1:1',token:'fixture',mode:'real'})); process.stdin.resume();process.stdin.on('end',()=>process.exit(0)) }
`)
function fixture(name, extra = {}) {
  const calls = join(root, name + '.calls')
  const hosts = new WebHosts(fake, { ...process.env, LFS_STATE: join(root, name), LAYERFS_CONNECT_CLI: '/explicit/fixture', CALLS: calls, ...extra })
  return { hosts, calls }
}
const instances = []
test('preview reuses one host and keeps state and scratch private', { timeout: 5000 }, async () => {
  const { hosts, calls } = fixture('isolation'); instances.push(hosts)
  const endpoint = hosts.start()
  assert.equal(hosts.start(), endpoint)
  assert.equal((await endpoint).mode, 'real')
  assert.match(hosts.scratch(), /isolation\/scratch\//)
  assert.equal(readFileSync(calls, 'utf8').trim().split('\n').length, 1)
})
test('real mode requires explicit CLI and does not start a process', { timeout: 5000 }, async () => {
  const { hosts } = fixture('missing', { LAYERFS_CONNECT_CLI: '' }); instances.push(hosts)
  await assert.rejects(hosts.start(), /Set LAYERFS_CONNECT_CLI/)
})
test('a disposed preview cannot start a late host from an outstanding HTML transform', { timeout: 5000 }, async () => {
  const { hosts } = fixture('disposed'); instances.push(hosts)
  hosts.close()
  await assert.rejects(hosts.start(), /Restart the preview/)
})
test('startup classifies drained stderr safely and never automatically respawns failed host', { timeout: 5000 }, async () => {
  const { hosts, calls } = fixture('incompatible', { FAIL: '1' }); instances.push(hosts)
  await assert.rejects(hosts.start(), error => {
    assert.match(error.message, /CLI incompatible/)
    assert.doesNotMatch(error.message, /credential|CANARY/)
    return true
  })
  await assert.rejects(hosts.start(), /Restart the preview/)
  assert.equal(readFileSync(calls, 'utf8').trim().split('\n').length, 1)
})
test.after(async () => {
  const { setTimeout } = await import('node:timers/promises')
  instances.forEach(hosts => hosts.close())
  await setTimeout(100)
  rmSync(root, { recursive: true, force: true })
})

test('Vite reconfiguration disposes the old plugin without closing its replacement host', async () => {
  const config = readFileSync(new URL('../desktop/vite.web.config.ts', import.meta.url), 'utf8')
  const ast = ts.createSourceFile('vite.web.config.ts', config, ts.ScriptTarget.Latest, true)
  const factory = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'previewHost')
  assert.ok(factory)
  const script = ts.transpileModule(factory.getText(ast).replaceAll('import.meta.dirname', JSON.stringify(root)), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
  class FixtureHost {
    controlToken = 'fixture'
    closed = false
    close() { this.closed = true }
    start() { return this.closed ? Promise.reject(new Error('disposed')) : Promise.resolve({ url: 'http://fixture', token: 'fixture' }) }
  }
  const plugin = new Function('WebHosts', 'resolve', script + '; return previewHost')(FixtureHost, resolve)
  const server = { httpServer: new EventEmitter(), middlewares: { use() {} } }
  const old = plugin({}), replacement = plugin({})
  old.configureServer(server)
  replacement.configureServer(server)
  await old.closeBundle?.()
  server.httpServer.emit('close')
  assert.match(await replacement.transformIndexHtml('<head>'), /lfs-host/)
  await assert.rejects(old.transformIndexHtml('<head>'), /disposed/)
  await replacement.closeBundle?.()
})
