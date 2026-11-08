# Connect CLI follow-up verification

Status: **BLOCKED**, 2026-11-09. Every selected row except real native
directory acceptance passed. No terminal PASS is claimed. Owned live resources
have been reconciled and cleaned; the local package and evidence are retained.

Selected scope: [remaining checklist](phase-2-remaining-checklist.md) sections
1–4. The owner explicitly authorized Electron and a local macOS arm64 app.
Phase 2 and issues #145–#153 / #137 remain closed. Original receipts and
[Phase 2 record](phase-2-record.md) are historical and unchanged.

## Local source and artifact identities

Branch: `phase-2-cli-integration`. Preserved baseline `7c02313`; original delivery
`f058e71126179bca62a584eb6fb2be1866037b94`, verification
`a3f134f7db06dd43c5b27401851a59091b28964d`, closure
`d25585db1152bdcb58fda492b8b18c586325f1ac`.

Reviewed fixes: **`da2986c4771b9edb89db0b6761b3781ae8a1d7fa`**, tree
`307af775ca8abebf2fbcbfcf7a49ed91fabc59d8`. Final automated-check fingerprints
match these committed product files; see
[committed product verification](../evidence/phase-2-follow-up/lead/committed-product-verification.json).
Verification records are delivered in a separate local documentation commit.
No push, PR, merge, distribution or external issue/message was requested or done.

LayerFS source and paired binaries remain clean
`833d04cf44e8e747929d50ab1170a48260d9381c`, version 2.0.0, features
`machine,postgresql`. Development explicitly selects
`/Users/yifanxu/Ephemeral-AI-Lab/layerfs-connect-cli-137/target/debug/layerfs`.
CLI SHA-256 `7d7a5b507eeb2abc914a0e151c63eb12bd49bcbb69a06083d08f0b4430a3619c`;
daemon SHA-256 `664c991face739375b9c147c757575d4f12edbf84f64773eedd5a08c789d10c2`.
Source was read through `git show`; no upstream checkout, binary or production
source was changed or rebuilt. Node 24.21.0 drives the host; Electron 45.0.0
embeds Node 24.22.0. Only Disposable Stores and owned isolated state were used.

## Consequential fixes and review

1. Real packaged Stop crashed the host with an unhandled `AbortError`: the
   mounted output callback discarded a rejected Promise after the execution
   HTTP stream closed. Output callbacks now run in original order with immediate
   rejection handling and a pending counter/single drain Promise, preserving
   command/cancellation and independent Save facts. No retained-frame queue was
   added. A non-cancellation delivery failure is reported after Save. Two failing
   regressions reproduce the old behavior; all 28 focused cancellation/permission
   checks pass on the reviewed fix. The actual final native and package Stop
   flows leave the host alive and retain the Workspace and Sandbox.
2. Discovery could fail before the host's ready envelope, leaving the native UI
   with only “host exited.” Startup now recognizes the two fixed CLI error codes
   and returns controlled actionable guidance without raw stderr. Waiting for
   `close` ensures stderr has drained. Three real-child regressions and actual
   final package missing/incompatible-binary flows pass.
3. The native sidebar hardcoded “Simulated · 0.0.0” despite a real host. It now
   shows `Real LayerFS` or `Simulated LayerFS` from the existing bridge and omits
   the placeholder version. Actual preview checks at 1280×820 and 900×600,
   Settings/back navigation, console inspection and final native/package labels
   pass. [Preview receipt](../evidence/phase-2-follow-up/lead/footer-preview.json).

Two independent reviewers approved the final source hashes and correction of
the initial output-queue/stderr-drain proposals:
[independent review](../evidence/phase-2-follow-up/lead/independent-review-postgresql.json),
[second source review](../evidence/phase-2-follow-up/live/consequential-fixes-review.json).
Matching `docs/ui/` and integration designs changed with behavior. No tests were deleted.

## Native and local package

Real development and packaged preload/IPC, isolated userData/scratch and host
state, both window sizes, focus/minimize/restore, management, explicit Doctor,
mounted exit125, active Stop143, retained Workspace/Sandbox, pinned Files/History
and real-mode label pass. The scoped model-free driver uses the actual
Electron-owned host `/execute` route and preload Stop. An intentionally
nonexistent provider/model prepares the mounted chat and then refuses before
any API call; no model credits were spent.

