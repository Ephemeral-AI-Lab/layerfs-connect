# Project page: Live tab

Part of the project page (project.md).

Source: `src/renderer/src/components/live/` (`live-tab.tsx`, `live-nodes.tsx`, `live-flow.ts`,
`live-model.ts`, `live-data.ts`, `live-bindings.ts`, `run-badges.tsx`, `run-format.ts`, `live.css`)
Opens from: project page tab Live (`project-view.tsx:150`); the page opens on it when a chat works.

Paths in legends are relative to `src/renderer/src/components/live/`.

## Live tab

Sample: chat "Add login tests" works on `shop/api`; its `root` agent runs `npm test` in Workspace
`feature-login` of Sandbox `api-dev` (native); a subagent `tester` sits between calls. The overview
wraps some one-line rows; the zoom-ins below show each card's real row layout.

```text
+-[1] Header -------------------------------------------------------------------------------------+
| * Live   1 chat working - 1 call in flight              -> Request   <- Succeeded   x Failed    |
+-[2] Error strip (only when the Sandbox read fails) ---------------------------------------------+
| Could not load sandboxes.  [Retry]                                                              |
| > Details                                                                                       |
+-[3] Flow field ---------------- [7] zone labels on the first row -------------------------------+
| Agents (2)                        LayerFS                       Sandboxes (1)                   |
|                                                                                                 |
| +-[4] ----------------------+     +-[5] ------------------+     +-[6] ------------------------+ |
| | v * Add login tests  [^]  |     | [L] api               |     | <sb> Sandbox api-dev        | |
| | (R) root    Calling  1 >  |==+  |     SQLite - 96 KB    |     |      running      <ws> 1    | |
| |    @ Run command npm test |  |  |  L0      3        4   |     +-----------------------------+ |
| |  (t) tester Between calls |  |  | main Branches Commits |  +=>| <ws> /workspaces/featu...   | |
| +---------------------------+  |  | --------------------- |  |  |      (feature-login) * root | |
|                                |  | (main              0) |  |  |   @ (exec) npm test   2.1 s | |
|                                |  |  * Add login tests    |  |  +-----------------------------+ |
|                                +=>| (feature-login     3) |==+                                  |
|      [8] lanes  ==, packets >     | +1 other open Branch  |                                     |
|                                   +-----------------------+                                     |
+-------------------------------------------------------------------------------------------------+
  [9] [+3 more]      only past 12 shown sessions; reads [Show fewer] when open
```

| [n] | Component | file:line | one line |
|---|---|---|---|
| [1] | header | live-tab.tsx:150 | Dot (accent while a chat plays), "Live", summary, legend |
| [2] | error strip | live-tab.tsx:171 | Sandbox read failed; Retry rereads; Details: message |
| [3] | FlowGraph | live-tab.tsx:217 | 5-column grid, min 880px (scrolls sideways), dotted field |
| [4] | SessionGroup | live-nodes.tsx:147 | One per shown chat; working ones first, then newest |
| [5] | HubNode | live-nodes.tsx:415 | The project: Store, counts, open Branch rows |
| [6] | SandboxNode | live-nodes.tsx:493 | One card per open Sandbox; lines when there are many |
| [7] | ZoneLabel | live-nodes.tsx:37 | Agents / LayerFS / Sandboxes; count pill unless empty |
| [8] | FlowEngine | live-flow.ts:98 | SVG overlay: agent -> Branch row -> Workspace or Sandbox |
| [9] | more sessions | live-tab.tsx:191 | "+{n} more" / "Show fewer"; resets on project change |

Summary pieces (joined with " - "): "{n} chat(s) working" or "No chat working", "{n} ended
recently" (only when some ended), "{n} call(s) in flight". Legend icons: ArrowRight "Request",
ArrowLeft "Succeeded", X "Failed".

### The five columns and the lanes

