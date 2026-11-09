# UI refinements for CLI integration

Proposed 2026-11-09; revised the same day after the cross-checked review recorded in
[CLI integration inventory](cli-integration.md) (LayerFS `ce0e00bef2`). Field-level
coverage of the detail views is in [observations and statistics](connect-cli-obs-stat.md).
This is a source-reviewed design list; nothing here is implemented.

The CLI stays behind Connect's host APIs. Most layouts and interactions stay. Each
row below is classed as:

- **CLI** — required by CLI semantics;
- **Bug** — an existing correctness bug, wrong today with the Node SDK as well;
- **Product** — an optional product improvement.

Timing: **Now** (first migration), **Preview** (when wiring that sample-backed
component), **Optional**, **Deferred**. File paths are under
`desktop/src/renderer/src/` unless they start with `host/`.

## Shared states vocabulary

Use these states consistently; never collapse one into another.

| State | Meaning | Presentation rule |
| --- | --- | --- |
| Loading | First read in flight | Skeleton; no counts |
| Empty | Read succeeded with no items and no `has_more`/`next_page_pos` | Empty copy; never shown after a failed read |
| Stale | Last good data is older than a failed or pending refresh, or a pin is older than a re-read head | Keep data, show "Last read ‹time› · refresh failed: ‹code›" or "Newer version available" |
| Unavailable | Confirmed refusal (`Unavailable`, `Busy`, `Unsupported`, `NotFound`…) or feature probe failed | Refusal with code/detail; no fake values |
| Incomplete | Result produced but `coverage.complete:false`, blame `partial`, Doctor `complete:false`, `truncated`, or unread pages | Banner naming what is missing |
| Clipped | `line_truncated`, `truncated`, `message_truncated`, `hunks_omitted`, `streamed` | Inline notice at the clipped item |
| Cancelling / Cancelled | Stop pressed / cancel `outcome:cancelled` or exec `kind:cancelled` | Disable repeat Stop; show signal |
| Interrupted | Host or CLI process ended without a final result | "Final result unavailable"; reconcile, never replay |
| Outcome unknown | `Unknown` refusal, cancel `unknown`, lost output after a mutation, `op.uncertain` | "Outcome unknown · Inspect"; only gated recovery |

Transport classes for the shared Refusal component: confirmed refusal (exit 125 with
JSON), usage/incompatible (exit 2, an adapter or binary mismatch), CLI unavailable
(probe failed, spawn error), lost/malformed output (signal, no line, bad JSON).

## B. UI refinement list

### Required now

