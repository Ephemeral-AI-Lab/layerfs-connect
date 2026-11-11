# Real CLI demo presets

The previous simulator's useful layouts are now reproducible real resources.
The script does not write LayerFS records or intercept renderer answers. It
uses the existing CLI process adapter; desktop mode also uses the host routes
behind the app's management controls.

## One project library

The Presets page exposes one Studio library: **4 machines, 4 stores, 8 projects**.
Native and Docker each host one store; demo-build and demo-research are two
2-CPU, 4 GiB memory, 20 GiB disk Lima VMs. Docker, Lima and the pinned matching
Linux bundle must be ready. The default **Filesystem** execution mode creates
zero sandboxes and workspaces and requires no native sandbox daemon. **Mixed**
execution uses sandbox workspaces for selected revisions and requires the matching
native daemon as well as the Linux runtime. There is one preset, with an execution
mode selector rather than a separate sandbox preset.

```sh
node tools/demo-fixtures.mjs presets
node tools/demo-fixtures.mjs plan --preset studio
```

`plan` is offline: it creates no state and launches no CLI process.

For Mixed mode, choose **Presets → Mixed → Build projects → Reset and build**.
Build resets that Studio environment and its CLI Activity before construction.
Changing the selector alone does not change saved projects or their readiness.
The corresponding CLI build uses the same workflow:

```sh
node tools/demo-fixtures.mjs plan --preset studio --execution-mode mixed
node tools/demo-fixtures.mjs build --preset studio --execution-mode mixed --state /absolute/private/studio-state
```

Mixed converts Feature A's 80 and Feature B's first 16 revisions per release cycle
into workspace exec → workspace commit pairs. It creates one sandbox per project
(eight total) and reuses it across all cycles. Each mounted workspace executes
exactly two ordered exec/commit pairs, then cleanly unmounts. The next batch uses
a fresh workspace mounted on the saved branch head.
Successful construction retains those sandboxes with zero mounted workspaces;
Reset discovers and closes them. Resource ceilings are **three live sandboxes per
project and sixteen mounted workspaces per sandbox**. The recipe normally uses
one sandbox and two concurrent workspaces per project; these ceilings do not
increase the independent 12-command global CLI admission limit.

The Mixed target remains **15,072 workspace revisions / 41,310 authored
revisions (36.49%)**, with at least 30% in every project. Commit, branch, merge and
publication totals remain unchanged; the expanded history now contains **80,986 CLI
calls**, including 7,536 mounts and 7,536 clean unmounts. The actual Studio rebuild and independent archive audit passed for all 7,536
two-revision sessions, reaching Ready in 16m 59s. All 84,996 setup calls succeeded
with complete capture. Eight sandboxes remain running and zero workspaces mounted. Creating/mounting/closing resources does not inflate revision coverage.
Scripts remain paginated; exec bodies expand on demand and copies/downloads retain
exact commands. See [Mixed execution and full web proof](specs/mixed-preset-execution.md).


```text
native         demo-studio        website, design
docker         demo-services      gateway, billing
demo-build     demo-build-cache   compiler, sdk
demo-research  demo-experiments   embeddings, evaluation
```

The eight definitions in `tools/demo/projects.mjs` provide different self-contained
code, documentation, structured data and examples. Each starts with 16 files.
Construction uses project init, file writes, branch fork/merge/publish and read-only
verification. Application code is not run; sample values are not run reports.

Each project starts with the authored 24-Commit history, then builds its fixed
release-cycle tier. The eight unequal tiers total **41,640 unique Commits,
857 side Branches, 330 merges, 8,667 publications, 8,675 main Layers and 50,834
history CLI calls in Filesystem mode**. Two unfinished exploration branches remain browsable.
Saved graph, exact main files and draft differences are verified by read-back.
See [the tier table and verification evidence](specs/dense-project-history.md).

Every project row has View script, with 100 commands per page and a complete
command-plan download. The plan uses the execution recipe, including stdin,
branch lanes, dependencies and immutable Commit receipt placeholders. It excludes
reset and shared machine setup. Run from terminal provides the full reset/build
workflow; a project command plan requires that prepared environment.

