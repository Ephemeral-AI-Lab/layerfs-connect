# CLI integration: remaining verification and delivery checklist

Status: **BLOCKED**, follow-up executed 2026-11-09. Sections 1–4 were explicitly
authorized. All selected rows passed except accepting an owned directory whose
path contains spaces in the real native chooser. Cancellation passed.
See [follow-up record](phase-2-follow-up-record.md) for the exact blocker, local
fix commit, final tests, per-row evidence, cleanup and minimum next action.
The unchecked dialog acceptance is not a terminal PASS. Sections 5–6 stay deferred.

## Baseline and scope

Phase 2 is implemented and its assigned issues #145–#153 and parent #137 are
closed. Preserve their evidence and historical outcomes. Follow-up work does not
reopen those issues automatically.

Connect branch: `phase-2-cli-integration`. Implementation: `f058e71`;
verification: `a3f134f`; final closure receipts: `d25585d`.
The [phase-2 record](phase-2-record.md) contains the full hashes, binary checksums,
passing checks, retained failures and cleanup receipts.

LayerFS reference: `833d04cf44e8e747929d50ab1170a48260d9381c`, version 2.0.0,
`dirty:false`, features `machine,postgresql`. Any replacement binary must have
its own identity and discovery receipt; earlier evidence remains attached to its
original binary. Source takes precedence over this checklist.

Existing evidence covers web-preview interactions, automated host/renderer checks
and real CLI flows on native, Docker, Lima, PostgreSQL and MinIO. Remaining work
qualifies native application behavior, live failure recovery and additional
PostgreSQL audit coverage, then publishes if requested.

| Item | Current state | Prerequisite |
| --- | --- | --- |
| Native desktop verification | BLOCKED: spaced-directory acceptance only; other rows PASS | macOS input permission or one manual real chooser acceptance |
| Packaged application verification | PASS: local macOS arm64 app | No distribution authorization |
| Live transfer/move/backup failure matrix | PASS: real CLI/host faults, recovery and cleanup | Source-reviewed exact matrix in follow-up record |
| PostgreSQL integrity with amcheck | PASS: complete audit plus intentional incomplete rendering | Historical incomplete report preserved |
| Doctor progress/cancellation | Unsupported upstream | Separate LayerFS proposal and implemented contract |
| Push and PR | Local commits only | Explicit owner request to publish |

## 1. Native desktop verification

Goal: establish behavior that the browser preview and successful build cannot
prove. The 2026-11-09 assignment explicitly authorized Electron verification.
Outcome: **BLOCKED only for spaced-directory acceptance**; other rows PASS.

- [x] Record the exact Connect commit, OS/architecture, Node/Electron versions,
  CLI/daemon identities and explicit `LAYERFS_CONNECT_CLI` path.
- [x] Launch the current desktop app against an owned temporary Connect state
  and fresh LayerFS home. Confirm preload/IPC and discovery reach the pinned CLI.
- [x] Exercise window resize at 1280×820 and 900×600, scrolling, focus and native
  window controls. Inspect renderer and main-process errors.
- [ ] **BLOCKED:** accept an owned directory whose path contains spaces through
  the actual native chooser. Real Cocoa cancellation PASS (`null` through IPC);
  selection remains unverified because OS input automation is not trusted and
  bounded real panel actions did not produce acceptance. No secret was exposed.
  Enable Accessibility/Automation or perform this one chooser selection manually,
  then capture the exact returned path using fresh isolated test state.
- [x] Exercise one management read, Files/History query and explicit Doctor
  launch through the native application boundary.
- [x] Run mounted chat execution and Stop. Verify command cancellation, separate
  partial-Commit outcome, and retention of the Workspace and Sandbox. Stop must
  not unmount or close them.
- [x] Check app shutdown and restart with persisted completed and interrupted
  work. Confirm custody survives and mutations are not automatically replayed.
- [x] Close and remove owned real resources; retain screenshots, logs and exact
  steps. Report any behavior that could not be exercised as NOT_RUN.

Acceptance: requested native flows pass with no unexplained application errors;
resource cleanup and restart behavior have receipts. A build alone is insufficient.

## 2. Packaged application verification

Goal: establish that the selected distributable works outside the development
launcher. This is local packaging verification, not authorization to distribute.
Outcome: **PASS** for the scoped macOS arm64 local app, ad-hoc signed by the
existing packaging path; distribution signing/notarization and other platforms NOT_RUN.

- [x] Select the OS/architecture and unsigned or signed package scope. Record
  package hash, Connect commit and embedded or configured CLI/daemon identities.
- [x] Build using the existing packaging path; verify no linked Node addon or
  sibling source checkout is needed at runtime.
- [x] Install/open from a normal application location using disposable app state.
  Check CLI resolution without relying on shell PATH or developer environment.
- [x] Exercise startup, a management read, one mounted execution, Doctor, shutdown
  and relaunch. Check child-process/resource cleanup.
- [x] Verify the incompatible/missing-binary state and its actionable error.
- [x] Record signing/notarization and other-platform coverage separately as
  PASS, FAIL or NOT_RUN; do not infer them from a successful local package.

Acceptance: the selected artifact launches and completes the scoped flows with
the intended binary identity and no development-checkout dependency.

## 3. Live failure recovery matrix

Outcome: **PASS**: 28 transfer/move CLI phases, 12 host-only custody cases, two
explicit fresh-gated recoveries; backup/restore 13 CLI phases and two host-only
cases. Matrices, actual debugger boundaries and cleanup are retained.