| Component | Current behavior | Refinement | Why | Class | CLI dependency · acceptance |
| --- | --- | --- | --- | --- | --- |
| `layerfs/job-progress.ts:16-22` (`STEPS`, `segmentsOf`, `stepCount`) | Fixed lists: backup `snapshot,send,upload`, restore `download,install`; unknown phase reads "step 1 of 3"; failure there marks nothing | Build segments from phases actually seen (repeats allowed), known list as hint; name unknown phases; indeterminate when `total` null | Backup emits `check,snapshot,[send],check,hash,upload`; restore `check,download,verify,install` | Bug | `--progress` lines · a `check,snapshot,check,hash,upload` backup shows 5 steps; failure at `hash` marks `hash` |
| `pages/storage/JobProgress.tsx:127-150`, `host/storage.js:415-427` (Move) | Any push-half failure renders "Pulled to Home ✓ / Push again" | Drive from `error.code` + `detail.phase`: `check`…`verify` → "Pulled to Home; push failed (certain)"; `install`/`record` or `Unknown` → "Outcome unknown · Inspect"; `retire` → "Moved to X; old copy on Home not removed" (`detail.authority/source/retired`); pull-half `retire` → "On Home; source copy not removed" | Authority differs by phase (`sqlite/transfer/phases.rs`) | Bug | push/pull refusals · fixtures for all 7 phases × `Failed`/`Unknown` render matching authority |
| Move/push recovery (`JobProgress.tsx:147,231`, `pages/storage/StoragePage.tsx:139-145`) | "Try again" for every error | Confirmed failure: retry after fresh `store status` shows `idle`. Uncertain: show **"Resolve: clear the extra copy and push again"** only after a fresh read shows `state:unresolved`, the same `op.id`/`op.name`, and target machine running; explain that LayerFS deletes the copy its record does not name and restarts | A repeat push resolves then restarts; never automatic | CLI | `store status`, `machine status` · `Unknown` shows no retry until a fresh read; wrong direction is refused `Unresolved` |
| `host/storage.js:347-393` job model, `layerfs/storage-jobs.ts` | `error` vs `result`, in memory | Outcomes `succeeded / failed / interrupted / unknown`; persist records; on restart mark Interrupted and reconcile (push/pull `store status`, backup `backup list`, restore `store get`); keep children alive across views | Killed child ≠ failure; orphans may finish | CLI | Kill during `send` → interrupted, Store idle; during `install` → unknown, Store unresolved |
| `pages/storage/Operations.tsx:28`, `host/storage.js:107` | Any `op` listed as live | List `op` only when `state` ∈ {busy, unresolved}; otherwise "left by an ended process" or hide | `store list` shows stale ops | Bug | Stale `op` + `idle` → no Operations row |
| `components/layerfs/Refusal.tsx:25-52` | Code, message, entity, phase, op, related | Add transport classes above; show `detail.authority/source/retired`, `needed/free`, `missing`, `vm_exists`, `execs` | Recovery info; transport ≠ refusal | CLI | Each class has a fixture and distinct look |
| `host/projects.js:225-234`, `layerfs/host-api.ts:276-288`, `pages/storage/NewProjectDialog.tsx` | 1.x progress fields; drops refusal code/detail; uppercase names allowed | Map `{phase,done,total}`; keep refusal; `Failed`/`Unknown` → "may have been created; check Projects"; lowercase `[a-z0-9][a-z0-9_.-]{0,61}[a-z0-9]` | Init progress shape; `names.rs` | Bug | Uppercase rejected in form; retry after `Failed` shows `Exists` |
| `host/machines.js:121-126`, `pages/storage/StoragePage.tsx:329-330`, `pages/machines/MachinesPage.tsx:156` | Failed sub-read → `[]`; refresh error hidden when data exists | Per sub-read `{error, at}`; keep last good data with Stale banner | A failed read is not an empty inventory | Bug | Failing `store list` shows "Stores couldn't be read (‹time›)" |
| `host/storage.js:99-100` (+ `host/sim/world.js:637`, `host/test/layerfs2.test.js:233`) | Reads `serverVersion`/`latencyMs` | `server_version`, `latency_ms` | Results are snake_case; real values always null | Bug | Live PostgreSQL Store shows version and latency |
| `host/machines.js:185` | Calls nonexistent `machine.disconnect` | `machine remove`; show `note` | 2.0 API | Bug | Removing a removed-platform record succeeds |
| AddMachineDialog, Machine power (`pages/machines/MachinesPage.tsx:89-96`) | One blocking request, no states | Indeterminate "Creating… / Starting… / Stopping…" with elapsed time, no percentage; `Unknown` → Inspect (`machine status`), create `Unknown` offers `machine remove`; transport loss → re-read `machine get` | No machine progress; start ≤600 s | CLI | No percentage rendered; `Unknown` path |
| `pages/storage/NewStoreDialog.tsx:178` | "Left out: the database's own setting" | "Default: off" | `store connect` default | Bug | — |
| Sandbox close confirmations (`components/sandbox/SandboxTiles.tsx:14-38`, `pages/machines/MachineSandboxes.tsx:108-139`, `MachinesPage.tsx:93,102`) | No chat context | "Used by chat ‹title›; closing ends its Workspace" from Connect's chat↔Sandbox map | Closing `chat.<id>` silently breaks the chat | Bug | Chat-owned Sandbox shows the warning |
| CloseSandbox (`components/sandbox/SandboxTiles.tsx:14-38`) and Machines card menu (`pages/machines/MachineSandboxes.tsx:108-139`) | Any error offers "Force close" | Force only for `MountsActive` or `Busy` with `detail.execs`; confirm text: running commands get SIGTERM then SIGKILL after 5 s, uncommitted changes lost; `Unknown` → "Read Sandbox / Close again"; `Unavailable` → no Force | `--force` cancels commands | Bug | Each refusal path |
| Workspace inspector Details (`components/sandbox/SandboxWorkspaces.tsx`, `use-sandbox-detail.tsx:29-33`, `layerfs/sandbox-snapshot.ts:13-17`, `host/projects.js:97-115`) | Base commit and Branch head "Not reported", Changes "Not recorded" for host-backed Sandboxes (rechecked after the simplification) | Bind `base`/`base_layer`, `head_moved_since_mount` (and `workspace status .branch_head` on open), `dirty{inodes,entries}` as a change summary, `pending_merge`, `activity` incl. `Uncertain`/`LocalFailure`; never per-file patches | Fields preserved by the simplification; data already in `sandbox get` | Bug | Dirty/clean/pending-merge/uncertain fixtures |
| Overview Sandbox information and Workspace summary (`components/sandbox/SandboxOverview.tsx`, `host/layerfs.js:86-90`) | "Runtime ID: Not reported"; Created absent; unreached daemon counts 0 mounts; `op` not shown | Show `id` as "Sandbox ID", `created`, `op{name,phase,uncertain}` in the header; `down_reason` ⇒ "Workspaces unavailable: ‹reason›" (spec region 11), never zero; `gone` worded as "no runtime recorded", not "closed" | Supported facts; no Diagnostics tab needed | Bug | Unreached, `gone`, `lost`, uncertain-op fixtures |
| Sandbox polling (`components/sandbox/ProjectSandboxes.tsx:24`, `host/layerfs.js:80-95`) | `sandbox get` per Sandbox every 5 s | State from `sandbox list`; `get` on open/Refresh with backoff after `Busy`; label list state "recorded" | `get` may wait for daemon admission; list is records only | CLI | Process count per poll bounded |
| ChatDock Stop (`pages/chat/conversation/ChatDock.tsx:38,63-72`, `host/agents/index.js:1005-1009,1186-1238`) | Chat-level Stop; mounted exec ignores abort, then commits | For mounted execution only: "Stopping command…" → "Command cancelled (SIGTERM/SIGKILL)" / "Command finished before it could be stopped" / "Stop not confirmed — command may still be running [Try again]"; Stop disabled while stopping; queued command never launches | `exec-cancel` outcomes and bounded re-send rule | CLI | Race, `unknown`, double press, queued Stop |
| BashStep / ShellOutput (`pages/chat/conversation/steps/BashStep.tsx:33-53,101`, `host/agents/transcript.js:36`) | Spinner, then success or "failed" | Add cancelled (`kind:cancelled`, 128+n), interrupted (no result), outcome unknown; while running in a mounted Workspace: "Output appears when the command ends"; "N bytes of stdout not retained" when `stdout` null with `stdout_bytes` | Real result states; no live output | CLI | No endless spinner; no success mark on unknown |
| Mounted exec + commit (`host/agents/workspaces.js:206-213`) | Commit refusal hides the command's exit | Report exit, then "Not saved: Conflict/Unknown" separately | Different facts | Bug | Commit `Conflict` after exit 0 shows both |
| NeedsAttention (`pages/storage/NeedsAttention.tsx:20-50`) | "Doctor: nothing found" with success icon | "Home checks: no findings · ‹time›", neutral icon; transport states (running, exit 2/incompatible, malformed); reject explicit-target reports here | Legacy has no completeness; empty home answers `ok:true` | Bug + CLI | Exit 0 with `ok:false`; exit 2 on old CLI; malformed JSON |
| ProjectFiles data (`components/files/ProjectFiles.tsx:19`, `host/projects.js` `state`) | Loads full project state: `branch list` + `commit list` per Branch + `store status` + `sandbox list` | Lightweight branches route from `branch list` `saved_head` | One CLI process per Branch otherwise | CLI | Opening Files costs one process per 100 Branches |
| FilesTab pin (`components/files/FilesTab.tsx:203-238,305`) | Reads target the moving Branch name; ticks re-read everything; shows `+commits` and heuristic "merged" | Resolve `saved_head.id` once, pass as trailing `commit`; header shows `at.kind` + short id; tick runs only `branch get` → advance on "Latest", else "Newer version available"; drop counts and inferred "merged" | Heads move between processes; no totals | CLI | All reads share one `at.id`; unchanged tick = 1 process |
| Folder listing (`host/projects.js:521-536`) | All pages + up to 200 `file stat` per folder | First page + "Show more entries"; stat lazily | Process fan-out | CLI | Folder open ≤1 process per page |
| FileBody (`components/files/FilesTab.tsx:142-188`, `host/projects.js:539-561`, `layerfs/client.ts:169-172`) | Reads to end; `truncated` dropped; clipped text looks complete | Bounded first span + "Load more lines" via `next_line`; notices for clipped lines, more available, too large, `Binary`, `NoSuchPath` ("not present at this version") | Clipping is real data | Bug | Clipped lines marked; 125 file states are not load errors |
| ProjectHistory loader (`components/history/ProjectHistory.tsx:80-111`, `host/projects.js:407-439`) | `main` returns `[]`; `commit list`; `HeadMoved` 409; dead `c.branch` test | `branch commits` for main and side Branches; pin `at_commit`; next page `--at-commit <last.parent> --page 1`; stop side Branches at `forked_from`; "Newer saved versions exist" instead of 409 | Main history exists | CLI | Main Layers listed; deep pages never cold-replay |
| History inspector "Changed paths" (`ProjectHistory.tsx:187-205`) | "Changes unavailable… first checkpoint" | Commit→Commit `commit diff --cursor`; first Commit → pinned `branch diff` vs `base`; Layer → pinned `branch diff` vs parent Layer; Init → "Initial import"; `Capacity` → "Too many paths for one request" keeping selection | Comparisons now possible | CLI | `Capacity` keeps selection |
| HistoryGraph / model (`components/history/model.ts:33-39,129`, `HistoryGraph.tsx:180-183`) | Layer `parent` holds its source; layout sorts by `at ?? 0` | Separate `source` edge; spine from `parent`; topological layout; `source_time` only as unlabeled tie-break | Layers have null time; parent ≠ source | Bug | Publish edges correct; no Layer shows a publication time |
| History time and footer (`ProjectHistory.tsx:192,240`) | "Latest main Layer only…"; "When" | Remove footer; Layers: "Publication time not recorded · source saved ‹source_time›" | Outdated; time semantics | CLI | — |
| Simulated host (`host/sim/table.json`, `host/sim/world.js`) | No `branch.commits`, `get_commit`, `file.revision`, `at`, `saved_head`; wrong PostgreSQL keys | Add calls/fields matching the reviewed revision; keep sim labelled | Preview must exercise real shapes | CLI | `node tools/sim-table.mjs` diff clean |

