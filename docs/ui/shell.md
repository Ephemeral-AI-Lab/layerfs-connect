# Shell

Source: `App.tsx`, `components/app-sidebar.tsx`, `window-bar.tsx`, `mode-switch.tsx`,
`upgrade-screen.tsx`, `tabs/*`, `chat/delete-chat-dialog.tsx` (under `src/renderer/src`)
Opens from: app launch; the window shows one place at a time.

## Window

```text
==[2] Sim strip =================================================================================
+-[1] Sidebar -------------+-[3] Window bar (drag strip) ---------------------------------------+
|                          +-[4] Page area -----------------------------------------------------+
|  see "Sidebar"           | +-[5] Page error boundary ---------------------------------------+ |
|                          | | Chat | Projects | project page | Machines | Storage            | |
|                          | |                                                                | |
|                          | +----------------------------------------------------------------+ |
+--------------------------+--------------------------------------------------------------------+
  [6] dialogs over everything: New project, Delete project, Delete chat, Settings
```

| [n] | Component | file:line | one line |
|---|---|---|---|
| 1 | `AppSidebar` | App.tsx:186 | 260px; folds to width 0 |
| 3 | `WindowBar` | window-bar.tsx:15 | Drag handle clear of the window controls |
| 4 | `main.tab-body` | App.tsx:190 | The page for the current place |
| 5 | `TabErrorBoundary` | App.tsx:191 | Keyed per place; a throw replaces only the page |
| 6 | dialogs | App.tsx:235 | New/Delete project, Delete chat, Settings |

## Sidebar

```text
+-[1] Window controls --------------------------+
|                                  [<hide>]   |
| [2 <chat+> New                            ]   |
+-[3] Pages ------------------------------------+
| ( <project> Projects                      )   |
|   <cpu>     Machines                          |
|   <store>   Storage                     * [4] |
+-[5] Chats ------------------------------------+
| CHATS                                   [+]   |
| [6] v <project> api  shop                 3   |
|   [7]  Add login form                     x   |
|        Working                     just now   |
|        Fix failing tests                      |
|        Idle                          3m ago   |
|        ...                                    |
|   [8]  Show all ( 7 )                         |
|     > <project> notes  lab                1   |
|     > <project> crm  team                 2   |
| [9] v <laptop> No project                 1   |
|        Explain this folder                x   |
+-[10] Footer ----------------------------------+
| <gear> Settings                            |
+-----------------------------------------------+

[6] hovered or focused:  v <project> api  shop         [<open>] [+]
```

| [n] | Component | file:line | one line |
|---|---|---|---|
| 1 | `SidebarHeader` | app-sidebar.tsx:121 | Hide sidebar (Cmd+B / Ctrl+B) |
| 2 | `.shell-new-chat` | app-sidebar.tsx:129 | A new chat, no project |
| 3 | pages nav | app-sidebar.tsx:142 | Neutral selected row on the current page; a project lights Projects |
| 4 | Storage job dot | app-sidebar.tsx:167 | Pulsing: "{n} running"; red: "{n} failed" |
| 5 | `ChatList` | app-sidebar.tsx:212 | Unarchived chats by project, newest group first |
| 6 | `ChatGroup` | app-sidebar.tsx:356 | Folds; hover: Open project {name}, New chat on {name} |
| 7 | `ChatRow` | app-sidebar.tsx:625 | Title, actual status and relative time; x on hover/focus: Delete conversation |
| 8 | `ShowAll` | app-sidebar.tsx:641 | After 5 chats; "Show all" + count / "Show fewer" |
| 9 | No project group | app-sidebar.tsx:302 | Local-folder chats; + "New chat on a local folder" |
| 10 | footer | app-sidebar.tsx:186 | Settings opens the dialog on its last section |

Groups start open: the 3 newest, the open project's, the open chat's, any with a working chat.

### Folded

```text
+-[1] Window bar -------------------------------------------------------------------+
| (window controls)  [<show>]                                                       |
+-----------------------------------------------------------------------------------+
| page area, full width                                                             |
```

| [n] | Component | file:line | one line |
|---|---|---|---|
| 1 | `WindowBar` | window-bar.tsx:16 | Show sidebar; Cmd/Ctrl+B toggles; state kept |

## States

```text
Chats loading   three skeleton rows                       app-sidebar.tsx:266
Chats empty     No chats yet  [+ New chat]                app-sidebar.tsx:270
Chats error     Could not load chats. [Retry]             app-sidebar.tsx:260
```

## Menus and dialogs

### Delete chat dialog (a chat row's x)

```text
+-[1] Delete conversation? ---------------------------- x -+
| This conversation will be permanently deleted. Project   |
| files and LayerFS history are kept.                      |
| +-[2]--------------------------------------------------+ |
| | <message> Add login form                             | |
| +------------------------------------------------------+ |
| [3] The running agents will stop before deletion.        |
| [4] <error>                                              |
|                         [Cancel]  [Stop & delete]        |
+----------------------------------------------------------+
```

