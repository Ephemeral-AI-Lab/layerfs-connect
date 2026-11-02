import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import test, { after, before } from 'node:test'
import ts from 'typescript'

let directory
let groupConversationTasks
let canCollapseLatestTask

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'connect-conversation-tasks-test-'))
  const source = await readFile(new URL('../src/renderer/src/lib/conversation-tasks.ts', import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const file = join(directory, 'conversation-tasks.mjs')
  await writeFile(file, compiled)
  ;({ groupConversationTasks, canCollapseLatestTask } = await import(pathToFileURL(file).href))
})

after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

const user = (id, text = 'Please update the layout') => ({ id, entryId: `entry-${id}`, role: 'user', text })
const assistant = (id, text = 'The task is complete.', extra = {}) => ({ id, entryId: `entry-${id}`, role: 'assistant', text, status: 'done', ...extra })
const tool = (id, status = 'done') => ({ id, role: 'tool', text: 'Command output', toolName: 'bash', status })
const ids = (group) => group.messages.map((message) => message.id)
const task = (groups, id) => groups.find((group) => group.messages.some((message) => message.id === id))

function session(overrides = {}) {
  return {
    id: 'chat-1', title: 'Layout', cwd: '/preview', project: null, workspace: null,
    created: 1, updated: 2, state: 'idle', provider: null, modelId: null,
    thinkingLevel: 'off', permissionMode: 'full', error: null,
    execution: { phase: 'idle', startedAt: 1, turns: 2, toolCalls: 1, retryAttempt: 0 },
    messages: [user('u1'), assistant('a1')], queued: [], tools: [], children: [], approvals: [],
    contextUsage: null, recovery: { required: false, canContinue: true },
    ...overrides,
  }
}

test('empty transcripts and context before the first user never become completed tasks', () => {
  assert.deepEqual(groupConversationTasks([], true), [])
  const context = [assistant('summary', 'Earlier context', { details: { kind: 'compactionSummary' } }), assistant('orphan')]
  assert.ok(groupConversationTasks(context, true).every((group) => !group.completed))
  const messages = [...context, user('u1'), assistant('a1')]
  const groups = groupConversationTasks(messages, true)
  assert.deepEqual(groups.flatMap((group) => group.messages), messages)
  assert.equal(task(groups, 'orphan').completed, false)
  assert.deepEqual(ids(task(groups, 'u1')), ['u1', 'a1'])
  assert.equal(task(groups, 'u1').completed, true)
})

test('a latest final reply folds only after the session is complete', () => {
  const messages = [user('u1'), assistant('a1')]
  assert.equal(groupConversationTasks(messages, false)[0].completed, false)
  assert.equal(groupConversationTasks(messages, true)[0].completed, true)
})

test('a consumed follow-up starts a new task and keeps the previous final reply complete', () => {
  const messages = [user('u1'), assistant('a1'), user('u2'), assistant('thinking', '', { thinking: 'Checking the request' }), tool('call')]
  const groups = groupConversationTasks(messages, false)
  assert.deepEqual(groups.map(ids), [['u1', 'a1'], ['u2', 'thinking', 'call']])
  assert.deepEqual(groups.map((group) => group.completed), [true, false])
})

test('steering after a tool call stays with the unfinished task even if its preceding assistant contains text', () => {
  const messages = [user('u1'), assistant('progress', 'I will inspect the files.'), tool('call'), user('steer', 'Use the existing colors'), assistant('final')]
  const groups = groupConversationTasks(messages, true)
  assert.equal(groups.length, 1)
  assert.deepEqual(ids(groups[0]), messages.map((message) => message.id))
  assert.equal(groups[0].completed, true)
})

test('consecutive user messages stay together until there is a final assistant reply', () => {
  const messages = [user('u1'), user('u2', 'One more requirement'), assistant('a1')]
  assert.equal(groupConversationTasks(messages, true).length, 1)
})

test('empty, streaming, failed and context-summary assistant rows cannot end a task', () => {
  for (const ending of [
    assistant('ending', ''),
    assistant('ending', ' \n '),
    assistant('ending', '', { thinking: 'Still thinking' }),
    assistant('ending', 'Partial reply', { status: 'running' }),
    assistant('ending', 'Request failed', { status: 'error' }),
    assistant('ending', 'Custom extension notice', { status: undefined }),
    assistant('ending', 'Context summary', { details: { kind: 'compactionSummary' } }),
    assistant('ending', 'Branch summary', { details: { kind: 'branchSummary' } }),
  ]) {
    const incomplete = [user('u1'), ending]
    assert.equal(groupConversationTasks(incomplete, true)[0].completed, false, JSON.stringify(ending))
    const retried = [...incomplete, user('u2', 'Continue'), assistant('final')]
    assert.equal(groupConversationTasks(retried, true).length, 1, JSON.stringify(ending))
  }
})

