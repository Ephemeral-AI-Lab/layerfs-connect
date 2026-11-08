# macOS desktop package

From `desktop/`, using Node.js 24 or newer:

```sh
pnpm package:mac
# Also create a ZIP:
pnpm package:mac --zip
```

The command compiles the UI and writes `dist/mac-<arch>/LayerFS Connect.app`.
Open it in Finder or with `open 'dist/mac-arm64/LayerFS Connect.app'` on Apple Silicon.
Verify the bundled host with a deterministic local model:

```sh
node tools/smoke-package.mjs 'dist/mac-arm64/LayerFS Connect.app'
node tools/smoke-settings.mjs 'dist/mac-arm64/LayerFS Connect.app'
```

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
Use the bottom Settings toggle, then Models in the secondary sidebar to sign in, save an API key or custom endpoint,
choose a model, and test the connection. Start a chat uses that saved selection.

This command makes a local, ad-hoc signed macOS app for the build machine's
architecture. Public distribution still needs Developer ID signing and
notarization. Other platforms and architectures require their own builds.

Packaging follows Electron's [manual distribution layout](https://www.electronjs.org/docs/latest/tutorial/application-distribution).

Tools, Agents and Hooks in the secondary Settings sidebar inspect and update
the bundled Pi configuration. Tools reports the installed pi-subagents version.
Agents shows configured tool lists, base prompt definitions and hooks. Required
controls remain locked; configuration changes wait for active chats to stop.
