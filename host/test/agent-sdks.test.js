import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { SdkSettings, sdkPrompt } from '../agents/sdks.js'
import { createConnectBashExtension, LEAD_MARK, WORKER_MARK } from '../agents/child-extension.js'
import { agentRoute } from '../agents/routes.js'

const json = (value) => JSON.stringify(value, null, 2)

/** A state folder, a Connect folder, and an SDK root beside it with two packages and one doc. */
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'connect-sdks-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const app = join(dir, 'app')
  const api = join(dir, 'lib', 'api')
  await mkdir(app, { recursive: true })
  await mkdir(join(api, 'agent', 'sdk'), { recursive: true })
  await mkdir(join(api, 'cli'), { recursive: true })
  await mkdir(join(api, 'docs'), { recursive: true })
  await writeFile(join(api, 'agent', 'sdk', 'package.json'), json({ name: '@x/agent', version: '2.3.4' }))
  await writeFile(join(api, 'cli', 'package.json'), json({ name: '@x/cli', version: '2.3.4' }))
  await writeFile(join(api, 'docs', 'agent.md'), '# agent\n')
  const defaults = join(dir, 'defaults.json')
  await writeFile(defaults, json({ sdks: [{
    id: 'x', title: 'X SDK', description: 'Test SDK.', enabled: true, root: '../lib/api',
    packages: ['@x/agent', '@x/cli'], command: 'x', docs: ['docs/agent.md'], agents: ['main', 'worker', 'nobody'],
    calls: [{ name: 'branch.fork', signature: 'fork(name)', description: 'Forks.' }, { name: 'broken' }],
  }] }))
  const file = join(dir, 'state', 'sdks.json')
  await mkdir(join(dir, 'state'))
  return { dir, api, file, sdks: new SdkSettings(file, { app, defaults }) }
}

test('the built-in list stands in until sdks.json exists, with what was found under the root', async (t) => {
  const { api, file, sdks } = await fixture(t)
  const view = sdks.view()
  assert.equal(view.custom, false)
  assert.equal(view.error, null)
  const [sdk] = view.sdks
  assert.equal(sdk.rootPath, api)
  assert.equal(sdk.version, '2.3.4')
  assert.equal(sdk.found, true)
  assert.deepEqual(sdk.packages, [{ name: '@x/agent', found: true }, { name: '@x/cli', found: true }])
  assert.deepEqual(sdk.docs, [{ path: 'docs/agent.md', found: true }])
  assert.deepEqual(sdk.agents, ['main', 'worker'], 'unknown agents are dropped')
  assert.deepEqual(sdk.calls, [{ name: 'branch.fork', signature: 'fork(name)', description: 'Forks.' }], 'a call without a signature is dropped')
  assert.equal(existsSync(file), false, 'reading never writes the file')
})

test('a package or doc that is not there marks the SDK missing', async (t) => {
  const { file, sdks } = await fixture(t)
  await writeFile(file, json({ sdks: [{ id: 'x', root: '../lib/api', packages: ['@x/agent', '@x/gone'], docs: ['docs/gone.md'] }] }))
  const [sdk] = sdks.view().sdks
  assert.equal(sdks.view().custom, true)
  assert.equal(sdk.title, 'x')
  assert.equal(sdk.found, false)
  assert.deepEqual(sdk.packages.map((pkg) => pkg.found), [true, false])
  assert.deepEqual(sdk.docs, [{ path: 'docs/gone.md', found: false }])
})

test('the switch writes sdks.json from the built-in list and keeps everything else', async (t) => {
  const { file, sdks } = await fixture(t)
  const view = sdks.setEnabled({ id: 'x', enabled: false })
  assert.equal(view.custom, true)
  assert.equal(view.sdks[0].enabled, false)
  const written = JSON.parse(await readFile(file, 'utf8'))
  assert.equal(written.sdks[0].enabled, false)
  assert.equal(written.sdks[0].calls.length, 2, 'the file keeps what was written, even entries the page drops')
  assert.throws(() => sdks.setEnabled({ id: 'nope', enabled: true }), { status: 404 })
  assert.throws(() => sdks.setEnabled({ id: 'x' }), { status: 400 })
})

test('a broken sdks.json is reported, and the switch waits for it to be fixed', async (t) => {
  const { file, sdks } = await fixture(t)
  await writeFile(file, '{ "sdks": [')
  const view = sdks.view()
  assert.match(view.error, /not valid JSON/)
  assert.deepEqual(view.sdks, [])
  assert.throws(() => sdks.setEnabled({ id: 'x', enabled: false }), { status: 409 })
  await writeFile(file, json({ other: [] }))
  assert.match(sdks.view().error, /needs an "sdks" list/)
})

