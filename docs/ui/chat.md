# Chat

## Desktop example chat

The rebuilt `desktop/` app provides a read-only preview at
`#/chat/ui-example-chat`, opened from **Example chat** in the sidebar or
**Explore an example chat** below the new-chat composer. It needs no model.

```text
Example · Add project search             Scenario UI preview · simulated
Example - Add project search                   [1 subagent v]
[Chat] [Files] [Sandbox] [Trace] [History]
Chat:       request → inspection → write → failed check → fix → review → reply
Trace:      expandable steps, two sample checkpoints, search, failure filter
Header:     subagent catalog; open reviewer here or in the side panel
Files:      shared LayerFS browser; sample main and search branches
Sandbox:    animated project-wide agent / branch / workspace simulation
Composer:   Read-only example · explore Chat, Trace, and Subagents above.
```

The example uses the regular Chat, Trace, and Subagents components. Messages,
tool outputs, writes, and results are sample data; no commands, model requests,
or filesystem operations run. Only requests for the reserved example session
are handled locally (`desktop/src/renderer/src/layerfs/chat-sim.ts`); other
sessions continue to use the host. Reloading restores the same example.

## Desktop chat files and Sandbox

`#/chat/:id/files` browses the linked LayerFS project using the shared
`desktop/src/renderer/src/components/files/ProjectFiles.tsx` and `FilesTab.tsx`
components, also mounted by Storage's project file page. Chat without a
linked project shows "No LayerFS project linked". The browser is read-only;
it reads LayerFS branches, directory entries and file content, not `chat.cwd`.

```text
[Chat] [Files] [Sandbox] [Trace] [History]
LayerFS project files · read-only                       Open in Storage
+--------------------------+-------------------------------------------+
| Branch v                 | README.md [x]   filter.ts [x]             |
| Find in opened folders   | src / filter.ts          lines · size     |
| > src                    | 1  export const matches = ...             |
| > test                   | 2    name.toLowerCase()...                 |
|   README.md              |                                           |
+--------------------------+-------------------------------------------+
```

Directories expand on demand; files open in closeable tabs with line numbers
and syntax highlighting. The example defaults to `search`; switching to
`main` shows the earlier filter. On narrow layouts the tree stacks above the
file. `#/chat/:id/sandboxes` opens the project-wide Sandbox simulation described in
[sandbox.md](sandbox.md). Sandbox headings open the shared detail view with Overview and Workspaces. It never reads or creates real LayerFS resources.
Chat drafts remain mounted across tabs.

## Desktop agent navigation

Source: `desktop/src/renderer/src/pages/chat/`. Subagents are header navigation;
Chat, Files, Sandbox and Trace remain conversation views.

```text
+-[1] Header -------------------------------------------------------------------+
| Add project search [2][<users> 2 subagents v]                 search - ui-example |
+-------------------------------------------------------------------------------+
| [Chat] Files Sandbox Trace                                                   |
|                                                                               |
|                           Parent conversation                                 |
|                                                                               |
| [Message composer - unsent draft stays mounted]                                |
+-------------------------------------------------------------------------------+

                     +-[2] Subagent catalog ----------------------+
                     | Subagents                   1 active - 2  |
                     | * Review project filtering            [>] |
                     |   reviewer - running                      |
                     |   3k tok - 4s                             |
                     | o Check empty queries                 [>] |
                     |   tester - completed                      |
                     |   1 turn - 2s                             |
                     | All subagents                             |
                     +-------------------------------------------+
```

| [n] | Component | File | Behavior |
|---|---|---|---|
| [1] | ChatHeader | ChatHeader.tsx | Parent title; project/scenario facts hide as space narrows |
| [2] | SubagentNavigation | subagents/SubagentNavigation.tsx | Task first, agent/state, available usage; row opens main, trailing action opens side panel |

```text
+-[3] Child header -------------------------------------------------------------+
| [Add project search] / [reviewer v]                                            |
+-------------------------------------------------------------------------------+
| Chat Files Sandbox Trace                                                     |
|                                                                               |
|                     Child task and transcript                                  |
|                                                                               |
+-------------------------------------------------------------------------------+
| [Same composer and status/Stop area - delegated runs cannot accept replies]     |
+-------------------------------------------------------------------------------+

+-[4] Parent with side panel ----------------------------------------------------+
| Add project search [2 subagents v]                                             |
+-----------------------------------------+-------------------------------------+
| Chat Files Sandbox Trace               | [reviewer v]       [Open main] [x] |
|                                         +-------------------------------------+
| Parent conversation                     | Chat Files Sandbox Trace          |
|                                         | Child task                          |
|                                         |                                     |
|                                         | Child transcript                    |
|                                         |                                     |
| [Message composer - draft retained]      +-------------------------------------+
|                                         | [Same composer and status/Stop]     |
+-----------------------------------------+-------------------------------------+
```

| [n] | Component | File | Behavior |
|---|---|---|---|
| [3] | Parent breadcrumb and sibling switcher | ChatHeader.tsx | Parent returns to chat; dropdown selects another direct child |
| [4] | SubagentPanel | subagents/SubagentPanel.tsx | Shared ChatTabs, ConversationTab, Files and Trace; switch child, promote to main, close or Escape |

