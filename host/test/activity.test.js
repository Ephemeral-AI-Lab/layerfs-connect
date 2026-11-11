import assert from 'node:assert/strict'
import test from 'node:test'
import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execute } from '../cli/spawn.js'
import { activityRecorder, shareInvocation } from '../activity/recorder.js'
import { activityEnv, withActivity } from '../activity/context.js'
import { sanitizer } from '../activity/redact.js'
import { ActivityStore } from '../activity/store.js'
import { createHostServer, listen } from '../server.js'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

function fixture(t) {
  const state = mkdtempSync(join(tmpdir(), 'connect-activity-'))
  t.after(() => rmSync(state, { recursive: true, force: true }))
  const cli = join(state, 'layerfs')
  writeFileSync(join(state, 'layerfs.json'), '{}')
  writeFileSync(cli, `#!${process.execPath}
const fs = require('node:fs'); const [mode] = process.argv.slice(2)
fs.appendFileSync(${JSON.stringify(join(state, 'attempts'))}, mode + '\\n')
if(mode==='refuse'){console.error(JSON.stringify({code:'Busy',message:'store is busy'}));process.exit(125)}
if(mode==='usage'){console.error('layerfs: unknown option');process.exit(2)}
if(mode==='lost'){console.log('{"stream":"stdout","bytes":"partial"}');process.exit(0)}
if(mode==='large'){process.stdout.write(JSON.stringify({text:'x'.repeat(70000)})+'\\n',()=>process.exit(0));return}
let input='';process.stdin.on('data',x=>input+=x);process.stdin.on('end',()=>setTimeout(()=>{console.error(JSON.stringify({progress:{phase:'send',done:1,total:2}}));console.log(JSON.stringify({kind:'ok',mode,input,password:'do-not-record',exit_code:125}))},mode==='slow'?50:0))
`)
  chmodSync(cli, 0o700)
  const spec = { state, home: state, cli }
  const recorder = activityRecorder(state)
  const action = id => ({ id, name: 'machine.start', label: 'Start machine', target: 'lima1', origin: 'user' })
  return { spec, recorder, action, run: (id, fn) => withActivity({ state, action: action(id) }, fn) }
}

test('concurrent desktop actions retain real CLI input, stdin and output without replay', async t => {
  const f = fixture(t)
  const results = await Promise.all(['first', 'second'].map(id => f.run(id, () => execute(f.spec, [id], { input: 'hello' }))))
  assert.equal(results[0].password, 'do-not-record') // Sanitizing the log never changes the caller's result.
  const page = await f.recorder.read()
  assert.equal(page.items.length, 2)
  for (const item of page.items) {
    assert.equal(item.name, 'machine.start')
    const call = item.invocations[0]
    assert.deepEqual(call.argv, [item.id])
    assert.equal(call.stdin.text, 'hello')
    assert.equal(call.status, 'success')
    assert.equal(call.exitCode, 0)
    assert.equal(call.commandExitCode, 125)
    assert.match(call.stdout.text, /REDACTED/)
    assert.doesNotMatch(call.stdout.text, /do-not-record/)
    assert.match(call.stderr.text, /send/)
    assert.ok(call.pid)
  }
  assert.equal(readFileSync(join(f.spec.state, 'attempts'), 'utf8').trim().split('\n').length, 2)
  const dir = f.recorder.store.dir
  assert.equal(statSync(dir).mode & 0o777, 0o700)
  for (const name of readdirSync(dir)) assert.equal(statSync(join(dir, name)).mode & 0o777, 0o600)
})

