# Live transfer and move failure verification

Verdict: **PASS**. `validated-outcomes.json` qualifies 28 real CLI-interruption
phase rows, 12 real Connect-host interruption rows and two fresh-read-gated
explicit Connect recovery flows. Backup/restore have independent receipts in
`../live-backup/`; no simulator is used here.

The matrix was enumerated from pinned source and explicitly approved by the
lead before injections; `reviewed-matrix.json` retains the review and custody
contract. `source-identity.json` pins unchanged Connect host files, Node 24,
CLI/daemon hashes and the matching sealed Linux bundle. No LayerFS source or
binary was edited. Source was read with `git show 833d04cf:<path>` only.

## Exact boundary mechanism

The driver invokes the real Storage manager and CLI adapter. Its injected
`on_spawn` observer SIGSTOPs only that owned child, then external LLDB attaches
and sets a source-line breakpoint in the unmodified pinned binary. A real
breakpoint stop/backtrace precedes `process kill` (CLI SIGKILL), or a debugger
command SIGKILLs only the Connect host while the original child continues.
This is a test observer around the actual host route, not a simulated backend.

Transfer source: `control/crates/layerfs-store/src/sqlite/transfer/phases.rs`.
Breakpoints after the declared phase begins and before its work are check129,
snapshot253, send270, verify303, install327, record340 and retire368. They
qualify each push and pull, plus each half of a Docker-to-Lima move. The record
breakpoint is after destination installation but before authority publication;
retire is after publication and before source removal. CLI events alone would
be racy: phase progress precedes persisted op advance, and backup events can
be buffered. The debugger all-stop boundary avoids both errors.

Fresh Store status and record reads precede every explicit recovery. Initial
source authority is retained through install/record uncertainty; retirement
has destination authority. Actual `Storage.retry` was additionally exercised
for both directions after the matching unresolved op and running Machine
were freshly observed; it rechecks the gate and launches exactly once.

## Receipts and command bounds

`live-ledger.json` records push/pull setup, reads, explicit recovery and cleanup;
`move-ledger.json` records both move halves. Per-row JSON retains the actual
persisted job, initial and fresh outcomes, child identity and launch count.
Matching `.debug.log` files retain source address, stop and exit9 evidence.
`move-host-ledger.json` and `host-*.json` retain host-only interruption.
Original children finish even though Connect is dead; restart marks the job
Interrupted and fresh reads discover the resulting authority with zero replay.
Move-pull host death leaves authority on native and never starts the push half.

Exact Python and Node drivers are retained under `drivers/`. Matrix rows are
separate subprocess invocations, each with an explicit 115-second outer wall
limit and a 105-second driver deadline; CLI commands have 110-second limits.
No invocation timed out. Setup/preparation, source reads and offline assertions
are not performance measurements. Only Disposable Stores were used.

## Retained setup and harness failures

The first worker start used a stale default protocol2 bundle and refused the
pinned protocol3 client. The owned worker was stopped, the matching sealed
`LAYERFS_BUNDLE` selected, and a successful explicit start recorded.

A same-direction push after the retire kill correctly refused InvalidInput:
Store authority was already Docker. Fresh reads preceded the explicit pull
that reconciled this case. Its original refusal remains in `live-ledger.json`.

The first six host-only harness rows expected child exit0 and retain false
raw assertions. The source contract (`api/crates/layerfs-cli/src/output.rs:70`)
requires exit125 when host death closes stdout after effects complete. The
append-only `validated-outcomes.json` independently asserts that exact125,
completed authority/no pending op, Interrupted/no fabricated result and zero
restart replay. It does not rewrite those initial harness outcomes or rerun
the successful mutations.

## Cleanup

`cleanup.json` records fresh reads, removal of the last probe, stop/removal of
the owned Lima VM and removal of the temporary home/state. `container-cleanup.json`
records removal of the exact stopped Docker container and its exclusively
attached data volume. `cleanup-ownership.json` establishes home-id8808d596
ownership through pinned source naming and fresh exact-container mounts.
An initial automatic cleanup review rejected the generic docker-machine name;
no action ran. Fresh ownership evidence established the safe permitted scope
before cleanup was retried. Other sessions and pinned warm binaries/bundle
remain untouched. Handoff free host space: 331.28GB; Docker guest free before
cleanup: 190.69GB (186223900 KiB). No global cleanup was required.
