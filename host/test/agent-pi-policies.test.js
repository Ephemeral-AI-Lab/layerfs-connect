import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { SettingsManager } from '@earendil-works/pi-coding-agent'
import { AgentManager } from '../agents/index.js'
import { agentRoute } from '../agents/routes.js'
import { DEFAULT_PI_POLICIES, validatePiPolicies } from '../agents/pi-policies.js'

async function fixture(t) {
  const state = await mkdtemp(join(tmpdir(), 'connect-pi-policies-'))
  const managers = []
  const open = async () => { const manager = await AgentManager.create({ state, defaultCwd: state }); managers.push(manager); return manager }
  t.after(async () => { for (const manager of managers) await manager.close(); await rm(state, { recursive: true, force: true }) })
  return { state, open, close: async manager => { await manager.close(); managers.splice(managers.indexOf(manager), 1) }, manager: await open() }
}

test('Pi policies persist, configure root and child Pi settings, and share legacy retry limits', async t => {
  const f = await fixture(t)
  await f.manager.models.configure({ provider: 'policy-fixture', modelId: 'fixture-model', api: 'openai-completions', baseUrl: 'http://127.0.0.1:1/v1', apiKey: 'fixture-only' })
  const chat = await f.manager.create({})
  const original = await f.manager.open(chat.id)
  const before = await agentRoute(f.manager, 'GET', ['pi-policies'])
  assert.equal(before.policies.retry.maxRetries, 2)
  const policies = { compaction: { enabled: false, reserveTokens: 24000, keepRecentTokens: 12000 }, retry: { enabled: true, maxRetries: 4, baseDelayMs: 100, maxAgentDelayMs: 2000 } }
  const saved = await agentRoute(f.manager, 'POST', ['pi-policies'], policies)
  assert.deepEqual(saved.policies, policies)
  assert.equal(f.manager.live.has(chat.id), false, 'idle Pi sessions must reload policies')
  const active = await f.manager.open(chat.id)
  assert.notEqual(active, original)
  assert.deepEqual(active.session.settingsManager.getCompactionSettings(), policies.compaction)
  assert.deepEqual(active.session.settingsManager.getRetrySettings(), policies.retry)
  const child = SettingsManager.create(f.state, f.manager.agentDir)
  assert.deepEqual(child.getCompactionSettings(), policies.compaction)
  assert.deepEqual(child.getRetrySettings(), policies.retry)
  assert.equal(f.manager.runSettings().limits.maxRetries, 4)
  await f.close(f.manager)
  const restored = await f.open()
  assert.deepEqual(restored.piPolicyView().policies, policies)
  await restored.setRunSettings({ maxRetries: 0 })
  assert.equal(restored.piPolicyView().policies.retry.maxRetries, 0)
  assert.equal(SettingsManager.create(f.state, restored.agentDir).getRetryEnabled(), false)
  assert.equal(JSON.parse(await readFile(join(f.state, 'pi-policies.json'), 'utf8')).retry.maxRetries, undefined, 'retry limit has one storage owner')
})

test('invalid policy updates and active runs leave saved configuration unchanged', async t => {
  const f = await fixture(t)
  const before = f.manager.piPolicyView().policies
  for (const value of [null, [], { compaction: { enabled: 'yes' } }, { retry: { maxRetries: 6 } }, { retry: { baseDelayMs: 5001, maxAgentDelayMs: 100 } }, { compaction: { keepRecentTokens: -1 } }, { retry: { surprise: true } }]) {
    await assert.rejects(agentRoute(f.manager, 'POST', ['pi-policies'], value), error => error.status === 400)
    assert.deepEqual(f.manager.piPolicyView().policies, before)
  }
  const chat = await f.manager.create({})
  f.manager.record(chat.id).state = 'running'
  await assert.rejects(f.manager.setPiPolicies({ compaction: { enabled: false } }), error => error.status === 409)
  assert.deepEqual(f.manager.piPolicyView().policies, before)
  f.manager.record(chat.id).state = 'idle'
})

test('policy validation accepts zero token budgets and preserves fields on partial updates', () => {
  const previous = { ...structuredClone(DEFAULT_PI_POLICIES), retry: { ...DEFAULT_PI_POLICIES.retry, maxRetries: 2 } }
  const next = validatePiPolicies({ compaction: { reserveTokens: 0, keepRecentTokens: 0 } }, previous)
  assert.equal(next.compaction.reserveTokens, 0)
  assert.equal(next.compaction.keepRecentTokens, 0)
  assert.deepEqual(next.retry, previous.retry)
  assert.equal(previous.compaction.reserveTokens, 16384)
})
