# Real backup failure recovery

**PASS** for 13 real CLI-kill phase-boundary rows and two distinct real Connect-host SIGKILL rows. No simulator, product failure hook, binary modification, or guessed sleep boundary was used. Peer review: live-recovery owner reviewed source frames, outcomes, and the installed-unrecorded restore case; final custody receipt addresses that finding.

Source/CLI/daemon remain clean `833d04cf44e8e747929d50ab1170a48260d9381c`, identical to the PostgreSQL qualification checksums. Node24 drives actual production `Storage` + discovery-backed CLI client. An owned ephemeral MinIO container serves a fresh versioned bucket. Initial Store uses explicit Disposable. Credentials are generated in-process and inherited using `env:LAYERFS_BUCKET_FOLLOWUP`; secret values never enter argv or retained receipts. Matching sealed Linux bundle is explicitly selected for the one owned worker Store.

`matrix.json` was written before the first real injection. Independent source review established authority and custody before injection. Each CLI child is SIGSTOPped immediately by the real host client's `on_spawn` callback. External LLDB attaches, resolves an exact pinned source breakpoint, continues to it, emits a stack, and `process kill`s the child. Breakpoint logs identify the exact file/line and actual source frame; phase history alone is insufficient because bucket progress is buffered. Each individual invocation has an explicit 115-second internal/120-second outer wall limit. Debugger startup readiness is not replay.

| Row | Exact pre-work/transition boundary | Result |
| --- | --- | --- |
| create-check-1 | Store create.rs:83 | PASS |
| create-snapshot | Store create.rs:93 | PASS |
| create-check-2 | Store create.rs:134 | PASS |
| create-hash | bucket pieces.rs:162 | PASS |
| create-upload | bucket pieces.rs:168 | PASS |
| create-send-enter | remote Store create.rs:107 | PASS |
| create-send-complete | remote Store create.rs:110, bytes copied | PASS |
| restore-check | Store restore.rs:79 | PASS |
| restore-download | bucket pieces.rs:222 | PASS |
| restore-verify | bucket restore.rs:240 | PASS |
| restore-install-staging | bucket restore.rs:258 | PASS |
| restore-install-store | Store restore.rs:105 | PASS |
| restore-install-record | Store restore.rs:119 | PASS |
| host-create-upload | pieces.rs:168; SIGKILL host only, continue CLI | PASS |
| host-restore-install | Store restore.rs:118; SIGKILL host only, continue CLI | PASS |

Each row owns a distinct Connect state/job and retained `<row>.json` plus `<row>.lldb.log`. CLI-killed jobs remain **unknown**, with exact SIGKILL evidence; fresh `backup list` and `store get` precede inspection/restart. Constructor reconciliation never replays a mutation (`starts:1`). Native internal hash/upload/download/verify phase frames may leave persisted UI phase `check`: this is the actual last emitted progress, preserved honestly while the debugger provides stronger boundary evidence. Repeated check phases are preserved.

The two host-only cases kill the actual process owning `Storage` while its job is persisted running. LLDB then continues the child, which exits125 when writing to the now-closed host pipe. **Effects survive**: fresh reads show the new backup `host-create-upload` and restored native Store `restore-host-restore-install`. Restart marks the job **interrupted**, preserves custody, and performs zero mutation replays. A host death does not imply child/remote cancellation or rollback.

Restore line119 is intentionally after `hard_link` and before `record.write`. `store get` says NotFound while an installed `store.sqlite` physically exists. `custody-recovery-cleanup.json` contains fresh filesystem inventory, an explicit unrecorded-file observation and its SHA-256 matching the original baseline backup. No missing record was used as proof of absent data. Original remote backup remains intact. One explicit recovery restores the baseline into a **distinct new Store name** after fresh list/inventory, then verifies full project statistics. The interrupted destination is never automatically replayed or overwritten.

Create leaves the authoritative source Store in place at every tested boundary. Pre-upload interruption leaves no backup object; host-only continuation can create one, so fresh listing is required. Remote snapshot/send uses a separately owned `backup-send` Store in the live-recovery agent's explicitly shared owned Docker fixture; only that Store and its bucket alias were removed, recorded in `shared-cleanup.json`, before its owner stopped the Machine.

`harness-failures.json` retains two parse-only driver defects, one before any mutation and one before reconciliation of the already completed host interruption. Both were corrected without replaying product work. Archived drivers preserve the actual invocation logic. Absolute fixture paths are deliberate run identities, not defaults for ordinary application use. No Connect defect or upstream failure was found in these rows.

Final cleanup: `custody-recovery-cleanup.json` records fresh inventory, explicit recovery, exact MinIO container removal and deletion of the entire owned fixture/home, including inherited credential file. All owned CLI/debugger exits were observed first. Destruction is an explicit disposal of the reconciled owned test fixture, not inferred rollback. Historical phase-2 receipts are untouched.
