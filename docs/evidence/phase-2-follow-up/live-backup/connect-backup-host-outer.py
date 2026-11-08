import subprocess,os,json,time,pathlib
x=os.environ.copy();x['PATH']='/Users/yifanxu/.nvm/versions/node/v24.21.0/bin:'+x['PATH'];x['LAYERFS_CONNECT_CLI']='/Users/yifanxu/Ephemeral-AI-Lab/layerfs-connect-cli-137/target/debug/layerfs'
dir=pathlib.Path('/Users/yifanxu/Ephemeral-AI-Lab/layerfs-connect/docs/evidence/phase-2-follow-up/live-backup')
for kind,case,line,src in [('create','host-create-upload',168,'control/crates/layerfs-bucket/src/bucket/pieces.rs'),('restore','host-restore-install',118,'control/crates/layerfs-store/src/backup/restore.rs')]:
 r=subprocess.run(['node','/private/tmp/connect-backup-hostkill.mjs',kind,case,str(line),'/Users/yifanxu/Ephemeral-AI-Lab/layerfs-connect-cli-137/'+src],env=x,timeout=120)
 assert r.returncode==-9, r.returncode
 until=time.monotonic()+15
 while 'exited with status' not in (dir/(case+'.lldb.log')).read_text():
  assert time.monotonic()<until,'owned CLI final exit not observed'
  time.sleep(.05)
 subprocess.run(['node','/private/tmp/connect-backup-host-reconcile.mjs',case,str(r.returncode)],env=x,timeout=120,check=True)