Imports are serial within each store and independent stores prepare concurrently.
After all stores are placed, all eight project histories run on their assigned
machines. The dependency scheduler admits up to **12 CLI commands globally,
3 per store and 3 per project**, scoped to the preset action/home; ordinary
calls retain their four-call limit. Independent feature and maintenance branches
overlap. Each branch's write/publish sequence stays ordered, and publications to
main are serialized. No mutations are retried. Verification reads four stores
concurrently, with each store's projects checked in order. CLI Activity records
actual process overlap, actions, exact arguments, stdin and both output streams.

Build resets the selected home once before provisioning. Content version **3**
marks this library; older receipts do not imply the dense contents are ready.
Old fixture IDs remain addressable for existing-home compatibility/cleanup but
are not offered in the preset catalog or CLI presets listing.

## Trigger directly through the CLI

Configure an absolute pinned CLI and its matching daemon. The script also reads
these two paths from `desktop/.env.local` when they are not set in the shell.
It never adopts that file's ordinary preview state.

```sh
export LAYERFS_CONNECT_CLI=/absolute/path/to/layerfs
export LAYERFS_CONNECT_DAEMON=/absolute/path/to/layerfs-daemon

node tools/demo-fixtures.mjs setup --preset studio
node tools/demo-fixtures.mjs status --preset studio
node tools/demo-fixtures.mjs verify --preset studio
```

The default state is `~/.layerfs-connect-demo/studio`, and the LayerFS home is
its `home-2` directory. Pass `--state /absolute/private/path` on every command
to use another location. `LAYERFS_DEMO_STATE` is an alternative default.

Repeated setup checks existing resources and does not repeat successful writes.
After a content-version change, use Build preset to reset and rebuild; additive
setup preserves the older data and refuses to label it current.

## Open the actual desktop renderer

```sh
# Terminal A: starts the actual web preview with this preset's state.
node tools/demo-fixtures.mjs preview --preset studio
```

Open `http://127.0.0.1:1025/#/machines`. Preview does not seed data automatically.
Port 1025 is fixed; if another preview owns it, the command fails rather than
switching ports or killing that process. Stop a preview you own before starting
another preset's preview.

```sh
# Terminal B: same preset/state; no running host is required in CLI mode.
node tools/demo-fixtures.mjs setup --preset studio

# Or exercise the host operations behind desktop management buttons:
node tools/demo-fixtures.mjs setup --preset studio --via desktop
```

`--via desktop` requires a running host whose `host.json`, real home and pinned
CLI match this fixture. Management steps use the existing create/start/stop,
store, project Init, sandbox and workspace HTTP routes. Project/transfer jobs
are polled to completion before the next dependent step. This is the actual
desktop backend path; it does not automate browser clicks or add a preset
button. Inventory reads, history seeding and native daemon configuration use
the real CLI because matching desktop controls are absent. The terminal makes
those CLI-only steps explicit.

## Ensure CLI Activity captures it

Both paths reuse `host/cli/spawn.js`. Each run has an action ID and an action
such as `Setup studio demo (CLI)` or `Reset studio demo (desktop + CLI)`.
Desktop requests carry the same ID in `X-LFS-Action`; direct calls use the
same AsyncLocalStorage context and state directory.

The final receipt prints the action ID and a deep link. Open CLI Activity in
a preview using **the same state directory**, or use:

```sh
node tools/demo-fixtures.mjs verify --preset studio --json
```

Verification reads actual placement, project files and history (plus workspaces
when enabled). It also checks the most recent completed setup/reset receipt
against the retained activity archive, requiring actual CLI invocations with
start/end events, stdout and stderr. Its JSON includes:

```json
{
  "verified": true,
  "setupActionId": "<actual action UUID>",
  "cliInvocations": 40,
  "cliInputOutputCaptured": true
}
```

