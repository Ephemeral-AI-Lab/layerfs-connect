# Simulation verification — 2026-11-10

**Passed.** All eight complete Native profiles passed Non-mixed first, then Mixed.
Repeated/concurrent runs, focused Docker execution, private-host restart and fresh
runs on the final source also passed. [verification-summary.json](verification-summary.json)
is the machine-readable index. Recorded at `2026-11-10T12:08:21.763233+00:00`.

## Runs and real execution

| Batch | Audited runs | Confirmed CLI calls |
| --- | ---: | ---: |
| [native-filesystem-full](native-filesystem-full-audit.json) | 8/8 | 54,779 |
| [native-filesystem-repeated](native-filesystem-repeated-audit.json) | 2/2 | 6,382 |
| [native-mixed-full](native-mixed-full-audit.json) | 8/8 | 84,939 |
| [native-mixed-repeated](native-mixed-repeated-audit.json) | 2/2 | 9,842 |
| [docker-filesystem-one-cycle](docker-filesystem-one-cycle-audit.json) | 1/1 | 440 |
| [docker-mixed-one-cycle](docker-mixed-one-cycle-audit.json) | 1/1 | 634 |
| [final-source-filesystem-three-cycle](final-source-filesystem-three-cycle-audit.json) | 1/1 | 1,128 |
| [final-source-mixed-one-cycle](final-source-mixed-one-cycle-audit.json) | 1/1 | 633 |

The full Non-mixed batch verified **50,834 agent Bash steps**, 24 setup calls and
3,921 verification reads: **54,779 confirmed CLI calls**. Full Mixed verified
**80,986 agent Bash steps**, 24 setup calls and 3,929 verification reads:
**84,939 confirmed CLI calls**. All **7,536 Mixed workspace sessions** were cleanly
unmounted, with two exec/commit pairs per default mounted workspace.

Audits match generated file hashes, immutable plans, actual operation journals,
canonical Pi prompts/tool calls/results and non-truncated CLI Activity captures.
They verify exact command/receipt identity, saved files/branches/publications,
child-parent links, reused sessions, turn limits and per-sandbox lifecycle
admission intervals. Every mutation is attempted once; failures are not replayed.
Both full batches proved overlapping runs with distinct Store/project names and
peak four actual CLI calls, within the configured ceiling of twelve. Repeated
batches overlap some full-batch IDs; do not sum all table rows as unique work.

## Saved conversations and reused children

Both full batches verify the same allocation:

| Project | Main conversations | Total child sessions | Max main turns | Max child turns |
| --- | ---: | ---: | ---: | ---: |
| design | 2 | 3 | 6 | 5 |
| billing | 3 | 6 | 5 | 4 |
| sdk | 4 | 11 | 4 | 3 |
| evaluation | 4 | 11 | 5 | 4 |
| embeddings | 5 | 16 | 5 | 4 |
| compiler | 6 | 25 | 5 | 4 |
| gateway | 7 | 32 | 6 | 5 |
| website | 8 | 40 | 6 | 5 |

Each project has at most eight conversations and each conversation at most eight
distinct children. Every main/child has at most ten natural user turns; observed
maxima are six and five. [Turn density](natural-turn-density.json) records **35–401
Bash steps per user turn**. A prompt runs its related assignments, delegation and
collection before the assistant's reply; the next user prompt starts the next
turn. Children are reused within their parent and bind to the new run's project.

## Restart and final source

[API restoration](restored-api.json) verified all **16 full runs, 78 main
conversations, 288 child sessions and 131,820 Bash steps** after restarting the
private host. Restored prompts, commands, outputs and actual CLI receipts match
the compiled plans and canonical Pi histories. No run was replayed.

[Browser restoration](chat-performance/restored/restore.json) exercised saved main
and child Bash details, assistant replies, turn counts and actual Trace links at
1280×820, with zero errors and no API writes. Its initial attempt timed out because
the helper reloaded immediately after hash navigation and reopened the prior
child route. Forcing a new document fixed the helper; the successful rerun and the
initial partial report are retained.

The full production batches ran before a two-line change releasing unused generated
`compiled.files` strings after writing them to disk. All execution code and persisted
artifacts were identical. After restart, fresh three-cycle Non-mixed and one-cycle
Mixed proofs passed with that change loaded. [Source hashes](source-hashes.json)
record both versions; [retention evidence](generated-text-retention.json) records
the duplicate generated-text allocation, without claiming measured heap recovery.

## Tests and browser performance

- [Root tests](root-tests.log): **229 passed**.
- [Host tests](host-tests.log): **418 passed, two skipped**. Zero failures.
- [Focused retention tests](memory-fix-tests.log): 19 passed; these overlap the host
  suite and are not added to the distinct total.
- Desktop typecheck and production build passed.
- [SSE traffic](backend-performance.json): **108,687,672 → 297,498 bytes per ten
  seconds**, a 99.73% reduction. Progress uses small summaries; histories remain saved.
- [Page protocol](page-performance/summary.json): the same 45-second navigation
  sequence observed **70 → 39 API GETs**, **193 → 7 long tasks**, and
  **15,051 → 648 ms** total long-task time.
- [Chat measurements](chat-performance/README.md): visible-child scripting time
  fell from 9.78 to 2.33 seconds per fifteen-second sample while more Bash rows
  were present. Samples are observational, not isolated causal benchmarks.
- [Sidebar stability](sidebar-stability.json): **18 running conversations, 639
  confirmed CLI commands, zero position changes** across twenty samples.
- [Actual interactions](page-performance/interactions.json) covered Storage search,
  Store navigation, Files/README, History, Sandboxes, Machines and script pagination.
  Browser screenshots cover **1280×820 and 900×600**. No browser errors or overflow.

Backend and renderer changes were measured together. The real catalog grew between
page samples; phases also differ in chat samples. Before-page heap was not captured.
Full-scale runs used Native; Docker passed focused one-cycle checks for both modes.
Lima execution, native Electron GUI and packaged macOS behavior were not exercised.

## Retained resources and evidence

The private state and selected LayerFS home are `/var/folders/s4/xpkmz7wn6yq97w1ls_4f_dfc0000gn/T/layerfs-simulation-bash-7MQLVJ` and its `home-2/`.
Stores, projects, Sandboxes, generated Bash packages, journals, canonical histories
and raw CLI captures remain there for inspection. The host is left running on the
final source. Normal user state and another session's preview were not reset.
This directory contains bounded audit summaries, screenshots, logs and source
identities; authentication query values are redacted.

[Final host state](final-host-state.json) has zero active runs. It retains 23 completed
runs, nine deliberately stopped pre-performance attempts, and one expected
[stopped-machine refusal](stopped-machine-preflight.json) that created no Store.
Earlier attempts and the diagnosed Native detach race remain separate. [Lifecycle race](lifecycle-race.json) and
[gate proof](lifecycle-gate-proof.json) explain the per-sandbox admission fix;
those earlier failed attempts are not counted as passing final runs.
