import json,os,subprocess,tempfile,time
from pathlib import Path
OUT=Path(__file__).resolve().parent
dl=json.loads((OUT/'downloads.json').read_text());pg=json.loads((OUT/'pg-state.json').read_text())
root=Path(tempfile.mkdtemp(prefix='lfs-first-lima-'));root.chmod(0o700)
env={**os.environ,'LAYERFS_HOME':str(root/'home'),'LAYERFS_BUNDLE':pg['bundle'],'XDG_CACHE_HOME':str(root/'empty-cache'),'LAYERFS_CONSTRUCTION_WORKERS':'1'}
receipt={'root':str(root),'home':str(root/'home'),'name':'first-use','cli':pg['cli'],'bundle':pg['bundle'],'os_image':dl['lima']['path'],'os_sha256':dl['lima']['sha256'],'cache':'new home/cache/guest, newly downloaded stock OS; providers and Linux bundle already installed; uncontrolled host page cache','status':'running','steps':[]}
path=OUT/'lima-first-use.json'
def save():path.write_text(json.dumps(receipt,indent=2))
def call(*args):
 t=time.perf_counter_ns()
 try:r=subprocess.run([pg['cli'],*args],env=env,capture_output=True,text=True,timeout=90)
 except subprocess.TimeoutExpired:
  receipt['status']='Unknown';save();raise
 row={'args':args,'wall_ns':time.perf_counter_ns()-t,'exit':r.returncode,'stderr':r.stderr}
 receipt['steps'].append(row);save();print(' '.join(args[:2]),r.returncode,row['wall_ns']/1e9,flush=True)
 if r.returncode:raise RuntimeError(r.stderr)
 return json.loads(r.stdout)
try:
 save();ready=call('machine','create','first-use','lima','--cpus','2','--memory','4G','--disk','4G','--os-image',dl['lima']['path'],'--progress')
 assert ready['state']=='running';receipt['ready']=ready
 create_ns=receipt['steps'][0]['wall_ns'];receipt['download_plus_create_ns']=dl['lima']['download_ns']+create_ns
 call('machine','stop','first-use');call('machine','remove','first-use')
 receipt['status']='PASS';receipt['cleaned']=True;save()
except BaseException as error:
 receipt['status']='FAILED';receipt['failure']=str(error);save();raise
