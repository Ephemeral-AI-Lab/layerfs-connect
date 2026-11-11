# Demo preset controls

Status: Implemented, 2026-11-09. Native without sandboxes and Empty have real CLI
and browser evidence; Studio/Starter and sandbox provisioning remain unverified.
The sections below retain the design contract. See implementation notes at end.

## Goal

Select, run and reset real LayerFS demo presets from the existing desktop
renderer. Every run shows its action, actual CLI input, stdout and stderr in
CLI Activity. Reset also clears the selected demo environment's previous CLI
Activity. View CLI Activity navigates to the existing activity page.

Reuse the [CLI fixture runner](../cli-demo-fixtures.md) and
[activity recorder](cli-activity.md). Never fabricate resources, output or
successful results. The web preview and Electron use the same host contract.

## Entry and selection

- Add Presets to the workspace sidebar, opening `#/presets`.
- Render a reusable `PresetControls` component on that page.
- Offer `native`, `starter`, `studio` and `empty`, using the existing preset
  definitions as the single source for names, descriptions and counts.
- Default to Native on first visit. Restore the last selection on later visits.
- Show intended machines, stores, projects, sandboxes and workspaces; distinguish
  built-in machine records from workers actually used by the preset.
- Show requirements before execution: Docker, Lima, matching Linux bundle or
  native daemon, as applicable. Show verification coverage separately from
  whether this machine currently satisfies those requirements.
- Provide Create sandboxes and workspaces, default checked for a new fixture.
  Restore the persisted setting for an existing fixture. Changing it requires
  Reset; Run must not silently change an existing fixture's configuration.
- Empty has no sandbox option and starts no workers. Resetting Empty still
  clears its activity and removes any confirmed fixture-owned resources.

## Environment isolation and viewing

Each preset uses its existing private state directory and LayerFS home:

```text
~/.layerfs-connect-demo/<preset>/
  home-2/
  demo-fixtures.json
  logs/cli/
```

Selecting a preset previews its configuration; it does not switch the app's
active environment or launch LayerFS. Run activates that demo environment and
starts setup. A separate Open environment control activates an already
initialized preset without reseeding it. Reset operates on the selected preset
and activates it after admission succeeds.

Show both Selected preset and Viewing environment. Machines, Storage, chats and
CLI Activity must all use the same active environment. A visible environment
indicator provides Return to original environment. Switching is disabled while
an environment has active mutations or execution jobs; explain which operation
must finish. Do not migrate existing chats or jobs across homes.

The host owns environment registration and switching; the renderer never sends
arbitrary state paths or CLI executables. Use a host-managed context per demo
home, with its own adapter, recorder and jobs. The renderer's existing API bridge
targets the active context. Switching invalidates home-scoped caches and event
subscriptions, and rejects stale responses from the previous context. Do not
restart Electron or take another session's preview server.

## Run preset

1. Validate the selection, settings, ownership and required platform support.
2. Acquire the fixture's existing cross-process lock and admit a durable job.
3. Activate the selected environment and create one `demo.setup` action, labeled
   Run <preset> preset, retaining its action ID before the first CLI invocation.
4. Execute the shared fixture runner through the existing CLI adapter and
   desktop management services. Do not spawn an untracked shell command.
5. Show actual phase/progress and the final outcome. Refresh Machines and
   Storage from actual host data after mutations.

Run is additive and uses the runner's persisted mutation ledger. Repeated Run
must not duplicate successful writes. Missing, conflicting or uncertain prior
mutations require an explicit error; do not infer permission to replay them.
Run preserves previous CLI Activity.

## Reset preset, including CLI Activity

Reset requires a confirmation naming the selected preset and its private home:

> Reset <preset>? This removes its fixture-owned stores, projects, sandboxes
> and workspaces, then creates them again. Its VMs stay available. Previous CLI
> Activity in this demo environment will be cleared. The reset will be logged
> as a new action.

Buttons: Cancel and Reset preset. The confirmation is part of the product flow.

Reset clears all prior activity in the selected demo environment, including
background activity, rather than merely hiding older preset actions. It must
not clear activity in another preset or the original non-demo environment.

Required order:

1. Validate ownership and configuration, acquire the fixture lock, and ensure
   no other work is queued or running in the target environment. Confirmation
   alone does not bypass an active CLI process, chat, job or terminal writer.
2. Perform read-only admission checks. If admission fails, preserve activity
   history and fixture data. Return an actionable error.
3. Quiesce background CLI polling and flush pending activity writes. Atomically
   advance a durable activity generation and clear the previous generation.
   All writers and readers must honor this boundary, including terminal
   scripts. A writer from an old generation must not resurrect cleared rows.
4. Create the fresh `demo.reset` action in the new generation, then execute the
   existing owned-resource cleanup and reseed sequence under that action ID.