Goal: supplement existing fake-child/host-restart tests with real remote state.
A killed CLI does not prove remote work stopped. Never repeat a mutation merely
because its reply was lost.

- [x] Review the pinned source and create an enumerated matrix before execution:
  operation, observed phase, interruption mechanism, expected custody/authority,
  fresh reads, allowed explicit recovery and cleanup owner.
- [x] Cover push and pull, including the pull-then-push cross-Machine move, on
  owned source/target Stores. Include destination install/record and source
  retirement boundaries where the operation exposes them.
- [x] Cover backup create and restore at their supported observable boundaries,
  including upload, verification and installation where applicable.
- [x] Distinguish interruption of the CLI from interruption of Connect. Inject
  only against owned processes, with retained phase and exit/signal evidence.
- [x] For each case, restart/reconcile Connect and inspect source, destination,
  operation and backup state using fresh reads before offering recovery.
- [x] Verify persisted phase history, uncertainty, authoritative location and
  recovery actions match the actual result. Neither kill nor timeout may produce
  a fabricated success, rollback or proof of remote cancellation.
- [x] Verify no automatic resend, retry, replay or deletion of uncertain copies.
  Exercise an explicit recovery action only after its fresh-read gate passes.
- [x] Retain all failures and unreachable phase boundaries. If a phase cannot be
  intercepted reliably, mark that row NOT_RUN rather than crediting a nearby kill.
- [x] Reconcile uncertain work before cleanup; close and remove only resources
  whose ownership and safe release are established.

Acceptance: every matrix row has an outcome and receipt. Only observed passing
rows are qualified; simulated tests and normal-path transfers do not fill gaps.
File a scoped LayerFS issue if a product contract prevents reliable recovery.

## 4. PostgreSQL integrity coverage

Outcome: **PASS**: full audit with amcheck114 pass/1 allowed skip and
complete:true; separate connection5 pass. Native DoctorPanel faithfully displays
complete and deliberately incomplete real reports; owned PostgreSQL fixture removed.

Historical result is valid but incomplete: `ok:true`, `complete:false`, with 54 pass,
60 unknown and 1 skipped when amcheck is unavailable. Connection success does not
establish full integrity.

- [x] Provision a fresh owned Disposable PostgreSQL Store and record PostgreSQL,
  extension, privileges, CLI and daemon identities. Do not alter a shared server.
- [x] Enable the extension/privileges required by the pinned Doctor contract in
  that fixture; keep credentials in inherited environment or owner-only files.
- [x] Run connection and full-integrity targets separately. Retain each report's
  findings, coverage, unknowns, skips, exit status and `complete` value.
- [x] Verify Connect renders complete coverage only when the returned report
  establishes it. Missing privileges/extensions must remain visibly incomplete.
- [x] Remove the owned fixture and record cleanup. Preserve the earlier incomplete
  report as historical evidence.

Acceptance: required checks execute and their results are represented accurately.
If full coverage remains unavailable, document the exact reason and remaining
unknown checks; do not relabel the audit complete.

## 5. Optional upstream Doctor enhancement

Progress and cancellation are currently unsupported. This is a separate product
decision, not unfinished Connect command wiring.

- [ ] Decide whether to request the capability upstream.
- [ ] If selected, write a LayerFS proposal defining progress events, final-result
  delivery, cancellation semantics, partial-report coverage and capability discovery.
- [ ] Implement and verify upstream before changing Connect. Pin the resulting
  build and add Connect behavior gated by actual discovery.
- [ ] Verify interrupted/cancelled audits never appear healthy or complete without
  supporting coverage. Preserve behavior for builds without the capability.

Acceptance: either explicitly defer the enhancement or qualify both upstream and
Connect behavior against an implemented contract. Do not add a cosmetic Stop button.

## 6. Publication

Push and PR remain unrequested. Existing GitHub issue closure does not mean the
local Connect implementation has been published or merged.

- [ ] Obtain an explicit request to push/create a PR, including target branch.
- [ ] Review the current diff and commit chain; preserve the owner-approved
  baseline and unrelated/untracked state. Report any intervening changes.
- [ ] Run checks affected by subsequent changes; reuse unchanged evidence with
  its original identity. Keep source-size comparisons in every new commit.
- [ ] Push only the intended branch and create a PR describing final behavior,
  exact evidence and remaining gaps. Do not imply the preserved baseline was
  authored as part of the CLI migration.
- [ ] Replace local-only references in the delivery record and issue comments
  with accessible commit/PR links. Record publication and merge separately.

Acceptance: the requested branch/PR is accessible and its evidence matches the
published tree. Publication does not silently mark unrun verification complete.

## Evidence and completion rules

Use fresh append-only receipts under a follow-up evidence directory. Each entry
records the checklist item, exact identities, command/interaction, expected and
observed behavior, PASS/FAIL/NOT_RUN, logs and cleanup outcome. Keep real CLI,
simulated preview and packaged-app evidence distinct. Redact secrets at capture.

Use Disposable Stores only, fresh owned homes, private build resources and explicit
binary paths. Never touch `~/.layerfs-connect` or another session's state. Bound
each test invocation at 120 seconds; retain timed-out failures. After renderer
changes, exercise the web preview first, check the console at both desktop sizes,
update its UI spec, and run desktop typecheck/build.

Complete each selected item with its own outcome; retain deferred items with a
reason. No requirement to reopen completed phase-2 issues, enable Durable Stores,
run unrelated benchmarks, or implement upstream features is created by this draft.
