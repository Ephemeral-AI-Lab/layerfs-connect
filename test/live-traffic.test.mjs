import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test, { before } from 'node:test'
import ts from 'typescript'

let createHook

before(async () => {
  const file = new URL('../src/renderer/src/components/live/live-tab.tsx', import.meta.url)
  const source = ts.createSourceFile(file.pathname, await readFile(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const hook = source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'useTraffic')
  const code = ts.transpileModule(hook.getText(source), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText
  // Execute the actual hook; geometry is covered by live-model/live-flow tests.
  createHook = Function('useRef', 'useEffect', 'routeOf', 'OK_CLASS', 'FAIL_CLASS', 'FRESH_MS', `${code}; return useTraffic`)
})

function traffic() {
  const refs = []
  let cursor = 0
  const sent = []
  const engine = { current: { send: (route, options = {}) => { sent.push({ route, ...options }); return Promise.resolve() } } }
  const useTraffic = createHook(
    (initial) => { const index = cursor++; return refs[index] ?? (refs[index] = { current: initial }) },
    (effect) => effect(),
    (group, call) => ({ agent: `${group.session.run.id}/${call.agent}`, via: `branch-${call.branch}`, to: null }),
    'success', 'failure', 5000,
  )
  return {
    sent,
    async render(calls, running = []) {
      cursor = 0
      useTraffic(engine, [{ session: { run: { id: 'chat-1' }, calls, live: { running } } }], new Set(['layout']), new Set())
      await Promise.resolve()
      await Promise.resolve()
    },
  }
}

const call = (id, ok, agent = 'root') => ({
  id, ok, agent, method: 'workspace.exec', branch: 'layout',
  start: new Date().toISOString(), ms: ok === null ? null : 5,
})

test('an unfinished trace sends no success and its eventual failure returns exactly once', async () => {
  const view = traffic()
  const started = call('first', null)
  await view.render([])
  await view.render([started], [started])
  await view.render([started], [started])
  assert.equal(view.sent.length, 1)
  assert.equal(view.sent[0].back, undefined)
  const failed = { ...started, ok: false, ms: 30 }
  await view.render([failed])
  assert.equal(view.sent.length, 2)
  assert.equal(view.sent[1].back, true)
  assert.equal(view.sent[1].color, 'failure')
  await view.render([failed])
  assert.equal(view.sent.length, 2)
})

test('opening during a call skips its departure but still shows the actual completion', async () => {
  const view = traffic()
  const started = call('already-running', null)
  await view.render([started], [started])
  assert.equal(view.sent.length, 0)
  await view.render([{ ...started, ok: false, ms: 20 }])
  assert.equal(view.sent.length, 1)
  assert.equal(view.sent[0].back, true)
  assert.equal(view.sent[0].color, 'failure')
})

test('fast completed calls animate the correct result and repeated snapshots do not replay them', async () => {
  const view = traffic()
  await view.render([])
  const calls = [call('fast-success', true), call('fast-failure', false)]
  await view.render(calls)
  assert.equal(view.sent.filter((send) => !send.back).length, 2)
  assert.deepEqual(view.sent.filter((send) => send.back).map((send) => send.color), ['success', 'failure'])
  await view.render(calls)
  assert.equal(view.sent.length, 4)
})

test('historical results stay quiet and call identifiers are distinct for each agent', async () => {
  const view = traffic()
  const history = call('history', true)
  await view.render([history])
  assert.equal(view.sent.length, 0)
  await view.render([history, call('shared-id', true, 'root'), call('shared-id', false, 'reviewer')])
  assert.deepEqual(view.sent.filter((send) => send.back).map((send) => [send.route.agent, send.color]), [
    ['chat-1/root', 'success'], ['chat-1/reviewer', 'failure'],
  ])
})
