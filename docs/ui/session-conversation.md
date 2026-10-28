# Session: Conversation

One agent's thread in a session, as a chat, with the box to talk to the project's agent under it. Opens from: a session row in the sidebar or on the project's Sessions tab, an agent on the Live tab, or a new session (or `CONNECT_VIEW=runs/<session id>[/<agent>]`).
Source: `src/renderer/src/components/runs/run-view.tsx` (main file; others named in Regions).

## Skeleton

A replay of the Checkpoints scenario, root agent, one call opened:

```text
+-[1] SessionBar ------------------------------------------------------------------------------+
| [ playground ] / [2][ * root v ]       [3] REPLAY - CHECKPOINTS - 1 m 08 s - started 3 h ago |
| [4] Conversation   Trace                                                                     |
|     ============                                                                             |
+-[5] Conversation ----------------------------------------------------------------------------+
|                  +-[6] UserMessage --------------------------------------------------------+ |
|                  | Build up main in four ranges. In each range have two subagents fork ... | |
|                  +-------------------------------------------------------------------------+ |
| [7] Both lanes of range 3 are done: merging and publishing.                                  |
| [8] Done in 1.2 s - 2 calls - * branch 1  * fs 1                                             |
| +------------------------------------------------------------------------------------------+ |
| | * Range 3: merge the lanes and publish     {* branch.merge} {* branch.publish}  320 ms v | |
| | * Range 3: verify the checkpoint                                   {* fs.glob}  186 ms v | |
| |     +-[9] StepBlock -------------------------------------------------------------------+ | |
| |     | $ layerfs fs glob 'range-3/**' --branch main                       -> ok - 12 ms | | |
| |     | range-3/a01/one.txt                                                              | | |
| |     | range-3/a01/two.txt                                                              | | |
| |     | ... 2 more lines                                                                 | | |
| |     | exit 0                                                                           | | |
| |     +----------------------------------------------------------------------------------+ | |
| +------------------------------------------------------------------------------------------+ |
| [10] (-> Message to * a01: Go on with range 4.)  (-> Message to * a02: Go on with range 4.)  |
| +-[11] ReceivedCard -----------------------------------------------------------------------+ |
| | Reply from a01   a01: done.                                                   03:54:45 v | |
| +------------------------------------------------------------------------------------------+ |
| [12] All four ranges reached their checkpoints; every gate passed.                           |
|      03:54:56                                                                                |
+-[13] Composer -------------------------------------------------------------------------------+
| Ask an agent to work on playground...  (/ for commands)                                      |
|                                                                                              |
| [14][ * ChatGPT - gpt-6.1-sol v ]       [15] 5 turns - 21 steps - Enter to send - ...  [ ^ ] |
+----------------------------------------------------------------------------------------------+
```

## Regions

1. **SessionBar** (`SessionBar` and `SessionPage`, `runs/run-view.tsx` and `projects/project-view.tsx`): one breadcrumb row. The project crumb goes back to the project page; on hover it names the session ("/crew_2 · started 3 h ago"). When a subagent is shown, its ancestors come between as crumbs ("playground / root / a01"), and "N subagents running" follows while any of the shown agent's subagents run.
2. **AgentSwitcher** (`AgentSwitcher`, `runs/agent-switcher.tsx`): the shown agent's colour dot (pulsing while it runs) and name. Its menu lists every agent started so far as a tree, with state dot and current activity.
3. **Facts** (`SessionPage`, `projects/project-view.tsx`): a replay shows "REPLAY · <scenario>", its duration and "started 3 h ago". A live session shows a "Working" chip while it runs, then its model and "started ...".
4. **Session tabs** (`Tab`, `components/motion/tabs.tsx`): Conversation and Trace; Trace replaces the thread and composer with [session-trace.md](session-trace.md) for the same agent.
5. **Conversation** (`Conversation`, `runs/conversation.tsx`): the shown agent's turns in a centred column, windowed by turn (`WindowedScroller`, `runs/windowed-list.tsx`). A session opens at its newest turn and follows it while it plays. Its items follow.
6. **UserMessage** (`UserMessage`, `runs/thread-items.tsx`): what the user sent, a bubble on the right.
7. **SayText** (`SayText`, `runs/thread-items.tsx`): what the agent says before its calls. Text that arrives while you watch streams in word by word.
8. **CallsFold** (`CallsFold`, `runs/thread-items.tsx`): a turn's tool calls, one row each (`StepRow`): a status dot, the call's title, up to 3 `KindChip` method chips (`runs/run-badges.tsx`, "+N" beyond), its duration and a v chevron. Two or more calls get a summary line ("Done in 1.2 s · 2 calls" and kind counts). Past 6 rows, "Show N more calls" folds the rest.
9. **StepBlock** (`StepBlock`, `runs/blocks.tsx`): an opened row. The script, its LayerFS calls marked on their lines ("-> ok · 12 ms"), then output folded to a head ("N more lines"), and a footer with "exit N" and any other calls. On hover: "BASH" / "CLI" / "NODE · SDK" and a copy button. A failed call opens by default.
10. **ThreadChip** (`ThreadChip`, `runs/thread-items.tsx`): a subagent tool as a pill, "Started a01", "Message to a01: ..." or "Interrupted a01"; a click opens that agent.
11. **ReceivedCard** (`ReceivedCard`, `runs/thread-items.tsx`): a message the agent got, folded to a title ("Task message received", "Reply from a01", "Message from ...") with the text and time. It opens to the full text.
12. **ReplyText** (`ReplyText`, `runs/thread-items.tsx`): the agent's reply, with its clock time under it.
13. **Composer** (`Composer`, `runs/composer.tsx`): a textarea that grows to a third of the window. Enter sends; Shift+Enter adds a new line. In a live session the message is the agent's next turn; on a replay it starts a new live session on the project. A send error shows under the box, with "Open Models" when no model is set up.
14. **ModelChip** (`ModelChip`, `runs/composer.tsx`): the next message's model ("ChatGPT · gpt-6.1-sol", amber "No model" when none); a dot marks a changed pick. Its menu lists each provider's models, then "Manage models...", which opens the Models dialog.
15. **Hint and send** (`Composer`, `runs/composer.tsx`): the thread's size ("5 turns · 21 steps"), the key hints, then the round send button.
16. **SlashMenu** (`SlashMenu`, `runs/composer.tsx`): opens above the composer on "/"; see States.
17. **DraftSession** (`DraftSession`, `projects/project-view.tsx`): a new conversation before its first message; see States.

