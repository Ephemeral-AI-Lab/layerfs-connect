import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import test, { after, before, beforeEach } from 'node:test'
import ts from 'typescript'

let directory, host, react, api, sessions, drafts
const local = new Map(), stored = new Map(), pendingReads = []
let failWrites = false
const tick = () => new Promise((resolve) => setImmediate(resolve))
const draftValue = { text: 'Unsent draft', attachments: [{ id: 'image', data: 'attachment' }], limits: { maxRetries: 2, bashTimeoutSeconds: 900, instructions: 'Draft instructions' } }
const draftStorageKey = (id) => `connect.agent.draft.session:${id}`

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'connect-chat-removal-test-'))
  // Control the network and persistence boundaries while executing the real client/hooks.
  await writeFile(join(directory, 'host.mjs'), `
    export const requests = [];
    const listeners = new Set();
    export const call = (method, path) => new Promise((resolve, reject) => requests.push({ method, path, resolve, reject }));
    export function onHostEvent(listener) { listeners.add(listener); return () => listeners.delete(listener); }
    export function emit(event) { for (const listener of listeners) listener(event); }
  `)
  await writeFile(join(directory, 'react.mjs'), `
    export const states = []; const effects = [];
    export const useRef = value => ({ current: value });
    export function useState(value) {
      const index = states.length; states.push(value);
      return [value, next => { states[index] = typeof next === 'function' ? next(states[index]) : next; }];
    }
    export const useEffect = effect => effects.push(effect);
    export const mount = () => effects.splice(0).map(effect => effect()).filter(Boolean);
    export function reset() { states.length = 0; effects.length = 0; }
  `)
  for (const [name, relative] of [
    ['agent', 'host/agent-client.ts'],
    ['sessions', 'host/use-chat-sessions.ts'],
    ['drafts', 'components/chat/chat-drafts.ts'],
  ]) {
    const source = (await readFile(new URL(`../src/renderer/src/${relative}`, import.meta.url), 'utf8'))
      .replaceAll("'@/host/client'", "'./host.mjs'")
      .replaceAll("'@/host/agent-client'", "'./agent.mjs'")
      .replaceAll("'react'", "'./react.mjs'")
    await writeFile(join(directory, `${name}.mjs`), ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText)
  }
  const load = (name) => import(pathToFileURL(join(directory, `${name}.mjs`)).href)
  ;[host, react, api, sessions, drafts] = await Promise.all(['host', 'react', 'agent', 'sessions', 'drafts'].map(load))
  globalThis.localStorage = { getItem: key => local.get(key) ?? null, setItem: (key, value) => local.set(key, value), removeItem: key => local.delete(key) }
  globalThis.window = { addEventListener() {}, removeEventListener() {} }
  globalThis.indexedDB = { open() {
    const request = {}
    queueMicrotask(() => {
      request.result = { transaction(_name, mode) {
        const failed = failWrites
        const transaction = { objectStore: () => ({
          get(key) {
            const read = {}, snapshot = structuredClone(stored.get(key))
            pendingReads.push(() => { read.result = snapshot; read.onsuccess?.() })
            return read
          },
          put(value, key) { if (!failed) stored.set(key, structuredClone(value)) },
          delete(key) { if (!failed) stored.delete(key) },
        }) }
        if (mode === 'readwrite') queueMicrotask(() => {
          if (failed) { transaction.error = new Error('Storage unavailable'); transaction.onerror?.() }
          else transaction.oncomplete?.()
        })
        return transaction
      } }
      request.onsuccess?.()
    })
    return request
  } }
})

beforeEach(() => {
  local.clear(); stored.clear(); pendingReads.length = 0; host.requests.length = 0
  failWrites = false
  react.reset()
})

after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

test('failed deletions preserve the conversation and do not notify subscribers', async () => {
  const events = [], off = api.onChatRemoved((id) => events.push(id))
  local.set('connect.agent.last-session', 'failed')
  const request = api.agentHost.remove('failed')
  host.requests.shift().reject(new Error('Subagent stop failed'))
  await assert.rejects(request, /Subagent stop failed/)
  assert.equal(api.isChatRemoved('failed'), false)
  assert.equal(local.get('connect.agent.last-session'), 'failed')
  assert.deepEqual(events, [])
  off()
})