Child routes stay `/chat/:id/subagents/:child`; `/chat/:id/subagents` keeps the
overview and empty state. Child view tabs append `/files`, `/sandboxes`, or `/trace`.
Chat uses the same transcript, composer, status and Stop components as the parent;
child drafts have separate identities. Files use the shared project's browser,
Sandbox shares the project-wide simulation, and Trace reads the child's own session
and SDK calls through `/api/agent/sessions/:id/children/:child/trace`.
The composer explains that delegated runs do not accept follow-ups.
`?aside=:child` restores side-panel selection, including
on Files/Trace routes. Promoting the inspected child removes its duplicate pane.
Closing restores focus to the header trigger. Below 820px of chat width, the
side panel occupies the content area; closing reveals the still-mounted parent.
Below 560px the root count becomes an icon, keeping its accessible label.
Dropdowns support arrow-key navigation, Enter and Escape through Radix.
The API exposes direct children only; no nested descendant tree is invented.
Browser smoke: from `desktop/`, run `node tools/smoke-agent-navigation.mjs`
against `pnpm web` (or pass a served production-renderer URL). It owns an
isolated headless Chrome profile and uses synthetic chats; the host child
conversation test separately checks the real child Trace route and pagination.

Source: `src/renderer/src/components/chat/*` (file:line below is relative to it), mounted by
`chat-home.tsx`     Opens from: sidebar New chat, New chat on a project, a chat row (see shell.md)

## New chat

The header is hidden; the hero and the composer sit centred (a spacer below takes half the height).

```text
+-[1] Transcript area -------------------------------------------------------------------+
|                                                                                        |
|                        <mark> What would you like to build?                            |
|                                                                                        |
| +-[2] Meta row ----------------------------------------------------------------------+ |
| | ( <folder> Projects v ) ( <lfs> api v )                      [3] <wifi> Connecting | |
| +------------------------------------------------------------------------------------+ |
| +-[4] Composer ----------------------------------------------------------------------+ |
| | ~~~ Ask the agent to work on your project... (/ for commands) ~~~                  | |
| | [+]  [Sonnet 4.5 v]  [<brain> Thinking: medium v]                              [^] | |
| +------------------------------------------------------------------------------------+ |
|                                    [5] spacer                                          |
+----------------------------------------------------------------------------------------+
```

| [n] | Component | file:line | One line |
|---|---|---|---|
| [1] | hero `h2` | chat-home.tsx:778 | ConnectMark + title; the `fresh` layout |
| [2] | WorkspaceMenus | workspace-picker.tsx:43 | Working folder and LayerFS project chips |
| [3] | connection line | chat-home.tsx:873 | only while not connected: Connecting / Reconnecting |
| [4] | Composer | composer.tsx:62 | see Composer area |
| [5] | spacer | chat-home.tsx:921 | `grow` div below the composer while `fresh` |

## Open chat

Sample: chat "Add a login route" on project shop/api, Sandbox api-dev, Workspace feature-login.

```text
+-[1] Header ------------------------------------------------------------------------------+
| [2] <lfs> api / Add a login route [3](<fork> 2 subagents v) [4](<spin> Working) [5][...] |
| [6] |Chat|  Trace  Files  History  Sandboxes                                             |
+------------------------------------------------------------------------------------------+
+-[7] Workspace strip ---------------------------------------------------------------------+
| <branch> feature-login                               Changes saved   [Branch history ->] |
| <folder> /workspaces/feature-login                   <commit> 3f9a1c2e - 3 commits       |
| <clock> Live output, Stop and background commands in this Workspace comes with a later   |
|         LayerFS.                                                                         |
+------------------------------------------------------------------------------------------+
+-[8] Transcript (scrolls, follows the bottom) --------------------------------------------+
|                                  +-----------------------------------------------------+ |
|                                  | Add a login route to the api                        | |
|                                  +-----------------------------------------------------+ |
|                                                                                   [...]  |
| [>] View task process                                                                    |
| +--------------------------------------------------------------------------------------+ |
| | The route is in place: `POST /login` in src/routes/login.js ...                      | |
| | <copy>  1,204 in - 312 out - $0.0123                                                 | |
| +--------------------------------------------------------------------------------------+ |
| [9] <spin> Thinking...                                                                   |
| [10][ <fork> 2 subagents  1 running  > ]                                                 |
| [11] recovery banner / approvals / error alert / notice                                  |
+------------------------------------------------------------------------------------------+
+-[12] Composer area ----------------------------------------------------------------------+
| ( <folder> feature-login v ) ( <lfs> api v )       [<shield> Pending approval 1] <o> 12% |
| +-Next up (1) --------------------------------------------- Continues automatically ---+ |
| | <list> Also add a logout route                                 [<-' Steer] [<trash>] | |
| +--------------------------------------------------------------------------------------+ |
| ~~~ Add a follow-up - it will run after this task... ~~~                                 |
| [+]  [Sonnet 4.5 v]  [<brain> Thinking: medium v]                           [<stop>] [^] |
+------------------------------------------------------------------------------------------+
```

