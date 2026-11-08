# Connect CLI observations and statistics

Status: proposed 2026-11-09; revised the same day after a field-level review of
Connect's Machine, Sandbox, Store and Project views against LayerFS
`origin/layerfs_v2_0_0` at `ce0e00bef2c958686038544afbf7da4e23dce8af` (the first draft
cited `19612fbc1d`; the two later commits touch only FUSE drain and cleanup tooling).
New commands, options and fields below are proposals, not current CLI support.

Related: [CLI integration inventory](cli-integration.md),
[UI refinements](cli-ui-changes.md), [Doctor integration](doctor/connect-integration.md).
Current Connect UI lives under `desktop/src/renderer/src/`; paths below are relative
to it unless they start with `host/`.

## Contract boundaries

| Kind | Purpose | Execution policy |
| --- | --- | --- |
| Information | Configuration, identity and recorded relationships | Existing get/list readers; paginate large collections |
| Observation | Current runtime, operational or connection state | Bounded probes the caller timestamps; preserve unavailable results |
| Statistics | Defined measurements of content or allocation | Name scope and definition; cache immutable measurements by root |
| Diagnosis | Explain faults, integrity and unverified checks | Doctor only; explicit runs with scope, mode and completeness |

Reading never starts a Machine or Sandbox. Doctor does not replace detail reads,
statistics, logs or metrics. A connection observation does not prove integrity.

### Quantities that must stay distinct

| Quantity | LayerFS source | Not the same as |
| --- | --- | --- |
| Configured allocation | `machine list/get .cpus/.memory/.disk` (recorded) | Usage; free space |
| Guest free space | `machine status .free_disk` (`df` of `/layerfs/data` in the guest; Docker volume filesystem; null on native) | `disk − free_disk` (raw disk vs formatted filesystem) |
| Recorded Sandbox state | `sandbox list .state` (records only; never `lost`) | Live state |
| Live Sandbox state | `sandbox get .state` (machine asked; `lost`), `down_reason` | Daemon health (Doctor) |
| Saved-tree logical bytes | Commit/Layer `logical`: whole snapshot's regular-file bytes counting every namespace link (`core/crates/layerfs-history/src/contract/records.rs`) | A per-Commit delta; disk usage |
| Per-Save deltas | Commit `new_canonical/new_stored/new_metadata` (first insert wins) | Project size; attributable usage |
| Store file length | `store status .file.bytes/.wal_bytes` | Allocated blocks; StoreStatistics `file` (database pages incl. WAL pages) |
| PostgreSQL schema size | `store status .server.schemas.layerfs` | Server/database disk use |
| Store-wide totals | StoreStatistics counters (internal only today) | Per-project values |

## Field-level UI-to-CLI coverage

Classes: **1** direct CLI field · **2** safely derived · **3** Connect-owned ·
**4** missing upstream capability · **5** simulation-only. Real mode today = what the
host renders against real LayerFS (it currently uses the Node package; the same result
shapes apply to the CLI).

### Machines

