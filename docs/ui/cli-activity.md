# CLI Activity

Source: `desktop/src/renderer/src/pages/activity/*`
Opens from: workspace sidebar, refusal links, and preset operation progress.
Deep links: `?action=<id>` selects a recorded action; `?operation=<job-id>&action=<id>` adds the operation's progress and related phases.

## List

```text
+-[1] CLI Activity --------------------------------------- [Refresh] [⋯] -+
| Actions, commands, and their output.                                    |
| [2] [Search activity…                 ] [All outcomes v] [Desktop v]     |
|                                                                        |
| [3] ● Build Studio                            Running                > |
|       Time · 24 commands                                                |
|     · Start Docker                            Completed              > |
|       Time · 1 command                                                  |
|                                                                        |
| [Newest activity] [Older activity]                                      |
| [4] > environment · Activity details                                    |
+------------------------------------------------------------------------+
```

| [n] | Component | Responsibility |
|---|---|---|
| 1 | `CliActivityPage` / `PageHeader` | Refresh; overflow holds Export shown summaries and Clear history |
| 2 | `CliActivityPage` | Debounced search, outcomes, source; older-page navigation |
| 3 | `ActionRow` | Compact link with title, time, command count and text status |
| 4 | Native disclosure | Home, retention, redaction limits, last clear time |

## Selected action and command

```text
+------------------------------------------------------------------------+
| [1] < All activity                                                      |
| [2] Building Studio                                                     |
|     Resetting → Building → Verifying                                    |
|     [==================                         ]                       |
|     [Reset environment] [Build preset]                                  |
|                                                                        |
| [3] Build preset                                           Running     |
|     Time · 50,000 commands                                              |
|     Project: [All projects v]                                           |
| [4] layerfs store create …                          Completed · 1.2s  > |
|     layerfs project create …                       Running           > |
|     Showing 100 of 50,000 commands                 [Previous] [Next 100] |
|                                                                        |
| [5] CLI input                                            [Copy command]|
|     /absolute/layerfs project create …                                  |
|     > Standard input                                                   |
|     [Output] [Standard error] [Details]                                 |
|     Captured output of the selected command                             |
|                                                                        |
| > Action details                                                       |
| > environment · Activity details                                       |
+------------------------------------------------------------------------+
```

| [n] | Component | Responsibility |
|---|---|---|
| 1 | Router link | Return to the activity list |
| 2 | `PresetProgress` / phase links | Optional operation group; preserve independent reset/build action IDs |
| 3 | `ActionDetails` | Human action name, time, command count, outcome |
| 4 | `ActionDetails` | At most 100 metadata rows; project filter and cursor navigation; one selected command |
| 5 | `InvocationDetails` | Exact shell-quoted executable and arguments, stdin, one output stream, diagnostic metadata |

The operation progress uses actual runner stage/count data. A phase with unknown
total uses an indeterminate bar. Selecting a phase opens its raw recorded action;
no activity is relabeled, merged, replayed, or fabricated.

Standard error is a stream name, not a failure indicator. Nonempty stderr may
contain successful CLI progress. Status and exit codes determine failure styling.
The initial inspector chooses Standard error for a failed invocation with captured
stderr. Details holds process/queue timing, exit codes, PID, CLI identity and shared
invocation/progress information. Action IDs and page paths live in Action details.

## Large operations

List and action headers request summaries, not embedded invocation arrays. Command
pages contain at most 100 records and exclude stdin/stdout/stderr. Selecting a
command loads only that invocation's captured streams, even when its deep link
points outside the current page. Download selected command includes its captured
input/output; Export shown summaries explicitly exports only the visible action
summaries. The existing 32 KiB per-stream capture limit and truncation indicators
remain explicit; pagination never silently removes a retained command.

The host incrementally indexes complete appended archive lines. The bounded
metadata index retains disk locations rather than stream bodies; unchanged
archives are not reparsed on refresh. Index ceilings are 250,000 invocations and
100,000 actions, with an explicit diagnostic if exceeded. Notifications are
coalesced per action while every event is still recorded.

Ordinary archive segments retain the seven-day/100 MB policy. New demo-operation
segments are protected from ordinary pruning until an explicit activity reset,
within a 1 GB private-environment archive budget. Before launching another preset
CLI, admission reserves room for its bounded streams. Capacity pressure produces
an explicit error rather than silently expiring active preset evidence. Pending
serialized writes and reserved terminal space share the same 8 MB budget. A
bounded batch flusher groups up to 256 KiB per append and prepares directory
permissions once per generation; a drain lease fences reset until queued records
are written. Pruning runs on segment rotation, not for every CLI event.

Invocation identity and its queued record exist immediately. Once the call holds
an execution slot, lazy admission waits for its queued record to be written and
reserves 512 KiB for started/finished metadata and worst-case JSON-escaped stream
captures. Backpressure waits before spawning; it does not retry a CLI command or
raise the queue limit. Queued calls hold no terminal reservations. Normal calls
leave one terminal slot for cancellation, including `workspace exec-cancel`.
Reservations release only after the finished record is written. This describes
successful filesystem appends, not an fsync or power-loss durability guarantee.

Verification can compare exact expected invocation IDs with queued, started and
finished records plus both stream-capture flags, required stdin, and truncation
counts. No heuristic subset of successful commands can establish complete capture.

## States and layout

- Loading: Loading CLI activity.
- Empty: No CLI activity yet; commands appear after an app action.
- Filtered empty: No matching activity.
- Running operation with no calls yet: Waiting for commands.
- Error: connection error and retry; keep last successful data visible.
- Running invocation: queued/running label; waiting for captured output until available.
- Failed: refusal, CLI syntax error, launch failure or uncertain outcome text.
- Truncated: explicit notice with original byte count next to the selected stream.
- Empty captured stream: Command completed with no output.
- Shared: Details explains an existing process was referenced.
- No CLI: explains that the action launched no process.
- Expired/cleared deep link: explain unavailability without pretending the action failed.

At 1280 × 820 and 900 × 600, use the same compact list/inspector layout. Long CLI
input/output wraps inside its region, and command lists/streams scroll internally.
Filters wrap on narrow widths. Controls retain keyboard focus styling and statuses
use text as well as color. Existing app theme/sidebar/window controls are reused.

## Clear history

Overflow → Clear history opens the existing confirmation. It names the selected
home and explains that all actions, inputs, and outputs in that environment are
removed, including filtered records; resources remain unchanged. Cancel receives
initial focus. Clear is disabled during active operations.

Server admission checks jobs, CLI leases, fixture locks, home and history
generation. Clearing removes NDJSON files and fences late writers. Failures remain
visible without automatic retry. On success, leave old deep links/paging, reset
filters, and expose the cleared timestamp under Activity details. Subsequent real
activity appears normally. Export shown preserves the current list/detail NDJSON
export scope and does not implicitly export hidden actions from an operation.

Resource links from Presets may include `invocation=<id>` with `action=<id>`.
The command inspector initially selects that exact invocation, with the existing
running/first-command fallback if it is no longer available.
