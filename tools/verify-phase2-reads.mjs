// Explicit owned native fixture: management, saved reads and statistics.
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { client } from '../host/cli/calls.js'
import { execute } from '../host/cli/spawn.js'
import { discover } from '../host/cli/capabilities.js'
import { stringify } from '../host/cli/json.js'
const root = mkdtempSync(join(tmpdir(), 'connect-phase2-reads-'))
const spec = { mode: 'real', home: join(root, 'home'), cli: process.env.LAYERFS_CONNECT_CLI }
const receipt = { kind: 'real CLI', checks: [], cleanup: false }
const record = async (name, run) => { try { const value = await run(); receipt.checks.push({ name, status: 'PASS', value }); return value } catch (error) { receipt.checks.push({ name, status: 'FAIL', code: error.code, message: error.message }); throw error } }
try {
  receipt.identity = (await discover(spec)).identity
  await execute(spec, ['import-env'])
  const lfs = client(spec)
  const store = await record('create Disposable Store', () => lfs.store.create('owned'))
  assert.equal(store.profile, 'disposable')
  const folder = join(root, 'source'); mkdirSync(folder); writeFileSync(join(folder, 'a.txt'), 'alpha\nbeta\n')
  await record('Init into existing Store', () => lfs.project.init('owned/p', folder))
  const base = (await lfs.branch.get('owned/p','main')).saved_head.id
  await record('fork Branch', () => lfs.branch.fork('owned/p','work','main'))
  const write = await record('saved file write', () => lfs.file.write('owned/p','work','/a.txt','alpha\nchanged\n',{message:'owned edit'}))
  const saved = (await lfs.branch.get('owned/p','work')).saved_head.id
  const file = await record('pinned saved file read', () => lfs.file.read('owned/p','work','/a.txt',saved))
  assert.equal(file.text,'alpha\nchanged\n')
  await record('pinned file list', () => lfs.file.list('owned/p','work','/',saved,{page_size:1}))
  await record('pinned blame', () => lfs.file.blame('owned/p','work','/a.txt',saved,{from_line:1,line_count:2}))
  await record('pinned file diff', () => lfs.file.diff('owned/p','main','/a.txt','work','/a.txt',{left_commit:base,right_commit:saved,allow_missing:true,include_attribution:true,page_size:1}))
  const revisions = await record('pinned revisions', () => lfs.file.revision('owned/p','work','/a.txt',{at_commit:saved,page_size:1}))
  if (revisions.continuation) await record('stateless revision continuation', () => lfs.file.revision('owned/p','work','/a.txt',{at_commit:saved,page_size:1,continuation:revisions.continuation}))
  await lfs.file.write('owned/p','work','/b.txt','b\n')
  await lfs.file.write('owned/p','work','/c.txt','c\n')
  const comparisonPin = (await lfs.branch.get('owned/p','work')).saved_head.id
  const compared = await record('pinned branch attribution comparison', () => lfs.branch.diff('owned/p','main','work',{from_commit:base,to_commit:comparisonPin,include_attribution:true,page_size:1}))
  if (compared.continuation) await record('stateless comparison continuation', () => lfs.branch.diff('owned/p','main','work',{from_commit:base,to_commit:comparisonPin,include_attribution:true,page_size:1,continuation:compared.continuation}))
  await record('publish main Layer', () => lfs.branch.publish('owned/p','work'))
  const head = (await lfs.branch.get('owned/p','main')).saved_head.id
  await record('main Layer history', () => lfs.branch.commits('owned/p','main',{at_commit:head,page_size:2}))
  await record('Layer changed paths', () => lfs.commit.diff('owned/p',base,head,{page_size:1}))
  await record('Layer record', () => lfs.branch.get_commit('owned/p','main',head))
  const project = await record('pinned project stats', () => lfs.project.stats('owned/p','main',head))
  assert.equal(project.project,'p');assert.equal(project.files,3);assert.equal(project.logical,18)
  const stats = await record('Store stats scopes', () => lfs.store.stats('owned'))
  assert.equal(stats.init,null)
  const report = await record('full Store Doctor report', () => execute(spec,['doctor','store','integrity','owned','--timeout','10s'],{read:true}))
  assert.equal(report.complete,true);assert.equal(report.ok,true)
  await record('remove owned project', () => lfs.project.remove('owned/p'))
  await record('remove owned Store', () => lfs.store.remove('owned'))
} finally {
  rmSync(root,{recursive:true,force:true});receipt.cleanup=true
  writeFileSync(new URL(`../docs/evidence/phase-2/reads-native-${Date.now()}.json`,import.meta.url),stringify(receipt)+'\n')
}