| [n] | Component | file:line | One line |
|---|---|---|---|
| [1] | header | chat-home.tsx:658 | hidden while `fresh` |
| [2] | breadcrumb | chat-home.tsx:661 | project name opens the project page; title or "New chat" |
| [3] | SubagentsMenu | subagents.tsx:58 | "{count} subagents"; spins while one runs |
| [4] | running pill | chat-home.tsx:682 | phase words, listed under this table |
| [5] | conversation menu | chat-home.tsx:689 | "Conversation actions"; see Menus |
| [6] | TabBar | chat-home.tsx:719 | sorted by label length; see under this table |
| [7] | WorkspaceStatus | workspace-status.tsx:29 | project chat with a Workspace; not scenarios |
| [8] | ConversationMessages | conversation-messages.tsx:18 | messages grouped into tasks |
| [9] | ThinkingLine | markdown.tsx:143 | running, no approval waiting, nothing streaming |
| [10] | SubagentsSummary | subagents.tsx:113 | opens [3] |
| [11] | banners | chat-home.tsx:804 | recovery, approvals, error, notice, in that order |
| [12] | composer area | chat-home.tsx:855 | meta row, queued tray, Composer |

Running pill: Waiting for approval {n} / Reviewing {n} / Retrying {n} / Subagents working / Running
tool / Stopping / Working. Tabs: Trace needs a started chat; Files, History and Sandboxes need a
project and render the embedded ProjectView (`chat-home.tsx:733`) in place of the transcript and
composer: see project.md and project-history.md.

Workspace strip states (`workspace-status.tsx:44`): Waiting for workspace, Preparing workspace,
Workspace ready, Running command, Saving changes, Workspace closed, Workspace needs attention (red,
with the error line); "Changes saved" when ready with a save. Without path and head: "Workspace
location appears when it is ready."

## Transcript

### Task group

```text
+-[1] Task ------------------------------------------------------------------------+
|                                    +-------------------------------------------+ |
|                                    | Add a login route to the api              | |
|                                    +-------------------------------------------+ |
|                                                                           [...]  |
| [2][>] View task process                                                         |
| [3] (hidden: tool cards and earlier assistant cards)                             |
| [4] +--------------------------------------------------------------------------+ |
|     | final assistant card (its Reasoning folded)                              | |
|     +--------------------------------------------------------------------------+ |
+----------------------------------------------------------------------------------+
```

| [n] | Component | file:line | One line |
|---|---|---|---|
| [1] | TaskMessages | conversation-messages.tsx:23 | a user message up to its final reply |
| [2] | disclosure | conversation-messages.tsx:42 | completed tasks; View / Hide task process |
| [3] | hidden messages | conversation-messages.tsx:61 | stay open after a full-output dialog |
| [4] | last message | conversation-messages.tsx:66 | Reasoning folds once the task completes |

### User message

```text
                    +-[1]----------------------------------------------------+
                    | [2] ( <file> notes.md ) ( [img] screen.png )           |
                    | [3] Add a login route to the api                       |
                    +--------------------------------------------------------+
                                                                    [4] Queued
                                                                    [5] [...]
                                                                        Copied
```

| [n] | Component | file:line | One line |
|---|---|---|---|
| [1] | user bubble | agent-messages.tsx:140 | right-aligned glass card |
| [2] | AttachmentList | attachments.tsx:52 | image thumbnail or file icon + name |
| [3] | Markdown | markdown.tsx:107 | message text |
| [4] | queued line | agent-messages.tsx:147 | while the message `status` is running |
| [5] | MessageActions | conversation-actions.tsx:19 | on hover; "Copied" or a copy error under it |

### Tool card

```text
Collapsed
+-[1]------------------------------------------------------------------------------+
| [<term>] bash  pnpm test --filter api                         ( <check> Done ) > |
+----------------------------------------------------------------------------------+
           [2] ( <spin> Running )  ( <!> Failed )  ( <check> Done )

Expanded (a failed card opens expanded)
+----------------------------------------------------------------------------------+
| [<term>] bash  pnpm test --filter api                         ( <check> Done ) v |
|----------------------------------------------------------------------------------|
| +-[3]--------------------------------------------------------------------------+ |
| | COMMAND                                                                      | |
| | pnpm test --filter api                                                       | |
| +------------------------------------------------------------------------------+ |
| +-[4]--------------------------------------------------------------------------+ |
| | OUTPUT                                                                       | |
| | ok 4 - login returns 204                                                     | |
| +------------------------------------------------------------------------------+ |
| [5][ <file> View full output  48,213 bytes ]                                     |
+----------------------------------------------------------------------------------+
```

| [n] | Component | file:line | One line |
|---|---|---|---|
| [1] | ToolMessage | agent-messages.tsx:31 | Terminal icon for bash, else GitFork; preview |
| [2] | state chip | agent-messages.tsx:80 | Running / Failed / Done |
| [3] | input block | agent-messages.tsx:99 | COMMAND (bash) or TASK (JSON args) |
| [4] | output block | agent-messages.tsx:105 | red when failed; "Running..." before output |
| [5] | full output | agent-messages.tsx:118 | saved output only; opens ToolOutputDialog |

### Assistant card

```text
+-[1]------------------------------------------------------------------------------+
| +-[2]--------------------------------------------------------------------------+ |
| | <brain> Reasoning                                                          v | |
| | (open) the reasoning, as Markdown                                            | |
| +------------------------------------------------------------------------------+ |
| [3] The route is in place. It answers 204:                                       |
|     +-[4] js ------------------------------------------------ <copy> Copy code-+ |
|     | export function login(req, res) {                                        | |
|     +--------------------------------------------------------------------------+ |
| [5] The response ended with an error.                                            |
| [6] <copy>  1,204 in - 312 out - $0.0123                                         |
+----------------------------------------------------------------------------------+
```