test('failed tools and a retried response may fold after a successful final reply', () => {
  const messages = [user('u1'), tool('failed-call', 'error'), assistant('failure', 'Request failed', { status: 'error' }), user('retry', 'Try again'), tool('successful-call'), assistant('final')]
  const groups = groupConversationTasks(messages, true)
  assert.equal(groups.length, 1)
  assert.equal(groups[0].completed, true)
})

test('continuing without another user entry keeps the original task identity', () => {
  const initial = [user('u1'), assistant('failure', 'Interrupted', { status: 'error' })]
  const original = groupConversationTasks(initial, false)[0]
  const continued = groupConversationTasks([...initial, tool('resumed-call'), assistant('final')], true)
  assert.equal(continued.length, 1)
  assert.equal(continued[0].id, original.id)
  assert.equal(continued[0].completed, true)
})

test('identical prompts with distinct entry ids remain separate completed tasks', () => {
  const groups = groupConversationTasks([user('u1', 'Again'), assistant('a1'), user('u2', 'Again'), assistant('a2')], true)
  assert.equal(groups.length, 2)
  assert.notEqual(groups[0].id, groups[1].id)
  assert.ok(groups.every((group) => group.completed))
})

test('rollback prefixes preserve retained task ids and drop removed replies', () => {
  const messages = [user('u1'), assistant('a1'), user('u2'), assistant('a2')]
  const complete = groupConversationTasks(messages, true)
  const shortened = groupConversationTasks(messages.slice(0, 3), false)
  assert.deepEqual(shortened.map((group) => group.id), complete.map((group) => group.id))
  assert.deepEqual(shortened.map((group) => group.completed), [true, false])
  assert.deepEqual(shortened.flatMap(ids), ['u1', 'a1', 'u2'])
  assert.equal(groupConversationTasks(messages.slice(0, 2), true)[0].id, complete[0].id)
})

test('grouping keeps the source message order and does not mutate frozen messages', () => {
  const messages = [user('u1'), assistant('a1'), user('u2'), tool('call'), assistant('a2')]
  const original = structuredClone(messages)
  messages.forEach(Object.freeze)
  Object.freeze(messages)
  const groups = groupConversationTasks(messages, true)
  assert.deepEqual(messages, original)
  assert.deepEqual(groups.flatMap((group) => group.messages), original)
})

test('idle sessions, including older records without execution metadata, can complete', () => {
  assert.equal(canCollapseLatestTask(session()), true)
  assert.equal(canCollapseLatestTask(session({ execution: undefined, recovery: undefined })), true)
  assert.equal(canCollapseLatestTask(session({ workspace: { state: 'ready' } })), true)
  assert.equal(canCollapseLatestTask(session({ workspace: { state: 'closed' } })), true)
})

test('running, failed, stopped, interrupted and retrying sessions cannot complete', () => {
  for (const state of ['running', 'error']) assert.equal(canCollapseLatestTask(session({ state })), false, state)
  for (const phase of ['preparing', 'thinking', 'tool', 'approval', 'children', 'retrying', 'compacting', 'stopping', 'interrupted', 'error']) {
    assert.equal(canCollapseLatestTask(session({ execution: { phase } })), false, phase)
  }
  assert.equal(canCollapseLatestTask(session({ error: 'Request failed' })), false)
  assert.equal(canCollapseLatestTask(session({ recovery: { required: true, canContinue: true } })), false)
})

test('pending follow-ups and steering prevent latest-task collapse until drained', () => {
  for (const mode of ['followUp', 'steer']) {
    const pending = session({ queued: [{ id: 'queue-1', text: 'Next request', mode }] })
    assert.equal(canCollapseLatestTask(pending), false, mode)
    assert.equal(groupConversationTasks(pending.messages, canCollapseLatestTask(pending))[0].completed, false, mode)
  }
})

test('active child agents prevent folding even after the parent becomes idle', () => {
  for (const state of ['pending', 'running', 'queued', 'paused']) {
    assert.equal(canCollapseLatestTask(session({ children: [{ id: 'worker-1', agent: 'reviewer', state }] })), false, state)
  }
  for (const state of ['completed', 'failed', 'stopped']) {
    assert.equal(canCollapseLatestTask(session({ children: [{ id: 'worker-1', agent: 'reviewer', state }] })), true, state)
  }
})

test('unresolved approvals and unsettled workspace operations prevent folding', () => {
  for (const status of ['pending', 'reviewing']) {
    assert.equal(canCollapseLatestTask(session({ approvals: [{ id: 'approval-1', status }] })), false, status)
  }
  for (const status of ['approved', 'rejected', 'cancelled']) {
    assert.equal(canCollapseLatestTask(session({ approvals: [{ id: 'approval-1', status }] })), true, status)
  }
  for (const state of ['pending', 'preparing', 'running', 'saving', 'error']) {
    assert.equal(canCollapseLatestTask(session({ workspace: { state } })), false, state)
  }
})
