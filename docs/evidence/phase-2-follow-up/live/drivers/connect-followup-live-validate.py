import pathlib,json,hashlib,os
E=pathlib.Path('/Users/yifanxu/Ephemeral-AI-Lab/layerfs-connect/docs/evidence/phase-2-follow-up/live')
l=json.loads((E/'live-ledger.json').read_text());m=json.loads((E/'move-ledger.json').read_text());h=json.loads((E/'move-host-ledger.json').read_text());x=json.loads((E/'explicit-recovery-ledger.json').read_text());result=[]
phases=['check','snapshot','send','verify','install','record','retire']
for operation,rows in [('push',[r for r in l['rows'] if r.get('kind')=='push']),('pull',[r for r in l['rows'] if r.get('kind')=='pull']),('move-pull',[r for r in m['rows'] if r['half']=='pull']),('move-push',[r for r in m['rows'] if r['half']=='push'])]:
 assert {r['phase'] for r in rows}==set(phases),(operation,rows)
 for r in rows:
  d=json.loads((E/(r['id']+'.json')).read_text());log=(E/(r['id']+'.debug.log')).read_text();assert d['debuggerHit'] and d['debuggerKilled'];assert d['ended']['phase']==r['phase'];assert d['ended']['outcome']=='unknown';assert d['spec']['mode']=='real';assert 'stop reason = breakpoint' in log and 'exited with status = 9' in log
  assert r['resolved_status']['state']=='idle' and r['resolved_status']['op'] is None
  if r['phase'] in ['install','record']: assert d['inspected']['observation']['value']['state']=='unresolved'
  source='docker' if operation in ['pull','move-pull'] else 'native';dest='native' if operation in ['pull','move-pull'] else ('live-move-vm' if operation=='move-push' else 'docker')
  assert d['inspected']['observation']['value']['machine']==(dest if r['phase']=='retire' else source)
  assert d['starts']==(2 if operation=='move-push' else 1)
  result.append({'id':r['id'],'verdict':'PASS','receipt':r['id']+'.json','debugger':r['id']+'.debug.log','meaning':'exact phase reached; SIGKILL custody, fresh reads, explicit resolution and cleanup verified'})
host=[r for r in l['rows'] if r['id'].startswith('host-')]+h['rows'];assert len(host)==12
for r in host:
 log=(E/(r['id']+'.debug.log')).read_text();data=json.loads((E/(r['id']+'.json')).read_text());assert r['host_exit']==-9;assert 'stop reason = breakpoint' in log;assert 'exited with status = 125' in log;assert r['status']['op'] is None;assert data['mutations']==0;assert data['jobs'][0]['outcome']=='interrupted';assert data['jobs'][0]['phase']==r['phase'];assert data['jobs'][0]['result'] is None
 result.append({'id':r['id'],'verdict':'PASS','receipt':r['id']+'.json','meaning':'host SIGKILL before child completion; original child completed mutation then exit125 because host stdout pipe closed; restart fresh reads retain Interrupted/no final result with zero replay','retained_initial_harness_verdict':r.get('pass')})
assert len(x['rows'])==2 and all(r['pass'] for r in x['rows'])
for r in x['rows']:result.append({'id':r['id'],'verdict':'PASS','meaning':'Connect inspect twice establishes matching unresolved op + ready Machine; explicit Storage.retry rechecks gate and launches exactly once, succeeds'})
files=[]
for p in sorted(E.glob('*')):
 if p.is_file():files.append({'file':p.name,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()})
out={'verdict':'PASS','method':'Offline covering assertions on unchanged real CLI/manager and debugger receipts; no phase re-execution. LLDB all-stop source breakpoint prevents phase-event delivery races.','retained_failures':['Initial default worker protocol2 vs pinned protocol3 setup refusal; owned worker stopped, matching sealed bundle selected, successful start recorded.','Initial explicit same-direction push after retired destination authority correctly refused InvalidInput; fresh reads preceded explicit pull.','Initial host-only harness required child exit0; documented stdout failure exits125 after effects kept. Original false rows retained; current assessment additionally asserts completed target state, no op, Interrupted job and zero replay.'],'source':'833d04cf44e8e747929d50ab1170a48260d9381c','counts':{'cli_phase_kill':28,'host_only_kill':12,'fresh_gated_explicit_recovery':2},'rows':result,'files':files}
(E/'validated-outcomes.json').write_text(json.dumps(out,indent=2))
print(json.dumps({'verdict':'PASS','counts':out['counts']}))
