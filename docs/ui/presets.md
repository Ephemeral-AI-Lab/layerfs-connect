# CLI project library

Source: `desktop/src/renderer/src/components/presets/*`, `pages/presets/PresetsPage.tsx`.
Uses the existing Cindy workbench theme in `design.md`.

## Studio library

```text
+-[1] CLI project library -----------------------------------------------------+
| [2] Studio                                                        [Reset]   |
| Eight projects with source files, branches, merges, and releases.             |
| 4 machines · 4 stores · 8 projects                                            |
| Execution mode   [Filesystem] [Mixed]                                         |
| Mixed: reuse sandboxes, ≤3/project; ≤16 mounted workspaces/sandbox             |
|                                                                              |
| [3] Project library                       Machine → store → project          |
| v Native                                                                     |
|   v demo-studio                                                              |
|       website     Storefront                        Planned [View script]    |
|       design      Design system                     Planned [View script]    |
| v Docker                                                                     |
|   v demo-services                                                            |
|       gateway / billing                                  [View script] each |
| v demo-build                                                                 |
|   v demo-build-cache                                                         |
|       compiler / sdk                                     [View script] each |
| v demo-research                                                              |
|   v demo-experiments                                                         |
|       embeddings / evaluation                            [View script] each |
|                                                                              |
| [Selected project: purpose, branches, planned history, related commands]      |
| Studio environment · Currently open                                          |
|                                       [View script] [Build projects]         |
| Build resets this environment, then creates the project library.             |
| [4] Build Studio · stage and real completed/total · [View CLI Activity]        |
+------------------------------------------------------------------------------+
```

| [n] | Component | Responsibility |
|---|---|---|
| 1 | `PresetsPage` | Existing page shell |
| 2 | `PresetControls` | One Studio library, simple Reset and Build projects controls |
| 3 | `PresetTopology` | Collapsible machine/store/project tree and direct project scripts |
| 4 | `PresetProgress` | Structured real stage/count progress and activity link |

Studio is the single library. There is no preset catalog or project selection. Execution mode selects Filesystem or Mixed for the next build. Mixed reuses a persistent sandbox per project, bounded to at most three live sandboxes per project and sixteen workspaces per sandbox. Each fresh workspace performs two ordered exec/commit pairs and cleanly unmounts; the next batch mounts a fresh workspace on the saved branch head. It replaces selected file-write revisions with workspace exec and commit; lifecycle commands do not count toward the minimum 30% of authored revisions. Build resets Studio, verifies cleanup, creates
its machines, stores, project contents and histories, and verifies the result.
It does not execute project tests or builds. Standalone Reset leaves an empty
environment. Existing resources encountered by reset, including sandboxes and
workspaces, still appear in the cleanup inventory and are removed by its rules.

An initialized inactive Studio has a small Open action. Inspecting the tree or
script does not activate or mutate the environment. Original-home reset remains
in the global environment menu.

## Project details

Selecting a project shows its title, purpose, store, branch names, and **Planned
history** counts from the executable recipe. Only a matching verified content
version and saved execution mode may show Ready and Verified history. Historical builds using an earlier
recipe cannot establish readiness for this library. Changing the mode does not mutate the saved library or relabel it Ready. Build confirmation and script snapshots bind the chosen mode. The tree remains a plan,
not a continuous live inventory; subsequent external edits may differ.

Each project row has **View script**, with an accessible label naming the project.
Resource selection is independent of expansion and script inspection. Machine
and store selection still shows their placement and configuration details.

## Confirmation and CLI scripts

```text
+-[1] Build Studio? ------------------------------------------------------ [x] -+
| Reset this environment, clear CLI Activity, then create the project library.  |
| Changes inside its stores and workspaces will be discarded.                   |
| > What will be reset                                                         |
|                                                  [Cancel] [Reset and build]  |
+------------------------------------------------------------------------------+

+-[2] website · CLI script ----------------------------------------------- [x] -+
| Commands that create this project and verify its contents.                    |
| N commands                                       [Copy commands] [Download]  |
| Project: demo-studio/website                            [Show all commands]   |
| Build preset                                                                 |
| 1 layerfs project init ...                                                    |
| 2 layerfs branch fork ...                                                     |
| 3 layerfs file apply ...                                                      |
|   > File content / standard input                                            |
| ... merges, publishes and verification                                        |
| > Run from terminal                                                          |
+------------------------------------------------------------------------------+
```

| [n] | Component | Responsibility |
|---|---|---|
| 1 | Existing `Dialog` | Scope confirmation; actual inventory and target home under disclosure |
| 2 | `PresetScript` | Right drawer with actual CLI argument list and expandable input |

Project scripts exclude reset and shared machine/store setup. Show all commands
restores the full reset/build/verify script in dependency order; the page-level View script
opens that full scope directly. Copy and Download follow the visible scope and
include the target home with exact stdin quoting and step/dependency comments.
Publication arguments show `<commit:step-key>` until the runner resolves that
receipt; CLI Activity shows the real executed commit ID. Downloads use project names
when filtered. Source file paths appear in CLI arguments and their input bodies;
the drawer does not show orchestration JavaScript.

