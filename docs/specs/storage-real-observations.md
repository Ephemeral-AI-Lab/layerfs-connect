# Real storage observations and saved allocation metadata

Connect uses the CLI through the existing lossless adapter. The HTTP JSON
boundary represents unsafe i64 integers as `{$layerfs:'i64-v1',decimal:'...'}`;
no counter is coerced to a JavaScript Number.

## Store measurements

`GET /api/stores/:name/stats` passes the successful `store.stats` result through,
including `store_id`, `store_generation`, `accounting_version`,
`data_pack_bytes`, `metadata_pack_bytes`, `database_overhead_bytes`,
`free_page_bytes`, `database_page_bytes`, `composition_complete` and optional
`composition_reason`. Components are interpreted only under their upstream
accounting version/completeness. PostgreSQL incomplete composition is not a
complete pie or stack.

Each explicit successful read records a timestamped observation in the private
Connect state `storage-observations/` directory. There is no polling service.
`GET /api/stores/:name/observations` returns:

```text
{version:1, scope:'store', store, gapAfterMs:1800000,
 retentionDays:90, maxPoints:1000,
 series:[{identity, startedAt, points:[{observedAt, stats}]}]}
```

`stats` is a compact snapshot of allocation and encoding counters, retaining exact
integers. `observedAt` is Connect's actual observation time, not a Commit time.
The first read gives one point; no samples are reconstructed for earlier dates.
Charts leave gaps between observations more than `gapAfterMs` apart and never
join separate series. Allocation decreases are real observations and may reflect
reclamation, maintenance or restore; they are not rejected as impossible growth.

Series isolation includes the LayerFS home, Store name, opaque upstream Store ID,
upstream generation, kind and current machine route. Store identity is not
inferred from its name. Missing upstream identity/generation disables recording
and adds `observationError` to the otherwise successful stats response. Local
journal read/write errors behave the same way; they do not turn a successful
Store measurement into an application error. Failed CLI statistics add no sample.

SQLite stats reads also make one independent, non-starting `store.status` read.
`fileMeasurements:{observedAt,bytes,walBytes,incomingBytes}` records its measured
main/WAL/incoming file lengths. These are separate observations from database
page accounting, and are not physical allocated blocks. Unavailable status leaves
`fileMeasurements:null` with `fileMeasurementError`; it does not discard valid
Store statistics. The same nullable file measurements are persisted in samples.

The host serializes appends and atomically replaces each journal. Retention is
90 days, 1,000 total points and at most eight series per Store, enforced on append.
A different home has a separate journal even when a Connect state root is reused.
These observations are owned by the active Connect host, not a general
multi-writer telemetry service.

## Saved revision graph

`GET /api/projects/:encodedKey/storage-history?branch=main&at=<full-id>&size=20`
returns `{items:CommitInfo[], head:SavedStorageRef|null, next:string|null}`.
It makes a bounded `branch.commits` metadata read, plus a side-Branch record read
when needed to stop at its fork. It never loads diffs, walks file trees, or fans
out per Commit. Resume with `at=next` to continue from an immutable saved parent.
The maximum page size is 20, requesting `include_storage:true` to stay within the existing bounded summary budget. Saved pins must be full 66-hex IDs.

CommitInfo retains existing presentation fields and adds:

- `savedKind:'commit'|'layer'`, distinct from the existing operation `kind`.
- `ref`, `parentRef`, `sourceRef`: typed `{id,kind:'Commit'|'Layer',branch}` or null.
- `timeStatus:'recorded'|'unavailable'`; a Layer without a recorded publication
  timestamp never inherits a source Commit's timestamp as publication time.
- `newCanonical`, `newStored`, `newMetadata`: nullable exact allocation counters
  from recorded Save receipts. Null means unavailable; measured zero remains zero.

The logical-size graph uses saved revision order when timestamps are unavailable.
Save allocation counters are additions recorded by that Save, not current
exclusive per-project disk usage. Layer rows have no invented Save allocation.