Notation: `{* name}` is a chip, `@` a spinner, `[ ^ ]` the send button, `[ # Stop ]` the stop button.

## States

**Live session** (a conversation with a model): the header shows the "Working" chip and the model. "Thinking..." (`ThinkingLine`) ends the thread while the agent is between steps. A running call shows a spinner in its row, and its group reads "Running...". While the agent works, the placeholder says so and Stop replaces send.

```text
+-[1] SessionBar ------------------------------------------------------------------------------+
| [ playground ] / [ * root v ]         {* Working}  * ChatGPT - gpt-6.1-sol - started 3 h ago |
| [4] Conversation   Trace                                                                     |
|     ============                                                                             |
+-[5] Conversation ----------------------------------------------------------------------------+
|                                                                                       +----+ |
|                                                                                       | hi | |
|                                                                                       +----+ |
| Hi! What would you like to work on?                                                          |
| 04:08:30                                                                                     |
|                                                            +-------------------------------+ |
|                                                            | Merge range 1 and publish it. | |
|                                                            +-------------------------------+ |
| @ Thinking...                                                                                |
+-[13] Composer -------------------------------------------------------------------------------+
| The agent is working... Stop it to send another message                                      |
|                                                                                              |
| [ * ChatGPT - gpt-6.1-sol v ]             2 turns - 1 step - Enter to send - ...  [ # Stop ] |
+----------------------------------------------------------------------------------------------+
```

**Slash menu** (`SlashMenu` in `runs/composer.tsx`): typing "/" lists COMMANDS ("/scenario <name>  Play a scenario here, in a folder of its own"). After "/scenario " it lists "All scenarios" and every scenario, filtered as you type. Up and Down pick, Enter or Tab plays, and Escape closes it. Each scenario plays as a session of its own, in a folder `/<scenario>_<n>/`.

```text
+-[16] SlashMenu ------------------------------------------------------------------------------+
| PLAY ON PLAYGROUND, EACH IN A FOLDER OF ITS OWN                                              |
| All scenarios   all                          11 at once, each in its own folder and Branches |
| Checkpoints     checkpoints               A small history replay in four ranges. In each ... |
| Conflicts       conflicts                  Both conflict kinds, resolved. A Workspace on ... |
| ...                                                                                          |
+----------------------------------------------------------------------------------------------+
+-[13] Composer -------------------------------------------------------------------------------+
| /scenario                                                                                    |
|                                                                                              |
| [ * ChatGPT - gpt-6.1-sol v ]                   1 turn - 1 step - Enter to send - ...  [ ^ ] |
+----------------------------------------------------------------------------------------------+
```

**Draft session** (`DraftSession` in `projects/project-view.tsx`): a new conversation, not started yet. The breadcrumb reads "project / New session", and the empty page asks "What should the agent do on <project>?" over a focused composer. The first message starts a live session and opens it. If the project has no LayerFS state yet, the text asks for `/scenario <project>` instead.

```text
+-[17] DraftSession ---------------------------------------------------------------------------+
| [ playground ] / New session                                                                 |
+----------------------------------------------------------------------------------------------+
|                                                                                              |
|                           What should the agent do on playground?                            |
|       It works on the project as it is now, through layerfs, and can start subagents.        |
|               Type /scenario to reset the project and play a scenario instead.               |
|                                                                                              |
+-[13] Composer -------------------------------------------------------------------------------+
| Ask an agent to work on playground...  (/ for commands)                                      |
|                                                                                              |
| [ * ChatGPT - gpt-6.1-sol v ]        Enter to send - Shift+Enter for a new line - ...  [ ^ ] |
+----------------------------------------------------------------------------------------------+
```

- **Loading**: "Loading this session..." over skeleton cards; after 4 s it says the host is slow while LayerFS is busy.
- **Error**: "Could not load this run" with "Try again", or "This run no longer exists".
- **Empty thread**: "<agent> ran no steps in this run". While the session plays: "Waiting for <agent> to start...", or the setup phase, or a queued session's phase with "It plays when one of them ends."
- **Run error**: a red alert with the session's error above the thread.