test('the sdks routes read, switch and open the file', async (t) => {
  const { sdks } = await fixture(t)
  const calls = []
  const manager = { sdks, sdkView: () => ({ ...sdks.view(), busy: [] }), setSdk: async (change) => { calls.push(change); return sdks.setEnabled(change) } }
  assert.equal((await agentRoute(manager, 'GET', ['sdks'])).sdks[0].id, 'x')
  assert.equal((await agentRoute(manager, 'POST', ['sdks'], { id: 'x', enabled: false })).sdks[0].enabled, false)
  assert.deepEqual(calls, [{ id: 'x', enabled: false }])
})

test('each agent kind gets the sections of the SDKs that are on, found and list it', async (t) => {
  const { api, sdks } = await fixture(t)
  const prompts = sdks.prompts()
  assert.equal(prompts.lead, '', 'the fixture lists main and worker only')
  assert.equal(prompts.main, prompts.worker)
  assert.equal(prompts.main, [
    '## SDK: X SDK',
    'Test SDK.',
    '- Packages: @x/agent, @x/cli',
    '- Command: `x`',
    `- Docs: ${join(api, 'docs', 'agent.md')}`,
    '- Calls (`<group>.<call>`: signature, what it does):',
    '  - branch.fork: `fork(name)` Forks.',
  ].join('\n'))
  sdks.setEnabled({ id: 'x', enabled: false })
  assert.deepEqual(sdks.prompts(), { main: '', worker: '', lead: '' }, 'off adds nothing')
})

test('an SDK that is missing adds nothing, and a missing doc is left out', async (t) => {
  const { file, sdks } = await fixture(t)
  await writeFile(file, json({ sdks: [
    { id: 'gone', root: '../lib/api', packages: ['@x/gone'], agents: ['main'] },
    { id: 'x', title: 'X', root: '../lib/api', packages: ['@x/agent'], docs: ['docs/agent.md', 'docs/gone.md'], agents: ['main'] },
  ] }))
  const { main } = sdks.prompts()
  assert.doesNotMatch(main, /gone/)
  assert.match(main, /## SDK: X/)
})

test('the main agent, workers and leads each append their own SDK section', async () => {
  const sdk = { prompt: { main: 'MAIN SDK', worker: 'WORKER SDK', lead: '' } }
  const prompt = async (options, systemPrompt) => {
    const hooks = new Map()
    createConnectBashExtension({ env: {}, cwd: tmpdir(), traceDir: join(tmpdir(), `connect-sdk-trace-${process.pid}`), projectInstructions: { main: false, worker: false, lead: false }, sdk, ...options })({ on: (name, handler) => hooks.set(name, handler), registerTool: () => {} })
    return (await hooks.get('before_agent_start')({ systemPrompt }, { cwd: tmpdir(), abort: () => assert.fail('unexpected abort') })).systemPrompt
  }
  assert.equal(await prompt({ agent: 'root' }, 'base'), 'base\n\nMAIN SDK')
  assert.equal(await prompt({}, WORKER_MARK), `${WORKER_MARK}\n\nWORKER SDK`)
  assert.equal(await prompt({}, LEAD_MARK), LEAD_MARK, 'a kind with no SDKs gets nothing')
})

test('the shipped LayerFS section lists all 32 calls', () => {
  const sdk = new SdkSettings('/nonexistent/sdks.json').view().sdks.find((entry) => entry.id === 'layerfs')
  if (!sdk?.found) return
  const text = sdkPrompt(sdk)
  assert.equal(text.split('\n').filter((line) => line.startsWith('  - ')).length, 32)
  assert.match(text, /branch\.fork: `fork\(name, fromRef = "main"\)`/)
})

test('the shipped defaults list the LayerFS SDK and its 32 calls', async () => {
  const { sdks: [layerfs] } = JSON.parse(await readFile(new URL('../agents/sdks.default.json', import.meta.url), 'utf8'))
  assert.equal(layerfs.id, 'layerfs')
  assert.equal(layerfs.calls.length, 32)
  assert.equal(new Set(layerfs.calls.map((call) => call.name)).size, 32)
  const groups = Object.groupBy(layerfs.calls, (call) => call.name.split('.')[0])
  assert.deepEqual(Object.fromEntries(Object.entries(groups).map(([group, calls]) => [group, calls.length])), { client: 3, project: 2, branch: 6, fs: 14, workspace: 4, sandbox: 3 })
})