| [n] | Component | file:line | one line |
|---|---|---|---|
| 1 | `DeleteChatDialog` | delete-chat-dialog.tsx:40 | alertdialog; focus on Cancel, back to the x |
| 2 | title box | delete-chat-dialog.tsx:59 | Chat title or "New session" |
| 3 | running note | delete-chat-dialog.tsx:63 | Live chat only; else button "Delete conversation" |
| 4 | error | delete-chat-dialog.tsx:64 | Busy: "Deleting..." (destructive button) |

### Upgrade screen (replaces the whole window)

```text
+-[1] ----------------------------------------------------------------------+
| <!> Upgrading this home: close Sandboxes api-dev                          |
|     This LayerFS converts the home to its new layout once, on its first   |
|     call, and only while nothing in it is live. Until then every page is  |
|     refused. The conversion keeps every Store, project and machine.       |
| +-[2]-------------------------------------------------------------------+ |
| | sandbox api-dev                                                       | |
| | ~~~ why, in LayerFS's words ~~~                                       | |
| | [3] <command from why>  [<copy> Copy]                                 | |
| | ...                                                                   | |
| +-----------------------------------------------------------------------+ |
| [4] InUse: <message>                                                      |
|                                                [5 <retry> Check again]*   |
+---------------------------------------------------------------------------+
```

| [n] | Component | file:line | one line |
|---|---|---|---|
| 1 | `UpgradeScreen` | upgrade-screen.tsx:25 | While the layout conversion is refused |
| 2 | related list | upgrade-screen.tsx:58 | `detail.related`: kind, name, why |
| 3 | command | upgrade-screen.tsx:67 | First backticked text in why; Copy / Copied |
| 4 | refusal | upgrade-screen.tsx:80 | Code: message |
| 5 | Check again | upgrade-screen.tsx:84 | Host status; success reloads the window |

No Sandboxes among them: the title is "Upgrading this home".

### Page error (replaces the page area)

```text
+-[1] ------------------------------------------+
|           This page hit an error.             |
|           <error message>                     |
|             [<retry> Reload page]             |
+-----------------------------------------------+
```

| [n] | Component | file:line | one line |
|---|---|---|---|
| 1 | `TabErrorBoundary` | tab-error-boundary.tsx:32 | Reload page renders the page again |

## Navigation

```text
one place at a time; opening one pushes the place it left (Back); kept in connect.tabs

chat [session]   <- New chat, Chats row or [+], a project's New chat / chat row, a machine's chat
projects         <- Projects; a project's Back with no history
  project <key> [tab] [branch]
                 <- Projects card, Chats [<open>], Storage / Machines rows, go.project(key, tab)
machines         <- Machines, go.page('machines')
  machine <name> <- machine card, go.machine(name); Machines again: the board
storage          <- Storage, go.page('storage')
  store <name>   <- Store card, go.store(name); Storage again: the board

Back / Forward   Cmd+[ / Cmd+] on the Mac; Alt+Left / Alt+Right elsewhere (not in fields);
                 mouse side buttons
Start hash       #chat  #projects  #machines  #storage  #compute (= machines)
                 #projects/<key>[/<tab>][/<branch>]   key encoded: team%2Fcrm
                 opens over the restored place; no hash: the restored place, else a new chat
Cross links      go.store    Store chips and links (project, machine, bucket cards, crumb)
(tabs/go.ts)     go.machine  machine chips, Sandbox tiles, a Store's "file is on" link
                 go.project  a machine's data list;  go.page('storage')  project crumb
                 the target row scrolls into view and flashes once (useFocusRow)
```

| [n] | Component | file:line | one line |
|---|---|---|---|
| - | `opening()` | App.tsx:42 | Start hash (dev: `CONNECT_VIEW`) |
| - | `select()` | App.tsx:99 | Machines / Storage again on a focused page: its board |
| - | keys | App.tsx:150 | `tabs.go(-1 / 1)` in a view transition |
| - | `setGo` | App.tsx:115 | `go.*` places onto `open()` |

## Notes

- `SHOW_PROJECT_TREE = false` (app-sidebar.tsx:65) hides a second list under Chats:
  `YOUR PROJECTS 4 [All v] [<refresh>]`, then `> <folder> api  shop  3 [+] [x]` rows (x: Delete
  project), then `<laptop> LOCAL CHATS [+]`; the filter menu is All sessions / Running n.
- The sidebar passes `newTab` on Cmd/Ctrl-click and middle-click; App's `select()` ignores it.
- No toasts and no app-wide error boundary.

## Theme and compact layout

