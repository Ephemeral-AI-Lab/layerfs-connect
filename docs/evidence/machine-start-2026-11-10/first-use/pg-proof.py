"""One bounded PostgreSQL real-provider proof; no replay, private owned resources."""
import base64, hashlib, json, os, secrets, subprocess, sys, tempfile, time, uuid
from pathlib import Path
OUT=Path(__file__).resolve().parent
CLI=Path('/Users/yifanxu/Ephemeral-AI-Lab/layerfs-machine-start/target/debug/layerfs')
BUNDLE=Path('/Users/yifanxu/Ephemeral-AI-Lab/layerfs-connect/.cache/layerfs-bundles/833d04cf44e8e747929d50ab1170a48260d9381c/2.0.0/linux-aarch64')
CACHE='/Users/yifanxu/.cache/layerfs-worktrees/layerfs-machine-start-c17e354c8815/image-cache'
statefile=OUT/'pg-state.json'

def external(command,**kwargs):
    return subprocess.run(command,capture_output=True,text=True,timeout=40,check=True,**kwargs)

if sys.argv[1]=='setup':
    root=Path(tempfile.mkdtemp(prefix='lfs-pg-speed-'));root.chmod(0o700)
    name='lfs-pg-speed-'+uuid.uuid4().hex[:10]
    password=secrets.token_hex(24); secret=root/'password';secret.write_text(password);secret.chmod(0o600)
    envfile=root/'pg.env';envfile.write_text('POSTGRES_USER=proof\nPOSTGRES_DB=proof\nPOSTGRES_PASSWORD='+password+'\n');envfile.chmod(0o600)
    value={'root':str(root),'container':name,'status':'creating','owner':'machine-start-artifacts','cli':str(CLI),'cli_sha256':hashlib.sha256(CLI.read_bytes()).hexdigest(),'bundle':str(BUNDLE),'providers':{}}
    statefile.write_text(json.dumps(value,indent=2))
    t=time.perf_counter_ns()
    result=external(['docker','run','-d','--pull=never','--name',name,'--label','layerfs.owner=machine-start-artifacts','--env-file',str(envfile),'-p','127.0.0.1::5432','postgres:17-bookworm','-c','fsync=off','-c','synchronous_commit=off','-c','full_page_writes=off'])
    value['id']=result.stdout.strip();value['container_start_ns']=time.perf_counter_ns()-t;statefile.write_text(json.dumps(value,indent=2))
    ports=json.loads(external(['docker','inspect',name,'--format','{{json .NetworkSettings.Ports}}']).stdout)
    value['port']=int(ports['5432/tcp'][0]['HostPort'])
    deadline=time.monotonic()+20
    while time.monotonic()<deadline:
        r=subprocess.run(['docker','exec',name,'pg_isready','-U','proof','-d','proof'],capture_output=True,timeout=5)
        if r.returncode==0:break
        time.sleep(.2)
    else:raise RuntimeError('dedicated PostgreSQL did not become ready')
    value['status']='ready';statefile.write_text(json.dumps(value,indent=2));print(json.dumps({k:v for k,v in value.items() if k not in ['providers']},indent=2));sys.exit()

variant=sys.argv[1];provider='apple-container' if variant=='apple-bridge' else variant;state=json.loads(statefile.read_text())
if variant=='apple-bridge':state={**state,'container':state['bridge']['container'],'port':state['bridge']['port']}
root=Path(state['root'])/variant;root.mkdir(exist_ok=True)
home=root/'home';fixture=root/'fixture';fixture.mkdir();marker=uuid.uuid4().hex;(fixture/'proof.txt').write_text(marker+'\n')
machine='docker' if provider=='docker' else 'pg-'+('apple' if provider=='apple-container' else 'lima')
if provider=='docker':
    isolation=json.loads((OUT/'docker-isolation-precheck.json').read_text())
    assert str(home)==isolation['home']
    assert json.loads((home/'layerfs.json').read_text())['id']==isolation['home_id']
    assert isolation['worker']=='lfs-'+isolation['home_id'][:8]+'-docker'
    existing=external(['docker','ps','-a','--format','{{.Names}}']).stdout.splitlines()
    assert isolation['worker'] not in existing, 'owned worker must be absent before first start'
