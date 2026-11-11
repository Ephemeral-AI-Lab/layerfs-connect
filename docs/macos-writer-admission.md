# Native concurrent project fix — 2026-11-10

The real eight-way Studio workload exposed native macOS contention between two
projects in one SQLite store. Retained failures include `Busy`, `Failed: Store
open: Store busy before effect`, and `Unknown: Service(History(Busy))`.

## Cause and implementation

The pinned LayerFS runtime's Persistence `Writer::acquire` used a cooperative
parent-directory `flock` on Linux, but returned an empty hold on macOS. Separate
native CLI processes therefore reached SQLite writes without the cross-process
admission used by Docker and Lima. SQLite still correctly retained its required
zero busy timeout, so colliding requests surfaced failures.

The isolated worktree is
`/Users/yifanxu/Ephemeral-AI-Lab/layerfs-macos-writer-admission`, branch
`fix/macos-writer-admission`, based on `1edcf58caec2bf079a07891411a0151c9afa3e80`
plus a private snapshot of the integration runtime's working changes. The other
session's checkout was not edited. The focused change enables the existing
Linux directory-lock acquisition, try-acquisition and release on macOS too.
No SQLite descriptor is opened for advisory locking. Short write transactions
and the existing publication lane take their turn before the first SQL attempt;
file construction, reads, different stores and project scripts remain concurrent.
There is no CLI retry, SQL busy handler or per-project serialization.

The focused, reviewable [patch](evidence/preset-controls/macos-writer-admission.patch)
contains only the admission implementation, portability tests and architecture
updates. It is not committed or merged upstream. The previously observed
failures remain unchanged in their original evidence files.

## Initial fix verification — historical diagnostic sample

The newly macOS-enabled cross-process regression failed before the product
change: a reservation succeeded while another process held the cooperative
writer owner. After the change, all eight `writer_admission` tests passed.
Both `sqlite_lock_custody` tests also passed: main-file locks stay held, a raw
SQLite writer still causes exactly one attempted BEGIN returning Busy, and no
write transaction, commit or rollback is attributed to that refused attempt.
All tests selected Disposable explicitly. The test harness additionally clears
the inherited nonblocking flag on Darwin's accepted Unix socket.

The private real run used the same fixed native CLI in both arms, freshly
recreated stores/projects and the same four final machines. Both arms completed
full project content/history verification. The concurrent activity trace has
280 successful history invocations, 176 file writes, 16 merges, 32 publications,
exactly eight overlapping child-process lifetimes and captured inputs/outputs.
There were no mutation retries and no sandboxes or mounted workspaces.

| Project-history phase | Elapsed |
| --- | ---: |
| Sequential, one project at a time | 10.376 s |
| Eight concurrent projects, two per machine/store | 1.865 s |
| Ratio | 5.5635× |
| Time reduction | 82.03% |

These are one diagnostic sample per arm with uncontrolled caches, not cold-cache
or general throughput qualification. Timing excludes machine provisioning,
source imports, placement, verification and cleanup. Total operation times are
not comparable: the sequential arm provisions cold machines while reset retains
them. All eight projects completed 35 history steps. Cleanup independently
verified removal of all four private stores and both custom Lima machines.

[Live evidence](evidence/preset-controls/project-library-macos-writer-fix-live.json)
contains results, task status, timings, activity and cleanup receipts.
The sealed native build receipt is
`/Users/yifanxu/.cache/layerfs-worktrees/layerfs-macos-writer-adm-905cf46b6910/artifacts/build-macos-02b03f77bf59405c827fc095bc618eb4/manifest.json`.
Source digest: `56b2276e7fa49c2640311e7f54a4cf3fc6bb846ee799dab1a9592c9cc0b52163`.
The Linux bundle is unchanged because its admission path already uses this lock.

At that checkpoint, the local preview's CLI and daemon pins in
`desktop/.env.local` selected that sealed pair. The preview host reported the
fixed CLI, Presets rendered, Studio was active, and existing user Studio contents
were retained. No Electron app was launched; native desktop lifecycle and
packaged distribution were not verified. The sample above predates the denser
recipe and the lifecycle follow-up below; its 5.5635× ratio is not a timing claim
for the dense workload.

## Lifecycle follow-up — 2026-11-10

