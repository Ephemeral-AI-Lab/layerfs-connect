# Sidebar

The app's left column: the brand, New chat, Resources, every LayerFS project with its chats, and
Settings. Opens from: always shown, on the left of the window; ⌘B (Ctrl+B) hides it.
Source: `src/renderer/src/components/app-sidebar.tsx` (every region is in this file).

## Skeleton

```text
+-[1] Brand ---------------------------+
| [o] LayerFS Connect               [<] |
| [ New chat ]                          |
+-[2] Resources -----------------------+
| RESOURCES                            |
|    Storage                           |
|    Compute                           |
+-[3] Projects ------------------------+
| PROJECTS  14                [#] [+]  |
|  /\ web   shop                  3  > |
|     [] Fix the login form         x  |
|     [] Add a health check         x  |
|  /\ api   pg                         |
|  ...                     (scrolls)   |
+-[4] Footer --------------------------+
| (*) Settings                         |
+--------------------------------------+
```

## Regions

1. **Brand**: the Connect mark in a liquid-glass tile, "LayerFS Connect", and a button that hides the
   sidebar. Under it, **New chat** opens a new chat in a tab of its own.
2. **Resources**: Storage and Compute, with a sliding glass indicator on the open one. ⌘-click
   (Ctrl-click) or a middle click opens a page in a new tab.
3. **Projects** (`ProjectList`): the project directory shared with the Projects page and Chat
   (`useProjects`). The "Projects" heading, with the count, and the grid button open the Projects page;
   + starts a chat with no project picked yet. Each project is a row with the LayerFS mark, its name
   and its Store's name faint after it; a click opens the project page. A row with chats shows their
   count, a hover + for a new chat on it, and a chevron that folds its chats (newest first, five
   before **Show all**; each with an x that deletes the conversation). The projects with the newest
   chats, the open one and any with a chat working start unfolded. The section fills the rest of the
   column and its list scrolls.
4. **Footer**: **Settings** opens the Settings dialog (language among it).

The sidebar shows no Store or machine state; that is on Storage, Compute and the project pages.

**Off for now (2026-10-31):** the older project tree with its All / Running filter, each project's ×
(Delete project) and "Local chats" (`ProjectTree`) is not shown; `SHOW_PROJECT_TREE` turns it back on.

## States

- **Loading**: three skeleton rows under Projects.
- **Error**: "Could not load projects." with Retry.
- **Empty**: "Create project" under the Projects heading.
- **Selected**: the open Resources page (sliding indicator), the Projects heading on the Projects
  page, or the open project's row (a glass pill).

## Upgrading this home

The first call of this LayerFS build on a layout 2 home converts it to layout 3, and is refused
`InUse` while anything in it is live. Then the whole window, sidebar included, is replaced by one
screen (`components/upgrade-screen.tsx`): "Upgrading this home: close Sandboxes a1, b1". It lists each
live item LayerFS names (`detail.related`) with its `why` and, when the `why` gives a command, that
command with a copy button. **Check again** makes the next call; once nothing is live it converts the
home and the app reloads. There is no Close button: this build refuses every call, `sandbox.close`
included, until the home converts, so each Sandbox is closed with the older build that started it, as
its `why` says.
