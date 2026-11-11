# Private preset scheduler diagnostics

2026-11-10. The optimized runtime, corrected branch DAG and concurrency selection
have passed private pilots. The lightest native full tier, three-cycle activity
pressure case, and **full eight-tier optimized proof all passed**. The full run
preserved all 50,834 history commands and independently verified graph, content,
exact CLI capture and cleanup. These are Connect workflow diagnostics with
uncontrolled host and worker caches, not frozen LayerFS performance gates or
cold-cache benchmarks.

## Reproduce a declared treatment

Use `tools/demo/benchmark.mjs` after the pinned runtime is built and recipe,
scheduler, verifier and logger source are stable. Do not build during timing.
Every arm uses a fresh private LayerFS home; the preview and saved Studio are
never adopted.

```sh
node tools/demo/benchmark.mjs \
  --cli /absolute/sealed/layerfs \
  --daemon /absolute/sealed/layerfs-daemon \
  --scope studio --schedule parallel --cycles 1 \
  --concurrency 12 --store-concurrency 3 --project-concurrency 3 \
  --history-budget-ms 120000 \
  --evidence /absolute/evidence/pilot-parallel-12.json
```

The launcher supplies the matching pinned `LAYERFS_BUNDLE` and cache location.
The harness does not load `.env.local` or accept an existing state directory.
Its profile is explicitly Disposable. An existing evidence path is refused before
state creation, including concurrent attempts to reserve the same arm name.

| Scope | Workload | Purpose |
|---|---|---|
| `native` | Design on native, bounded declared cycles | Native correctness and branch scheduling |
| `native-pair` | Website and design on one shared native store | Shared SQLite admission and fairness |
| `studio` | Eight projects, four stores, native/Docker/two Lima machines | Final placement and cross-machine correctness |

One cycle per project includes its authored base: 357 history calls, 288 unique
commits, 14 side branches and 60 main Layers. One-cycle Studio has 2,856 history
calls. Preparation, verification and cleanup calls are reported separately. The
`serial` arm still runs eight projects together but executes each project's
recipe sequentially, matching the earlier build. `parallel` schedules independent
branches and preserves the write/publication barriers required by the runtime.

Register each arm before launch. Use one sample per declared case and treatment;
do not repeat unchanged passing treatments to select a faster result. Preserve
`NOT_RUN`, `PASS`, `FAIL` and `TIMEOUT` outcomes. A correctness fix or separately
declared scaled workload gets a distinct evidence name. Run arms sequentially.

## Completed arm registry

All successful rows below have stable source identity, complete saved graph and
content verification, exact mutation input/output capture, and independently
verified cleanup. The optimized treatment used sealed macOS artifact
`build-macos-b4035a8f06434f7e8e09c823dad9e32a`; the Linux worker bundle remained
fixed. Binary hashes and source digests are in each linked receipt.

| Evidence / treatment | Calls | Global / store / project | History seconds | Verification seconds | Outcome |
|---|---:|---|---:|---:|---|
| [Native optimized flat](../evidence/preset-controls/speed-native-release-flat8.json) | 357 | 8 / 3 / 3 | 8.395 | 1.385 | PASS |
| [Native initial same-branch pipeline](../evidence/preset-controls/speed-native-release-dag8.json) | Incomplete | 8 / 3 / 3 | — | — | FAIL: `HeadMoved`; cleanup verified |
| [Native corrected branch DAG](../evidence/preset-controls/speed-native-release-dag8-head-guarded.json) | 357 | 8 / 3 / 3 | 5.088 | 1.493 | PASS |
| [Native shared-store pair DAG](../evidence/preset-controls/speed-native-pair-release-dag8.json) | 714 | 8 / 3 / 3 | 6.503 | 2.894 | PASS |
| [Studio debug flat](../evidence/preset-controls/speed-studio-debug-flat8.json) | 2,856 | 8 / 3 / 3 | 22.363 | 14.538 | PASS |
| [Studio optimized flat](../evidence/preset-controls/speed-studio-release-flat8.json) | 2,856 | 8 / 3 / 3 | 13.660 | 11.806 | PASS |
| [Studio optimized DAG 8](../evidence/preset-controls/speed-studio-release-dag8.json) | 2,856 | 8 / 3 / 3 | 13.858 | 11.879 | PASS |
| [Studio optimized DAG 12](../evidence/preset-controls/speed-studio-release-dag12.json) | 2,856 | 12 / 3 / 3 | 12.907 | 11.568 | PASS |
| [Studio optimized DAG 16](../evidence/preset-controls/speed-studio-release-dag16.json) | 2,856 | 16 / 4 / 3 | 12.663 | 11.680 | PASS |
| [Native full lightest tier, nine cycles](../evidence/preset-controls/speed-native-release-dag-full-tier.json) | 2,933 | 12 / 3 / 3 | 38.545 | 4.675 | PASS |
| [Studio logger-pressure case, three cycles](../evidence/preset-controls/speed-studio-release-dag12-capture-pressure.json) | 8,008 | 12 / 3 / 3 | 36.821 | 5.601 | PASS |
| [Studio full unequal tiers](../evidence/preset-controls/dense-eight-tier-optimized-verified-live.json) | 50,834 | 12 / 3 / 3 | 247.754 | 24.911 | PASS |

