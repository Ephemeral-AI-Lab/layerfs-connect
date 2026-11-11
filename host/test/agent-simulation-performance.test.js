import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SessionManager } from '@earendil-works/pi-coding-agent'
import { AgentManager } from '../agents/index.js'
import { simulationChatAdapter } from '../agents/simulation-bridge.js'

function fixture(t) {
  const state = mkdtempSync(join(tmpdir(), 'connect-chat-performance-'))
  t.after(() => rmSync(state, { recursive: true, force: true }))
  const manager = new EventEmitter(); Object.setPrototypeOf(manager, AgentManager.prototype)
  const record = { id: 'large-chat', title: 'Large saved objective', state: 'running', project: 'store/project', simulation: { id: 'run' }, updated: 1, messages: [{ role: 'assistant', text: 'saved history '.repeat(100000) }], children: [], approvals: [], tools: [], execution: { phase: 'thinking' }, sessionFile: null, workspace: null }
  Object.assign(manager, { state, dir: join(state, 'chats'), records: new Map([[record.id, record]]), live: new Map() })
  mkdirSync(join(manager.dir, record.id), { recursive: true })
  return { manager, record, state }
}

test('simulation notifications persist complete history without projecting or broadcasting it', t => {
  const { manager, record } = fixture(t), events = []
  manager.on('event', event => events.push(event))
  manager.detail = () => { throw new Error('Summary publication must not enrich the complete transcript') }
  manager.changed(record.id, true, { summaryOnly: true })
  assert.equal(events.length, 1)
  assert.equal(events[0].type, 'chat-summary')
  assert.equal(events[0].session.id, record.id)
  assert.equal(events[0].session.project, record.project)
  assert.equal(events[0].session.messages, undefined)
  assert.equal(events[0].session.children, undefined)
  assert.ok(JSON.stringify(events[0]).length < 1000)
  const saved = JSON.parse(readFileSync(join(manager.dir, record.id, 'chat.json'), 'utf8'))
  assert.equal(saved.messages[0].text, record.messages[0].text)
})

test('ordinary model chat updates retain their full transcript event contract', t => {
  const { manager, record } = fixture(t), events = []
  delete record.simulation
  manager.on('event', event => events.push(event))
  manager.detail = () => ({ ...record, queued: [] })
  manager.changed(record.id)
  assert.equal(events[0].type, 'chat')
  assert.equal(events[0].session.messages[0].text, record.messages[0].text)
})

test('child-only publications reuse the unchanged main projection and live Pi manager', async t => {
  const { manager, record, state } = fixture(t), events = []
  const session = SessionManager.create(state, state)
  session.appendMessage({ role: 'user', content: [{ type: 'text', text: 'Inspect the saved branch.' }], timestamp: Date.now() })
  let projections = 0, observedManager
  const project = manager.projectHistory.bind(manager)
  manager.projectHistory = (record, given, options) => { projections++; observedManager = given; project(record, given, options) }
  manager.on('event', event => events.push(event))
  const adapter = simulationChatAdapter(manager)
  const update = { chatId: record.id, sessionFile: session.getSessionFile(), sessionManager: session, children: [], state: 'running' }
  await adapter.publishSession(update)
  await adapter.publishSession({ ...update, children: [{ id: 'worker', state: 'running' }] })
  await adapter.publishSession({ ...update, children: [{ id: 'worker', state: 'completed' }] })
  assert.equal(projections, 1)
  assert.equal(observedManager, session)
  session.appendMessage({ role: 'user', content: [{ type: 'text', text: 'Inspect another branch.' }], timestamp: Date.now() })
  await adapter.publishSession(update)
  assert.equal(projections, 2)
  await adapter.publishSession({ ...update, state: 'idle' })
  assert.equal(projections, 3, 'Terminal state must clear any pending tool status even if the file is unchanged')
  assert.ok(events.every(event => event.type === 'chat-summary'))
  assert.equal(events[1].children[0].id, 'worker')
  assert.equal(events[1].children[0].state, 'running')
  assert.equal(events[1].children[0].sessionFile, undefined)
  const saved = JSON.parse(readFileSync(join(manager.dir, record.id, 'chat.json'), 'utf8'))
  assert.deepEqual(saved.messages, [], 'Canonical Pi history is not duplicated into the metadata file')
  assert.equal(saved.sessionFile, session.getSessionFile())
  assert.equal(SessionManager.open(saved.sessionFile).getEntries().filter(entry => entry.type === 'message').length, 2)
  assert.equal(manager.record(record.id).messages.filter(message => message.role === 'user').length, 2)
})