The count is illustrative and varies by preset and existing resources.
Commands, stdin, output, progress and failures use the existing sanitization,
32 KiB capture and 7-day/100 MB retention rules. Logs are under
`<state>/logs/cli/`. The viewer polls to discover the terminal writer's files;
reopening the app is not required. Verification reports incomplete/expired
activity rather than asserting that capture worked.

## Reset or remove the demo

```sh
# Discard fixture sandbox work and recreate fixture stores/projects/history.
# Keep the owned Lima VMs warm; clear previous CLI Activity in this demo home.
node tools/demo-fixtures.mjs reset --preset studio

# The same reset using desktop management operations:
node tools/demo-fixtures.mjs reset --preset studio --via desktop

# Remove confirmed owned sandboxes, stores and created VMs.
node tools/demo-fixtures.mjs teardown --preset studio
```

Reset unmounts fixture workspaces with `--discard`, closes their sandboxes,
removes the owned SQLite stores, then reseeds. It starts a stopped placement
machine when needed to reach its owned data. Active commands or chats can
cause LayerFS to refuse cleanup; stop them in the app, inspect status, then
request cleanup again. It never falls back to forced global deletion.

Reset now clears previous CLI Activity after read-only admission checks and
before cleanup. The reset is captured as a fresh action with actual CLI input
and output. This applies to terminal and UI resets. Other demo homes and the
ordinary environment keep their logs. If cleanup later fails, old history stays
cleared and the fresh failed action remains available. Active host work or CLI
calls block reset; a host started before these admission checks needs an update
before terminal reset. Teardown continues to retain current activity.

Teardown also removes VMs confirmed as created by the fixture. Built-in machines
are never removed. A borrowed Docker worker is stopped only if the fixture
started it and no remaining stores/sandboxes use it. The home, logs, source
folders and manifest remain for inspection; teardown is not `rm -rf`.

The ownership manifest records the preset, canonical state path, home identity,
confirmed creations and step outcomes. An ordinary populated home without this
manifest is rejected. Existing name collisions are not adopted. Unconfirmed
creates, replacement identities, `Unknown` results and interrupted writes are
retained for inspection, not automatically replayed. A process lock prevents
two fixture operations from running against the same state concurrently.

Each preset defaults to its own state directory. The Presets page switches
initialized demo environments without restarting the app. For a standalone
terminal-launched preview, stop your own preview and start
`preview --preset <name>` for the other directory.
Using the same `--state` for a different preset is rejected.

## Add another preset

Edit `tools/demo/presets.mjs`. A preset supplies a description, built-in machine
names / created machine specs, and store-to-machine/project assignments. The
runner expands these into the same real operations, including seeding and
ownership-aware reset. Use unique `demo-` names and supported CLI platforms.
Change the source/history recipes in `sourceFiles()` / `seedProject()` when a
preset needs different content. Unsupported or broken states must be produced
by actual supported operations; do not invent unresolved operations or metrics.

Implementation:

```text
tools/demo-fixtures.mjs       Commands, runtime configuration, web-preview trigger
tools/demo/presets.mjs        Topology and sample content
tools/demo/drivers.mjs        CLI adapter / desktop management route execution
tools/demo/runner.mjs         Ownership, ordering, setup/reset/teardown, verification
test/demo-fixtures.test.mjs   Lifecycle and isolation tests
```

Runtime:

```text
~/.layerfs-connect-demo/studio/
  demo-fixtures.json          Ownership and completed/incomplete steps
  demo-fixtures.lock          Present only during a fixture command
  demo-sources/               Small project import folders
  home-2/                    Real LayerFS home and resource records
  logs/cli/                  Captured activity
  host.json                  Present while a matching host runs
```

## Eight-project concurrent load result on 2026-11-10

`project-library-concurrent-live.json` records the new execution order: every store
was placed before any history started, and eight CLI processes overlapped. The
run did **not** pass. Native website file.write returned code Unknown with
`Service(History(Busy))` while design wrote to the same SQLite store. There was
one actual CLI failure; seven sibling scripts stopped after draining their active
calls. No failed mutation was retried and no concurrency was silently reduced.
Private stores, Docker worker and two test VMs were removed; teardown verified.
Current UI/task semantics distinguish Failed from Stopped (the raw first live
trace predates that label refinement). This is a concurrency failure receipt,
not a throughput benchmark or a successful eight-way result.

