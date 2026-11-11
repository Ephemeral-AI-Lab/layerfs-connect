import test, {before,after} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {pathToFileURL} from 'node:url'
import ts from 'typescript'
let directory, sandboxLiveData, workspaceState
before(async()=>{
 directory=await mkdtemp(join(tmpdir(),'sandbox-view-'))
 for(const [name,path] of [['live','../desktop/src/renderer/src/layerfs/sandbox-live.ts'],['model','../desktop/src/renderer/src/components/sandbox/model.ts']]){
  const source=await readFile(new URL(path,import.meta.url),'utf8')
  await writeFile(join(directory,name+'.mjs'),ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText)
 }
 ;({sandboxLiveData}=await import(pathToFileURL(join(directory,'live.mjs'))));({workspaceState}=await import(pathToFileURL(join(directory,'model.mjs'))))
})
after(async()=>{await rm(directory,{recursive:true,force:true})})
const actor={id:'child-pi-1',childId:'a01-worker',name:'Worker',task:'Feature',state:'running'}
const call={id:'x',agent:actor.id,step:'child-pi-1:tool-x',method:'workspace.exec',start:'2026-11-10T00:00:01Z',ms:null,ok:null,ws:'s:named',sandbox:'s',path:'named'}
const feed=(id='c1')=>({chat:{id,title:'Task',created:Date.parse('2026-11-10T00:00:00Z'),state:'running'},value:{actors:[{id:'root',childId:null,name:'Main',state:'running'},actor],calls:[call],live:{running:[call],mounts:[{ws:'s:named',sandbox:'s',path:'/workspaces/123',branch:'feature',agent:actor.id,since:0}],last:{}}}})
const inventory=[{name:'s',machine:'native',state:'running',workspaces:[]}]
test('real named-workspace calls connect the correct child, workspace, branch and conversation',()=>{
 const value=sandboxLiveData(inventory,[],[feed()],Date.parse('2026-11-10T00:00:00Z')/1000)
 assert.equal(value.events[0].end,Infinity)
 assert.equal(value.events[0].branch,'feature')
 assert.equal(value.actors[1].workspace,'s:named')
 assert.equal(value.actors[1].parent,'c1/root')
 assert.deepEqual(value.workspaces[0].users,['c1/child-pi-1'])
 assert.equal(value.links[value.actors[1].id],'/chat/c1/subagents/a01-worker')
})
test('reused child names and local call ids do not join conversations, and idle uncertain starts do not animate',()=>{
 const a=feed('c1'),b=feed('c2');b.value={...b.value,live:{...b.value.live,running:[]}}
 const value=sandboxLiveData(inventory,[],[a,b],0)
 assert.equal(new Set(value.actors.map(a=>a.id)).size,4)
 assert.equal(value.events.length,1)
 assert.equal(value.events[0].actor,'c1/child-pi-1')
 assert.deepEqual(value.workspaces[0].users,['c1/child-pi-1','c2/child-pi-1'])
})
test('a fresh mount using a previous handle is not hidden by its earlier unmount',()=>{
 const ws={id:'s:named'}
 const events=[{method:'workspace.mount',workspace:ws.id,start:1,end:2,outcome:'ok'},{method:'workspace.unmount',workspace:ws.id,start:3,end:4,outcome:'ok'},{method:'workspace.mount',workspace:ws.id,start:5,end:6,outcome:'ok'}]
 assert.equal(workspaceState(ws,events,7).mounted,true)
 assert.equal(workspaceState(ws,events,7).unmounted,false)
})
