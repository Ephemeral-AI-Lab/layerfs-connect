# Projects

Every LayerFS project in Connect's home, one row each: the daily "where is my work" index
(LayerFS 2.0, #537 §7). Opens from: Projects at the top of the sidebar. A row opens the project
page. Source: `src/renderer/src/components/projects/projects-home.tsx` (main file; others named in
Regions).

A project goes by its **key**, `<store>/<project>`: its data lives in that Store. Selection, routing,
every host call and the Chat project choice use the key; the screens show the name with the Store
beside it. Each kind has one home: Stores are on Storage and machines on Machines; here they are link
chips. Store-wide actions (push, pull, move, backup) are not on project pages.

A project has two relationships, and every screen draws them the same way
([README.md](README.md#the-model)): it is **stored in** exactly one Store, and it **runs on** the
machines its Sandboxes are on: a list, never a parent (a sqlite project's Sandboxes run on its
Store's machine today, a PostgreSQL project's on any number of machines). A machine is never drawn
as the Store's child: where a sqlite Store's file is ("file on native") and where a project runs
are different facts, shown in different places.

## Skeleton

```text
+-[1] PageHeader -----------------------------------------------------------------------------+
| Projects                                [ Search projects      ] [ Refresh ] [ + New project ] |
| Each project is stored in one Store and runs in Sandboxes on any of your machines.            |
+-----------------------------------------------------------------------------------------------+
  [2] Group [None 6] [By Store] [By machine]                             Sort [Recent] [Name]
+-[3] ProjectTable -----------------------------------------------------------------------------+
| PROJECT   STORED IN                       RUNS ON                 CHATS              LAST ACTIVITY |
| api       [shop]                          [native ×2]             3 · * 1 working    just now    > |
| web       [shop]                          [native]                1                  yesterday   > |
| app       [pg]                            [build ×2] [fc1]        1                  5 hours ago > |
| todo      [team] (Busy · store.push…)     [docker]                —                  4 days ago  > |
| logs      [logs] (Down)                   not running             —                  9 days ago  > |
|           ui535-a is stopped                                                                      |
+-----------------------------------------------------------------------------------------------+
```

Under 44 rem of its own width the table folds each row into two lines: the name and the chevron,
then Stored in, Runs on, Chats and Last activity.

## Regions

1. **Page header** (`PageHeader` in `ProjectsHome`): "Projects", the one-line model ("Each project is
   stored in one Store and runs in Sandboxes on any of your machines."), the search box, Refresh and
   New project ([dialog-new-project.md](dialog-new-project.md)). Search matches the name, the Store
   and the machines it runs on; Esc clears it.
   The page draws no Live diagram: a project's working chats are in its own Live tab
   ([project-live.md](project-live.md)), and the CHATS column says how many work.
2. **Group and sort**: **None** (with the count), **By Store** (one table per Store, headed by its
   chip and "SQLite · file on <machine>" or "PostgreSQL") or **By machine** (one table per machine a
   project runs on, so a project running on two shows under both; then **Not running**). By machine
   shows only when the machines were read. Sort by **Recent** (last activity, the default) or
   **Name**; groups keep the rows' order.
3. **Project table** (`ProjectTable`, `projects/home/project-table.tsx`): each row opens the project.
   - PROJECT: its name (the key on hover).
   - STORED IN: a Store chip (`StoreChip`, `projects/where-chips.tsx`; `go.store`, the Store's page).
     The Store's `StateChip` follows it only when the Store is not plainly usable (busy, down,
     unresolved, an operation in flight); "In use" and "Idle" say nothing. `storeDown` under it in
     muted text.
   - RUNS ON (`RunsOnChips`): one machine chip per machine its Sandboxes are on (`go.machine`, the
     machine's page), "×N" for more than one Sandbox there, at most three then "+N"; "not running"
     with none; "—" when the machines were not read. From one `host.machines()` read
     (`useMachinesView`), again on project changes; a simulated host's view in dev.
   - CHATS: the project's chats that are not archived (`useChatSessions`, `chatProject`), and
     "N working" with a pulsing dot for those `chatLive` counts.
   - LAST ACTIVITY: the newest chat's `updated`, else when the project was made.
   A chip's click does not open the row. The Store facts come from one cached `host.storage()` view
   (`store-facts.tsx`), read again on Storage events, ended Storage jobs and project changes.

## Project page

`projects/project-view.tsx`.

```text
 < Storage / [postgresql] pg / [A] app   Runs on [build ×2] [docker] [fc1] · Last Commit just now · 2.4 GB   [↻] [New chat]
 • Live 1   • Chats 3   Files   History  │  Sandboxes   Storage
 ════════ ─────────────────────────────────────────────────────── (hairline)
```

The header is the compact one (`PageHeader size="sm"`, about 80px with its tabs) so the page below
keeps the height; Live's diagram needs it most. One row: the Back chevron (retraces the tab's
history and names where it goes), the crumbs (`Crumbs`, `tabs/crumbs.tsx`) saying where it is
stored, **Storage** (the board, `go.page`) / the Store with its family mark (`go.store`), then the
project's mark and name as the last step (the page's h1, 15px). After it, in small muted type, the
facts: **Runs on** (opens the Sandboxes tab) and the machines of its Sandboxes (`RunsOnChips`, each
opens the machine's page), then the last Commit and the Store's bytes on disk. Actions on the right,
at 28px: Refresh (a ghost icon) and New chat. Under 46 rem of the header's width the facts take a
second line of their own and the crumbs truncate, keeping the actions on the first.

Tabs (`TabBar variant="line"`: text tabs on one hairline, the chosen one underlined in the brand
colour), in this order in every language, in two groups: **Live** (a pulsing dot and the count of
chats working while one does), **Chats** (its count, and a dot while one works), Files, History |
Sandboxes, Storage. A link that names a tab opens it; with none the page opens on Chats, or on Live
when the chats read shows one working (once, before any click). Old `sessions` / `runs` tab hashes
open Chats; old `worktrees` / `work` open Sandboxes. When the project read fails, its `LoadError`
shows above Chats and Live too (they render without it), so a disabled New chat is never
unexplained.

- **Chats** ([project-sessions.md](project-sessions.md)): the project's chats, each with its
  Branch and where it runs (RUNS IN: its Workspace's machine and Sandbox).

- **Store banner** (`projects/store-banner.tsx`), above every tab:
  - **busy**: "Store <store> is busy: <operation · phase>". Writes and new Sandboxes are refused
    until it ends; the page updates when it does.
  - **down**: "Store <store> is down: <machine> is not running", LayerFS's reason, and **Start
    <machine>** (`machine.start`; nothing starts it otherwise).
  - **unresolved**: the operation, "Its outcome was lost", and "see `layerfs store status <store>` ·
    clear: `<clearing call>`".
  - each shows LayerFS's refusal under it when a read was refused.
- **Reads while the Store refuses calls.** When a push or pull holds the Store (`Busy`), its outcome
  is unresolved (`Unresolved`) or its machine is stopped (`Unavailable`), the page still renders from
  the home's records: the project, its Sandboxes and the Store's state. Branches and Commits wait.
- **Storage** ([project-storage.md](project-storage.md)): the Store card; its Machine fact opens
  the machine's page.
- **Sandboxes** ([project-sandboxes.md](project-sandboxes.md)).

## Cross-links

Every cross-link opens a page in the same tab; Back (the chevron, ⌘[) returns. A machine's or
Store's page opened from elsewhere shows the same Back chevron before its crumbs.

- Store chip, the crumbs' Store → the Store's page on Storage; the crumbs' Storage → the board.
- Machine chip (Runs on in the list and the header, a chat's Runs in), a Sandbox tile's machine,
  the project's Machine fact → the machine's page on Machines.
- A chat's Branch → the project's History at that Branch.
- A machine's page: each Sandbox's project → the project's Sandboxes; its Store chip → the Store;
  Stores → each Store and each of its projects.
- A Store's page: each project row → the project; its Runs on chips → the machines.

## States

- **Loading**: three skeleton rows.
- **Error**: `LoadError` ("the projects") with Retry.
- **Empty**: "No projects yet" with Create project.
- **No match**: "No projects match" with Clear search; a screen reader hears "1 of 3 projects".
- **Storage view unread or missing**: Stored in shows what the project summary carries (`store`,
  `kind`, `storeState`, `storeOp`).
- **Machines unread** (1.x, refused, not yet answered): Runs on reads "—" and By machine is hidden.
- **Chats unread**: CHATS reads "—" and LAST ACTIVITY falls back to when the project was made.

## Delete

`DeleteProjectDialog` (`projects/delete-project-dialog.tsx`) opens from the project tree's x, which
is off for now ([sidebar.md](sidebar.md)). It names the project and its Store, and when the Store
holds other projects it says they and the Store stay. It lists the project's Sandboxes and offers
**Close N Sandboxes and delete** (`project.remove` is refused `InUse` while any Sandbox record
exists; the refusal lists them). After a refusal, **Force close and delete** closes them with `force`
and lists Workspaces of unknown state. A PostgreSQL project cannot be removed by LayerFS 2.0
(`Unsupported`): the dialog says to disconnect the Store on Storage instead.

In dev builds the header's flask picker (`components/simulation.tsx`, shared with Machines and
Storage) lists a simulated host's projects and chats (`data/home-sim.ts`, `data/compute-sim.ts`)
instead; Live is hidden and Refresh and New project are disabled. A sample project opens on sample
content: while simulation is on, the host client answers its reads (`data/project-sim.ts`: its
Branches and Commits, a file tree, its Sandboxes and Workspaces, its chats, its Store totals) and
refuses anything that would change it.
