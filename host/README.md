# Connect host

The host is Connect's backend: a plain Node process (system `node` ≥ 22.15,
ESM JavaScript, no build step) that the Electron main process starts. It runs
LayerFS 2.0 through the one `layerfs` package (a client of Connect's home),
and replays scripted demo scenarios on the real LayerFS. Interactive conversations use Pi's AgentSession
API and the `pi-subagents` extension in `agents/`. The model's tool surface is
bash plus delegation/supervision tools. File reads, writes and edits go
through bash. The separate `runs/` engine keeps replaying fixed scenarios.

The renderer talks to the host over HTTP on 127.0.0.1 (JSON, bearer token)
and one server-sent event stream; the types are in
[`src/shared/host-api.ts`](../src/shared/host-api.ts) and
[`src/shared/agent-api.ts`](../src/shared/agent-api.ts). Change both together.

## Interactive agents (`agents/`)

`AgentManager` creates, resumes and stops Pi sessions. It owns the UI metadata
and forwards Pi events as `{ type: 'chat', session: <AgentSessionDetail> }` on
the existing event stream. The client applies snapshots by their `updated`
value and reads the active session again when the stream reconnects.

`models.js` uses Pi's `ModelRuntime` for providers, credentials, supported
thinking levels and model calls. The settings UI can select a built-in model
or save a custom base URL, API format and model limits. A test saves that
configuration and performs one real completion request. Settings responses
contain `hasKey`, never the key value.

Image capability comes only from the provider's model-list API. Missing
metadata is unknown and allows images; only an explicit text-only result
blocks them. Each saved model keeps the reported modalities in `apiInput`,
separate from Pi's effective `input` list, which includes images when unknown
so Pi does not silently remove them. Old catalog/default input flags are not
treated as API capability data.

All state stays beneath Connect's state folder (normally
`~/.layerfs-connect`):

- `pi/auth.json`: Pi's standard credential format.
- `pi/models.json`: Pi's standard provider and model configuration.
- `pi/connect-models.json`: the selected provider, model and thinking level.
- `pi/agents/` and `pi/extensions/subagent/`: Connect's child-agent definitions
  and subagent configuration.
- `chats/<id>/chat.json`: conversation metadata and the display transcript.
- `chats/<id>/*.jsonl`: Pi's persistent session; reopening uses SessionManager.
- `chats/<id>/traces/`: LayerFS SDK traces from bash and child agents.
- `chats/<id>/tool-output/`: private complete bash output, paged through the
  authenticated session API and retained when copying conversations.
- `chats/<id>/approval-connection.json`: the current local approval endpoint
  and a session-scoped request token, shared by the root and child bash tools
  for approval and managed-workspace execution.
- `chats/<id>/pending-subagent-stops.json`: run IDs awaiting confirmed exit,
  retained across stop retries and host restarts.

The desktop's child-agent views use `GET /api/agent/sessions/:id/children/:childId`
for their conversation and `GET /api/agent/sessions/:id/children/:childId/trace`
for paginated Trace rows (`before` and `limit`, as on the parent Trace).
Both resolve a known child within its parent's private directory. Child Trace
reads that child's Pi branch and `traces/child-<Pi session id>.jsonl`; it never
substitutes the parent's commands. Child conversations remain read-only, with
their existing independent Stop action.

The host sets `PI_CODING_AGENT_DIR` to its private `pi/` directory. Parent
sessions explicitly select the allowed tools. The extension also constrains
child tool selection, so a worker cannot restore Pi's default read/write/edit
tools. The default worker uses bash; delegation, waiting and supervisor
communication belong to the subagent tool group. Connect does not patch Pi
or `pi-subagents`.

Local-folder conversations execute bash directly in their selected host `cwd`.
Project conversations use `agents/workspaces.js`: the first message opens a
dedicated `chat-<session id>` branch forked from `main`, creates a sandbox and
mounts that branch. The renderer can create this draft through a project's
**New chat** action, with no session POST until the first message. Pi and its
child processes retain a host control directory under `chats/<id>/`; that
directory and the project's original import source are not the project bash
execution path.

`agents/workspace-bash.js` preserves Pi's bash schema, output handling and tool
renderer while sending execution through the session-authenticated `/execute`
bridge. The host resolves the actual mounted path before approval, then runs
the approved command through LayerFS. Root, foreground, background and nested
child agents all use this bridge and share one conversation workspace. Their
bash commands are serialized. Each command starts at the workspace root, so
subdirectory work uses `cd` inside the command. The command does not inherit
the host's model credentials or control environment. There are no extra
read/write/edit model tools and no implicit child-agent branches.