The first dense eight-tier attempt, using the initial fix's sealed runtime,
failed on a Native website write in the first dense release cycle with
`Failed: Store open: Store busy before effect`. The transaction lane alone did
not cover SQLite connection startup and last-close WAL work. The original
[failed attempt and verified cleanup](evidence/preset-controls/dense-eight-tier-open-busy-diagnostic.json)
remain retained; no mutation was retried to turn that result into success.

`Session::connect_mode` opened SQLite and applied/read back the profile before
ordinary transaction admission. Starting the Disposable background checkpoint
connection also performed SQL there. At the other end, the main connection's
ordinary destructor could checkpoint or remove WAL/SHM state outside that lane.
The observed error establishes a failure during Store open; it does not identify
a particular failing PRAGMA or prove which peer's lifecycle work caused it.

The follow-up uses the same existing parent-directory owner around connection
initialization, including read-only/diagnostic profile checks and background
connection startup. It releases that owner before ordinary Session operations.
The last main connection now closes under a retained or newly acquired owner;
checked seal keeps its explicit close and error handling. This does not hold a
lock across an entire CLI command, serialize project scripts, add a busy handler
or replay SQL.

Shutdown ordering matters: the background connection closes while the main
connection is still alive, so it is not the last connection. It therefore does
not reacquire the directory owner when its thread is joined. A quarantined
State may already retain that owner; reacquiring it from the background thread
would deadlock. Main close reuses an existing retained owner instead of waiting
for it again. If a destructor's single admission wait is interrupted or fails,
it retains the connection until process exit rather than attempting unadmitted
teardown or retrying. That destructor failure path has no returned result.

The separate [lifecycle patch](evidence/preset-controls/macos-store-lifecycle-admission.patch)
applies after the historical first patch. It contains the connection custody,
initialization/close/seal changes, two regression tests and architecture update.
The first patch remains unchanged; neither patch is committed or merged upstream.

### Native regression proof

Two deterministic tests hold the actual cooperative directory owner in another
process, then attempt a read-only open or ordinary last close. Both failed before
the lifecycle change because initialization/close completed before that owner
was released. The existing single-BEGIN transaction test passed in that same
red run. After the change, all three passed.

The broader native check passed **20 tests** within its explicit 25-second
execution budget:

- 10 `writer_admission` tests, including the two new lifecycle tests;
- 2 `sqlite_lock_custody` tests preserving raw SQLite `Busy` and lock custody;
- 3 `idle_checkpoint` tests, including a racing opener/checkpoint;
- 5 `seal_allocation` tests preserving checked seal and refusal behavior.

The four targets reported about 6.72 seconds of test execution, excluding
compilation. Disposable was selected explicitly. This is functional regression
proof, not a new workload latency measurement. Retained-writer quarantine
shutdown is supported by source custody/order review; these public tests do not
inject that private State directly.

Native launcher receipts:

- Red: `builds/cargo-macos-7b80299b14c44916bf9b29b3494709e8/output.log`.
- Focused green: `builds/cargo-macos-9025b83033e44b5d93ce96e84e74f4f3/output.log`.
- Broader 20-test green: `builds/cargo-macos-c33c134f122048ed9f74671c0b41916e/output.log`.

These paths are beneath
`/Users/yifanxu/.cache/layerfs-worktrees/layerfs-macos-writer-adm-905cf46b6910/`.

### Sealed follow-up runtime and dense-run scope

The paired macOS build is sealed at
`/Users/yifanxu/.cache/layerfs-worktrees/layerfs-macos-writer-adm-905cf46b6910/artifacts/build-macos-c19cfd0bbfac4770a6951bf33d2070e8/manifest.json`.
It records toolchain `1.85.1`, debug profile, locked/offline compilation, and
PostgreSQL features for the CLI and Node binding. Its source HEAD remains
`1edcf58caec2bf079a07891411a0151c9afa3e80` with private working changes; source
digest: `86843cd2239832dcc560134a36d65fa2dc565818a2afd6cf4c20e087366679f5`.

| Sealed artifact | SHA-256 |
| --- | --- |
| CLI `layerfs` | `fe6acaef68025816cec0c82005a8689370b62fa2f11c6bab99d8f687fdb5a24e` |
| `layerfs-daemon` | `b32f5660e64f5fec9c8c0401a67ceea7d4f6d1ca0f6163f762737d2230074a62` |
| `layerfs.node` | `4be65519fdcbbc6c6fbe45377f36f1d4f8ef363a19e0091b3bb21dac14f1f9d1` |