```text
  col 1: Agents        col 2: gap      col 3: LayerFS      col 4: gap      col 5: Sandboxes
  16-22rem             >= 3.5rem       13-16rem            >= 3.5rem       16-25rem

  [agent card] ==+                                     +==> [Workspace row]   still lane: mount
                 +=====> (Branch row) ==================+                     or binding [a]
  [agent card] --+-->  ........ hub middle ........> [Sandbox card]    call without a Branch [b]
  [agent card] ======> (Branch row)                                           binding only [c]
  [child]  |                                                                  tree guide [d]
  [ghost agents] - - - - - - [hub] - - - - - - [ghost sandboxes]               ghosts [e]
```

| [n] | Component | file:line | one line |
|---|---|---|---|
| [a] | scene.mounts | live-tab.tsx:276 | A mounted Workspace's lane, via its Branch row if shown |
| [b] | routeOf | live-model.ts:213 | A call's route; `agent.*` and `job.*` calls draw nothing |
| [c] | bindings | live-tab.tsx:229 | Agent joined to its Branch (Workspace's, else last call's) |
| [d] | scene.tree | live-tab.tsx:292 | Guides from a subagent card to its parent's card |
| [e] | scene.ghosts | live-tab.tsx:296 | Faint dotted joins to the idle placeholders |
| - | useTraffic | live-tab.tsx:394 | Chevron out in the agent's colour, back green or red |

Lanes keep their geometry; a running call brightens its lane (`.live-link[data-active]`), hover or
focus on a node isolates its lanes and dims the rest. Calls finished over 5 s ago are not drawn, nor
calls already there when a session first shows. A folded card or ancestor stands in as the origin.

## SessionGroup

Open (the newest two playing chats start open; a lone chat is never folded):

```text
+-[1] ------------------------------------------------+
| [2] v * Add login tests                         [^] |   [^] = [3] Open chat
| [4] (red run.error line, when the chat has one)     |
| [5] (R) root ...                                    |
| [5]     (t) tester ...                              |
+-----------------------------------------------------+
```

Folded, up to 3 sessions shown (two lines):

```text
+-[6] ------------------------------------------------+
| > * /shop_2                          [7] ####-- 3/5 |
|     2 agents - 1 calling                [8] (R)(t)  |
+-----------------------------------------------------+
```

Folded, more than 3 sessions shown (one line each):

```text
[ > * Fix orders total ................................ Ended ]   [9]
```

| [n] | Component | file:line | one line |
|---|---|---|---|
| [1] | open group | live-nodes.tsx:211 | Ring-outlined group; anchor `session-<run id>` |
| [2] | head | live-nodes.tsx:161 | Chevron, RunDot, name (scenario: "/shop_2", mono); folds |
| [3] | Open chat | live-nodes.tsx:223 | Icon button "Open chat {name}"; opens the chat |
| [4] | run.error | live-nodes.tsx:233 | Red text under the head |
| [5] | AgentNode | live-nodes.tsx:289 | Each visible agent; see below |
| [6] | folded card | live-nodes.tsx:189 | One button; click opens; ringed while an agent calls |
| [7] | Progress | live-nodes.tsx:114 | Bar + "done/of", "waiting its turn", Ended/Failed/Stopped |
| [8] | Avatars | live-nodes.tsx:102 | Up to 6 initials, busy ones lit, then "+N" |
| [9] | dense line | live-nodes.tsx:171 | Name and Progress; agents line in the tooltip |

Progress shows nothing for a working ordinary chat (`of` is 0); scenario chats have steps.

## AgentNode

```text
+-[1] ----------------------------------------------------------+
| (R) root                              [2] Calling   [3] 1 >   |
|     [4] @ Run command   npm test                      2.1 s   |
|     [4] @ Write file    feature-login                 0.4 s   |
|     [5] (t)(d) 2 subagents - 1 calling                        |
+---------------------------------------------------------------+
    (t) tester                                   Between calls      24px indent per level, max 4
        [6] <ok> Read file                       2 minutes ago
```