```text
[1] One plain theme canvas across the window
 +-[2] Sidebar / thin divider---+-[3] Content--------------------+
 | quiet navigation and chats  | neutral raised composer           |
 | Settings   | opaque technical surfaces       |
 +-----------------------------+--------------------------------+
 [4] Menus and dialogs: opaque raised surface, neutral scrim
```

One fixed light theme; no theme or wallpaper controls. Tokens: `tokens.css`;
surface adapter: `cindy-theme.css`. The canvas remains continuous when the sidebar folds. At renderer widths below 768px the sidebar starts closed and opens as
an opaque overlay with a dismiss scrim; the native window keeps its existing
900px minimum width. Keyboard shortcuts and window dragging remain available.

Color/material: cool neutral light gray main canvas, a milky composer, and native
macOS sidebar vibrancy under a neutral tint; other platforms use a solid sidebar.
No grain texture, blue bevels, dark theme, or wallpaper controls.


### Desktop palette (`desktop/`)

```text
[1] White page and title bar
 +-[2] Light gray sidebar-----+-[3] White content----------------+
 | white selected row        | white cards and menus           |
 | neutral hover fills       | light gray fields               |
 +---------------------------+---------------------------------+
```

Desktop tokens: `desktop/src/renderer/src/styles/globals.css`; native window
fill and title bar: `desktop/src/main/index.ts`. Surfaces use neutral white and
light gray, including the macOS sidebar tint. Blue remains for links and focus;
status and data colors retain their semantic meaning.


## Desktop secondary settings sidebar

Source: desktop/src/renderer/src/components/shell/Sidebar.tsx

```text
+-Workspace sidebar----------+     +-Settings sidebar-----------+
| [icon] LayerFS Connect [Fold / Unfold] | | [<- Back to workspace] [Fold / Unfold] |
| New chat                   |     |                             |
| Example chat               |     | Settings                    |
| Machines                   |     | ( Models / Tools / Agents / Hooks ) |
| Storage                    |     |                             |
| Chats                      |     |                             |
| ...                        |     |                             |
|                            |     |                             |
| User             [Settings]| <-> | User             [Settings] |
+----------------------------+     +-----------------------------+
                                   Main pane: model connection
```

The bottom Settings button toggles the sidebar mode. Settings opens Models;
the same button or Back to workspace restores the previous workspace route.
Model setup is available only in the secondary navigation. Browser Back and
Forward keep the sidebar aligned with the route. Both sidebars share their
width, window controls and footer. Unsent chat text survives the switch.

The main sidebar's first row shows the user-supplied LayerFS mark (`assets/layerfs-logo.png`) and
"LayerFS Connect" name on the left, with the sidebar fold/unfold icon at the right.
The name truncates when space is limited, with the full name available on hover.
The first row keeps only the sidebar fold/unfold icon at the sidebar's right
edge; the menu and browser history arrow buttons are removed. In Settings,
Back to workspace sits on the left in that same row. The toggle follows sidebar
resizing and stays accessible at the top left when folded. At narrow sidebar widths the return label truncates;
the full label remains available to assistive technology and on hover.

The secondary sidebar also links Tools, Agents and Hooks to their Pi configuration panels.



## Real-only host (2026-11-09)

```text
Sidebar footer
+--------------------------------------+
| Ephemeral-AI                         |
| LayerFS                   Settings ? |
+--------------------------------------+
```

Desktop and browser preview use real LayerFS. No mode picker, simulation strip,
mode menu, or switch dialog exists. Preview uses a private home and requires
`LAYERFS_CONNECT_CLI`; startup errors identify missing/incompatible configuration.

## Desktop CLI activity navigation

```text
Workspace sidebar
+--------------------------------------+
| New chat                             |
| Machines                             |
| Storage                              |
| CLI Activity                         |
| Presets                              |
+--------------------------------------+
```

`desktop/src/renderer/src/components/shell/Sidebar.tsx` links CLI Activity to
`#/activity`. The action list, input/output and filters are specified in
[cli-activity.md](cli-activity.md).

Presets opens `#/presets` ([presets.md](presets.md)). When a demo environment is
active, `PresetEnvironment` appears above the page with its name and Return to
original environment. All pages and CLI Activity use that same home. Switching
reloads the renderer to discard cached data; active work blocks switching.

### Running conversation ordering

```text
Chats
  [1] Project B                 unchanged during progress
       Conversation B   working
  [2] Project A                 unchanged during progress
       Conversation A   working
```

| Region | Behavior |
| --- | --- |
| [1]–[2] | Running conversations keep their activity position; tool updates change status without reordering conversations or project groups. |
| New or completed chat | May update recent ordering once; repeated progress does not. |
| Live metadata | Transcript-free updates are batched; unchanged chat rows retain their identity. |

Concurrent background reads of the same API address share one request. Explicit
Refresh and reads following a mutation retain a fresh subsequent read.