test('refusal, usage, missing binary, blocked admission and lost result remain distinct', async t => {
  const f = fixture(t)
  for (const [mode, expected, options] of [['refuse', 'refused', {}], ['usage', 'usage-error', {}], ['lost', 'uncertain', { events: true }], ['blocked', 'not-started', { beforeSpawn() { throw new Error('stopped before spawn') } }]]) {
    await assert.rejects(f.run(mode, () => execute(f.spec, [mode], options)))
    const call = (await f.recorder.read({ actionId: mode })).items[0].invocations[0]
    assert.equal(call.status, expected)
    if (mode === 'blocked') assert.equal(call.started, undefined)
    if (mode === 'refuse') assert.match(call.stderr.text, /Busy/)
  }
  assert.throws(() => f.run('missing', () => execute({ ...f.spec, cli: '/no-such-connect-cli' }, [])), { code: 'CliUnavailable' })
  assert.equal((await f.recorder.read({ actionId: 'missing' })).items[0].invocations[0].status, 'launch-failed')
  assert.equal(readFileSync(join(f.spec.state, 'attempts'), 'utf8').trim().split('\n').length, 3)
})

test('large output has an explicit byte count and truncation marker', async t => {
  const f = fixture(t)
  const result = await f.run('large', () => execute(f.spec, ['large']))
  assert.equal(result.text.length, 70000)
  const call = (await f.recorder.read()).items[0].invocations[0]
  assert.equal(call.stdout.truncated, true)
  assert.ok(call.stdout.bytes > 70000)
  assert.ok(Buffer.byteLength(call.stdout.text) <= 32768)
})

test('shared reads reference the original process and output instead of inventing an execution', async t => {
  const f = fixture(t)
  const pending = f.run('owner', () => execute(f.spec, ['slow']))
  f.run('follower', () => shareInvocation(pending))
  await pending
  const follower = (await f.recorder.read({ actionId: 'follower' })).items[0]
  assert.equal(follower.invocations.length, 1)
  assert.equal(follower.invocations[0].status, 'success')
  assert.equal(follower.invocations[0].shared, true)
  assert.match(follower.invocations[0].stdout.text, /slow/)
  assert.equal(readFileSync(join(f.spec.state, 'attempts'), 'utf8').trim(), 'slow')
})

test('an orphaned invocation is interrupted rather than left running after restart', async t => {
  const f = fixture(t)
  f.recorder.record(f.action('orphan'), 'cli.queued', { ownerPid: 2147483647, argv: ['store', 'push'] }, 'call')
  f.recorder.record(f.action('orphan'), 'cli.started', { started: Date.now() }, 'call')
  const call = (await f.recorder.read()).items[0].invocations[0]
  assert.equal(call.status, 'interrupted')
  assert.match(call.message, /Inspect state/)
})

test('redaction covers credentials in flags, URLs, JSON, env and referenced files', t => {
  const f = fixture(t), secretFile = join(f.spec.state, 'secret')
  writeFileSync(secretFile, 'file-secret-value')
  const scrub = sanitizer(['store', 'connect', '--password', 'env:DB_PASSWORD', '--key=inline-secret', `file:${secretFile}`], { DB_PASSWORD: 'env-secret-value' })
  const text = scrub.bounded('env-secret-value file-secret-value Bearer abcdef postgresql://user:urlsecret@host/db {"password":"json-secret"}').text
  for (const secret of ['env-secret-value', 'file-secret-value', 'abcdef', 'urlsecret', 'json-secret']) assert.ok(!text.includes(secret))
  assert.ok(!scrub.argv.join(' ').includes('inline-secret'))
})

test('rotation, retention, partial lines and restart reads do not lose complete events', async t => {
  const f = fixture(t), store = new ActivityStore(f.spec.state, { fileBytes: 300, maxBytes: 1500 })
  for (let i = 0; i < 8; i++) await store.append({ v: 1, action: f.action(`action-${i}`), at: i + 1, seq: i, type: 'action.received', data: {} })
  const files = await store.files()
  assert.ok(files.length > 1)
  assert.ok(files.reduce((sum, x) => sum + x.size, 0) <= 1500)
  const latest = files.at(-1).path
  const original = readFileSync(latest, 'utf8')
  writeFileSync(latest, original + '{"interrupted":')
  const reopened = new ActivityStore(f.spec.state)
  assert.ok((await reopened.read()).items.length)
  const expired = new ActivityStore(f.spec.state, { now: () => Date.now() + 8 * 86400000 })
  await expired.prune()
  assert.equal((await expired.files()).length, 0)
})

