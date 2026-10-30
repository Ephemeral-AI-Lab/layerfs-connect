# Connect host

The host is Connect's backend: a plain Node process (system `node` ≥ 22.15,
ESM JavaScript, no build step) that the Electron main process starts. It runs
LayerFS through `@layerfs/runtime`, `@layerfs/agent` and `@layerfs/backend`,
and replays scripted demo scenarios on the real LayerFS: the local SQLite
Store and Docker Sandboxes. There are no language models: each agent's
calls come from its scenario. Agents have only `bash` and the subagent tools,
as in dsh-layerfs.

The renderer talks to the host over HTTP on 127.0.0.1 (JSON, bearer token)
and one server-sent event stream; the types are in
[`src/shared/host-api.ts`](../src/shared/host-api.ts). Change both together.

## Where LayerFS comes from

Connect never installs into or edits the LayerFS repository. `package.json`
links `@layerfs/{agent,backend,runtime,cli}` to the `api/` packages of a
LayerFS worktree at `main` beside this repo
(`../layerfs/.claude/worktrees/connect-main/api/...`), and every Node process Connect starts
loads [`resolve-layerfs.js`](resolve-layerfs.js) first (`node --import`, and
`NODE_OPTIONS=--import=…` in agents' bash calls), so `@layerfs/*` always
resolves from Connect's `node_modules`. The `layerfs` command in agents' bash
calls is a shim on PATH:
`node --import <host>/resolve-layerfs.js <api>/cli/src/layerfs.js "$@"`. `<api>` is the
folder those links point at (`config.js` `API`).

## Deployment ([`config.js`](config.js))

- State folder `~/.layerfs-connect` (`LAYERFS_CONNECT_STATE`):
  `settings.json`, the LayerFS home `home/` (0700), `runs/`.
- `settings.json`: `image` (runtime image digest), `bundle` (sealed Linux
  LayerFS build; macOS/Windows run the worker from it), `daemon`, `docker`,
  `containerPrefix` (default `lfc-`). Each also from `LAYERFS_CONNECT_<NAME>`.
- On macOS the runtime runs the home's worker container `<prefix>worker`
  (`lfc-worker`); every Store call goes there. Connect never touches another
  home's containers (dsh's are `layerfs-…`).
- `deploymentEnv(spec, project)` / `layerfsEnv` give an agent's bash call
  its `LAYERFS_*` settings: PROJECT, HOME, DOCKER, IMAGE, DAEMON, VOLUME,
  STORE_PATH, CONTAINER_PREFIX, WORKER_ENDPOINT. The run adds LAYERFS_TRACE,
  LAYERFS_TRACE_STEP and LAYERFS_TRACE_START=1.

## Layout

```
host/
  main.js              entry: opens the runtime, starts the worker, serves HTTP; prints one ready line
  server.js            routes and the event stream
  projects.js          real project reads (state, commits, files, Sandboxes) and removal
  config.js            deployment (above)
  resolve-layerfs.js   @layerfs/* resolution (above)
  seed.js              writes a seed.json fixture out as a folder
  checks/              final checks of a finished run (final.json …)
  parse/               the call parser: splits each step into classified segments
  runs/                the scenario engine: loader, runner, agents, tools, expect, traces
  run-demo.js          headless: runs one demo through the same engine, prints progress, exits 0 on pass
  test/                node:test files (each run ≤ 120 s)
scenarios/<id>/        scenario.json (+ seed.json, changes/, final.json)
fixtures/demo-workspace/
tools/                 scenario tools (replay conversion, checks)
```

## Process protocol

`node --import ./host/resolve-layerfs.js host/main.js [--state <dir>] [--port <n>]`
prints exactly one line on stdout once it listens:

```json
{"ready":true,"url":"http://127.0.0.1:53123","token":"<hex>"}
```

or `{"ready":false,"error":"…"}` and exits 1. While it serves, the first
live host on a state folder also writes `<state>/host.json` (owner-only:
`url`, `token`, `pid`), which `tools/connect-run.mjs` reads; it is removed at
exit. A run's record names the host playing it (`host`: its pid), so a second
host on the same state leaves that run alone. Logs go to stderr. It exits
when stdin closes (the Electron parent died) or on SIGTERM, ending its runs
(and closing their Sandboxes) and the runtime first, within 30 s. It does not stop the worker on exit.

## HTTP API

