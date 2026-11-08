exec(open('/private/tmp/connect-followup-live-common.py').read())
lines={'check':129,'snapshot':253,'send':270,'verify':303,'install':327,'record':340,'retire':368}
for kind in ['pull']:
 for phase,line in lines.items():
  store='live-'+kind+'-'+phase
  run(['store','create',store]);run(['project','init',store+'/p',str(FIX/'input')])
  if kind=='pull':run(['store','push',store,'docker'])
  name=kind+'-'+phase
  args=['/Users/yifanxu/.nvm/versions/node/v24.21.0/bin/node','/private/tmp/connect-followup-live-host.mjs',str(FIX/'home'),str(FIX/'states'/name),kind,store,'docker',str(line),str(EVID/name)]
  r=subprocess.run(args,env=ENV,capture_output=True,text=True,timeout=115)
  print(name,r.returncode,r.stdout.strip(),r.stderr,flush=True)
  row={'id':name,'kind':kind,'phase':phase,'source_line':line,'exit':r.returncode,'log':r.stdout+r.stderr}
  if r.returncode==0:
   detail=json.loads((EVID/(name+'.json')).read_text());status=run(['store','status',store]);row['status']=status
   row['boundary_pass']=detail['debuggerHit'] and detail['debuggerKilled'] and detail['starts']==1 and (detail['ended']['phase']==phase)
   # Fresh reads above precede deliberate explicit resolution of this retained operation.
   if status['op']:
    direction='push' if status['machine']=='native' else 'pull'
    run(['store',direction,store]+(['docker'] if direction=='push' else []))
   row['resolved_status']=run(['store','status',store]);row['record']=run(['store','get',store])
   run(['store','remove',store]);row['cleanup']='owned Store removed after fresh-read explicit recovery'
  ledger['rows'].append(row);save()