### Required when enabling existing previews

| Component | Current behavior | Refinement | Why | Class | CLI dependency · acceptance |
| --- | --- | --- | --- | --- | --- |
| PageControls (`components/files/PageControls.tsx:4-11`) | `Page N of M` from `count` | `Page N`; Previous from retained pages; Next from `has_more`; page-size change restarts at 1 with same pin; no jump | No totals; deep pages expensive | CLI | No total rendered |
| FileExplorerPreview Revisions (`components/files/FileExplorerPreview.tsx:74-111`) | Exact counts; "Complete sample history"; client filters | Remove counts; "filters apply to loaded revisions"; show `scan`/`end_of_query`; selector values are 66-hex from `branch commits` | `file revision` contract | CLI | — |
| CommitDetails (`components/files/CommitDetails.tsx:5-26`) | Requires `time`; "Published ‹time›"; size from fixture | Nullable time; separate source time; rows for parent Layer, source Commit/Branch, base Layer, merge parent; record `logical` labelled "saved tree size" | Real records | CLI | Main Layer shows no message/time |
| FileDiff (`components/files/FileDiff.tsx:14-17`) | Null text ⇒ binary; no lines ⇒ "No content changes" | Drive from `change_kind`, `omission_reason`, `hunks_omitted`, metadata/identity flags, `--allow-missing` null sides | Omitted ≠ unchanged | Bug | Metadata-only change never "No changes" |
| FileBlame (`components/files/FileBlame.tsx:5-26`) | Non-null owner; index as line number | Nullable owner "Unknown"; use `n`; window via `next_line`; coverage banner | Contract | Bug | Window after line 1 numbers correctly |
| FileAttributionDiff, `components/files/attribution-model.ts:15-20` | Client aligns two blame streams | Use server `rows` and `attribution_coverage`; unknown ≠ zero changes | No client provenance | CLI | — |
| HistoryPreview (`components/history/HistoryPreview.tsx:126-157`, `file-preview-data.ts:170-179`) | "Empty project" endpoint; exact counts; synthetic `Attribution` kind | Remove empty endpoint; ownership-only change = `Modified` + attribution badge; Page N controls | No tree empty endpoint | CLI | — |
| Sandbox detail "Diagnose" action + shared Doctor report panel (new, when Doctor integrates) | Diagnostics tab removed; no Doctor action shown | Header action opens the shared report panel: explicit Run, indeterminate running with elapsed time, findings vs completeness, "Interrupted — no report"; Overview facts stay the current observation. No dedicated tab | `doctor sandbox` is dated diagnosis | CLI | Complete/incomplete/blocked/killed fixtures; probe `doctor sandbox -h` gates the action |
| StoreBreakdown (`pages/storage/StoreBreakdown.tsx`) | Labelled sample (DEV + sim), preserved | Wire after U4; real mode shows defined Store-wide totals and only ratios whose scopes match | Counters internal today | CLI | Real mode never shows samples |
| Project Storage tab statistics (`pages/storage/ProjectStorage.tsx`) | Preserved preview; real values from partial Commit sums | Saved-tree figures from one pinned version (`logical` now; entry counts after U8); Store-wide physical figures labelled Store-wide; no per-project disk or dedupe ratio | Scope correctness | CLI | Pin identity shown; no mixed-scope ratio |
| BucketsDialog Configure (`pages/storage/BucketsDialog.tsx:305-400`, `layerfs/client.ts:225`) | `replaceBucketKeys` posts to a missing route; URL/region "Not recorded" | Save non-secret `backup connect` answer; replace keys by rewriting the owner-only `file:` reference, then `backup list` | No `backup get` | Bug | Configure shows endpoint; replace-then-list succeeds |