The one-cycle arm verification timings precede the four-store parallel verifier.
The three-cycle pressure case includes that improvement and the corrected
bounded activity writer; it is a different workload and source treatment.
Preparation times are retained in receipts, but differences in VM readiness make
them unsuitable for attributing scheduler speedup.

## Decision from these observations

Production selects **12 global CLI calls / 3 per store / 3 per project**, shared
through `DEFAULT_HISTORY_LIMITS`. Ordinary host calls retain their existing limit.
Actual history process peaks were 8, 12 and 16 in the corresponding Studio arms.

Optimized flat reduced one-cycle Studio history from 22.363 to 13.660 seconds.
DAG 8 then took 13.858 seconds, so branch scheduling at the old global limit did
not improve that short Studio workload. DAG 12 took 12.907 seconds, 5.5% below
optimized flat. The native one-cycle branch DAG separately reduced history from
8.395 to 5.088 seconds. These are observed diagnostic comparisons, not statistical
performance guarantees or full-tier forecasts.

DAG 16 / store 4 saved 0.244 seconds (1.9%) versus DAG 12 / store 3, while summed
child-process lifetimes increased from 114.161 to 142.381 seconds (24.7%). That
metric is wall lifetime summed across children, not CPU time. The small observed
wall gain did not justify the added store pressure; 12 / 3 / 3 is the selected
throughput/headroom balance.

The native nine-cycle proof verifies 2,400 commits and 500 main Layers. The
three-cycle Studio proof verifies all eight projects with 816 commits and 170
main Layers each. These smaller cases are retained separately from the passing
full unequal-tier workload of 41,640 commits and 8,675 main Layers across 50,834
history commands.

## Retained failures and corrections

The first immutable-Commit write/publish pipeline failed with `HeadMoved`.
Persistence requires a new publication's Commit to still be the branch head.
The corrected scheduler serializes write → publish → next write, retaining only
independent branch overlap. The failed receipt remains separate from the passing
head-guarded treatment; no mutation was retried and no LayerFS CAS guard changed.

The [first optimized full attempt](../evidence/preset-controls/dense-eight-tier-optimized-activity-queue-diagnostic.json)
failed with `ActivityCapacity` after 2,354 history calls. Its approximately 14 MB
archive was under the 1 GB protected limit; its pending logger queue reached the
8 MB bound. Cleanup was independently verified. This attempt is a retained
failure, not a full-tier performance result.

The correction batches activity disk writes, reserves bounded terminal capacity
before spawning, and waits for writable room inside CLI admission. It retains
cancellation headroom and the original 8 MB bound; neither omitted output nor a
larger queue is the solution. The passing three-cycle pressure receipt records
8,008 history processes, 9,073 total captured invocations, zero terminal drops,
zero skipped progress, and a peak 6,299,377 buffered-plus-reserved bytes below the
8,000,000-byte bound. Pending bytes, reservations and waiters were zero afterward.

## Proof and reporting requirements

The history budget for the bounded pilots is at most 120 seconds. On expiry the
harness refuses new calls, drains in-flight calls and tears down in `finally`.
An uncertain call is not replayed. Preserve uncertain resources or failed cleanup
receipts rather than deleting evidence or reporting a pass.

The production verifier reads unique saved ancestry, both merge parents, main
Layer order, exact expected files and directory inventory. Exact journaled
mutation invocation identities, write stdin and output capture must also pass.
Actual process overlap is reconstructed from `cli.started`/`cli.finished`, with
exact expected history counts; promise concurrency is not an overlap metric.
Cleanup is checked independently through LayerFS inventory.

Evidence includes source-file digests, binary SHA-256 values, bundle identity,
per-project confirmed counts, preparation/history/verification timings, process
peaks, occupancy and command-family durations. The harness rehashes sources after
cleanup; changed or missing source invalidates stability instead of attributing
the whole run to its starting hash. Numeric eligibility stays `INCOMPLETE` because
OS/worker caches are uncontrolled. Functional verification and cleanup are
separate factual verdicts.

## Observed full eight-tier result

The [full optimized receipt](../evidence/preset-controls/dense-eight-tier-optimized-verified-live.json)
records all 50,834 history commands, 41,640 unique commits, 857 side branches and
8,675 main Layers passing on the intended four machines. Preparation took 21.752
seconds, history 247.754 seconds and verification 24.911 seconds. Preparation
through verification totaled 294.417 seconds, excluding teardown. Cleanup was
independently verified and source identities remained stable.

The original full run recorded 673.090 history seconds and 92.376 verification
seconds for the same workload. The optimized workflow used 63.2% less observed
history time (2.72× ratio) and 73.0% less observed verification time. This compares
whole workflow treatments: optimized native runtime, corrected branch scheduling,
selected concurrency, parallel reads and bounded activity writes. It does not
isolate a single cause, control cache state or promise the same speedup elsewhere.

Complete activity verification covered 54,821 total setup invocations and all
50,852 journaled preparation/history mutations. Peak buffered-plus-reserved
activity was 6,297,154 bytes under the unchanged 8,000,000-byte limit. Terminal
drops and skipped progress were zero, and pending bytes, reservations and waiters
were zero after draining. The [streamed trace analysis](../evidence/preset-controls/dense-eight-tier-optimized-trace-analysis.json)
found no failed invocations, malformed lines or oversized lines and measured
actual process overlap rather than task-wrapper promises. Earlier failed
receipts remain retained and do not count as passing samples.