After a command completes, fails or is interrupted, the host confirms that
its process group and descendants have stopped before committing changes to
the conversation branch. Read-only commands return `UpToDate` without adding
a commit. The host never automatically merges or publishes these commits to
`main`. Background shell processes do not outlive their command; use foreground
checks. Pi's large-output `fullOutputPath` may refer to a host log that project
container bash cannot access. Redirect large output to a workspace file when
it must be read by a later command.

Stop, conversation deletion and graceful host shutdown stop the agent and its
children, save remaining workspace changes, unmount the workspace and close
the sandbox. If stop or cleanup cannot be confirmed, the host reports an error
and retains the workspace for retry rather than reporting successful cleanup.
Saved branch history remains after conversation deletion. Continuing a stopped
conversation mounts its existing branch again; it does not fork another branch
or publish to `main`.

Both session summaries and details expose `workspace: AgentWorkspace | null`.
Local-folder sessions have `null`; older records may also have no workspace
details until opened. The public object contains `branch`, `state`, `sandbox`,
`path`, `head`, `commitCount`, `lastSaved` and `error`; execution-control fields
remain private. States are `pending`, `preparing`, `ready`, `running`, `saving`,
`closed` and `error`. Existing chat SSE snapshots carry these changes. The UI
shows the real branch/path and save state, links to that branch's History,
and coalesces history refreshes when workspace metadata changes or SSE
reconnects; ordinary streaming text does not trigger repeated project reads.

Message POSTs return after Pi durably accepts the user message; setup or
checkpoint errors reject the request so the renderer keeps its draft. Further input can
use `mode: "steer"` or `mode: "followUp"` while the session runs. Stop aborts
the active Pi work and stops child tasks; an idle session can be compacted and
continued. Pi JSONL is the authority for restored model context. The frontend
history and tool cards are projections for display, including compacted and
branch context summaries. The history drawer supports transcript search and
full expansion of saved messages, thinking, tool arguments and output. Its
usage count sums provider reports from that transcript; it is not the current
context-window occupancy. Model and thinking controls share the Chat header,
with provider configuration under the model dropdown.

Sessions persist run limits (a 900-second default bash timeout and two native
main-agent provider retries, set for every chat in Settings → Runs and kept in
`run-limits.json`), conversation instructions, archive metadata and recorded
usage. Runs have no turn or run-time limit; Stop ends them. Continue uses
Pi's high-level custom-message API without replaying completed tool calls.
Execution phases and recovery state accompany snapshots; SSE omits attachment
bytes, which remain available on full session responses.

Settings → SDKs lists the SDKs in `<state>/sdks.json` ([`agents/sdks.js`](agents/sdks.js));
until that file exists, the built-in `agents/sdks.default.json` (the LayerFS
SDK and its 32 agent calls) stands in for it. Each SDK's `root` is absolute or
relative to Connect's folder; the host looks there for each package and doc
and reports the version it finds. Each SDK that is on and found adds a
section written from its entry (description, packages, command, docs, calls)
to the system prompt of the agents its `agents` names, in every chat
(`child-extension.js`). The page writes only an SDK's `enabled`; like an
extension switch, it waits while a chat works and reloads idle chats.

Root and child agents load project instructions from the actual execution
directory, with custom conversation instructions appended. Pi's native context
file loading is disabled to avoid duplicates and host control-directory rules.
Project children fetch these files through authenticated `POST /context` on the
internal approval bridge; the token cannot select arbitrary host paths. Context
loading failures abort execution before a model request. Text and image inputs
retain original prompt metadata through queued messages, edits and copies.
See [the harness baseline](../docs/agent-harness.md) for limits and behavior.

If the app is force-killed during a background task, the next stop/delete
restores and stops that run. pi-subagents 0.84 may retain an unconfirmed
process-exit record after the crash. Connect then reports `Subagent stop
incomplete` and retains the conversation, including on repeated attempts;
it does not treat a terminal display status as proof that cleanup completed.

### Bash approval policy

