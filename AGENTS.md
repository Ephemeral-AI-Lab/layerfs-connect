# Agent notes

## Study LayerFS and discuss the design before implementation

Before starting implementation, read and study LayerFS's `layerfs_v2_0_0`
branch: https://github.com/Ephemeral-AI-Lab/layerfs/tree/layerfs_v2_0_0.
The branch name is `layerfs_v2_0_0` (not `layerfs_v_2_0_0`); it is a Git
branch, not a document or directory.

Use the local repository `/Users/yifanxu/Ephemeral-AI-Lab/layerfs` to read it
without switching its checkout or changing another session's work. For example:

```sh
git -C /Users/yifanxu/Ephemeral-AI-Lab/layerfs show origin/layerfs_v2_0_0:docs/architecture/api/sdk/README.md
git -C /Users/yifanxu/Ephemeral-AI-Lab/layerfs show origin/layerfs_v2_0_0:docs/architecture/api/front-ends/cli.md
```

Read the relevant per-call pages under `docs/architecture/api/sdk/` on that
branch as well (for example `machine/get.md`, `sandbox/list.md` and
`sandbox/get.md`). Connect's `docs/layerfs-2.0-integration.md` and
`docs/layerfs-model.md` explain how the app uses those APIs; LayerFS's source
wins if they disagree.

Use those sources to understand LayerFS 2.0's design, supported APIs, commands,
and constraints. Discuss the proposed design with the user before making
implementation changes. If a named source cannot be found locally or on the
linked branch, report it and clarify its location before proceeding.

## UI development: use the web preview first

LayerFS Connect is a desktop app, but agents normally work entirely through its
web preview. Do not launch, control, restart, or test the desktop app unless the
user explicitly requests desktop verification. Use the browser to inspect,
adjust, and interact with the UI. The current
desktop UI lives in `desktop/src/renderer/`; the root `src/renderer/` belongs to
the older app. Make changes in the current UI unless the task names the older app.

- Start the preview from the repository root with `pnpm --dir desktop web`.
  Use a compatible Node version (Node 24 is installed on this machine).
- Open `http://127.0.0.1:1025/` (or `http://localhost:1025/`). The preview runs the same renderer components
  as Electron and starts a real LayerFS host with a private preview home.
  Set `LAYERFS_CONNECT_CLI` to an absolute pinned CLI and optionally
  `LAYERFS_CONNECT_DAEMON` to its matching daemon before starting. There is no
  mode selector or fallback. `LFS_STATE` can select a persistent private preview root.
  Do not build a separate demo page or duplicate the desktop UI for browser tests.
- Use the browser tools available in the session to navigate and play with the
  actual UI. Reuse an existing preview server when it belongs to this checkout;
  The server binds to `127.0.0.1` on fixed port 1025 with `strictPort: true`;
  it must fail rather than switch ports. Do not kill another session's process to claim it.
- For chat work, use a real saved chat or create a disposable chat with a configured
  model. There are no built-in Example chats or fabricated resource views.
- Iterate in the browser: reproduce the relevant state, change the renderer,
  wait for hot reload, and exercise the changed flow. Click tabs and menus,
  open files, switch branches, type into inputs, and check loading, empty and
  error states when relevant. Check browser console errors and inspect the
  rendered result; a screenshot alone does not verify an interaction.
- Verify at desktop window sizes (for example 1280×820 and 900×600). For macOS
  spacing in the preview, put `?mac=1` before the hash, for example
  `http://localhost:1025/?mac=1#/machines`.
- Keep shared views shared: chat Files and Storage project Files use
  `desktop/src/renderer/src/components/files/`. Update the relevant `docs/ui/*.md`
  spec alongside UI changes.
- After renderer changes, run `pnpm --dir desktop -s typecheck` and
  `pnpm --dir desktop -s build`. Report the flows actually exercised and any
  behavior that remains unverified.
- For native behavior (preload/IPC, window chrome, vibrancy, native dialogs,
  app lifecycle, packaging, or other desktop integrations), inspect the code
  and use relevant non-GUI checks. State what the browser cannot verify;
  do not launch the desktop app to fill that gap without an explicit user
  request. Only when the user requests desktop verification, start Electron
  with `pnpm --dir desktop dev` and check the requested behavior.

## Root app and host notes

The commands below run from the repository root and apply to the root app or
shared host. For the current desktop renderer, use the commands above.

- Typecheck: `pnpm -s typecheck`
- Tests: `node --test test/*.test.mjs` (a bare `node --test test/` fails on Node 24)
- Build: `pnpm -s build`
- Headless screenshots: `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new
  --window-size=1280,760 --virtual-time-budget=8000 --screenshot=/tmp/x.png "<url>"`. The app uses one fixed Cindy-inspired light theme; verify the browser preview at desktop window sizes.
- UI specs live in `docs/ui/*.md`: ASCII layout diagrams with numbered regions and little prose (conventions in
  `docs/ui/README.md`); update the page's spec with its code.
- Real Live fixtures on the running app: `node tools/live-fixtures.mjs setup | play [<project>…] | status | teardown`
  (`live-*` SQLite Stores on native/docker/lima1/lima2; PostgreSQL Stores in a Docker `live-pg` container on
  127.0.0.1:55442 whose Sandboxes run in lima1/lima2/docker, reached through LayerFS's loopback rewrite).
  Only `shop` and `conflicts` play as chats on 2.0, and Live shows only chats, not `/api/demos` runs.
  `node tools/live-fixtures.mjs matrix [shop|conflicts]` plays both on lima1/lima2 with a SQLite Store there and
  with a PostgreSQL Store, waits for every verdict and exits 1 on a failure (after `setup`, with the app running).
  PostgreSQL Stores need the linked addon built with the feature, then an app restart (in ../layerfs-v2-merge:
  `cargo +1.85.1 build --offline --locked --release -p layerfs-node --features layerfs-node/postgresql`, copy
  `target/release/liblayerfs_node.dylib` over `api/crates/layerfs-node/layerfs.node` by a rename; the CLI likewise
  with `-p layerfs-cli --features layerfs-cli/postgresql --bin layerfs`). The Linux bundle already has it.

## Conversation journals (host/sessions/)

- Unit: `node --test host/test/session-store.test.js`.
- Live (pinned CLI/daemon, private disposable homes, local deterministic model):
  `LAYERFS_CONNECT_LIVE_SESSIONS=1 LAYERFS_CONNECT_CLI=<pinned layerfs> LAYERFS_CONNECT_DAEMON=<pinned daemon> node --test --test-timeout=600000 host/test/session-live.test.js`;
  add `LAYERFS_CONNECT_LIVE_BUCKET_URL=http://127.0.0.1:<port>/<bucket>/<prefix>` with
  `LAYERFS_BUCKET_LIVEBK_ACCESS_KEY`/`_SECRET_KEY` for the backup/restore case (use an owned MinIO),
  and `LAYERFS_CONNECT_LIVE_DOCKER=1` (with `LAYERFS_BUNDLE` from `desktop/.env.local`) for the Store push case.
- Run host tests with the CLI from `desktop/.env.local` (the app's runtime); `agent-sdks.test.js` expects its call table.
- Browser: `node desktop/tools/smoke-chat-operations.mjs <mounted chat id> <sdk chat id>` against
  real preview chats. `pnpm` via corepack fails when `desktop/.env.local`'s `XDG_CACHE_HOME` is
  exported; start the preview with `./node_modules/.bin/vite --config vite.web.config.ts` from `desktop/`.
- Record: `docs/specs/chat-session-store-record.md`.
