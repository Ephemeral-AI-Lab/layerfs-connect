// The real platform test on LayerFS 2.0: one fresh home, one machine per
// kind named in LFC_REAL_MACHINES (default `native`; e.g. `native,docker`
// with the docker machine's image in LFC_REAL_DOCKER_IMAGE). On each: a
// Store moved there, a Sandbox, mount, exec, Commit, unmount, close; the
// Store comes back to native. Skipped unless CONNECT_REAL_LAYERFS=1.
//   CONNECT_REAL_LAYERFS=1 node --test --test-timeout=120000 host/test/platform-real.test.js
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { resolveSpec } from '../config.js'
import { layerfs, recordNativeDaemon } from '../layerfs.js'

const real = process.env.CONNECT_REAL_LAYERFS === '1'
const machines = (process.env.LFC_REAL_MACHINES || 'native').split(',').filter(Boolean)

test('one home, one machine per kind: a Sandbox on each runs, commits and closes', { skip: !real && 'set CONNECT_REAL_LAYERFS=1' }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'lfc-platform-'))
  try {
    const spec = resolveSpec(join(root, 'state'))
    await recordNativeDaemon(spec)
    const lfs = layerfs(spec)
    if (machines.includes('docker')) await lfs.machine.update('docker', { image: process.env.LFC_REAL_DOCKER_IMAGE })
    mkdirSync(join(root, 'src'))
    writeFileSync(join(root, 'src', 'README.md'), 'platform test\n')
    await lfs.store.create('plat')
    await lfs.project.init('plat/app', join(root, 'src'))
    await lfs.branch.fork('plat/app', 'work', 'main')
    for (const machine of machines) {
      if (machine !== 'native') await lfs.store.move('plat', machine)
      const name = `plat-${machine}`
      await lfs.sandbox.create('plat/app', name, machine)
      const { ws } = await lfs.workspace.mount(name, 'work')
      try {
        const run = await lfs.workspace.exec(ws, `echo ${machine} > on-${machine}.txt`)
        assert.equal(run.exit_code, 0)
        assert.equal((await lfs.workspace.commit(ws, { message: `on ${machine}` })).kind, 'Committed')
      } finally {
        await lfs.workspace.unmount(ws)
        await lfs.sandbox.close(name)
      }
      if (machine !== 'native') await lfs.store.move('plat', 'native')
      assert.equal((await lfs.file.read('plat/app', 'work', `/on-${machine}.txt`)).text, `${machine}\n`)
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