| Field (UI label) | Component | Class | Source or derivation | Real-mode risk | Action |
| --- | --- | --- | --- | --- | --- |
| Platform · runtime | `pages/machines/MachineCard.tsx:158,169`, `MachineDetails.tsx:70-75` | 1 | `machine list .platform/.backend` | Maps `docker`→"Containers"; source reports `namespaces` | Refine mapping |
| CPU / Memory / Disk capacity | `MachineCard.tsx:176-180`, `MachinePage.tsx:106-108`, `MachineDetails.tsx:97-99` | 1 | `.cpus/.memory/.disk` (configured; null on built-ins) | — | Keep; label "Allocated" |
| Sandboxes | `MachineCard.tsx:183` | 1 | `machine list .sandboxes` length | — | Keep |
| Workspaces | `MachineCard.tsx:151-152,184`, `MachinePage.tsx:72,144` | 2 | Sum over fully paged `sandbox get .workspaces` | **0 instead of unknown** when `down_reason` (`host/layerfs.js:86-90`) | Refine: unknown on `down_reason`/failed read |
| Local Stores, chips, size tooltip | `MachineCard.tsx:185-193`, `MachineDetails.tsx:137` | 1 / dead | `machine list .stores`; size reads `s.size ?? s.bytes`, never returned (`host/machines.js:78`) | Size never renders | Keep chips; drop or source size from `store status` |
| "X free of Y", used bar | `MachineCard.tsx:154,203-206`, `MachinePage.tsx:77,110-113`, `MachineDetails.tsx:54-55,100-109` | 1 + 2 | `free_disk`; used ≈ `disk − free_disk` | Overstates used (different measurements) | Refine: "X free (guest) · Y allocated"; drop bar |
| State / down reason / error / op | `MachineCard.tsx:196-209`, `MachineDetails.tsx:76-93` | 1 | `list .state/.error/.op`; `status .state/.down_reason` | Native: `ready` (list) vs `running` (status) | Keep |
| Tool version | `MachineDetails.tsx:80` | 1 | `status .tool_version` or `platforms[].version` | — | Keep |
| LayerFS version | `MachineDetails.tsx:81` | 3 | Connect's package/binary record | Not a capability proof | Keep; show build id when U3 exists |
| Readiness, origin, kernel, SQLite/PostgreSQL call location | `MachineDetails.tsx:79,82-90,114,143,151` | 1 | `machine platforms` rows | — | Keep |
| Image, Docker socket, WSL | `MachineDetails.tsx:115,154-158`, `MachineCard.tsx:248-263` | 1 | `machine get` | — | Keep |
| "Here now N of M running" | `MachineDetails.tsx:116-120` | 2 | `sandbox list .state` | **Liveness from records** | Refine: "recorded" |
| Routes / images in use | `MachineDetails.tsx:121-122` | 2 | Union of `sandbox list .route/.image` | — | Keep |
| "PostgreSQL Sandboxes: Yes · reach N PostgreSQL Stores" | `MachineDetails.tsx:144-150` | 1 + invented | `.supports.postgresql_sandbox` + registered count | **"reach" unmeasured** | Refine: "Can run Sandboxes on PostgreSQL Stores (N registered)" |
| "Stores N" | `pages/machines/MachineData.tsx:38-40`, `MachinePage.tsx:73,157` | 2 | sqlite Stores + all PostgreSQL Stores when flag true | **Inflated by a capability flag** | Refine: "N on this machine · M PostgreSQL usable" |
| Sandbox tile name/project/image/kernel/state | `MachineSandboxes.tsx:47-69,93-97` | 1 | `sandbox list` | State is recorded | Keep; caveat |
| Tile CPU / Memory / Disk current values | `MachineSandboxes.tsx`, `SandboxResources.tsx` | 5 (DEV `?metrics=sample`, labelled design preview) / 4 | None | Real: block omitted (sparklines and empty blocks removed 2026-11-09) | Keep explicitly simulated |
| "Workspaces N / 16" | `MachineSandboxes.tsx:18,78` | 2 + constant | Count as above; 16 = `WORKSPACES` (`control/crates/layerfs-sandbox/src/lifecycle.rs:37`), enforced at mount (`Capacity`) | Constant may drift | Keep as cited Connect constant |

### Sandbox detail (real mode renders `HostSandboxDetail`; sim renders the preview)

