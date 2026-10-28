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

## The UI

One window: a sidebar on the left, and on the right the page it picks
(`src/renderer/src/App.tsx`). A project and its sessions share one page; a
session opens inside its project.
Each screen has a file with an ASCII skeleton and its components in
[docs/ui/](docs/ui/README.md).

```
┌───────────────┬──────────────────────────────────────────────────────────┐
│ LayerFS Connect│  Page header: title, facts, actions                      │
│               │  Tab row                                                  │
│ ▸ LayerFS   2 │ ┌──────────────────────────────────────────────────────┐ │
│ ▸ Models      │ │                                                      │ │
│               │ │  The tab's content                                   │ │
│ + New session │ │                                                      │ │
│               │ │                                                      │ │
│ SESSIONS  All │ │                                                      │ │
│ ▾ playground  │ │                                                      │ │
│    /crew_2    │ └──────────────────────────────────────────────────────┘ │
│    /depot_2   │  (on a session: the composer)                            │
└───────────────┴──────────────────────────────────────────────────────────┘
```

### Sidebar (`components/app-sidebar.tsx`)

- **LayerFS**: opens the LayerFS page. Its count is the number of projects.
- **Models**: opens the Models dialog (`components/models/`), where the
  default model and its provider are set. The row shows the default model,
  or a warning when there is none or it has no key.
- **New session**: starts a session on a project, or makes a new project
  (`projects/new-project-dialog.tsx`).
- **Sessions**: one folder per project and, under it, its sessions, newest
  first. Each row shows a replay tag, its age and whether it is running. A
  project lists five, then "Show all". The filter shows all sessions or only
  running ones.

### LayerFS page

Three parts in one tab row (`components/layerfs-tabs.tsx`):

- **Projects** (`projects/projects-home.tsx`): a stats strip (projects,
  sessions, playing now, Commits) and a card per project with its Store, its
  last Commit and a New session button. A card opens the project.
- **Storage** (`storage/storage-page.tsx`): a list of where Stores can live
  (Local SQLite, then remote storage and sync locations, not available yet)
  and the chosen one's detail: the worker, disk space, the LayerFS box and a
  table of each project's Store volume.
- **Compute** (`compute/compute-page.tsx`): where runs execute. Docker, with
  its engine, socket and Sandboxes; native and cloud compute are shown
  disabled.

### Project page (`projects/project-view.tsx`)

The header names the project and carries the replay control. The tabs read
the project's newest session (wired in `runs/run-project-tabs.tsx` and
`runs/run-view.tsx`); Sessions (on the right) lists all of them.

- **Live** (`runs/live-tab.tsx`): what is happening now. A stats row, the
  agents on one side, the project in the middle with its Branches, the
  Sandboxes and Workspaces on the other, and calls flowing between them.
- **Timeline** (`projects/history-tab.tsx`, `TimelineTab`): the fork map
  over time (`history/fork-map.tsx`), replayable, with search and All / Open /
  Done filters. Main's Layers run along a spine, and each fork leaves its
  parent where it forked. A 3D view (`history/citadel.tsx`) and a castle game
  (`history/game/`) are built but hidden; `SHOW_VIEWS` in `history-tab.tsx`
  brings back their switch.
- **History** (`HistoryTab`): three panes. The Branch tree, the chosen
  Branch's Commits and Layers, and the chosen Commit's detail with the paths
  it changed. A Files switch shows the project's files instead
  (`projects/files-tab.tsx`).
- **Storage** (`ProjectStorage` in `projects/project-storage.tsx`): the Store on disk against the
  raw history, how dedupe and compression get there, and each Commit's size.
- **Sandboxes** (`ProjectSandboxes` in `projects/project-storage.tsx`): the
  project's Sandboxes and their Workspaces.
- **Sessions** (`runs/run-list.tsx`): every session of the project, with its
  state, agents and progress.

### Session page

A session opens inside its project's page (`SessionPage` in
`projects/project-view.tsx`, `runs/run-view.tsx`). The breadcrumb names the
project and the agent shown; the agent switcher moves between the lead and
its subagents.

- **Conversation** (`runs/conversation.tsx`): the agent's turns. What it says,
  its tool calls with LayerFS operations marked, subagents started and their
  replies.
- **Trace** (`runs/trace-view.tsx`): the same agent's steps as a list,
  grouped by turn, with each LayerFS write and its auto-checkpoints, which
  link into History.
- **Composer** (`runs/composer.tsx`): under the conversation. A message to
  the agent, `/scenario` to play a scenario, and the model for the next
  message.

### Look and motion

- **Theme:** colours, radii, shadows and motion are tokens in
  `src/renderer/src/styles.css`, with light and dark modes (the system's, or
  `CONNECT_THEME`).
- **Components:** shadcn components live in `components/ui/`. Shared motion
  (reveals, the sliding tab indicator, page cross-fades) lives in
  `components/motion/`.
- **Icons:** LayerFS icons are SVGs in `assets/icons/` (`lfs-icons.tsx`).

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