| [n] | Component | file:line | One line |
|---|---|---|---|
| [1] | AgentMessage | agent-messages.tsx:155 | none without text or thinking, unless streaming |
| [2] | reasoning | agent-messages.tsx:158 | "Thinking..." while streaming, then "Reasoning" |
| [3] | body | agent-messages.tsx:177 | Markdown; ThinkingLine while nothing came yet |
| [4] | FencedCode | markdown.tsx:14 | language or "Code"; Copy code / Copied |
| [5] | error line | agent-messages.tsx:178 | `status` error only |
| [6] | footer | agent-messages.tsx:179 | "Copy response"; usage; cost only above 0 |

### Subagents summary, recovery, approvals, error, notice

```text
[1][ <fork> 2 subagents  1 running - 1 failed  > ]      ("all finished" when none run or fail)

+-[2]------------------------------------------------------------------------------+
| This run was interrupted. Continue from its saved context.     [<play> Continue] |
+----------------------------------------------------------------------------------+

[3] <shield> 1 commands awaiting approval or review
+-[4]------------------------------------------------------------------------------+
| [<term>] Main agent                       ( Waiting for approval )  Model review |
| /workspaces/feature-login                                                        |
| +------------------------------------------------------------------------------+ |
| | git push origin feature-login                                                | |
| +------------------------------------------------------------------------------+ |
| The command writes outside the Workspace.                                        |
|----------------------------------------------------------------------------------|
| You can decide directly                                [Reject] [Approve once]*  |
+----------------------------------------------------------------------------------+
+-[5]------------------------------------------------------------------------------+
| > Approval history - 2 - Model approved 1                                        |
+----------------------------------------------------------------------------------+

+-[6]------------------------------------------------------------------------------+
| <?> Could not reach the model provider.                                 [Reload] |
+----------------------------------------------------------------------------------+
+-[7]------------------------------------------------------------------------------+
| Conversation archived.                                                         x |
+----------------------------------------------------------------------------------+
```

| [n] | Component | file:line | One line |
|---|---|---|---|
| [1] | SubagentsSummary | subagents.tsx:113 | opens the header's subagents menu |
| [2] | recovery banner | chat-home.tsx:804 | `execution.reason` or default; Retry on error |
| [3] | waiting header | permissions.tsx:55 | count of pending + reviewing |
| [4] | ApprovalCard | permissions.tsx:12 | actor, status, source, cwd, command, reason |
| [5] | approval history | permissions.tsx:58 | `details`; decided cards, newest first |
| [6] | error alert | chat-home.tsx:812 | Reload only when the models failed to load |
| [7] | notice | chat-home.tsx:828 | "Dismiss notification" x |

Approval actor: Main agent / Child agent - {id} / the agent's name. Status chips: Reviewing command
(spinner icon), Waiting for approval, Approved, Rejected (ShieldX icon), Cancelled. Source: Model
review / Manual decision. "You can decide directly" only while reviewing.

Notices: Conversation context compacted. / Agent stopped. Send another message to continue. /
Agent stopped and queued messages cleared. / Conversation copied. Send a message when you are ready
to continue. / Conversation restored. Review the original message below before sending. / Message
updated and sent from its saved restore point. / Conversation archived. / Conversation restored. /
Conversation copied. / /scenario plays on a LayerFS project. Choose a project in Workspace, then try
again. / Started {count} scenarios, each in a chat of its own. / No scenario plays in a chat yet.

## Composer area

### Meta row and queued tray

```text
[1]( <folder> feature-login v ) ( <lfs> api v )  [2][<shield> Pending approval 1] [3]<o> 12% [4]
[5] storage error line
+-[6] Queued messages -------------------------------------------------------------+
| Next up (2)                                              Continues automatically |
| [7] <list> Also add a logout route              v          [<-' Steer] [<trash>] |
| [8] <list> Use bcrypt for the hash                         <-' Guiding [<trash>] |
| [9] Could not steer the message.                                               x |
+----------------------------------------------------------------------------------+
```

| [n] | Component | file:line | One line |
|---|---|---|---|
| [1] | WorkspaceMenus | workspace-picker.tsx:43 | locked once started; see Workspace chips |
| [2] | approvals button | chat-home.tsx:860 | Pending approval {n} / Reviewing {n}; scrolls |
| [3] | ContextMeter | context-meter.tsx:11 | ring + percent; amber at 70, red at 90 |
| [4] | pending spinner | chat-home.tsx:872 | while a send or action is in flight |
| [5] | draft storage error | chat-home.tsx:876 | the draft could not be saved |
| [6] | QueuedMessages | queued-messages.tsx:14 | tucks under the composer's top edge |
| [7] | queued row | queued-messages.tsx:54 | click expands; Steer; "Remove queued message" |
| [8] | steering row | queued-messages.tsx:67 | `mode` steer: "Guiding" in place of Steer |
| [9] | queue error | queued-messages.tsx:99 | "Dismiss queue error" x |

### Composer

