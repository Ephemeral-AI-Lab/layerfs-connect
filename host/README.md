# Connect host

The host is Connect's backend: a plain Node process (system `node` ≥ 22.15,
ESM JavaScript, no build step) that the Electron main process starts. It runs
LayerFS through `@layerfs/runtime`, `@layerfs/agent` and `@layerfs/backend`,
and replays scripted demo scenarios on the real LayerFS: the local SQLite
Store and Docker Sandboxes. Interactive conversations use Pi's AgentSession
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

Connect never installs into or edits the LayerFS repository. `package.json`
links `@layerfs/{agent,backend,runtime,cli}` to the `api/` packages of a
LayerFS worktree beside this repo, kept at the tip of LayerFS's
`layerfs_v2_0_0` branch (`../layerfs/.claude/worktrees/connect-main/api/...`;
Connect itself works on `main`, and the README's "Where LayerFS comes from"
says how to move the worktree forward). Host-side LayerFS calls
load [`resolve-layerfs.js`](resolve-layerfs.js) first (`node --import`), so
`@layerfs/*` resolves from Connect's `node_modules`. Local-folder bash also
receives `NODE_OPTIONS=--import=…` and a `layerfs` shim on PATH:
`node --import <host>/resolve-layerfs.js <api>/cli/src/layerfs.js "$@"`. `<api>` is the
folder those links point at (`config.js` `API`). Project bash instead executes
inside the managed container through the host's LayerFS SDK; it does not
receive host resolver paths, credentials or shell environment.
A scenario run's agents' bash calls (`runs/`) get the same import and shim,
plus `LAYERFS_CONNECT_SCOPE` (the run's scope folder): with it set,
`resolve-layerfs.js` loads the SDK's `client.js` through
`runs/scope-client.js`, which puts each call in the run's scope first (see
"Where a run plays").

## Deployment ([`config.js`](config.js))

- State folder `~/.layerfs-connect` (`LAYERFS_CONNECT_STATE`):
  `settings.json`, the LayerFS home `home/` (0700), `runs/`.
- `settings.json`: `image` (runtime image digest), `bundle` (sealed Linux
  LayerFS build; macOS/Windows run the worker from it), `daemon`, `docker`,
  `containerPrefix` (default `lfc-`). Each also from `LAYERFS_CONNECT_<NAME>`.
- On macOS the runtime runs the home's worker container `<prefix>worker`
  (`lfc-worker`); every Store call goes there. Connect never touches another
  home's containers (dsh's are `layerfs-…`).
- `deploymentEnv(spec, project)` / `layerfsEnv` give host-side replay calls
  its `LAYERFS_*` settings: PROJECT, HOME, DOCKER, IMAGE, DAEMON, VOLUME,
  STORE_PATH, STORE, CONTAINER_PREFIX, WORKER_ENDPOINT (a PostgreSQL Store's
  project: STORE_POSTGRESQL and no VOLUME). The run adds LAYERFS_TRACE,
  LAYERFS_TRACE_STEP, LAYERFS_TRACE_START=1 and LAYERFS_CONNECT_SCOPE.

## Layout