After all source imports and store placement complete, all eight project scripts
start concurrently on their final machines: two projects per machine. Independent branch lanes share the CLI pool; writes within each branch and
publications to main remain ordered. Each write/publication pair finishes before
the next write on that branch; exact commit IDs are taken from successful
receipts. The script is a dependency plan; CLI
Activity records the actual interleaved execution timeline. Full scripts show detected cleanup targets, with dynamic discovery labeled.
The script context and download state the shared scheduler limits: at most 12
history CLI commands globally, 3 per store and 3 per project. These are capacity
limits, not a claim that every slot is always occupied. Values come from the
same default configuration as execution; no additional controls are shown.
Run from terminal explicitly runs the entire library workflow, including source
preparation, reset, progress and activity capture. Inspection never initializes
resources. Loading and error messages remain inside the drawer.

## Progress and recovery

- Checking, Resetting, Building and Verifying are real stages, not time estimates.
- Completed/total counts come from the backend; unknown discovery is indeterminate.
- The tree stays visible during operations. Backend task records supply per-project
  Waiting, Running completed/total, Created, Failed, and Stopped states. Older operations
  without task records fall back to recorded CLI status.
- The progress bar reports the actual number of running projects and completed
  projects from task records. The planned eight-project concurrency is labeled
  as a target until execution starts; it is not inferred from elapsed time.
- Completed project scripts say Created while final library verification is
  pending. A failed task remains Failed; its error code and reason appear in
  project details. Sibling scripts stopped after that failure say Stopped, with
  their own stopping reason retained. Progress counts failures and stopped
  projects separately; stopped siblings are not reported as additional failures.
- Created/Started describe recorded operations; Ready requires current verified content.
- A finished operation collapses to a quiet receipt and activity link.
- Failure stays at its failed stage; cleanup warnings/remnants are under Details.
- CLI Activity opens the operation with reset/build action IDs; recorded command
  links select the precise invocation input/output inspector.
- Activity comes only from the active environment and matching build action.
- Lost responses reconcile by GET using the same request ID, without replay.
- First Build initializes only a fresh private home; populated unowned homes are refused.
- Build retains the operation lock through cleanup and library setup.

## Layout and access

At 1280 × 820 and 900 × 600 the library uses the full content width. The page
scrolls; the script drawer stays within the viewport and scrolls independently.
Narrow layouts wrap project script buttons and keep command text readable.
Buttons expose keyboard focus and expansion/selection state; animation respects
reduced motion. Current stores are SQLite. A future PostgreSQL recipe needs a
separate Shared stores group rather than nesting under a machine.

## Dense tiers and bounded inspection

```text
[1] Project library
    Native
      demo-studio
        website   Tier 8   2,180 / 10,056 commits - 421 / 2,095 Layers - 1:54
          [View script]
        design    Tier 1   2,400 commits - 500 Layers               Created
          [View script]

[2] Building history - 12,403 / 50,842 commands - 4:12 elapsed
    ################.............................................
    6 projects running - 2 / 8 completed

[3] Project CLI script
    101-200 of 2,933+ commands    [Copy this page] [Download full plan]
    Branch lane · catalog-001
    layerfs file write ...
    > Step and dependencies
    > File content / standard input
    layerfs branch publish ... '<commit:catalog.001.write.1>'
    Publishes the exact commit returned by catalog.001.write.1
    [Previous]                    Page 2                    [Next]
```

1. One fixed library, eight unequal tiers. Targets and confirmed counts are
   supplied by each project's generated recipe; side Branches exclude main.
2. Count actual successful CLI commands, not an average of project percentages.
   Completed commands may arrive out of displayed order; never infer completion
   from a row index or treat the command list as the execution timeline.
   Smaller projects finish naturally. Elapsed time freezes at the recorded end.
   Imports/machine preparation and complete verification remain separate stages.
3. Return and render at most 100 script commands. A bounded snapshot keeps page
   order stable; input expands on demand. Explicit full-plan download walks
   pages. Downloads are command plans; Run from terminal owns source preparation
   and reset. Never render all 50,834 commands in one drawer.

New content version invalidates older Ready receipts without changing saved
projects. A build is required to materialize the denser history. CLI Activity
loads command metadata in pages and selected input/output separately; the tree
loads only a bounded related-command page for selected resource details.

Mixed progress reports actual confirmed workspace revisions against its required total, and the fraction of all authored revisions. The mixed script includes exact sandbox create, branch mount, exec body, workspace commit and clean unmount commands. Sandboxes remain available after build; recursive Reset closes them.

Workspace exec rows show a compact `<shell command>` placeholder by default. Expand **Shell command / exec input** for the exact shell body. Copy page and Download full plan retain the original complete argv; only the rendered command line is shortened.

The Mixed selector and script context explicitly describe two exec/commit pairs per mounted workspace. The sandbox persists across those short sessions. Script rows expose each distinct mount and clean unmount; histories and files carry forward through confirmed saved branch heads.

### Read cadence

The Presets page and environment header use the same `demo-presets` query key
and shared host GET path. They retain the last observed view during navigation
and refresh in the background. Poll every two seconds while a preset operation
is active, otherwise every five seconds. Explicit Refresh and operation results
still request a fresh view; polling never submits an operation.
