# Studio Mixed execution

2026-11-10. One Studio preset, two execution modes: Filesystem (default) and
Mixed. Build still resets the selected environment and CLI Activity first.
Mode is bound to the reviewed build signature, job, script snapshot, manifest
and readiness identity. Selecting Mixed never relabels a saved Filesystem build.

## Revisions and graph

Each dense release cycle converts Feature A's 80 writes and Feature B's first 16
writes into real workspace exec → workspace commit pairs. Base authored history
and the remaining writes use the direct file CLI. Each converted pair produces
one changed-content Commit with the original recipe identity and message.
UpToDate is not an accepted replacement. Each exec must report exit_code 0.

The full workload retains 41,640 unique Commits, 857 side Branches, 330 merges,
8,667 publications and 8,675 main Layers. Of 41,310 authored revisions, 15,072 come
from workspaces (36.49% globally, over 30% in every project). The history recipe
contains 80,986 actual CLI calls, including 8 sandbox creates, 7,536 mounts,
15,072 execs, 15,072 workspace commits and 7,536 unmounts. Discovery, preparation,
verification and reset add calls. Lifecycle chatter does not count as authored
revision coverage; missing/failed work never shrinks the planned denominator.

Feature B unmounts cleanly before its 17th direct write. Each branch mutation
chain stays ordered, and main publications retain exact Commit receipts and
write/publish head guards. Workspaces never mount main. Automatic head-moved
workspace merges, overwrite/force, synthetic empty commits and silent fallback
to direct writes are outside this deterministic workload.

## Persistent resources and concurrency

The normal recipe creates one owned sandbox per project (eight total), on the
SQLite Store's machine, and reuses it throughout all release cycles. Feature A
and B use independent concurrent workspace sessions. Each fresh workspace mounts
on its saved branch head, executes exactly two ordered exec → commit pairs, then
cleanly unmounts. The next two-revision batch mounts a new workspace; committed
files and branch history carry forward through the saved head. There is no
per-revision/per-cycle sandbox creation or close. Successful builds retain the
eight running sandboxes for reuse and have no mounted workspaces or active execs.

The pool enforces at most three sandbox allocations per project and 16 workspace
leases per sandbox. Normal recipe demand is one sandbox/two mounted workspaces
per project. These resource ceilings are separate from selected execution
scheduling: 12 CLI commands globally, 3 per Store and 3 per project. They do not
promise 48 simultaneous CLI children per project. Mount/commit/unmount dependencies
prevent concurrent control operations on the same workspace. Failed or uncertain
leases are not silently recycled.

A real lifecycle capacity proof accepted 16 mounts and refused the 17th with
Capacity. Sixteen requested execs all completed; actual CLI child overlap peaked
at 14 because the bounded activity logger applied backpressure. Its 8 MB memory
bound and terminal/cancellation reservations are retained.

## Presentation and capture

The existing Presets page gains a Filesystem/Mixed selector, current mode and
coverage progress. Scripts retain 100-row paging. Workspace exec bodies are
collapsed under Shell command / exec input; copy/download use the exact full
argv. Sandbox reuse, 3/16 ceilings and the separate CLI pool limits are stated.

The step journal records exact invocation/action IDs. Capture verification
requires successful lifecycle, exec and workspace Commit records, output streams
and direct-write stdin. Generated exec bodies fit the 2,048-byte argument bound
(maximum 817 bytes in the full recipe). Independent archive audits compare actual
exec argv/body against the journal. Canonical sandbox resource receipts own the
create invocation once; recipe aliases do not duplicate capture identities.

## Verification and reset

Graph/file verification uses saved immutable IDs, not the progress counter. Each
project must meet its full workspace quota and 30% minimum. Sandbox inspection
requires running state, correct project/machine, no unresolved operation or down
reason, a complete empty workspace page and no continuation. A down sandbox with
an empty workspace list is not cleanup proof.

On failure, stop new admission and drain dispatched calls. Preserve uncertain
mutation custody and resources for inspection. No uncertain exec/commit replay.
Normal unmount does not discard. Explicit Reset uses the existing discovered
inventory and cancellation/discard rules, closes sandboxes, removes stores and
custom machines, clears CLI Activity, then independently verifies cleanup.

## Qualification

The current two-revision workspace batching policy supersedes the earlier
whole-branch-session implementation. The actual Studio was reset and rebuilt through
the web UI with Mixed recipe version 2. It reached verified Ready in **1,019,408 ms
(16m 59s)**; history construction took **973,307 ms (16m 13s)**. The complete
80,986-command history and all 7,536 distinct workspace sessions passed the
independent archive audit. Every session has exactly mount → exec → commit →
exec → commit → clean unmount, ordered by actual child completion timestamps.

All 84,996 setup CLI calls succeeded with zero truncation; 15,072 workspace
Commits and 41,640 total unique Commits were verified, alongside the complete
saved graphs and 359 file checks. Studio remains open and Ready with eight
running sandboxes and zero mounted workspaces. The source remained unchanged
through the build. All 209 root tests, desktop typecheck and build passed.

- [Current combined qualification](../evidence/preset-controls/mixed-two-pair-verification.json)
- [Actual Studio web build](../evidence/preset-controls/mixed-two-pair-web-build-live.json)
- [Independent two-pair lifecycle audit](../evidence/preset-controls/mixed-two-pair-web-independent-archive-audit.json)
- [Web interactions](../evidence/preset-controls/mixed-two-pair-web-ui-verification.json)

The earlier historical evidence below remains useful for the capacity pilot,
but its 314-session cadence is superseded. These are individual observed timings,
not a controlled performance benchmark.

### Historical whole-branch-session verification


The all-machine lifecycle proof and the all-eight-project one-cycle production
Mixed pilot passed. The production pilot records 768 workspace revisions,
2,272 authored revisions, correct graphs/files, 4,395 successful setup CLI calls,
complete output/exec-body capture, stable sources and verified cleanup.

- [Production pilot](../evidence/preset-controls/mixed-production-pilot-1794296834786.json)
- [Full private web build](../evidence/preset-controls/mixed-web-build-live.json)

The earlier full private web build, which used 314 long-lived branch sessions,
passed through the actual renderer's Mixed selection
and Reset and build confirmation. It became verified Ready in **765,459 ms
(12m 45s)**; history construction took **708,118 ms (11m 48s)**. These are
observed single-run timings on this machine, not a controlled comparison with
Filesystem mode.

The independent archive audit passed: all **66,542 history CLI commands** matched
the journal's exact argv and results, with **70,552 successful setup CLI calls**.
All **15,072 workspace commits** were unique and present in saved history;
coverage was **36.49% of 41,310 authored revisions**, exceeding 30% in every
project. All 41,640 unique Commits, 857 side Branches and 8,675 main Layers were
verified, with 359 file checks. No failed or truncated captured calls were found.
The successful build retained eight running sandboxes and zero mounted workspaces.

- [Independent full archive audit](../evidence/preset-controls/mixed-web-independent-archive-audit.json)

Private reset passed: eight sandboxes, four stores and two custom machines were removed,
with an empty final inventory and the previous build Activity cleared. The audited
archive was exported before reset. The original preview configuration was restored;
all eight existing Filesystem projects were unchanged and all four store reads succeeded.

- [Reset verification](../evidence/preset-controls/mixed-web-reset-verification.json)
- [Original Studio restoration](../evidence/preset-controls/mixed-web-restoration-verification.json)
- [Combined qualification](../evidence/preset-controls/mixed-mode-verification.json)
Electron was not launched. The earlier Filesystem timing is not a Mixed
performance claim.
