# Agent prompt: finish Connect CLI verification through terminal PASS

## Assignment

Complete the remaining Connect CLI integration verification, fix defects you find,
and continue until the required work reaches terminal PASS. Use subagents to
accelerate independent verification and review. Do not stop after a plan, a first
passing command, a draft report, or a repair that has not been verified.

Repository: `~/Ephemeral-AI-Lab/layerfs-connect`.
Read `AGENTS.md`, `docs/specs/phase-2-record.md`,
`docs/specs/phase-2-remaining-checklist.md`, and the four integration designs:
`cli-integration.md`, `cli-ui-changes.md`, `connect-cli-obs-stat.md`, and
`doctor/connect-integration.md` under `docs/specs/`.

This prompt selects checklist sections 1–4: native desktop, local packaged app,
live failure recovery, and PostgreSQL integrity coverage. Executing this prompt
explicitly authorizes launching/testing Electron and an owned local packaged app.
Default package target: this machine's macOS architecture, unsigned local artifact;
signing, notarization and other platforms are outside this assignment.

Doctor progress/cancellation is deferred upstream. Do not implement it here.
Push, PR, merge and distribution remain unrequested. Keep commits local.

## Preserve the existing delivery

Phase 2 is implemented; #145–#153 and parent #137 are closed. Do not reopen them
or repeat completed campaigns merely because this is a new session.

- Branch: `phase-2-cli-integration`.
- Owner-approved baseline: `7c02313` (preserves substantial earlier owner work).
- Implementation: `f058e71126179bca62a584eb6fb2be1866037b94`.
- Verification: `a3f134f7db06dd43c5b27401851a59091b28964d`.
- Closure record: `d25585db1152bdcb58fda492b8b18c586325f1ac`.

Inspect the current branch, status and history before editing. Preserve intervening
changes. The checklist and this prompt may still be untracked drafts; they are
part of this handoff, not disposable files. `.hallmark/` and `.pnpm-store/` were
pre-existing untracked local state. Never stash, revert, reformat or commit unrelated
work. Continue on the phase branch if safe; use an isolated follow-up branch or
worktree when needed without rewriting the baseline or existing commits.

## Pin identities and protect resources

LayerFS authority is source at `origin/layerfs_v2_0_0`, minimum
`833d04cf44e8e747929d50ab1170a48260d9381c`. Read through `git show`; never switch
or edit another session's LayerFS checkout.

Existing owned build worktree: `~/Ephemeral-AI-Lab/layerfs-connect-cli-137`.
Explicit CLI: that worktree's `target/debug/layerfs`; paired daemon in the same
directory. Expected identity: version 2.0.0, commit `833d04cf44e8e747929d50ab1170a48260d9381c`,
dirty false, features machine/postgresql. Verify identity and checksums against
the record before reuse. Set `LAYERFS_CONNECT_CLI`; never resolve from PATH.

Use Node 24 (installed at `~/.nvm/versions/node/v24.21.0/bin`). Reuse registered
private build resources, sealed bundles and verification scripts where valid.
Any new LayerFS build must use its worktree launcher and private target; no
upstream production changes are authorized by this verification assignment.

Check disk space at start, before large builds/fixtures, after batches and at
handoff; follow this machine's cleanup rules. Protect pinned binaries, evidence,
active resources and other sessions. Use only Disposable Stores and fresh owned
homes, containers, VMs, mounts and app state. Never use `~/.layerfs-connect`.
Determine actual app-state overrides from source before launching native code;
if isolation cannot be established, resolve that before launch.

Secrets must remain inherited env references or owner-only files, never argv,
captured logs or UI errors. No automatic replay of mutations.

## Execute in parallel, review independently

Assign separate owned fixtures and evidence directories to subagents. A useful
split is desktop/package verification, live failure recovery, and PostgreSQL
coverage. Keep shared source edits coordinated with one owner per file.
Have a different agent review each consequential fix and the final evidence.
The lead integrates and verifies the final tree; subagent success alone does not
establish completion.

### A. Native and packaged application

Follow checklist sections 1–2. Reuse the web preview on port 1025 if it belongs
to this checkout; do not kill another session's process. Renderer fixes go through
the actual web preview first at 1280×820 and 900×600, with console inspection.

Then verify real Electron preload/IPC, native window behavior and dialogs,
management reads, pinned Files/History, explicit Doctor launch, mounted execution,
shutdown and restart. Stop must cancel the command and retain its Workspace and
Sandbox; partial Commit failures must remain separate from cancellation status.
Do not spend API credits merely to exercise a native execution boundary; use a
model-free existing path or a scoped test driver invoking the real host route.
Label any simulated backend and qualify the real CLI boundary separately.

