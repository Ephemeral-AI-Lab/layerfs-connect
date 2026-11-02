// `/scenario <name> -platform <name>` (layerfs#529): the run's platform is
// kept in its scope, checked before the chat starts, and given to every
// sandbox.create of its scripts that names none (scope-platform.js).
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { AgentScenarios, DEFAULT_PLATFORM } from '../agents/scenarios.js'
import { Scope, SCOPE_ENV } from '../runs/scope.js'

const HOST = fileURLToPath(new URL('..', import.meta.url))

test('a scope keeps its platform; an older scope has none', () => {
  const root = mkdtempSync(join(tmpdir(), 'lfc-scope-platform-'))
  try {
    Scope.create(join(root, 'a'), { run: 'tour_1', project: 'p', trunk: 'tour_1.main', platform: 'linux' })
    assert.equal(Scope.open(join(root, 'a')).platform, 'linux')
    assert.equal(JSON.parse(readFileSync(join(root, 'a', 'scope.json'), 'utf8')).platform, 'linux')
    Scope.create(join(root, 'b'), { run: 'tour_2', project: 'p', trunk: 'tour_2.main' })
    assert.equal(Scope.open(join(root, 'b')).platform, null)
    assert.equal('platform' in JSON.parse(readFileSync(join(root, 'b', 'scope.json'), 'utf8')), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

const linuxHome = {
  placement: 'local',
  platforms: [
    { id: 'docker', allowed: true, ready: true, missing: [] },
    { id: 'linux', allowed: true, ready: false, missing: ['imageArchive'] },
    { id: 'mac', allowed: false, ready: false, missing: [] },
  ],
}
const checker = (status) => new AgentScenarios({ spec: {}, dir: '/nowhere', status: typeof status === 'function' ? status : async () => status })
const refused = (status, pattern) => (error) => error.status === status && pattern.test(error.message)

test('a scenario chat runs on docker unless it names another platform', async () => {
  assert.equal(DEFAULT_PLATFORM, 'docker')
  assert.equal(await checker(linuxHome).checkPlatform(), 'docker')
  assert.equal(await checker(linuxHome).checkPlatform('docker'), 'docker')
})

test('a platform is refused before the chat starts', async () => {
  await assert.rejects(checker(linuxHome).checkPlatform('windows'), refused(400, /No platform named windows\. Platforms: docker, mac, linux/))
  await assert.rejects(checker(linuxHome).checkPlatform('mac'), refused(409, /mac is not available on this home, which allows docker and linux\. Use -platform docker\./))
  await assert.rejects(checker(linuxHome).checkPlatform('linux'), refused(409, /linux is not ready on this home: it needs imageArchive/))
  // a VM home allows its provider alone, so the default docker is refused with the way out
  const vm = { placement: 'vm:lima', platforms: [{ id: 'docker', allowed: false, ready: false, missing: [] }, { id: 'lima', allowed: true, ready: true, missing: [] }] }
  await assert.rejects(checker(vm).checkPlatform(), refused(409, /docker is not available on this home, which allows lima\. Use -platform lima\./))
  assert.equal(await checker(vm).checkPlatform('lima'), 'lima')
})

test('a LayerFS from before layerfs#529 accepts only the platform its home makes', async () => {
  assert.equal(await checker({ placement: 'local' }).checkPlatform(), 'docker')
  await assert.rejects(checker({ placement: 'local' }).checkPlatform('linux'), refused(409, /makes every Sandbox on docker\. Choosing another platform needs LayerFS with Sandbox platforms/))
  assert.equal(await checker({ placement: 'vm:apple-container' }).checkPlatform('apple-container'), 'apple-container')
  await assert.rejects(checker({ placement: 'vm:apple-container' }).checkPlatform(), refused(409, /makes every Sandbox on apple-container/))
})

test('a status that cannot be read leaves the refusal to LayerFS', async () => {
  assert.equal(await checker(async () => { throw new Error('no runtime') }).checkPlatform('linux'), 'linux')
})

// The redirect itself, with a stand-in SDK laid out as layerfs#529's: its
// sandbox/create.js imports checkedPlatform from ../platform.js.
test('a scoped script’s sandbox.create gets the run’s platform unless it names one', () => {
  const root = mkdtempSync(join(tmpdir(), 'lfc-scope-redirect-'))
  try {
    mkdirSync(join(root, 'host', 'runs'), { recursive: true })
    copyFileSync(join(HOST, 'resolve-layerfs.js'), join(root, 'host', 'resolve-layerfs.js'))
    for (const f of ['scope.js', 'scope-platform.js', 'scope-client.js']) copyFileSync(join(HOST, 'runs', f), join(root, 'host', 'runs', f))
    const agent = join(root, 'node_modules', '@layerfs', 'agent')
    mkdirSync(join(agent, 'src', 'sandbox'), { recursive: true })
    writeFileSync(join(agent, 'package.json'), JSON.stringify({ name: '@layerfs/agent', type: 'module', main: 'src/index.js' }))
    writeFileSync(join(agent, 'src', 'index.js'), 'export { create } from "./sandbox/create.js";\nexport { checkedPlatform } from "./platform.js";\n')
    writeFileSync(join(agent, 'src', 'sandbox', 'create.js'), 'import { checkedPlatform } from "../platform.js";\nexport const create = (o = {}) => checkedPlatform(null, o.platform).platform;\n')
    writeFileSync(join(agent, 'src', 'platform.js'), 'export const checkedPlatform = (client, platform) => ({ platform: platform === undefined ? "home-default" : platform });\nexport const PLATFORMS = ["docker", "linux"];\n')
    const script = 'const { create, checkedPlatform } = await import("@layerfs/agent"); console.log(JSON.stringify([create(), create({ platform: "docker" }), checkedPlatform(null, undefined).platform]))'
    const run = (env) => JSON.parse(execFileSync(process.execPath, ['--import', join(root, 'host', 'resolve-layerfs.js'), '--input-type=module', '-e', script], { cwd: root, env: { ...process.env, ...env }, encoding: 'utf8' }))

    Scope.create(join(root, 'scope'), { run: 'tour_1', project: 'p', trunk: 'tour_1.main', platform: 'linux' })
    assert.deepEqual(run({ [SCOPE_ENV]: join(root, 'scope') }), ['linux', 'docker', 'linux'])
    // a scope without a platform, and a call outside any run, keep the home's default
    Scope.create(join(root, 'older'), { run: 'tour_2', project: 'p', trunk: 'tour_2.main' })
    assert.deepEqual(run({ [SCOPE_ENV]: join(root, 'older') }), ['home-default', 'docker', 'home-default'])
    assert.deepEqual(run({ [SCOPE_ENV]: '' }), ['home-default', 'docker', 'home-default'])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