5. Resume background work and publish activity/resource invalidations. The reset
   action remains visible, including failures, partial progress and actual I/O.

Clearing must remove old retained activity files, not just the UI filter. Keep
the durable generation boundary so stale writers remain fenced. Never unlink
an active writer's file. If quiescence cannot be established, refuse Reset
before clearing or resource mutation. If clearing fails, do not start resource
cleanup; surface the error and preserve a fresh failure record when possible.

Once clearing succeeds it is irreversible. A later cleanup or reseed failure
does not restore previous logs or imply rollback of resource operations. Say
that history was cleared and show the new failed reset action. Preserve the
ownership manifest and mutation ledger; these are not activity logs.

The current terminal runner does not clear activity on reset. Implement this
policy in a shared reset service and use it for both the UI and terminal reset,
documenting the changed behavior in CLI help and the fixture guide. Direct CLI
call recording continues through `host/cli/spawn.js`.

## Progress and navigation

- States: loading, ready, queued, running, completed, failed and interrupted.
- Disable selection, sandbox settings, Run and Reset while an operation runs.
- Show phase text such as Creating project website only from actual runner
  events. Counts show confirmed progress; do not simulate a percentage.
- Keep page reads available during setup/reset. Machines, Storage and projects
  show actual resources as they appear, with a neutral running banner. Block
  conflicting mutations, not browsing. During host handoff, wait for admission
  rather than answering a page read with a preset-busy error.
- Navigation away does not cancel the host job. Returning reconnects to its
  persisted job ID and last known status. Reloading never resubmits a mutation.
- Lost transport means outcome unknown until reconciled. Never retry a POST
  automatically. Host restarts mark unreconciled work interrupted.
- Include View CLI Activity as soon as the action ID is available, while
  running and after success or failure.
- The link navigates to `#/activity?action=<actionId>` in the same app and same
  demo environment. It does not open an inline console, modal or separate tab.
- The activity page expands the selected action and shows action metadata,
  executable/argv, supplied stdin, stdout, stderr, progress and exit outcome.
  Existing redaction, truncation and retention rules apply.
- A cleared deep link says the activity was cleared; an expired one says it is
  no longer retained. Never silently display a different action.

## Host contract (proposed)

All endpoints require the existing host authentication and bounded validation.

| Endpoint | Result |
|---|---|
| `GET /api/demo-presets` | Definitions, requirements, verification coverage, selected and active environment |
| `GET /api/demo-presets/:preset` | Manifest settings, confirmed resources, latest job and action IDs |
| `POST /api/demo-presets/:preset/activate` | Activate an initialized environment, without setup |
| `POST /api/demo-presets/:preset/run` | Admit setup; return job ID, environment ID and action ID |
| `POST /api/demo-presets/:preset/reset` | Confirmed reset admission; return job ID and fresh action ID |
| `GET /api/demo-presets/jobs/:id` | Durable phase, progress, outcome, errors and activity link |
| `GET /api/demo-presets/requests/:requestId` | Reconcile an admission receipt without submitting work |

Run/reset accept a client-generated request ID for admission deduplication.
Reset also requires an explicit clear-activity confirmation and expected
manifest revision so a stale dialog cannot reset a changed environment.
Requests accept preset IDs and supported settings only. Use the existing
authenticated event channel for updates, with polling as recovery.

Preflight failures before admission have no reset action ID and preserve the
old history. Accepted jobs persist their action association before responding;
a lost response can be reconciled by request ID without replaying the work.

## Proposed files

```text
host/demo-presets/
  manager.js              environment contexts and operation admission
  routes.js               authenticated preset and job endpoints
  jobs.js                 durable progress and reconciliation
host/activity/
  store.js                generation-aware clear, readers and writers
tools/demo/
  presets.mjs             existing shared definitions
  runner.mjs              existing shared operations and ownership ledger
shared/demo-presets.d.ts
desktop/src/renderer/src/
  components/presets/PresetControls.tsx
  pages/presets/PresetsPage.tsx
  layerfs/demo-presets-api.ts
docs/ui/presets.md
```

Also update the existing sidebar, router, active-environment API bridge, CLI
Activity deep-link state, CLI help and fixture documentation. Avoid duplicating
the fixture mutation logic in HTTP handlers or renderer components.

## Acceptance and verification

- Select each preset and check counts, requirements and persisted settings.
- Run Native without sandboxes against the real pinned CLI; verify resources
  and actual command input/output. Repeat Run and prove no duplicate writes.
- Seed prior user/background activity, then Reset. Old activity files and rows
  are gone; only new-generation records remain, including the complete reset.
- Verify clearing across host and terminal writers, queued writes, interrupted
  clear, stale readers and host restart. Active work blocks Reset without loss.