test('successful deletion notifies once, clears the matching last session and filters an older list response', async () => {
  const events = [], off = api.onChatRemoved((id) => { assert.equal(api.isChatRemoved(id), true); events.push(id) })
  const list = api.agentHost.sessions(), listRequest = host.requests.shift()
  local.set('connect.agent.last-session', 'gone')
  const deletion = api.agentHost.remove('gone'), request = host.requests.shift()
  assert.equal(request.method, 'DELETE')
  request.resolve({ id: 'gone' })
  assert.deepEqual(await deletion, { id: 'gone' })
  assert.equal(local.has('connect.agent.last-session'), false)
  assert.deepEqual(events, ['gone'])
  listRequest.resolve([{ id: 'gone' }, { id: 'keep' }])
  assert.deepEqual(await list, [{ id: 'keep' }])
  off()
  local.set('connect.agent.last-session', 'keep')
  const another = api.agentHost.remove('another')
  host.requests.shift().resolve({ id: 'another' }); await another
  assert.deepEqual(events, ['gone'])
  assert.equal(local.get('connect.agent.last-session'), 'keep')
})

test('session lists remove the chat immediately and ignore delayed chat events', async () => {
  sessions.useChatSessions()
  const cleanup = react.mount()
  host.requests.shift().resolve([{ id: 'visible', updated: 1 }, { id: 'remove-row', updated: 1 }])
  await tick()
  const deletion = api.agentHost.remove('remove-row')
  host.requests.shift().resolve({ id: 'remove-row' }); await deletion
  assert.deepEqual(react.states[0].map(item => item.id), ['visible'])
  host.emit({ type: 'chat', session: { id: 'remove-row', updated: 9 } })
  assert.deepEqual(react.states[0].map(item => item.id), ['visible'])
  host.emit({ type: 'chat', session: { id: 'visible', updated: 2, title: 'Updated' } })
  assert.equal(react.states[0][0].title, 'Updated')
  cleanup.forEach(dispose => dispose())
})

test('discard removes text, attachments and limits even without a mounted chat', async () => {
  const key = drafts.sessionDraftKey('unmounted')
  stored.set(key, draftValue); local.set(draftStorageKey('unmounted'), JSON.stringify(draftValue))
  stored.set(drafts.sessionDraftKey('untouched'), draftValue)
  await drafts.discardSessionDraft('unmounted')
  assert.equal(stored.has(key), false)
  assert.equal(local.has(draftStorageKey('unmounted')), false)
  assert.deepEqual(stored.get(drafts.sessionDraftKey('untouched')), draftValue)
  const reopened = drafts.useChatDraft(key)
  assert.deepEqual(reopened.snapshot(), { text: '', attachments: [] })
  reopened.setInput('Late edit')
  assert.deepEqual(reopened.snapshot(), { text: '', attachments: [] })
})

test('in-flight hydration, delayed saves and unmount cleanup cannot restore a discarded draft', async () => {
  const key = drafts.sessionDraftKey('pending')
  stored.set(key, draftValue); local.set(draftStorageKey('pending'), JSON.stringify(draftValue))
  const draft = drafts.useChatDraft(key), cleanup = react.mount()
  draft.setInput('Pending edit')
  draft.open(drafts.newDraftKey('', '/preview'))
  await tick()
  assert.ok(pendingReads.length > 0)
  await drafts.discardSessionDraft('pending')
  pendingReads.splice(0).forEach(resolve => resolve())
  await tick()
  cleanup.forEach(dispose => dispose())
  await tick()
  assert.equal(stored.has(key), false)
  assert.equal(local.has(draftStorageKey('pending')), false)
})

test('draft storage failure cannot reject cleanup after a successful host deletion', async () => {
  failWrites = true
  await assert.doesNotReject(drafts.discardSessionDraft('storage-failure'))
})
