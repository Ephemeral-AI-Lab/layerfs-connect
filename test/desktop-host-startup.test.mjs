import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'

const require = createRequire(new URL('../desktop/package.json', import.meta.url))
const ts = require('typescript')
const source = readFileSync(new URL('../desktop/src/main/layerfs-host.ts', import.meta.url), 'utf8')
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const root = mkdtempSync(join(tmpdir(), 'connect-desktop-host-startup-'))
writeFileSync(join(root, 'layerfs-host.mjs'), output)
const { LayerfsHost } = await import(pathToFileURL(join(root, 'layerfs-host.mjs')))

for (const [code, expected] of [
  ['CliUnavailable', /CLI unavailable.*LAYERFS_CONNECT_CLI.*restart/],
  ['CliIncompatible', /CLI incompatible.*LAYERFS_CONNECT_DAEMON.*restart/],
  [null, /^The LayerFS host exited\.$/],
]) {
  test(`desktop startup ${code ?? 'unrelated failure'} preserves actionable safe error`, { timeout: 5000 }, async () => {
    const fixture = mkdtempSync(join(root, 'host-'))
    writeFileSync(join(fixture, 'main.js'), `console.error("credential=TEST_CANARY");console.error(${JSON.stringify(code ? `  code: '${code}',` : 'unrelated failure')});process.exitCode=1\n`)
    const previous = process.env.LAYERFS_CONNECT_NODE
    process.env.LAYERFS_CONNECT_NODE = process.execPath
    const host = new LayerfsHost(fixture, () => {})
    try {
      await assert.rejects(host.request('GET', '/api/status'), error => {
        assert.match(error.message, expected)
        assert.doesNotMatch(error.message, /TEST_CANARY|credential=/)
        return true
      })
    } finally {
      host.close()
      if (previous === undefined) delete process.env.LAYERFS_CONNECT_NODE
      else process.env.LAYERFS_CONNECT_NODE = previous
    }
  })
}
test.after(() => rmSync(root, { recursive: true, force: true }))
