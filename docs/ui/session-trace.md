# Run page: Trace

One agent's trajectory as a ledger, grouped by turn: every scripted step, tool call and LayerFS
call, with the auto-checkpoints its writes made, each linked into the project's History. Opens
from: the Trace tab of a run page (it keeps the agent the Conversation showed).
Source: `src/renderer/src/components/runs/trace-view.tsx`.

## Skeleton

```text
+-[1] PageHeader (run page) ----------------------------------------------------------------------+
| Conversation   Checks   Trace                                                                   |
|                         =====                                                                   |
+-------------------------------------------------------------------------------------------------+
| root / [ * lead v ]                                                                             |
+-[2] Toolbar (glass, sticky) --------------------------------------------------------------------+
| 1 turn   21 steps   16 tool calls   24 LayerFS calls   8 auto-checkpoints of 40 in the run (…)  |
| [ Search commands, output, paths… ]  ( LayerFS calls )  ( Failures )   Expand all   Fold all    |
+-------------------------------------------------------------------------------------------------+
+-[3] Turn (glass) -------------------------------------------------------------------------------+
| > Setup                                                                                         |
+-------------------------------------------------------------------------------------------------+
+-[3] Turn ---------------------------------------------------------------------------------------+
| v Turn 1  Build up main in four ranges…                          21 steps  16 calls  1 m 08 s  |
|-------------------------------------------------------------------------------------------------|
| * (USER   ) Build up main in four ranges…                                                       |
| * (TOOL   ) layerfs branch fork crew_2.a01 …   ⚑ #1 ↗  ≋ 2                         120 ms      |
|     * (LAYERFS) branch.fork  ok                                                       80 ms      |
+-------------------------------------------------------------------------------------------------+
```

## Regions

1. **Agent row**: the same as the Conversation's; switching agent re-reads its Trace.
2. **Toolbar**: counts over the loaded rows (turns, steps, tool calls, LayerFS calls,
   auto-checkpoints by kind, failures; "counts cover the N newest of M rows" when only part is
   loaded). A search box (Esc clears), toggles to show every tool call's LayerFS calls and to keep
   only failed rows, Expand all and Fold all.
3. **Turn**: a glass card per turn; long traces fold all but Setup and the last turn. Rows: a status
   dot, a kind badge (System, User, Context, Script, Reply, Tool or the tool's name, Subagent,
   LayerFS, Check), the headline, then exit code, auto-checkpoint links, the LayerFS call count (a
   toggle for that row's calls), duration and, on hover, the time since the run started. A row with
   detail opens to its command (highlighted), writes, output, arguments and checks.
4. **Writes and checkpoints**: each successful write is an auto-checkpoint, numbered across the
   run's agents. Up to four numbers show as links (`#3 ↗`); a click opens the project's History tab
   on that Commit or Layer (or the run's trunk Branch for a publish), leaving the run page. Refused
   writes count as "N refused".

## States

- **Loading**: `Loading` ("Reading the trace"); a failed first read shows `LoadError`.
- **Paging**: 300 rows per page from the newest; "Load earlier (N more)" reads the page before.
- **Live**: while the run plays, its events re-read the loaded rows at most once a second.
- **Empty**: "<agent> has not started yet." while it plays, else "<agent> left no trace."
- **No match**: "No rows match."
