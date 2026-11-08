# PostgreSQL full-integrity follow-up

Qualification: **PASS for the real CLI and Connect Doctor manager**. Actual renderer presentation is recorded separately by the native/package verification owner. This directory does not substitute report assertions for native UI evidence.

- Source and paired CLI/daemon: clean `833d04cf44e8e747929d50ab1170a48260d9381c`, version 2.0.0, features `machine,postgresql`; both SHA-256 values match `phase-2-record.md` and are retained in `qualification.json`.
- Node: v24.21.0. Connect source at execution: `d25585db1152bdcb58fda492b8b18c586325f1ac`, branch `phase-2-cli-integration` (no product change).
- Fresh owned Docker PostgreSQL 17.11 Debian aarch64 fixture; immutable image ID and container ID in `qualification.json`. Password was generated in-process, inherited by PostgreSQL and referenced by CLI as `env:CONNECT_PROOF_PG_PASSWORD`; it never appears in argv, this directory, or the logs.
- `store connect pg-proof postgresql://proof@127.0.0.1:<owned-port>/proof --password env:CONNECT_PROOF_PG_PASSWORD --synchronous-commit off`. Fresh native home; no use of `~/.layerfs-connect`. Fresh one-file project `pg-proof/p` initialized through the real pinned CLI. Only Disposable execution.
- Required PostgreSQL fixture setup: `CREATE EXTENSION amcheck`. The fixture's `proof` role is its owned superuser. `has_function_privilege(...,'EXECUTE')` is true for supported `verify_heapam` and `bt_index_check` signatures; exact extension/function output is retained. amcheck version 1.4.

| Actual request | Result | Coverage |
| --- | --- | --- |
| `doctor store connection pg-proof --timeout 20s` | `ok:true`, `complete:true` | 5 pass |
| `doctor store integrity pg-proof --timeout 20s`, before extension | `ok:true`, `complete:false` | 54 pass, 60 unknown, 1 skipped |
| Same full-integrity request, after extension | `ok:true`, `complete:true` | 114 pass, 1 skipped; zero failed/blocked/unknown |

These are three distinct real `DoctorManager.launch` calls through the normal CLI adapter and discovery. They are preserved as `connection-job.json`, `incomplete-job.json`, and `complete-job.json`, including immutable report scope, request, mode, binary provenance, outcome counts and every retained check. `connection` is never presented as full-integrity proof. Historical phase-2 incomplete reports are untouched.

The allowed skip is `store.merge`: “no persisted merge-working tables in this Store schema; another PostgreSQL session's private temporary tables are outside this Store view.” This clean fixture contains no persisted merge state. The full audit itself establishes `complete:true` despite that nonapplicable check; Connect does not override it.

Pinned source authority was read with `git show origin/layerfs_v2_0_0:docs/architecture/engine/store/postgresql-diagnostics.md`, the corresponding `postgresql_doctor_physical.rs` tests, and the actual Doctor target. Full mode performs separately identified online physical checks: heap/TOAST `verify_heapam(skip=none)`, and valid B-tree `bt_index_check(heapallindexed=true)`. Doctor installs no extension. Missing extensions cause unknown coverage, exactly as the no-extension report demonstrates.

## Retained harness failure and corrected validation

`initial-harness.mjs` is the exact initial proof driver. Its 120-second explicit wall deadline bounds the full invocation; individual CLI calls have a 20-second limit and service probes a 15-second limit. All three reports completed successfully and the container was removed. A post-result harness assertion failed because it expected `counts.unknown === 0`; the report contract uses sparse counts and omits outcomes with zero occurrences. `qualification.json` therefore deliberately retains **FAIL** and its original message. This is not a PostgreSQL audit failure and is not relabelled PASS.

`tools/verification/postgresql-follow-up-validate.mjs` corrects that assertion with exact sparse counts and also validates the actual report check rows, scope, explicit simulated:false, identities, cleanup and SHA-256. Command, using Node 24:

```sh
node tools/verification/postgresql-follow-up-validate.mjs
```

The validator has an explicit 120-second wall limit. `validation.json` is the append-only corrected validation receipt. No successful audit was rerun to hide the harness error or resample a passing result. The second validator invocation corrected repository-relative path handling only; no product, fixture, or report was altered.

## Cleanup and retained custody

The exact owned container `949abba0f42e557d97f2b0583e3fccb4ad0f9a5347ba0137826b329ef327280e` was removed with `docker rm -f` after all reports, with success recorded in `qualification.json`. No host ports, PostgreSQL processes, or Docker volumes remain from it. Container filesystem storage was ephemeral.

The fresh `/private/tmp/connect-follow-up-pg-djQKPP` home and Doctor state remain temporarily owned evidence resources for the native verification owner to inspect the saved real reports. They contain the environment reference, no credential value. Final release/removal is recorded in `cleanup.json`; do not infer that it happened until that receipt exists. The one-file input and isolated state have no shared ownership or recoverable remote mutation.

## Final native presentation and release

Native `DoctorPanel` verification is PASS: `../native-package/pg-ui-probe2.json` and `pg-ui-report-0.png` / `pg-ui-report-1.png` present the actual retained real reports. Independent review confirmed full `114 pass / 1 skipped` displays complete, and `54 pass / 60 unknown / 1 skipped` displays incomplete with no full-health claim. No new diagnosis was launched. Current unavailable connection after fixture removal remains separate from dated coverage. `cleanup.json` confirms removal of the original owned home/state after native owner release.