```text
+-[1] Slash popup (input is "/...") -----------------------------------------------+
| /new        New session                                                          |
|             Start a fresh conversation in this workspace                         |
| /model      Select model                                                         |
|             Choose the model for your next message                               |
| /workspace  Workspace                                                            |
|             Working directory, project and recent folders                        |
| /compact    Compact context                                                      |
|             Summarize earlier turns to free context                              |
| /stop       Stop agent                                               Unavailable |
|             No agent is running                                                  |
| /scenario   Play scenario                                                        |
|             A new chat plays a scenario's script here, in a folder of its own... |
|----------------------------------------------------------------------------------|
| Up/Down choose - Tab complete - Enter run - Esc dismiss                          |
+----------------------------------------------------------------------------------+
+-[2] Composer surface ------------------------------------------------------------+
| [3] ( <file> notes.md x ) ( [img] screen.png x )                                 |
| [4] ~~~ Ask the agent to work on your project... (/ for commands) ~~~            |
| [5][+]  [6][Sonnet 4.5 v]  [7][<brain> Thinking: medium v]               [8][^]* |
+----------------------------------------------------------------------------------+

After "/scenario ":                        Running:
+--------------------------------------+   ~~~ Add a follow-up - it will run after this task... ~~~
| all   All scenarios                  |   [+] [Sonnet 4.5 v] [<brain> Thinking: medium v]
|       2 at once, each in a chat ...  |                                     [9][<stop>] [^]
| shop  <scenario title>               |   Send reads "Queue follow-up"; model and thinking
|       <blurb>                        |   are disabled
+--------------------------------------+
```

| [n] | Component | file:line | One line |
|---|---|---|---|
| [1] | command listbox | composer.tsx:219 | commands from chat-home.tsx:613 |
| [2] | composer surface | composer.tsx:245 | drop or paste files to attach |
| [3] | AttachmentList | attachments.tsx:52 | "Remove attachment {name}"; error line under it |
| [4] | textarea | composer.tsx:251 | grows to 180px; placeholder changes when running |
| [5] | + menu | composer.tsx:274 | "Composer options"; spins while reading files |
| [6] | model trigger | model-selector.tsx:31 | model name, or "Select model" |
| [7] | thinking trigger | model-selector.tsx:57 | disabled without a model or while running |
| [8] | Send | composer.tsx:318 | Send message / Queue follow-up, or runs a command |
| [9] | Stop | composer.tsx:306 | "Stop agent (Esc)"; while running |

Command descriptions change with state: /model "Available after the current turn"; /compact "Stop
the agent before compacting" or "Start a conversation first"; /stop "Stop the current turn";
/scenario without a project: "Needs a LayerFS project: choose one in Workspace first".

## Desktop History tab

See [chat-history.md](chat-history.md) for the current desktop History tab, its
centered main graph, checkpoint grouping, branch families and two-way Trace links.
The Example chat includes a separate dense sample history in addition to its
two transcript checkpoints.

## Trace tab

```text
+-[1] Toolbar (sticky) ------------------------------------------------------------------+
| 3 turns  9 steps  7 tool calls  12 LayerFS calls  4 auto-checkpoints (3 file - 1       |
| Workspace)  <!> 1 failed                                                               |
| [<search> Search commands, output, paths... x] [<layers> LayerFS calls] [<!> Failures] |
| [Expand all] [Fold all]                                                                |
+----------------------------------------------------------------------------------------+
[2] [Load earlier (300 more)]
+-[3] Turn ------------------------------------------------------------------------------+
| v Setup                                                                                |
|----------------------------------------------------------------------------------------|
|   o (SYSTEM)  (italic) system                                                          |
+----------------------------------------------------------------------------------------+
+----------------------------------------------------------------------------------------+
| v Turn 1  Add a login route to the api               3 steps  4 calls  1 failed  42 s  |
|----------------------------------------------------------------------------------------|
|[4] o (USER)    Add a login route to the api                                            |
|    o (MODEL)   I will add the route and a test.                                 3.1 s  |
|    o (TOOL)    mkdir -p src/routes && cat > src/...    [#1 ^] [<layers> 2]      0.4 s  |
|          o (LAYERFS) write_file ok /src/routes/login.js                                |
|    o (TOOL)    pnpm test --filter api                  exit 1                   2.0 s  |
|    o (REPLY)   The route is in place.                                   1.2 s  +42 s   |
+----------------------------------------------------------------------------------------+
+----------------------------------------------------------------------------------------+
| > Turn 2  Also add a logout route                              2 steps  1 call  8.4 s  |
+----------------------------------------------------------------------------------------+
```

| [n] | Component | file:line | One line |
|---|---|---|---|
| [1] | toolbar | trace-view.tsx:255 | totals; checkpoints by write kind; row coverage note |
| [2] | Load earlier | trace-view.tsx:315 | when older pages exist |
| [3] | turn section | trace-view.tsx:327 | Setup / Turn {n}; long traces fold all but the last |
| [4] | Row | trace-view.tsx:408 | dot, badge, headline, chips, ms, +offset on hover |

Badges: System, User, Context, Model, Tool, Subagent, LayerFS, Check; Script (scripted step), Reply
(final step), a non-bash tool's name (Message, Agents, `job ...`). LayerFS rows are hidden under
their tool row unless the LayerFS calls toggle, a filter, or the row's `[<layers> n]` opens them.
With 4 or fewer checkpoints the chip shows `#n ^` History links, else a `#3-#4, #7` range that opens
the row; refused writes add a red "{n} refused". Toolbar note: "counts cover the {n} newest of
{total} rows".

### Row expanded

