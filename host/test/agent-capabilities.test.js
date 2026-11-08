import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import { AgentSetup, capabilityCatalog } from '../agents/capabilities.js'
import { DEFAULT_SETUP, workerDefinition, leadDefinition } from '../agents/extensions.js'

test('settings show installed Pi/subagents and the actual configured agent definitions', () => {
  const catalog = capabilityCatalog()
  assert.equal(catalog.runtime.name, 'Pi')
  assert.match(catalog.runtime.version, /^\d+\.\d+\.\d+/)
  assert.equal(catalog.live, false)
  const extension = catalog.extensions.find((item) => item.id === 'pi-subagents')
  assert.match(extension.version, /^\d+\.\d+\.\d+/)
  assert.equal(extension.enabled, true)
  assert.equal(catalog.agents.find((agent) => agent.id === 'worker').prompt.text, workerDefinition(DEFAULT_SETUP))
  assert.equal(catalog.agents.find((agent) => agent.id === 'lead').prompt.text, leadDefinition(DEFAULT_SETUP))
  const main = catalog.agents.find((agent) => agent.id === 'main')
  assert.match(main.prompt.text, /You are the coding agent in LayerFS Connect/)
  assert.match(main.prompt.text, /<working folder>/)
  assert.match(main.prompt.note, /Project, conversation and SDK instructions/)
  assert.ok(catalog.hooks.every((hook) => hook.handlers === null))
})

test('persisted capability switches update agent tools, prompts and hooks without unlocking required controls', async (t) => {
  const temp = await mkdtemp(join(tmpdir(), 'connect-capabilities-'))
  t.after(() => rm(temp, { recursive: true, force: true }))
  const file = join(temp, 'agent-setup.json')
  const setup = new AgentSetup(file)
  setup.change({ kind: 'tool', id: 'contact_supervisor', agent: 'worker', enabled: false })
  setup.change({ kind: 'hook', id: 'layerfs-connect:before_agent_start', agent: 'worker', enabled: false })
  const catalog = capabilityCatalog(new AgentSetup(file).get())
  const worker = catalog.agents.find((agent) => agent.id === 'worker')
  assert.equal(worker.tools.find((tool) => tool.name === 'contact_supervisor').enabled, false)
  assert.equal(worker.hooks.find((hook) => hook.id === 'layerfs-connect:before_agent_start').enabled, false)
  assert.match(worker.prompt.text, /excludeTools: contact_supervisor/)
  assert.doesNotMatch(worker.prompt.text, /Root-level project instructions are already loaded/)
  assert.equal(catalog.agents.find((agent) => agent.id === 'main').hooks.find((hook) => hook.id === 'layerfs-connect:before_agent_start').enabled, true)
  assert.throws(() => setup.change({ kind: 'tool', id: 'bash', enabled: false }), { status: 409 })
  assert.throws(() => setup.change({ kind: 'hook', id: 'layerfs-connect:message_start', enabled: false }), { status: 409 })
  setup.change({ kind: 'extension', id: 'pi-subagents', enabled: false })
  const disabled = capabilityCatalog(new AgentSetup(file).get())
  assert.ok(disabled.tools.filter((tool) => tool.extension === 'pi-subagents').every((tool) => !tool.enabled))
  assert.ok(disabled.hooks.filter((hook) => hook.extension === 'pi-subagents').every((hook) => !hook.enabled))
  assert.ok(disabled.agents.filter((agent) => agent.id !== 'main').every((agent) => !agent.enabled))
})
