exec(open('/private/tmp/connect-followup-live-common.py').read())
assert json.loads((FIX/'home/layerfs.json').read_text())['id']=='8808d596621e08b6e60fe9b3049e5968'
inspection=subprocess.run(['docker','inspect','lfs-8808d596-docker','--format','{{json .Name}} {{json .Mounts}}'],capture_output=True,text=True,timeout=10)
assert inspection.returncode==0 and 'lfs-8808d596-docker-data' in inspection.stdout and '/private/tmp/connect137-linux-bundle' in inspection.stdout
(EVID/'cleanup-ownership.json').write_text(json.dumps({'source':'833d04cf:control/crates/layerfs-machine/src/spec.rs:76-83 derives lfs-<homeid first8>-docker','owned_home':str(FIX/'home'),'home_id':'8808d596621e08b6e60fe9b3049e5968','container':'lfs-8808d596-docker','inspect':inspection.stdout,'initial_auto_review_rejection':'Generic docker machine stop rejected until exclusive home-scoped ownership established. Fresh home id plus source naming and exact container mounts establish ownership.'},indent=2))
cleanup={'calls':[],'fixture':str(FIX),'retained_evidence':str(EVID)}
def c(args):
 r=subprocess.run([CLI,*args],env=ENV,capture_output=True,text=True,timeout=110);cleanup['calls'].append({'argv':args,'exit':r.returncode,'stdout':r.stdout,'stderr':r.stderr});(EVID/'cleanup.json').write_text(json.dumps(cleanup,indent=2))
 if r.returncode:raise RuntimeError(r.stderr)
 return json.loads(r.stdout) if r.stdout.strip() else None
stores=c(['store','list']);print(stores)
for item in stores.get('stores',stores.get('items',[])):
 name=item['name'];assert name=='probe',f'unexpected still-owned/shared Store {name}'
 c(['store','status',name]);c(['store','get',name]);c(['store','remove',name])
assert c(['store','list']).get('stores',[])==[]
c(['machine','status','live-move-vm']);c(['machine','stop','live-move-vm']);c(['machine','remove','live-move-vm']);c(['machine','status','docker']);c(['machine','stop','docker']);c(['machine','list'])
import shutil
shutil.rmtree(FIX);cleanup['fixture_removed']=not FIX.exists();cleanup['verdict']='PASS';cleanup['protected']=[CLI,'/private/tmp/connect137-linux-bundle'];(EVID/'cleanup.json').write_text(json.dumps(cleanup,indent=2));print('cleanup PASS')