```text
|    o (TOOL)    mkdir -p src/routes && cat > src/...    [#1 ^] [<layers> 2]      0.4 s  |
|            +-[1] ERROR -------------------------------------------------------+        |
|            +-[2] COMMAND (highlighted) ---------------------------------------+        |
|            | mkdir -p src/routes && cat > src/routes/login.js <<'EOF' ...     |        |
|            +------------------------------------------------------------------+        |
|            [3] AUTO-CHECKPOINT #1                                                      |
|            +------------------------------------------------------------------+        |
|            | #1 (BRANCH WRITE) [<commit> 3f9a1c2e ^] <branch> feature-login   |        |
|            |    /src/routes/login.js         ok  write_file  +312 B  40 ms    |        |
|            | Add login route                                                  |        |
|            | #2-#3 in between: other agents' checkpoints, made meanwhile      |        |
|            +------------------------------------------------------------------+        |
|            +-[4] OUTPUT ------------------------------------------------------+        |
|            +-[5] ARGUMENTS ---------------------------------------------------+        |
|            +-[6] CHECKS ------------------------------------------------------+        |
```

| [n] | Component | file:line | One line |
|---|---|---|---|
| [1] | Block Error | trace-view.tsx:690 | the row's error |
| [2] | Block text | trace-view.tsx:691 | Command / Task / Says / Prompt / Detail / Message |
| [3] | Writes | trace-view.tsx:627 | Auto-checkpoint(s) #n, or "Refused writes" |
| [4] | Block Output | trace-view.tsx:699 | highlighted output |
| [5] | Block Arguments | trace-view.tsx:704 | `key: value` lines |
| [6] | Block Checks | trace-view.tsx:711 | a tick or cross per check: `name: detail` |

Write kinds: Branch write, Workspace commit, Fork, Merge, Publish, Init. A `^` link opens the
History tab on that Commit, Layer or Branch (only on a project chat).

## Subagent view

Opened from the subagents menu. The transcript and composer area hide; the header becomes
`<lfs> api / Add a login route > reviewer` (the title is a button back to the chat).

```text
+-[1] Child card ------------------------------------------------------------------------+
| * reviewer  ( running )  bash                                        [<stop> Stop run] |
| claude-sonnet-4-5 - 12.4k tok - $0.0210 - 3 turns - 5 tool calls - 1m 04s              |
| Task: Review the login route for missing input checks ...                              |
| [2] child error line                                                                   |
+----------------------------------------------------------------------------------------+
[3] load error line
[4] read-only transcript (task groups, no message actions)
                        [5]( <- Read-only - Back to the main chat )
```

| [n] | Component | file:line | One line |
|---|---|---|---|
| [1] | child card | subagents.tsx:174 | dot, agent, state, tool, Stop run; facts; task |
| [2] | child error | subagents.tsx:192 | `child.error` |
| [3] | load error | subagents.tsx:195 | reading the child's conversation failed |
| [4] | ConversationMessages | subagents.tsx:201 | no `onAction`; reloads twice a second at most |
| [5] | back pill | subagents.tsx:211 | sticky at the bottom |

The task line clamps to 2 lines until clicked. Empty (dashed box, `subagents.tsx:197`): "This
subagent's conversation shows here once it saves; its latest output is below." plus its latest
text while active, else "This subagent left no conversation to show." Loading: `<spin> Loading...`.

## States

```text
Loading      <spin> Loading...                  (centred in the transcript; chat-home.tsx:774)
Empty        the New chat layout; a started chat with no messages shows only the banners
Error        error alert in the transcript; [Reload] when the model list failed
Running      ( <spin> Working ); <spin> Thinking...; [<stop>]; follow-up placeholder and Send
Disconnected header <wifi> Connecting / Reconnecting, no running pill; new chat: meta row
Recovery     recovery banner with [Continue] or [Retry]
Approvals    ( Waiting for approval n ); [<shield> Pending approval n]; approval cards
Archived     ... menu says Restore chat; archiving the open chat opens a new chat + notice
Scenario     no Workspace strip; model chip shows the chat's own model; sends ignore the picker
Subagents    header ( <fork> n subagents v ); summary line in the transcript
```

