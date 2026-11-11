# Dense Studio history — implemented specification

2026-11-10. The single Studio preset now generates eight different history
densities through the real pinned LayerFS CLI. The eight existing project themes
and four-machine/four-store topology remain. No sandboxes or workspaces are
created, and application programs are not executed. The complete eight-project
real CLI run passed saved-graph, file-content and activity-capture verification;
private resource cleanup was independently verified. The measured result is
recorded below separately from the recipe specification.

## Eight different workload tiers

The single Studio preset recipe assigns one fixed tier to each project. There
is no tier selector or additional preset.
Existing saved homes remain untouched until Build projects is chosen; that
workflow continues to reset first. This is not an in-place history extension.

The lightest project satisfies all original minimums: at least 100× unique
Commits, 5× Branches and, per the user's explicit selection, 100× main Layers.
Higher tiers intentionally contain more operations. The following counts are
generated recipe targets. Saved-graph verification
checks the actual results; it does not infer success from these targets.

| Tier | Project | Machine | Unique Commits | Side Branches | Main Layers | History CLI calls |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| 1 | design | Native | 2,400 | 54 | 500 | 2,933 |
| 2 | billing | Docker | 2,664 | 59 | 555 | 3,255 |
| 3 | sdk | demo-build | 3,192 | 69 | 665 | 3,899 |
| 4 | evaluation | demo-research | 3,984 | 84 | 830 | 4,865 |
| 5 | embeddings | demo-research | 5,040 | 104 | 1,050 | 6,153 |
| 6 | compiler | demo-build | 6,360 | 129 | 1,325 | 7,763 |
| 7 | gateway | Docker | 7,944 | 159 | 1,655 | 9,695 |
| 8 | website | Native | 10,056 | 199 | 2,095 | 12,271 |

Side Branch counts exclude main; add one for total Branch count. Pair tiers
1+8, 2+7, 3+6 and 4+5 across the existing machines. Each machine has one heavier
and one lighter project. Workload size and platform speed are separate dimensions;
these different workloads do not establish a fair platform speed comparison.

Totals: **41,640 unique Commits, 857 side Branches, 330 genuine merge Commits,
8,667 publications, 8,675 main Layers including imports, and 50,834 history CLI
calls**. Imports, placement, discovery and verification add further commands.
Shared ancestors count once per project, not once per Branch.

## Parameterized release-cycle recipe

Each generated project contains the existing 24-Commit authored recipe and its
two unfinished exploration Branches, followed by N release cycles, where N is
9, 10, 12, 15, 19, 24, 30 or 38. This construction happens in the replacement
preset environment after reset; it does not extend the previous saved home.
Each cycle:

1. Fork feature A, feature B and maintenance from the same current main.
2. Write 80 real revisions on A and 80 on B, using disjoint evolving files.
3. Merge A and B into a new integration Branch, then publish it. Repeat 26
   times: revise integration content/manifest and publish the descendant.
4. Write 49 maintenance revisions from its original, now-stale main base.
5. Merge current main and maintenance into a new release Branch, then publish
   it. Repeat 27 times: revise release content/manifest and publish.

Each cycle adds 262 file-write Commits, two genuine merge Commits, five side
Branches, 55 publications and 322 CLI calls. Per project:

- unique Commits = 24 + 264N;
- side Branches = 9 + 5N;
- main Layers = 5 + 55N;
- history CLI calls = 35 + 322N.

The runner requires every merge to be divergent and every publish to return
Added with zero overwritten Layers. Consecutive descendant publications reuse
the same Branch.
Publishing does not advance that Branch's base, but LayerFS's recorded lineage
covers earlier published ancestors. Another Branch's intervening publication
must be integrated before reuse, as shown for maintenance. A real isolated Native
pilot completed the lightest tier's 2,933 history commands and its saved ancestry
reads, then exposed a file-inventory verifier mismatch: real glob results include
directories. That failed result is retained; the corrected verifier includes
both files and parent directories. The later full eight-project result below
passed with that correction; it does not change the pilot's failed verdict.