## Previous two-pipeline verification on 2026-11-10

The new content/history setup passed on all four intended machines in private
state. `project-library-topology-live.json` records all eight verified projects,
689 captured invocations, 176 exact file-write stdin comparisons, two concurrent
store pipelines, 192 distinct commits, 16 merges and 32 publishes. No sandbox or
workspace calls occurred during setup. The private stores, Docker worker and two
Lima VMs were cleaned up; teardown inventory verification passed. Root tests: 149
passing; desktop resource helper tests: 4 passing; typecheck and build passed.
No Electron window was launched and existing user environments were not reset.

## Historical verification on 2026-11-09

- Twelve lifecycle/isolation tests passed, including repeat setup, warm reset,
  teardown, collisions, uncertain creates, changed home identity, locking,
  retained sandbox configuration, borrowed-worker protection and cleanup of
  a VM that the CLI certainly created before reporting a worker failure.
- The complete root unit-test suite passed: 102 tests, no failures.
- Real pinned CLI `833d04cf44e8e747929d50ab1170a48260d9381c`: native setup
  without sandboxes, repeat setup, reset via the actual headless desktop host,
  and file/history/activity verification passed in an isolated temporary home.
- The desktop reset receipt contained 40 CLI invocations with input/output.
- Full studio VM/Docker provisioning and mounted native sandboxes were not run
  during this verification. No Electron desktop window was launched.

## General UI reset versus terminal fixture reset

The Presets page has a **Reset** button. It enumerates and recursively
removes all resources in the selected home, including resources created outside
this fixture's manifest. It removes custom machines, stops Docker, and
leaves an empty environment. **Build projects** resets then prepares the library.
PostgreSQL stores are disconnected; their remote databases are retained. Backups,
the home and source folders remain. The dialog lists the actual scope and the
recursive rule; a changed inventory requires a fresh confirmation.

The terminal `reset`/`teardown` commands above still operate only on confirmed
fixture ownership. They now independently verify cleanup inventories before
reseed/success, and setup/reset verify files, history and configured workspaces.
Use **Clear history...** on CLI Activity to clear only that environment's logs.
Real general-reset proof: `docs/evidence/preset-controls/general-reset-live.json`.

## Build from the redesigned preset workbench

Build preset always performs general environment reset first, then verifies
cleanup, creates the library and verifies files, branch graphs and main Layers.
The UI and terminal share the same orchestrator:

```sh
node tools/demo-fixtures.mjs build --preset studio
```

This removes all resources in that selected home, including non-fixture resources.
The existing terminal setup/reset/teardown commands keep their separate contracts.
View script shows the ordered real CLI command plan and a complete terminal
command pinned to the target home and CLI. Every project has its own script view. Script inspection creates no
resources. Build planning checks requirements before destructive reset begins.


## Dense tiered library (content version 3)

The same Studio topology now assigns eight unequal history tiers. Targets range
from 2,400 Commits / 54 side Branches / 500 main Layers to 10,056 Commits /
199 side Branches / 2,095 main Layers. All eight project scripts start together
after placement, and smaller projects finish naturally. The full recipe has
50,834 history mutation commands. See `docs/specs/dense-project-history.md`.

Step receipts use `demo-steps.ndjson`; the small manifest records ownership,
progress and capture verification. An interrupted or uncertain mutation is never
replayed. Verified cleanup resets the journal, and general Reset also clears
CLI Activity with generation fencing. Preset activity segments are protected
from ordinary pruning with a 1 GB budget. Capacity refusal stops new CLI
admission; it does not silently discard the start of the run.

The script drawer loads 100 commands per page. Explicit full-plan downloads
retrieve all pages. Activity loads command metadata pages and selected streams
separately. Saved project verification follows every immutable history page and
compares exact mutation invocation IDs with retained input/output records.
