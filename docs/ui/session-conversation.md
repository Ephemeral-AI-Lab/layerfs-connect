# Run page: Conversation and Checks

One scenario run, under its project: its conversation agent by agent, its checks, and its Trace
([session-trace.md](session-trace.md)), with Stop while it plays. Opens from: a run row in the
sidebar or on the project's Sessions tab, an agent in the Live diagram on the Sessions tab, Play scenario, `/scenario` in a
chat, or `CONNECT_VIEW=runs/<run id>[/<agent>]`.
Source: `src/renderer/src/components/runs/run-view.tsx` (main file; others named in Regions).
Routing: App's selection `{ kind: 'project', id: <project key>, run, agent }`; the
`#runs/<id>[/<agent>]` start hash reads the run (`host.run`) to find its project.

## Skeleton

```text
+-[1] PageHeader ------------------------------------------------------------------------------+
| < shop                                                                                       |
| [A] crew_2  (* Running)                                                           [ ■ Stop ] |
| (Crew) (2 m 05 s started 2 min ago) (31/96 steps) (/crew_2/ folder)                          |
| Conversation   Checks 3   Trace                                                              |
| ============                                                                                 |
+~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~+
+-[2] Agent row -------------------------------------------------------------------------------+
| root / [ * lead v ]  (* 1 subagent running)                                 3 turns · 9 steps |
+-[3] Conversation ----------------------------------------------------------------------------+
|                                   +-------------------------------------------------------+ |
|                                   | Build the shop's checkout and land it on main.        | |
|                                   +-------------------------------------------------------+ |
| +------------------------------------------------------------------------------------------+ |
| | > Task message received   Build checkout on a branch of your own…              12:04  v | |
| +------------------------------------------------------------------------------------------+ |
| I'll fork a Branch for the checkout work first.                                              |
| +------------------------------------------------------------------------------------------+ |
| | Done in 4.2 s                          {* branch.fork} {* workspace.exec}             v | |
| +------------------------------------------------------------------------------------------+ |
| (-> Started * tester)                                                                        |
| +-[ok] Checkout is on crew_2.lead and passes its tests. ---------------------------- 12:06 +|
+----------------------------------------------------------------------------------------------+
```

## Regions

1. **PageHeader** (`RunBody`): a back link to the project; a `HeroTile` (lit while it plays), the
   run's name in mono (`runName`), and a `RunStateBadge`, or a "Queued" chip while it waits its
   turn. Facts: the scenario's title, the duration with "started … ago", steps done/of, and the
   run's folder (its files are under `/<folder>/`, its Branches `<folder>.<name>`). Stop
   (`host.stopRun`) while it plays. Tabs: Conversation, Checks (a red count of failures, else the
   number of final checks) and Trace. The run's error, or a failed Stop, shows as an alert under
   the facts. A live line runs under the header while it plays.
2. **Agent row**: the shown agent's ancestors as links, then `AgentSwitcher`
   (`runs/agent-switcher.tsx`): the agent's colour dot (pulsing while it runs) and name, opening to
   every agent started so far, parent before child, each with its state dot and activity
   ("workspace.exec · 2.2 s", "thinking · 1.4 s", "done · 3 min ago"). "N subagents running" counts
   the agent's running descendants. Picking an agent sets the selection's `agent`. The thread size
   ("3 turns · 9 steps") sits on the right of the Conversation tab.
3. **Conversation** (`Conversation`, `runs/conversation.tsx`, windowed by turn with
   `runs/windowed-list.tsx`): the chat's look. Root opens with the user's request
   (`UserMessage`); turns hold received messages (`ReceivedCard`, folded), what the agent says
   (`SayText`, streamed in when it arrives while watched), its tool calls folded per turn
   (`CallsFold`, a failed call opens), subagent chips (`ThreadChip`, which open that agent) and its
   reply (`ReplyText`). These come from `runs/thread-items.tsx` and `runs/blocks.tsx`, which Chat
   shares. While it plays, the thread follows the newest turn; scrolling up stops that and shows
   "Jump to the latest".

## Checks tab

`Checks` in `run-view.tsx`: "Final checks" (the run's `checks`, `main.landed` first, with a line on
what it means: the run's trunk Branch joined the project's main once it passed), then "Failed step
checks" (each step check that failed, with its `<agent>:<index>`). Each row: a pass or fail icon,
the check's name in mono and its detail. While the run plays and no check has run yet: "Checks run
when the session ends".

## States

- **Loading**: `Loading` ("Reading the session").
- **Error**: `LoadError` with Try again.
- **Gone**: "This session is not available" with Back to the project, after a 404, a
  `run-removed` event, or for an old live Pi session record.
- **Waiting**: before an agent's first step, "Waiting for <agent> to start…"; while queued, its
  phase and "It plays when one of the heavy scenarios playing now ends."; while starting, its
  phase ("Setting up its folder…").
- **Live**: `useRun` (`runs/use-run.ts`) loads the run once, then applies the host's events once
  per animation frame.
