exec(open('/private/tmp/connect-followup-live-common.py').read())
args=[CLI,'machine','create','live-move-vm','lima','--cpus','2','--memory','2G','--disk','8G']
r=subprocess.run(args,env=ENV,capture_output=True,text=True,timeout=115)
(EVID/'move-vm-setup.json').write_text(json.dumps({'argv':args,'exit':r.returncode,'stdout':r.stdout,'stderr':r.stderr},indent=2))
print(r.returncode,r.stdout,r.stderr)