The final package additionally exercises a real competing Branch write while a
mounted command is active. Stop retains `cancelled`/143 independently of
`Not saved: Conflict`, pending merge and both marker contents. The old saved pin
correctly lacks the unsaved file. This is actual CLI/host behavior, not a mocked
Commit error. [Partial-Commit receipt](../evidence/phase-2-follow-up/native-package/packaged-partial-commit.json).

Actual host SIGKILL/reconstruction preserves the old mount, exec ID, PID and
interrupted uncertainty without replay or fabricated final success. Explicit
Stop afterward remains separate from the unavailable final result.

Native chooser cancellation is real Cocoa `NSOpenPanel` control through an
external debugger on the owned Electron process; IPC resolves null.
**BLOCKED: actual acceptance of a directory whose path contains spaces.**
`AXIsProcessTrusted` is false, and the available Cindy native-control discovery
returned no tool. Direct OK throws an Objective-C exception, the actual default
button is unavailable, and scheduling the real action on the normal runloop
still produced no accepted IPC result before a bounded timeout. All failures
remain retained; neither a guessed URL nor a synthetic response qualifies.

Minimum next action: enable macOS Accessibility/Automation for the native test
runner, or have the owner accept the owned spaced directory in the real chooser,
then capture `chooseDirectory` returning that exact path. Recreate only the
isolated chooser fixture; do not rerun the passing campaigns or use the default
Connect state. [Native evidence and remaining action](../evidence/phase-2-follow-up/native-package/README.md).

The local macOS arm64 bundle is retained at
`desktop/dist/mac-arm64/LayerFS Connect.app`; the uniquely owned
`~/Applications/LayerFS Connect Follow-up Final 20261109-137.app` installation
was tested outside the checkout, removed during cleanup, then restored from the
protected build bundle while final artifact custody was reconciled. Both copies
are now retained, with no live test state. Independent canonical hashing confirms
byte/mode/link identity with the tested installation.
[Artifact custody](../evidence/phase-2-follow-up/native-package/final-artifact-custody.json).
The bundle carries Node and exact CLI/daemon resources. Runtime verification clears
CLI/Node/daemon overrides and uses only system PATH entries; all package links
stay inside the app and there is no linked LayerFS Node addon. Ad-hoc local
signing does not establish Developer ID signing or notarization.
[Package identity](../evidence/phase-2-follow-up/native-package/canonical-package-identity.json).

Real development and package shutdown/relaunch retain completed and interrupted
IDs, saved heads and Commit counts without replay. Native and package live
fixtures, conflict state, mounts and Sandboxes were freshly inspected before
explicit disposal. [Native cleanup](../evidence/phase-2-follow-up/native-package/cleanup-native.json),
[final-package cleanup](../evidence/phase-2-follow-up/native-package/cleanup-final-package.json).

## Live failure recovery

**PASS:** 28 debugger-confirmed CLI interruption phases across push, pull and both
cross-Machine move halves; 12 host-only custody interruptions; two actual
fresh-gated explicit `Storage.retry` recoveries.
[Live record and exact matrix](../evidence/phase-2-follow-up/live/README.md).

**PASS:** 13 CLI interruption boundaries for backup create/remote send/restore,
including repeated check and staging/destination/install-record boundaries;
two separate host-only interruptions.
[Backup record and exact matrix](../evidence/phase-2-follow-up/live-backup/README.md).

Matrices were source-enumerated and reviewed before injection. Unmodified pinned
binaries stop at actual source breakpoints, not sleep guesses. Fresh reads
precede recovery; installation/record uncertainty retains copies, and retirement
uses destination authority. A host death allows its original child to finish;
exit125 on broken stdout does not undo completed effects. Restart performs no
mutation replay. These PASS verdicts qualify expected fault/custody behavior;
they do not relabel interrupted mutations successful.

Restore after installation but before record publication retained a real
unrecorded file. Fresh inventory/hash matched the baseline backup, and explicit
recovery used a different Store name before fixture disposal. Missing records
were never treated as absent data. Original setup refusals, parse errors and
false harness exit0/count assumptions remain retained with source-backed
append-only corrections. No passing mutation campaign was repeated to hide them.
Unchanged Storage/adapter/bucket product files retain their original test identities.

## PostgreSQL integrity and presentation