### Optional

| Component | Refinement | Class |
| --- | --- | --- |
| Chat Files label (`pages/chat/FilesTab.tsx:14`) | "Saved versions; uncommitted Workspace changes not shown" | Product |
| Folder chats + agent shim (`host/runs/cli-shim.mjs`) | Inject `--exec-id`, record `{ws, exec_id, chat}` before spawning, let Stop cancel open entries; fix exit 2/125 misread now | Bug (shim exit) + Product |
| Storage/Machines polling | Coalesce, cache platforms, refresh PostgreSQL `store status` less often and show its time | CLI-recommended |
| Store page | Show `last_transfer.retired === false`, `incoming_on`, `file.free` | Product |
| History path-prefix narrowing after `Capacity` | `--path-prefix` input | Product |

### Deferred

Project import/export, standalone project deletion, file editing and mutations,
full-project glob/grep, user Branch merge/publish, Global Diagnostics workspace,
live CPU/memory charts, daemon logs, scratch browsing, Workspace per-file patches.
The Sandbox Scratch/Activity/Diagnostics tabs, Workspace Files/patch views and card
sparklines removed on 2026-11-09 stay removed; none is needed for command coverage.

## Components that stay unchanged

StateChip/States/`states.ts` (except a stale comment), StoreFacts, GapLine,
Simulation, ConfirmByName, MachineDetails/MachinePage/TargetParts layout, BucketCard,
NewStoreDialog structure, push/move sheet, `storage-jobs.ts` apart from consuming
`outcome`, CodeView, SearchField (keep "Find in opened folders" local), the Files
`Tree`, HistoryGraph presentation (plus a `source` edge), `branchLanes`, the
simplified two-tab Sandbox detail layout, SandboxResources (labelled current-value
samples behind `?metrics=sample`), SandboxMap, the Workspace inspector's Details /
Commands structure, the backup provider picker, NewSandbox, SandboxDetailPage,
SandboxesTab, Trace and Subagents tabs, ChatDock approvals, NewChatPage, existing
route shims.

