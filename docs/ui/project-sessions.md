# Project: Sessions

Every session of the project, newest first, each a row that opens its session page. Opens from: the "Sessions N" tab at the right of a project page's tab row (or `CONNECT_VIEW=projects/<project>/sessions`).
Source: `src/renderer/src/components/runs/run-list.tsx` (main file; others named in Regions).

## Skeleton

```text
+-[1] TabBar ----------------------------------------------------------------------------------+
| Live   Timeline   History   Storage   Sandboxes        |   Sessions 28   [2][ > Replay | v ] |
|                                                            ===========                       |
+----------------------------------------------------------------------------------------------+
+-[3] RunList ---------------------------------------------------------------------------------+
| Sessions 28   * 1 playing                                                  [ + New session ] |
+-[4] RunRow ----------------------------------------------------------------------------------+
| SESSION                      STARTED    DURATION  STEPS               AGENTS    PROJECT      |
| * /crew_1  Working           3 min ago  2 m 40 s  [==------]  31/967  ** 2      playground > |
| * /checkpoints_2             3 h ago    2 m 12 s  [=-------]  5/37    *** 3     playground > |
| * /teams_2 - docs  Stopped   3 h ago    2 m 11 s  [==------]  4/17    ** 2      playground > |
| * hi                         3 h ago    3 h 11 m  [========]  1/1     * 1       playground > |
| * /agents_2                  3 h ago    4 m 55 s  [=-------]  19/199  ****** 6  playground > |
| ...                                                                                          |
+----------------------------------------------------------------------------------------------+
```

## Regions

1. **TabBar** (`ProjectPage`, `projects/project-view.tsx`): the page's first row, a `TabBar`; there is no title, as the sidebar names the project. Live, Timeline, History, Storage and Sandboxes, a divider, then the quiet "Sessions N" tab (active here, its count counting up).
2. **ReplayControl** (`ReplayControl`, `runs/replay-control.tsx`): only on a scenario's project. Idle, the primary "Replay" pill starts a new session of the scenario; while one plays it shows a progress ring and "76/535" and opens that session. Its menu (v) holds "View scenario" and, while one plays, "Stop session".
3. **RunList** (`RunList`, `runs/run-list.tsx`): "Sessions" and its count, an "N playing" chip while any session plays, and "New session", which starts one ("Starting..." meanwhile) and opens it.
4. **RunRow** (`RunRow`, `runs/run-list.tsx`; styles in `runs/run-list.css`): one row per session; a click or Enter opens its session page.
   - SESSION: a state dot (`RunDot`, `runs/run-badges.tsx`) and the name from `runLabel` ("/crew_2", "/teams_2 · docs", a live session's title). A playing row adds "Starting" or "Working" in the primary colour, a stopped one "Stopped" in amber.
   - STARTED: how long ago (the clock time on hover). DURATION: counts up while the session plays.
   - STEPS: the `run-bar` progress bar and "done/of"; "N steps" when the session has no script total.
   - AGENTS: up to 6 overlapping agent colour dots, then the count ("–" when none).
   - PROJECT: the LayerFS project, in mono. The last cell shows "Open >" on hover, else ">".

## States

- **Loading**: three skeleton bars under the header.
- **Error**: `LoadError` ("the sessions") with a retry button, in place of the table.
- **Empty**: `Empty`, "No sessions yet": a session Inits the project from its fixture and plays its agents on the real backend.
- **Start refused**: a red alert under the header, "Could not start a session: <message>", with "Dismiss".
- **Playing**: the "N playing" chip; a playing row glows, its dot pulses and its bar shimmers. In the tab row, Live gets a pulsing dot and a live line runs under the header.

## Script view

The scenario's script, one agent at a time, before any session plays it. Opens from: "View scenario" in the Replay control's menu (or `CONNECT_VIEW=projects/<project>/script`); a quiet "Scenario" tab then appears after "Sessions N", active. Source: `runs/demo-script.tsx` (`DemoScript`).

```text
+-[1] TabBar ----------------------------------------------------------------------------------+
| Live   Timeline   History   Storage   Sandboxes   |  Sessions 28  Scenario  [ > Replay | v ] |
|                                                                   ========                   |
+----------------------------------------------------------------------------------------------+
+-[5] Script ----------------------------------------------------------------------------------+
| SCENARIO   ( * root  9 )  ( * a01  6 )  ( * a02  6 )                     3 agents - 21 steps |
| ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ |
| * workspace 4   * fs 6   * branch 8   * subagent 3                                           |
+----------------------------------------------------------------------------------------------+
+-[6] Conversation ----------------------------------------------------------------------------+
| Four ranges, two agents each. Each range ends at a checkpoint.                               |
| +------------------------------------------------------------------------------------------+ |
| | * Range 1: merge the lanes and publish            {* branch.merge} {* branch.publish}  v | |
| +------------------------------------------------------------------------------------------+ |
| (-> Started * a01)  (-> Started * a02)                                                       |
| ...                                                                                          |
|                                       1 turn - 21 steps                                      |
+----------------------------------------------------------------------------------------------+
```

5. **Script** (`Script`, `runs/demo-script.tsx`): "SCENARIO", the agents (parent before child) with their step counts, and "N agents · N steps". Up to 8 agents fit the `AgentRail` pill row; more get the `AgentSwitcher` dropdown (`runs/agent-switcher.tsx`). Under them, `KindBar` (the script's calls by kind) and `KindLegend` with counts.
6. **Conversation** (`Conversation` with `script`, `runs/conversation.tsx`): the shown agent's thread, drawn as on the session page but with no times; a subagent's first card reads "Task message". Its footer gives "N turns · N steps". Loading shows skeleton cards; a failed load shows "Could not load the script" with "Try again".
