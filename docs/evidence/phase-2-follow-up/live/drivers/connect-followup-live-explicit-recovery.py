exec(open('/private/tmp/connect-followup-live-common.py').read())
ledger={'calls':[],'rows':[]}
def save(): (EVID/'explicit-recovery-ledger.json').write_text(json.dumps(ledger,indent=2))
for kind in ['push','pull']:
 name='explicit-'+kind+'-record';store='live-'+name
 run(['store','create',store]);run(['project','init',store+'/p',str(FIX/'input')])
 if kind=='pull':run(['store','push',store,'docker'])
 args=['/Users/yifanxu/.nvm/versions/node/v24.21.0/bin/node','/private/tmp/connect-followup-live-recovery.mjs',str(FIX/'home'),str(FIX/'states'/name),kind,store,'docker','340',str(EVID/name)]
 r=subprocess.run(args,env=ENV,capture_output=True,text=True,timeout=115);print(name,r.returncode,r.stdout,r.stderr,flush=True)
 if r.returncode:raise RuntimeError('explicit recovery failed')
 d=json.loads((EVID/(name+'.json')).read_text());status=run(['store','status',store]);row={'id':name,'pass':d['second']['observation']['action']=='resolve' and d['recovered']['outcome']=='succeeded' and d['starts']==2 and status['op'] is None,'status':status}
 run(['store','remove',store]);row['cleanup']='owned Store removed';ledger['rows'].append(row);save()
