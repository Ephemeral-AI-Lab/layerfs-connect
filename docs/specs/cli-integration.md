# CLI integration inventory

Proposed 2026-11-09; revised the same day after a second, cross-checked review.
User direction: prefer the LayerFS CLI as Connect's integration boundary, integrate
existing UI consumers (including internal agent workflows) first, defer commands
without a current consumer, and refine the UI to match actual CLI behavior. This
supersedes the Node binding choice in `doctor/connect-integration.md`; its report
semantics and host-owned job design remain.

Companions: [UI refinements](cli-ui-changes.md),
[observations and statistics](connect-cli-obs-stat.md),
[Doctor integration](doctor/connect-integration.md).

## Authority and evidence

- LayerFS `origin/layerfs_v2_0_0` at **`ce0e00bef2c958686038544afbf7da4e23dce8af`**
  (fetched 2026-11-09). The first draft cited `19612fbc1d`; the two later commits
  touch only FUSE drain and cleanup tooling, so no CLI/SDK/control content changed.
- Read with `git show` only: CLI guide, SDK per-call pages, call table, CLI source
  (`api/crates/layerfs-cli/src/{run,parse,output,doctor}.rs`) and the control/engine
  code behind each call. Source wins over documentation.
- Current UI is `desktop/src/renderer/src/`. Today the host calls the `layerfs` Node
  package (`host/layerfs.js`), not the CLI. Everything below is a migration plan.
