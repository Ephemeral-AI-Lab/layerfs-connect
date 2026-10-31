import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import test, { after, before } from 'node:test'
import ts from 'typescript'

let directory
let withoutSession

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'connect-tabs-test-'))
  const source = await readFile(new URL('../src/renderer/src/components/tabs/use-tabs.ts', import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source.replace("from 'react'", `from '${import.meta.resolve('react')}'`), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const file = join(directory, 'use-tabs.mjs')
  await writeFile(file, compiled)
  ;({ withoutSession } = await import(pathToFileURL(file).href))
})

after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

const chat = (session) => ({ kind: 'nav', id: 'chat', session })
const place = (session) => ({ selected: chat(session), label: session })

test('deleting a chat closes all its tabs, including a chat intent not yet reported by the page', () => {
  const other = { id: 'other', selected: chat('keep') }
  const tabs = [
    { id: 'a', selected: chat('delete') },
    { id: 'b', selected: chat('delete'), chat: { id: 1, session: 'keep' } },
    { id: 'c', selected: chat(), chat: { id: 2, session: 'delete' } },
    other,
  ]
  assert.deepEqual(withoutSession(tabs, 'delete'), [other])
})

test('the visible conversation takes precedence over its stale opening intent', () => {
  const tab = { id: 'keep', selected: chat('keep'), chat: { id: 10, session: 'delete', project: 'studio' } }
  const [kept] = withoutSession([tab], 'delete')
  assert.equal(kept.id, tab.id)
  assert.equal(kept.selected, tab.selected)
  assert.deepEqual(kept.chat, { id: 10, session: undefined, project: 'studio' })
  assert.equal(tab.chat.session, 'delete')
})

test('Back and Forward skip the deleted conversation without changing the remaining order or labels', () => {
  const first = place('first')
  const previous = { selected: { kind: 'project', id: 'delete' }, location: { tab: 'files' }, label: 'Project' }
  const last = place('last')
  const tab = { id: 'storage', selected: { kind: 'nav', id: 'storage' }, back: [first, place('delete'), previous, place('delete')], forward: [place('delete'), last] }
  const original = structuredClone(tab)
  const [kept] = withoutSession([tab], 'delete')
  assert.deepEqual(kept.back, [first, previous])
  assert.deepEqual(kept.forward, [last])
  assert.equal(kept.back[0], first)
  assert.equal(kept.forward[0], last)
  assert.deepEqual(tab, original)
})

test('history with only the deleted conversation no longer offers Back or Forward', () => {
  const [kept] = withoutSession([{ id: 'keep', selected: chat('keep'), back: [place('delete')], forward: [place('delete')] }], 'delete')
  assert.equal(kept.back, undefined)
  assert.equal(kept.forward, undefined)
})

test('recently closed targets cannot reopen the deleted chat and preserve remaining restore order', () => {
  const first = { selected: { kind: 'nav', id: 'storage' } }
  const last = { selected: chat('keep') }
  const restored = withoutSession([first, place('delete'), { selected: chat(), chat: { id: 1, session: 'delete' } }, last], 'delete')
  assert.equal(restored.pop(), last)
  assert.equal(restored.pop(), first)
  assert.equal(restored.pop(), undefined)
})

test('unrelated tabs retain their identity and navigation state', () => {
  const project = { id: 'project', selected: { kind: 'project', id: 'delete' }, location: { tab: 'history', branch: 'main' } }
  const fresh = { id: 'fresh', selected: chat(), chat: { id: 2, fresh: true } }
  const other = { id: 'other', selected: chat('keep'), back: [place('previous')], forward: [] }
  const tabs = [project, fresh, other]
  const kept = withoutSession(tabs, 'delete')
  assert.equal(kept.length, 3)
  kept.forEach((tab, index) => assert.equal(tab, tabs[index]))
})
