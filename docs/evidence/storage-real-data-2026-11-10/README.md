# Real storage graphs and scoped analysis — 2026-11-10

Implemented in LayerFS Connect and the isolated LayerFS worktree
`/Users/yifanxu/Ephemeral-AI-Lab/layerfs-storage-visuals`, branch
`connect-storage-visuals`, based on `origin/layerfs_v2_0_0` at
`58c548b3e0a45f11880e3511bf1267d11e315415`. These are local development changes;
no commits, pushes, or merges were made.

## Result

Project pages show saved-tree facts, logical snapshot sizes by revision,
recorded Save allocation, and explicit analysis of that project's selected
saved revisions. Store pages show measured encoding, validated nonoverlapping
database-page composition, separately observed SQLite file/WAL lengths,
persisted observations, and explicit analysis across selected projects' pinned
current main trees. Project and Store analysis have distinct API/result scopes.

Canonical analysis measures an explicit selected population. It includes
structural objects and payloads; it does not estimate physical project ownership
or deletion savings. Incomplete analyses expose work/reason but null byte totals.
PostgreSQL free-page composition remains unavailable. Observations start when
Connect records them and are not reconstructed from Commit timestamps.

## APIs

- `store.stats`: additive database accounting, Store identity/generation.
- `branch.commits(..., {include_storage:true})`: compact nullable Save receipts;
  default history paging remains unchanged.
- `store.storage_report(store, [{project,branch,commit}], options)`.
- `project.storage_report(project, [{branch,commit}], options)`.

Both reports use one authenticated canonical traversal, bounded to 64 explicit
pins, 10,000 total object visits, 64 MiB canonical input, and the saved-query reply
budget. Project wrappers do not accept project overrides in snapshot entries.
Connect narrows interactive populations to 20 revisions or project heads.

## Pinned preview

The running preview uses the sealed macOS bundle:

`/Users/yifanxu/.cache/layerfs-worktrees/layerfs-storage-visuals-09c001eb6d3a/artifacts/build-macos-67ba57e5600747e997463a33696f7d1d`

Its read-only manifest records the source fingerprint and every artifact hash.
`desktop/.env.local` points to that bundle's CLI and matching daemon. The original
local preview pins were retained at `/tmp/storage-visuals-preview-original.env`.
The active environment remains the existing studio home. Existing guest workers
and their pinned Linux bundle were not restarted or replaced; worker compatibility
was exercised through the real worker protocol tests, not new guest deployment.

## Verification

- Connect: 63 focused host/measurement tests passed before the final scoped
  Store-selector addition; affected scoped route/observation tests then passed
  11/11. Desktop typecheck and production build passed.
- LayerFS API: call table 15, saved scopes 3, native/worker statistics and reports
  4 tests passed at final project-API source. PostgreSQL-enabled statistics suite
  passed 5 tests; final first-class project API was additionally exercised on
  PostgreSQL through the native Node SDK.
- Saved history: 10 tests, including default 50-row reply compatibility.
- Store control: 3 lease tests and 4 argument-forwarding tests.
- CLI: 2 argument tests, 3 discovery tests, and 1 real Store/project report JSON
  stdin test. Both scopes agreed on the identical immutable population.
- Warning-denying Clippy passed for affected API/control/engine/history crates
  and CLI with PostgreSQL enabled; formatting and production boundary checks passed.
- Boundary guard self-tests: 37; fuser-integrity guard self-tests: 14.
- Native Node SDK: SQLite and PostgreSQL Store/project reports and Save counters.
- Native Python SDK: synchronous Store/project reports and asynchronous project
  reports. Generated Node types and Python stubs match real CLI discovery (68 calls).
- Live authenticated preview reads: complete project analysis, complete Store
  analysis of two projects, additive SQLite composition, and persisted observations.
  See `live-api-results.json` for measured results without authentication material.

The owned disposable PostgreSQL fixture and temporary SDK experiment homes were
removed after verification. No desktop application was launched.

## Concurrency

A deterministic public regression reproduced a stale lease disappearing between
inspection and removal. Missing stale leases are now already released; other
lease errors preserve path, operation, Store and OS error details. Routing also
refuses a Store whose identity changed before its lease was claimed, preventing
old identity from being attached to new measurements.

Connect retains per-Store read admission. An independent 100-call raw concurrent
CLI probe after lease hardening had no ENOENT failures but one existing
`Store open: Store busy before effect` refusal; this work does not claim all
independent-process admission failures are resolved.

## Browser verification

Exercised the actual renderer at 1280×820 and 900×600: project main/side Branch
history, real Save bars, Analyze and Analyze again, exact measurement disclosure,
Store analysis with both projects and a keyboard-selected one-project subset,
SQLite composition/file-length measurements, and Refresh-created observations.
Actual browser screenshots are retained alongside this record. The browser pass
fixed fractional count-up formatting and duplicate React sibling keys; final
desktop typecheck and production build passed after these renderer fixes.

Final screenshots: `store-subset-900.png`, `design-analysis-1280.png`,
`design-history-900.png`, `design-allocation-900.png` and
`website-feature-auth-1280.png`. Earlier `store-analysis-1280.png` and
`website-feature-auth-1280.jpg` are retained preliminary views before final
numeric-label styling/guaranteed-viewport capture. Host/API evidence describes real measurements;
no demo metrics were fabricated.

## Resource handoff

The owned disposable PostgreSQL container/data and SDK scratch homes are removed.
Host free space remains above 280 GB. Exact completed private Cargo-cache
releases were exported to
`/Users/yifanxu/.cache/layerfs-worktrees/layerfs-storage-visuals-09c001eb6d3a/storage-visuals-handoff-scope.json`.
Source, sealed preview binaries, manifests and evidence remain protected.

Final browser Runtime/Log error lists were empty. Reduced-motion emulation
reported no chart/bar animation names. The browser was left on website/main.
Long-history pagination, exhausted analysis budgets, 30-minute observation gaps,
identity replacement and PostgreSQL layout were not exercised in the browser;
bounded/incomplete semantics, identity/gaps and backend accounting have scoped
Rust/host coverage as listed above.