| [n] | Component | file:line | one line |
|---|---|---|---|
| [1] | agent button | live-nodes.tsx:305 | Avatar (ringed while calling), name; opens the chat |
| [2] | status | live-nodes.tsx:297 | Calling/Thinking/Call failed/Stopped/Done/Between calls |
| [3] | subagent fold | live-nodes.tsx:350 | Count + chevron; "Show/Fold {agent}'s subagents" |
| [4] | running calls | live-nodes.tsx:318 | Spinner, label, target (command/path/Branch), elapsed |
| [5] | folded kids | live-nodes.tsx:343 | When folded: avatars, "{n} subagents - {n} calling" |
| [6] | last call | live-nodes.tsx:328 | Check/X, label, ago; "No call yet"; "thinking - 3.2 s" |

Labels come from `CALL_LABEL` (`live-nodes.tsx:260`: Run command, Mount workspace, Read file,
Create branch, ...); other methods show raw. Subagents from the third level start folded.

## HubNode

```text
+-[1] ----------------------------------------+
| [L]  api                                    |
|      SQLite - 96 KB                    [2]  |
|                                             |
|       L0          3             4      [3]  |
|      main      Branches      Commits        |
|  -----------------------------------------  |
|  ( <br> main                           0 )  |  [4]
|                                             |
|    * Add login tests                   [5]  |
|  ( <br> feature-login                  3 )  |
|  +1 other open Branch                  [6]  |
+---------------------------------------------+
```

| [n] | Component | file:line | one line |
|---|---|---|---|
| [1] | HubNode | live-nodes.tsx:415 | LayerfsMark (flashes when a call lands), name `api` |
| [2] | Store line | live-nodes.tsx:427 | "SQLite" or "PostgreSQL", then the Store's size |
| [3] | counts | live-nodes.tsx:433 | "L{n-1}", Branches, Commits; "Reading..." until read |
| [4] | BranchRow | live-nodes.tsx:384 | Pill: icon, name, Commit count; agent's colour outline |
| [5] | chat rows | live-nodes.tsx:461 | RunDot + chat, its Branches; `<folder>.main` reads "main" |
| [6] | others | live-nodes.tsx:474 | "+{n} other open Branch(es)" no shown chat uses |

The rows list ("Open Branches") scrolls past 14rem. Only open Branches get rows.

## SandboxNode and SandboxLine

```text
+-[1] ----------------------------------------------------------------+
| <sb> Sandbox api-dev   running                               <ws> 1 |  [2]
+---------------------------------------------------------------------+
| <ws> /workspaces/feature-login   ( <br> feature-login )      * root |  [3]
|      @ (exec) npm test                         2.1 s - 2 Commits    |  [4]
+---------------------------------------------------------------------+
| sandbox.create                                               0.8 s  |  [5]
+---------------------------------------------------------------------+
```

Second-line variants of a Workspace row [4]:

```text
|      @ (exec) npm test   by tester                           2.1 s  |  exec by another agent
|      idle - last  npm test                                  exit:0  |  kind not exit:0 = warning
|      idle - mounted 4 minutes ago                                   |  mounted, nothing run
| <ws> /workspaces/feature-login   ( <br> feature-login )       idle  |  not mounted: no 2nd line
| <ws> No mounted workspaces                                          |  [6]
```

SandboxLine (more than 4 Sandboxes: each one not running a command):

```text
[ <sb> Sandbox api-dev   Add login tests                       <ws> 1 ]   [7]
  [+2 more]                                                               [8]
  [Fold the Sandboxes I opened]                                           [9]
```

