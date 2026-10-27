// host/seed.js: a layerfs-demo-seed v1 written out as a folder.
//   node --test host/test/seed.test.js
import assert from 'node:assert/strict'
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { checkSeed, readSeed, writeSeed } from '../seed.js'

const SCENARIOS = fileURLToPath(new URL('../../scenarios/', import.meta.url))
const scratch = mkdtempSync(join(tmpdir(), 'lfc-seed-test-'))
after(() => {
  // the test seed has a read-only folder; make it writable again to remove it
  for (const dir of ['parsed', 'file']) if (existsSync(join(scratch, dir, 'bin'))) chmodSync(join(scratch, dir, 'bin'), 0o755)
  rmSync(scratch, { recursive: true, force: true })
})

const seed = {
  format: 'layerfs-demo-seed',
  version: 1,
  entries: {
    '/.git': { type: 'dir', mode: 0o755 },
    '/.git/HEAD': { type: 'file', mode: 0o644, text: 'ref: refs/heads/main\n' },
    '/bin': { type: 'dir', mode: 0o555 },
    '/bin/run.sh': { type: 'file', mode: 0o755, text: '#!/bin/sh\necho hi\n' },
    '/data.bin': { type: 'file', base64: Buffer.from([0, 1, 2, 255]).toString('base64') },
    '/empty': { type: 'file' },
    '/link': { type: 'symlink', target: 'bin/run.sh' },
  },
}

test('writes a parsed seed out and answers the folder', () => {
  const dir = join(scratch, 'parsed')
  assert.equal(writeSeed(seed, dir), dir)
  assert.equal(readFileSync(join(dir, '.git/HEAD'), 'utf8'), 'ref: refs/heads/main\n')
  assert.deepEqual([...readFileSync(join(dir, 'data.bin'))], [0, 1, 2, 255])
  assert.equal(readFileSync(join(dir, 'empty'), 'utf8'), '')
  assert.equal(readlinkSync(join(dir, 'link')), 'bin/run.sh')
  assert.equal(statSync(join(dir, 'bin/run.sh')).mode & 0o777, 0o755)
  // a read-only folder still got its file: modes are set last, deepest first
  assert.equal(statSync(join(dir, 'bin')).mode & 0o777, 0o555)
})

test('writes a seed file out, replacing what the folder held', () => {
  const file = join(scratch, 'seed.json')
  writeFileSync(file, JSON.stringify(seed))
  const dir = join(scratch, 'file')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'stale.txt'), 'old')
  writeSeed(file, dir)
  assert.equal(existsSync(join(dir, 'stale.txt')), false)
  assert.equal(readFileSync(join(dir, 'bin/run.sh'), 'utf8'), '#!/bin/sh\necho hi\n')
  assert.deepEqual(readSeed(file).entries['/link'], { type: 'symlink', target: 'bin/run.sh' })
})

test('refuses a seed that is not a layerfs-demo-seed v1, naming the entry', () => {
  assert.throws(() => checkSeed({ format: 'other', version: 1 }), /not a layerfs-demo-seed v1/)
  const bad = (entries) => () => checkSeed({ format: 'layerfs-demo-seed', version: 1, entries })
  assert.throws(bad({ 'a.txt': { type: 'file' } }), /entry a\.txt is not a plain absolute path/)
  assert.throws(bad({ '/a/../b': { type: 'file' } }), /not a plain absolute path/)
  assert.throws(bad({ '/a': { type: 'file', owner: 'me' } }), /unknown field owner/)
  assert.throws(bad({ '/a': { type: 'fifo' } }), /unknown type fifo/)
  assert.throws(() => writeSeed({ format: 'layerfs-demo-seed', version: 2 }, join(scratch, 'never')), /v1/)
  assert.equal(existsSync(join(scratch, 'never')), false)
})

test("every scenario's seed.json writes out exactly its entries", () => {
  const seeds = readdirSync(SCENARIOS).filter((id) => existsSync(join(SCENARIOS, id, 'seed.json')))
  assert.deepEqual(seeds.sort(), ['crew', 'depot', 'shop'])
  for (const id of seeds) {
    const file = join(SCENARIOS, id, 'seed.json')
    const { entries } = readSeed(file)
    const dir = writeSeed(file, join(scratch, `scenario-${id}`))
    const found = []
    ;(function walk(at) {
      for (const name of readdirSync(at)) {
        const path = join(at, name)
        found.push(`/${relative(dir, path)}`)
        if (lstatSync(path).isDirectory()) walk(path)
      }
    })(dir)
    assert.deepEqual(found.sort(), Object.keys(entries).sort(), id)
    for (const [path, e] of Object.entries(entries)) {
      if (e.type !== 'file') continue
      const want = e.text !== undefined ? Buffer.from(e.text) : Buffer.from(e.base64 ?? '', 'base64')
      assert.ok(readFileSync(join(dir, path)).equals(want), `${id}${path}`)
    }
  }
})
