// Prints the parser's coverage: segments per kind per scenario, and the
// distinct LayerFS calls each scenario's steps make.
//   node host/parse/table.js [scenarios-folder]
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { stepView } from './index.js'

const KINDS = ['workspace', 'fs', 'branch', 'sandbox', 'project', 'backend', 'subagent', 'job', 'local']
const dir = process.argv[2] ?? fileURLToPath(new URL('../../scenarios/', import.meta.url))
const rows = []
const calls = new Map()
for (const name of readdirSync(dir).sort()) {
  const file = join(dir, name, 'scenario.json')
  if (!existsSync(file)) continue
  const s = JSON.parse(readFileSync(file, 'utf8'))
  const row = { name, steps: 0, lines: 0 }
  for (const k of KINDS) row[k] = 0
  const seen = new Set()
  for (const [agent, steps] of Object.entries(s.agents)) {
    steps.forEach((step, index) => {
      const view = stepView(step, index, agent)
      row.steps++
      for (const seg of view.segments) {
        row[seg.kind]++
        if (view.tool === 'bash') row.lines += seg.lines[1] - seg.lines[0] + 1
        if (seg.call && seg.form !== 'tool') seen.add(seg.call)
      }
    })
  }
  calls.set(name, [...seen].sort())
  rows.push(row)
}
const head = ['scenario', 'steps', ...KINDS, 'lines']
const table = [head, ...rows.map((r) => [r.name, r.steps, ...KINDS.map((k) => r[k]), r.lines])]
const total = ['total', ...head.slice(1).map((_, i) => rows.reduce((n, r) => n + Number(table[rows.indexOf(r) + 1][i + 1]), 0))]
table.push(total)
const widths = head.map((_, i) => Math.max(...table.map((r) => String(r[i]).length)))
for (const r of table) console.log(r.map((c, i) => (i ? String(c).padStart(widths[i]) : String(c).padEnd(widths[i]))).join('  '))
console.log('\nsegments per kind (neighbouring lines of one call are one segment); lines: bash lines covered')
for (const [name, list] of calls) console.log(`${name.padEnd(widths[0])}  ${list.join(' ')}`)
