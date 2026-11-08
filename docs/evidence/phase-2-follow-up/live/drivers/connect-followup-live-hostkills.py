exec(open('/private/tmp/connect-followup-live-common.py').read())
for kind in ['push','pull']:
 for phase,line in [('snapshot',253),('record',340),('retire',368)]:
  name='host-'+kind+'-'+phase;store='live-'+name
  run(['store','create',store]);run(['project','init',store+'/p',str(FIX/'input')])
  if kind=='pull':run(['store','push',store,'docker'])
  state=str(FIX/'states'/name);base=str(EVID/name)
  args=['/Users/yifanxu/.nvm/versions/node/v24.21.0/bin/node','/private/tmp/connect-followup-live-hostkill.mjs',str(FIX/'home'),state,kind,store,'docker',str(line),base]
  r=subprocess.run(args,env=ENV,capture_output=True,text=True,timeout=115)
  deadline=time.time()+20
  while time.time()<deadline:
   log=pathlib.Path(base+'.debug.log').read_text() if pathlib.Path(base+'.debug.log').exists() else ''
   if ('exited with status = 0' in log or 'exited with status = 125' in log):break
   time.sleep(.05)
  restart=subprocess.run(['/Users/yifanxu/.nvm/versions/node/v24.21.0/bin/node','/private/tmp/connect-followup-live-reconcile.mjs',str(FIX/'home'),state,base+'.json'],env=ENV,capture_output=True,text=True,timeout=20)
  status=run(['store','status',store]);data=json.loads(pathlib.Path(base+'.json').read_text())
  row={'id':name,'host_exit':r.returncode,'debugger_cli_completed':('exited with status = 0' in log or 'exited with status = 125' in log),'breakpoint_hit':'stop reason = breakpoint' in log,'restart_exit':restart.returncode,'status':status,'no_replay':data['mutations']==0,'phase':phase,'job':data['jobs'][0]}
  row['pass']=r.returncode==-9 and row['debugger_cli_completed'] and row['breakpoint_hit'] and row['no_replay'] and row['job']['phase']==phase and row['job']['outcome']=='interrupted' and status['op'] is None
  run(['store','remove',store]);row['cleanup']='owned Store removed after child completed and fresh reads'
  ledger['rows'].append(row);save();print(name,row['pass'],flush=True)
