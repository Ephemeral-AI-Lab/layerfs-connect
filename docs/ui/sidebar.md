# Sidebar

The app's left column: the brand, New chat, the pages (Projects, Machines, Storage), the chats
grouped by project, and Settings. Opens from: always shown, on the left of the window; ⌘B (Ctrl+B)
hides it.
Source: `src/renderer/src/components/app-sidebar.tsx` (every region is in this file).

## Skeleton

```text
+-[1] Brand ---------------------------+
| [o] LayerFS Connect               [<] |
| [ New chat ]                          |
+-[2] Pages ---------------------------+
|  /\ Projects                         |
|     Machines                         |
|     Storage                          |
+-[3] Chats ---------------------------+
| CHATS                            [+] |
| v /\ web   shop                    2 |
|      [] Fix the login form         x |
|      [] Add a health check         x |
| > /\ api   pg                      1 |
| > [] No project                    1 |
|  ...                     (scrolls)   |
+-[4] Footer --------------------------+
| (*) Settings                         |
+--------------------------------------+
```

## Regions

1. **Brand**: the Connect mark (the soft-matte handshake tile, `assets/connect-logo.png`: cobalt and slate hands on a pale blue-white tile, lighter than the sidebar), "LayerFS Connect", and a button that hides the
   sidebar. Under it, **New chat** opens a new chat (Back returns to where it started); it is a soft cobalt tint
   (`--accent` with 10% `--primary` mixed in, 18% on hover; `--accent-foreground` text, cobalt icon), set apart from the white brand tile and the active page.
2. **Pages**: Projects, Machines (formerly Compute) and Storage, with no heading, and a sliding
   glass indicator on the open one (a project's page counts as Projects). The window shows one place
   at a time (there are no tabs); Back and Forward (⌘[ ⌘]) move through the places it showed.
3. **Chats** (`ChatList`): every chat that is not archived (`useChatSessions`), grouped by its
   project (`chatProject`; a scenario chat goes under its scenario's project). The heading's + starts
   a chat with no project picked yet. A group's header has a chevron, the LayerFS mark, the project's
   name with its Store faint after it, and its count; a click folds it. On hover the count gives way
   to ↗ (opens the project page) and + (a new chat on it).
   Under it its chats, newest first, five before **Show all**, each with an x that deletes the
   conversation. The group with the newest chat comes first; projects with no chats are not listed
   (the Projects page has them all). The chats on a local folder come last under **No project**
   (a laptop icon; + starts a chat on a local folder, no ↗). The three groups with the newest chats,
   the open project's, the open chat's and any with a chat working start unfolded. The section fills
   the rest of the column and its list scrolls.
4. **Footer**: **Settings** opens the Settings dialog (language among it).

The sidebar shows no Store or machine state; that is on Machines, Storage and the project pages.

**Off for now (2026-10-31):** the older project tree with its All / Running filter, each project's ×
(Delete project) and "Local chats" (`ProjectTree`) is not shown; `SHOW_PROJECT_TREE` turns it back on.

## States

- **Loading**: three skeleton rows under Chats.
- **Error**: "Could not load chats." with Retry, above whatever chats were read.
- **Empty**: "No chats yet" with **New chat** under the Chats heading.
- **Selected**: the open page (sliding indicator; Projects for a project's page too), the open
  project's group header (its mark in the accent colour) and the open chat's row.

## Upgrading this home

The first call of this LayerFS build on a layout 2 home converts it to layout 3, and is refused
`InUse` while anything in it is live. Then the whole window, sidebar included, is replaced by one
screen (`components/upgrade-screen.tsx`): "Upgrading this home: close Sandboxes a1, b1". It lists each
live item LayerFS names (`detail.related`) with its `why` and, when the `why` gives a command, that
command with a copy button. **Check again** makes the next call; once nothing is live it converts the
home and the app reloads. There is no Close button: this build refuses every call, `sandbox.close`
included, until the home converts, so each Sandbox is closed with the older build that started it, as
its `why` says.
