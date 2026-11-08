exec(open('/private/tmp/connect-followup-live-common.py').read())
ledger={'calls':[],'rows':[],'source':'833d04cf44e8e747929d50ab1170a48260d9381c'}
def save(): (EVID/'move-ledger.json').write_text(json.dumps(ledger,indent=2))
lines={'check':129,'snapshot':253,'send':270,'verify':303,'install':327,'record':340,'retire':368}
for half in ['pull','push']:
 for phase,line in lines.items():
  name='move-'+half+'-'+phase;store='live-'+name
  run(['store','create',store]);run(['project','init',store+'/p',str(FIX/'input')]);run(['store','push',store,'docker'])
  args=['/Users/yifanxu/.nvm/versions/node/v24.21.0/bin/node','/private/tmp/connect-followup-live-host.mjs',str(FIX/'home'),str(FIX/'states'/name),'move',store,'live-move-vm',str(line),str(EVID/name),half]
  r=subprocess.run(args,env=ENV,capture_output=True,text=True,timeout=115);print(name,r.returncode,r.stdout.strip(),r.stderr,flush=True)
  row={'id':name,'kind':'move','half':half,'phase':phase,'source_line':line,'exit':r.returncode,'log':r.stdout+r.stderr}
  if r.returncode==0:
   detail=json.loads((EVID/(name+'.json')).read_text());status=run(['store','status',store]);row['status']=status
   row['boundary_pass']=detail['debuggerHit'] and detail['debuggerKilled'] and detail['starts']==(1 if half=='pull' else 2) and detail['ended']['phase']==phase and detail['ended']['half']==half
   if status['op']:
    # Explicit recovery uses current authority. Never resend on a lost reply.
    direction='push' if status['machine']=='native' else 'pull'
    run(['store',direction,store]+(['live-move-vm'] if direction=='push' else []))
   row['resolved_status']=run(['store','status',store]);row['record']=run(['store','get',store]);run(['store','remove',store]);row['cleanup']='owned Store removed after fresh-read explicit recovery'
  ledger['rows'].append(row);save()