## Explicit bounded storage analysis

`GET /api/projects/:encodedKey/storage-report?branch=main&at=<full-id>&size=20`
is triggered only by the user's **Analyze saved revisions** action. The host
selects at most 20 saved snapshots from one pinned `branch.commits` metadata page
and calls `project.storage_report(project, snapshots, {max_objects:10000,
max_canonical_bytes:67108864})`. Selection does not request Save allocation
receipts or read diffs. Each project-scoped SDK pin names `{branch,commit}` explicitly; the project is supplied once by the call and cannot be overridden in a snapshot.
The adapter sends snapshots as JSON stdin, applies per-Store read admission, and
includes stdin in its coalescing key so distinct populations never share results.

The response preserves the upstream report and adds
`selection:{scope:"project_saved_revisions",limit,selected,hasEarlier,head}`. Its `population_id` identifies the
explicit selected population. `referenced_canonical_bytes` sums the unique
canonical footprint of each selected snapshot; `unique_canonical_bytes` counts
the union across that same population. Their difference describes canonical
sharing only within this selection. A complete report may visualize that
comparison. When `complete:false`, the aggregate and per-project totals are null;
show the reason and work counters without estimating savings.

`projects[].exclusive_within_population_canonical_bytes` and
`shared_within_population_canonical_bytes` describe canonical objects relative
to the explicit population. They are not per-project physical allocation or
reclaimable space. `physical_bytes` and `reclaimable_bytes` remain null with
`physical_reason`. Older CLIs without this call return an explicit `Unsupported`
response; the host never substitutes an estimate or automatically analyzes on
page loads or refreshes.


## Store analysis across selected current project snapshots

`GET /api/stores/:name/storage-report` is a separate explicit action. Optional
repeated `project=<bare-name>` parameters select 1..20 distinct actual project
names from `store.get(name).projects`. Foreign names and duplicates are refused.
Without a subset it selects the first 20 sorted actual names. The host reads
one `branch.get(project,"main")` per selected project, sequentially, captures
immutable full IDs and calls `store.storage_report(name,
[{project,branch:"main",commit}],budgets)`. Capturing heads across projects is not
an atomic Store-wide snapshot; the exact returned pins define the population.
No retained-history scan or Workspace observation is implied.

The Store result adds `scope:"store",name` upstream and
`selection:{scope:"store_main_heads",limit:20,selected,availableProjects,
excludedProjects,projects:["<store>/<project>"]}` in Connect. The UI reports the
selected and excluded project counts. Shared and exclusive canonical bytes are
relative only to these selected snapshots, even when all current project heads
are selected; older retained versions and unselected projects are outside the
population. No physical ownership or reclaimable-space claim follows.

## Selected-population encoding for the restored flow (2026-11-10)

Explicit project/Store analysis checks the pinned CLI's `storage_report` option
metadata, then sends `include_encoding:true` only when advertised. Older CLIs
retain the existing bounded canonical report without a failed-command retry.
Both scopes pass through optional `payload_encoding` unchanged and losslessly.

The optional version-1 population `selected_payload_object_records` measures
selected WholeFile/Chunk objects: per-snapshot referenced canonical bytes, union
canonical bytes, and union exact encoded record bytes. All three staged values
and the reuse ring switch to this same population together. Shared pack/group
framing, metadata groups and external delta-base storage are excluded; distinct
external direct base IDs are counted and disclosed separately. This is neither
physical project allocation nor complete reconstruction cost. Incomplete payload
accounting produces no encoding ratio; the canonical-only fallback remains.

Metadata objects can share compressed groups, so no proportional allocation of
their group bytes is invented. Store-wide canonical→encoded→database-page stages
use only `store.stats` counters. Latest main comes from pinned `project.stats`
and stays independent of the branch selected for history/analysis.

Project Storage direct links now load the bounded pinned report automatically,
including design and website. Branch/range changes request the new pinned
population once; no report polling is introduced. Analyze again remains an
explicit refresh. Store cross-project selection analysis stays explicit.