password=(Path(state['root'])/'password').read_text()
env={**os.environ,'LAYERFS_HOME':str(home),'LAYERFS_BUNDLE':str(BUNDLE),'XDG_CACHE_HOME':CACHE,'LAYERFS_PG_SPEED_PASSWORD':password,'LAYERFS_CONSTRUCTION_WORKERS':'1'}
receipt={'provider':provider,'variant':variant,'root':str(root),'home':str(home),'machine':machine,'cache':'installed artifacts; uncontrolled host page cache, exploratory only','marker':marker,'steps':[],'status':'running','budget_seconds':110}
path=OUT/('postgres-'+variant+'.json');deadline=time.monotonic()+110

def save():path.write_text(json.dumps(receipt,indent=2))
def call(*args):
    started=time.perf_counter_ns();remaining=deadline-time.monotonic()
    if remaining<=0:raise TimeoutError('provider proof budget exhausted')
    row={'args':list(args)}
    try:
        r=subprocess.run([str(CLI),*args],env=env,capture_output=True,text=True,timeout=min(90,remaining))
        row.update(wall_ns=time.perf_counter_ns()-started,exit=r.returncode)
        if r.returncode:row['error']=r.stderr.replace(password,'[REDACTED]')
        if '--progress' in args:row['progress']=r.stderr
        receipt['steps'].append(row);save()
        print(provider,' '.join(args[:2]),r.returncode,f'{row["wall_ns"]/1e9:.3f}s',flush=True)
        if r.returncode:raise RuntimeError(row.get('error'))
        return json.loads(r.stdout)
    except subprocess.TimeoutExpired:
        row.update(wall_ns=time.perf_counter_ns()-started,outcome='Unknown');receipt['steps'].append(row);save();raise

def verify(value):
    assert marker in json.dumps(value) or marker in str(base64.b64decode(value.get('bytes',{}).get('base64',''))),value
try:
    save()
    # Each provider owns a separate database; no shared schema or existing server mutation.
    db='proof_'+variant.replace('-','_')
    external(['docker','exec',state['container'],'createdb','-U','proof',db])
    call('store','connect','pg',f'postgresql://proof@127.0.0.1:{state["port"]}/{db}?sslmode=disable','--password','env:LAYERFS_PG_SPEED_PASSWORD','--synchronous-commit','off')
    if provider=='docker':call('machine','start','docker','--progress')
    else:call('machine','create',machine,provider,'--cpus','2','--memory','4G','--disk','4G','--progress')
    call('project','init','pg/app',str(fixture));call('branch','fork','pg/app','verify','main')
    call('sandbox','create','pg/app','box',machine)
    call('workspace','mount','box','verify','--name','verify')
    result=call('workspace','exec','box:verify',f'cat proof.txt && printf "{marker}\\n" > result.txt')
    assert result['exit_code']==0 and marker in result['stdout'],result
    call('workspace','commit','box:verify','--message','PostgreSQL provider proof');verify(call('file','read','pg/app','verify','/result.txt'))
    call('workspace','unmount','box:verify');call('sandbox','close','box')
    call('machine','stop',machine);call('machine','start',machine,'--progress')
    call('sandbox','create','pg/app','restart',machine);call('workspace','mount','restart','verify','--name','verify')
    result=call('workspace','exec','restart:verify','cat result.txt');assert marker in result['stdout'] and result['exit_code']==0,result
    call('workspace','unmount','restart:verify');call('sandbox','close','restart')
    call('store','disconnect','pg');call('machine','stop',machine)
    if provider!='docker':call('machine','remove',machine)
    receipt['status']='PASS';receipt['cleaned']=provider!='docker';save()
except BaseException as error:
    receipt['status']='FAILED';receipt['failure']=str(error).replace(password,'[REDACTED]');save();raise