| Field | Component | Class | Source | Real-mode risk | Action |
| --- | --- | --- | --- | --- | --- |
| State badge | `components/sandbox/use-sandbox-detail.tsx:22` | 1 | `sandbox get .state` (incl. `lost`) | — | Keep |
| "This sandbox is closed…" | `use-sandbox-detail.tsx:19`, `SandboxOverview.tsx:11` | 1 (misread) | `.state=='gone'` means no recorded id, not a confirmed close | Misleading | Refine wording |
| Project, parent machine | `SandboxDetail.tsx:25-26`, `layerfs/sandbox-snapshot.ts:7-11` | 1 | `.project/.machine` + `machine list` | — | Keep |
| Backend / Image / Filesystem route | Overview Sandbox information | 1 | `.backend/.image/.route` | — | Keep |
| Runtime ID → Sandbox ID | Overview ("Runtime ID: Not reported") | 1 (`id`) / 4 (`runtime_id` hidden) | `sandbox get .id` | Shows "Not reported" | Refine: show `.id` as "Sandbox ID" |
| Created | Overview (absent) | **1** | `sandbox get .created` (epoch ms) | Dropped by `host/projects.js:97-115` | Add |
| Pending operation | Header (absent) | **1** | `sandbox get .op{name,phase,uncertain}` | Dropped by `layerfs/sandbox-snapshot.ts` | Add to header |
| Mounted Workspaces / empty text | Overview region 11, `SandboxWorkspaces.tsx` | 2 | `.workspaces` (mounted, directory) | Unreached daemon must not read as zero | Refine: carry `down_reason` as the unavailable reason |
| "N mounted / 16 slots" | `SandboxWorkspaces.tsx`, `SandboxMap.tsx` | constant | As above | — | Keep as cited constant |
| Workspace state, handle, mount path, Sandbox, route | Inspector Details | 1 | `.workspaces[].activity/.ws/.directory`, `.route` | — | Keep |
| Base commit / Branch head | Inspector Details | **1** | `.workspaces[].base/.base_layer/.head_moved_since_mount`; `workspace status .branch_head` on open | "Not reported" (rechecked in preview) | Bind (preserved field) |
| Changes | Inspector Details | 1 (counts) | `.dirty{inodes,entries}`, `.pending_merge` | "Not recorded" (rechecked) | Bind as a count summary, never patches |
| Commands | Inspector, only with recorded executions | 3 | Connect execution records (chat/agent traces) | Sample records labelled | Keep Connect-owned |
| Linked users | Inspector, hidden when empty | 3 | Connect chat bindings | — | Keep |
| Observed ‹time› | `HostSandboxDetail.tsx` | 3 | Caller's own timestamp | — | Keep |
| Daemon diagnosis | Contextual action → shared report panel (when Doctor integrates) | Doctor | `doctor sandbox <name>` (explicit run) | No action shown today | Add with the Doctor slice; no tab |
| Removed 2026-11-09 | Scratch, Activity, Diagnostics tabs; Uptime, daemon-log and resource placeholders; Workspace Files/patch views | 4 / 5 | No CLI source (scratch, logs, metrics, overlay files) | — | Stay removed; do not restore for coverage |
| Sim playback values | Overview, Workspaces | 5 | Fixtures | Sim only | Keep explicitly simulated |

### Stores

| Field | Component | Class | Source | Real-mode risk | Action |
| --- | --- | --- | --- | --- | --- |
| Name, type, location, state, op, created, projects | `pages/storage/StoreCard.tsx:166-191`, `StorePage.tsx:51-54,103-104`, `StoreSection.tsx:56-64,115` | 1 | `store list` (+ host `pgTarget`) | Stale `op` shown | Keep; filter `op` by state |
| Size / Database file / WAL | `StoreCard.tsx:169`, `StoreSection.tsx:65`, `StorePage.tsx:54,105` | 1 / 2 | `store status .file.bytes/.wal_bytes`; total = sum | File length, not blocks | Keep; label "file + WAL" |
| "1.7 MB in 8 sqlite Stores" | `StoragePage.tsx:344` | 2 | Sum of known sizes | Unknown sizes silently omitted | Refine: "≥" or "N unknown" |
| PostgreSQL connected / not reachable | `StoreCard.tsx:276-292` | 1 | `.server.reachable/.error/.unavailable` | One connection per read | Keep; refresh less often, show time |
| PostgreSQL version, latency | `StoreCard.tsx:282`, `host/storage.js:99-100` | **1** | `.server.server_version/.latency_ms` | **Always null** (camelCase read) | Fix keys |
| PostgreSQL schema size | not shown | 1 | `.server.schemas.layerfs` | — | Optional; label "LayerFS schema relations" |
| "Unknown · usable from every machine" | `StoreCard.tsx:295` | invented | No such guarantee | Misleading | Refine |
| "Shared across machines" | `StorePage.tsx:52`, `StoreSection.tsx:68` | 2 | From `kind` | Design claim | Refine: "Usable by machines that run PostgreSQL Sandboxes" |
| "Used by build docker native" | `StoragePage.tsx:378`, `StorePage.tsx:43,78-82`, `StoreSection.tsx:69-70` | 2 | Machines of non-`gone` Sandboxes of the Store's projects (`sandbox list`) | Includes `lost`/`creating` | Keep; exclude `lost`; tooltip already says not live connections |
| Backups link, last saved, bytes | `StorePage.tsx:83-97`, `StoreSection.tsx:170-216` | 1 | `store get .backups`, `backup list` | — | Keep |
| Bucket provider registry | `host/storage.js:186-188` | 3 | Connect buckets file | Holds only `{name,provider}` | Store the `backup connect` answer |
| Recent operations | `StorePage.tsx:99-101` | 3 | Connect jobs (backup writes no `op`) | Lost on restart | Persist jobs |
| Storage breakdown | `pages/storage/StoreBreakdown.tsx:8-46` | 5 (DEV+sim) / 4 | Counters internal only | Real: "Not available yet" | Keep simulated until U4 |
| "Doctor: nothing found" ✓ | `pages/storage/NeedsAttention.tsx:26,40` | 1 (misread) | Legacy `doctor .findings` | **Implies healthy** | "Home checks: no findings · ‹time›", neutral icon |

