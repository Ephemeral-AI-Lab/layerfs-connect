import os,json,subprocess,pathlib,time,hashlib
ROOT=pathlib.Path('/Users/yifanxu/Ephemeral-AI-Lab/layerfs-connect');EVID=ROOT/'docs/evidence/phase-2-follow-up/live'
FIX=pathlib.Path(json.loads((EVID/'fixture.json').read_text())['path'])
CLI='/Users/yifanxu/Ephemeral-AI-Lab/layerfs-connect-cli-137/target/debug/layerfs'
ENV={**os.environ,'LAYERFS_HOME':str(FIX/'home'),'LAYERFS_PROGRESS_JSON':'1','LAYERFS_CONSTRUCTION_WORKERS':'1','LAYERFS_CONNECT_CLI':CLI,'LAYERFS_BUNDLE':'/private/tmp/connect137-linux-bundle/2.0.0/linux-aarch64'}
ledger=json.loads((EVID/'live-ledger.json').read_text())
def save(): (EVID/'live-ledger.json').write_text(json.dumps(ledger,indent=2))
def run(args,ok=True,timeout=110):
 r=subprocess.run([CLI,*args],env=ENV,capture_output=True,text=True,timeout=timeout)
 rec={'argv':args,'exit':r.returncode,'stdout':r.stdout,'stderr':r.stderr};ledger['calls'].append(rec);save()
 if ok and r.returncode:raise RuntimeError(json.dumps(rec))
 return json.loads(r.stdout) if r.stdout.strip() else None
