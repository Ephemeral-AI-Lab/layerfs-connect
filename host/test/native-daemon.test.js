// The native machine's daemon and the host's Store leases on the real
// linked LayerFS (macOS, where Connect records a native daemon): a fresh
// home gets the checkout's daemon; a recorded daemon that is not there any
// more is replaced by machine.update at the next start; closeStores()
// drops the leases this process holds, so a quit leaves none.
//   node --test host/test/native-daemon.test.js
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { resolveSpec } from '../config.js'
import { layerfs, recordNativeDaemon } from '../layerfs.js'

/** Why these are skipped here, or false: macOS only, with a daemon beside the linked CLI. */
function skipped() {
  if (process.platform !== 'darwin') return 'macOS records a native daemon'
  const probe = mkdtempSync(join(tmpdir(), 'lfc-nd-'))
  try {
    return !resolveSpec(probe).daemon && 'no LayerFS daemon beside the linked CLI'
  } finally {
    rmSync(probe, { recursive: true, force: true })
  }
}
const skip = skipped()

test('a recorded native daemon that is not there is replaced with the one Connect found', { skip }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'lfc-native-daemon-'))
  try {
    const spec = resolveSpec(join(root, 'state'))
    const first = await recordNativeDaemon(spec)
    assert.equal(first.recorded, true, JSON.stringify(first))
    const lfs = layerfs(spec)
    assert.equal((await lfs.machine.get('native')).daemon, spec.daemon)
    // its checkout went away: the record names a daemon that is not there
    const file = join(spec.home, 'machine', 'native', 'record.json')
    const record = JSON.parse(readFileSync(file, 'utf8'))
    writeFileSync(file, JSON.stringify({ ...record, daemon: join(root, 'gone', 'layerfs-daemon') }), { mode: 0o600 })
    const again = await recordNativeDaemon(spec)
    assert.deepEqual(again, { recorded: true, kept: false, replaced: join(root, 'gone', 'layerfs-daemon') })
    assert.equal((await lfs.machine.get('native')).daemon, spec.daemon)
    // a daemon that is there is kept as it is
    assert.equal((await recordNativeDaemon(spec)).kept, true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