### Project (tile and Storage tab; there is no separate overview page)

| Field | Component | Class | Source | Real-mode risk | Action |
| --- | --- | --- | --- | --- | --- |
| "1.4 KB in saved history" | `pages/storage/StoreSection.tsx:153-155` | 2 (wrong scope) | Sum of `commit list .new_stored`, ≤1000 own Commits per Branch (`host/projects.js:472-483,595-616`) | **Excludes Init and main Layers; shared objects counted once wherever first inserted** | Remove, or "added by N recent Commits" |
| Branch count | `StoreSection.tsx:157-160` | 2 | Fully paged `branch list` | — | Keep |
| Sandbox / Workspace counts | `layerfs/project-rows.ts:50-53` | 2 | Records; `sandbox get` sum | 0 instead of unknown | Refine |
| Created, Store, Machine | `pages/storage/ProjectStorage.tsx:225-233` | 1 | `project get .created/.store/.machine` | `created` may be null | Keep |
| Hero "On disk X for Y of history · N× smaller", ring | `ProjectStorage.tsx:85-125` | 2 (mixed scopes) | Store file+WAL vs Σ`logical` of partial Commits | Ratio meaningless | Keep the preview; in real mode hide ratio/ring until U4/U8 give matching scopes |
| "N Commits · N Branches · 1 Layer" | `ProjectStorage.tsx:116` | 2 | Layers from `[main.base]` only (`host/projects.js:327`) | **"1 Layer" wrong** | Count via `branch commits P main` (bounded) or say "main head Layer" |
| DiskFlow dedupe/compression | `components/layerfs/StoreVisuals.tsx:136-146` | 2 (wrong) | Σ`logical` / Σ`new_canonical` | Inflated | Keep the preview; real mode hides ratios until U4, then shows only Store-wide, defined ones |
| "SQLite pages" pill | `ProjectStorage.tsx:143` | 2 (mislabel) | `.file.bytes` (file length) | Mislabelled | Rename "Store file" |
| "main, latest, raw" pill | `ProjectStorage.tsx:137-144` | **1** | `branch get P main .saved_head.id` → `branch get-commit P main <id> .logical` | Hard-coded null today | Refine (no upstream needed) |
| "free", "from Init" pills | `ProjectStorage.tsx:137-144` | 4 | StoreStatistics `free`, `init` (internal) | Never render | Keep in the preview; hidden in real mode until U4 |
| Growth chart, per-Commit bars | `ProjectStorage.tsx:150-175` | 1 per item | `commit list .time/.message/.via/.logical/.new_stored` | Labels OK ("cumulative snapshot") | Keep |

