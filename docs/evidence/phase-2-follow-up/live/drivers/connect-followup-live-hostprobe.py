exec(open('/private/tmp/connect-followup-live-common.py').read())
run(['store','push','probe','docker'])
args=['/Users/yifanxu/.nvm/versions/node/v24.21.0/bin/node','/private/tmp/connect-followup-live-host.mjs',str(FIX/'home'),str(FIX/'states'/'host-probe'),'pull','probe','native','253',str(EVID/'host-probe')]
r=subprocess.run(args,env=ENV,capture_output=True,text=True,timeout=115);print(r.returncode,r.stdout,r.stderr)
