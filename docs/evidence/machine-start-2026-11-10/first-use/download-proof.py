"""Single uncached public stock-image acquisition into owned empty directories."""
import concurrent.futures, hashlib, json, subprocess, tempfile, time
from pathlib import Path
OUT=Path(__file__).resolve().parent
root=Path(tempfile.mkdtemp(prefix='lfs-download-speed-'));root.chmod(0o700)
receipt={'root':str(root),'cache':'empty owned destination, full HTTP GET, no range/resume; network/CDN caches uncontrolled','scope':'stock OS image acquisition only; provider prerequisites and LayerFS runtime/prepared-image distribution excluded','status':'running','steps':[]}
path=OUT/'downloads.json'
def save():path.write_text(json.dumps(receipt,indent=2))
def get(url,destination,headers=None):
    args=['curl','--fail','--location','--silent','--show-error','--retry','0','--connect-timeout','15','--max-time','110','--output',str(destination),'--write-out','%{json}']
    if headers:args+=['--header','@'+str(headers)]
    t=time.perf_counter_ns();r=subprocess.run([*args,url],capture_output=True,text=True,timeout=115)
    row={'url':url,'destination':str(destination),'wall_ns':time.perf_counter_ns()-t,'exit':r.returncode,'bytes_on_disk':destination.stat().st_size if destination.exists() else 0}
    if r.stdout:
        values=json.loads(r.stdout);row['transfer']={k:values.get(k) for k in ['size_download','speed_download','time_namelookup','time_connect','time_appconnect','time_starttransfer','time_total','http_code','num_redirects']}
    if r.returncode:row['error']=r.stderr
    receipt['steps'].append(row);save()
    if r.returncode:raise RuntimeError('download failed: '+r.stderr)
    return row

def apple():
    folder=root/'apple';folder.mkdir();t=time.perf_counter_ns()
    tokenfile=folder/'auth.json';get('https://auth.docker.io/token?service=registry.docker.io&scope=repository:library/debian:pull',tokenfile)
    token=json.loads(tokenfile.read_text())['token'];tokenfile.unlink()
    header=folder/'headers';header.write_text('Authorization: Bearer '+token+'\nAccept: application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.manifest.v1+json\n');header.chmod(0o600)
    base='https://registry-1.docker.io/v2/library/debian/'
    get(base+'manifests/trixie-slim',folder/'index.json',header)
    index=json.loads((folder/'index.json').read_text())
    entry=next(m for m in index['manifests'] if m.get('platform',{}).get('os')=='linux' and m['platform'].get('architecture')=='arm64')
    digest=entry['digest'];get(base+'manifests/'+digest,folder/'manifest.json',header)
    assert 'sha256:'+hashlib.sha256((folder/'manifest.json').read_bytes()).hexdigest()==digest
    manifest=json.loads((folder/'manifest.json').read_text());blobs=[manifest['config'],*manifest['layers']]
    def blob(item):
        file=folder/item['digest'].split(':')[1];get(base+'blobs/'+item['digest'],file,header)
        assert file.stat().st_size==item['size']
        assert 'sha256:'+hashlib.sha256(file.read_bytes()).hexdigest()==item['digest']
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:list(pool.map(blob,blobs))
    header.unlink()
    receipt['apple']={'manifest':digest,'bytes':sum(b['size'] for b in blobs),'network_acquisition_ns':time.perf_counter_ns()-t,'digest_verified':True,'provider_import':'NOT_RUN: shared Apple image store already contains Debian layers; no cache purged'};save();print('Apple stock OCI acquisition',json.dumps(receipt['apple']),flush=True)

def lima():
    folder=root/'lima';folder.mkdir();base='https://cloud-images.ubuntu.com/releases/24.04/release/'
    get(base+'SHA256SUMS',folder/'SHA256SUMS')
    name='ubuntu-24.04-server-cloudimg-arm64.img'
    expected=next(line.split()[0] for line in (folder/'SHA256SUMS').read_text().splitlines() if line.split()[-1].lstrip('*')==name)
    row=get(base+name,folder/name)
    t=time.perf_counter_ns();actual=hashlib.file_digest((folder/name).open('rb'),'sha256').hexdigest();assert actual==expected
    receipt['lima']={'url':base+name,'path':str(folder/name),'bytes':row['bytes_on_disk'],'download_ns':row['wall_ns'],'sha256':actual,'digest_verified':True,'verification_ns':time.perf_counter_ns()-t};save();print('Lima stock OS acquisition',json.dumps(receipt['lima']),flush=True)
try:
    save();apple();lima();receipt['status']='PASS';save()
except BaseException as error:
    receipt['status']='FAILED';receipt['failure']=str(error);save();raise