The full eight-tier private run **passed** using that native CLI/daemon pair
across four machines, four stores and the existing eight projects. Every tier's
saved graph, exact final files, retained drafts and successful mutation receipts
were independently verified. Totals were **41,640 unique Commits, 857 side
Branches, 330 genuine merge Commits, 8,667 publications and 8,675 main Layers**.
The [dense-run receipt](evidence/preset-controls/dense-eight-tier-live.json)
retains the per-project results and verified cleanup.

| Dense-run phase | Elapsed |
| --- | ---: |
| Preparation, imports and placement | 48.107 s |
| Eight concurrent project histories | 673.090 s — 11 min 13.090 s |
| Independent verification | 92.376 s |
| Complete recorded operation, including cleanup/other overhead | 817.314 s |

All **50,834 history CLI calls** succeeded without mutation retries. Independent
archive analysis found 54,821 successful setup invocations overall, with exactly
one queued, started and finished lifecycle record for each invocation. All
41,310 history file writes retained stdin; every history invocation retained
both stdout and stderr fields. No required input or output was missing or
truncated. Actual child-process lifetimes reached **eight concurrent CLI
processes**; lighter tiers finished naturally while heavier tiers continued.
These counts come from invocation IDs and actual start/end timestamps, not
task-wrapper overlap. The [archive analysis](evidence/preset-controls/dense-eight-tier-trace-analysis.json)
retains the complete accounting and per-project process timing.

Cleanup independently verified removal of all four private stores and both
custom Lima machines, with no remaining or unexpected resources. The build did
not reset or replace the user's existing Studio environment. This is one
diagnostic dense workload execution with uncontrolled caches; there is no
equivalent dense sequential arm, so no dense speedup ratio is claimed.

After the preset became idle, `desktop/.env.local` was updated to select the
sealed c19 CLI and matching daemon above. After reload, `/api/status` reported
that CLI path. Studio was reopened through the UI without Build or Reset, and
all eight tier targets rendered without a preview error overlay. No Electron desktop
verification is claimed. The existing Linux runtime bundle was not rebuilt for
this follow-up; the native regression tests above establish macOS behavior only.


## Optimized release qualification — 2026-11-10

The same source digest and private native patches were sealed with release profile
in `build-macos-b4035a8f06434f7e8e09c823dad9e32a`. CLI SHA-256:
`571032b596aa33e5f6c7fcb2690f23ec3c92f76365957f58b9121ca2c13e3445`;
matching daemon SHA-256:
`466c32557b9ec717483f5736eb9d6f41e1616b106305dca178879cb50643f302`.
The same four native regression targets passed all 20 tests in release mode;
[retained output](evidence/preset-controls/speed-final-native-regressions.log).

The [optimized full proof](evidence/preset-controls/dense-eight-tier-optimized-verified-live.json)
passed all 50,834 history commands and the unchanged saved graph targets with
12 global / 3 store / 3 project admission. History took 247.754 seconds;
verification 24.911 seconds; preparation through verified ready 294.417 seconds.
Cleanup and finalization ended at 298.150 seconds. This combined workflow also
changes scheduling, verification concurrency and logging; the observed history
ratio of 2.72× versus the earlier 673.090 seconds is not an isolated release-build
or scheduler speedup measurement. Caches were uncontrolled.

All 54,821 setup invocations have complete unique lifecycle and output capture;
all writes retain input, with no failures or truncation. Logging stays within
8 MB and drains completely. All four test stores and both owned machines were
removed and independently verified absent. `desktop/.env.local` now selects this
release CLI/daemon pair; `/api/status` confirms it, with Studio opened and idle.
Existing saved Studio contents were not reset or rebuilt. The Linux bundle is
unchanged and the native changes remain local/unmerged.


### Saved Studio upgrade follow-up

The initial preview handoff checked the CLI pin and script UI, but did not read
remote stores in the existing saved Studio. Those already-running workers kept
the earlier build identity and refused the new CLI with `Unavailable` / “worker
is of another build”. The fresh private full-build proof above remains valid;
its success did not qualify worker upgrades in an existing home.

The [saved-home repair receipt](evidence/preset-controls/saved-studio-worker-upgrade.json)
records explicit stop → start of Docker, demo-build and demo-research through
host routes, grouped in CLI Activity. No store/project reset or removal was used.
All four store stats and all eight project stats subsequently returned HTTP200.
The actual Storage page then rendered all four store sizes without worker errors.
Future runtime promotion must verify remote saved-home reads as well as the pin;
a running machine summary alone does not prove worker build compatibility.