Build and launch a local package outside the development checkout, without a linked
Node addon or shell PATH dependency. Verify binary resolution, startup, execution,
Doctor, relaunch and missing/incompatible-binary handling. Do not overwrite an
existing installed application. Use a uniquely named owned installation location.

### B. Real failure recovery

Follow checklist section 3. Before injecting failures, inspect the pinned source
and enumerate every supported phase for push, pull, cross-Machine move, backup
create and restore. Record the matrix and expected authority/custody for review.
Use real owned remote resources, not the simulator, to qualify these rows.

Interrupt the owned CLI at observable phase boundaries and exercise Connect-host
interruption/restart separately. Capture evidence of the actual reached phase;
sleep-based guesses do not qualify a boundary. Do not add product-only failure
hooks or change the binary invisibly to make interception convenient.

After each interruption, reconcile with fresh reads before any explicit recovery.
Assert no automatic mutation replay, no guessed authority, and no deletion of
uncertain copies. A killed child does not prove remote work stopped. Retain
initial failures and fix Connect defects with focused regression coverage.
If exact boundaries cannot be exercised, investigate a deterministic supported
method; do not replace the missing row with a nearby successful interruption.

### C. PostgreSQL full integrity

Follow checklist section 4. Provision a disposable owned PostgreSQL fixture with
the extension and privileges required by the pinned Doctor contract, including
amcheck where required. Verify connection and full-integrity reports separately,
then verify Connect renders the actual coverage faithfully.

Preserve the existing no-amcheck report (54 pass, 60 unknown, 1 skipped,
`ok:true`, `complete:false`) as historical evidence. Do not mark it complete.
If a clean supported fixture still cannot achieve full coverage, identify the
exact source-backed blocker rather than weakening the audit or its assertions.

## Fix, verify, commit

Diagnose from source and retained receipts before changing code. Fix Connect
defects within this scope; do not work around upstream failures by inventing
commands, changing persistence policy or fabricating fields. Report any upstream
defect precisely and preserve a minimal reproducer. Do not send external messages
or create new issues unless separately authorized.

Give each test invocation an explicit wall timeout of at most 120 seconds. A
timeout is a failure to diagnose, not permission to background or repeat it.
Run focused checks after each fix, then the relevant final covering checks:

- `node --test test/*.test.mjs`
- Host tests under `host/test/` using the repository's current invocation; split
  by meaningful files if necessary to keep every invocation within 120 seconds.
- `pnpm --dir desktop -s typecheck`
- `pnpm --dir desktop -s build`
- Actual changed native/package/live flows, plus whitespace and secret checks.

Reuse unchanged prior evidence with its original identity; rerun affected flows
against the final product tree. Do not loop unchanged passing suites. Update
matching `docs/ui/` specs and integration designs for behavior changes.

Keep new append-only receipts under `docs/evidence/phase-2-follow-up/`. Record
source/binary/package identities, exact commands, phase observations, expected
and actual results, exit/signals, cleanup and PASS/FAIL/NOT_RUN per matrix row.
Keep native real CLI, simulated preview and package evidence distinct.

Make local commits for coherent fixes and verification records. Every commit
must contain a reproducible production LOC before/after/signed delta for its
exact parent and staged tree; reuse `tools/connect-production-loc.py` and its
pinned counter. Include `Assisted-by: Cindy (https://cindy.app)`. Never count
tests/docs/tooling as product source or attribute the preserved baseline to this work.

## Terminal condition

Terminal PASS requires all of the following:

1. Native desktop and the scoped local package complete their acceptance flows.
2. Every selected live failure-matrix row is exercised with matching phase,
   custody, fresh-read recovery and no-replay evidence.
3. PostgreSQL's required full-integrity checks execute successfully, and Connect
   correctly presents both complete and deliberately incomplete coverage.
4. Discovered Connect defects are fixed, independently reviewed and verified on
   the final tree; applicable automated checks pass with every skip explained.
5. Owned resources are safely reconciled and cleaned, receipts and checklist are
   updated, and the completed work is committed locally.

Do not call FAIL, BLOCKED, unknown coverage or NOT_RUN a terminal PASS. Continue
through resolvable problems without repeatedly asking the owner to confirm routine
work. If an external prerequisite, inaccessible native control or upstream contract
truly prevents completion, finish all independent work and deliver an explicit
BLOCKED result with evidence, precise remaining rows and the minimum next action.
Do not silently defer a required row to manufacture a green result.

Final handoff: state PASS or BLOCKED, local commit hashes, exercised native/package/
live flows, test outcomes, cleanup receipts and remaining limitations. Link the
updated checklist and a new `docs/specs/phase-2-follow-up-record.md`. Keep optional
Doctor enhancement, publication, signing and other-platform work explicitly deferred.