- Four read-only reviews (management; Files/History; Chat/Workspace/Doctor;
  field-level observations) plus a cross-challenge round. Conflicts were settled
  against source; see [Reconciled findings](#reconciled-findings).
- No CLI mutation was run. Runtime evidence is limited to help/version probes,
  read-only calls against fresh temporary homes, GETs against the simulated host,
  and headless browsing of the simulated web preview (see
  [Verification record](#verification-record)).

## Binary and capability prerequisites

The CLI Connect resolves today cannot run this plan:

| Binary | Build | `--version` | Observed capability |
| --- | --- | --- | --- |
| `../layerfs-v2-merge/target/debug/layerfs` (Connect's default via the linked package) | `d4304741`, 2026-11-04 | `layerfs 2.0.0` | No `branch commits/get-commit`, `file revision`, `--exec-id`, `exec-cancel`, Doctor targets |
| `../layerfs-sdk-verify-134/target/debug/layerfs` | `91a59406` | `layerfs 2.0.0` | Has saved-query calls, `--exec-id`, `exec-cancel`; Doctor still legacy-only |
| `~/.cargo/bin/layerfs` (on `PATH`) | pre-2.0 | none | Incompatible |

Rules: never resolve `layerfs` from `PATH`; select an explicit binary built from
at least the reviewed revision; gate each feature by a help probe, never by
`--version` (identical across these builds):

| Feature | Probe (exit 0 and text) |
| --- | --- |
| Mounted exec id | `workspace exec -h` lists `--exec-id` and `--progress` |
| Cancel | `workspace exec-cancel -h` lists `--grace-ms` (unknown call exits 2) |
| Doctor targets | `doctor host -h` prints `layerfs doctor host` (`doctor -h` alone is insufficient: `91a59406` exits 0 with legacy text) |
| Store integrity / backup write test | `doctor store integrity -h` lists `[--quick]`; `doctor backup connection -h` lists `[--write-test]` |
| Saved queries | `branch commits -h`, `file revision -h`, `file diff -h` lists `--allow-missing` |
| PostgreSQL | a `postgresql`-feature build; otherwise PostgreSQL calls refuse `Unsupported` |

## Shared CLI adapter contract

1. **Spawn.** Host only; argv arrays, no shell; stdin closed unless a content
   positional needs it; bounded concurrency; one adapter for all families.
2. **Home.** Always pass `LAYERFS_HOME`. Every table call opens or creates the home
   (`calls/dispatch.rs`), and an unset value falls back to `~/.layerfs`; check the
   home's `layerfs.json` exists before spawning reads. Keep the existing guard
   against handing a 1.1.0 home to 2.0. Legacy `doctor` does not create a home.
3. **Environment.** `env:` key/password references are resolved inside the CLI
   child on every Store/bucket call: pass those variables through (prefer Connect's
   owner-only `file:` references). Do not copy the minimal environment used by
   `import-env` (`host/layerfs.js`). Set `LAYERFS_PROGRESS_JSON=1` so a TTY never
   turns progress into an in-place status line.
4. **Output.** Default JSON only, never `--text`. Success: one JSON line on stdout,
   exit 0. Refusal: `{code,message,detail}` on stderr, exit 125. Usage: one
   `layerfs: …` line, exit 2 (an adapter bug, or Doctor option/target validation,
   or an older binary). A stdout write failure after the call is exit 125 with
   effects kept. A signal, missing/malformed line or non-JSON 125 is a transport
   outcome, never a refusal.
5. **Values.** Ints are i64 JSON numbers and may exceed 2^53: parse losslessly
   (Node 24 `JSON.parse` reviver `context.source`). Bytes print as a plain string
   when valid UTF-8, else `{"base64":…}`; use each result's own kind field.
   `--text` formats `created/modified/at` and some byte fields; never parse it.
6. **Progress.** `--progress` emits `{"progress":{…}}` lines on stderr for calls
   with `on_progress` only (`project init/export`, `store push/pull`,
   `backup create/restore`, `workspace exec`). Machine calls have none (`--progress`
   is exit 2). Phases repeat and totals may be null.
7. **Uncertainty.** No automatic replay after `Unknown`, lost output, a killed child
   or a host restart. Re-read entity state. User-initiated recovery is explicit and
   gated on a fresh read (move/push: [cli-ui-changes.md](cli-ui-changes.md)).
8. **Process cost.** Each call is a new process that opens and closes its Stores
   (`close_idle(0)`); paging caches do not survive between processes; `store status`
   and `workspace status` dial PostgreSQL each time; `machine list` probes each VM
   for up to 10 s. Coalesce reads per view, cache `machine platforms`, read
   `sandbox get` on demand with backoff after `Busy`, and never fan out per field.
9. **Jobs.** Persist host job records (kind, target, child pid, start) so a restart
   marks unfinished jobs Interrupted and reconciles them (push/pull: `store status`
   `op`; backup: `backup list`; restore: `store get`). Orphaned children can finish
   after the host exits.
10. **Killing a client.** Not proof that remote work stopped. Push/pull orchestration
    lives in the CLI process (a kill stops further phases; an in-flight worker step
    may finish; a kill during `install`/`record` leaves `unresolved`). A killed
    `workspace exec` leaves its command running until `exec-cancel`. A killed Doctor
    yields no report and may leave a write-test object or server query.

### Command execution

- **Use structured mode for Connect's mounted Bash:**
  `workspace exec <ws> <cmd> --exec-id <id> --progress` without `--stream`.
  The result JSON carries `kind` (`exit:<n>` or `cancelled`), `exit_code`, `stdout`,
  `stderr`, `exec_id`, `stop`, `message`, `truncated:false`. Exit 0 for any command
  exit; 125 only for a refusal.
- Output arrives after the command ends, all of stdout then all of stderr; neither
  mode is live. Each stream up to 1 MiB is inline. **Above 1 MiB, structured mode
  drops the bytes** and returns `stdout_bytes`/`stderr_bytes` with that stream null.
  Show "N bytes not retained" (U1 below would remove the loss).
- `--stream` is unsuitable for the host: no final JSON; exit = command exit (1 if out
  of range), so a command's 2/125 collides with usage/refusal; command stderr, the
  progress line and refusal JSON share stderr. The agent shim keeps using it but must
  stop reading exit 2/125 as a CLI error (`host/runs/cli-shim.mjs:44-50`).
- Mint a fresh id per launch matching `[A-Za-z0-9][A-Za-z0-9._-]{0,63}`; do not reuse
  Pi tool-call ids. Persist `{ws, exec_id}` before spawning.
- **Cancel race (confirmed in source).** `workspace/exec.rs` emits `{exec:{id}}`
  before `Running::start` writes the record; `exec/cancel.rs` answers `ended` when
  no record exists. A preassigned id widens the window to include process start.
  Connect rule: never launch a queued command whose Stop is pending; send the first
  cancel after the progress line arrives; if `ended` returns while the exec process
  is alive, re-send one at a time (250 ms, 500 ms, then 1 s, at most 30 s) until the
  exec exits, a cancel answers `cancelled`, a cancel answers `unknown` (offer manual
  retry only), `NotMounted`/`NoSuchSandbox`, or the ceiling. Each re-send is a new
  explicit call for the same standing intent and can only match this launch's id.
  Confirmed cancellation is not rollback: partial writes stay and the next Commit
  captures them.
- **Scope.** `exec-cancel` applies only to LayerFS-mounted execution, established by
  the execution path, never by a linked project. New project chats are folder-backed
  (`runs:'folder'`, `host/agents/index.js:541`); only legacy or copied chats mount
  (`host/agents/workspaces.js:20`). Folder Bash keeps its local process-group stop.
  Agent-launched `layerfs workspace exec` inside folder chats *is* mounted execution;
  canceling it requires the shim to inject and record exec ids (next slice).

## A. CLI integration list

`P` = `<store>/<project>`; `ID` = full 66-hex Commit/Layer id (file reads treat
anything shorter as a Branch name). Status: **Now** = integrate in the first
migration; **Preview next** = wire an existing sample-backed component; **Defer** =
no current consumer; **Unsupported** = no supported command.

### Machines

| Command | Consumer | Purpose | Flags / result fields | Status | Gaps |
| --- | --- | --- | --- | --- | --- |
| `machine list` | MachinesPage, MachineCard, Storage groups (`host/machines.js:118`) | Inventory | `machines[].{name,platform,backend,supports{sqlite,postgresql_sandbox,reason},state,cpus,memory,disk,stores,sandboxes,image,docker,wsl,daemon,error}`; not paged | Now | Probes each VM ≤10 s; `unknown` on timeout; `stores` = sqlite only |
| `machine platforms` | AddMachineDialog, MachineDetails | Create options, readiness | `platforms[].{platform,how,backend,kernel,sqlite,postgresql{store_calls,sandbox,reason},ready,missing,version,options,description}` | Now | Version probe per tool; cache per page open/Refresh (re-run every poll today) |
| `machine get <name>` | `recordNativeDaemon` (internal), settings | Recorded config | Same summary as a list item | Now | — |
| `machine status <name>` | Machine cards/details | Live state, free disk | `state,free_disk,tool_version,down_reason,stores,op{id,name,phase,started,uncertain}` | Now | Failed probe is a refusal (read-only); `free_disk` is null on native, the Docker volume's filesystem on docker, the guest data disk on VMs |
| `machine start <name>` / `machine stop <name>` | Power controls, Storage/Push Start | Manual power | Summary; stop `InUse` with `detail.related` | Now | No progress; start may wait ≤600 s; `Unknown` → `machine status` |
| `machine create <name> <platform> [--cpus N] [--memory S] [--disk S] [--image T]` | AddMachineDialog | Add VM | Summary; `Unknown` leaves uncertain `op`; failure may carry `detail.vm_exists` | Now | No `--progress`; long blocking call |
| `machine update <name> [--image] [--docker] [--wsl] [--daemon]` | MachineCard settings, `recordNativeDaemon` | Change config | Summary; cpus/memory refused `Unsupported` on VMs | Now | Cannot clear a value via `''` today (host `pick()`) |
| `machine remove <name>` | MachineCard remove | Remove/forget | `{name,removed,note?}` | Now | Replace nonexistent `machine.disconnect` (`host/machines.js:185`) |

### Stores, backups, projects

| Command | Consumer | Purpose | Flags / result fields | Status | Gaps |
| --- | --- | --- | --- | --- | --- |
| `store list` | StoragePage, Machines, project join | Inventory | `items[].{…record,state,op?,projects}`; not paged; no size | Now | Show `op` only when `state` ∈ {busy, unresolved}; stale dead-owner ops appear |
| `store get <name>` | pull/place, backup links | Record detail | `last_transfer{…,retired}`, `incoming_on?`, `backups{bucket:{file,heads,last}}`, `op?`, `projects`; no `state` | Now | — |
| `store status <name>` | StoreCard/Page size, PostgreSQL info, project banner | Observation | `state,holders,op,down_reason` + `file{exists,free,bytes,wal_bytes,incoming_bytes}` or `server{reachable,server_version,latency_ms,latency_us,schemas}` | Now | Host reads camelCase keys (always null); one PostgreSQL connection per call |
| `store create <name>` | NewStoreDialog | New SQLite Store on native | `{name,machine,profile,created,…}` | Now | — |
| `store connect <name> <url> --password env:X\|file:/p [--synchronous-commit …]` | NewStoreDialog (PostgreSQL) | Register server | `{name,kind,schema,synchronous_commit,projects}` | Now | Feature build; default `synchronous_commit` is `off` |
| `store push <name> <machine> --progress` | Push sheet, Machines "Move here" | Move native → machine | `{store,from,to,bytes,heads}`; phases `check,snapshot,send,verify,install,record,retire` | Now | Failure semantics by phase (below) |
| `store pull <name> --progress` | Pull, first half of Move | Move machine → native | Same shape | Now | Retire removes the worker folder |
| Move = `store pull` then `store push` (host workflow) | Move dialog, JobProgress | Machine → machine | Two operations in one Connect job | Now | Push `retire` failure: authority is on target (`detail.authority/source/retired`); `install`/`record`: outcome unknown, `unresolved`, both copies; only `check`…`verify` leave the Store on native |
| `store remove <name>` / `store disconnect <name>` | ConfirmByName, drop | Delete SQLite / forget PostgreSQL | `{removed}` / `{disconnected}` | Now | `Unknown` → `store status`, then explicit repeat |
| `backup connect <name> <url> [--key ref] [--region] [--part-size]` | New bucket sheet | Register bucket | `{name,provider,endpoint\|account,bucket,prefix,region,key,part_size}` | Now | Host saves only `{name,provider}`; no `backup get` exists, so store the answer |
| `backup list [<bucket>]` | BucketsDialog, restore pane | Backup states | `items[].{bucket,file,bytes,modified,heads,store,state,reason?}`; not paged | Now | Contacts buckets (≤64 stats, then `unknown`); non-native Stores always `unknown` |
| `backup disconnect <name>` | BucketsDialog | Forget bucket | `{disconnected,unlinked}` | Now | — |
| `backup create <store> <bucket> [<file>] --progress` | Back up / Sync backup | Snapshot to bucket | `{store,bucket,file,object,bytes,pieces,sha256,heads}`; phases `check,snapshot,[send],check,hash,upload` | Now | Writes no `op` (only a lock); `Unknown` → `backup list` (`bucket_changed`) |
| `backup restore <store> <bucket> [<file>] --progress` | Restore panels | Install on native | `{store,bucket,file,bytes,sha256,heads,projects}`; phases `check,download,verify,install` | Now | Never `Unknown`; post-install failure → `store get` before repeating |
| `project init P <abs-empty-folder> [--timeout ms] --progress` | NewProjectDialog (host temp folder) | Empty project | `{project,store,name,kind,machine,created,layer,root}`; phases `check,[send],install,record` | Now | Host parses 1.x progress; uncertain Init reports `Failed`; names lowercase |
| `project list [<store>] [--page-size N] [--page-pos N]` | Project catalog, selectors | Inventory | `items[].{project,store,name,kind,machine,created}`, `next_page_pos`; **no `has_more`, no total** | Now | Offset paging rebuilt per process; dedupe by `project` |
| `project get P` | Project state, agents | Record | `{project,store,name,kind,machine,created}` | Now | Holds no Branch/Layer/size |
| `project remove P` | `DELETE /api/projects/:id` only; no rendered trigger | Delete | `{stack,packs_kept,project}` | Defer UI | `Unsupported` on PostgreSQL |
| `project export P <dest> [--branch] --progress` | none | Export | — | Defer | — |

### Files and History

| Command | Consumer | Purpose | Flags / result fields | Status | Gaps |
| --- | --- | --- | --- | --- | --- |
| `branch list P [--page-size N] [--page-pos N]` | ProjectFiles picker, ProjectHistory | Branches + pins | `items[].{name,id,base,head,forked_from,saved_head{id,kind,branch,root}}`, `has_more`, `next_page_pos` | Now | No counts; live list |
| `branch get P <branch>` | Tick re-read, pin, after uncertain fork | One head | Same item | Now | — |
| `branch commits P <branch> --page 1 --page-size N [--at-commit ID]` | ProjectHistory (main **and** side), version selector | Commits / main Layers, newest first | `at_commit`, `items[].{id,ref,parent,second_parent,base,source_commit,source_branch,time,source_time,time_status,via,logical,message,message_truncated}`, `has_more`, `scan` | Now | No total/cursor; next page via `--at-commit <last.parent> --page 1`; Layer `time`/`message` null; `Capacity` at 10,000 visits |
| `branch get-commit P <branch> ID` | History inspector; CommitDetails | Full record | Commit or Layer record (`parent,source_branch,source_commit,overwrote_count,logical,via`) | Now / Preview next | `main` admits only Layers; source Commits read in their own Branch |
| `commit diff P <fromC> <toC> --paths-only --page-size N [--cursor PATH]` | History "Changed paths" (Commit pairs) | Scalable diff | `items`, `has_more`, `next_cursor` | Now | Refuses Layers |
| `branch diff P <ctxFrom> <ctxTo> --from-commit ID --to-commit ID --page N --page-size N [--paths-only] [--path-prefix /x] [--include-attribution]` | History for Layer / first-Commit endpoints; HistoryPreview | Pinned mixed-kind diff | `items[]`, `coverage{complete,reason}`, `has_more`, `scan` | Now (Layer endpoints) / Preview next | Hunks always omitted; walks whole tree; `Capacity` at 10,000 entries |
| `commit list P <branch>` | ProjectStorage (`new_*` deltas only) | Per-Save deltas | `items[commit_value]` | Keep, then retire | Refuses `main`; deltas not attributable |
| `commit get P <branch> <ID\|prefix>` | `host/projects.js:425` | — | — | Replace with `get-commit` | Cost grows with history |
| `file list P <branch> <dir> ID [--page-size 1000] [--page-pos N]` | FilesTab tree | Folder entries at pin | `at{id,kind,branch,root}`, `items[].{name,path,type,inode}`, `has_more`, `next_page_pos` | Now | No size/mode; drop eager per-entry `stat` |
| `file stat P <branch> <path> ID` | Opened file header | Facts | `type,inode,size,mode,at` | Now | Opened file only |
| `file read P <branch> <path> ID [--start-line N] [--end-line N]` | FileBody/CodeView | Text window | `text,start_line,end_line,line_truncated,truncated,next_line,size,at`; ≤2000 lines/48 KiB | Now | `Binary`, `NoSuchPath` are file states (exit 125) |
| `file revision P <branch> <path> [--at-commit ID] [--traversal provenance\|branch] --page N --page-size N` | FileExplorerPreview Revisions | Path history | `items[].{ref,kind,before,after,changes,message,recorded_at,time_status}`, `has_more`, `end_of_query`, `scan` | Preview next | No total; cold replay per process |
| `file blame P <branch> <path> ID [--from-line N] [--line-count ≤2000]` | FileBlame | Line owners | `lines[].{n,text,owner\|null,clipped,…}`, `coverage{status,…}`, `next_line` | Preview next | Owners nullable; partial coverage |
| `file diff P <lb> <lp> <rb> <rp> --left-commit ID --right-commit ID [--allow-missing] [--include-attribution] --page N --page-size N` | FileDiff, FileAttributionDiff | One file | `kind,hunks,hunks_omitted,change_kind,omission_reason,content_coverage,attribution_coverage,rows[],has_more` | Preview next | 1 MiB/side; 10,000 rows |
| `file glob` / `file grep` | none (SearchField stays local) | — | — | Defer | Grep is literal text |
| `file write/edit/rm/mkdir/mv/cp/apply` | none | — | — | Defer | — |
| `branch fork P <name> <from_branch> [ID]` | Chat lifecycle (`workspaces.js:76-86`), `projects.mount` | Chat Branch | `{kind:"Forked",branch,base,head}` | Now (internal) | `Unknown` → `branch get`, never re-fork |
| `branch merge …` / `branch publish P <b> [ID]` | Agents via shim only | — | — | Defer UI | — |

### Sandboxes, Workspaces, execution, Doctor

| Command | Consumer | Purpose | Flags / result fields | Status | Gaps |
| --- | --- | --- | --- | --- | --- |
| `sandbox create P <name> [<machine>] [--image sha256:…]` | Chat lifecycle, NewSandbox | Create | `name,machine,state,route,backend,platform,created` | Now | `Unknown` → `sandbox get` (name reuse gives `Exists`) |
| `sandbox list [P] [--page-size N] [--page-pos N]` | Project/Machine Sandbox lists | Records | `items[].{name,project,machine,state,op?,image,route,backend}`, `next_page_pos` | Now | Records only: never `lost`, `running` with machine down |
| `sandbox get <name> [--page-size N] [--page-pos N]` | Sandbox detail, chat re-open | Live state + Workspaces | `state`(incl. `lost`), `created`, `id`, `op?`, `down_reason?`, `workspaces[].{ws,name,directory,branch,base,base_layer,activity,head_moved_since_mount,dirty{inodes,entries},pending_merge}`, `next_page_pos` | Now | Host drops most fields; `down_reason` ⇒ `workspaces: []`; may wait for `Busy` |
| `sandbox close <name> [--force]` | Chat Stop/delete, CloseSandbox, Machines | End | `{closed,…}`; `Busy` (`detail.execs`), `MountsActive`, `Unknown` | Now | `--force` cancels commands (5 s grace) |
| `workspace mount <sandbox> <branch> [--name N]` | Chat lifecycle, mount form | Mount | `ws,path,workspace,base,base_layer,root,name`; `Capacity` at 16 | Now | `Unknown` → `sandbox get` |
| `workspace exec <ws> <cmd> --exec-id <id> --progress` | Mounted chat Bash (`workspaces.js:194-214`) | Run command | See [Command execution](#command-execution) | Now (gated) | >1 MiB output lost (U1) |
| `workspace exec <ws> <cmd> --stream` | Agent shim | Agent scripts | Raw bytes; command exit code | Unsupported for host | Shim exit-code misread |
| `workspace exec-cancel <ws> <exec-id> [--grace-ms N]` | ChatDock Stop (mounted); shim-recorded agent execs (next) | Cancel | `{outcome:cancelled,signal}`, `{outcome:ended}`, `{outcome:unknown}` | Now (gated) | Pre-registration race (U2) |
| `workspace commit <ws> -m <text> [--force]` | Chat save/checkpoint | Save | `Committed{head,commit,…}` or `UpToDate{…}`; `Conflict`, `Unknown`, `Failed(attempted)` | Now (internal) | Never automatic `--force` |
| `workspace status <ws>` | Checkpoint, after uncertainty | Binding + overlay counts | `base,base_layer,branch,branch_head,head_moved_since_mount,activity,overlay{inodes,entries,pending_merge}` | Now (internal) | No running-exec list, logs, scratch or metrics |
| `workspace unmount <ws> [--discard] [--force]` | Chat close; unused host route | Unmount | `Unmounted` / `ForceUnmounted{…}`; `Dirty`, `Busy` | Now (internal) | `--force` drops changes; explicit consent only |
| `doctor` | Storage NeedsAttention | Legacy home checks | `{ok,findings[{severity,entity,message,fix}]}`; exit 0 with findings | Now | No completeness; empty home answers `ok:true` |
| `doctor sandbox <sandbox> [--timeout D]` | Contextual "Diagnose" action on Sandbox detail opening the shared report panel (the Diagnostics tab was removed 2026-11-09; no tab returns) | Daemon diagnosis | `ok,complete,target{kind,name},operation,mode,checks[],findings[],truncated,counts,observed_at_ms,duration_ms` | Preview next | No progress/cancel; validation errors exit 2 |
| `doctor host` · `doctor machine <m>` · `doctor store integrity <s> [--quick]` · `doctor store connection <s>` · `doctor backup connection <b> [--write-test]` | none yet | Targeted diagnosis | As above | Defer | See [Doctor integration](doctor/connect-integration.md) |
| `help <family> [<call>]`, `<family> <call> -h`, `doctor <target> -h` | Adapter capability gate (internal) | Feature probes | Exit 0/2 + usage text | Now | No machine-readable form (U3) |
| `import-env` | Fresh-home daemon recording (internal) | 1.1.0 settings | — | Keep | — |

**Unsupported (no command; do not infer):** daemon logs, scratch listing/reading,
Sandbox/Machine CPU/memory usage, live exec output, a running-exec list, per-file
Workspace patches, Store composition totals (until U4), Machine-to-database
reachability, backup object deletion, bucket record read.

## Upstream CLI additions

Justification and shapes are in
[connect-cli-obs-stat.md § Upstream additions](connect-cli-obs-stat.md#upstream-additions).
Summary:

| # | Addition | Needed by | Priority |
| --- | --- | --- | --- |
| U1 | Framed exec mode: NDJSON events (progress, base64 output pages) then one final result or refusal on one channel, exit 0/2/125 | Mounted Bash parity with today's Node sinks for >1 MiB output | P1 for full parity; interim "N bytes not retained" |
| U2 | Cancel before registration: a cancel that finds no record leaves a mark `Running::start` honors (or emit the id after the record exists); fix `exec_cancel.md` | ChatDock Stop correctness | P1 |
| U3 | Machine-readable capabilities/build id (e.g. table JSON, commit in `--version`) | Adapter gate | P1 practical (help probes work meanwhile) |
| U4 | `store stats <name>` exposing existing StoreStatistics counters | StoreBreakdown, project DiskFlow ratios | Before connecting those previews |
| U5 | Scalable pinned comparison with Layer endpoints (`commit diff` accepting Layers, or pruned `branch diff`) | History changed paths for publications/first Commits on large trees | P2 |
| U6 | Stateless continuation for numbered queries (`file revision`, pinned `branch diff`) | Deep Revisions/comparison pages | P2, with the previews |
| U7 | Optional: `--progress` for machine create/start; `op` for backup create; running-exec list on `workspace status`; explicit daemon field on `sandbox get`; `backup get` | Nicer progress and reconciliation | Optional |
| U8 | `project stats P [<branch>] [<commit>]`: one pinned saved tree's entry counts (bytes already exist as Commit/Layer `logical`) | Project Storage tab statistics preview (planned, preserved) | Before connecting that preview |

Rejected from earlier proposals: `sandbox status`, observation-metadata/resource
sections, `project get` extensions, the `--branch/--at` option syntax for
`project stats` (positional order instead), a Layer read, `workspace_capacity`.
Deferred: `disk_total`, retained-history and per-project disk statistics.

## Delivery slices

1. **Adapter foundation (no UI change).** Binary selection, per-feature probes,
   spawn/home/env rules, lossless parsing, exit classification, coalescing. Migrate
   management *reads* (`machine list/platforms/status`, `store list/status`,
   `project list/get`, `backup list`). Fix in the same slice the adapter-level bugs
   it touches: snake_case PostgreSQL keys (host, sim and test), read errors becoming
   empty lists, dead store-size paths, `down_reason` dropped by `workspacesOf`.
2. **Management mutations and jobs.** Persisted jobs with
   succeeded/failed/interrupted/unknown outcomes, phase-driven progress, phase-aware
   Move results and gated recovery, Refusal classes, machine long-call states,
   chat-owned Sandbox close warning, NeedsAttention label.
3. **Sandbox detail from `sandbox get`.** Bind fields already returned to the
   retained Overview and Workspace Details (created, id, op, `down_reason`, base,
   head movement, dirty counts, pending merge, activity); CloseSandbox force gating;
   list-plus-on-demand polling. No new commands, and no removed tab returns.
4. **Mounted chat execution.** Structured exec, persisted exec ids, bounded cancel
   rule, BashStep outcomes, Commit refusal separated from command exit. Correct docs
   claiming verified cancellation. Next: shim-injected exec ids so Stop can cancel
   agent-launched Workspace commands in folder chats.
5. **Files/History reads.** Lightweight branches route, full-id pins, `branch commits`
   for main, `get-commit` inspector, Commit vs Layer comparisons, graph `source` edge,
   clipping notices. Update `host/sim/table.json` with the saved-query calls.
6. **Connect existing previews.** PageControls, Revisions, FileDiff, FileBlame,
   FileAttributionDiff, CommitDetails, HistoryPreview.
7. **Doctor report panel.** One shared report panel opened by contextual actions
   (Sandbox detail first, with `doctor sandbox`); see the Doctor document.
8. **Upstream-dependent.** StoreBreakdown and ratios (U4), Project statistics (U8),
   >1 MiB exec output (U1), deep pages (U5/U6), remaining Doctor targets.

Absent UI stays deferred: folder import, project export, standalone project delete,
file editing/mutations, full-project search, user Branch merge/publish, Global
Diagnostics workspace, live metrics/logs/scratch.

### UI baseline after the 2026-11-09 simplification

Already removed and not to be restored for command coverage: Sandbox Scratch,
Activity and Diagnostics tabs and their Overview shortcuts; Workspace mutable Files
and sample patch views; empty linked-user panels; Sandbox card resource blocks and
sparklines (labelled current-value samples remain behind `?metrics=sample` in
development); unavailable backup providers. Preserved: StoreBreakdown and Project
statistics previews (U4, U8), Workspace base/head/activity/dirty fields (their
bindings are a slice-3 bug fix), and Files/History capabilities with CLI support.
The Workspace inspector's Commands view shows Connect-owned execution records only.

## Proposed folder structure changes

Proposal only; nothing below exists yet unless it is an existing path being changed.
Paths were checked against LayerFS `ce0e00bef2` and Connect's current tree.
**new** marks files to create.

### LayerFS (`layerfs_v2_0_0`): upstream additions only

LayerFS's convention: one file per call under its family folder in `layerfs-api`
(D15), the work in a `control/` crate, Store reads in `engine/`, plus an SDK page and
CLI tests.

```text
api/crates/layerfs-cli/
  build.rs                         new  U3: embed git commit/build id for --version
  src/run.rs                       U1 framed exec mode; U3 capability dump
  src/parse.rs                     U1 new switch (e.g. --events) beside --progress/--stream
  src/help.rs                      U3 machine-readable help/table output
  tests/stream_framed.rs           new  U1: events then exactly one result/refusal, exit 0/2/125
  tests/exec_cancel.rs             U2: add cancel-before-registration case
  tests/capabilities.rs            new  U3

api/crates/layerfs-api/src/
  store/stats.rs                   new  U4 call entry (CALL + run)
  store/mod.rs                     register stats
  project/stats.rs                 new  U8 call entry: project [<branch>] [<commit>]
  project/mod.rs                   register stats

control/crates/layerfs-sandbox/src/
  workspace/exec.rs                U2: announce exec id after Running::start, or honour a pending cancel
  exec/cancel.rs, exec/record.rs   U2: pending-cancel mark when no record exists yet

control/crates/layerfs-store/src/
  stats.rs                         new  U4: route like status.rs (native in-process, worker, PostgreSQL)
  calls/project.rs                 new  U8: forward to the Store method, like calls/file.rs

engine/crates/layerfs-store-service/src/
  methods/store.rs                 new  U4: public method over existing StoreStatistics counters
                                         (today reachable only via operator/store.rs)
  methods/project.rs, methods/dispatch.rs   U8: dispatch project.stats
  read/tree_stats.rs               new  U8: budgeted walk of one pinned root (reuses walk.rs, snapshot.rs)
  read/branch_compare.rs, read/walk.rs      U5 later: skip unchanged subtrees / Layer endpoints
  read/revision_pages.rs           U6 later: stateless continuation token

docs/architecture/api/
  sdk/store/stats.md               new
  sdk/project/stats.md             new
  sdk/store/README.md, sdk/project/README.md   list the new calls
  sdk/workspace/exec.md, sdk/workspace/exec_cancel.md   U1/U2 contract (fix the "never ended" claim)
  front-ends/cli.md                U1 framed mode, U3 capabilities
  call-table/table.md, coverage.md, events.md  64 → 66 calls; exec event framing
```

Node and Python bindings are generated from the call table, so their call lists pick
up the new calls automatically; regenerate any checked-in type files. Persistence is
unchanged: the counters already exist (`engine/crates/layerfs-persistence/src/history/facts.rs`).

### Connect (`layerfs-connect`): CLI adapter replaces the Node package

```text
host/
  cli/                             new  the only place that spawns layerfs
    binary.js                      resolve explicit binary (LAYERFS_CONNECT_CLI / bundled), never PATH
    capabilities.js                per-feature -h probes (later U3), cached per binary
    spawn.js                       argv, LAYERFS_HOME check, env passthrough, LAYERFS_PROGRESS_JSON=1,
                                   stdin closed, concurrency bound, child registry
    json.js                        lossless parse (big ints, {"base64":…})
    outcome.js                     exit 0 result / 125 refusal / 2 usage / transport-unknown
    progress.js                    incremental stderr {"progress":…} line parser
    calls.js                       typed wrappers per family (machine, store, backup, project,
                                   branch, commit, file, sandbox, workspace)
  layerfs.js                       thin facade over cli/ (keeps call sites stable), then shrinks;
                                   no more client()/close() from the package
  jobs/                            new  extracted from storage.js
    store.js                       persisted job records (kind, target, child pid, start)
    reconcile.js                   restart → Interrupted, then store status / backup list / store get
    move.js                        pull-then-push with phase-aware outcome
  doctor/                          new
    manager.js                     explicit runs, one integrity audit per Store, no replay
    report.js                      explicit + legacy report normalisation
  storage.js                       Store/bucket logic stays; jobs and doctor move out;
                                   snake_case PostgreSQL keys; save the backup connect answer
  machines.js                      per-sub-read {error, at}; machine remove; cached platforms
  projects.js                      Sandbox bindings (base/head/dirty/op/created/down_reason);
                                   optionally split reads into files.js and history.js (new)
                                   for pinned file reads and branch commits / get-commit
  agents/workspaces.js             structured exec with --exec-id; commit refusal kept separate
  agents/exec-cancel.js            new  bounded cancel rule, persisted {ws, exec_id}
  runs/cli-shim.mjs                inject/record --exec-id; stop misreading exit 2/125
  server.js                        doctor routes; job outcome fields; drop the dead bucket-keys route
  sim/
    bin/layerfs.mjs                new  fake CLI with the same stdout/stderr/exit contract,
                                         so the web preview exercises the real adapter
    index.js, world.js             backend for the fake CLI; snake_case keys
    table.json                     add branch.commits, get_commit, file.revision, at, saved_head
  test/
    cli-adapter.test.js            new  exit classes, malformed output, big ints, home-creation guard
    cli-progress.test.js           new  repeated phases, null totals
    jobs-reconcile.test.js         new  kill during send/install, restart
    move-phases.test.js            new  7 phases × Failed/Unknown
    exec-cancel.test.js            new  race, unknown, double Stop, queued Stop
    doctor-report.test.js          new  exit 0 with failures, incomplete, exit 2
    fixtures/cli/*.jsonl           new  recorded stdout/stderr/exit fixtures
  README.md                        transport section rewritten for the CLI

desktop/src/main/
  layerfs-host.ts                  pass binary path and env to the host; no addon loading

desktop/src/renderer/src/
  layerfs/host-api.ts              outcome + transport classes, Workspace fields, pinned `at`
  layerfs/job-progress.ts          phases-as-seen steps
  layerfs/storage-jobs.ts          consume outcome
  layerfs/doctor-api.ts            new  client/hooks for Doctor runs
  components/layerfs/Refusal.tsx   refusal / usage / unavailable / lost output
  components/doctor/               new
    DoctorPanel.tsx                shared report panel opened by contextual actions
    DoctorReport.tsx               findings vs completeness, checks list
  components/sandbox/*             bind preserved fields; header Diagnose action later
  components/files/*, components/history/*   pinning, branch commits, source edge, paging
  pages/storage/*, pages/machines/*          labels, stale banners, job states (no new pages)

package.json                       drop "layerfs": "link:../layerfs-v2-merge/api/node" last
tools/sim-table.mjs                regenerate from the CLI's table (U3) instead of the package
docs/specs/*, docs/ui/*            update with each slice
```

### Dependencies and order

- **Removing the Node package link is last.** `host/runs/cli-shim.mjs`,
  `host/runs/scope-client.js` and `host/parse/` still read the package's call table.
  They switch once the CLI can print its table (U3); until then keep the link for the
  table only.
- **Binary source.** Development uses an explicit path to a build at or after the
  reviewed revision. Packaging ships a pinned `layerfs` binary as an app resource
  (see `desktop/PACKAGING.md`), not whatever the linked checkout built.
- **Order:**
  1. `host/cli/`, the facade and the fake simulator CLI, with tests.
  2. `host/jobs/` and the Storage/Machine changes.
  3. Sandbox bindings.
  4. Exec and cancel.
  5. Files/History reads.
  6. `host/doctor/` and the shared report panel.
  7. Wire U4/U8 into StoreBreakdown and the Project statistics preview once
     LayerFS ships them.

## Reconciled findings

| Topic | Initial claim | Resolution |
| --- | --- | --- |
| Main history | Adapt `commit list` | `commit list` refuses `main`; use `branch commits` (rows are Layers) |
| Layer record | "No call returns a Layer record" (field review) | Withdrawn: `branch get-commit P main <LayerID>` and `branch commits` carry Layer `logical`, `source_*`, `via` |
| Sandbox status | New command proposed | Rejected: `sandbox get` already derives `lost`, dials the daemon, reports `down_reason`; detailed checks are `doctor sandbox` |
| "16 slots" | Possibly invented | Real constant (`layerfs-sandbox/src/lifecycle.rs:37`, enforced at mount); keep as a cited Connect constant |
| Store totals | Need a scan | Counters exist (O(1) read) but only via internal `backend.*`; need a table call (U4) before connecting StoreBreakdown |
| Uncertain push retry | "Push again" | A repeat push first resolves (deletes only the copy the record does not name) then restarts; offer only as explicit "Resolve" after a fresh `unresolved` read |
| Cancel race | Docs: cancel never answers `ended` for a command that then runs | False before the record exists; bounded re-send rule plus U2 |
| Stop teardown | — | Stop always releases a mounted chat's Workspace and closes its Sandbox (`index.js:1238`); Continue re-creates them. Owner should confirm this is intended |

### Corrections to `docs/layerfs-2.0-integration.md` (not edited here; it carries other dirty work)

- §3/§4 "A crash before `record` leaves the Store on the source": the intent is
  marked uncertain before `install`; push `retire` failures leave authority on the
  target. "If the push half fails, the Store stays on native" is wrong for
  `install`/`record`/`retire`.
- §3 VM kinds: 2.0 platforms are native, docker, apple-container, lima (no
  microsandbox). CLI source is `api/crates/layerfs-cli`.
- §4 "A call cannot be cancelled" and §8 step 8 "hide Stop": `exec_id`/`exec_cancel`
  now exist for mounted commands; live output and a running list do not.
- §9 Q2 partly answered; Q3 answered by `branch commits main` and pinned
  `branch diff`; Q5 partly answered (`sandbox get` derives `lost`); Q17 open.

## Verification record

**Source-reviewed** at `ce0e00bef2`: every command, flag, result field, phase and
failure semantic above.

**Runtime (help/read-only, temporary homes, all deleted):**
- `d4304741` build: `--version`, family help, `machine create --progress` (exit 2),
  `store list`/`project list`/`machine list`/`backup list`/`doctor` on a fresh home
  (`project list` → `{"items":[],"next_page_pos":null}`; `doctor` →
  `{"ok":true,"findings":[]}` exit 0), `store status nope` (exit 125 refusal JSON),
  `store list extra` (exit 2), `doctor host` (exit 2), `workspace exec-cancel -h`
  (exit 2). Observed that table reads create the home.
- `91a59406` build: help for `workspace exec` (has `--exec-id`, `--progress`),
  `workspace exec-cancel` (exit 0), `doctor -h` (legacy text only), `doctor host -h`
  (exit 2); `branch commits`/`file read` against a missing Store (exit 125).
- Simulated host GETs: `/api/doctor` → `{"ok":true,"findings":[]}`;
  `/api/projects/shop%2Fapi/history?pos=0`; `/api/sandboxes/api-dev` (no `created`,
  `base`, `dirty`); `/api/projects/shop%2Fapi` (one Layer with `at:null`).
- Web preview (headless Chrome, 1280×820), read-only navigation: Machines list and
  native detail, Sandbox detail tabs (Overview, Diagnostics, Scratch, Activity),
  Storage list and `shop`, project Files (fixture preview, then "Browse host files",
  opened `src`), project History (fixture preview, then "Browse host history"),
  Example chat Chat and Sandboxes tabs. Only console error: missing `favicon.ico`.
  That walk predates the Sandbox simplification. Rechecked afterwards: `api-dev`
  shows only Overview and Workspaces; the `feature-login` inspector Details shows
  Base commit and Branch head "Not reported" and Changes "Not recorded" although
  `sandbox get` returns them (binding gap, `host/projects.js` `sandboxInfo`).

**Not verified at runtime:** any exec/cancel/mount/commit, progress framing of real
transfers, kill-mid-transfer behavior, PostgreSQL and bucket calls, targeted Doctor,
`branch commits`/`get-commit` results on real data, desktop/Electron behavior.
