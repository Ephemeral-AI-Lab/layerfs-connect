// Where each LayerFS call sits in its command: segments' `at`.
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { segments, stepView } from '../parse/index.js'

const SCENARIOS = join(import.meta.dirname, '..', '..', 'scenarios')

const at = (command) => segments(command).flatMap((s) => s.at ?? [])
const spanned = (command) => {
  const lines = command.split('\n')
  return at(command).map((a) => [a.call, lines[a.line - 1].slice(...a.cols)])
}

test('cli calls: every one on a line, with its words', () => {
  assert.deepEqual(spanned('layerfs branch fork a && layerfs workspace mount a /w'), [
    ['branch.fork', 'layerfs branch fork'],
    ['workspace.mount', 'layerfs workspace mount'],
  ])
  assert.deepEqual(spanned('# fork it\nb=$(layerfs --text branch fork x)'), [['branch.fork', 'layerfs --text branch fork']])
  assert.deepEqual(spanned('layerfs init demo'), [['project.init', 'layerfs init']])
})

test('sdk calls: the callee to its paren, not a comment that names it', () => {
  const command = [
    '# one fs edit, one Commit',
    "node --input-type=module <<'JS'",
    'const { LayerFS } = await import("@layerfs/agent");',
    'const lf = await LayerFS.open(process.env.LAYERFS_PROJECT);',
    'try {',
    '  const r = await lf.fs.edit("main", "/a", "x", "y");',
    '  await lf.branch.publish("main");',
    '} finally {',
    '  await lf.close();',
    '}',
    'JS',
  ].join('\n')
  assert.deepEqual(spanned(command), [
    ['fs.edit', 'lf.fs.edit('],
    ['branch.publish', 'lf.branch.publish('],
  ])
  assert.deepEqual(at(command).map((a) => a.line), [6, 7])
})

test('a command ending in blank lines keeps every line', () => {
  assert.deepEqual(segments('layerfs branch fork a\n\n\n').map((s) => s.lines), [[1, 3]])
})

test('every call segment of every scenario places its calls inside its lines', () => {
  let placed = 0
  for (const dir of readdirSync(SCENARIOS)) {
    const file = join(SCENARIOS, dir, 'scenario.json')
    if (!existsSync(file)) continue
    const s = JSON.parse(readFileSync(file, 'utf8'))
    const agents = s.sessions ? Object.values(s.sessions).flatMap((x) => Object.entries(x.agents)) : Object.entries(s.agents)
    for (const [agent, list] of agents) {
      list.forEach((step, index) => {
        if (!step.bash) return
        const view = stepView(step, index, agent)
        const lines = view.text.split('\n')
        for (const seg of view.segments) {
          if (!seg.call) continue
          assert.ok(seg.at?.length, `${dir} ${agent}[${index}] ${seg.call} has no place`)
          for (const a of seg.at) {
            assert.ok(a.line >= seg.lines[0] && a.line <= seg.lines[1], `${dir} ${agent}[${index}] ${a.call} outside its segment`)
            const text = lines[a.line - 1].slice(...a.cols)
            assert.ok(/^(layerfs\b|\w+\.)/.test(text), `${dir} ${agent}[${index}] ${a.call}: ${JSON.stringify(text)}`)
            placed++
          }
        }
      })
    }
  }
  assert.ok(placed > 1000, `${placed} calls placed`)
})