| [n] | Component | file:line | one line |
|---|---|---|---|
| [1] | SandboxNode | live-nodes.tsx:493 | Card; ringed in the agent's colour while called |
| [2] | header | live-nodes.tsx:517 | "Sandbox {id}", "made by {agent} - <chat>" or state, count |
| [3] | Workspace row | live-nodes.tsx:536 | Path (last 2 parts), Branch chip, agent or "idle" |
| [4] | exec line | live-nodes.tsx:564 | (exec) + command, or idle text; ". {n} Commits" if any |
| [5] | other calls | live-nodes.tsx:590 | Calls here outside its Workspaces: raw method, elapsed |
| [6] | no Workspaces | live-nodes.tsx:523 | Italic "No mounted workspaces" |
| [7] | SandboxLine | live-nodes.tsx:601 | id, maker chat or state, count; click opens its card |
| [8] | rows more | live-tab.tsx:369 | Past 10 lines: "+{n} more" / "Show fewer" |
| [9] | fold opened | live-tab.tsx:376 | Puts clicked-open cards back to lines |

## IdleAgents and IdleSandboxes

```text
+ - [1] - - - - - - - - - - - - - - - - - - +            + - [2] - - - - - - - - - - - - +
: <agent>  No agent working                 : - - [hub] - - : <sb>  No Sandbox open       :
:          The last chat, Add login tests,  :            + - - - - - - - - - - - - - - - +
:          ended 6 minutes ago              :
+ - - - - - - - - - - - - - - - - - - - - - +
```

| [n] | Component | file:line | one line |
|---|---|---|---|
| [1] | IdleAgents | live-nodes.tsx:47 | Dashed card when no session shows; the tab's idle note |
| [2] | IdleSandboxes | live-nodes.tsx:64 | Dashed card when no Sandbox is open |

## Folds and more sessions

```text
localStorage "connect.live.folds:<project>"  { "s:<run id>": true, "a:<scenario>:<agent>": false }
```

- A session's fold is keyed by run id; an agent's by scenario + name, so the next run keeps it.
  At most 200 entries kept (`live-tab.tsx:74`). Session folds apply only with 2+ sessions.
- Up to 12 sessions draw (`MAX_SESSIONS`); "+{n} more" shows the rest, "Show fewer" hides them.

## States

No chats yet (the `mac` world as seeded):

```text
| * Live   No chat working - 0 calls in flight            -> Request   <- Succeeded   x Failed   |
| Agents                            LayerFS                       Sandboxes (1)                   |
| + - - - - - - - - - - - - -+      +-----------------------+     +-----------------------------+ |
| : <agent> No agent working : - - -| [L] api               |     | <sb> Sandbox api-dev        | |
| :  No chat has worked in L.:      |  ...                  |     +-----------------------------+ |
| + - - - - - - - - - - - - -+      | (main              0) |     | <ws> /workspaces/...   idle | |
|                                   | +2 other open Branches|     +-----------------------------+ |
```

- Reading: idle note "Reading the chats..." until the chat list arrives; hub shows "Reading...".
- Chats ended: "No chat working - 1 ended recently - 0 calls in flight"; Progress reads "Ended" /
  "Failed" / "Stopped", agents "Done"; an ended chat's mounts are not drawn. It leaves after
  5 minutes; then IdleAgents reads "The last chat, {name}, ended {time}".
- Calls in flight: busy cards ring in the agent's colour (`.live-ring`), spinners and elapsed
  times tick, chevrons fly; the landing target flashes. Reduced motion hides the chevrons.
- Error: the error strip [2] above; a chat's own error is the red line in its group; a failed last
  call reads "Call failed" with a red X.

## Notes

- Reads: chat calls every 1 s,
  project every 2 s, Sandboxes every 4 s while a chat works (`live-data.ts`, `live-tab.tsx:134`).
- Unused exports (grep-confirmed, imported nowhere): `run-badges.tsx` AgentDot, RunStateBadge,
  KindChip, KindLegend, SessionHint; `run-format.ts` STEP_TONE, IDLE_AFTER_MS, isIdle,
  methodKind, clock, plural, stepKey, ownProject, ms, runName; `live-model.ts` CYCLE. Exported but
  used only in their own file: `live-data.ts` ACTIVE_AFTER_MS, worksInLayerfs, chatRun,
  withAgents; `live-model.ts` wsKey; `live-flow.ts` LEG_MS; `live-nodes.tsx` BranchName.
