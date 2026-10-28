# Session: Trace

One agent's trajectory as a ledger, grouped by turn: every prompt, model step, tool call and LayerFS write, with the auto-checkpoints its writes made, each linked into the project's History. Opens from: the Trace tab of a session page (it keeps the agent the Conversation showed).
Source: `src/renderer/src/components/runs/trace-view.tsx` (main file; others named in Regions).

## Skeleton

A replay of the Checkpoints scenario, root agent, one tool call opened with its LayerFS calls:

```text
+-[1] SessionBar ------------------------------------------------------------------------------+
| [ playground ] / [ * root v ]              REPLAY - CHECKPOINTS - 1 m 08 s - started 3 h ago |
| Conversation   Trace                                                                         |
|                =====                                                                         |
+-[2] Stats -----------------------------------------------------------------------------------+
| SCRIPTED   1 turn   21 steps   16 tool calls   24 LayerFS calls                              |
| 8 auto-checkpoints of 40 in the session (4 merge - 4 publish)                                |
+-[3] Toolbar ---------------------------------------------------------------------------------+
| [ Search prompts, output, paths... ]  ( LayerFS calls )  ( Failures )  Expand all  Fold all  |
+----------------------------------------------------------------------------------------------+
+-[4] Turn ------------------------------------------------------------------------------------+
| v Setup                                                                                      |
+----------------------------------------------------------------------------------------------+
| * {SYSTEM  } Scripted agent - Checkpoints                                                    |
+----------------------------------------------------------------------------------------------+
+-[4] Turn ------------------------------------------------------------------------------------+
| v Turn 1  Build up main in four ranges. In each range have ...  21 steps  16 calls  1 m 08 s |
+-[5] Row -------------------------------------------------------------------------------------+
| * {USER    } Build up main in four ranges. In each range have two subagents fork ...         |
| * {SCRIPT  } Four ranges, two agents each. Each range ends at a checkpoint.                  |
| * {SUBAGENT} a01                                                                        0 ms |
| * {CONTEXT } Reply from a01                                                                  |
| * {TOOL    } Range 1: merge the lanes...  [6] Auto-checkpoints [#9 >] [#10 >]  [= 4]  379 ms |
|     [7] * {LAYERFS } branch.merge  ok  lane-a lane-b                                   14 ms |
|         * {LAYERFS } branch.publish  ok  range-1                                        9 ms |
|     ...                                                                                      |
|              +-[8] Detail -----------------------------------------------------------------+ |
|              | COMMAND                                                                     | |
|              | layerfs branch merge lane-a lane-b --into range-1 && layerfs ...            | |
|              | AUTO-CHECKPOINTS #9-#10                                                     | |
|              | #9   {MERGE  } [ 3f2a91c > ]  lane-a + lane-b -> range-1              14 ms | |
|              |      Merge lane-a and lane-b                                                | |
|              | #10  {PUBLISH} [ 7c1d0e2 > ]  range-1  -> main as Layer 7c1d0e2        9 ms | |
|              | OUTPUT                                                                      | |
|              | merged range-1; published 7c1d0e2                                           | |
|              +-----------------------------------------------------------------------------+ |
| * {TOOL    } Range 1: verify the checkpoint                                    [= 2]  209 ms |
| * {MESSAGE } Go on with range 2.                                                        0 ms |
| ...                                                                                          |
+----------------------------------------------------------------------------------------------+
```

## Regions

1. **SessionBar** (`SessionBar`, `runs/run-view.tsx`): the session header, as in [session-conversation.md](session-conversation.md), with Trace active. The AgentSwitcher picks whose trace shows.
2. **Stats** (`Stat`, `runs/trace-view.tsx`): "SCRIPTED" (a replay) or "MODEL" (a live session), then turns, steps (or requests), tool calls and LayerFS calls. Then the auto-checkpoints, "of N in the session" when other agents made more, with counts by write kind. A live session adds tokens ("12k in · 3.1k out"), cost and model time. "N failed" shows in red; "counts cover the N newest of M rows" shows when earlier rows are not loaded.
3. **Toolbar** (`Toggle`, `runs/trace-view.tsx`): the search keeps matching rows (with their tool row) and opens their turns. "LayerFS calls" shows every tool call's LayerFS rows; "Failures" keeps only failed rows. "Expand all" and "Fold all" are off while filtering. Stats and toolbar stay pinned at the top while you scroll.
4. **Turn** (`TraceView`, `runs/trace-view.tsx`): a card per turn, "Setup" (turn 0) or "Turn N", with the turn's opening prompt and its steps, calls, failures and duration. A click folds it. With more than 4 turns, only Setup and the last turn start open.
5. **Row** (`Row`, `runs/trace-view.tsx`): a status dot (green ok, red failed, pulsing while running, amber stopped) and a kind tag. Tags: SYSTEM, USER, CONTEXT, MODEL (SCRIPT for a scripted step, REPLY for a final one), TOOL (or the tool's name, e.g. MESSAGE), SUBAGENT, LAYERFS, CHECK. Then the title, which opens the Detail. On the right: tokens in->out, "exit N", the checkpoint chip, the `[= N]` LayerFS-calls button, the duration, and on hover the time since the session started ("+1 m 02 s").
6. **CheckpointChip** (`CheckpointChip`, `runs/trace-view.tsx`): "Auto-checkpoint(s)" and up to four numbered links. Each opens the project's History on that write's Commit, Layer or Branch. More than four become one range pill ("#3–#8 v") that opens the row's list. Refused writes show "N refused".
7. **LayerFS rows** (`Row` with kind `layerfs`): a tool call's LayerFS calls, indented and in mono: method, write icon, outcome and arguments. Shown by the row's `[= N]` button, the "LayerFS calls" toggle or a search.
8. **Detail** (`Detail` and `Writes`, `runs/trace-view.tsx`): labelled blocks: ERROR, THINKING, the text (COMMAND highlighted, or TEXT, SAYS, TASK, PROMPT, MESSAGE), then the writes, OUTPUT, ARGUMENTS and CHECKS. The writes list is headed "AUTO-CHECKPOINTS #9-#10" ("REFUSED WRITES" when none landed). Each write shows its number, kind (BRANCH WRITE, WORKSPACE COMMIT, FORK, MERGE, PUBLISH, INIT) and a `HistoryLink` pill (Commit or Layer id, or Branch) into History. Then what it did, outcome, "+bytes" stored, duration and message. A note marks numbers that other agents' checkpoints took in between. A model row's detail opens with model, stop reason, tokens and cost.

Notation: `{TAG}` is a kind tag, `[#9 >]` a link into History, `( )` a toggle, `[= N]` the LayerFS-calls button.

## States

- **Loading**: "Reading the trace...".
- **Error**: "Trace did not load: <message>".
- **Long session**: pages load from the newest 300 rows; "Load earlier (N more)" sits above the first turn.
- **Live**: the trace re-reads on the session's events, at most once a second; rows still running pulse.
- **No match**: a search or "Failures" that keeps nothing shows "No rows match.".
