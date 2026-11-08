import { readFileSync, writeFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { validateReport } from '../../host/doctor/report.js'
const dir=fileURLToPath(new URL('../../docs/evidence/phase-2-follow-up/postgresql/', import.meta.url))
const wall=setTimeout(()=>process.exit(1),120000)
const checks=[]
for(const [file,complete,counts]of [['connection',true,{pass:5}],['incomplete',false,{pass:54,unknown:60,skipped:1}],['complete',true,{pass:114,skipped:1}]]){
 const raw=readFileSync(dir+file+'-job.json');const job=JSON.parse(raw);const report=validateReport(job.report,job.request)
 assert.equal(job.state,'completed');assert.equal(job.simulated,false);assert.equal(report.ok,true);assert.equal(report.complete,complete);assert.deepEqual(report.counts,counts)
 if(file==='complete'){assert.equal(report.checks.filter(c=>c.outcome==='unknown'||c.outcome==='blocked'||c.outcome==='fail').length,0);assert(report.checks.some(c=>c.code==='store.database.relations.summary'&&c.outcome==='pass'))}
 for(const c of report.checks.filter(c=>c.outcome==='skipped'))assert(c.message.startsWith('no persisted merge-working tables'))
 checks.push({file:file+'-job.json',sha256:createHash('sha256').update(raw).digest('hex'),ok:report.ok,complete:report.complete,counts:report.counts,skip:report.checks.filter(c=>c.outcome==='skipped').map(c=>({code:c.code,message:c.message})),verdict:'PASS'})
}
const qualification=JSON.parse(readFileSync(dir+'qualification.json'))
assert.equal(qualification.cleanup.length,1);assert.equal(qualification.cleanup[0].removed,true)
assert.equal(qualification.identity.dirty,false);assert.equal(qualification.identity.commit,'833d04cf44e8e747929d50ab1170a48260d9381c')
assert.equal(qualification.binaries.find(b=>b.name==='layerfs').sha256,'7d7a5b507eeb2abc914a0e151c63eb12bd49bcbb69a06083d08f0b4430a3619c')
assert.equal(qualification.binaries.find(b=>b.name==='layerfs-daemon').sha256,'664c991face739375b9c147c757575d4f12edbf84f64773eedd5a08c789d10c2')
const validation = {verdict:'PASS',validated:new Date().toISOString(),command:'Node24 node tools/verification/postgresql-follow-up-validate.mjs',method:'Offline assertions against unchanged retained real reports; no successful audit rerun.',initialHarnessFailure:'qualification.json retained FAIL: counts omits zero-valued outcome keys. Actual three reports completed successfully; corrected count validation uses exact sparse counts.',checks,cleanup:qualification.cleanup}
if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify(validation,null,2)+'\n',{flag:'wx'})
console.log(JSON.stringify({verdict:'PASS',checks:checks.map(c=>({file:c.file,complete:c.complete,counts:c.counts}))}))

clearTimeout(wall)
