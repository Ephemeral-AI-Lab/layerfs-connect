# Project: Chats

The project's chats, newest first, as a table: each chat works on its own Branch, mounted as a
Workspace in a Sandbox, so the user's hierarchy is Project → Chat → (Branch, Workspace). A row opens
the chat on the Chat page. Opens from: the "Chats N" tab of a project page (or
`#projects/<key>/chats`; old `sessions` and `runs` hashes open it too). The sidebar's Chats section
lists the same chats under the project's group, whose ↗ opens the project page.
Source: `src/renderer/src/components/projects/project-sessions.tsx` (`ProjectSessionsContent`),
wired in `projects/project-view.tsx`.

## Skeleton

```text
+-[1] PageHeader (compact) --------------------------------------------------------------------+
| < Storage / shop / [A] shop   Runs on [native] · Last Commit 3 min ago · 2 MB  [↻] [New chat] |
| • Live 1   • Chats 4   Files   History  │  Sandboxes   Storage                               |
|            =========                                                                          |
+----------------------------------------------------------------------------------------------+
+-[2] Chats table -----------------------------------------------------------------------------+
| Working · 2                                                               [ Show archived 1 ] |
| CHAT                          BRANCH        WORKSPACE           STATE        UPDATED          |
| * Fix the login form          fix-login     [native · a1]       (Working)    just now       > |
| o Add a health check          health        [native · a1]       (Idle)       2 hours ago    > |
| # Crew run  crew_2  31/96     crew_2.*      [native · a2]       (Running)    2 min  [Stop]  > |
| o Old experiment              experiment    — closed            (Archived)   5 days ago     > |
+----------------------------------------------------------------------------------------------+
```

`#` stands for the ⧉ scenario marker. Under 48 rem of its own width a row folds into two lines:
the title, the state chip and the actions, then Branch, Workspace and Updated.

## Regions

1. **PageHeader** (`ProjectView`): the Chats tab carries the count of chats that are not archived
   and a dot while one works (`chatLive`). The header's one row names where the project is stored
   and where it runs (see [layerfs-projects.md](layerfs-projects.md#project-page)).
2. **Header row**, only when there is something to say: "Working · N", and **Show archived N** /
   **Hide archived** when some are archived (archived rows are dimmed). The tab above names the
   table and counts it, so the row does not repeat "Chats N". Each row is its own grid; the actions
   column has one fixed width (Stop and the chevron), so a running scenario's Stop does not shift
   that row's columns.
3. **Rows** (`ChatRow`): the row opens the chat (`onOpenChat`).
   - CHAT: a state dot (pulsing while working, red on error) and the title; a scenario chat has the
     ⧉ marker, its scenario's title, its folder and steps done/of. A failed chat shows its error under
     the title.
   - BRANCH: `workspace.branch`; a click opens the project's History at that Branch
     (`onOpenBranch` → `setBranch` + the History tab). A scenario chat with no Branch yet shows
     `<folder>.*`.
   - WORKSPACE: a machine chip "machine · sandbox" that opens the machine's row on Machines
     (`go.machine`). The machine is the Sandbox's (from the project read's Sandboxes), else the
     scenario's, else the Store's. "— closed" when the Workspace is closed, or a chat at rest has
     none.
   - STATE: Archived; a scenario's state (Preparing, Running, Passed, Failed, Stopped); Error;
     Working; the Workspace's Preparing or Saving; else Idle.
   - UPDATED: `ago(updated)`, the clock time on hover.
   - Actions: **Stop** on a scenario chat that is running (`agentHost.stop`); a refused stop shows
     its message under the title.

Branch, Workspace and Stop clicks do not open the row.

## States

- **Loading**: `Loading` ("Reading the chats…").
- **Error**: `LoadError` ("Chats") with Retry, which reads the chats again.
- **Empty**: "No chats yet" with **New chat** (off until the project is read).
- **Live**: rows follow the host's `chat` events (`useChatSessions`); the page reads the project
  again when a chat's Workspace head, save or state moves.
