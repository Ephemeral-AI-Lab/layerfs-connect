import test from 'node:test'
import assert from 'node:assert/strict'
import { Projects } from '../projects.js'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const L = `32${'a'.repeat(64)}`, C = `12${'c'.repeat(64)}`
function fixture(t) {
 const state = mkdtempSync(join(tmpdir(),'connect-pins-')); t.after(()=>rmSync(state,{recursive:true,force:true}))
 const calls=[]; const method=(name,value)=>async(...args)=>{calls.push([name,...args]);return typeof value==='function'?value(...args):value}
 const client={branch:{get:method('branch.get',{name:'main',saved_head:{id:L}}),list:method('branch.list',{items:[{name:'main',saved_head:{id:L}}],next_page_pos:null}),get_commit:method('branch.get_commit',{id:C,parent:L,branch:'work'}),commits:method('branch.commits',{at_commit:{id:C,kind:'Commit',branch:'work'},items:[{id:C,parent:L}],has_more:true})},file:{list:method('file.list',{at:{id:L},items:[{name:'a',path:'/a',type:'file'}],has_more:true,next_page_pos:1000}),stat:method('file.stat',{size:3000000}),read:method('file.read',{text:'one\n',next_line:2,truncated:true,line_truncated:true,at:{id:L}}),revision:method('file.revision',{items:[],continuation:'lfq1:opaque'}),diff:method('file.diff',{rows:[],has_more:false}),blame:method('file.blame',{lines:[],coverage:{status:'partial'}})},commit:{diff:method('commit.diff',{items:[],next_cursor:'/a'})},project:{stats:method('project.stats',{project:'app',at:{id:L},logical:9,complete:true})},store:{stats:method('store.stats',{name:'s',history_logical:100,init:null})}}
 return {p:new Projects({spec:{state},client}),client,calls}
}
test('folder first page has no eager stat and uses exact saved pin on every page',async t=>{
 const {p,calls}=fixture(t); const first=await p.listDir('s/app','main','/',L);assert.equal(first.next,1000);assert.equal(first.items[0].size,null);await p.listDir('s/app','main','/',L,1000);assert.deepEqual(calls.map(c=>c[0]),['file.list','file.list']);assert.equal(calls[1][4],L);assert.equal(calls[1][5].page_pos,1000)
})
test('large text retains one bounded window, next line and clipped state at pin',async t=>{
 const {p,calls}=fixture(t);const data=await p.file('s/app','main','/a',L,2);assert.equal(data.text,'one\n');assert.equal(data.next_line,2);assert.equal(data.line_truncated,true);assert.equal(calls[1][4],L);assert.deepEqual(calls[1][5],{start_line:2,end_line:1001})
})
test('revision continuation repeats pins and query size and omits numbered page',async t=>{
 const {p,calls}=fixture(t);await p.fileQuery('s/app',new URLSearchParams({kind:'revisions',branch:'main',path:'/a',pin:L,size:'10',continuation:'lfq1:opaque',page:'8'}));const options=calls[0].at(-1);assert.deepEqual(options,{at_commit:L,traversal:'provenance',page_size:10,continuation:'lfq1:opaque'});assert.equal('page' in options,false)
})
test('branch comparison continuation repeats endpoints without page and attribution requests server rows',async t=>{
 const {p,client,calls}=fixture(t);client.branch.diff=async(...a)=>{calls.push(['branch.diff',...a]);return {items:[]}}
 await p.fileQuery('s/app',new URLSearchParams({kind:'branch-diff',branch:'main',rightBranch:'work',path:'/',pin:L,left:C,continuation:'lfq1:x',size:'10'}));assert.deepEqual(calls[0].at(-1),{from_commit:C,to_commit:L,include_attribution:true,path_prefix:'/',page_size:10,continuation:'lfq1:x'})
 await p.fileQuery('s/app',new URLSearchParams({kind:'attribution',branch:'main',path:'/a',pin:L,left:C}));assert.equal(calls[1][0],'file.diff');assert.equal(calls[1].at(-1).include_attribution,true)
})
test('project statistics use request key even when CLI returns bare project name',async t=>{
 const {p,calls}=fixture(t);const data=await p.projectStats('s/app',new URLSearchParams({pin:L}));assert.equal(data.project,'app');assert.equal(data.projectKey,'s/app');assert.deepEqual(calls[0],['project.stats','s/app','main',L])
})

test('History unwraps typed at_commit and stops at the side Branch fork', async t=>{
 const {p,client}=fixture(t);client.branch.get=async()=>({name:'work',forked_from:L});client.branch.commits=async()=>({at_commit:{id:C,kind:'Commit'},items:[{id:C,parent:L},{id:L,parent:null}],has_more:true});const page=await p.history('s/app',new URLSearchParams({branch:'work'}));assert.equal(page.head,C);assert.deepEqual(page.items.map(c=>c.id),[C]);assert.equal(page.next,null)
})

test('cross-Branch file comparisons retain both original contexts and full pins', async t=>{
 const {p,calls}=fixture(t)
 await p.fileQuery('s/app',new URLSearchParams({kind:'compare',branch:'target',rightBranch:'source',path:'/a',pin:L,left:C}))
 assert.deepEqual(calls[0].slice(0,6),['file.diff','s/app','source','/a','target','/a'])
 assert.equal(calls[0].at(-1).left_commit,C)
 assert.equal(calls[0].at(-1).right_commit,L)
})