Every session persists `permissionMode: "ask" | "auto" | "full"`. New sessions
default to `full`, and loaded conversations are migrated to `full`. The desktop
has no policy selector or full-access confirmation dialog. The shared approval
gate runs before root and foreground, background or nested child bash calls.
The loopback approval service accepts approval requests and managed-workspace
execution requests. Its session token cannot approve commands or change policy;
those actions use the authenticated desktop API. `/execute` runs the same
approval gate before forwarding a project command to its workspace.
Stopping cancels outstanding requests. On restart, unfinished approvals are
cancelled and commands must request a new decision.

- `ask` pauses the exact command for a human approve/reject decision.
- `auto` uses a separate model request with no tools to review the command
  and its working directory. Routine project work can be approved by that
  review. Risk, uncertainty or a review error leaves the command pending for
  the user. A human can take over while the review is running.
- `full` executes without a per-command prompt; it is the desktop default.
  Setting it also releases pending/reviewing commands. OS permissions still apply.

The host API retains explicit `ask`/`auto` modes for integrations and tests.
Changing either mode reprocesses undecided requests under the selected policy.
A user's decision cancels any in-flight review and cannot be overwritten by
its later result. Session detail and chat events include `approvals`, whose
entries contain `id`, `agent`, `toolCallId`, exact `command`, `cwd`, `created`,
`status`, and optional `source`, `reason` and `decidedAt`. Statuses are
`reviewing`, `pending`, `approved`, `rejected` and `cancelled`; sources are
`user` or `model`. The renderer keeps completed requests in a collapsible
audit view and shows active requests next to the conversation.

The policy is an execution approval mechanism for these bash tools. It does
not create a sandbox, and automatic model review does not enforce filesystem
or network isolation. Project commands use their LayerFS container workspace
under all three modes; local-folder commands retain direct host execution.

## Where LayerFS comes from

Connect links the one LayerFS 2.0 package, `layerfs`
(`link:../layerfs-v2-merge/api/node`, LayerFS `layerfs_v2_0_0` at `d046e7e2c1`, product as `5d13a1f62f`); the package finds its native addon
through the link's real path. The host makes one client, `client({ home })`
([`layerfs.js`](layerfs.js)); every call names its project, `<store>/<project>`. Agents' shells
run the native `layerfs` command (the linked checkout's `target/debug/layerfs`, or
`LAYERFS_CONNECT_CLI`). See [the integration spec](../docs/layerfs-2.0-integration.md).

## Real and simulated LayerFS ([`sim/`](sim/))

The host runs in one of two modes, `LAYERFS_CONNECT_MODE` (`real`, the default, or `sim`), read once
as [`layerfs.js`](layerfs.js) loads: `real` loads the linked `layerfs` package, `sim` the simulator
in `sim/`, which exports the same `client`, `close`, `doctor` and `table`. Nothing above
`layerfs.js` knows which one answers.

- **The simulator** (`sim/world.js`) keeps one world per home in `<home>/sim-world.json`: machines,
  Stores, buckets, projects with their Layers, Branches, Commits and files, and Sandboxes. Its
  answers and refusals have the shapes and codes LayerFS 2.0.0 gives (recorded from the real
  library); states are the SDK's words and work in flight shows as an `op` with its phase
  (`machine.start · boot`, `store.push · send` with bytes). It takes arguments as the real package
  does, from the real call table saved in `sim/table.json` (`node tools/sim-table.mjs` writes it
  again; a test fails when it drifts). A call it does not cover is refused `Unsupported` naming it:
  for now `workspace.exec`, `file.blame`, `file.diff` and `file.apply`, so agent chats on a project
  cannot run commands in sim mode.
- **Starting worlds** (`sim/seed.js`): `mac` (Docker, two Lima VMs, Stores on native and a VM, a
  PostgreSQL Store, a backup, a running Sandbox), `empty` and `trouble` (the states that need the
  person). A missing world file starts from `LAYERFS_SIM_PRESET` (default `mac`);
  `POST /api/sim/reset { preset }` replaces the world. `LAYERFS_SIM_SPEED` scales every simulated
  delay (`0` for tests).
- **Separate state**: sim mode's `<state>` defaults to `~/.layerfs-connect-sim`, and a real home
  (one with `layerfs.json`) is refused in sim mode, so a simulated call never reaches a real Store.
  Sim mode records no native daemon, finds no CLI, and turns scenario runs and scenario chats off.
- **The switch**: Electron starts the host with the saved mode (`<userData>/connect-mode.json`;
  `LAYERFS_CONNECT_MODE` at launch overrides it, as `pnpm dev:sim` does). The LayerFS menu
  (⌥⌘1 / ⌥⌘2) and the sidebar's mode chip (`docs/ui/shell.md`) switch: the host is stopped,
  started in the other mode, and each window is replaced by one on the new host.