```
host/
  main.js              entry: opens the runtime, starts the worker, serves HTTP; prints one ready line
  server.js            routes and the event stream
  projects.js          real project reads (state, commits, files, Sandboxes), creation and removal
  storage.js           Stores, remotes, PostgreSQL connections and sync jobs (layerfs#506, #509)
  storage-sync.js      the sync state of each Store's link (pure)
  storage-checks.js    cached remote checks and sync job sampling
  agents/              interactive Pi sessions, models, bash and subagent extension
    models.js          provider connections and model selection on Pi's ModelRuntime
    model-login.js     subscription sign-in (ChatGPT, Claude, …) through Pi's OAuth flows
    workspaces.js      session branch/mount lifecycle, serialized execution and automatic commits
    workspace-bash.js  root/child bash bridge to the host's managed workspace execution
    history.js         immutable turn checkpoints and Pi session copies without replaying old work
  config.js            deployment (above)
  resolve-layerfs.js   @layerfs/* resolution (above)
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
| `POST /api/projects` | `{ name, source?, store? }` starts a real Init and returns `ProjectInitJob`; omit `source` for an empty project, or provide an existing absolute folder to import. With `store` the project goes into that existing Store (layerfs#506), else into a new SQLite Store of its own. Existing names return 409 without changing the existing project. |
| `GET /api/project-inits/:id` | `ProjectInitJob`: the runtime's `scan`, `volume`, `import`, `done` or `failed` step, live counts, terminal error, and `ProjectSummary` on success. Unknown or expired jobs return 404. Polling never restarts a job. |
| `GET /api/projects/:name` | `ProjectState` from the Store alone (branches, layers, Sandboxes from their records and containers with no Workspaces, last Commit, Commit count, Store file and size, Store totals and each Commit's added bytes); asks no Sandbox daemon |
| `GET /api/projects/:name/sandboxes` | `SandboxInfo[]` with each running Sandbox's mounted Workspaces (`sandbox.list_workspaces`, each Sandbox on its own with a 4 s limit); one that did not answer has `reach: 'busy'` (left alone 10 s), one that refused `reach: 'unreachable'`, both with `detail` |
| `GET /api/projects/:name/commits?branch=&limit=` | `CommitInfo[]`, newest first |
| `GET /api/projects/:name/branch-commits?branch=a&branch=b` | `{ [branch]: CommitInfo[] }`: several Branches' Commits in one call; main's are `[]`, a Branch gone meanwhile is left out |
| `GET /api/projects/:name/fs?branch=&path=` | `FsEntry[]` of one folder |
| `GET /api/projects/:name/file?branch=&path=` | `{ path, size, binary, text }` (text null when binary or over 1 MiB) |
| `DELETE /api/projects/:name` | `{ removed: true }` (`runtime.project.delete`, confirm by name; `project.remove` on a LayerFS build from before layerfs#506). Refused 409 `Busy` while an agent session on the project works |
| `GET /api/demos` | `DemoSummary[]` |
| `GET /api/demos/:id` | `DemoDetail` (every agent's steps, parsed) |
| `POST /api/demos/:id/runs` | `RunSummary`: scenario `id` plays on project `project` (body `{ project }`, a project key: `store/name` in a shared Store; 400 without it, 404 when it is not there), in a folder `/<id>_<n>/` of its own (see "Where a run plays"); other runs and Chat sessions there go on |
| `POST /api/demos/all/runs` | `RunSummary[]`: every scenario on `project` at once (body `{ project }`), each in its own folder; the first run of each |
| `GET /api/runs?demo=` | `RunSummary[]`, newest first |
| `GET /api/runs/:id` | `RunDetail` |
| `GET /api/runs/:id/trace?agent=&before=&limit=` | `TracePage`: one agent's Trace rows (runs/trajectory.js), newest last; `limit` (default 400) rows before `before` (default the end). A replay's model side comes from the scenario's script (a live session an earlier build saved: pi's log) |
| `POST /api/runs/:id/stop` | `RunSummary`: the run stops (a queued one is dropped) |
| `DELETE /api/runs/:id` | `{ id }`; removes a finished session's saved record and execution logs, keeping its LayerFS project; 409 while running |
| `GET /api/events?token=` | `text/event-stream`, one `data: <HostEvent JSON>` per event: the runs' events, interactive chat snapshots, and from `storage.js` `{ type: 'sync', job }` and `{ type: 'storage' }` (below) |

Since layerfs#506 a Store holds many projects and a project name may be in
several Stores. Every `/api/projects/:name…` route above takes `store=` to
name the project's Store; without it, a name in several Stores is refused
400 `AmbiguousProject`. `ProjectSummary` carries `store`, `kind`, `shared`
and `key` (`store/name` for a project in a shared Store, else the name), and
`storeSync`, `storeProviders` and `connection` from a Storage view at most
15 s old. The renderer's client (`src/renderer/src/host/client.ts`) takes a
key and splits it into the route and `store=`; agent sessions name their
project by key. A PostgreSQL Store's project is read with its connection's
URL, which `storage.js` gives `projects.js`; `config.js` `notePostgresql`
keeps it in this process only, and `deploymentEnv` gives such a project's
clients `LAYERFS_STORE_POSTGRESQL` and no volume.

### Storage (layerfs#506, #509; `docs/ui/storage-links.md`, `docs/ui/storage-redesign.md`)

`storage.js` serves Stores, remotes and PostgreSQL connections;
`storage-sync.js` is the pure sync state of each Store's link and
`storage-checks.js` keeps the remote checks and samples the jobs. A SQLite
Store links to at most one remote file; a remote file is linked by at most
one Store of this home. A LayerFS build without these calls (such as the one
`package.json` links today) answers each part `available: false` with the
reason, and the changes 501 `Unsupported`.

| Route | Answer |
| --- | --- |
| `GET /api/storage` | `StorageView`: Stores (size, open, link with its sync state, import origin, running job), remotes (location, files, bytes, health), connections (host, database, health, bytes), jobs, providers, totals, `supports`, `checkedAt`, `checking`. Uses the cached checks; never runs a remote HEAD and opens no Store |
| `POST /api/storage/check` | `StorageView` after checking. Body `{ store?, remote?, connection? }`, empty for everything: one HEAD per matching link (`runtime.store.check`), each remote's listing (`runtime.remote.list_stores`) and each matching connection's `runtime.postgresql.status` |
| `POST /api/stores` | `StorageView`: a new empty SQLite Store, body `{ name }` |
| `DELETE /api/stores/:name?confirm=` | `StorageView`: the Store and every project in it removed |
| `POST /api/stores/:name/publish` | `SyncJob`: an unlinked Store uploaded to a new file and linked. Body `{ remote, file? }` |
| `POST /api/stores/:name/push` | `SyncJob` through the Store's link. Body `{ force? }`; `force: true` replaces a file that changed since the last push or pull |
| `POST /api/stores/:name/pull` | `SyncJob`: the Store replaced by its linked file. Body `{ confirm: <store> }` |
| `POST /api/stores/:name/send` | `SyncJob`: a copy to a new, unlinked file. Body `{ remote, file }` |
| `POST /api/stores/:name/unlink` | `StorageView`: the Store becomes local only; the file stays. Body `{ confirm: <store> }` |
| `POST /api/stores/:name/import-postgresql` | `SyncJob`. Body `{ connection, name?, schema? }` |
| `POST /api/remotes`, `DELETE /api/remotes/:name` | `StorageView`; the keys stay in `<state>/storage.json` (owner-only) |
| `GET /api/remotes/:name/files` | `RemoteFile[]`: the bucket's Store files now, each with the Store linked to it |
| `POST /api/remotes/:name/load` | `SyncJob`: a new local Store from a file, linked to it. Body `{ file, store? }` |
| `POST /api/postgresql`, `DELETE /api/postgresql/:name` | `StorageView`; the URL stays in `storage.json` |
| `GET /api/sync-jobs/:id` | `SyncJob`: the job's last sample |

While a job runs the host samples it (`runtime.sync.get`) every 500 ms and
sends `{ type: 'sync', job }` for each changed sample and its end; when a job
ends, a check ends, or a Store, remote or connection changes, it sends
`{ type: 'storage' }` and the renderer reads `/api/storage` again. No view or
event carries a remote key or a PostgreSQL password.

Interactive routes accept JSON request bodies:

| Route | Input / answer |
| --- | --- |
| `GET /api/agent/models` | Models, provider connections (including custom headers, excluding API key values; `signIn` for a provider with a subscription sign-in, `signedIn` when its credential is one), selected model and default cwd |
| `POST /api/agent/providers` | `{ provider, name?, baseUrl?, api?, apiKey?, headers? }`; saves one provider connection without requiring a model or changing selection, preserving its model definitions and other providers; returns the catalog |
| `POST /api/agent/providers/:id/login` | `ModelLogin`: starts the provider's subscription sign-in (its `signIn` in the catalog; 400 for a key-only provider). A running sign-in for it is cancelled |
| `GET /api/agent/logins/:id` | `ModelLogin`: its `state`, the `step` to show (a URL to open, a device code) and the `prompt` it waits on; readable 2 minutes after it ends |
| `POST /api/agent/logins/:id/respond` | `{ value }`: answers the open prompt (an option's id, a pasted code or redirect URL); 409 when nothing is asked |
| `POST /api/agent/logins/:id/cancel` | `ModelLogin`, cancelled |
| `POST /api/agent/logins/:id/open` | `ModelLogin`; opens the step's page (a provider's own sign-in page only) in the system browser; 409 before there is one |
| `DELETE /api/agent/providers/:id` | Removes that provider’s configuration and credentials; clears selection only when it belongs to that provider, invalidates its pending model sync, and returns the latest catalog. Conversations stay in history. |
| `POST /api/agent/models` | `{ provider, modelId, thinkingLevel, apiKey?, baseUrl?, api?, headers?, contextWindow?, maxTokens?, reasoning? }`; saves and returns the catalog |
| `POST /api/agent/models/test` | Same settings; saves, tests the model, returns `{ text }` |
| `POST /api/agent/models/discover` | `{ provider, baseUrl?, api?, apiKey?, headers? }`; reads models without saving, returns `{ models: [{ id, name, reasoning?, contextWindow?, maxTokens? }], source: "remote" \| "catalog" }` |
| `POST /api/agent/models/sync` | Same input; discovers and persists all returned models plus provider connection settings in one operation, preserving current selection and existing overrides; returns the discovery result plus `catalog: AgentModels`. Empty/failed discovery keeps saved configuration intact. |
| `GET /api/agent/sessions` | `AgentSessionSummary[]`, newest first |
| `POST /api/agent/sessions` | `{ cwd?, project?, title?, provider?, modelId?, thinkingLevel?, permissionMode?, limits? }`; returns a new `AgentSessionDetail`. Project sessions reserve their own branch identity; opening for the first message prepares the managed workspace. Local-only sessions use `cwd`. |
| `GET /api/agent/sessions/:id` | `AgentSessionDetail` with messages, queued inputs, tools, children, workspace, permissions, limits, execution/recovery state, recorded usage and archive metadata |
| `POST /api/agent/sessions/:id/message` | `{ text, attachments?, mode?, provider?, modelId?, thinkingLevel? }`; starts or queues input and returns the snapshot |
| `POST /api/agent/sessions/:id/continue` | `{ provider?, modelId?, thinkingLevel? }`; resumes an idle conversation through Pi while retaining completed results |
| `GET /api/agent/run-limits` | `{ limits, defaults, busy }`: the `{ bashTimeoutSeconds, maxRetries }` every chat uses, the built-in defaults, and the chats working now |
| `POST /api/agent/run-limits` | Partial `{ bashTimeoutSeconds, maxRetries }`; saves them and gives them to every chat; `409` while a chat works |
| `POST /api/agent/sessions/:id/limits` | Partial `{ bashTimeoutSeconds, maxRetries, instructions }`; updates an idle conversation's settings |
| `POST /api/agent/sessions/:id/update` | `{ title?, archived? }`; rename or archive/restore without deleting Pi files or branch history |
| `GET /api/agent/sessions/:id/output/:artifactId?offset=0` | Reads an owned output artifact in UTF-8-safe pages; returns `{ text, offset, nextOffset, bytes, done }` |
| `POST /api/agent/sessions/:id/children/:runId/stop` | Stops a controllable background run after terminal proof; foreground children use the conversation Stop action |
| `POST /api/agent/sessions/:id/queue/:messageId` | `{ mode: "steer" }`; promotes a pending follow-up to guidance for the current task and returns the snapshot |
| `DELETE /api/agent/sessions/:id/queue/:messageId` | Removes one pending message from Pi's queue and returns the snapshot |
| `POST /api/agent/sessions/:id/stop` | Stops the task and children; project sessions save, unmount and close their workspace sandbox. Returns its snapshot or a cleanup error for retry. |
| `POST /api/agent/sessions/:id/compact` | Compacts an idle session, returns its snapshot |
| `POST /api/agent/sessions/:id/rollback` | `{ entryId }`; restores the active context before that user entry and its LayerFS checkpoint; returns `{ session, draft, attachments? }` without sending the draft |
| `POST /api/agent/sessions/:id/edit` | `{ entryId, text, attachments?, provider?, modelId?, thinkingLevel? }`; restores before that user entry, sends the revised input and returns the updated session |
| `POST /api/agent/sessions/:id/fork` | `{ entryId? }`; duplicates the whole active context, or only the context before a user entry; returns `{ session, draft?, attachments? }` for a new conversation and independent LayerFS branch |
| `POST /api/agent/sessions/:id/permissions` | `{ mode: "ask" | "auto" | "full" }`; saves the policy and returns its snapshot |
| `POST /api/agent/sessions/:id/approvals/:requestId` | `{ decision: "approve" | "reject" }`; decides a pending/reviewing command once and returns the snapshot |
| `DELETE /api/agent/sessions/:id` | Stops and cleans up the workspace, then removes the saved conversation; keeps LayerFS branch history and returns `{ id }` |

`headers` is a provider-scoped `Record<string, string>`: omitting it preserves
saved headers, while `{}` clears them. Custom headers override generated
headers with the same name. Values entered through Connect are literal text;
Pi's native command/environment syntax is escaped when saved. Chat still uses
Pi's configured API key or sign-in; headers alone do not configure its auth.

History actions use Pi's stable `entryId`, exposed on transcript messages.
User messages also carry `canRestore`; older project messages without a saved
LayerFS checkpoint cannot restore files. The root `message_start` extension
records a checkpoint before each consumed user message, covering queued and
steering input as well as normal turns. File references name an immutable
Commit or initial Layer, never the moving `main` branch.

History mutations require idle work and hold a per-conversation barrier through
cleanup and file/session changes. Pi's append-only entries remain in the old
session file; the new cursor is persisted in a fresh Pi session. Copied pending
subagent notices are inert, so historical work cannot restart in a copy.
LayerFS restores create revision branches rather than erasing earlier history.
Local-folder sessions change only their conversation context.

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
PostgreSQL Store plays too: `config.js` `notePostgresql` notes its
connection's URL in this process for the run's clients, bash calls and
Sandboxes.

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
  `final.tree` hashes `/<run>/` on the last trunk, and `final.closed` looks
  at the run's Sandboxes only. Cleanup (`closeRunSandboxes`) closes only
  those too; one whose daemon does not answer within 30 s is stopped as a
  container (`sandboxContainer`: `<prefix>[<store>.]<project>-<n>`).
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
