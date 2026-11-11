# Ready project library

Implemented design, 2026-11-10. This replaces the earlier load-workload proposal:
the user wants eight ready projects with meaningful files and rich branch/commit
histories. Full old-scenario migration and sandbox/workspace execution are outside
this setup. Old examples supplied inspiration only.

## One Studio preset

4 machines (Native, Docker, two Lima VMs), 4 SQLite stores, 8 projects:

| Machine | Store | Projects |
| --- | --- | --- |
| Native | demo-studio | website, design |
| Docker | demo-services | gateway, billing |
| demo-build | demo-build-cache | compiler, sdk |
| demo-research | demo-experiments | embeddings, evaluation |

`tools/demo/projects.mjs` owns initial content and project-specific history writes.
Every project starts with 16 files. Source examples cover storefront, design kit,
API contracts, invoice calculations, expression language, API client, keyword
retrieval and search review cases. No external dependencies or model services are
needed to materialize the files. Fixtures explicitly distinguish authored sample
values from execution results.

## History: eight unequal tiers

Content version 3 preserves the authored 24-Commit foundation, then adds a
project-specific number of deterministic release cycles. Each cycle adds 262
file-write Commits, two divergent merges, five retained side Branches and 55
zero-overwrite publications. Consecutive publications reuse descendant Commits
on the integration/release Branch; their ancestry covers earlier main Layers.

| Tier | Project | Commits | Side Branches | Main Layers | History CLI calls |
| --- | --- | ---: | ---: | ---: | ---: |
| 1 | design | 2,400 | 54 | 500 | 2,933 |
| 2 | billing | 2,664 | 59 | 555 | 3,255 |
| 3 | sdk | 3,192 | 69 | 665 | 3,899 |
| 4 | evaluation | 3,984 | 84 | 830 | 4,865 |
| 5 | embeddings | 5,040 | 104 | 1,050 | 6,153 |
| 6 | compiler | 6,360 | 129 | 1,325 | 7,763 |
| 7 | gateway | 7,944 | 159 | 1,655 | 9,695 |
| 8 | website | 10,056 | 199 | 2,095 | 12,271 |

Totals: 41,640 distinct Commits, 857 side Branches, 330 genuine merge Commits,
8,667 publications and 8,675 main Layers including imports. History requires
50,834 CLI commands; setup and verification are additional. Every project has
14 bounded revision files under its existing docs directory, using its original
domain (catalog, tokens, routes, invoices, grammar, client requests, corpus or
review rubrics). File contents change; no-op writes cannot satisfy the targets.
Original unfinished explorations remain unpublished. Application tests are not
executed or represented as successful outputs.

The lightest tier exceeds 5x Branches and reaches 100x both unique Commits and
main Layers. Higher tiers intentionally finish later. These are recipe targets;
a saved home meets them only after full read-back verification. See
[dense history design](dense-project-history.md).

## Execution and verification

One reset/build admission lock spans cleanup and provisioning. Studio always
forces sandboxes off, even if a compatibility API caller passes true. Independent stores prepare at most two concurrently with ordered imports per
store. All four stores must reach their final machines before any project history
starts. Then all eight project scripts run concurrently, two per machine; only
commands within one project are ordered. A load-only CLI admission capacity of
eight is scoped to the preset action/home; ordinary calls retain capacity four. Application code is never executed.
A failure stops admission and drains running sibling pipelines before releasing
that lock. Source directories include store and project to avoid name collisions.

Recipes drive View script and real execution. Mutation attempts, invocation identities and exact outcomes are appended to the
private step journal; ownership and progress checkpoints remain in a small manifest. Verification reads the actual branch lists, commit IDs, merge
parents, every main Layer through immutable paginated reads, the exact file/directory
inventory, every expected main file, and draft contents. It checks
unique commit counts rather than summing overlapping histories. Every publish must
return Added with overwrote_count zero; every intended merge must be divergent.
CLI Activity captures exact argv, stdin, stdout/stderr and overlapping timestamps.

Content version 3 prevents old builds being labeled Ready. Existing older homes
are retained until the user builds/resets. Old IDs stay accessible for compatibility
and cleanup but only Studio is listed as a selectable preset.

## UI

No catalog or sandbox option. The machine/store/project tree shows the planned
library. Each project row has View script; details show purpose, retained branch
names and planned/verified history counts. Project scripts exclude reset and
shared machine/store setup. Full script shows the complete operation. Actual
recorded invocation links open the existing CLI Activity input/output inspector.

## Historical evidence and boundaries

`docs/evidence/preset-controls/project-library-topology-live.json` records a real
pinned-CLI proof of all eight recipes on Native, Docker and both Lima VMs: exact
read-back, 192 commits, 16 merges, 32 publishes, 689 captured CLI invocations and
176 exact stdin comparisons. Two store pipelines overlapped. Final teardown
independently verified removal of the private stores and custom VMs. A separate
native-only proof is retained in project-library-live.json. Existing user environments are not reset by
verification. Unit coverage checks graph faults, safe publication, command-plan
parity, scheduler concurrency and failure draining. No app execution/tests or
benchmark result is implied by file materialization.


## Concurrent load correction and observed failure

The earlier successful receipt used two local seeding pipelines followed by store
moves. It is retained as baseline evidence, not an eight-way remote load proof.
The new `project-library-concurrent-live.json` proves final-placement-before-history
and eight simultaneous CLI processes. It records an unsuccessful run: one native
file.write returned Unknown / Service(History(Busy)); seven siblings stopped.
Do not convert that into a passing result by serializing same-store writes or
retrying Unknown outcomes. The UI distinguishes CLI/task failure from controlled
stopping, and private test resources were cleaned with verified inventory.

The follow-up identified a macOS-only missing cooperative writer lock in LayerFS
Persistence. The isolated `layerfs-macos-writer-admission` worktree extends the
existing Linux directory lock to macOS; no preset script or command retry was
introduced. `project-library-macos-writer-fix-live.json` records all eight final-
machine scripts completing and verifying: 280 history calls, 176 writes, 16
merges and 32 publications, with eight actual overlapping CLI processes. The
project-history phase measured 10.376 s sequentially versus 1.865 s concurrently
(5.56×) in one diagnostic comparison; caches are uncontrolled. Imports, placement,
provisioning and verification are excluded. Historical failures above remain
unchanged. See `docs/macos-writer-admission.md` for the patch, runtime and checks.