- Prove another demo home and the original environment retain their resources
  and logs. Switch environments and verify all views use the same home.
- Exercise View CLI Activity while running, after completion and after failure;
  verify navigation, the action filter, expansion and cleared-link feedback.
- Verify failed preflight preserves history; a failure after clearing leaves
  a fresh failed reset record and truthful partial-resource state.
- Exercise reload, navigation away/back, duplicate submissions and transport
  loss without launching a second mutation.
- Exercise keyboard selection, confirmation focus, busy states and errors in
  the actual preview at 1280 x 820 and 900 x 600. Run renderer typecheck/build.
- Verify Studio and Starter against real Docker/Lima before labeling them
  verified. Test sandbox/mount coverage separately. Empty requires its own
  real-CLI check. Automated test doubles do not establish platform support.
- Electron GUI verification remains outside scope unless explicitly requested.

Known baseline: Native without sandboxes has real-CLI setup/reset/teardown and
activity evidence. Full Studio, Starter, Empty and sandbox provisioning have
not been established by that evidence. Environment switching, preset controls
and cross-process activity clearing are the new work implemented here.

## Implementation notes

`host/demo-presets/manager.js` owns durable jobs and the gateway to private child
hosts; a separate jobs module was unnecessary. `admission.js` shares terminal/UI
host-work checks, and `host/activity/gate.js` owns cross-process leases and the
generation fence. Each job uses the existing fixture runner and CLI adapter.
Preset resources use direct CLI operations; the existing `--via desktop` option
continues to select desktop management routes for terminal-driven fixtures.

The gateway preserves one authenticated renderer connection. Activating a home
reloads only the renderer, clears its caches and reconnects the event stream;
it does not restart Electron. A child host belonging to another process is
refused rather than adopted. An idle managed child closes before fixture
mutation so no cached inventory or background work crosses Reset.

Native Reset was clicked in the actual renderer preview with requests routed to
a private test host, preserving the shared preview process. It removed previous
activity files and recorded a fresh reset with 31 actual CLI calls and complete
input/stdout/stderr. View CLI Activity navigated to and expanded that action.
Repeated Run used nine read/discovery calls and no mutations. This is additional
evidence; it does not establish the unverified platform configurations above.

Empty setup/reset and CLI verification also passed. Its reset was clicked in
the renderer, captured its one actual CLI call, and left Native's log files
byte-for-byte unchanged. A terminal Native reset using desktop management
operations captured 38 CLI invocations and appeared on the Presets page through
the shared manifest receipt. Independent live writers rotate shards after a
clear, and failed response reconciliation uses a read-only request lookup.

## Event-stream crash correction (2026-11-09)

Run admission closes the previous environment's event stream before publishing
new progress. Originally the stream removed its event listeners only when the
HTTP close event arrived later. Immediate progress therefore wrote to an ended
response and crashed Node with `ERR_STREAM_WRITE_AFTER_END`. The initial browser
verification routed fetch requests to a private host but did not route its live
EventSource connection, so it missed this lifecycle path.

Logical stream close now detaches observers and stops heartbeats synchronously,
before ending the response. This applies to the normal host stream and preset
progress stream. Proxy streams also unpipe their upstream before ending. The
preview wrapper marks itself stopped on disposal, preventing a late HTML
transform from launching a child after Vite has closed that wrapper.

A subprocess regression reproduced the Node crash before the fix and passes
afterward, including progress published immediately after both stream types
close. A separate real Native run/reset with live HTTP event streams passed:
both original and running streams closed cleanly, Reset completed with 31 CLI
invocations and complete input/output, and return to the original home worked.
The preview restarted through normal Vite config dependency reload with its
state retained; interrupted user operations were not automatically replayed.

## Live pages during preset execution (2026-11-09)

The initial gateway rejected all resource requests while a preset ran. Normal
Machines/Storage reads therefore appeared as connection-style error panels.
The gateway and shared terminal fixture guard now allow GET requests. An
observer host serves the existing page services without recording native daemon
configuration or running scenario cleanup at startup. POST/DELETE remain blocked.
The active environment banner explains that resources are appearing and links
to Presets and CLI Activity. No simulated inventory is returned.

The real home is initialized before admission exposes that environment. On
completion, the observer drains already admitted page reads before retiring;
new reads wait during the handoff to a normal host. A real Native setup/reset
verified successful Machines, Storage, Projects and Status reads while the job
was running, followed by successful page reads during Reset and completion.

## General environment reset (2026-11-10, supersedes UI Reset scope above)

The UI Reset environment control discovers the complete selected LayerFS home,
regardless of fixture ownership or resource name. It is available for both the
original home and preset homes. It defaults to an empty environment; Rebuild
selected preset is an explicit unchecked option, not an implicit reset side effect.

