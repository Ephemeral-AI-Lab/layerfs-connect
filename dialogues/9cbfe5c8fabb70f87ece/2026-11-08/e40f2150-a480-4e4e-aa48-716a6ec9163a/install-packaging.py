from pathlib import Path
import json
import shutil

root = Path('/Users/yifanxu/Ephemeral-AI-Lab/layerfs-connect')
desktop = root / 'desktop'
main = desktop / 'src/main/index.ts'
text = main.read_text()
old = "// The LayerFS host lives in the repository's host/ folder, next to desktop/.\nconst host = new LayerfsHost(join(app.getAppPath(), '..', 'host'), (message: LayerfsStreamMessage) => {\n  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('layerfs:stream', message)\n})"
new = """// Packaged apps carry their own host, production dependencies and Node runtime.
// Development keeps using the repository's host/ folder beside desktop/.
const hostDir = app.isPackaged
  ? join(process.resourcesPath, 'backend', 'host')
  : join(app.getAppPath(), '..', 'host')
const runtimeBin = app.isPackaged ? join(process.resourcesPath, 'runtime', 'bin') : null
const host = new LayerfsHost(hostDir, (message: LayerfsStreamMessage) => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('layerfs:stream', message)
}, runtimeBin)
""".rstrip()
assert old in text
main.write_text(text.replace(old, new))

bridge = desktop / 'src/main/layerfs-host.ts'
text = bridge.read_text().replace("import { join } from 'node:path'", "import { delimiter, join } from 'node:path'")
text = text.replace("    private readonly onStream: (message: LayerfsStreamMessage) => void,\n", "    private readonly onStream: (message: LayerfsStreamMessage) => void,\n    private readonly runtimeBin: string | null = null,\n")
text = text.replace("const node = process.env.LAYERFS_CONNECT_NODE || 'node'", "const node = process.env.LAYERFS_CONNECT_NODE || (this.runtimeBin ? join(this.runtimeBin, 'node') : 'node')")
text = text.replace("env: { ...process.env, LAYERFS_CONNECT_MODE: mode, UV_THREADPOOL_SIZE: process.env.UV_THREADPOOL_SIZE || '16' },", """env: {
          ...process.env,
          ...(this.runtimeBin ? {
            PATH: `${this.runtimeBin}${delimiter}${process.env.PATH ?? '/usr/bin:/bin:/usr/sbin:/sbin'}`,
            LAYERFS_CONNECT_CLI: process.env.LAYERFS_CONNECT_CLI || join(this.runtimeBin, 'layerfs'),
            LAYERFS_CONNECT_DAEMON: process.env.LAYERFS_CONNECT_DAEMON || join(this.runtimeBin, 'layerfs-daemon'),
          } : {}),
          LAYERFS_CONNECT_MODE: mode,
          UV_THREADPOOL_SIZE: process.env.UV_THREADPOOL_SIZE || '16',
        },""")
bridge.write_text(text)
tools = desktop / 'tools'
tools.mkdir(exist_ok=True)
shutil.copyfile(Path(__file__).parent / 'package-macos.mjs', tools / 'package-macos.mjs')
manifest = desktop / 'package.json'
data = json.loads(manifest.read_text())
data['scripts']['package:mac'] = 'pnpm build && node tools/package-macos.mjs'
manifest.write_text(json.dumps(data, indent=2) + '\n')
(desktop / 'PACKAGING.md').write_text("""# macOS desktop package

From `desktop/`, using Node.js 24 or newer:

```sh
pnpm package:mac
# Also create a ZIP:
pnpm package:mac --zip
```

The command compiles the UI and writes `dist/mac-<arch>/LayerFS Connect.app`.
Open it in Finder or with `open 'dist/mac-arm64/LayerFS Connect.app'` on Apple Silicon.
Root and desktop dependencies must already be installed. The linked LayerFS
checkout must have its native addon, CLI and daemon built. Set
`LAYERFS_CONNECT_CLI` and `LAYERFS_CONNECT_DAEMON` to select other native binaries.

The app includes Electron, a private Node runtime, the host, its installed Pi
dependency graph, the LayerFS addon/CLI/daemon, and scenario resources. Backend
dependency links remain inside the app. It needs neither a source checkout nor
system Node. The host runs as a child process and exits when the desktop quits.

The app opens in simulated LayerFS mode, with state under
`~/.layerfs-connect-desktop-sim`. To select real LayerFS, launch its executable
with `LAYERFS_CONNECT_MODE=real`; real mode uses the host's existing real state.
Model credentials remain in the user's state folder and are never packaged.
The new desktop's Settings page is still a placeholder; packaging does not add
a model configuration interface.

This command makes a local, ad-hoc signed macOS app for the build machine's
architecture. Public distribution still needs Developer ID signing and
notarization. Other platforms and architectures require their own builds.

Packaging follows Electron's [manual distribution layout](https://www.electronjs.org/docs/latest/tutorial/application-distribution).
""")
print('Added bundled-host runtime paths and macOS packaging command.')
