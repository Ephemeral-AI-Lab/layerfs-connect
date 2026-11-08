import os,subprocess,pathlib,json
root=pathlib.Path('/tmp/connect-followup-native-20261109');root.mkdir(exist_ok=True)
env=dict(os.environ,HOME=str(root/'user-home'),LAYERFS_CONNECT_STATE=str(root/'state'),LAYERFS_CONNECT_MODE='real',LAYERFS_CONNECT_NODE=os.path.expanduser('~/.nvm/versions/node/v24.21.0/bin/node'),LAYERFS_CONNECT_CLI='/Users/yifanxu/Ephemeral-AI-Lab/layerfs-connect-cli-137/target/debug/layerfs',LAYERFS_CONNECT_DAEMON='/Users/yifanxu/Ephemeral-AI-Lab/layerfs-connect-cli-137/target/debug/layerfs-daemon')
(root/'user-home').mkdir(exist_ok=True)
cmd=['/Users/yifanxu/Ephemeral-AI-Lab/layerfs-connect/desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron','--remote-debugging-port=19325','--inspect=19326','--user-data-dir='+str(root/'electron-data'),'/Users/yifanxu/Ephemeral-AI-Lab/layerfs-connect/desktop']
with open(root/'electron.log','w') as f:
 p=subprocess.Popen(cmd,env=env,stdout=f,stderr=f)
(root/'pid').write_text(str(p.pid));print(json.dumps({'pid':p.pid,'root':str(root),'cmd':cmd}))
