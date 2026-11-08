import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
const text = readFileSync(new URL('../src/renderer/src/components/history/model.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } }).outputText + '\n//# sourceURL=history-model.js'
const { graphNodes, branchLanes, layoutNodes, sourcesOf } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
const make = (n, branch = 'work') => Array.from({ length: n }, (_, i) => ({ id: `${branch}-${i}`, branch, parent: i ? `${branch}-${i-1}` : null, at: n-i, message: 'write' })).reverse()
const branches = [{ name: 'main', head: 'layer', base: 'layer', forkedFrom: null }, { name: 'work', head: 'work-9999', base: 'layer', forkedFrom: 'layer' }, { name: 'review', head: 'review-0', base: 'layer', forkedFrom: 'work-5000' }]
const pages = { work: { items: make(10000), next: null, head: 'work-9999' }, review: { items: [{ ...make(1,'review')[0], parent:'work-5000', merged:'work-9999' }], next:null,head:'review-0' } }
test('10,000 checkpoints compact without hiding topology or dropping records', () => {
  const nodes = graphNodes(branches, pages, new Map(), new Set(), null)
  assert.ok(nodes.length < 110)
  assert.equal(nodes.flatMap(n => n.commits).length, 10001)
  assert.equal(nodes.find(n => n.id === 'work-5000')?.kind, 'checkpoint')
  assert.equal(nodes.find(n => n.id === 'work-9999')?.kind, 'checkpoint')
})
test('parent edges stay in topological order even with backwards clocks', () => {
  const nodes = graphNodes(branches,pages,new Map(),new Set(),null)
  const { lanes } = branchLanes(branches,pages,new Map())
  const layout = layoutNodes(nodes,lanes)
  for (const n of layout.positioned) for (const id of [n.parent,n.second]) {
    const p = layout.points.get(id)
    if (p && p !== n) assert.ok(p.x < n.x)
  }
  assert.equal(layout.points.get('layer').y,layout.height/2)
  assert.equal(Math.sign(lanes.get('review')),Math.sign(lanes.get('work')))
})
test('distinct stable lanes balance branch families and keep descendants outward', () => {
  const bs = [
    {name:'a',head:'a0',base:'layer',forkedFrom:'layer'},
    {name:'a-child',head:'ac0',base:'layer',forkedFrom:'a0'},
    {name:'a-grandchild',head:null,base:'layer',forkedFrom:'ac0'},
    ...['b','c','d'].map(name=>({name,head:null,base:'layer',forkedFrom:'layer'})),
  ]
  const ps = { a:{items:[{id:'a0'}]}, 'a-child':{items:[{id:'ac0'}]} }
  const sides = new Map()
  const first = branchLanes([branches[0],...bs],ps,sides)
  assert.equal(new Set(first.lanes.values()).size,7)
  assert.equal(Math.sign(first.lanes.get('a')),Math.sign(first.lanes.get('a-child')))
  assert.ok(Math.abs(first.lanes.get('a-grandchild'))>Math.abs(first.lanes.get('a-child')))
  assert.equal([...first.lanes.values()].filter(n=>n<0).length,3)
  assert.equal([...first.lanes.values()].filter(n=>n>0).length,3)
  const before = [...sides]
  branchLanes([branches[0],...bs],ps,sides)
  assert.deepEqual([...sides],before)
})
test('expansion reveals intermediate dots and provenance preserves agent and sparse numbers', () => {
  const bs=branches.slice(0,2), ps={work:{items:make(8),head:'work-7',next:null}}
  const nodes=graphNodes(bs,ps,new Map(),new Set(),null)
  const group=nodes.find(n=>n.kind==='group')
  const expanded=graphNodes(bs,ps,new Map(),new Set([group.id]),null)
  assert.equal(expanded.filter(n=>n.kind==='checkpoint').length,8)
  const sources=sourcesOf([{id:'tool',writes:[{status:'ok',commit:'a',checkpoint:2},{status:'ok',commit:'b',checkpoint:9},{status:'failed',commit:'c',checkpoint:null}]}],'child:1')
  assert.equal(sources.get('a').child,'child:1');assert.equal(sources.get('b').checkpoint,9);assert.equal(sources.has('c'),false)
})

test('fork and publish references do not replace the Commit producer', () => {
  const result=sourcesOf([
    {id:'write',writes:[{kind:'file',status:'ok',commit:'c',checkpoint:1}]},
    {id:'fork',writes:[{kind:'fork',status:'ok',commit:'c',checkpoint:2}]},
    {id:'publish',writes:[{kind:'publish',status:'ok',commit:'c',layer:'l',checkpoint:3}]},
  ])
  assert.equal(result.get('c').row.id,'write')
  assert.equal(result.get('l').row.id,'publish')
})