## Review of the earlier proposed extensions

| Earlier proposal | Verdict | Reason (source) |
| --- | --- | --- |
| Observation metadata (`observed_at_ms`) and nested `resources` on status commands | **Reject** | Calls are synchronous; the caller timestamps them. No supported CPU/memory source exists. `machine status` already returns `state,free_disk,tool_version,down_reason,stores,op` (`control/crates/layerfs-machine/src/status.rs`). Names also break table conventions (times are bare epoch-ms names; `*_bytes` names fall outside `--text` size fields) |
| `machine status` disk total | **Defer** | Only the used bar needs it; relabel instead ("X free (guest) · Y allocated") |
| `sandbox status <name>` | **Reject** | `sandbox get` already asks the machine (`lost`), dials the daemon, returns `down_reason`; `doctor sandbox` covers connection/handshake/readiness/runtime presence (`control/crates/layerfs-control/src/doctor/sandbox_channel.rs`, `sandbox_runtime.rs`). An explicit `daemon: answered\|not_reached\|not_asked` field on `get` is an optional, low-priority request (it would disambiguate worker vs daemon) |
| `store status` metadata extensions | **Reject** | Everything listed already exists: `file{exists,free,bytes,wal_bytes,incoming_bytes}`, `server{reachable,server_version,latency_ms,latency_us,schemas}` |
| `store stats <name>` | **Keep, simplified (U4)** | Counters already maintained on every publish and read O(1) (`engine/crates/layerfs-persistence/src/history/facts.rs`, `statistics_totals.sql`), but exposed only through internal `backend.store.project.get_storage`. Not a scan |
| `project get` extensions (main head, created, counts) | **Reject** | `created` is already returned; main head is `branch get P main .saved_head`; counts belong to paginated readers |
| `project stats <project> [--branch] [--at]` | **Keep as planned (U8), corrected** | Consumer: the preserved Project Storage tab statistics preview. Bytes already exist as Commit/Layer `logical`, so only entry counts are new; `--branch/--at` breaks D7 (optional Commit is the last positional); pinned identity must use typed `at` |
| Layer record read (field review B5) | **Withdrawn** | `branch get-commit P main <LayerID>` and `branch commits` already return Layer `logical` (`engine/crates/layerfs-store-service/src/history/saved.rs`) |
| `workspace_capacity` field | **Reject** | Fixed constant with a refusal naming it; keep a cited Connect constant |

## Upstream additions

Only additions with an existing consumer are listed as needed.

| # | Addition | Consumer | Why existing calls are insufficient | Minimal shape (table conventions) | Priority |
| --- | --- | --- | --- | --- | --- |
| U4 | `store stats <name>` | StoreBreakdown; project DiskFlow ratios; "free"/"from Init" pills | Counters exist only via internal `backend.*`; `store status` does not open the Store | `{name, kind, history_logical, canonical, stored, metadata, file, free \| null, init \| null}` (all Int). `history_logical` documented as the sum over Commit **and** Layer records (a publish counts its tree again), so not a dedupe numerator. `file` = database pages incl. WAL (SQLite) or schema relation size rounded to 8 KiB pages (PostgreSQL, `free` null). Store-wide, never per project. Availability: native SQLite in-process; other machines via the worker (`Unavailable` when down, nothing started); refused while a push/pull holds the Store | Before connecting those previews |
| U1 | Framed exec output | Mounted chat Bash | Structured mode drops >1 MiB output; `--stream` has no final result | See cli-integration.md | P1 for parity |
| U2 | Cancel before registration | ChatDock Stop | `ended` returned before the record exists | See cli-integration.md | P1 |
| U3 | Capabilities/build id | Adapter, Machine details "LayerFS version" | `--version` identical across builds | Table JSON or commit in `--version` | P1 practical |
| U8 | `project stats <store>/<project> [<branch>] [<commit>]` (planned) | Project Storage tab statistics preview | Entry counts need a recursive `file list` (O(entries) processes, no sizes on items); bytes alone are already `branch get-commit .logical` | `{project, at{id,kind,branch,root}, files, directories, symlinks, others, logical, complete, reason?}`. Defaults: `main` and its saved head; a given `<commit>` must be a full id admitted by that Branch context. Resolve the pin once and return it. Root directory not counted; counts are namespace entries (a hard link counts per path, matching `logical`); symlinks never followed. Bounded by the read budget: `complete:false` with `reason` instead of a silent cap. Cache by `root` + definition version. Excludes uncommitted Workspace changes | Before connecting that preview |
| — | Retained-history size, per-project physical allocation, shared-object attribution | Project Storage tab (future sections) | Ownership and counting semantics undefined; Store totals are Store-wide | Design first | Deferred |

