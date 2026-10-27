# LayerFS Connect

The LayerFS desktop app. It runs on the real LayerFS: a local SQLite Store per
project in a Docker volume, and Docker Sandboxes. Its projects are ten scripted
demos (tour, parallel, conflicts, merge, sandbox, agents, checkpoints, shop,
depot, crew). Each demo has one LayerFS project, named after it. A new
session resets it (removed, then Inited again from the demo's fixture) and
plays the demo's agents, which have only bash and the subagent tools, as in
dsh-layerfs; earlier sessions stay listed with their conversations. A
project's page shows its Live view (agents, project, Sandboxes and
Workspaces), History and Storage from the newest session; a session's page
shows its conversation. There is no language model: every call comes from
the scenario, and every call really runs.

Not implemented: PostgreSQL and cloud storage, and native and cloud compute.
Those pages show them disabled.

## Layout

```
host/          the backend: a plain Node process the app starts (host/README.md)
  runs/        scenario engine: agents, bash and subagent tools, jobs, expect checks
  parse/       splits every agent call into classified segments (workspace, fs, branch, …)
  checks/      final checks of a finished replay against its recording
scenarios/     the ten demos (scenarios/README.md)
fixtures/      the demo workspace most demos Init from
tools/         scenario tools: port, replay convert/check, connect-run
src/
  main/        Electron main process: starts the host, opens windows
  preload/     hands the host's address to the renderer
  shared/      host-api.ts, the host ↔ renderer contract
  renderer/    React UI: projects (demos), runs, files, history, storage, compute
```

## Where LayerFS comes from

Connect never installs into or edits the LayerFS repository. `package.json`
links `@layerfs/*` to the LayerFS checkout beside this repo
(`../layerfs/api/…`), and the host and every agent's bash call load
`host/resolve-layerfs.js`, so `@layerfs/*` resolves from Connect's
`node_modules`. The macOS worker runs a sealed Linux LayerFS build, named in
`~/.layerfs-connect/settings.json`:

```json
{ "image": "sha256:…", "bundle": "/path/to/build-linux-…", "containerPrefix": "lfc-" }
```

Connect keeps its own LayerFS home (`~/.layerfs-connect/home`) and container
prefix, so its worker (`lfc-worker`), Sandboxes and volumes never meet another
integration's.

## Develop

Needs Node 22.15 or later, pnpm, Docker and `jq`.

```bash
pnpm install
pnpm dev         # app with hot reload
pnpm typecheck
pnpm build       # production build into out/
pnpm start       # run the production build
```

Host tests (each command stays under two minutes):

```bash
node --import ./host/resolve-layerfs.js --test host/test/*.test.js tools/checks/tests/*.test.mjs
```

Run demos without the window:

```bash
node --import ./host/resolve-layerfs.js host/run-demo.js tour
```

Drive the running app's host from a terminal (it writes
`~/.layerfs-connect/host.json`):

```bash
node tools/connect-run.mjs start tour merge
```

Dev aids: `CONNECT_VIEW=<hash>` opens a page (`projects/<demo>[/<tab>]`,
`runs/<run id>[/<agent>]` for a session, `storage`, `compute`); `CONNECT_SHOT=<file.png>` saves a
screenshot once loaded, then quits (`CONNECT_SHOT_DELAY` waits longer;
`CONNECT_EVAL=<js>` runs in the page first and prints its result);
`CONNECT_THEME=dark|light`.