**PASS:** owned PostgreSQL 17.11 / amcheck 1.4, required EXECUTE privileges and
superuser fixture. Connection: 5 pass, complete:true. Full integrity with
amcheck: **114 pass, 1 allowed skip, ok:true, complete:true**.
Deliberately no-amcheck full audit: **54 pass, 60 unknown, 1 skipped,
ok:true, complete:false**. These are separate real reports.
[PostgreSQL record](../evidence/phase-2-follow-up/postgresql/README.md).

The skip is `store.merge`: no persisted merge-working tables in the clean schema;
other sessions' private temporary tables are outside the audit's view. Native
DoctorPanel renders the actual retained complete and incomplete reports with
matching counts and dated scope. Connection success never substitutes for
integrity. The original historical incomplete report is untouched.

## Automated checks and limits

| Final check | Result | Receipt |
| --- | --- | --- |
| `node --test test/*.test.mjs` | 87 PASS | lead/final-fixed-root.json |
| `node --test host/test/*.test.js` | 352 PASS, 2 SKIP, 0 FAIL | lead/final-fixed-host.json |
| `pnpm --dir desktop -s typecheck` | PASS | lead/final-fixed-typecheck.json |
| Final desktop build/package | PASS | native-package/final-build.log and final-package-build.log |
| Focused mounted Stop/permissions | 28 PASS | lead/stop-output-regression-reviewed.json |
| Lead independent live/PG receipt validation | PASS | lead/independent-evidence-validation.json |

Receipt paths in this table are under `docs/evidence/phase-2-follow-up/`.
Source/docs/tooling/JSON whitespace and receipt-secret/link checks pass. Raw
LLDB/terminal `.log` files are force-included despite the generic ignore rule
and retain original whitespace byte-for-byte; the broad whitespace check reports
that data, while the scoped formatting check excludes only those raw logs.
[Exact final inspection](../evidence/phase-2-follow-up/lead/final-inspection-final.json).
Every
test invocation has an explicit wall timeout no greater than120s. Host skips:
`platform-real.test.js` is opt-in (actual native/package/live flows are separately
qualified), and historical scenario-port provenance needs the absent sibling
`dsh-layerfs/scenarios`. Neither is reported as a passing test.

## Cleanup, retained artifacts and deferred work

Live Docker/Lima and PostgreSQL/MinIO resources, temporary homes and uncertain
backup copies were reconciled and removed, with exact cleanup receipts in their
evidence directories. Initial automatic review rejection of a generic Docker
cleanup was resolved with source-derived home/container identity and fresh exact
mount ownership; no rejected action ran. Pinned CLI/daemon and sealed bundle stay
protected and warm. No new LayerFS Cargo cache was allocated or released.
The prior port1025 preview remains; only this task's browser tabs were closed.
Handoff host free space: 331.28GB; cleanup threshold recovery was not
required. Latest owned Docker guest observation was190.69GB before cleanup,
recorded separately from host headroom.

Pre-existing `.hallmark/`, `.pnpm-store/` and the owner handoff prompt remain
untracked and untouched. The checklist is updated as task-owned documentation.

Deferred: upstream Doctor progress/cancellation, push/PR/merge/publication,
Developer ID distribution signing, notarization and other platforms. The local
macOS app uses the existing packaging path's ad-hoc signature only. No Durable
Store execution or upstream production changes were authorized or performed.

## Production source comparison

Fix commit `da2986c`: **Production LOC: 57,832 -> 57,853 (delta +21)**.
Host10,735 ->10,746; desktop18,580 ->18,590; legacy/shared28,517 unchanged.
Scope: Connect host/current desktop/surviving legacy runtime, excluding tests,
docs, tooling, simulator/sample data and generated artifacts. The preserved
owner baseline is not attributed to this work.

Method: `python3 tools/connect-production-loc.py <first-parent> <exact-staged-tree>`
using pinned LayerFS `67310175ebba2b84efefb4df76f875a43487cf50:tools/production_loc.py`
JavaScript comment scanner. [Exact fix comparison and committed-tree confirmation](../evidence/phase-2-follow-up/lead/fix-commit-confirmation.json).
Verification-only delivery: **Production LOC: 57,853 -> 57,853 (delta +0)**;
its exact parent/staged-tree method is retained in the verification commit
message. This is source size, not performance.
