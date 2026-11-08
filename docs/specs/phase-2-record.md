# Phase 2 CLI integration record

Status: implementation and covering checks PASS on `phase-2-cli-integration` (2026-11-09).
No push or pull request was requested. Electron was not launched.

Owner-approved baseline: `7c02313` preserves 242 existing changed/new files without
rewriting them. `.pnpm-store/` and `.hallmark/` remain untracked local state.

## Binary identity

LayerFS source: `833d04cf44e8e747929d50ab1170a48260d9381c` (PR #631 merge).
`--version --json`: version 2.0.0, dirty false, features machine/postgresql.
Discovery: 66 calls, 11 outside-table commands. Explicit `LAYERFS_CONNECT_CLI`:
`/Users/yifanxu/Ephemeral-AI-Lab/layerfs-connect-cli-137/target/debug/layerfs`.

CLI SHA-256: `7d7a5b507eeb2abc914a0e151c63eb12bd49bcbb69a06083d08f0b4430a3619c`.
Daemon SHA-256: `664c991face739375b9c147c757575d4f12edbf84f64773eedd5a08c789d10c2`.
Private Cargo registration: `layerfs-connect-cli-137-d7e0e8c2472a`.
Linux paired bundle and deployment resources were built from the same pinned source.
The original LayerFS checkout was neither switched nor edited.

## Slices

| Issue | Implemented behavior | Covering evidence |
| --- | --- | --- |
| #145 | Shared explicit-binary CLI adapter, discovery gate, exact i64, one-attempt outcomes, fake CLI, management stale/error states | cli-adapter/progress tests; real native reads; Machines browser |
| #146 | Persisted jobs, observed/repeated phases, phase-aware transfer authority and explicit fresh-read recovery | jobs-reconcile/move-phases/jobs-child-faults tests; real Docker transfer/MinIO; jobs UI |
| #147 | Sandbox/Workspace fields preserved, unknown counts, list-only polling and force-close gates | Sandbox fixtures at both sizes; layerfs2/sim tests; jobs-sandbox evidence |
| #148 | Framed mounted exec, fresh persisted IDs, Stop retains mount, uncertain execution custody and separate Commit errors | exec-cancel/lifecycle tests; native cancellation and large output receipts |
| #149 | Full-id pinned Files/History, main Layers, commit diff cursor, lightweight Branch reads | history/project-reads tests; real native saved-read receipt |
| #150 | Real Code/Revisions/Blame/Compare/Attribution and continuation pages; unknown origins remain unknown | project-reads/saved-query-model tests; real diff/continuation; browser |
| #151 | Shared bounded persisted Doctor manager/panel with contextual actions and report coverage | Doctor/fault tests; real native/Docker/VM/PG/MinIO Doctor; browser |
| #152 | Store counters and pinned project entry/logical statistics; full exec frames | exact-count tests; native/PG/restore stats; browser |
| #153 | Pinned build, no Node package link, combined verification and retained receipts | Final checks below |

## Real CLI evidence

Receipts under `docs/evidence/phase-2/` are real native CLI execution unless a
file explicitly labels itself simulated. Owned homes, mounts, Sandboxes, service
containers and the fresh Lima VM were closed/removed after their proofs.

- `exec-native-second.json`: preregistration ended/cancel mark, running SIGTERM,
  command exit 125 preserved as command status, partial Commit and 1,048,587 bytes.
- `reads-native.json` and `reads-native-1794174915488.json`: native Init, saved full
  pins, file diff/blame/revision, immutable continuation for revisions/comparison,
  main Layers, Layer changed paths, Store/project statistics and full integrity.
- `services-native-third.json`: PostgreSQL connect/Init/stats/connection/integrity;
  MinIO observation/write-test/backup/list/restore and restored statistics.
- `docker-native-second.json`: real Docker start/push/mount/exec/Commit/Doctor,
  unmount/close/pull/stop and removal of owned home.
- `vm-setup.json`, `vm-flow.json`, `vm-cleanup.json`: a fresh owned Lima VM,
  mounted execution/Commit/Doctor and exact cleanup.

Earlier `exec-native.json`, `services-native.json`, `services-native-second.json`,
`docker-native.json` and `reads-native-1794174828062.json` retain failed setup/test
assumptions and the adapter Bool-syntax failure. They are not relabelled PASS.
The Bool defect was fixed using inline true/false and covered by real diff proof.

## Simulated preview and fault evidence

`docs/specs/phase-2-jobs-sandbox-evidence.md` describes explicit browser scenarios
and their limits. Preview uses the actual adapter/fake CLI at port 1025 with owned
temporary state, not a duplicate UI. Files/History, statistics, Sandbox clean/
dirty/pending-merge/uncertain/unreached/gone/lost, machine power and shared Doctor
were exercised at 1280×820 and 900×600. No removed tabs/placeholders were restored.

`jobs-child-faults.test.js` sends real signals to fake CLI children and SIGKILLs
an owned test host, then restarts managers to prove custody and no replay. This
is SIMULATED product state; it is not live remote transfer/backup failure proof.

## Final checks and limits

- Host: 352 tests, 349 PASS, 3 SKIP, 0 FAIL (61.23 s).
- Native daemon recording test with explicit pinned CLI: 1 PASS (fresh owned home).
- Root: 84 PASS, 0 FAIL (1.09 s).
- `pnpm --dir desktop -s typecheck`: PASS.
- `pnpm --dir desktop -s build`: PASS, including main/preload/renderer; no Electron launch.
- `node tools/sim-table.mjs` with the pinned CLI: PASS, 66 calls.
- `git diff --check`: PASS.
- Commands each had an explicit wall timeout of at most 120 s.
- Logs and exact invocations: `docs/evidence/phase-2/final-*`.
- `agent-workspaces-native.json`: actual AgentWorkspaces through the dynamic CLI
  client, exit 125/output/cancel/partial Commit/mount retention/explicit cleanup PASS.

Independent reviews found and fixed cancellation starvation, stopped queued launches,
unknown execution custody, missing-origin Branch invention, Bool option encoding and
simulator force-close semantics. Deleted obsolete test: `native-daemon.test.js` “closeStores drops the leases of
Stores this process holds open,” which drove the removed long-lived Node client.
The native CLI proofs instead create/read/remove the Store across independent
processes and confirm cleanup. Other surviving tests were updated for the current
CLI contract and owner-selected Stop behavior.

- PostgreSQL full integrity: produced ok:true, complete:false when amcheck is
  unavailable (54 pass, 60 unknown, 1 skipped). Connection success is not full
  integrity; Connect retains the missing coverage.
- NOT_RUN: Electron/native window interactions and packaged-app launch; owner did
  not request them. Renderer/main/preload builds do not establish those behaviors.
- NOT_RUN: live CLI kill injection at every remote transfer/move/backup phase.
  Scoped fake-child/host-restart tests establish Connect recovery/no replay;
  they do not establish every remote failure phase. Upstream phase-1 gap remains.
- Doctor progress/cancellation remains unsupported. The UI has neither Stop nor
  fabricated progress. Blame comparison_coarse remains data, with unknown origins.
- No Durable Store execution. Retained Durable API is not exercised.
- No dependency added, no LayerFS source changed, no push/PR created.


## Resource handoff

The native target remains warm and pinned because Connect uses its CLI and daemon.
Sealed native/Linux artifacts and all evidence remain protected. Exact idle Linux
Cargo/target volume releases are exported to
`docs/evidence/phase-2/build-cache-release.json` (also
`/private/tmp/connect137-release-selection.json`); neither target containing pinned
binaries nor another session's resources is released. No cleanup was required at
host free space above 300 GB; Docker guest free space also remained above 180 GB.
The owned simulated web preview remains available on port 1025 for review.


## Production source comparison

Implementation comparison: 57,184 → 57,832 (delta +648).
Scope: Connect host + current desktop + surviving legacy runtime sources,
excluding tests/tooling/docs/simulator/sample data. Subtotals: host 10,169 →
10,735; desktop 18,517 → 18,580; legacy/shared 28,498 → 28,517.
Method: `tools/connect-production-loc.py` applies the same pinned LayerFS
`67310175ebba2b84efefb4df76f875a43487cf50:tools/production_loc.py` JavaScript
comment scanner to both exact Git trees. This is source size, not performance.
The final verification/documentation commit has unchanged product LOC.
