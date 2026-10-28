# Project: Live

The project's working sessions as one live diagram: agents on the left, the LayerFS project in the middle, Sandboxes on the right, and every LayerFS call drawn as it travels. Opens from: a project's name in the sidebar, or its card on the LayerFS page (Live is the first tab).
Source: `src/renderer/src/components/runs/live-tab.tsx` (main file; others named in Regions).

## Skeleton

```text
+-[1] Tab row -------------------------------------------------------------------------------------+
| Live   Timeline   History   Storage   Sandboxes                |  Sessions 28   [ > Replay | v ] |
| ====                                                                                             |
+--------------------------------------------------------------------------------------------------+
+-[2] StatTile row --------------------------------------------------------------------------------+
|  [A] 3            | [~] 1            | [S] 5            | [W] 4              | [C] 183           |
|  agents working   | calls in flight  | Sandboxes open   | Workspaces mounted | Commits           |
+--------------------------------------------------------------------------------------------------+
+-[3] FlowGraph -----------------------------------------------------------------------------------+
|                                                                                                  |
| [4] AGENTS 4 -----------------------                          [4] SANDBOXES 5 ------------------ |
| +-[5] SessionGroup ----------------+                          +-[8] SandboxNode ---------------+ |
| | v * /crew_2 3 agents - 2 working |  +-[7] HubNode -------+  | [S] Sandbox 1  crew_2-sbx    * | |
| | +-[6] AgentNode ---------------+ |  |       (/\)         |  |     made by builder            | |
| | | [c] crew              2 >  * | |--|    playground      |  |--------------------------------| |
| | |     ~ branch.fork main  0.4s | |  |  (local SQLite)    |--| W /work [b main]     * builder | |
| | +------------------------------+ |  | +-------+--------+ |  |   ~ exec npm test         1.2s | |
| |   +- AgentNode ----------------+ |  | |  L9   |  134   | |  +--------------------------------+ |
| |   | [b] builder              * | |--| | main  |Branches| |  +-[9] SandboxLine ---------------+ |
| |   |     ~ workspace.exec  1.2s | |  | +-------+--------+ |--| Sandbox 2 /depot_2 1 Workspace | |
| |   +----------------------------+ |  | b main           0 |  +--------------------------------+ |
| |   +- AgentNode ----------------+ |  | b agents_1.main  1 |  +- SandboxLine ------------------+ |
| |   | [d] docs                 * | |--| b crew_1.lead    4 |  | Sandbox 3 /shop_2 no Workspace | |
| |   |     fs.write  3 s ago      | |  | b crew_1.build   2 |  +--------------------------------+ |
| |   +----------------------------+ |  | ...                |  ...                                |
| +----------------------------------+  +--------------------+                                     |
| +- SessionGroup -------------------+                                                             |
| | > * /depot_2                     |                                                             |
| |     1 of 2 agents working [d][r] |                                                             |
| +----------------------------------+                                                             |
|                                                                                                  |
+--------------------------------------------------------------------------------------------------+
+-[10] Legend -------------------------------------------------------------------------------------+
| Each agent has only bash and the subagent tools. Its layerfs calls go straight to the            |
| project's Store, through the Branch they touch; a Workspace mounts a Branch inside a             |
| Sandbox, where workspace exec runs. A dot goes out with each call and comes back green,          |
| or red when it failed.                                                                           |
|                ooo A call, in its agent's colour   * Came back   * Failed   -- Workspace mounted |
+--------------------------------------------------------------------------------------------------+
```

## Regions

