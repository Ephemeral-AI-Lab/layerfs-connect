import assert from 'node:assert/strict'
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test, { after, before } from 'node:test'
import { build } from 'vite'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
let directory
let withAgents
let layoutGroup
let routeOf

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'connect-live-data-test-'))
  await symlink(join(root, 'node_modules'), join(directory, 'node_modules'), 'dir')
  const entry = join(directory, 'entry.mjs')
  await writeFile(entry, "export { withAgents } from '@/components/live/live-data'; export { layoutGroup, routeOf } from '@/components/live/live-model'")
  const result = await build({
    configFile: false,
    root,
    logLevel: 'silent',
    resolve: { alias: [
      { find: '@/i18n', replacement: 'virtual:live-data-test-i18n' },
      { find: '@', replacement: join(root, 'src/renderer/src') },
    ] },
    plugins: [{
      name: 'live-data-test-i18n',
      resolveId(id) { if (id === 'virtual:live-data-test-i18n') return `\0${id}` },
      load(id) {
        if (id === '\0virtual:live-data-test-i18n') return `
          export const t = text => text
          export const localeTag = () => 'en-US'
          export const getLocale = () => 'en'
          export const useI18n = () => ({ t })
        `
      },
    }],
    build: { ssr: entry, write: false, minify: false, rolldownOptions: { output: { format: 'es', codeSplitting: false } } },
  })
  const module = result.output.find((file) => file.type === 'chunk' && file.isEntry)
  const compiled = join(directory, 'data.mjs')
  await writeFile(compiled, module.code)
  ;({ withAgents, layoutGroup, routeOf } = await import(pathToFileURL(compiled).href))
})

after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

const run = (state = 'running') => ({
  id: 'chat-1', kind: 'live', demo: 'Review layout', project: 'studio', folder: null, replay: null,
  state, started: 1, ended: state === 'running' ? null : 20, error: null, done: 3, of: 6, phase: null,
  agents: [{ name: 'root', parent: null, state: state === 'running' ? 'running' : 'failed', done: 3, of: 6 }],
})
const runningCall = (agent) => ({ id: `call-${agent}`, agent, method: 'workspace.exec', branch: 'review', sandbox: 'box-1', path: '/workspace', command: 'pnpm test', start: 10 })

test('a subagent first seen in an in-flight call immediately has a visible route origin', () => {
  const original = run()
  const running = [runningCall('reviewer')]
  const enriched = withAgents(original, [], running)
  const group = { name: 'Review layout', session: { run: enriched, calls: [], live: { running, mounts: [], sandboxes: [], last: {} } } }
  const layout = layoutGroup(group, {}, 0, false)
  const route = routeOf(group, running[0], new Set(['review']), new Set(['box-1:/workspace']))
  const node = layout.nodes.find((node) => node.agent.name === 'reviewer')
  assert.ok(node?.visible)
  assert.equal(node.parent, 'root')
  assert.equal(layout.origin('reviewer'), `agent-${route.agent}`)
  assert.equal(node.key, route.agent)
  assert.equal(enriched.agents[0], original.agents[0])
  assert.equal(enriched.agents[1].state, 'running')
})

test('completed and in-flight calls share one node per agent and preserve existing order', () => {
  const original = run()
  const calls = [{ ...runningCall('reviewer'), ok: true }, { ...runningCall('root'), ok: true }]
  const running = [runningCall('reviewer'), runningCall('builder'), runningCall('root')]
  const before = structuredClone({ original, calls, running })
  assert.deepEqual(withAgents(original, calls, running).agents.map((agent) => agent.name), ['root', 'reviewer', 'builder'])
  assert.deepEqual({ original, calls, running }, before)
})

test('adding names does not change existing root or ended-run state rules', () => {
  for (const state of ['passed', 'failed', 'stopped']) {
    const original = run(state)
    const result = withAgents(original, [], [runningCall('reviewer')])
    assert.equal(result.state, state)
    assert.equal(result.agents[0], original.agents[0])
    assert.equal(result.agents[1].state, 'done')
  }
  const original = run()
  assert.equal(withAgents(original, [], []), original)
  assert.equal(withAgents(original, [], [runningCall('root')]), original)
})