The recipe makes deterministic updates to a bounded set of project-domain files:
website catalog/delivery, design tokens/components, gateway routes/policies, billing
invoices/pricing, compiler grammar/diagnostics, SDK requests/pagination,
embeddings corpus/chunking, evaluation queries/rubrics. Changes alter bytes.
Dense revisions rewrite fourteen bounded paths under
each project's existing `docs/` directory, rather than creating thousands of
numbered files. Content stays below 2 KiB per write and identifies itself as
authored fixture data without claiming application execution or measured results.

## Parallel execution and evidence

All stores finish placement before any history starts. All eight project scripts
then start concurrently, two per machine/store. Lighter tiers finish first; do
not delay them or pause heavier work to keep an artificial concurrency level.
A command dependency scheduler admits up to **12 simultaneous CLI calls,
3 per store and 3 per project**. Feature A, feature B and maintenance chains can
overlap; mutations on each branch remain ordered. Each publication waits for its
matching write/merge receipt, and the next write on that branch waits for that
publication. Main publications share a serialized lane. A live negative control
confirmed that publishing an older Commit after advancing its branch head is
refused with HeadMoved, so that proposed overlap is not used. Preserve the fixed
macOS writer admission; no CLI retries or replay of uncertain operations.
Saved verification overlaps four stores, checking each store's projects in order.

### Step journal and recovery

`tools/demo/step-journal.mjs` stores mutation attempts in
`demo-steps.ndjson`, alongside `demo-fixtures.json` in the private preset state.
Each step appends its pre-attempt record, exact invocation/action identity when
available, and final result or refusal. The in-memory step index remains available
to graph verification; the persisted ownership/progress manifest contains an
empty step table and journal metadata, avoiding whole-history rewrites on every
CLI command.

Loading migrates legacy inline receipts and reconstructs the index from the
journal. Running or uncertain steps are never automatically replayed. Missing,
malformed or partial journals refuse recovery rather than guessing a mutation's
outcome. A journal write failure after a possible mutation keeps uncertain
custody. This is a process-recovery record, not a promise of power-loss durability.

Runner cleanup and both general-reset entry points clear the journal only after
resource inventory confirms deletion. Failed cleanup retains the receipts. Reset
also clears stale capture proof and task snapshots. Build projects performs the
existing general recursive reset before importing the replacement library.

### CLI Activity

The normal archive retains up to 100 MB for seven days. Preset-action files are
separately protected from normal pruning, with a declared 1 GB protected budget;
reset clears them through the existing generation fence. The recorder has a
bounded pending-write budget. Capacity or disk errors remain visible, and exact
capture verification refuses an incomplete archive. Protection is not unlimited
retention and is not an assurance that an arbitrary larger workload fits.

Pruning runs on rotation. A metadata index reads newly appended complete lines,
while command lists are paginated and selected streams are loaded from their
recorded disk locations. Live notifications are throttled. Status uses indexed
summaries rather than reconstructing the entire action archive.

Each stdin/stdout/stderr capture remains limited to 32 KiB, with redaction and
explicit truncation flags. Dense write payloads stay below that limit; saved
history verification uses small pages. `manifest.activityCapture` records exact
journaled invocation-ID coverage, required file-write stdin, queued/started/
finished records, both output streams, failures and mutation-stream truncation.
Missing identity or incomplete mutation capture fails real preset verification.
Extra discovery and verification calls are allowed and their failures are still
checked. A retained nonempty action alone is not sufficient proof.


## UI and progress

Studio keeps its machine/store/project tree, Reset and Build projects controls.
Each project has a fixed tier, confirmed/target Commit and main Layer counts,
elapsed time and direct View script. Selected details include branch and command
counts. Resource counters advance from confirmed CLI results; unique Commit IDs
are deduplicated. Failed and stopped projects retain partial counts and reasons.

The build bar weights actual recipe steps. Its overall denominator is **50,842
units: eight machine/store preparation units plus 50,834 history commands**.
`historyCompleted/historyTotal` expose the history-only command count separately;
the UI must not label preparation units as CLI commands. Unequal project
percentages are not averaged. Progress snapshots are throttled to 250 ms, with
immediate task starts, failures, completions and stage changes. Verification
advances from zero to eight as each project's saved graph and files are verified.
Elapsed time stops at the saved end time; there is no unmeasured ETA.

