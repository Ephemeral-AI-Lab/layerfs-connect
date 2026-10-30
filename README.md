# LayerFS Connect

Connect is a desktop coding agent powered by Pi, with **bash and subagents**
as its tool surface. Chat runs real model conversations in a local folder or
a managed LayerFS workspace; project views show their saved history.

## Start an agent session

1. Run `pnpm install`, then `pnpm dev` in this repository.
2. Open the model dropdown in the Chat header and choose **Manage models**. Enter
   the provider, API URL and key, then use **Fetch models** to register the whole
   model list and connection settings at once. All fetched models appear in the
   Chat header's model selector immediately, keeping the current selection and
   thinking level. There is no need to add or save models one by one; manual IDs
   remain available. Supported endpoints return their live list; subscription and
   other configured native providers without a listing API use their built-in catalog.
   New custom providers default to Chat Completions; choose another API format
   when needed. **Save & test** saves the configuration and makes a small real
   model request; provider errors appear in the dialog.
3. Open **Workspace settings** above the conversation. For **Local folder only**,
   choose the shell's working directory with **Browse**, or enter its absolute
   path. Commands in this mode act directly on that local folder.
4. Alternatively choose a **LayerFS project**, or open a project and click
   **New chat**. The first message creates a conversation with its own
   `chat-<session id>` branch and managed container workspace. The lead agent
   and all its subagents run bash in that workspace, rather than the local
   folder or the project's original import source.
5. Send a task. Text and reasoning arrive from Pi as they stream. Tool cards
   show commands and output; subagent cards show delegated tasks and results.

Model Settings opens with empty provider and model fields. **Add provider**
starts another blank configuration; **Save provider** stores its connection
without requiring a model or changing the current selection. Saved provider
cards let you edit each connection independently. Choose one of its saved
models explicitly, or enter an ID and use **Save model**. Several providers can
keep different endpoints, keys and model limits at the same time.
Expand **Request headers** below the API key to add name/value pairs for that
provider. Values are hidden by default and sent as literal text with model
discovery, connection tests and chat requests. Save the provider or model to
keep them; remove its rows and save to clear them.
Each saved provider has a **×** button. Confirming **Delete provider** removes
its connection, credentials and model settings; saved conversations remain.
Deleting the currently selected provider clears the main model selection.

Project conversations share one workspace between the lead and child agents.
Their bash commands run one at a time, starting at the workspace root; use
`cd` within a command for a subdirectory. Changed files are saved to the
conversation's branch after each command, including changes made before an
error or interruption once the command is confirmed stopped. Read-only
commands do not create extra commits. Connect does not automatically merge or
publish these commits to `main`.

The workspace row shows the host's actual branch, mounted path, execution and
save state, and latest commit. **Branch history** opens that branch in the
project's History, which refreshes as commits arrive. Stop, conversation
deletion and graceful host shutdown stop active work, save remaining changes,
unmount the workspace and close its sandbox. An incomplete cleanup remains
visible as an error and retains the workspace for retry. Continuing a stopped
conversation mounts the same saved branch again.

Project commands do not leave background processes running after they finish:
Connect stops the command's process group and descendants before saving.
Run checks in the foreground. Pi may put large-output logs on the host;
its `fullOutputPath` cannot be read by container bash. Redirect large output
to a file inside the workspace when the agent needs to inspect it later.

Chat uses **full access** by default, including existing conversations when
Connect opens. Root and child bash commands execute without individual approval
prompts. The composer has no permission selector or access-confirmation dialog.
Project conversations execute inside their managed LayerFS workspace; local
conversations execute in the selected host folder with its OS permissions.
Existing approval records remain available in the conversation history.

The square button, or Escape in the composer, stops the current task and its children, clearing pending
messages. During execution, sending adds a message to **Next up** above the
composer. Pi follows up automatically, one message at a time, after the current
work finishes. Each pending message can be expanded, removed, or promoted with
**Steer** to guide the current task after its current step finishes. Pending
messages enter the conversation only when the agent starts processing them.
The upper-left history button
opens **History** with search, switching and deletion. The **Context** tab shows
the active session; its **Conversation transcript** can be searched and fully expanded to inspect messages, thinking,
tool arguments and output in the saved context. **Compact** summarizes a long
idle conversation; its summary replaces earlier context entries in the
transcript. This is the saved Pi context, not a full raw-history archive. **New** starts another
conversation. Model selection and thinking intensity remain visible together
in the header and can change between turns; provider settings live in the model
menu. **Recorded usage** adds provider-reported usage from the saved main-agent
Pi tree, including copied and branched history. It is not a billing ledger for
new requests or the complete cost of child agents. The context ring separately
shows the current context-window estimate.