## Deployment ([`config.js`](config.js))

- `<state>`: `LAYERFS_CONNECT_STATE`, else `~/.layerfs-connect` (`~/.layerfs-connect-sim` in sim
  mode): runs, `host.json`, agent state.
- `<state>/home-2`: the LayerFS 2.0 home (`LAYERFS_HOME`), private. The 1.1.0 `<state>/home` is
  left as it is; a non-empty home folder without a 2.0 `layerfs.json` is refused.
- Every machine, Store, bucket and image is a record in the home; Connect keeps no LayerFS
  settings of its own. Two dev settings, from the environment: `LAYERFS_CONNECT_CLI` and
  `LAYERFS_CONNECT_DAEMON` (the macOS native daemon, recorded once on the `native` machine with
  `layerfs import-env`; at each start a recorded daemon that is not there any more, its checkout
  moved or removed, is replaced through `machine.update native { daemon }`).
- Agents' shells get `LAYERFS_HOME`, the trace settings (`LAYERFS_TRACE*`) and the project key in
  `LAYERFS_CONNECT_PROJECT`; scoped runs add `LAYERFS_CONNECT_SCOPE` and `LAYERFS_CONNECT_MACHINE`.
- There is no worker to start, and machine power is manual (#535 D11): a machine runs between
  `machine.start` and `machine.stop`, which only Compute's and the pages' **Start**/**Stop** buttons
  call. No read starts a machine. Electron starts the host with `UV_THREADPOOL_SIZE=16` (each call
  holds a libuv thread).
- Sandbox images: a new machine gets the LayerFS bundle's image unless the form names an archive or
  digest. Connect pins no image digest.

## Layout

```
host/
  main.js              entry: makes the LayerFS client, serves HTTP; prints one ready line
  server.js            routes and the event stream
  projects.js          real project reads (state, commits, files, Sandboxes), creation and removal
  storage.js           Stores, buckets, PostgreSQL Stores, push/pull/move/backup/restore jobs, doctor
  agents/              interactive Pi sessions, models, bash and subagent extension
    models.js          provider connections and model selection on Pi's ModelRuntime
    model-login.js     subscription sign-in (ChatGPT, Claude, …) through Pi's OAuth flows
    workspaces.js      session branch/mount lifecycle, serialized execution and automatic commits
    workspace-bash.js  root/child bash bridge to the host's managed workspace execution
    history.js         immutable turn checkpoints and Pi session copies without replaying old work
  config.js            deployment (above)
  machines.js          Compute's machines (LayerFS 2.0): the view and its calls (below)
  layerfs.js           the one LayerFS client (real or simulated), paging, the native daemon record
  sim/                 the simulated LayerFS: index.js (the package's exports), world.js, seed.js, table.json
  seed.js              writes a seed.json fixture out as a folder
  checks/              final checks of a finished run (final.json …)
  parse/               the call parser: splits each step into classified segments
  runs/                the scenario engine: loader, runner, agents, tools, expect, traces
    folder.js          a run's folder /<scenario>_<n>/ and trunk in its project; landing on main
    scope.js           a run's scope: its folder, Branch namespace, trunks and Sandbox numbers
    scope-client.js    the SDK's client.js for a run's bash calls, each call put in the scope first
  run-demo.js          headless: runs one demo through the same engine, prints progress, exits 0 on pass
  test/                node:test files (each run ≤ 120 s)
scenarios/<id>/        scenario.json (+ seed.json, changes/, final.json)
fixtures/demo-workspace/
tools/                 scenario tools (replay conversion, checks)
```

## Process protocol

`node host/main.js [--state <dir>] [--port <n>]`
prints exactly one line on stdout once it listens:

```json
{"ready":true,"url":"http://127.0.0.1:53123","token":"<hex>","mode":"real"}
```

or `{"ready":false,"error":"…"}` and exits 1. While it serves, the first
live host on a state folder also writes `<state>/host.json` (owner-only:
`url`, `token`, `pid`), which `tools/connect-run.mjs` reads; it is removed at
exit. A run's record names the host playing it (`host`: its pid), so a second
host on the same state leaves that run alone. Logs go to stderr. It exits
when stdin closes (the Electron parent died) or on SIGTERM, ending its runs
(and closing their Sandboxes) first, within 30 s. It stops no machine on exit. Its last step is
`layerfs.close()` (`closeStores()`), which closes the Stores it holds open and drops their leases;
a host that is killed leaves them stale until the Store's next call removes them
(`docs/layerfs-2.0-integration.md` §9 Q16).

## HTTP API

Every route needs `Authorization: Bearer <token>`, except `/api/events`,
which takes `?token=` (EventSource cannot set headers). Answers are JSON;
errors are `{ code, message, detail?, conversion? }` with a 4xx/5xx status:
the SDK's refusal as it came (its message names any status or clearing call;
`detail` holds `entity`, `phase`, `op` and `related`). `Busy`, `Unresolved`,
`InUse` and Connect's own `ConnectBusy` (one job per Store on this host, a
project being deleted, the scenario limits) answer 409, `Capacity` 507,
`Unavailable` 502, `Unsupported` 501, `Unknown` 500. `conversion: true` marks
the layout 2 home's conversion refusal (`InUse` whose `related` items carry
`why`), on which the app shows its "Upgrading this home" screen. CORS allows any origin
(the dev renderer is on localhost:5173, the packaged one on file://).

| Route | Answer |
| --- | --- |
| `GET /api/status` | `HostStatus`: platform, linked LayerFS version, settings (state, home, CLI), the native daemon record, each machine's name, platform and state, the Store count. Starts nothing |
| `GET /api/machines` | `MachinesView` (see "Compute"); `{ available: false, layerfs, reason }` on a LayerFS with no machines |
| `GET /api/platforms` | `machine.platforms()`: each platform on this host, how it is added, backend, kernel route, sqlite and PostgreSQL support, readiness, what is missing, its version, its declared options |
| `POST /api/machines` | a VM `{ name, platform, cpus?, memory?, disk?, image?, os_image? }`; only the options the platform declares, else `InvalidInput` naming them; `ssh` and `firecracker` are refused `Unsupported` (turned off in Connect) |
| `POST /api/machines/:name/start` | `machine.start`: waits until its worker answers |
| `POST /api/machines/:name/stop` | `machine.stop`: `InUse` (409) while Sandboxes run on it, `related` naming them |
| `DELETE /api/machines/:name` | removes a VM (an ssh machine a home already had is disconnected); `InUse` (409) while it holds Stores or running Sandboxes |
| `POST /api/machines/:name/update` | a built-in's `{ image, docker, wsl }` or a VM's `{ cpus, memory }` |
| `POST /api/machines/:name/stores` | `{ store }`: puts that sqlite Store on this machine as a Storage job: a push from native, a pull to native, or a pull then a push between two machines |
| `GET /api/projects` | `ProjectSummary[]` (each with its Store's `state` and `op`) |
| `POST /api/projects` | `{ name, store, source? }` starts a real Init into the existing Store `store` (a sqlite Store on any machine, through its worker, or a PostgreSQL Store) and returns `ProjectInitJob`; omit `source` for an empty project, or give an existing absolute folder to import. A Store that is down or busy refuses it |
| `GET /api/project-inits/:id` | `ProjectInitJob`: Init's `scan`, `files`, `tree`, `publish`, `seal`, then `done` or `failed`, with live counts, a terminal error, and `ProjectSummary` on success. Unknown or expired jobs return 404. Polling never restarts a job. |
| `GET /api/projects/:name` | `ProjectState` from the Store alone (Branches, Sandbox records, last Commit, Commit count, Store file and size); asks no Sandbox daemon. While the Store refuses Store calls (`Busy`, `Unresolved`, or `Unavailable` for a stopped machine) it answers from the home's records: the project, its Sandboxes, the Store's `storeState`, `storeOp`, `storeDown` and the `refusal`, with no Branches |
| `POST /api/projects/:name/sandboxes` | `{ name, image?, machine? }`: `sandbox.create`. A sqlite project's Sandbox goes on its Store's machine; a PostgreSQL project's on `machine` (default native), which must have `supports.postgresql_sandbox` |
| `GET /api/projects/:name/sandboxes` | `SandboxInfo[]` (`state`, `op`, `backend`, `route`) with each one's Workspaces (`sandbox.get`; each with `name` and `ws`); a refused read keeps the SDK's refusal in `refusal` |
| `GET /api/sandboxes/:name` | one Sandbox with its Workspaces (`sandbox.get`) |
| `POST /api/sandboxes/:name/workspaces` | `{ branch, fork?, name? }`: `workspace.mount` of a side Branch (main is refused, owner D14); `fork: true` forks it from main first; `name` names the Workspace (`<sandbox>:<name>`) |
| `DELETE /api/sandboxes/:name?force=1` | `sandbox.close`; with `force`, it answers the Workspaces of unknown state |
| `DELETE /api/workspaces/:ws?discard=1` | `workspace.unmount`; refused while it has changes unless discarded |
| `GET /api/projects/:name/commits?branch=&limit=` | `CommitInfo[]`, newest first |
| `GET /api/projects/:name/branch-commits?branch=a&branch=b` | `{ [branch]: CommitInfo[] }`: several Branches' Commits in one call; main's are `[]`, a Branch gone meanwhile is left out |
| `GET /api/projects/:name/fs?branch=&path=` | `FsEntry[]` of one folder |
| `GET /api/projects/:name/file?branch=&path=` | `{ path, size, binary, text }` (text null when binary or over 1 MiB) |
| `DELETE /api/projects/:name` | `{ removed: true }` (`project.remove`; `InUse` while any Sandbox record exists, `Unsupported` for a PostgreSQL project). Refused 409 `ConnectBusy` while an agent session on the project works |
| `GET /api/demos` | `DemoSummary[]` |
| `GET /api/demos/:id` | `DemoDetail` (every agent's steps, parsed) |
| `POST /api/demos/:id/runs` | `RunSummary`: scenario `id` plays on project `project` (body `{ project }`, a project key: `store/name` in a shared Store; 400 without it, 404 when it is not there), in a folder `/<id>_<n>/` of its own (see "Where a run plays"); other runs and Chat sessions there go on |
| `POST /api/demos/all/runs` | `RunSummary[]`: every scenario on `project` at once (body `{ project }`), each in its own folder; the first run of each |
| `GET /api/runs?demo=` | `RunSummary[]`, newest first |
| `GET /api/runs/:id` | `RunDetail` |
| `GET /api/runs/:id/trace?agent=&before=&limit=` | `TracePage`: one agent's Trace rows (runs/trajectory.js), newest last; `limit` (default 400) rows before `before` (default the end). A replay's model side comes from the scenario's script (a live session an earlier build saved: pi's log) |
| `POST /api/runs/:id/stop` | `RunSummary`: the run stops (a queued one is dropped) |
| `DELETE /api/runs/:id` | `{ id }`; removes a finished session's saved record and execution logs, keeping its LayerFS project; 409 while running |
| `GET /api/events?token=` | `text/event-stream`, one `data: <HostEvent JSON>` per event: the runs' events, interactive chat snapshots, and from `storage.js` `{ type: 'storage-job', job }` and `{ type: 'storage' }` (below) |

A Store holds many projects, and every project goes by its key
`<store>/<project>`; the `/api/projects/:name…` routes above take that key as
one encoded segment. `ProjectSummary` carries `key`, `store`, `kind`, the
Store's `machine`, and its `storeState` and `storeOp`. A PostgreSQL Store is
read through the home's record (`store.connect` with a password reference);
Connect holds no connection URL with a password and sets no per-project
environment for it.

### Compute ([`machines.js`](machines.js))

- `GET /api/machines`: `machine.list()` (each machine's `state` and `supports`, as the SDK gives
  them), `machine.platforms()`, `store.list()` and `sandbox.list()` (items with `state` and `op`),
  and `machine.status()` of the machines that run or hold or lost an operation (free disk, `op`).
  None of it starts a machine. `GET /api/platforms` answers `machine.platforms()` alone.
- SSH hosts and Firecracker are turned off in Connect (`OFF` in machines.js): `machine.platforms()`
  rows for them are left out, and so is lima's `nested` option (only Firecracker used it). The
  simulator keeps them, as the real library has them.
- `POST /api/machines` creates a VM (`machine.create`), sending only the options the platform
  declares; `DELETE /api/machines/<name>` removes it (`InUse` while it holds Stores or Sandboxes); `POST /api/machines/<name>/update`
  sets a built-in's image or a VM's size; `POST /api/machines/<name>/start|stop` power it.
- `POST /api/machines/<machine>/stores { store }`: puts the Store there (push, pull, or pull then
  push), a job in Storage's table.

### Storage ([`storage.js`](storage.js); `docs/ui/storage.md`)

- `GET /api/storage`: Stores by machine (`store.list` with each Store's `state` and `op`,
  `store.status` for size), the machines (with `state` and `supports`), buckets with their last
  listing, and this host's jobs. `POST /api/storage/check { bucket? }` lists buckets again.
- `POST /api/stores { name }`, `DELETE /api/stores/<name>?confirm=<name>`,
  `POST /api/stores/postgresql { name, url, password, synchronousCommit? }`,
  `POST /api/stores/<name>/disconnect`.
- `POST /api/stores/<name>/push { machine }` (`store.push`: native → a machine whose
  `supports.sqlite` is true), `POST /api/stores/<name>/pull` (`store.pull`: back to native),
  `POST /api/stores/<name>/move { machine }` (between two machines: `store.pull` then `store.push`,
  two operations in one job, `half` naming the one running; if the push half fails the Store is on
  native and the error carries `note: 'pulled'`), `POST /api/stores/<name>/backup { bucket, file? }`,
  `POST /api/buckets/<bucket>/restore { store, file? }` (installs on native): jobs, answered at
  once, followed on `storage-job` events and `GET /api/storage-jobs/<id>`. A push or pull job's
  `phase` is LayerFS's: `check`, `snapshot`, `send` (with `done`/`total` bytes), `verify`,
  `install`, `record`, `retire`. One job per Store on this host; another is `ConnectBusy`.
- `GET /api/doctor`: `layerfs.doctor()` on the home: `{ ok, findings: [{ severity, entity, message,
  fix }] }`. Report-only; it starts no machine and changes nothing.
- `POST /api/buckets { name, url, key, region? }`, `DELETE /api/buckets/<name>`,
  `GET /api/buckets/<name>/files` (`backup.list(bucket)`).
- `password` and `key` are references (`env:LAYERFS_…`, `file:/abs`); a URL holding a password is
  refused. Connect keeps no secret; `<state>/buckets.json` holds the bucket names it connected.

### Projects and Sandboxes

`/api/projects/<key>` takes the key `<store>/<project>` as one encoded segment: state, commits,
branch-commits, fs, file, sandboxes (`POST { name, image?, machine? }`; `machine` for PostgreSQL
projects only, any machine whose `supports.postgresql_sandbox` is true), close-sandboxes, DELETE.
`GET /api/sandboxes/<name>` reads one Sandbox; `POST /api/sandboxes/<name>/workspaces { branch,
fork?, name? }` mounts a named Workspace; `DELETE /api/sandboxes/<name>?force=1` closes a Sandbox;
`DELETE /api/workspaces/<ws>?discard=1` unmounts one. Chat Workspaces are mounted with a name from
the chat's Branch. `GET /api/project-inits[/<id>]`: this host's Init jobs.

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
await runs.remove(id) // { id }; finished runs only, keeps the LayerFS project
runs.on('event', (e) => …)  // RunEvent
await runs.close()
```

Successful removal emits `{ type: 'run-removed', id, demo }` so the sidebar,
selected view, and project summaries can refresh together.

A run plays a scenario on a project that is there (`project` is its key:
the name, or `store/name` in a shared Store), beside anything else playing
on it, Chat sessions included. It makes the run folder `runs/<runId>/`
(`work/` is every agent's bash cwd, `traces/<agent>.jsonl` the SDK trace per
agent, `scope/` the run's scope state, `run.json` the record), sets up its
folder in the project (seed scenarios write their seed out first), then
plays the root agent. A scenario of several sessions
(scenarios/README.md) starts a run per session as one launch (`Launch` in
run.js): the first sets up the folder, the others wait for it, all play in
it at once, a cut-short one stops the others, the scope's Sandboxes are
closed once, and the folder lands once every session passed. A project of a
PostgreSQL Store plays too; its runs place nothing. A sqlite project's run on
another machine pulls its Store to native, then pushes it there (`placeRun`).

### Where a run plays

- **Folder and trunk** (`runs/folder.js`). The run is named
  `<scenario>_<n>` (`-` as `_`; the lowest `n` whose trunk is free). It
  forks the trunk `<run>.main` from main and Commits the scenario's fixture
  into `/<run>/` on it, in a Workspace (tar through `workspace.exec`, so
  modes and symlinks are kept). A fixture's `/.lww` also goes to the root,
  its rules moved under the folder, since LayerFS reads only the root's.
- **Scope** (`runs/scope.js`, `runs/scope-client.js`, `runs/cli-shim.mjs`).
  Every agent bash call has `LAYERFS_CONNECT_SCOPE` set. The `layerfs`
  command (cli-shim.mjs) and the `layerfs` package in the run's
  `node_modules` (scope-client.js) put each call's 2.0 arguments through the
  scope: paths under `/<run>/`; `main` is the current trunk; Branch `x` is
  `<run>.x`; ids pass; Sandbox `sb1` is `<run>.sb1.<tag>` on the run's machine
  (`<run>` is unique in its project only, a Sandbox name in the whole home);
  `workspace.exec` runs `cd <run>` first, with a perl `timeout` where the
  Sandbox has none (a macOS native Sandbox); a publish forks the next trunk.
  The command runs the native call to its end before the scope records what
  it did (the new trunk, a fast-forward, a closed Sandbox) and then exits
  with its status, so a refused call changes nothing in the scope; a
  `file apply --from` file gets the same changes as the SDK call, a root
  `/.lww` with its copy under the folder.
  LayerFS 2.0's `LAYERFS_TRACE` records only worker connections, so both
  also write each call's trace start and end lines (`runs/trace-line.js`,
  with the real names), which Live and the Trace tab read.
  `expect` checks stay blocked (§9 Q1).
- **Checks** (`checks/`). With the scope, `final.order` compares the run's
  own Branches (names without the prefix) and its trunks as main's Layers
  (`scopedHistoryOf`; the record's forks from a published Layer read as forks
  from the Commit it published, `translateRecorded`). Two things differ
  between merging a Layer and merging a trunk Branch, and both are read the
  recorded way: a `merge x main` that fast-forwards onto the trunk starts
  the new Branch's own Commits there (the scope keeps these in `ffs/`), and
  a recorded merge of a Layer that published an ancestor of the merge's
  first input may be absent (on a trunk there is nothing to merge).
  `final.tree` hashes `/<run>/` on the last trunk, and `final.closed` looks
  at the run's Sandboxes only. Cleanup (`closeRunSandboxes`) closes only
  those too, each call bounded to 30 s; one that does not close is closed
  with `force`, and the Workspaces of unknown state it names are logged.
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
runs out on an 8 GiB Docker VM. Live Pi sessions of the engine (an earlier
build's `kind: 'live'` runs) are not served: Chat (`agents/`) replaces them;
their saved records still list and read.

The run follows its agents' trace start and end lines
([`runs/live.js`](runs/live.js)): the calls running now, the Sandboxes each
agent made and the Workspaces it mounted (with each one's last exec and
Commit count). `RunDetail.live` holds them and a `live` event carries them,
at most every 120 ms; the renderer's Live tab draws them.
A run that does not pass closes its scope's Sandboxes (background
processes cancelled, Workspaces unmounted with discard) and records
`swept: true`; a host that starts finds any run left unswept by a host that
was killed and sweeps it once (a record from before scopes: only the newest
run on a project, since a newer replay reset it).

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

### Rich web-preview fixtures

With `pnpm --dir desktop web` running, open its browser console and import
`desktop/tools/populate-preview.mjs` through Vite's `/@fs` path (replace
`<checkout>` with the absolute checkout path):

```js
const { populatePreview } = await import('/@fs<checkout>/desktop/tools/populate-preview.mjs')
await populatePreview()
```

This adds five simulated machines, seven Stores, eighteen projects and twenty-nine
Sandboxes with varied Workspace counts. SQLite Stores stay on their assigned
machine; the PostgreSQL projects span native, Docker and the build VM. Workspace
branches are forked from main. Projects start empty. Existing resources are kept,
and repeating the command fills missing fixtures. Both `/api/sim` and the host's
simulated status are checked before writing. No real VM, container or database
is created. Fixtures persist for the current preview's temporary state directory;
resetting the simulated world removes them.

### Paged desktop History

`GET /api/projects/:key/history` returns `{ branches, next }` from one 100-item
`branch.list` page (the first also includes main). `pos` is the SDK continuation.
With `branch`, it returns `{ items, next, head }` from one 100-item `commit.list`
page, stopping at the fork; `head` optionally guards continuation against drift
(`HeadMoved`, HTTP 409). These reads never eagerly diff checkpoint histories.
With `branch` and `commit`, it reads the selected commit and up to 100 changed
paths, returning `{ item, changes, nextChanges }`; optional `from` compares a
group's first parent to its last commit. `pos` pages changed paths. A first
checkpoint without a comparable parent Commit returns `changes: null`. SDK
refusals propagate. No write is performed.
