# Doctor integration redesign

Status: proposed, 2026-11-09. Design only; no implementation changes. Preserve the
approved visual system in `design.md` and the current renderer in `desktop/`.

Transport update: the user subsequently selected CLI integration. See
[`../cli-integration.md`](../cli-integration.md) for the current integration
boundary. Node binding material below is kept as the original SDK proposal and
marked superseded where the CLI differs; report semantics and host-owned lifecycle
requirements still apply.

UI update (2026-11-09): the Sandbox Diagnostics tab was removed with the Sandbox
detail simplification and does not return. Doctor arrives through contextual
actions that open one shared report panel. A global Diagnostics destination is not
a prerequisite (see [Navigation](#navigation-and-entry-points)).

## CLI contract (reviewed at `ce0e00bef2`)

| Item | Fact (source: `api/crates/layerfs-cli/src/doctor.rs`, `output.rs`) |
| --- | --- |
| Syntax | `layerfs doctor` (legacy); `doctor host`; `doctor machine <machine>`; `doctor sandbox <sandbox>`; `doctor store integrity <store> [--quick]`; `doctor store connection <store>`; `doctor backup connection <bucket> [--write-test]`; each target also `[--timeout <500ms\|10s\|2m\|1h>] [--text]` |
| Output | Report as one JSON line on stdout. Always read JSON, never `--text` |
| Exit codes | 0 for any produced report, **including failed checks and `complete:false`**; 2 for unknown target, bad/duplicate option or bad duration (`run::wrong`), and on builds without targets; 125 for a home refusal |
| Explicit report | `ok, complete, target{kind,name}, operation, mode` (`full`/`quick`/`observation`/`write-test`), `home`, `checks[{id,code,outcome,severity,entity,message,evidence,fix,blocked_by,observed_ms,duration_ms}]`, `findings[…,check_id]`, `truncated`, `counts`, `observed_at_ms`, `duration_ms`. `checks[].id` equals `code` and can repeat |
| Legacy report | `{ok, findings[{severity,entity{kind,name},message,fix}]}`; no completeness; an empty home answers `ok:true`; does not create a home |
| Capability probe | `doctor host -h` must exit 0 and print `layerfs doctor host`. `doctor -h` alone is insufficient (`91a59406` exits 0 with legacy text; `d4304741` exits 2). Probe `doctor store integrity -h` for `[--quick]` and `doctor backup connection -h` for `[--write-test]` |
| Progress / cancel | None. Killing the CLI ends the local diagnosis without a report and may leave a write-test object, an un-ended daemon session or a running PostgreSQL query. Offer at most "Abandon (no report)", never Stop, and never for `--write-test` |
| Local binaries | Neither local 2.0 build (`d4304741`, `91a59406`) has targets; a build from at least the reviewed revision is required |

## Goal

Make diagnostics an explicit run against one resource, with a report that says
what was checked, what failed, and what remains unverified. A successful connection
test must never imply data integrity, and an incomplete audit must never appear
as “Doctor: nothing found.”

LayerFS owns diagnostic logic. Connect owns selecting a saved resource, running
the diagnostic (now a `layerfs doctor …` CLI call), preserving its report, and
presenting the evidence. Connect parses only the CLI's JSON report; it does not
inspect LayerFS tables, run its own SQL checks, parse `--text`, or execute repair
suggestions.

## Sources and current gaps

Reviewed LayerFS `origin/layerfs_v2_0_0` at
`19612fbc1d4b3eca2294052ba5961eb4938f0a60`, rechecked at
`ce0e00bef2c958686038544afbf7da4e23dce8af` (later commits touch only FUSE drain and
cleanup tooling), including the SDK overview, CLI contract, relevant
Machine/Sandbox call pages, Doctor implementation and Node binding. The Doctor
production API is unchanged from `79b24f42e4`.

Connect currently calls package-level `doctor({ home })` through
`host/layerfs.js`. `Storage.doctor()` discards scoped checks, completeness and
coverage metadata. Storage's Needs attention control interprets an empty findings
list as “nothing found.” This cannot support targeted Doctor faithfully.

The linked `../layerfs-v2-merge/api/node` checkout is older: its wrapper accepts
only `home` and silently ignores extra options. Upgrade the JavaScript wrapper,
native addon, generated types and corresponding runtime bundle together. Resolve
the existing `layerfs` import versus upstream `@layerfs/node` package name explicitly.
Function existence and package version alone are insufficient capability checks.

## Navigation and entry points

First version: contextual actions only. Each resource offers an action that opens
one shared report panel with the scope preselected; Sandbox detail gets a header
"Diagnose" action (no tab; the former Diagnostics tab stays removed). Overview facts
remain the current observation, separate from the dated diagnosis. Do not create
per-resource result handling.

Later, optionally: one Diagnostics destination below Storage listing active runs
and recent reports, filtered by resource, operation and result. Opening it does not
start checks. It is not a prerequisite for CLI integration.

If that destination is added, use `#/diagnostics` for history and `#/diagnostics/runs/:id` for a stable report.
A preselected setup URL may include scope and saved name, but never starts work.
Populate targets from saved inventory, including stopped or broken resources;
failed inventory reads are errors, not empty lists. Keep historical reports
readable after resource deletion. Do not add Run everything in the first version.

There are five families and six targeted operations:

| Family / operation | Contextual entry | SDK target and options | What the result establishes |
| --- | --- | --- | --- |
| Host | Machines header: Diagnose this host | `host` | LayerFS host configuration and supported host prerequisites; distinct from the native Machine |
| Machine | Machine detail: Run diagnostics | `machine`, saved `name` | Selected Machine's supported runtime, worker and configuration checks |
| Sandbox | Sandbox detail header: Diagnose (opens the shared panel; no tab) | `sandbox`, saved `name` | Selected Sandbox daemon diagnosis; no component selector and no promise of complete mounted-filesystem health |
| Store integrity | Store detail/menu: Check integrity | `store.integrity`, saved `name`; full by default, optional `quick` and `timeout` | SQLite/PostgreSQL structural and LayerFS data integrity within the SDK's reported mode and coverage |
| Store connection | PostgreSQL Store: Test connection | `store.connection`, saved `name` | Authentication/connection from Connect's host process; no Machine-to-database reachability matrix |
| Backup | Saved bucket: Test connection | `backup.connection`, saved alias; advanced `write_test` | Observation of the configured S3-compatible connection; explicit write test additionally checks the SDK's temporary-object lifecycle |

Show check rows supplied by the SDK, including unsupported and blocked outcomes.
Do not promise a static checklist regardless of backend capabilities. Current
Machine compatibility flags are not measured PostgreSQL reachability; replace
phrases such as “usable from every machine” wherever this integration exposes them.

## The shared run inspector

Use a compact header with resource, operation, mode, observation time and duration.
Below it show two independent facts: findings and coverage. Present failed,
blocked and unknown checks first, with an option to see every retained check.
Each row expands to its code, evidence, dependency information and suggested
next action. Suggestions are advisory text with copy support, never executable
buttons derived from report strings.

| Report condition | Presentation |
| --- | --- |
| Complete, no errors or warnings | Completed — no issues found within the stated scope and mode |
| Complete, warnings | Completed with warnings |
| Errors, complete | Issues found |
| Incomplete, no observed issues | Incomplete — no issues found in completed checks |
| Errors and incomplete | Issues found — some checks remain unverified |
| No final SDK report after interruption | Interrupted — final result unavailable |
| Unsupported targeted API | Diagnostics unavailable for this SDK/runtime |

Use SDK `complete`, `counts`, `truncated`, `mode` and check outcomes faithfully.
An allowed skipped check does not necessarily make a report incomplete. `ok: true`
alone is not a green verdict. Counts may exceed retained rows. Check IDs can repeat;
do not use them as globally unique React keys. There is no separate coverage
object in the current report contract.

Last results are dated observations, separate from current resource state. Mark
them stale after relevant configuration/lifecycle changes. Retain Full integrity,
Quick integrity, Connection and Backup write-test reports separately; a later
lightweight success must not overwrite an earlier integrity or cleanup failure.

Use existing components, semantic colors and typography. Keep result lists as
rows with progressive disclosure rather than a grid of health score cards.
At compact desktop widths, show the run list and inspector sequentially instead
of squeezing two columns. Navigation back returns to the originating resource.

## Store integrity deserves its own run flow

The launch panel identifies the saved Store and backend, then offers Full
(default) and Quick. Explain the tradeoff before starting: Full provides the
SDK's deeper audit; Quick checks less and is not evidence of full integrity.
Neither mode is guaranteed constant time. Do not silently cap scans or relabel
a timeout as success.

Provide an optional time budget. The SDK currently gives full integrity no default
overall deadline; do not accidentally inherit an HTTP request timeout as a scan
deadline. Long reads can retain SQLite WAL history or PostgreSQL MVCC snapshots
and consume I/O. Show a brief scheduling note without turning every read-only
check into a permission dialog.

Preserve distinctions among database structural checks, LayerFS relationships and
content validation as emitted by the SDK. Show blocked dependencies explicitly.
Connect must not expand a passing subset into a claim that every database page
or content byte has been verified.

Run at most one integrity audit per saved Store within this host process, with a
bounded global diagnostics concurrency. This is a Connect scheduling policy,
not a cross-process database lock. Do not reuse transfer-job mutation locks.

No audits on page open, startup, five-second Machine polling, ordinary Refresh,
or after every storage event. Refresh reloads observations; Run again is explicit.

## Backup write test

Default Test connection uses observation mode. An advanced Test upload and cleanup
action explicitly sends `write_test: true` and explains that it creates and
removes its own temporary object version. Preserve key/version and cleanup
evidence when the SDK reports an uncertain or failed cleanup. A later successful
connection test cannot resolve that finding.

Some S3-compatible services cannot support the safe versioned write test. Display
that limitation separately from ordinary backup capability. Never retry the write
test automatically, replay it after reconnect, or offer blind cleanup of a bucket.

## Host-owned execution

The renderer requests a run; the host owns it across navigation and SSE reconnects.
Keep this manager separate from Storage transfer jobs, whose retry and restore
semantics do not fit diagnostics.

Proposed authenticated routes:

- `POST /api/doctor-jobs`: validate scope/options, allocate a run and return its ID.
- `GET /api/doctor-jobs`: list bounded run summaries and active jobs.
- `GET /api/doctor-jobs/:id`: retrieve lifecycle state and, when available, report.
- Existing `/api/events`: send small job updates/report-ready notifications; fetch
  the final report through GET rather than repeatedly broadcasting large evidence.

Pass an idempotency key for each explicit launch. A lost response or event stream
reconnect must not start another check. Reattach by run ID. Separate transport
failure from the state of a still-running SDK call.

The host fixes `home` from its existing configuration and validates saved names,
target-specific options and positive duration strings. The renderer supplies no
arbitrary database URLs, home paths or credentials. Omit inapplicable options:
even `quick: false` outside Store integrity and `write_test: false` outside Backup
are invalid in the current strict API.

CLI invocation (current transport; argv array, explicit `LAYERFS_HOME`, JSON only):

```text
layerfs doctor store integrity app --timeout 10m
```

Classify exit 0 as "report produced" (then read `ok`, `complete`, `counts`), exit 2
as "Doctor unavailable or incompatible / invalid options", exit 125 as a refusal,
and a signal or missing/malformed JSON as "Interrupted — no report".

*Superseded Node form, kept for reference:*
`await backend.doctor({ home: spec.home, target: 'store.integrity', name: 'app', timeout: '10m' })`.

Validate the returned scope/operation/mode and structured report rather than
accepting an old legacy report as targeted success. Preserve every supported
field through the adapter. Evidence can contain large integers and bytes: define
a lossless, versioned JSON representation instead of ordinary `JSON.stringify`
on raw SDK values or coercing integers into unsafe JavaScript numbers.

Store bounded recent reports in Connect-owned state, with a byte budget as well
as a count limit. Keep SDK/build provenance and observation identity. Credential
values must not enter logs, notifications or exports; retain useful nonsecret
diagnostic evidence. Persist lifecycle state atomically so host restart marks
unfinished jobs Interrupted. Never replay them automatically.

## Progress, cancellation and shutdown

Neither the CLI nor the Node Doctor API has progress or cooperative cancellation.
Internal persistence cancellation support does not provide public cancellation
through the top-level Doctor call. Therefore initial integration can show only
indeterminate Running, elapsed time and the selected budget. Closing a panel or
aborting an HTTP request does not stop the CLI child. Killing the child ends the
local diagnosis with no report and can leave side effects (see the CLI contract
table); present it at most as "Abandon (no report)", never for `--write-test`.

Do not show percentage progress or a Stop action without upstream support. Host
shutdown currently has a forced-exit deadline; leaving Connect can interrupt a
long audit. State this limitation in the launch flow and mark an unfinished run
Interrupted on restart. Do not claim an interruption rolled back a remote action.

Recommended upstream follow-up: a public Doctor execution context carrying
cooperative cancellation and optional check events through all probes, with a
Node binding that acknowledges actual completion/resource release and preserves
confirmed partial results. Only then add Stop and a cancellation endpoint.
Cancellation during backup cleanup needs explicit semantics. CLI subprocesses
or an HTTP-only abort are not substitutes for that contract.

Show Queued separately from Running; the SDK time budget starts when the call
begins, not when the user joins the queue. Distinguish View diagnostics from Run
diagnostics. Expired reports need an explicit unavailable/expired state, rather
than an empty healthy report. On Sandbox detail, Overview facts from `sandbox get`
remain the current observation; the shared panel shows the dated daemon diagnosis.

## Implementation areas and delivery order

1. Select a CLI build with targets and add the per-target help probes (CLI
   contract table). Extend the simulation with explicit targeted reports; label
   simulated results.
2. Add a dedicated host Doctor manager on the shared CLI adapter: lossless report
   parsing, exit classification, persistence, authenticated routes and
   existing-stream events. Keep the legacy NeedsAttention call working, relabelled
   "Home checks: no findings · ‹time›" with a neutral icon.
3. Add the shared typed renderer client/hooks and the shared report panel. A global
   Diagnostics workspace is optional and later.
4. Add contextual entry points, Sandbox detail first (`doctor sandbox`), then
   Machine, Store and bucket, all using the same manager and panel; update the
   relevant `docs/ui/*.md` specifications.
5. Complete upstream progress/cancellation separately before exposing Stop.

Existing integration points: `host/layerfs.js`, `host/server.js`, `host/main.js`,
`host/storage.js`, `host/sim/`, renderer `layerfs/{host-api,client,use-host}.ts`,
Storage's Needs attention component, Machine detail, the Sandbox detail header,
Store detail and backup bucket dialog.
Introduce a dedicated host Doctor module and shared renderer diagnostics feature;
do not put family-specific database checking logic in Connect.

## Acceptance evidence before shipping

- Prove options reach the matching native SDK and reject legacy reports; cover
  incompatible package/native combinations rather than trusting version strings.
- Exercise complete/partial/error/warning/blocked/skipped/truncated reports,
  repeated check IDs and lossless integer/byte evidence transport.
- Prove read-only navigation and Refresh never start audits; launch deduplication,
  navigation, SSE reconnect and lost launch responses never duplicate work.
- Prove late results stay attached to the original scope/mode, bounded retention
  does not drop active runs, and restart produces Interrupted without replay.
- Cover SQLite and PostgreSQL integrity, unsupported/stopped Machine dependencies,
  PostgreSQL-only connection controls and the absence of Machine reachability claims.
- Cover backup observation, explicit write test, unsupported safe write test and
  cleanup uncertainty retained despite a later successful observation.
- Exercise loading, empty, stale, unavailable and error states in the actual web
  preview at 1280×820 and 900×600, with keyboard navigation and browser-console
  checks. Run desktop renderer typecheck/build for implementation changes.
- Keep simulated scenario evidence distinct from real SDK/SQLite/PostgreSQL/S3
  verification. Browser tests cannot establish native cancellation or runtime ABI
  compatibility; verify those through host/SDK integration tests.

Research verification for this proposal: three independent family/API reviews,
read-only source review at the pinned branch, and inspection of the existing
Storage web-preview accessibility tree. No new UI or backend behavior has been
implemented or verified by this document.

## Phase-2 implemented exec and Doctor update (2026-11-09)

Authority: clean CLI `833d04cf44e8e747929d50ab1170a48260d9381c`, with
`machine,postgresql`. JSON discovery gates targeted Doctor commands. Mounted
execution uses `--events`, fresh persisted IDs and stream-frame bytes only;
final inline output is not duplicated. Phase-1 pre-registration cancellation
removes the former resend loop. Cancellation answers `outcome`, not `kind`.
Stop preserves Workspace and Sandbox. Unknown cancellation is visible and only
explicit manual cancellation can retry. Commit refusal is separate from command
exit. Folder Bash CLI shims retain mounted launch custody after transport loss.

Doctor uses explicit host-owned jobs, idempotent launches, bounded concurrency,
one integrity audit per Store, bounded dated reports and restart interruption
without replay. Shared contextual launch/report panels cover Host, Machine,
Sandbox, Store integrity, PostgreSQL connection and Backup connection. Full is
the default integrity mode; write tests require the explicit upload/cleanup
checkbox. Coverage and findings remain separate, including repeated check IDs,
blocked checks and truncated counts. No progress percentage or Stop is exposed.
Simulated reports are labelled. Full/Quick/connection/write-test reports remain
separate historical jobs; past reports are potentially stale observations.

Verification: `docs/evidence/phase-2/exec-native-second.json` records real native
exit125, pre-registration and running cancellation, retained partial changes,
and1048587 output bytes. The first failed assertion receipt is retained alongside
it. All fresh owned resources were closed and removed. Doctor and cancellation
host lifecycle tests distinguish real and simulated evidence. Browser and final
renderer build receipts are tracked in `phase-2-record.md`.

## Phase 2 saved-query consumers (2026-11-09)

Files/History/statistics now share the CLI boundary with Doctor. Saved file
queries preserve full pins, opaque continuations, omissions and partial coverage.
Their load errors do not replay mutations or trigger automatic recovery.