Trace states: `<spin> Reading the trace`; load failure "Could not read the trace" (or "The Connect
host is not reachable") with [Try again]; empty "The agent has not started yet." (live) or "Nothing
yet: the Trace fills as the agent works."; filtered to nothing "No rows match."

## Menus and dialogs

### Conversation menu and message menu

```text
[...] Conversation actions                          [...] Message actions
+-------------------------------------------------+ +--------------------------------------+
| <pencil> Rename chat                            | | <copy> Copy text                     |
| <copy+> Duplicate chat                          | |--------------------------------------|
| <clip> Copy to clipboard                        | | <pencil> Edit & resend               |
| <file> Export Markdown                          | | <undo> Revert before this message    |
| <json> Export JSON                              | | <fork> Copy before this message      |
| <archive> Archive chat                          | | reason, when the three are disabled  |
| Stop the agent before duplicating or archiving. | +--------------------------------------+
+-------------------------------------------------+
```

Conversation menu (`chat-home.tsx:694`): Duplicate needs messages; Duplicate and Archive are
disabled while running (the hint line shows then); Archive reads "Restore chat" when archived.
Message menu reasons (`conversation-actions.tsx:29`): "Stop the agent before changing this
conversation." / "Wait for the current action to finish." / "A saved restore point is not
available for this message."

### ConversationActionDialog

```text
+-[1] Edit & resend ----------------------------------------------------------- x -+
| This conversation will keep only the context before this message. This message   |
| and all later replies will leave its active context.                             |
| [2] Message                                                                      |
|     +------------------------------------------------------------------------+   |
|     | Add a login route to the api                                           |   |
|     +------------------------------------------------------------------------+   |
| [3] ( <file> notes.md )                                                          |
| [4] LayerFS will restore the files to the checkpoint before this message on a    |
|     new revision branch. The previous file history is kept.                      |
| [5] The original message will return to the composer without sending.            |
| [6] Stop the agent before changing this conversation.                            |
|                                                     [Cancel] [Restore & send]*   |
+----------------------------------------------------------------------------------+
```

| Action | Title | Body [2] | Primary (busy) |
|---|---|---|---|
| edit | Edit & resend | editable "Message" textarea | Restore & send (Restoring & sending...) |
| rollback | Revert before this message? | message text | Revert conversation, red (Reverting...) |
| fork | Copy before this message? | message text | Create copy (Copying...) |
| duplicate | Duplicate chat? | chat title | Duplicate chat (Copying...) |

| [n] | Component | file:line | One line |
|---|---|---|---|
| [1] | ConversationActionDialog | conversation-actions.tsx:63 | copies have their own description |
| [3] | AttachmentList | conversation-actions.tsx:129 | the message's attachments |
| [4] | files line | conversation-actions.tsx:84 | project branch, or local folder: context only |
| [5] | hints | conversation-actions.tsx:131 | rollback hint; draft replaced or cleared |
| [6] | error / unavailable | conversation-actions.tsx:133 | primary reads "Try again" after one |

### Rename chat, Full tool output

```text
+-Rename chat ---------------------------------- x -+  +-Full tool output -------------------- x -+
| Give this conversation a name you can find later. |  | 16,384 of 48,213 bytes loaded            |
| Name                                              |  | +--------------------------------------+ |
| [Add a login route_____________________________]  |  | | ...output...                         | |
| Enter a conversation name.                        |  | +--------------------------------------+ |
|                              [Cancel] [Save]*     |  | [<copy> Copy loaded output] [Load more]* |
+---------------------------------------------------+  +------------------------------------------+
```

Rename: SessionSettingsDialog (`session-settings.tsx:10`), "Saving..." while busy, Enter saves.
Full tool output: ToolOutputDialog (`tool-output.tsx:8`), "Loading saved output..." first; "Copy
output" once all is loaded (Load more then hides); "No output." when empty.

### Composer + menu, model, thinking

```text
[+] Composer options              [Sonnet 4.5 v]                         [<brain> Thinking ...]
+-------------------------------+ +------------------------------------+ +--------------------+
| <clip> Add attachments        | | Model - available after this turn  | | Thinking intensity |
|-------------------------------| | Sonnet 4.5                       v | | ( ) off            |
| Send shortcut                 | |   anthropic/claude-sonnet-4-5      | | ( ) minimal        |
| (o) [Enter]       Send message| | ...                                | | ( ) low            |
| ( ) [Cmd][Enter]  Send message| |------------------------------------| | (o) medium         |
| New line       [Shift][Enter] | | <gear> Manage models...            | | ( ) high ...       |
+-------------------------------+ +------------------------------------+ +--------------------+
```

Model menu (`model-selector.tsx:41`): "- available after this turn" and disabled rows while
running; an empty list says "Add a provider in Manage models to get started."; Manage models opens
Settings > Models. Thinking (`model-selector.tsx:67`): the model's levels, else off ... max.
`[Ctrl]` replaces `[Cmd]` off macOS (`composer.tsx:287`).

### Context meter, subagents menu

```text
<o> 12%                                    ( <fork> 2 subagents v )
+-Context usage ------------------ 12% -+  +-1 of 2 running ------------------------------+
| Used              24,310 tokens       |  | * reviewer                     12.4k tok   > |
| Context window   200,000 tokens       |  |   Review the login route - running  1m 04s   |
| Remaining        175,690 tokens       |  | * tester                        3.1k tok   > |
| Estimated from the current            |  |   Run the api tests - completed     22s      |
| conversation context. ...             |  +----------------------------------------------+
| Run - tool                            |
| 3 turns - 7 tools - 0 retries         |
| Started 10:42:05                      |
| Recorded usage                        |
| Input / Output / Cache read / Cache   |
| write ... Recorded cost $0.0456       |
| Saved agent history totals ...        |
+---------------------------------------+
```

Context meter (`context-meter.tsx:34`): unknown usage reads "Unknown" and says why; the Run block
needs `execution`, Recorded usage needs saved usage. Subagents menu (`subagents.tsx:83`): label
"Subagents" when none run; the state dot pulses / green / red / grey; a row opens the child.

### Workspace chips

```text
( <folder> Projects v )                     ( <lfs> api v )
+-Working folder ---------------------+     +-LayerFS project ------------------- <refresh> -+
| ~/Projects                          |     | <folder> No project  Work in a local folder    |
|-------------------------------------|     | <lfs> api  shop                              v |
| Recent folders                      |     | <lfs> web  shop                                |
| <folder> notes   ~/code/notes       |     | <lfs> notes  lab                               |
|-------------------------------------|     |------------------------------------------------|
| <search> Choose folder...           |     | <plus> New project...                          |
+-------------------------------------+     | <arrow> Open project                           |
                                            +------------------------------------------------+
Started chat (locked):
+-Working folder ---------------------+     +-LayerFS project -------------------------------+
| /workspaces/feature-login           |     | <lfs> api  shop                              v |
| Start a new chat to change where it |     | /workspaces/feature-login                      |
| works.                              |     | Start a new chat to change where it works.     |
+-------------------------------------+     | <arrow> Open project                           |
                                            +------------------------------------------------+
```

WorkspaceMenus (`workspace-picker.tsx:78`, `:107`): recent folders are the last 6 local-folder
chats; the project list also says "Loading projects..." / "No LayerFS projects yet" and shows load
errors; New project... opens the New project dialog (projects.md); the project chip is hidden for a
started local-folder chat. `/workspace` opens the project menu.

## Notes

- Unused: `ChildRuns` (agent-messages.tsx:209) and `SubscriptionShortcuts` (model-sign-in.tsx:25)
  are exported but never imported.
- Run settings: SessionSettingsDialog's `limits` mode is never opened; ChatHome opens only `rename`
  (chat-home.tsx:695).
- `SayText`'s `stream` prop is never passed, so its word-by-word streaming never runs.
- WorkspaceStatus mounts only with a Workspace, so "New branch on first message" and "Workspace
  details unavailable" never show; Composer's default placeholder and its "Shift+Enter for new
  line" fallback are always overridden by ChatHome.

## Cindy theme layout

```text
New chat:    [Connect identity]
             [folder] [LayerFS project / Store context]
             +-[1] Composer ----------------------------------+
             | Message                                       |
             | [+]            [model] [thinking] [send/stop]  |
             +------------------------------------------------+
Active chat: transcript; the same composer is docked below it
```

The composer uses a 12px rounded theme surface, with an opaque raised fill. Model/thinking controls remain on the right and wrap in
compact widths. Send is a neutral circular control. Code/tool output, menus
and dialogs use solid surfaces in the fixed light theme. All draft, queue, IME, attachment,
stop and recovery behavior remains the existing chat behavior.


## Pi context and lifecycle preview (desktop)

Source: `pages/chat/conversation/PiContext.tsx`, `pi-preview.ts`, `ChatDock.tsx`.

```text
+-- Conversation -----------------------------------------------------+
| Messages; compaction summaries appear once in a collapsed panel      |
+--------------------------------------------------------------------+
| [1] Example only: Pi lifecycle preview [Near context limit       v]  |
|     Sample states only. No model requests or commands run.          |
| [2] 184,616 / 200,000 tokens · 92%   [Configurations] [Compact now]      |
|     =======================----                                    |
|     > Compacted context   (when present; expandable summary)        |
| [3] Retry 1 of 2 in 1s                          [Stop]               |
|     503 · The model provider is temporarily overloaded.             |
| [4] Composer                                                       |
+--------------------------------------------------------------------+
```

1. `#/chat/ui-example-chat?policy=near-limit` opens the preview. Options:
   original, near-limit, compacting, compacted, retrying, exhausted,
   compact-failed. Saved policies supply preview budgets; disabled policies
   still permit inspection of sample states, with an explanatory note.
   Finish simulation advances compacting to compacted. Stop and Continue
   only change local preview state. Retry stays paused for inspection.
2. Live Pi context estimate, progress bar and manual compaction. Estimates
   may be unavailable after compaction until another model response.
   Summaries can be expanded; raw history remains preserved. Compaction
   failures show an alert. Compact now is disabled during a run and hidden
   for read-only delegated/scenario conversations.
3. Live retry events supply attempt, maximum attempts, deadline and reason.
   Countdown updates each second; Stop uses the existing cancellation flow.
   Exhausted requests use the existing error and Continue flow.
4. Example composer remains read-only; previews never invoke a model.

## Shared project tabs

Files uses `components/files/ProjectFiles.tsx`; History uses `components/history/ProjectHistory.tsx`
with trace enrichment from its chat wrapper. Sandbox uses the shared project resource map;
Example chat alone supplies simulated playback. Storage project pages reuse these features.

## Unified sandbox navigation

```text
Chat / Storage project -> shared SandboxMap -> SandboxDetail
                                                |
                 [Project activity] <-----------+
                 restores map selection and scroll

SandboxDetail: Overview | Workspaces | Scratch | Activity | Diagnostics
```

`components/sandbox/ProjectSandboxNavigation.tsx` owns this flow for both the chat example
and host-backed project views. The map stays mounted during inspection. Source adapters
supply data and playback; they do not implement separate navigation. Resource management
controls live inside host-backed details. Map headers retain New Sandbox and Refresh.
`HostSandboxDetail.tsx` reads the selected Sandbox and verifies its project/machine identity;
Refresh rereads that record. Unknown workspace reads and unreported files/activity stay
explicitly unavailable. Real observations do not carry simulation playback or labels.

## CLI phase 2: shared Doctor and Stop (2026-11-09)

```text
Resource header                         [Diagnose / Check integrity / Test connection]
+ Doctor · saved resource ---------------------------------------------------+
| Target / operation    Full by default; optional Quick or explicit write test |
| Optional time budget                                            [Run diagnosis] |
| Queued / Running · elapsed (no progress percentage, no Stop)                 |
| Findings: N                Coverage: complete / incomplete                    |
| > failed / blocked / unknown checks first                                   |
| > evidence · dependencies · advisory suggestion                             |
| Previous dated reports (potentially stale)                                  |
+----------------------------------------------------------------------------+
```

Actions open setup only. Navigation and Refresh never launch targeted audits.
Sandbox uses the header action and its existing Overview/Workspaces tabs.
Connection observations do not prove integrity. Simulated reports say so.
Mounted chat Stop disables while stopping and retains Workspace/Sandbox; output
appears after command completion. Cancellation unknown offers explicit retry.
