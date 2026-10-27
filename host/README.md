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
links `@layerfs/{agent,backend,runtime,cli}` to `../layerfs/api/...` (the
LayerFS main checkout beside this repo), and every Node process Connect starts
loads [`resolve-layerfs.js`](resolve-layerfs.js) first (`node --import`, and
`NODE_OPTIONS=--import=…` in agents' bash calls), so `@layerfs/*` always
resolves from Connect's `node_modules`. The `layerfs` command in agents' bash
calls is a shim on PATH:
`node --import <host>/resolve-layerfs.js <api>/agent/cli/src/layerfs.js "$@"`.

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
when stdin closes (the Electron parent died) or on SIGTERM, closing the
runtime first. It does not stop the worker on exit.

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
| `GET /api/projects/:name` | `ProjectState` (branches, layers, Sandboxes) |
| `GET /api/projects/:name/commits?branch=&limit=` | `CommitInfo[]`, newest first |
| `GET /api/projects/:name/fs?branch=&path=` | `FsEntry[]` of one folder |
| `GET /api/projects/:name/file?branch=&path=` | `{ path, size, binary, text }` (text null when binary or over 1 MiB) |
| `DELETE /api/projects/:name` | `{ removed: true }` (runtime removal, confirm by name) |
| `GET /api/demos` | `DemoSummary[]` |
| `GET /api/demos/:id` | `DemoDetail` (every agent's steps, parsed) |
| `POST /api/demos/:id/runs` | `RunSummary`: Inits a fresh project from the fixture, then runs |
| `GET /api/runs?demo=` | `RunSummary[]`, newest first |
| `GET /api/runs/:id` | `RunDetail` |
| `POST /api/runs/:id/stop` | `RunSummary` |
| `GET /api/events?token=` | `text/event-stream`, one `data: <RunEvent JSON>` per event |

## The engine (`runs/`)

`runs/index.js` exports `RunManager`:

```js
const runs = new RunManager({ spec, scenarios: '<connect>/scenarios' })
runs.demos()          // DemoSummary[]
runs.demo(id)         // DemoDetail | null
await runs.start(id)  // RunSummary; the run goes on in the background
runs.runs(demo?)      // RunSummary[]
runs.run(id)          // RunDetail | null
runs.stop(id)         // RunSummary
runs.on('event', (e) => …)  // RunEvent
await runs.close()
```

A run: Init a fresh project `<demo>-<n>` from the demo's fixture (seed demos
write their seed out first), make the run folder
`runs/<runId>/` (`work/` is every agent's bash cwd, `traces/<agent>.jsonl`
the SDK trace per agent, `run.json` the record), then play the root agent.
Semantics follow dsh-layerfs exactly (its `packages/mock/src`: scenario.js,
plan.js, progress.js, expect.js; dsh's tool schemas for subagent,
send_message, job_* and bash). One attempt per call, nothing retried; a
failed step fails the run; a run has 15 minutes. Two runs may play at once.

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
