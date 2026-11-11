# CLI activity

Connect records desktop actions and actual LayerFS child processes. Capture is
owned by `host/cli/spawn.js`; the renderer supplies correlation metadata through
the existing preload/IPC/HTTP bridge. The web preview uses the same HTTP contract.
No shell wrapper or second execution is used for logging.

## Files

```text
host/activity/
  context.js       AsyncLocalStorage context and child-process metadata
  recorder.js      Invocation lifecycle and live change notifications
  redact.js        Bounded input/output capture and credential redaction
  store.js         Private NDJSON shards, rotation, retention, reads
  routes.js        Authenticated list and action detail queries
shared/cli-activity.d.ts
desktop/src/renderer/src/layerfs/activity-action.ts
desktop/src/renderer/src/layerfs/activity-api.ts
desktop/src/renderer/src/pages/activity/
  CliActivityPage.tsx
  ActionRow.tsx
  InvocationDetails.tsx
```

Declarations are shared without loading the root application's JSX runtime into
the separately installed desktop renderer.

## Correlation

The renderer assigns one UUID to a button event, recording its visible label or
accessible name. API calls also carry a stable operation name, target and page.
Calls made after the event ends receive their own inferred action; ordinary GET
polls are background calls. Metadata is captured before renderer admission queues.
Native and browser requests carry the same encoded `X-LFS-Action` header.

The authenticated host validates and sanitizes this metadata. AsyncLocalStorage
preserves it through awaits and detached jobs. Doctor jobs and queued scenario
runs explicitly retain their own context so draining another job's queue cannot
misattribute commands. Scenario shells inherit correlation through environment
metadata. Local agent shell tools take current context at tool execution time;
detached children without an action context remain background activity.

Each actual attempt has an independent invocation UUID. Concurrent reads sharing
one process reference that invocation and its output; no extra execution is
invented. A cache hit or rejected request may launch no process.

## Events and storage

Every event is a versioned NDJSON line:

```text
{v:1, id, at, seq, action:{id,name,label,target?,page?,origin},
 type, invocationId?, data}
```

Events: `action.received`, `action.finished`, `cli.queued`, `cli.started`,
`cli.progress`, `cli.finished`, `cli.shared`. Background requests with no CLI
work do not produce successful empty action rows. The process-spawn event is
required for `cli.started`; queue rejection never claims a process ran.

Files live under `<Connect state>/logs/cli/` (0700; files 0600):

```text
activity-2026-11-09-<pid>-<writer UUID>-1.ndjson
activity-2026-11-09-<pid>-<writer UUID>-2.ndjson
```

Each process owns its own shard, avoiding interleaved child-process writes. The
writer serializes appends, rotates at 5 MB or a UTC date change, and prunes oldest
shards on append to retain at most 100 MB and 7 days. Readers ignore expired data
and incomplete lines. Normal host/shim exits drain pending writes. A process
that dies without a final event leaves an interrupted, uncertain invocation;
this is diagnostic history and never authorizes replay.

## Input, output and outcomes

The viewer shows sanitized argv, the actual executable, optional binary identity,
stdin when supplied, stdout and stderr. Each stream/input is capped at 32 KiB
with original byte counts and explicit truncation. Output appears at process
completion; structured progress is available while running, sampled at most four
times per second. Framed exec output is shown as the CLI actually emitted it.
Passthrough commands with inherited streams explicitly report output unavailable.

The CLI process exit and `workspace exec` command exit are separate fields. A
completed LayerFS call can contain a nonzero inner command exit. Refusals,
usage errors, launch failures, pre-spawn rejections and lost/malformed results
remain separate outcomes. Nothing is retried by the logging layer.

Before persistence, redact known secret environment values, values from explicit
env/file references, sensitive flags, URL credentials, bearer tokens and common
credential fields. No environment snapshot is recorded. Pattern redaction cannot
recognize every arbitrary secret in program output; exports contain the same
sanitized, bounded data as the viewer. Logging errors do not change the CLI result;
the activity endpoint reports a save diagnostic.

## Viewing

Preset Reset clears the selected demo environment's activity before resource
cleanup and records the reset as a fresh action. Generation metadata and
cross-process leases under `<state>/logs/cli-control/` prevent queued writes or
old action continuations from resurrecting cleared records. A successful clear
unlinks old NDJSON shards. It preserves other environments' logs and the fixture
ownership/mutation ledger. Busy calls block clearing; failed preflight preserves
history. See [preset controls](demo-preset-controls.md).

`GET /api/cli-activity` supports origin, status, search, before and limit (max 200).
`GET /api/cli-activity/:actionId` returns one retained action. Both require the
host bearer token. Existing SSE carries `cli-activity` invalidations; the viewer
also polls every five seconds to discover other writers. Viewing activity never
launches LayerFS. Refusals link to `#/activity?action=<id>`; export downloads only
the currently displayed retained action records.

## Project association for workspace activity

Project-filtered activity uses command metadata. Direct project, branch, commit
and file calls take their project from the documented project argument. A successful
`sandbox create <store/project> <name>` associates that sandbox name with the project
within the same action and activity generation. Workspace mount, exec, commit,
unmount and status calls resolve their sandbox or workspace handle through that
association. Failed creation does not establish an association, and arbitrary
paths in exec bodies or daemon arguments are never interpreted as project IDs.

Independent writer shards can be read in a different order from execution.
Unresolved workspace records are associated after all newly available shards have
been indexed, including a sandbox creation discovered on a later refresh. Clearing
activity clears these associations. The bounded metadata index does not load
stdin/stdout/stderr or issue CLI reads for project filtering; command details remain
lazy. A workspace whose sandbox was created outside the retained action can remain
unassociated rather than borrowing an unrelated action's name mapping.

## Verification (2026-11-09)

- Desktop typecheck and production build passed.
- 34 focused tests passed with `node --test --test-concurrency=1
  --test-timeout=120000 host/test/activity.test.js host/test/cli-adapter.test.js
  host/test/cli-progress.test.js host/test/doctor.test.js
  host/test/jobs-reconcile.test.js host/test/server.test.js`.
- One earlier parallel batch exceeded the existing fake cancellation child's
  two-second deadline; the serial batch passed. No production timeout was changed.
- Reused the actual web preview at port 1025 and a dedicated browser tab. Clicked
  Machines Refresh, then observed its one action containing six CLI invocations.
  Expanded completed and refused calls; inspected input and stdout/stderr.
- Exercised origin/status filters, empty results, search, expand/collapse, copy
  feedback (`Copied`) and export. The exported filtered NDJSON contained one
  Refresh action with output included.
- Inspected 1280 x 820 and 900 x 600 layouts; no document horizontal overflow at
  900 x 600. Existing transient HMR syntax errors from concurrent Storage/Files
  edits cleared; no later viewer console errors were observed.
- Electron was not launched. Native IPC forwarding was typechecked and built;
  native clipboard/download behavior and real model-driven chat runs were not
  exercised. Detached agent children without an action context remain background
  activity, as described above.
- Host disk headroom at handoff was approximately 341 GB; no cleanup or Cargo
  target/cache allocation was required for this task.