1. **Tab row** (`ProjectPage`, `projects/project-view.tsx`): the project page's first row (the sidebar names the project): Live, Timeline, History, Storage, Sandboxes, then Sessions with its count, then `ReplayControl` (`runs/replay-control.tsx`), shown once the demo is read. "Replay" starts a new session; its menu has "View scenario" and, while a session plays, "Stop session". Every tab reads the project's newest session (`RunPanel`, `runs/run-view.tsx`).
2. **StatTile row** (`StatTile`, `runs/live-tab.tsx`): agents working, calls in flight, Sandboxes open, Workspaces mounted, Commits. Numbers count up; the first two glow while above zero.
3. **FlowGraph** (`FlowGraph`, `runs/live-tab.tsx`; `FlowEngine`, `runs/live-flow.ts`): one SVG over the cards. Each call sends a dot from its agent, in the agent's colour, through the Branch row it touched (on to the Workspace or Sandbox for workspace and sandbox calls), and back green, or red when it failed. Mounted Workspaces keep a resting lane; tree guides join subagents to their parent.
4. **ZoneLabel** (`ZoneLabel`, `runs/live-tab.tsx`): the "Agents" and "Sandboxes" headings, with a count once there is something to count.
5. **SessionGroup** (`SessionGroup`, `Avatars`, `runs/live-tab.tsx`): one group per working session. Its header shows a chevron, live dot, folder, "3 agents · 2 working", and a "this session" chip on the watched one. Other sessions start folded to "1 of 2 agents working" with small avatars, the busy ones lit. A lone session has no header.
6. **AgentNode** (`AgentNode`, `runs/live-tab.tsx`): one card per active agent, indented by depth: avatar, name and state dot. Under it is the call in flight (spinner, method, target, time); with none, its activity or last call ("fs.write · 3 s ago", red with its code when it failed). A parent has a fold toggle ("2 >"). A folded parent shows its subagents' avatars and "2 subagents · 1 working". A click opens the agent's conversation.
7. **HubNode** (`HubNode`, `runs/live-tab.tsx`): the project: the LayerFS mark, its name, "LayerFS project · local SQLite" (only "local SQLite" when narrow), main's Layer ("L9") and the Branch count, then the open Branches, main first, with Commit counts. Calls pass through these rows.
8. **SandboxNode** (`SandboxNode`, `runs/live-tab.tsx`): an open Sandbox: "Sandbox 1", its name, "made by builder" and the maker's dot. Each Workspace row has its path, Branch chip and mounting agent, then the running `workspace exec` (command, time), else "idle · last <command> <exit>" or "idle · mounted 3 s ago", plus "· N commits". It reads "No Workspace mounted" when empty.
9. **SandboxLine** (`SandboxLine`, `runs/live-tab.tsx`): past four Sandboxes, a quiet one (no command running, not the watched session's) is one line: "Sandbox 2", its session or state, "1 Workspace". A click opens its card.
10. **Legend** (`Legend`, `runs/live-tab.tsx`): the footer: the agents' tools and the path of a call, and the key: "A call, in its agent's colour", "Came back", "Failed", "Workspace mounted".

## States

- **Idle** (no session working; the screenshot): `IdleAgents` shows "No agent working", "The last finished 3 h ago", a dashed sketch of a tree and "Replay starts a session. Its agents show here as a tree, and every call they make travels to the project." `IdleSandboxes` shows "No Sandbox open" and "One opens when an agent creates it to mount a Workspace." Faint lines join both to the hub; the zone counts are hidden.
- **Playing**: a pulsing dot before "Live" and a live line under the tab row; `ReplayControl` shows a progress ring and "76/535" ("Starting..." first) and opens the playing session; the hub's border is lit; the project is reread every 2 s.
- **Many sessions** (more than 3): each folded session is one line: chevron, dot, folder, "this session", a progress bar and "working/total" ("waiting" when queued, its end state when ended). The watched one comes first, then playing, then ended.
- **Many Sandboxes** (more than 4): quiet ones become `SandboxLine`s; past 10 lines "+N more" / "Show fewer"; "Fold the Sandboxes I opened" after opening some.
- **Hub before the project is read**: a dashed box with "Reading..." or the session's phase.
- **Folds**: kept per project; subagents from the third level start folded.
- **No session**: in place of any tab, an `Empty` card "<project> has no sessions yet" with the Replay control, or "Sessions are not readable right now". Loading reads "Reading the sessions", then "Loading this session...", and after 4 s "Still loading this session: the host is slow to answer while LayerFS is busy." `RunError` shows "Could not load this run" with [ Try again ], or "This run no longer exists".
