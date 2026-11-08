import { spawnSync } from 'node:child_process'
import { randomBytes, createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { execute } from '/Users/yifanxu/Ephemeral-AI-Lab/layerfs-connect/host/cli/spawn.js'
import { DoctorManager } from '/Users/yifanxu/Ephemeral-AI-Lab/layerfs-connect/host/doctor/manager.js'
const repo='/Users/yifanxu/Ephemeral-AI-Lab/layerfs-connect'
const out=join(repo,'docs/evidence/phase-2-follow-up/postgresql'); mkdirSync(out,{recursive:true})
const root=mkdtempSync('/private/tmp/connect-follow-up-pg-'); mkdirSync(join(root,'state')); mkdirSync(join(root,'input')); writeFileSync(join(root,'input','readme'),'owned PostgreSQL full-integrity proof\n')
const spec={cli:process.env.LAYERFS_CONNECT_CLI,home:join(root,'home'),state:join(root,'state')}
const password=randomBytes(24).toString('hex'); process.env.CONNECT_PROOF_PG_PASSWORD=password
const env={...process.env,POSTGRES_USER:'proof',POSTGRES_DB:'proof',POSTGRES_PASSWORD:password}
const receipt={started:new Date().toISOString(),root,source:'833d04cf44e8e747929d50ab1170a48260d9381c',node:process.version,calls:[],cleanup:[]}
let container
const docker=(args)=>{const r=spawnSync('docker',args,{env,encoding:'utf8',timeout:15000}); if(r.status!==0)throw Error(`Docker ${args[0]} failed status ${r.status}`);return r.stdout.trim()}
const sql=statement=>docker(['exec',container,'psql','-XAt','-U','proof','-d','proof','-v','ON_ERROR_STOP=1','-c',statement])
async function call(argv){const started=Date.now();const result=await execute(spec,argv,{timeout:20000});receipt.calls.push({argv,exit:0,duration_ms:Date.now()-started,result});return result}
const sleep=ms=>new Promise(r=>setTimeout(r,ms)); let manager
async function doctor(target,key){const j=await manager.launch({target,name:'pg-proof',timeout:'20s',key});const until=Date.now()+25000;while(['queued','running'].includes(j.state)){assert(Date.now()<until,'Doctor completion deadline');await sleep(20)}assert.equal(j.state,'completed');return j}
const timer=setTimeout(()=>{console.error('FAIL explicit 120s wall deadline');process.exit(1)},120000)
try{
 receipt.identity=await execute(spec,['--version','--json'],{discovery:true,timeout:10000});assert.equal(receipt.identity.commit,receipt.source);assert.equal(receipt.identity.dirty,false)
 receipt.binaries=['layerfs','layerfs-daemon'].map(name=>({name,sha256:createHash('sha256').update(readFileSync(join(spec.cli,'..',name))).digest('hex')}))
 container=docker(['run','-d','--name',`connect-followup-pg-${randomBytes(5).toString('hex')}`,'--label','owner=connect-phase2-followup-postgresql','-e','POSTGRES_USER','-e','POSTGRES_DB','-e','POSTGRES_PASSWORD','-p','127.0.0.1::5432','postgres:17-bookworm']);receipt.container=container
 const until=Date.now()+15000;while(spawnSync('docker',['exec',container,'pg_isready','-h','127.0.0.1','-U','proof'],{timeout:2000}).status!==0){assert(Date.now()<until,'PG readiness deadline');await sleep(100)}
 receipt.image=docker(['inspect','--format','{{.Image}}',container]);receipt.server=sql('SELECT version(); SELECT rolsuper FROM pg_roles WHERE rolname=current_user;')
 const port=docker(['port',container,'5432/tcp']).split(':').at(-1)
 await call(['machine','list']);await call(['store','connect','pg-proof',`postgresql://proof@127.0.0.1:${port}/proof`,'--password','env:CONNECT_PROOF_PG_PASSWORD','--synchronous-commit','off']);await call(['project','init','pg-proof/p',join(root,'input')])
 manager=new DoctorManager({spec})
 const connection=await doctor('store.connection','pg-connection');assert.equal(connection.report.ok,true);writeFileSync(join(out,'connection-job.json'),JSON.stringify(connection,null,2)+'\n')
 const incomplete=await doctor('store.integrity','pg-full-without-amcheck');assert.equal(incomplete.report.ok,true);assert.equal(incomplete.report.complete,false);assert(incomplete.report.checks.some(c=>c.outcome==='unknown'&&c.message.includes('amcheck')));writeFileSync(join(out,'incomplete-job.json'),JSON.stringify(incomplete,null,2)+'\n')
 receipt.extension=sql('CREATE EXTENSION amcheck; SELECT extname,extversion FROM pg_extension WHERE extname=\'amcheck\'; SELECT proname,oidvectortypes(proargtypes),has_function_privilege(current_user,oid,\'EXECUTE\') FROM pg_proc WHERE proname IN (\'verify_heapam\',\'bt_index_check\') ORDER BY proname,oidvectortypes(proargtypes);')
 const complete=await doctor('store.integrity','pg-full-with-amcheck');writeFileSync(join(out,'complete-job.json'),JSON.stringify(complete,null,2)+'\n');assert.equal(complete.report.ok,true);assert.equal(complete.report.complete,true);assert.equal(complete.report.counts.unknown,0);assert(complete.report.checks.some(c=>c.code==='store.database.relations.summary'&&c.outcome==='pass'))
 receipt.complete=complete.report.counts;receipt.incomplete=incomplete.report.counts;receipt.connection=connection.report.counts;receipt.verdict='PASS';receipt.rendererState=join(root,'state')
}catch(e){receipt.verdict='FAIL';receipt.error=e.message;process.exitCode=1}
finally{clearTimeout(timer);if(container){try{docker(['rm','-f',container]);receipt.cleanup.push({container,removed:true})}catch(e){receipt.cleanup.push({error:e.message})}}receipt.ended=new Date().toISOString();writeFileSync(join(out,'qualification.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify({verdict:receipt.verdict,error:receipt.error,counts:receipt.complete,rendererState:receipt.rendererState,root,cleanup:receipt.cleanup}));}