## Open product question

Stop on a mounted chat always commits, unmounts and closes its Sandbox
(`host/agents/index.js:1238` → `workspaces.js:221-236`); Continue re-creates the
Sandbox and remounts `chat-<id>` (new scratch and daemon). Confirm this is intended
before layering cancel states on Stop.

## Acceptance

Exercise each state in the vocabulary with controlled host fixtures and the actual
web preview at 1280×820 and 900×600, then `pnpm --dir desktop -s typecheck` and
`pnpm --dir desktop -s build`. CLI behavior (refusal vs transport, uncertain
mutations, move phases, cancel race, >1 MiB output, pins, no-total paging, coverage)
is tested separately against a capability-probed binary. Keep simulated evidence
distinct from real CLI evidence.

## Preview walk performed for this review

Headless Chrome against the running simulated preview (read-only navigation):
Machines list and `native`; Sandbox `api-dev` Overview, Diagnostics, Scratch,
Activity; Storage and `shop`; project `shop/api` Files (fixture preview, then
"Browse host files", opened `src`); History (fixture preview, then "Browse host
history"); Example chat Chat and Sandboxes. Observed: "Doctor: nothing found" from
`{"ok":true,"findings":[]}`; Files/History fixture previews labelled "Sample data ·
read-only"; host history "Latest main Layer only"; Sandbox tiles' sample metrics
labelled "design preview, not live"; StoreBreakdown "Simulated · illustrative
values". No mutation controls were clicked.

After the 2026-11-09 Sandbox simplification: `api-dev` shows only Overview and
Workspaces; opening `feature-login` shows Details with Base commit and Branch head
"Not reported" and Changes "Not recorded" (the binding gap in the Workspace row).

### Phase-2 implementation update (#146 / #147)

Observed transfer phases replace fixed progress assumptions where available. Repeated
phases retain separate steps; indeterminate totals remain indeterminate. Persisted unknown
and interrupted outcomes require Inspect; recovery rereads the exact operation identity
and target state before proceeding. Sandbox list polling no longer dials every daemon;
open/Refresh preserves actual `sandbox get` fields and uses `workspace status` for head.
Overview labels Sandbox ID/Created and unavailable Workspace counts; gone means no runtime
recorded. Force close is limited to MountsActive or Busy with execs and explains signal/data
loss semantics. Stop policy was decided by the owner: keep Workspace and Sandbox open.

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

## Implemented saved views — phase 2, 2026-11-09

Files and History default to the real adapter in every mode. Code, revisions,
blame, content comparison and attribution comparison consume pinned saved queries.
Folder pages expose Show more entries; file/blame windows expose next-line reads.
Page labels are Page N without a total. Null owners, clipped lines, partial query
coverage and omitted comparisons remain explicit. Main publication parent/source
edges and absent publication times remain distinct. Store and project statistics
show separate scopes, with no mixed-scope ratio or inferred per-project disk use.


## Phase-2 baseline and adapter states — 2026-11-09

Owner approved preserving existing work in baseline 7c02313, then creating
phase-2-cli-integration. Machine power/create calls show elapsed indeterminate
state. A failed mutation exposes explicit current-state inspection; creation
uncertainty keeps removal options behind the selected Machine's detail. Failed
refreshes keep previous data and show a dated Stale banner. Sub-read failures
remain distinct from empty inventory. Free guest space is labelled separately
from allocation; allocation-minus-free usage bars are removed.

Owner selected Stop = cancel the mounted command and retain its Workspace and
Sandbox. Explicit deletion/shutdown retain their separate release paths.


## Native follow-up: accurate mode label (2026-11-09)

Native verification exposed a hardcoded `Simulated · 0.0.0` subtitle in the
current desktop sidebar even when the preload and host used the real pinned CLI.
The sidebar now consumes the same `connectBridge.mode` as other live views and
shows `Real LayerFS` or `Simulated LayerFS`. The placeholder version is removed;
no binary version is inferred from the desktop manifest. This is a backend-mode
label, separate from operation outcomes and Doctor completeness. Follow-up
evidence and verification are in `phase-2-follow-up-record.md`.

## Browser preview mode switch (2026-11-09)

The current renderer's sidebar footer offers Simulated / Real only in the web
preview. `desktop/vite.web.config.ts` starts independent per-mode hosts through
`desktop/tools/web-host.ts`; the bridge receives actual mode from the ready
envelope, along with its host connection. A same-origin POST with the page's
preview control token prepares the target host before full-page navigation.
Startup refusals stay in the original mode and show controlled configuration
errors without raw stderr. Neither host is restarted or stopped by switching.
Hosts close through stdin at preview shutdown; their state is retained.

Run with Node 24 and an explicit absolute `LAYERFS_CONNECT_CLI` (matching daemon
via `LAYERFS_CONNECT_DAEMON` or beside CLI), then `pnpm --dir desktop web`.
Default route is simulated; `?mode=real` addresses real mode directly.
`LFS_STATE` names the preview root, with independent `sim/` and `real/` children;
when unset a fresh private temporary root is used. The launcher never uses
`~/.layerfs-connect` or a CLI resolved from PATH. Native dialog controls remain
unavailable in the browser. This does not change Electron's launch settings.