The conversation menu provides **Run settings** before the first message and
between runs: turn/runtime budgets, a default bash timeout, native retry limits
and conversation instructions. Root and child agents also load the execution
directory's project instructions automatically. **Continue** and **Retry** resume
through Pi with completed tool results retained. Background run cards expose
**Stop run** when Pi provides independent control; the main Stop action covers
all child work. Long bash results have a paged full-output viewer.

Attach UTF-8 text files or images with the composer. Image input requires a
model that supports it. Draft text, attachments and new-chat run settings are
saved locally per conversation or selected project/folder. The conversation
menu also supports rename, archive/restore, copying the transcript and exporting
Markdown or JSON. Archiving keeps the conversation and LayerFS branch history.
Connection status shows when the event stream is reconnecting and refreshes
the active snapshot when it recovers. See [the harness baseline](docs/agent-harness.md)
for defaults, input limits and verification.

Each user message has an actions menu with **Copy text**, **Edit & resend**,
**Revert before this message**, and **Copy before this message**. Reverting
restores the context before that message and puts its original text back in
the composer without sending it. Editing restores the same point and sends
the revised text. Copying before a message creates a separate conversation
with that text as its unsent draft. **Duplicate chat** in the conversation or
history menu copies the complete active context.

For LayerFS project conversations, each user message records the file state
when it enters the agent's context, including queued and steering messages.
Revert and edit restore that snapshot on a new revision branch; the previous
branch and Pi conversation entries remain in history. Copies receive an
independent LayerFS branch and workspace. Local-folder conversations change
only their chat context and continue using the original local folder. Stop
active work before these operations; confirmations describe what will change.

Each history row's actions menu includes **Delete conversation**. Confirm it by
title and folder; running conversations offer **Stop and delete**, which first
stops the current turn and its subagents. Deleting the current conversation
returns Chat to a new session. This removes saved conversation data. Local
folder files stay in place; a project workspace is stopped and unmounted,
while its saved LayerFS branch history is kept. A failed deletion stays open with its error and a
**Try again** action.