Command plans come from the same recipe as execution. View script requests
100 commands per page, expands stdin on demand, and downloads the complete
selected command plan. Downloads are identified as plans requiring prepared
source content, not standalone setup scripts. Run from terminal provides the
complete reset/build workflow. CLI Activity pages command metadata and selected
input/output, preserving direct invocation links.

History loads branch pages and graph details on demand. Main history rows remain
publication Layers; side-branch rows remain Commits. Following immutable saved
anchors must preserve earlier page contents while later writes occur. Counts of
loaded graph records are not advertised as total history counts.

## Verification status and boundaries

Implemented checks cover deterministic counts and changing content, distinct
keys, graph dependencies, expected final main files, and retained drafts. Runner,
journal and activity checks cover the placement barrier, bounded dependency scheduling,
per-branch ordering and serialized main publication, uncertain-outcome custody, failure draining, capture
completeness, reset fencing, weighted progress and small manifest snapshots.

The saved-graph verifier reads every retained Branch, the union of actual unique
Commit IDs, merge parents and bases, all main Layers and publication sources,
exact file/directory inventory, final file contents and retained drafts. It follows
complete immutable pagination rather than assuming the first page is complete.
Expected mutation results are compared with saved IDs, not merely transport
success. Per-project verification results are persisted as projects finish.

A real Native pilot of the lightest tier completed all 2,933 history commands
but failed its final inventory assertion as described above. Its failure evidence
is retained. An earlier full-run attempt also retained a native
`Failed: Store open: Store busy before effect` outcome. The subsequent full run
used the isolated native runtime fix and passed. No mutation retry or lower
script concurrency was used to turn those failures into successful results.

## Measured full eight-project result

The [live receipt](../evidence/preset-controls/dense-eight-tier-live.json) records
all eight projects verified on their final four machines, with no sandboxes or
workspaces. Actual saved histories matched the table: **41,640 unique Commits,
857 side Branches, 330 merge Commits, 8,667 publications and 8,675 main Layers**.

| Phase | Exact elapsed | Readable elapsed |
| --- | ---: | ---: |
| Preparation, including imports and placement | 48,107 ms | 48.107 s |
| All eight concurrent history scripts | 673,090 ms | 11 min 13.090 s |
| Saved graph/files and activity verification | 92,376 ms | 1 min 32.376 s |
| Start through verification complete | 813,573 ms | 13 min 33.573 s |
| Post-verification evidence collection and cleanup | 3,741 ms | 3.741 s |
| Start through final cleanup result | 817,314 ms | 13 min 37.314 s |

The post-verification interval includes evidence collection and teardown; the
receipt does not isolate a pure cleanup-only timer. Activity flushing is included
in the recorded phase boundaries, with no separately measured flush duration.

| Project | Tier | Actual history calls | Script elapsed |
| --- | ---: | ---: | ---: |
| design | 1 | 2,933 | 192.777 s |
| billing | 2 | 3,255 | 154.582 s |
| sdk | 3 | 3,899 | 180.105 s |
| evaluation | 4 | 4,865 | 215.244 s |
| embeddings | 5 | 6,153 | 259.126 s |
| compiler | 6 | 7,763 | 313.694 s |
| gateway | 7 | 9,695 | 388.909 s |
| website | 8 | 12,271 | 673.090 s |

The [process trace audit](../evidence/preset-controls/dense-eight-tier-trace-analysis.json)
reaches **eight actual simultaneous CLI child processes**.
Across the history-process interval, mean process concurrency is **3.37094**,
including gaps between commands. Eight processes overlap for 98.435 seconds,
14.62693% of that interval. Scripts finish naturally at different times;
website runs for **284.149 seconds after gateway**, the last other project,
finishes. Peak overlap alone would conceal this long tail. Script-phase timing
includes coordination between child processes and therefore differs slightly
from the first-child-start to last-child-end interval of 672,971 ms.

All **54,821 setup-action CLI invocations** succeeded, each with one queued,
started and finished record, both output streams and no truncated stdin/stdout/
stderr. There were no duplicate lifecycle records, missing invocation lifecycles,
malformed archive lines or history mutations outside their project task windows.
The **50,834 history calls** match all project script targets exactly. All
**41,310 file writes** have stdin. The journal-based proof separately matches
**50,852 mutation invocation IDs**, comprising history plus 18 preparation
mutations, with no missing IDs, failed calls or expected truncated streams.
Additional discovery and verification reads account for the remaining calls;
they are not missing or unexpected mutation effects.

