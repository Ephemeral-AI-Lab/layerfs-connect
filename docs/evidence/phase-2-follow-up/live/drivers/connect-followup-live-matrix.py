exec(open('/private/tmp/connect-followup-live-common.py').read())
phases=['check','snapshot','send','verify','install','record','retire']
rows=[]
for operation in ['push','pull','move.pull','move.push']:
 for phase in phases:
  rows.append({'id':operation.replace('.','-')+'-'+phase,'operation':operation,'phase':phase,'authority':'source until record publication; destination after record','custody':'source retained before install; install/record uncertain copies retained; retire destination authority with source pending retirement','fresh_reads':['store.status','store.get'],'recovery':'one explicit same-direction call only after fresh read; never automatic replay','cleanup_owner':'live recovery agent'})
for op,ps in [('backup.create.native',['check#1','snapshot','check#2','hash','upload']),('backup.create.remote',['send']),('backup.restore',['check','download','verify','install#1-staging','install#2-destination'])]:
 for p in ps:rows.append({'id':op+'-'+p,'operation':op,'phase':p,'owner':'postgresql agent after delegation','fresh_reads':['backup.list','store.get'],'custody':'retain uncertain remote copy or installed Store until reads establish state'})
record={'source':'833d04cf44e8e747929d50ab1170a48260d9381c','pre_injection_review':'Lead explicitly reviewed and approved this phase matrix in collaboration message before first transfer injection. Expected authority/custody was discussed against phases.rs source.','mechanism':'Unmodified pinned CLI under external LLDB source breakpoint; actual stop frame and SIGKILL result retained. Connect host-kill rows separately cover preinstall/installed-prerecord/postrecord custody; child permitted to finish, then fresh reads and no replay.','important':'Progress is not a synchronization gate: transfer progress precedes persisted op and backup progress can be buffered. The debugger supplies exact boundary evidence.','rows':rows}
(EVID/'reviewed-matrix.json').write_text(json.dumps(record,indent=2))