GET `/api/demo-presets/:environment/environment-plan` returns the home identity,
all detected resource names, workspace paging results, unknown sandbox workspace
counts, machines that must be started, PostgreSQL disconnections and a fingerprint.
POST `/:environment/environment-reset` requires confirmation, that fingerprint,
a request ID, rebuild boolean and sandbox setting. Duplicate requests reconcile
without replay. A changed plan is refused before log clearing/resource deletion.

`host/environment-reset.js` performs dependency-first real CLI operations:
workspace unmount --discard -> sandbox close -> SQLite store remove / PostgreSQL
store disconnect -> custom machine remove -> Docker stop. It starts stopped workers
only to reach dependencies. It never uses forced close or global filesystem deletion.
All pages remain readable during reset; conflicting changes and history clearing
are blocked. Workspace and sandbox lists consume every page.

The new reset action captures actual input/stdout/stderr. A durable
`<state>/environment-reset.json` records confirmed inventory, completed commands,
remaining resources, warnings and errors. After deletion, independent CLI inventories
must show no stores, sandboxes, custom machines or running Docker worker. Only then
can an optional preset rebuild run, under a separately linked action, with actual
file/history/workspace verification. The fixture manifest is cleared only after
successful general cleanup; it is not the source of general cleanup authority.

Native/Docker built-in records, the home, sample source folders, backups and remote
PostgreSQL databases remain. CLI provider warnings are shown; an empty LayerFS
inventory does not claim unregistered provider disks/processes were scanned.

Independent Clear history on CLI Activity uses GET `/api/cli-activity/state` and
POST `/api/cli-activity/clear`, confirms home and generation, refuses active host or
CLI work, removes old NDJSON and fences old writers. It does not change resources.
The original terminal fixture reset/teardown retains its ownership-scoped contract.

## Focused preset workbench (2026-11-10, supersedes controls layout above)

The UI uses a searchable catalog and selected-detail pane. Actual projects are
grouped by store, supported options collapse under Options. Main controls are
Reset, View script, Build preset. No additive Run action or rebuild checkbox.
Build always resets the selected environment before provisioning. Reset empties
that same target; the original-home reset is available in the environment menu.

GET `/:id/build-plan` (or `build-plan-no-sandboxes`) safely prepares a fresh private
home and checks prerequisites before confirmation. POST environment-reset with
rebuild:true executes `tools/demo/build.mjs`, shared with terminal `build`.
One validated lock spans reset, fixture-manifest updates and setup. Home identity
is checked before destructive cleanup. Verification failure prevents building.

GET `/:id/script` / `script-no-sandboxes` returns the runnable selected command,
resolved configuration and an ordered CLI command plan with exact argv/stdin.
The viewer shows CLI rows grouped by reset/build/verify, with stdin collapsed.
Existing homes supply concrete cleanup targets; runtime discovery is labeled.
Copy/Download produce a command plan, while Run from terminal exposes the full
orchestrator that also prepares sample files and clears activity. Build command
recipes are shared with execution; legacy source fields remain API-compatible.

Jobs persist progress {stage, completed, total|null, label} and ordered actionIds.
Stages: checking/resetting/building/verifying. Counts represent real phase work;
unknown discovery is indeterminate, with no time-based percentage. Cleanup
verification is included in the resetting phase before building starts. Reset
and setup action records stay separate and appear as linked operation phases.

CLI Activity uses compact action/command lists and a single selected-command
inspector. Input remains exact; Output, Standard error, Details are tabs. Standard
error contents alone never imply failure. Metadata and retention move into
secondary disclosures; Export and Clear history use a header overflow menu.


### Machine-first preset plan

Preset details render Machine → SQLite store → Project with expandable groups
and a selected resource inspector. Machine definitions include configured
platform, CPU, memory and disk. Resource selection filters the CLI plan using
argument identifiers; command messages and stdin never establish identity.
Status follows the matching build action only and is scoped to the active home.
Created means a successful creation/start call; Ready requires presetVerified.
The overall real progress bar stays above the tree during a job. The tree stays
visible during reset and failure and is labeled as the plan, not live inventory.
Recorded command links select their exact activity invocation.


### Single ready project library (2026-11-10)

The current UI has one Studio preset (4 machines, 4 SQLite stores, 8 projects),
with no catalog/search or sandbox option. Each project row exposes View script.
Build projects performs general reset followed by file/branch-only setup and
verification. Old IDs remain available for existing-home compatibility/cleanup;
only Studio is listed. Content version 2 prevents older receipts implying that
new project content is ready. Full design: [Ready project library](preset-project-content.md).
Per project: 24 unique commits, 9 side branches, 2 divergent merges, 4 publishes.
Construction does not execute project applications or create sandboxes/workspaces.
