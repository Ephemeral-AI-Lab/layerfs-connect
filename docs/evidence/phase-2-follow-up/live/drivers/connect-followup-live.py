import os,json,subprocess,pathlib,tempfile,time,hashlib
ROOT=pathlib.Path('/Users/yifanxu/Ephemeral-AI-Lab/layerfs-connect')
EVID=ROOT/'docs/evidence/phase-2-follow-up/live'
EVID.mkdir(parents=True,exist_ok=True)
FIX=pathlib.Path(tempfile.mkdtemp(prefix='connect-followup-live-',dir='/private/tmp'))
CLI='/Users/yifanxu/Ephemeral-AI-Lab/layerfs-connect-cli-137/target/debug/layerfs'
ENV={**os.environ,'LAYERFS_HOME':str(FIX/'home'),'LAYERFS_PROGRESS_JSON':'1','LAYERFS_CONSTRUCTION_WORKERS':'1','LAYERFS_CONNECT_CLI':CLI}
ledger={'started':time.time(),'fixture':str(FIX),'identity':{'source':'833d04cf44e8e747929d50ab1170a48260d9381c','cli_sha256':hashlib.sha256(pathlib.Path(CLI).read_bytes()).hexdigest()},'calls':[],'rows':[]}
(FIX/'input').mkdir();(FIX/'input'/'proof.txt').write_text('owned live recovery fixture\n')
(EVID/'fixture.json').write_text(json.dumps({'path':str(FIX)},indent=2))
def save(): (EVID/'live-ledger.json').write_text(json.dumps(ledger,indent=2))
def run(args,ok=True,timeout=110):
 r=subprocess.run([CLI,*args],env=ENV,capture_output=True,text=True,timeout=timeout)
 rec={'argv':args,'exit':r.returncode,'stdout':r.stdout,'stderr':r.stderr};ledger['calls'].append(rec);save()
 if ok and r.returncode:raise RuntimeError(json.dumps(rec))
 return json.loads(r.stdout) if r.stdout.strip() else None
run(['machine','list'])
run(['machine','update','docker','--daemon','/private/tmp/connect137-linux-bundle/2.0.0/linux-aarch64/layerfs-daemon','--image','layerfs-352-runtime:node24-https-apt-20261024'])
run(['machine','start','docker'])
run(['store','create','probe'])
run(['project','init','probe/p',str(FIX/'input')])
print(FIX)
save()