Type **/** in Chat to open local shortcuts: `/new`, `/history`, `/model`,
`/workspace`, `/compact` and `/stop`. Use Up/Down to choose, Tab to complete,
Enter to run, or Escape to dismiss. Commands use the existing controls; an
unknown slash command is sent as ordinary text. The small shortcut menu beside
Send remembers **Enter** or **Cmd/Ctrl+Enter**; Shift+Enter adds a new line.
Confirming a Chinese IME candidate does not send the message or run a command.

The workspace panel's **Recent** menu reuses the six most recent local folders
from saved local-folder sessions. Project sessions show their managed workspace
instead of a local execution path. A session keeps its bound workspace; start
a new one to choose another folder or project. The composer's context
ring reads Pi's current context estimate, with used, remaining and limit
details. Usage is unknown immediately after compaction until the next response,
or after restarting until the session runs again; this estimate is not saved
as a stale percentage.

Connect stores its Pi configuration under `~/.layerfs-connect/pi/`: standard
`auth.json` credentials, `models.json` provider definitions, and
`connect-models.json` for the selected model. Conversations and Pi JSONL files
live under `~/.layerfs-connect/chats/<session id>/`. A custom
`LAYERFS_CONNECT_STATE` changes this root. Connect uses its own Pi directory;
model secrets are kept in the host and are not returned by the settings API.

Both the lead and child agents use bash for file reads, searches, writes and
edits. The `pi-subagents` extension supplies delegation and supervision tools;
`read`, `write`, `edit`, `find`, `grep` and `ls` are not separate model tools.

The conversation controls adapt useful behavior from `conecode_副本`:
provider-scoped model configuration, independent session streaming, stop and
queued input, collapsible reasoning/tool output, slash commands, IME-aware
shortcuts, workspace reuse, and context/token/cost display. Pi
owns the model protocol, agent loop and session persistence.

## The UI

The language control at the bottom of the sidebar switches between Simplified
Chinese and English immediately. The first launch follows the system language;
the selected language is saved on this device. Switching keeps the current
page, forms, drafts and running agent work. Interface labels and date formats
are localized; project/model names, conversation content, source code and raw
tool output remain unchanged. Renderer strings live in `src/renderer/src/i18n/`.

The sidebar keeps four destinations: **Chat**, **Projects**, **Storage** and
**Compute**. The brand is a single title with no subtitle. Demo scenarios,
scripted sessions and replay controls are no longer part of the desktop UI.

- **Chat** opens interactive Pi sessions, with conversation history, model and
  thinking controls. Its project picker lists existing user projects.
- **Projects** lists existing LayerFS projects with search, refresh and **New project**.
  The sidebar's **Your projects** list opens each project directly. It shares the
  same directory with Projects and Chat, updates after creation from either entry
  point, and reloads saved projects when Connect starts.
  Each sidebar project has an **×** action that opens a confirmation dialog.
  Confirming deletes its project storage and history through the existing host
  API; original source folders and saved conversations remain. Failed deletions
  stay in the dialog for retry, and successful deletions update the shared list.
  The **+** beside Projects in the sidebar opens the same dialog. Entries marked
  by the host as demo runs are omitted; their stored files are kept.
- A **project page** reads the project directly, without requiring a demo run.
  History, Storage and Sandboxes show the host's actual data; Sessions (with
  the Live diagram on top while a run plays) and Script appear for projects
  that play scenarios. Empty
  projects show empty states instead of sample workspaces or execution data.
  **New chat** opens a fresh draft bound to that project without starting an
  agent until the first message is sent.
- **Storage** shows local volumes, disk and worker status. Project rows open
  the actual project. Remote providers remain clearly marked as planned.
- **Compute** shows Docker and sandbox status, with unavailable providers
  disabled.

Remote Push/Pull/conflict mocks and hardcoded native sandboxes have been removed. Backend scenario fixtures and command-line test
runners remain available for development; this cleanup does not delete project
volumes, model configuration or saved Pi conversations.

### Create a project

Choose **New project** in Projects, the sidebar **+**, or the **+** beside the
LayerFS project field in a new Chat workspace. Enter a project name, then select
**Empty project** or **Import folder**. The latter copies files from the chosen
local folder into LayerFS; it does not move or delete the original folder.

Creation uses the configured local SQLite runtime and reports its actual
scan, storage and import stages. A duplicate name is rejected instead of
replacing a project. Runtime or Docker setup errors remain visible in the
form. If status polling is interrupted, **Check status** resumes the existing
job without submitting another creation request.

Successful creation from Projects or the sidebar opens the project. Creating
from Chat selects it in the current draft. Its agent will use a managed
workspace; the import source is not the execution directory. Importing also
remembers the source as the local-folder choice if you later switch back to
**Local folder only**. Empty projects keep that local-folder choice unchanged.
Saved conversations keep their existing project association.

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
  agents/      Pi sessions, model configuration, bash and pi-subagents integration
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
  renderer/    React UI: chat, projects, files, history, storage, compute
```

## Where LayerFS comes from

Connect never installs into or edits the LayerFS repository. `package.json`
links `@layerfs/*` to the `api/` packages of a LayerFS worktree beside this
repo, kept at LayerFS `main`
(`../layerfs/.claude/worktrees/connect-main/api/{agent,backend,cli,runtime}`),
and the host loads `host/resolve-layerfs.js`, so `@layerfs/*` resolves from
Connect's `node_modules`. Local-folder bash calls also receive this resolver;
project bash runs through the host's LayerFS workspace execution bridge inside
the container. The macOS worker runs a
sealed Linux LayerFS build from the same worktree (`tools/worktree.py build`
in LayerFS), named in `~/.layerfs-connect/settings.json`:

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
pnpm test:agents # real Pi/bash/subagents against a local test model; no API key needed
pnpm build       # production build into out/
pnpm start       # run the production build
```

With Docker running and Connect's LayerFS image/bundle configured, verify real
managed workspaces in a disposable project (local test model; no API key):

```bash
CONNECT_REAL_LAYERFS=1 node --import ./host/resolve-layerfs.js --test --test-timeout=200000 host/test/agent-layerfs-real.test.js
```

This covers root and child bash, separate conversation branches, large UTF-8
output, saves after failed/stopped commands, immediate continuation and restored
sessions. It removes its own project, worker and temporary state after the run.

Host tests (each command stays under two minutes):

```bash
node --import ./host/resolve-layerfs.js --test host/test/*.test.js tools/checks/tests/*.test.mjs
```

Developer scenario fixtures can still run without the window:

```bash
node --import ./host/resolve-layerfs.js host/run-demo.js tour --project <key>  # an existing project; plays in /tour_<n>/
```

Drive the running app's host from a terminal (it writes
`~/.layerfs-connect/host.json`):

```bash
node tools/connect-run.mjs start tour merge
```

Dev aids: `CONNECT_VIEW=<hash>` opens a page (`chat`, `projects/<project>[/<tab>]`, `storage`, `compute`); `CONNECT_SHOT=<file.png>` saves a
screenshot once loaded, then quits (`CONNECT_SHOT_DELAY` waits longer;
`CONNECT_EVAL=<js>` runs in the page first and prints its result);
`CONNECT_THEME=dark|light`.