Every route needs `Authorization: Bearer <token>`, except `/api/events`,
which takes `?token=` (EventSource cannot set headers). Answers are JSON;
errors are `{ code, message }` with a 4xx/5xx status. CORS allows any origin
(the dev renderer is on localhost:5173, the packaged one on file://).

| Route | Answer |
| --- | --- |
| `GET /api/status` | `HostStatus` |
| `POST /api/worker/start` | `HostStatus` once the worker answers |
| `GET /api/projects` | `ProjectSummary[]` |
| `GET /api/projects/:name` | `ProjectState` (branches, layers, Sandboxes, last Commit, Commit count, Store file and size, Store totals and each Commit's added bytes) |
| `GET /api/projects/:name/commits?branch=&limit=` | `CommitInfo[]`, newest first |
| `GET /api/projects/:name/fs?branch=&path=` | `FsEntry[]` of one folder |
| `GET /api/projects/:name/file?branch=&path=` | `{ path, size, binary, text }` (text null when binary or over 1 MiB) |
| `DELETE /api/projects/:name` | `{ removed: true }` (runtime removal, confirm by name) |

Since layerfs#506 a project name may be in several Stores. Every `/api/projects/:name…` route above takes `store=` to name the project's Store; without it, a name in several Stores is refused 400 `AmbiguousProject`. `ProjectSummary.key` is `store/name` for a project in a shared Store, else the name. The renderer's client (`src/renderer/src/host/client.ts`) splits a key into the route and `store=`. A PostgreSQL Store's project is read with its connection's URL, which `storage.js` gives `projects.js`. Since layerfs#506 d its scenarios and sessions play in Sandboxes like any other: `config.js` `notePostgresql` keeps the URL in this process only, and `deploymentEnv` gives such a project's clients, agents' bash calls and Sandboxes `LAYERFS_STORE_POSTGRESQL` and no volume.
| `POST /api/projects` | `InitJob`: a new project. Body `{ name, folder? }`: Init (`runtime.project.start_init`, LayerFS's `project.init`) imports a copy of `folder` (absolute), or an empty folder when none is given; 409 when the name is taken |
| `GET /api/inits/:id` | `InitJob`: that Init's step (scan, volume, import, done, failed) and counts |
| `GET /api/demos` | `DemoSummary[]` |
| `GET /api/demos/:id` | `DemoDetail` (every agent's steps, parsed) |
| `POST /api/demos/:id/runs` | `RunSummary`: scenario `id` plays on project `project` (body `{ project }`; 404 when it is not there), in a folder `/<id>_<n>/` of its own (see "Where a run plays"); other runs and live sessions there go on |
| `POST /api/demos/all/runs` | `RunSummary[]`: every scenario on `project` at once (body `{ project }`), each in its own folder; the first run of each |
| `POST /api/sessions` | `RunSummary` (kind `live`): a live session on project `project` as it is. Body `{ project, text?, provider?, model?, thinking? }`; the model defaults to Models' default; 409 with no usable model |
| `GET /api/runs?demo=` | `RunSummary[]`, newest first |
| `GET /api/runs/:id` | `RunDetail` |
| `GET /api/runs/:id/trace?agent=&before=&limit=` | `TracePage`: one agent's Trace rows (runs/trajectory.js), newest last; `limit` (default 400) rows before `before` (default the end). A live session's model side comes from pi's log, a replay's from the scenario's script |
| `POST /api/runs/:id/messages` | `RunSummary`: the user's next message to a live session. Body `{ text, provider?, model?, thinking? }`; 409 while it works |
| `POST /api/runs/:id/stop` | `RunSummary`: a replay stops; a live session's current turn stops (the session stays) |
| `GET /api/events?token=` | `text/event-stream`, one `data: <HostEvent JSON>` per event: the RunManager's `RunEvent`s, and from `storage.js` `{ type: 'sync', job }` and `{ type: 'storage' }` (below) |

### Storage (layerfs#506, `docs/ui/storage-redesign.md`)

`storage.js` serves Stores, remotes (copy locations) and PostgreSQL
connections; `storage-sync.js` is the pure sync state of each copy (§4) and
`storage-checks.js` keeps the remote checks and samples the jobs (§5, §8.4).

| Route | Answer |
| --- | --- |
| `GET /api/storage` | `StorageView`: Stores (size, open, copies with their sync state, aggregate, import origin, running job), remotes (location, copies, bytes, health, listing), connections (host, database, health, bytes), jobs, providers, totals, `supports`, `checkedAt`, `checking`. Uses the cached checks; never runs a remote HEAD and opens no Store |
| `POST /api/storage/check` | `StorageView` after checking. Body `{ store?, remote?, connection? }`, empty for everything: one HEAD per matching copy (`runtime.store.check`, E3; skipping copies with a running job or no keys), the remote's listing (`runtime.remote.list_stores`, E9) or, without it, one HEAD for a remote with no copy yet, and each matching connection's `runtime.postgresql.status` (E5/E7). At most 4 calls at once; a check of the same thing already running is joined; one finished less than 10 s ago is not repeated |
| `POST /api/stores` | `StorageView`: a new empty SQLite Store, body `{ name }` |
| `DELETE /api/stores/:name?confirm=` | `StorageView`: the Store and every project in it removed |
| `POST /api/stores/:name/push` | `SyncJob`. Body `{ remote, force? }`; `force: true` replaces a copy that changed since the last transfer |
| `POST /api/stores/:name/pull` | `SyncJob`. Body `{ remote, confirm: <store> }` |
| `POST /api/stores/:name/import-postgresql` | `SyncJob`. Body `{ connection, name?, schema? }` |
| `POST /api/remotes`, `DELETE /api/remotes/:name` | `StorageView`; the keys stay in `storage.json` |
| `POST /api/remotes/:name/clone` | `SyncJob`. Body `{ store, from? }` |
| `POST /api/postgresql`, `DELETE /api/postgresql/:name` | `StorageView`; the URL stays in `storage.json` |
| `GET /api/sync-jobs/:id` | `SyncJob`: the job's last sample |

Events: while any job runs, the host reads it (`runtime.sync.get`, in
process) every 500 ms whether or not a page is open, and sends `{ type:
'sync', job }` for each sample that changed and for its end, with `rate`
and `eta` computed from the samples (§5.2). When a job ends the host checks
the copy it moved (or the connection an import filled) once and sends `{
type: 'storage' }`; it sends that too when a check ends or a Store, remote
or connection is added or removed. The renderer re-reads `/api/storage` on
it. Ended jobs stay listed 10 minutes.

Engine fields and their fallbacks (§10.4); `supports` says which are real:

| Field | From the engine | Host fallback |
| --- | --- | --- |
| SQLite `size`, `open` | E1: `store.list` `bytes: { file, wal }`, `open` | one `stat` of every Store's `store.sqlite`, `-wal`, `-shm` (in the worker container on macOS and Windows, here on Linux); null when that fails |
| `local` side | E2: `store.list` `heads`, transfers' `heads` | `unknown` |
| `check`, `remoteSide`, remote `health` | E3: `runtime.store.check` | `unknown` |
| job `phase`, live `bytes`/`total`, `pieces` | E4: `runtime.sync.get` | null; `bytes` and `result` at the end |
| PostgreSQL `size`, connection `health` | E5/E7: `runtime.postgresql.status` | null / `unknown` |
| `importedFrom` | E6: `store.list` `importedFrom` | Connect's own log of imports it started (`storage.json` `imports`) |
| `providers[].available` | E8: `runtime.remote.providers()` | MinIO and R2 when the build has remotes |
| remote `listed` | E9: `runtime.remote.list_stores` | null |

Nothing reads a Store's heads by opening it: a pull refuses an open Store.
Remote keys and PostgreSQL URLs stay in `storage.json` (owner-only); no view
or event carries them, and check failures are scrubbed of them. The checks
live in memory: after a restart a checkable copy reads `checking` until its
first check. The project list (`GET /api/projects`) adds `storeSync`,
`storeProviders` and `connection` to each `ProjectSummary` from a Storage
view at most 15 s old (or one read then, without sizes).

## The engine (`runs/`)

`runs/index.js` exports `RunManager`:

```js
const runs = new RunManager({ spec, scenarios: '<connect>/scenarios' })
runs.demos()          // DemoSummary[]
runs.demo(id)         // DemoDetail | null
await runs.start(id, { project })  // RunSummary; the run goes on in the background
await runs.startAll({ project })   // RunSummary[]: every scenario at once
runs.runs(demo?)      // RunSummary[]
runs.run(id)          // RunDetail | null
runs.stop(id)         // RunSummary
runs.on('event', (e) => …)  // RunEvent
await runs.close()
```

A run plays a scenario on a project that is there, beside anything else
playing on it. It makes the run folder `runs/<runId>/` (`work/` is every
agent's bash cwd, `traces/<agent>.jsonl` the SDK trace per agent, `scope/`
the run's scope state, `run.json` the record), sets up its folder in the
project, then plays the root agent. A scenario of several sessions
(scenarios/README.md) starts a run per session as one launch (`Launch` in
run.js): the first sets up the folder, the others wait for it, all play in
it at once, a cut-short one stops the others, the scope's Sandboxes are
closed once, and the folder lands once every session passed.

### Where a run plays

- **Folder and trunk** (`runs/folder.js`). The run is named
  `<scenario>_<n>` (`-` as `_`; the lowest `n` whose trunk is free). It
  forks the trunk `<run>.main` from main and Commits the scenario's fixture
  into `/<run>/` on it, in a Workspace (tar through `workspace.exec`, so
  modes and symlinks are kept). A fixture's `/.lww` also goes to the root,
  its rules moved under the folder, since LayerFS reads only the root's.
- **Scope** (`runs/scope.js`, `runs/scope-client.js`). Every agent bash call
  has `LAYERFS_CONNECT_SCOPE` set, and `resolve-layerfs.js` then loads the
  SDK's `client.js` through `scope-client.js`, which puts each call in the
  run's scope before the real client traces and sends it: paths under
  `/<run>/`; `main` is the current trunk; Branch `x` is `<run>.x`; Commit
  and Layer ids pass; `workspace.exec` and `process.start` run `cd <run>`
  first; Sandbox numbers are the run's own, from 1, mapped to the
  project's. `branch.publish B [commit]` becomes `branch.fork
  <run>.main.<k>` from B (or the Commit), and the trunk moves to it only
  when the fork worked: one trunk Branch per publish, as main has one Layer
  per publish. Answers come back in the script's names (its Sandbox
  numbers, Branch names, paths), so scripts run as written. A Workspace's
  Branch that `sandbox.list_workspaces` leaves null (it names Branches only
  among a project's first 64,
  [Ephemeral-AI-Lab/layerfs#480](https://github.com/Ephemeral-AI-Lab/layerfs/issues/480))
  is filled from the run's own mounts. The trace
  records the real calls, so an expect of `branch.publish:<kind>` is read
  as `branch.fork:Forked` (`scopedScenario`).
- **Checks** (`checks/`). With the scope, `final.order` compares the run's
  own Branches (names without the prefix) and its trunks as main's Layers
  (`scopedHistoryOf`; the record's forks from a published Layer read as forks
  from the Commit it published, `translateRecorded`). Two things differ
  between merging a Layer and merging a trunk Branch, and both are read the
  recorded way: a `merge x main` that fast-forwards onto the trunk starts
  the new Branch's own Commits there (the scope keeps these in `ffs/`), and
  a recorded merge of a Layer that published an ancestor of the merge's
  first input may be absent (on a trunk there is nothing to merge).
  `final.tree` hashes
  `/<run>/` on the last trunk, and `final.closed` looks at the run's
  Sandboxes only. Cleanup (`closeRunSandboxes`) closes only those too.
- **Landing on main.** When the checks pass, the last trunk joins main, one
  run at a time per project (`landOnMain`): a Branch `<run>.land` from the
  trunk with main's `/.lww` put back, merged with main into `<run>.landed`,
  which is published. Runs touch only their own folders, so the merge is
  clean; its result is the check `main.landed`, and the run passes only
  with it. A failed or stopped run leaves main alone; its Branches stay.
Semantics follow dsh-layerfs exactly (its `packages/mock/src`: scenario.js,
plan.js, progress.js, expect.js; dsh's tool schemas for subagent,
send_message, job_* and bash). One attempt per call, nothing retried; a
failed step fails the run; a run has 15 minutes, counted from when it starts
playing. Up to 16 launches play at once (`MAX_PLAYING`; a launch's sessions
count as one), and of those at most `HEAVY_AT_ONCE` (2) heavy ones: a
scenario tagged `node` or `rust` (it installs and builds) or with 100 steps or
more (`isHeavy`). A heavy launch past that is queued, `starting` with
`queued: true` and a phase that says so, and plays when one ends; one stopped
while it waits is dropped. Eleven at once, four heavy among them, timed most
runs out on an 8 GiB Docker VM.

The run follows its agents' trace start and end lines
([`runs/live.js`](runs/live.js)): the calls running now, the Sandboxes each
agent made and the Workspaces it mounted (with each one's last exec and
Commit count). `RunDetail.live` holds them and a `live` event carries them,
at most every 120 ms; the renderer's Live tab draws them.
A run that does not pass closes its project's Sandboxes (background
processes cancelled, Workspaces unmounted with discard) and records
`swept: true`; a host that starts finds any run left unswept by a host that
was killed and sweeps it once (only the newest run on a project: an
earlier replay's project is gone).

## The parser (`parse/`)

`parse/index.js` exports `stepView(step, index) → StepView` and
`segments(command) → Segment[]`. Every line of a bash command falls in
exactly one segment; neighbouring lines of the same kind and call merge. A
`layerfs <family> <call>` command (also inside `$( … )` or a pipe) is
`form: 'cli'`; a `node --input-type=module` heredoc is split per
`lf.<family>.<call>(…)` / backend call (`form: 'sdk'`); other shell is
`local`. `workspace exec`'s inner command becomes the segment's `detail`.
Non-bash tools are one `form: 'tool'` segment: subagent tools are
`subagent`, job tools `job`.
