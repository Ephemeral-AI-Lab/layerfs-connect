import{Storage}from'/Users/yifanxu/Ephemeral-AI-Lab/layerfs-connect/host/storage.js';
import{client}from'/Users/yifanxu/Ephemeral-AI-Lab/layerfs-connect/host/cli/calls.js';
import{spawn}from'node:child_process';import{writeFileSync,mkdirSync}from'node:fs';
const [home,state,kind,store,target,line,file,interceptHalf='any']=process.argv.slice(2);
mkdirSync(state,{recursive:true});const spec={home,state,mode:'real',cli:process.env.LAYERFS_CONNECT_CLI};const real=client(spec);let starts=0,dbg,debug='',childPid;
const hooked={store:{get:(...a)=>real.store.get(...a),status:(...a)=>real.store.status(...a),push:(s,m,o)=>launch('push',[s,m],o),pull:(s,o)=>launch('pull',[s],o)},machine:real.machine};
function launch(call,args,o){starts++;return real.store[call](...args,{...o,on_spawn:pid=>{childPid=pid;o.on_spawn(pid);if(interceptHalf!=='any'&&interceptHalf!==call)return;process.kill(pid,'SIGSTOP');dbg=spawn('xcrun',['lldb','--batch','-o',`process attach --pid ${pid}`,'-o',`breakpoint set --file phases.rs --line ${line}`,'-o','process continue','-o','thread backtrace -c 4','-o','process kill'],{stdio:['ignore','pipe','pipe']});for(const stream of[dbg.stdout,dbg.stderr])stream.on('data',d=>debug+=d);}})}
const manager=new Storage({spec,client:hooked,log:()=>{}});let job=kind==='push'?manager.push(store,target):kind==='pull'?await manager.pull(store):manager.move(store,target);const deadline=Date.now()+105000;
while(!manager.job(job.id).ended){if(Date.now()>deadline){try{process.kill(childPid,'SIGKILL')}catch{};dbg?.kill('SIGKILL');throw Error('explicit 105 second timeout')}await new Promise(r=>setTimeout(r,20))}
if(dbg)await new Promise(r=>dbg.exitCode!==null?r():dbg.once('close',r));
writeFileSync(file+'.debug.log',debug);
const ended=manager.job(job.id);const inspected=await manager.inspect(job.id);const restored=new Storage({spec,client:hooked,log:()=>{}});await restored.reconciled;
writeFileSync(file+'.json',JSON.stringify({spec,starts,childPid,ended,inspected,restarted:restored.job(job.id),debuggerHit:debug.includes('stop reason = breakpoint'),debuggerKilled:debug.includes('status = 9')},null,2));
console.log(JSON.stringify({file,starts,phase:ended.phase,outcome:ended.outcome,state:inspected.observation.value.state,debuggerHit:debug.includes('stop reason = breakpoint')}));
