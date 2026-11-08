exec(open('/private/tmp/connect-followup-live-common.py').read())
ledger={'calls':[],'rows':[]}
def save(): (EVID/'move-host-ledger.json').write_text(json.dumps(ledger,indent=2))
for half in ['pull','push']:
 for phase,line in [('snapshot',253),('record',340),('retire',368)]:
  name='host-move-'+half+'-'+phase;store='live-'+name
  run(['store','create',store]);run(['project','init',store+'/p',str(FIX/'input')]);run(['store','push',store,'docker'])
  state=str(FIX/'states'/name);base=str(EVID/name)
  args=['/Users/yifanxu/.nvm/versions/node/v24.21.0/bin/node','/private/tmp/connect-followup-live-hostkill.mjs',str(FIX/'home'),state,'move',store,'live-move-vm',str(line),base,half]
  r=subprocess.run(args,env=ENV,capture_output=True,text=True,timeout=115)
  deadline=time.time()+10
  while time.time()<deadline:
   log=pathlib.Path(base+'.debug.log').read_text() if pathlib.Path(base+'.debug.log').exists() else ''
   if 'exited with status = 125' in log or 'exited with status = 0' in log:break
   time.sleep(.05)
  restart=subprocess.run(['/Users/yifanxu/.nvm/versions/node/v24.21.0/bin/node','/private/tmp/connect-followup-live-reconcile.mjs',str(FIX/'home'),state,base+'.json'],env=ENV,capture_output=True,text=True,timeout=20)
  status=run(['store','status',store]);data=json.loads(pathlib.Path(base+'.json').read_text())
  row={'id':name,'host_exit':r.returncode,'debugger_cli_completed':'exited with status = 125' in log or 'exited with status = 0' in log,'breakpoint_hit':'stop reason = breakpoint' in log,'restart_exit':restart.returncode,'status':status,'no_replay':data['mutations']==0,'phase':phase,'job':data['jobs'][0]}
  row['pass']=r.returncode==-9 and row['debugger_cli_completed'] and row['breakpoint_hit'] and row['no_replay'] and row['job']['phase']==phase and row['job']['half']==half and row['job']['outcome']=='interrupted' and status['op'] is None and status['machine']==('native' if half=='pull' else 'live-move-vm')
  run(['store','remove',store]);row['cleanup']='owned Store removed after child finished and fresh reads'
  ledger['rows'].append(row);save();print(name,row['pass'],flush=True)