Shape rules for any addition: snake_case; times as bare epoch-ms names (`created`,
`started`, `time`); byte names consistent with existing ones (`bytes`, `free`,
`free_disk`, `wal_bytes`) so `--text` formats them; pinned identity as the typed
`at{id,kind,branch,root}` used by `file list/stat` (`snapshot` is only a display
label); Ints are i64; optional Commit is the last positional.

## UI fields: refine, defer, keep simulated

**Refine now (data already available):** PostgreSQL version/latency keys;
`down_reason` ⇒ unknown counts; Sandbox `created`, `id`, `op`; bind the preserved
Workspace base/head/activity/dirty/pending-merge fields; "recorded" Sandbox state;
PostgreSQL "reach"/"usable from every machine"/"Stores N"; `gone` wording; "1 Layer";
"SQLite pages"; "in saved history"; "Doctor: nothing found"; in the preserved Project
statistics preview, hide mixed-scope ratios and the ring in real mode and source
"main, latest, raw" from `get-commit .logical`; drop dead store-size paths; disk
"free (guest) · allocated".

**Defer (upstream or no source):** StoreBreakdown real values and Init/free pills
(U4); saved-tree entry counts on the Project Storage tab (U8); Sandbox/Machine CPU,
memory, disk usage; Architecture. Scratch, daemon logs, Uptime and Workspace
files/patches were removed from the UI on 2026-11-09 and stay removed.

**Keep explicitly simulated:** StoreBreakdown fixtures (DEV+sim), `sampleSandboxUsage`
(DEV), sim playback values. The sim also shows a removed platform (microsandbox
`edge`) as running; real 2.0 answers `unsupported`. Real mode never shows samples.

## Contract notes kept from the first draft

- Distinguish available, unsupported and unavailable; never substitute zero.
- A composed view is not an atomic cross-resource snapshot; show each part's time.
- CPU percentages need a sampling interval and denominator; defer until upstream.
- An old observation may stay visible with its time and a Stale label.
- Machine PostgreSQL capability is compatibility, not measured access. PostgreSQL
  *Store calls* run in Connect's CLI process, but each Sandbox daemon opens the Store
  from its machine; `doctor sandbox` observes that indirectly. No reachability matrix.
- Ratios need compatible scopes and complete numerator and denominator. PostgreSQL
  schema size is not server disk use. SQLite file length is not allocated blocks.
- Cache immutable measurements by root plus measurement version; never rescan on
  rerender. Keep Doctor separate from statistics, logs and telemetry.

## Verification

Source-reviewed at `ce0e00bef2`: every class-1/2 field and every verdict above.
Runtime: on a fresh temporary home with the `d4304741` build, `machine status native`
(`free_disk:null`, `tool_version:null`), `machine get native` (`state:"ready"`, sizes
null), `machine get docker` (`stopped`; prints `backend:"docker"`, older than source).
GETs on the simulated host (`/api/machines`, `/api/sandboxes/api-dev`, `/api/storage`,
`/api/doctor`, `/api/projects/shop%2Fapi`) and headless browsing of Machines, a machine
detail, Sandbox `api-dev` tabs, Storage, `shop`, `team` and the project Storage tab.
No real Store scan, mutation or UI change was made. Not runtime-verified:
`branch get-commit` Layer records on real data (the default binary lacks the call),
PostgreSQL status, StoreStatistics counters.
