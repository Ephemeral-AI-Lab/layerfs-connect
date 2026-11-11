import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
let directory, chatRefresh, shareChildMessages, mergeChatDetail
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'connect-chat-refresh-'))
  for (const name of ['chat-refresh', 'chat-sharing']) {
    const source = await readFile(new URL(`../desktop/src/renderer/src/layerfs/${name}.ts`, import.meta.url), 'utf8')
    await writeFile(join(directory, `${name}.mjs`), ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText)
  }
  ;({ chatRefresh } = await import(pathToFileURL(join(directory, 'chat-refresh.mjs')).href))
  ;({ shareChildMessages, mergeChatDetail } = await import(pathToFileURL(join(directory, 'chat-sharing.mjs')).href))
})
after(async () => { await rm(directory, { recursive: true, force: true }) })
test('chat event bursts never overlap reads and coalesce a pending refresh', async () => {
  let release, began, second, calls = 0, active = 0, peak = 0
  const first = new Promise(resolve => { began = resolve }), next = new Promise(resolve => { second = resolve }), gate = new Promise(resolve => { release = resolve })
  const refresh = chatRefresh(async () => { calls++; peak = Math.max(peak, ++active); if (calls === 1) { began(); await gate } else second(); active-- }, 0)
  try {
    refresh.request(true); await first
    for (let i = 0; i < 50; i++) refresh.request()
    assert.equal(calls, 1)
    release(); await next
    assert.equal(calls, 2); assert.equal(peak, 1)
  } finally { release(); refresh.dispose() }
})
test('unchanged transcript rows retain identity while pending results and late trace receipts update', () => {
  const saved = { id: 'saved', role: 'tool', toolName: 'bash', status: 'done', text: 'saved', view: { calls: [{ id: 'call-saved', ok: true, ms: 12 }] } }
  const pending = { id: 'pending', role: 'tool', toolName: 'bash', status: 'running', text: '', view: { calls: [{ id: 'call-pending', ok: null, ms: null }] } }
  const before = [saved, pending]
  assert.equal(shareChildMessages(before, structuredClone(before)), before)
  const completed = shareChildMessages(before, [structuredClone(saved), { ...pending, status: 'done', text: 'receipt' }])
  assert.equal(completed[0], saved)
  assert.notEqual(completed[1], pending)
  const traced = shareChildMessages(completed, [structuredClone(saved), { ...completed[1], view: { calls: [{ id: 'call-pending', ok: true, ms: 80 }] } }])
  assert.equal(traced[0], saved)
  assert.notEqual(traced[1], completed[1])
  assert.equal(traced[1].view.calls[0].ok, true)
})

test('a newer summary preserves headers without starving a valid transcript response', () => {
  const previous = { id: 'chat', updated: 9, simulation: { id: 'run' }, state: 'running', children: [{ id: 'a', state: 'running' }], messages: [{ id: 'tool', role: 'tool', status: 'running', text: '' }] }
  const response = { ...previous, updated: 8, children: [], messages: [{ ...previous.messages[0], status: 'done', text: 'confirmed result' }] }
  const next = mergeChatDetail(previous, response, { session: { id: 'chat', updated: 10, state: 'idle' }, children: [{ id: 'a', state: 'completed' }] })
  assert.equal(next.updated, 10)
  assert.equal(next.state, 'idle')
  assert.equal(next.children[0].state, 'completed')
  assert.equal(next.messages[0].status, 'done')
  assert.equal(next.messages[0].text, 'confirmed result')
})