Immediately before teardown, recorded sizes were:

- CLI Activity archive: **218,280,762 bytes**.
- Step journal: **88,968,031 bytes**.
- Ownership/progress manifest: **10,229 bytes**.

These measurements demonstrate why preset evidence needs protected retention
beyond the ordinary 100 MB archive. Teardown independently verified removal of
all four private stores and both custom Lima machines, with no remaining or
unexpected resources. Activity evidence remains retained after teardown; reset
has its separate history-clearing semantics. Existing user preset resources
were not rebuilt by this private verification.

The [final verification summary](../evidence/preset-controls/dense-eight-tier-verification.json)
records the accompanying checks. The preview was reloaded and confirmed the
fixed CLI; Studio was reopened without Build or Reset, retaining existing user
contents. This is a single diagnostic run with the pinned native CLI artifact
`build-macos-c19cfd0bbfac4770a6951bf33d2070e8` and the recorded Linux bundle.
Unequal workload sizes and uncontrolled caches do not establish a fair platform
comparison. **No dense sequential baseline was measured in that qualification.** The earlier 1.865 s/280-call result does not establish this
workload's speedup. A future sequential comparison must use the same dense graph
and final runtime in both arms.

Content version **3** prevents older saved builds from being labeled Ready for
these targets. Existing user environments remain unchanged until Build projects
or Reset is chosen. Runtime patches and artifact pins belong in their separate
verification records; the preset does not embed a workaround, lower concurrency
or silently retry failures.


## Optimized full proof — 2026-11-10

The [optimized full receipt](../evidence/preset-controls/dense-eight-tier-optimized-verified-live.json)
and [independent archive audit](../evidence/preset-controls/dense-eight-tier-optimized-trace-analysis.json)
pass the same eight unequal tiers and all counts above. The combined treatment
uses a sealed release-profile native runtime, branch dependency scheduling at
12 / 3 / 3, four-store verification, and bounded batched activity logging.

| Phase | Previous observation | Optimized observation |
| --- | ---: | ---: |
| Preparation/import/placement | 48.107 s | 21.752 s |
| History construction | 673.090 s | **247.754 s (4 min 7.754 s)** |
| Saved graph/files and capture verification | 92.376 s | **24.911 s** |
| Start through verified ready | 813.573 s | **294.417 s (4 min 54.417 s)** |
| Start through cleanup/finalization | 817.314 s | **298.150 s** |

History elapsed is 63.2% lower, an observed 2.72× ratio. These are single diagnostic
user-flow observations with uncontrolled caches and multiple changes; they do
not isolate scheduler gains or establish a statistical performance guarantee.
All project counts are unchanged. No command was retried.

The audit checks all 54,821 setup invocations and 50,834 history calls: exactly
one queued/started/finished lifecycle each, both output streams, all 41,310 write
inputs, zero failures, duplicates, missing lifecycles, malformed records or
truncation. Required input presence is checked, not independent byte comparison
of every payload. The journal separately proves 50,852 mutation invocation IDs.
Actual history process overlap reaches 12 globally; each store/project stays
within 3. Mean process concurrency is 8.573 across the history interval.

Logger peak buffered-plus-reserved memory is 6,297,154 bytes below its unchanged
8,000,000-byte bound. No terminal or progress records were dropped, and pending
bytes, reservations and waiters all drained to zero. Before teardown, the archive
was 218,876,607 bytes, the journal 98,418,982 bytes and the manifest 10,234 bytes.
All four private stores and both custom machines were removed and independently
verified absent. Source hashes remained stable. Existing user Studio contents
were preserved.

The [verification summary](../evidence/preset-controls/dense-speedup-verification.json)
links passing root, activity, adapter, release-native regression and desktop
build/typecheck results. The preview now selects the sealed release CLI and
matching daemon and opens Studio without rebuilding it. Script pagination,
concurrency explanation and window sizes were exercised; no Electron GUI
verification is claimed. Earlier HeadMoved and activity-capacity failures remain
retained as failures; their fixes were qualified before this full proof.
