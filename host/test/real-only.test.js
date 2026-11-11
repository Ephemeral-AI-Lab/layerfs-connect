import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { requireRealBackend, resolveSpec } from '../config.js'

test('retired simulation launch refuses before creating state or starting real resources', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'connect-real-only-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const state = join(root, 'state')
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', "import {resolveSpec} from './host/config.js'; resolveSpec(process.argv[1])", state], {
    cwd: new URL('../../', import.meta.url), env: { ...process.env, LAYERFS_CONNECT_MODE: 'sim' }, encoding: 'utf8', timeout: 5000,
  })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /only supports real LayerFS/)
  assert.equal(existsSync(state), false)
})

test('only unset or legacy real settings are accepted', () => {
  requireRealBackend('')
  requireRealBackend('real')
  assert.throws(() => requireRealBackend('sim'))
  assert.throws(() => requireRealBackend('unknown'))
})

test('old simulation state cannot become a real LayerFS home', (t) => {
  const state = mkdtempSync(join(tmpdir(), 'connect-old-state-'))
  t.after(() => rmSync(state, { recursive: true, force: true }))
  const home = join(state, 'home-2')
  mkdirSync(home)
  writeFileSync(join(home, 'sim-world.json'), '{}')
  assert.throws(() => resolveSpec(state), /no LayerFS 2.0 layerfs.json/)
  assert.equal(existsSync(join(home, 'layerfs.json')), false)
})