test('logging failure never changes an operation result and surfaces a diagnostic', async t => {
  const f = fixture(t)
  writeFileSync(join(f.spec.state, 'logs'), 'not a directory')
  assert.equal((await f.run('unwritable', () => execute(f.spec, ['ok']))).kind, 'ok')
  await f.recorder.flush()
  assert.match(f.recorder.store.error, /could not be saved/)
  assert.match((await f.recorder.read()).warning, /could not be saved/)
})

test('pagination retains actions that started in the same millisecond', async t => {
  const f = fixture(t)
  for (const id of ['a', 'b', 'c']) await f.recorder.store.append({ v: 1, action: f.action(id), at: 123, seq: 1, type: 'action.received', data: {} })
  const first = await f.recorder.read({ limit: 1 })
  const second = await f.recorder.read({ limit: 1, before: first.next })
  const third = await f.recorder.read({ limit: 1, before: second.next })
  assert.deepEqual([first.items[0].id, second.items[0].id, third.items[0].id], ['c', 'b', 'a'])
})

test('child process correlation survives explicit exit and independent writers', async t => {
  const f = fixture(t)
  const env = f.run('child', () => activityEnv(f.spec.state))
  const source = `import {execute} from ${JSON.stringify(new URL('../cli/spawn.js', import.meta.url).href)};import {activityRecorder} from ${JSON.stringify(new URL('../activity/recorder.js', import.meta.url).href)};await execute(${JSON.stringify({ home: f.spec.home, cli: f.spec.cli })},['child']);await activityRecorder(process.env.LAYERFS_CONNECT_ACTIVITY_STATE).flush();process.exit(0)`
  await promisify(execFile)(process.execPath, ['--input-type=module', '-e', source], { env: { ...process.env, ...env }, timeout: 5000 })
  const page = await f.recorder.read()
  assert.equal(page.items[0].id, 'child')
  assert.match(page.items[0].invocations[0].stdout.text, /child/)
})

test('authenticated routes correlate all calls from an action; viewing launches no CLI', async t => {
  const f = fixture(t), server = createHostServer({ token: 'test-token', projects: {}, activity: f.recorder, machines: { start: async () => { await execute(f.spec, ['first']); return execute(f.spec, ['second']) } }, log() {} })
  const url = await listen(server)
  t.after(() => new Promise(resolve => server.close(resolve)))
  const headers = { authorization: 'Bearer test-token', 'x-lfs-action': encodeURIComponent(JSON.stringify(f.action('http-action'))) }
  assert.equal((await fetch(`${url}/api/cli-activity`)).status, 401)
  assert.equal((await fetch(`${url}/api/machines/lima1/start`, { method: 'POST', headers })).status, 200)
  const page = await (await fetch(`${url}/api/cli-activity?origin=user`, { headers })).json()
  assert.equal(page.items.length, 1)
  assert.equal(page.items[0].invocations.length, 2)
  assert.equal(readFileSync(join(f.spec.state, 'attempts'), 'utf8').trim().split('\n').length, 2)
})

test('fast machine stage boundaries retain state and elapsed time', async t => {
  const f = fixture(t)
  writeFileSync(f.spec.cli, `#!${process.execPath}\nfor (const progress of [{stage:'bundle-validation',state:'started'},{stage:'bundle-validation',state:'completed',elapsed_ms:1},{stage:'sandbox-image',state:'started'},{stage:'sandbox-image',state:'completed',elapsed_ms:42}]) console.error(JSON.stringify({progress})); console.log('{}')\n`)
  await f.run('stages', () => execute(f.spec, ['machine', 'start', '--progress', 'docker']))
  await f.recorder.flush()
  const events = f.recorder.store
  const rows = readdirSync(events.dir).filter(name => name.endsWith('.ndjson')).flatMap(name => readFileSync(join(events.dir, name), 'utf8').trim().split('\n').map(line => JSON.parse(line)))
  const stages = rows.filter(row => row.type === 'cli.progress').map(row => row.data.progress)
  assert.equal(stages.length, 4)
  assert.deepEqual(stages.at(-1), {stage:'sandbox-image',state:'completed',elapsed_ms:42})
})
