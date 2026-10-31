import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test, { before } from 'node:test'
import ts from 'typescript'

let createHook

before(async () => {
  const readSource = async (path) => ts.createSourceFile(path, await readFile(new URL(path, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true)
  const source = await readSource('../src/renderer/src/components/live/live-data.ts')
  const format = await readSource('../src/renderer/src/components/live/run-format.ts')
  const named = (file, name) => file.statements.find((node) =>
    ts.isFunctionDeclaration(node) ? node.name?.text === name :
      ts.isVariableStatement(node) && node.declarationList.declarations.some((declaration) => declaration.name.getText(file) === name))
  // Read the real hook and its pure dependencies, keeping network and React under control.
  const text = [
    ...['EMPTY_LIVE', 'CALLS_MS', 'withAgents', 'useLiveSessions'].map((name) => named(source, name).getText(source)),
    named(format, 'isLive').getText(format),
  ].map((text) => text.replace(/^export\s+/, '')).join('\n')
  const code = ts.transpileModule(text, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText
  createHook = Function('useState', 'useRef', 'useEffect', 'useMemo', 'agentHost', 'setInterval', 'clearInterval', 'document', `${code}; return useLiveSessions`)
})

function sessions(t) {
  const hooks = []
  const effects = []
  const timers = new Map()
  const requests = []
  let cursor = 0
  let timerId = 0
  let writes = 0
  const useState = (initial) => {
    const index = cursor++
    const state = hooks[index] ?? (hooks[index] = { value: typeof initial === 'function' ? initial() : initial })
    return [state.value, (next) => { writes++; state.value = typeof next === 'function' ? next(state.value) : next }]
  }
  const useRef = (initial) => { const index = cursor++; return hooks[index] ?? (hooks[index] = { current: initial }) }
  const useEffect = (effect, deps) => {
    const index = cursor++
    const previous = hooks[index]
    if (!previous || deps.some((dependency, i) => dependency !== previous.deps[i])) {
      effects.push(() => {
        previous?.cleanup?.()
        hooks[index] = { deps, cleanup: effect() }
      })
    }
  }
  const useMemo = (factory) => { cursor++; return factory() }
  const useLiveSessions = createHook(useState, useRef, useEffect, useMemo, {
    live(id) {
      return new Promise((resolve, reject) => requests.push({ id, resolve, reject }))
    },
  }, (callback) => { const id = ++timerId; timers.set(id, callback); return id }, (id) => timers.delete(id), { hidden: false })
  const unmount = () => {
    for (const hook of hooks) if (hook?.cleanup) { hook.cleanup(); hook.cleanup = null }
  }
  t.after(unmount)
  return {
    requests, timers,
    get writes() { return writes },
    render(runs) {
      cursor = 0
      const result = useLiveSessions(runs)
      for (const effect of effects.splice(0)) effect()
      return result
    },
    tick() { for (const callback of timers.values()) callback() },
    unmount,
  }
}

const run = (state = 'running') => ({
  id: 'chat-1', demo: 'Review layout', state,
  agents: [{ name: 'root', parent: null, state: state === 'running' ? 'running' : 'done', done: 0, of: 0 }],
})
const answer = (ok) => ({
  calls: [{ id: 'call-1', agent: 'root', method: 'workspace.exec', ok }],
  live: { running: ok === null ? [{ id: 'call-1', agent: 'root', method: 'workspace.exec' }] : [], mounts: [], sandboxes: [], last: {} },
})
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }

test('ending during an in-flight read starts a final read and ignores the previous generation response', async (t) => {
  const view = sessions(t)
  view.render([run()])
  assert.equal(view.requests.length, 1)
  view.render([run('failed')])
  assert.equal(view.requests.length, 2)
  assert.equal(view.timers.size, 0)
  const writes = view.writes
  view.requests[0].resolve(answer(null))
  await flush()
  assert.equal(view.writes, writes)
  view.requests[1].resolve(answer(false))
  await flush()
  const result = view.render([run('failed')])
  assert.equal(result[0].calls[0].ok, false)
  assert.deepEqual(result[0].live.running, [])
})

test('polling deduplicates reads within one generation and resumes after each response', async (t) => {
  const view = sessions(t)
  view.render([run()])
  view.tick()
  view.tick()
  assert.equal(view.requests.length, 1)
  view.requests[0].resolve(answer(null))
  await flush()
  view.tick()
  assert.equal(view.requests.length, 2)
  view.tick()
  assert.equal(view.requests.length, 2)
  view.requests[1].reject(new Error('Read failed'))
  await flush()
  view.tick()
  assert.equal(view.requests.length, 3)
})

test('unmount stops polling and a late response does not write state', async (t) => {
  const view = sessions(t)
  view.render([run()])
  assert.equal(view.timers.size, 1)
  view.unmount()
  assert.equal(view.timers.size, 0)
  const writes = view.writes
  view.requests[0].resolve(answer(false))
  await flush()
  assert.equal(view.writes, writes)
  view.tick()
  assert.equal(view.requests.length, 1)
})
