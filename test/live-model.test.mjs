import assert from 'node:assert/strict'
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test, { after, before } from 'node:test'
import { build } from 'vite'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
let directory
let hubRows
let routeOf

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'connect-live-model-test-'))
  await symlink(join(root, 'node_modules'), join(directory, 'node_modules'), 'dir')
  const entry = join(directory, 'entry.mjs')
  await writeFile(entry, "export { hubRows, routeOf } from '@/components/live/live-model'")
  // Use the real model and prefix matcher; replace only the browser language store.
  const result = await build({
    configFile: false,
    root,
    logLevel: 'silent',
    resolve: { alias: [
      { find: '@/i18n', replacement: 'virtual:live-model-test-i18n' },
      { find: '@', replacement: join(root, 'src/renderer/src') },
    ] },
    plugins: [{
      name: 'live-model-test-i18n',
      resolveId(id) { if (id === 'virtual:live-model-test-i18n') return `\0${id}` },
      load(id) {
        if (id === '\0virtual:live-model-test-i18n') return `
          export const t = text => text
          export const localeTag = () => 'en-US'
          export const getLocale = () => 'en'
          export const useI18n = () => ({ t })
        `
      },
    }],
    build: {
      ssr: entry,
      write: false,
      minify: false,
      rolldownOptions: { output: { format: 'es', codeSplitting: false } },
    },
  })
  const module = result.output.find((file) => file.type === 'chunk' && file.isEntry)
  const compiled = join(directory, 'model.mjs')
  await writeFile(compiled, module.code)
  ;({ hubRows, routeOf } = await import(pathToFileURL(compiled).href))
})

after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

const branch = (name, state = 'open') => ({ name, state, head: null, parent: 'main', forkedFrom: null, commits: 1 })
const mount = (branch) => ({ branch, sandbox: 'box-1', path: '/workspace', agent: 'root', since: 1, commits: 0, last: null })
const call = (branch, extra = {}) => ({ id: 'call-1', agent: 'root', method: 'branch.commit', branch, ...extra })
const group = (id, name, { mounts = [], running = [], calls = [] } = {}) => ({
  name,
  session: { run: { id, state: 'running' }, live: { mounts, running, sandboxes: [], last: {} }, calls },
})
const rowsOf = (rows) => rows.runs.map(({ group, rows }) => ({ id: group.session.run.id, rows: rows.map(({ branch, name }) => [branch.name, name]) }))

test('ordinary chat mounts expose arbitrary branch names and route workspace calls through them', () => {
  const chat = group('chat-1', '优化布局', { mounts: [mount('layout-polish')] })
  const rows = hubRows({ branches: [branch('main'), branch('layout-polish')] }, [chat])
  assert.deepEqual(rowsOf(rows), [{ id: 'chat-1', rows: [['layout-polish', 'layout-polish']] }])
  assert.equal(rows.others, 0)
  assert.deepEqual(routeOf(chat, call(null, { method: 'workspace.exec', sandbox: 'box-1', path: '/workspace' }), rows.names, new Set(['box-1:/workspace'])), {
    agent: 'chat-1/root', via: 'branch-layout-polish', to: 'ws-box-1:/workspace',
  })
})

test('in-flight and completed calls retain branches before mounting and after unmounting', () => {
  const chat = group('chat-1', 'Improve layout', {
    running: [call('layout-running')],
    calls: [call('layout-finished')],
  })
  const rows = hubRows({ branches: [branch('layout-running'), branch('layout-finished')] }, [chat])
  assert.deepEqual([...rows.names], ['layout-running', 'layout-finished'])
  for (const branch of rows.names) assert.equal(routeOf(chat, call(branch), rows.names, new Set()).via, `branch-${branch}`)
})

test('same-title chats retain separate branch groups in displayed session order', () => {
  const first = group('chat-1', 'New chat', { mounts: [mount('layout')] })
  const second = group('chat-2', 'New chat', { calls: [call('tests')] })
  const rows = hubRows({ branches: [branch('tests'), branch('layout')] }, [first, second])
  assert.deepEqual(rowsOf(rows), [
    { id: 'chat-1', rows: [['layout', 'layout']] },
    { id: 'chat-2', rows: [['tests', 'tests']] },
  ])
})

test('shared branches have one anchor and remain routable by every session', () => {
  const first = group('chat-1', 'First', { mounts: [mount('shared')], running: [call('shared')], calls: [call('shared')] })
  const second = group('chat-2', 'Second', { mounts: [mount('shared')] })
  const rows = hubRows({ branches: [branch('shared')] }, [first, second])
  assert.deepEqual(rowsOf(rows), [{ id: 'chat-1', rows: [['shared', 'shared']] }])
  assert.equal(rows.others, 0)
  for (const chat of [first, second]) assert.equal(routeOf(chat, call('shared'), rows.names, new Set()).via, 'branch-shared')
})

test('scenario prefixes preserve ownership, local labels and deduplication across replays', () => {
  const chat = group('chat-1', 'Review', { calls: [call('crew_2.feature')] })
  const current = group('scenario-new', 'crew_2')
  const previous = group('scenario-old', 'crew_2')
  const rows = hubRows({ branches: [branch('crew_2.main'), branch('crew_2.feature')] }, [chat, current, previous])
  assert.deepEqual(rowsOf(rows), [{ id: 'scenario-new', rows: [['crew_2.main', 'main'], ['crew_2.feature', 'feature']] }])
  assert.equal(routeOf(chat, call('crew_2.feature'), rows.names, new Set()).via, 'branch-crew_2.feature')
})

test('main stays unique; unrelated, closed and unavailable branches do not invent nodes or mutate input', () => {
  const chat = group('chat-1', 'Improve layout', {
    mounts: [mount('main')],
    calls: [call('merged'), call('unavailable'), call(null)],
  })
  const state = { branches: [branch('main'), branch('unrelated'), branch('merged', 'merged')] }
  const before = structuredClone({ state, chat })
  const rows = hubRows(state, [chat])
  assert.equal(rows.main, state.branches[0])
  assert.deepEqual(rows.runs, [])
  assert.equal(rows.others, 1)
  assert.deepEqual([...rows.names], ['main'])
  assert.equal(routeOf(chat, call('main'), rows.names, new Set()).via, 'branch-main')
  assert.equal(routeOf(chat, call('merged'), rows.names, new Set()).via, null)
  assert.deepEqual({ state, chat }, before)
  assert.deepEqual([...hubRows(undefined, [chat]).names], [])
})
