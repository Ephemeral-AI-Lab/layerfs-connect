# Project: Sessions, Script and Play scenario

The project's scenario runs, newest first, each a row that opens its run page; the scenario's
script; and the "Play scenario" picker that starts runs. Opens from: the "Sessions N" tab after
the divider in a project page's tab row (or `CONNECT_VIEW=projects/<project>/sessions`; old
`live` links open it too).
Source: `src/renderer/src/components/runs/run-list.tsx` (Sessions),
`runs/demo-script.tsx` (Script), `projects/scenario-picker.tsx` (Play scenario).

## Skeleton

```text
+-[1] PageHeader ------------------------------------------------------------------------------+
| < Projects                                                                                   |
| [P] shop   (Store badge)                     [ Refresh ] [ > Play scenario v ] [ New chat ]  |
| (Last Commit 3 min ago) (4 Branches) (12 Commits) (2 MB on disk)                             |
| History   Storage   Sandboxes   |   Sessions 3   Script                                       |
|                                                       ========                               |
+----------------------------------------------------------------------------------------------+
+-[2b] Live card: the live diagram (project-live.md), while a run plays or ended < 5 min ago --+
+-[3] RunList ---------------------------------------------------------------------------------+
| Sessions 3   (* 1 playing)                                                                   |
| SESSION                              STARTED    DURATION  STEPS              AGENTS          |
| * crew_2   Running                   2 min ago  2 m 05 s  [====------] 31/96  ** 2  [Stop] > |
|   Crew                                                                                       |
| o depot_1  (Queued)                  1 min ago  –         [----------]  0/40  –     [Stop] > |
|   Depot · waiting for a heavy scenario                                                       |
| o crew_1                             3 h ago    2 m 40 s  [==========] 96/96  ** 2  [ 🗑 ] > |
|   Crew                                                                                       |
+----------------------------------------------------------------------------------------------+
```

## Regions

1. **PageHeader** (`ProjectView`, `projects/project-view.tsx`): a live line runs under it while a
   run plays (not while one is only queued). Sessions is the default tab once the project has runs,
   and gets a pulsing dot while a run plays. It opens with the Live card (`LiveTab`,
   [project-live.md](project-live.md)) while a run plays or ended in the last 5 minutes, then
   the list. A refused start shows a
   red alert under the facts, "Could not start the scenario: <message>", with a dismiss ×.
2. **Play scenario** (`ScenarioPicker`, `projects/scenario-picker.tsx`): an outline button with a
   menu of `host.demos()`, the project's own scenario first ("This project's"), each with its title,
   agent count and blurb; then "All scenarios". A choice calls `host.startRun(id, projectKey)` or
   `host.startAll(projectKey)` (`useStartRun`, `runs/use-runs.ts`) and opens the first new run's
   page. Disabled until the project is initialised; "Starting…" with a spinner meanwhile.
3. **RunList** (`RunList`, `runs/run-list.tsx`, styles in `runs/run-list.css`): a liquid-glass
   card, "Sessions" with its count and an "N playing" chip. Columns fold away under 44 rem.
4. **RunRow**: a click on the name (or the chevron) opens the run page.
   - SESSION: `RunDot` and the run's folder in mono (`runName`: `crew_2`, or `teams_1 · docs` for a
     session of a multi-session scenario); "Running"/"Starting" in the primary colour, "Stopped" in
     amber, or a "Queued" chip with an hourglass for a heavy scenario waiting its turn. Under it the
     scenario's title, and the run's phase while it starts.
   - STARTED (clock time on hover), DURATION (counts up while it plays; "–" while queued), STEPS (a
     calm progress bar and done/of), AGENTS (up to 6 colour dots and the count).
   - Actions: Stop (`host.stopRun`) while it plays or waits; once ended a trash button that turns
     into Delete / Cancel, and Delete calls `host.removeRun` (the record and traces go; the project
     and its history stay). A failed action shows its message under the row.

Old run records saved by an earlier engine as live Pi sessions (`kind: 'live'`, or state `idle`)
are hidden here, in the sidebar and on the run page; Chat replaces them.

## States

- **Loading**: three skeleton bars.
- **Error**: `LoadError` ("the sessions") with Try again.
- **Empty**: "No sessions yet", with the Play scenario picker as its action.
- **Live**: rows follow the host's `run`, `agent` and `run-removed` events (`useRuns`).

## Script

The project's own scenario (the one whose run made it, `ProjectSummary.demo`, or the scenario
named like the project), shown only when it has one. `DemoScript` (`runs/demo-script.tsx`): a glass
card with "Script", the agents (an `AgentRail` of pills for up to 8, else the `AgentSwitcher`
dropdown), "N agents · N steps", the blurb, a bar of the script's calls by kind and its legend;
under it the shown agent's thread in the run page's conversation look, with no times
(`Conversation` with `script`). Loading shows `Loading`; a failed read shows `LoadError`.
