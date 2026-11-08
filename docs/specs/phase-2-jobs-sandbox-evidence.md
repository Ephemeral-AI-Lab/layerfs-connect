# Phase 2: Jobs and Sandbox evidence (#146 / #147)

Source contract: LayerFS 833d04cf44e8e747929d50ab1170a48260d9381c.
This receipt records simulated host/browser evidence; real CLI verification is recorded
separately in the phase-2 record. None of the fixtures below proves remote transfer failure handling.

## Checks

- `host/test/jobs-reconcile.test.js`: atomic persisted jobs; restart marks interrupted;
  idle certain failure versus interrupted; exact unresolved op identity and running target.
- `host/test/move-phases.test.js`: seven phases times Failed/Unknown, retained authority wording.
- `test/job-progress-cli.test.mjs`: actual desktop model; repeated phases, unknown phase,
  indeterminate totals, interrupted/unknown labels.
- `host/test/jobs-child-faults.test.js`: SIMULATED actual subprocess SIGTERM during send/install;
  no final result remains unknown until a fresh observation; idle send becomes Interrupted,
  unresolved install remains Unknown. Actual Storage manager process SIGKILL/restart retains PID,
  performs one reconciliation read and zero mutation replays. Doctor SIGTERM gives Interrupted
  without report and no replay; framed exec SIGTERM requires final frame and process exit.
- `host/test/sim.test.js`: structured unresolved Sandbox observation retains uncertain op;
  simulator survives restart while preserving uncertain custody.
- `host/test/layerfs2.test.js`: recorded Sandbox lists perform no daemon reads; detail
  preserves actual state, down reason, runtime ID, created, base/base Layer, dirty counts,
  pending merge and Uncertain activity.

Each test invocation used Node 24.21.0 and an explicit 120-second wall timeout.

## Actual web preview interactions (simulation)

Used the existing preview on port 1025, no Electron. Tested 1280x820 and 900x600.

- Add project rejects Uppercase (Create disabled); lowercase `phase2-jobs` creates one project.
- A single API-injected fake push of `shop` to `docker` yields InUse. The rendered card
  offers Inspect current state and no retry. Clicking Inspect makes a fresh read; state
  `in_use` retains no recovery action. No second mutation was issued.
- Open Sandbox `api-dev`: Sandbox ID and Created display; open Workspaces and feature-login:
  base Commit, Layer, current branch head, clean counts, head movement and pending merge display.
- Controlled edits only to this preview's temporary `api-dev` record exercise Uncertain,
  two changed inodes / three entries, head moved and pending merge. The operation header
  preserves name/phase/uncertain. Both viewport widths have no horizontal overflow.
- Unreached fixture displays the down reason and unknown Workspace count, never zero.
  Gone displays No runtime recorded and never This sandbox is closed. Lost retains Lost.
- Restored the exact original api-dev record after each fixture episode. Created projects
  and job records remain only in the preview's disposable temporary state.

Browser checks initially observed in-flight compilation errors and old host endpoint SSE
failures while the owned preview restarted. A full page reload with a changed query loaded
the new endpoint. A fresh final tab loaded the restored Sandbox through the latest host; browser console error messages were empty.

## Limits

Real live CLI fault injection at every transfer phase remains NOT_RUN (known upstream gap).
These fixtures do not prove Linux/Docker/Lima transport failure cleanup. Browser simulation
cannot prove native cancellation, remote command termination or PostgreSQL/S3 reachability.
