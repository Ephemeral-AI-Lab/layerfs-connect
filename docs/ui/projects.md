# Projects

Source: `components/projects/projects-home.tsx`, `home/project-table.tsx`, `where-chips.tsx`,
`states.tsx`, `new-project-dialog.tsx`, `delete-project-dialog.tsx` (all under
`src/renderer/src/components/projects/`)     Opens from: sidebar Projects, `#projects`

## Projects list

```text
+-[1] PageHeader (sticky) ---------------------------------------------------------------+
| Projects                                                                               |
| Each project is stored in one Store and runs in Sandboxes on any of your machines.     |
|                                                                                        |
| [v <flask> Live host]  ( <search> ~~~ Search projects ~~~       )  [<rotate> Refresh]  |
|  ^2                      ^3                                         ^4                 |
|                                                                   [+ New project]*     |
|                                                                    ^5                  |
+----------------------------------------------------------------------------------------+
  [6] Group (None 4) (By Store) (By machine)                         Sort (Recent) (Name)

+-[7] ProjectTable ----------------------------------------------------------------------+
| Project      Stored in        Runs on          Chats              Last activity        | [8]
|----------------------------------------------------------------------------------------|
| web          ( shop )         not running      --                 3 days ago         > | [9]
| api          ( shop )         ( native )       1 * 1 working      3 days ago         > |
| notes        ( lab )          not running      --                 8 days ago         > |
| crm          ( team )         not running      --                 17 days ago        > |
+----------------------------------------------------------------------------------------+
```

| [n] | Component | file:line | one line |
|---|---|---|---|
| 1 | PageHeader | projects-home.tsx:118 | Sticky title, description and the action row (wraps under 46rem) |
| 2 | SimulationPicker | simulation.tsx:78 | Dev builds only (hidden in sim mode): Live host or a simulated host |
| 3 | search Input | projects-home.tsx:126 | Filters by name, Store or machine; x and Escape clear it |
| 4 | Refresh | projects-home.tsx:155 | Rereads the catalog; spins while loading; off when simulated |
| 5 | New project | projects-home.tsx:157 | Opens the New project dialog; off when simulated |
| 6 | Group / Sort pills | projects-home.tsx:176 | None shows the count; By machine only when machines were read |
| 7 | ProjectTable | project-table.tsx:41 | One glass table per group; each row opens the project page |
| 8 | header row | project-table.tsx:45 | Shown at 44rem container width and up |
| 9 | ProjectRow | project-table.tsx:58 | Store chip, Runs on chips, open/working chats, last activity, chevron |

Row cells:

```text
| api          ( shop ) ( Busy - store.push - copy )   ( native x2 ) ( docker ) +1   ... |
|              lima2 is stopped                         ^12                              |
|               ^10     ^11                                                              |
```

| [n] | Component | file:line | one line |
|---|---|---|---|
| 10 | StoreChip | where-chips.tsx:45 | Opens the Store on Storage; its click never opens the row |
| 11 | StateChip + storeDown | project-table.tsx:89 | Only when the Store is not idle/in use, or has an op; storeDown line under it |
| 12 | RunsOnChips | where-chips.tsx:90 | Machine chips (xN Sandboxes), at most 3 then +N; `not running`; `--` unread |

Narrow (container under 44rem): the row folds into two lines.

```text
+-[13] ProjectRow, narrow ---------------------------+
| api                                              > |
| ( shop )  ( native )  1 * 1 working  3 days ago    |
+----------------------------------------------------+
```

| [n] | Component | file:line | one line |
|---|---|---|---|
| 13 | ProjectRow second line | project-table.tsx:85 | The four cells wrap under the name; `contents` when wide |

Grouped (By Store; By machine is the same with machine chips and `Not running` last):

```text
  ( shop )  SQLite - file on native  2                      [14]
  +------------------------------------------------------+
  | web ...                                              |
  | api ...                                              |
  +------------------------------------------------------+
  ( lab )  SQLite - file on lima1  1
  +------------------------------------------------------+
  ...
  ( team )  PostgreSQL  1
```

| [n] | Component | file:line | one line |
|---|---|---|---|
| 14 | group heading | projects-home.tsx:51 | Store chip + family, or MachineChip, or `Not running`; then the row count |

## States

```text
Loading                          Error
+---------------------------+    +----------------------------------+
| ######################### |    |            <unplug>              |
+---------------------------+    |   Could not read the projects    |
| ######################### |    |   <host error message>           |
+---------------------------+    |          [Try again]             |
| ######################### |    +----------------------------------+
+---------------------------+

Simulated note (dev simulation picked), above everything:
( <flask> Simulated ) Mac, many Stores: sample data, not this machine.

Empty                                           No match
+-------------------------------------------+   +-------------------------------------------+
|               <folder-open>               |   |              <folder-search>              |
|              No projects yet              |   |             No projects match             |
| Start with an empty workspace or import   |   | Nothing matches "xyz". Search by name,    |
|          an existing folder.              |   |            Store or machine.              |
|           [+ Create project]*             |   |              [Clear search]               |
+-------------------------------------------+   +-------------------------------------------+
```

- Loading: three skeleton bars (`projects-home.tsx:166`). Error: `LoadError` (`states.tsx:54`); a
  host that cannot be reached titles it `The Connect host is not reachable`.
- Empty (`projects-home.tsx:172`) shows instead of the Group/Sort bar; No match
  (`projects-home.tsx:192`) shows under it.
- Simulated note: `SimulatedNote` (`simulation.tsx:101`) above everything when a dev simulation
  is picked.

## Menus and dialogs

### New project dialog

Opens from: [+ New project] here, Storage's Add project (Store preselected), the chat page.

```text
+-[1] New project --------------------------------------------- x -+
| <folder+> New project                                            |
| A LayerFS workspace with its own history.                        |
|                                                                  |
| Project name                                                [2]  |
| my-project______________________________________________________ |
| Lowercase letters, numbers, dots, hyphens and underscores.       |
|                                                                  |
| Start with                                                  [3]  |
| +-(o)------------------------+  +-( )------------------------+   |
| | <file+> Empty project      |  | <folder> Import folder     |   |
| | A clean workspace          |  | Copy existing files        |   |
| +----------------------------+  +----------------------------+   |
|                                                                  |
| Store                                                       [4]  |
| [v <sqlite> shop                                             ]   |
| It shares shop's file on native: a push, pull or backup          |
| carries every project in it.                                     |
|------------------------------------------------------------------|
| <db> Store shop                       [Cancel] [Create project]* | [5]
+------------------------------------------------------------------+
```

| [n] | Component | file:line | one line |
|---|---|---|---|
| 1 | NewProjectDialog | new-project-dialog.tsx:226 | Cannot close while posting, browsing or a job runs (unless polling failed) |
| 2 | Project name | new-project-dialog.tsx:239 | Max 63; also prefills a new Store's name until that is edited |
| 3 | Start with | new-project-dialog.tsx:243 | Two radio cards: Empty project / Import folder |
| 4 | StoreField | new-project-dialog.tsx:344 | Hidden when the host has no Storage view |
| 5 | footer | new-project-dialog.tsx:315 | Store label; Cancel (Close once a job runs); Create project |

Import folder chosen: a field appears under Start with.

```text
  Source folder                                                [6]
  ~~~ Choose a local folder... ~~~_____________________  [<folder> Browse]
  Files are copied into the project. The original folder stays in place.
```

| [n] | Component | file:line | one line |
|---|---|---|---|
| 6 | Source folder | new-project-dialog.tsx:260 | Mono path input; Browse opens the OS picker (`Opening...` while open) |

Store picker and its variants:

```text
[v <sqlite> shop                ]     open:  +-----------------------------------+
                                             | <sqlite> shop                     |
While read:                                  |          2 projects - 96.0 KB     |
[v <spin> Reading Stores...     ]            | <sqlite> lab                      |
                                             |          1 project - 48.0 KB      |
New SQLite Store chosen:                     | <pg>     team                     |
[v <folder+> New SQLite Store   ]            |          1 project - PostgreSQL   |
my-project______________________             |-----------------------------------|
A new sqlite Store on native; more projects  | <folder+> New SQLite Store...     |
can join it later, and it can be pushed to   +-----------------------------------+
any machine.
  (or, red: Name the new Store. /
   A Store has this name; choose it in the list instead.)
footer: <db> New Store my-project

PostgreSQL chosen:
It goes into the database team; its Sandboxes run on any machine that supports
PostgreSQL Sandboxes.
```

Default Store: the one passed in (Storage's Add project), else the last one used
(`connect.newProject.store`), else the first, else New SQLite Store.

Start-machine warning (a sqlite Store whose machine is stopped, e.g. one on lima2):

```text
+-[7] StartFirst --------------------------------------------------+
| lima2 is stopped, so this Store is down. Start it to add a       |
| project here.                                                    |
| [Start lima2]                                                    |
| <refusal, if the start failed>                                   |
+------------------------------------------------------------------+
```

Progress, push step, failures (all under the form, above the footer):

```text
+-[8] progress ----------------------------------------------------+
| <spin> Saving files...                                           |
|        12 files - 3.4 KB                                         |
+------------------------------------------------------------------+
footer:                                [Close](off) [<spin> Creating...](off)

+-[9] push step ---------------------------------------------------+
| shop/web is ready on native.                                     |
| Push its Store to another machine? The whole Store goes, every   |
| project in it, and their Sandboxes then run there.               |
| [v Keep it on native                   ]  [<upload> Push Store]* |
+------------------------------------------------------------------+
footer:                                                    [Close]

+-[10] failure (red) ----------------------------------------------+
| Project initialization failed.                                   |
+------------------------------------------------------------------+
+-[11] poll error (amber) -----------------------------------------+
| Could not update creation status                                 |
| <message>                                                        |
| Creation may still be running. Check its status before starting  |
| another project.                                                 |
+------------------------------------------------------------------+
footer:                                     [Close] [<refresh> Check status]*
```

| [n] | Component | file:line | one line |
|---|---|---|---|
| 7 | StartFirst | new-project-dialog.tsx:417 | Start {machine} runs machine.start, then rereads Storage |
| 8 | progress | new-project-dialog.tsx:285 | `Starting project...`, then the job step (STEPS, line 50) and its counts |
| 9 | push step | new-project-dialog.tsx:291 | Only for a sqlite Store on native when other machines exist; lists `name (platform)` |
| 10 | failure | new-project-dialog.tsx:306 | Validation (`Name the project.`, `Choose a folder to import.`), host or job error |
| 11 | poll error | new-project-dialog.tsx:307 | Job status read failed; Check status replaces Create project |

Job steps shown in [8]: `Reading source files...`, `Saving files...`, `Building the tree...`,
`Publishing main...`, `Finishing...`. On done the dialog closes and the project page opens,
unless [9] shows.

### Delete project dialog

```text
+-[1] alertdialog -------------------------------------- x -+
| <trash> Delete project?                                   |
| This permanently deletes the project and its history      |
| from the Store shop. This cannot be undone.               |
|                                                           |
| +-[2]---------------------------------------------------+ |
| | <folder> api                                          | |
| |          shop/api                                     | |
| +-------------------------------------------------------+ |
| +-[3] StoreLine ----------------------------------------+ |
| | <sqlite> shop                                         | |
| |          on native - 96.0 KB - idle                   | |
| +-------------------------------------------------------+ |
| The Store and its 1 other project stay.                   |
| +-[4] (amber) ------------------------------------------+ |
| | It has 1 Sandbox, which must close first:             | |
| | api-dev - native - running                            | |
| +-------------------------------------------------------+ |
| Your original source folder and saved conversations will  |
| stay in place.                                            |
| <[5] error + refusal, red>                                |
|                                                  [Cancel] |
|   [Force close and delete] [Close 1 Sandbox and delete]*  |
|    ^6                                                     |
+-----------------------------------------------------------+
```

| [n] | Component | file:line | one line |
|---|---|---|---|
| 1 | DeleteProjectDialog | delete-project-dialog.tsx:63 | Focus starts on Cancel; cannot close while deleting |
| 2 | project box | delete-project-dialog.tsx:84 | Name and key |
| 3 | StoreLine | store-facts.tsx:128 | Store mark, name, where, size, state; then the "others stay" line |
| 4 | Sandboxes list | delete-project-dialog.tsx:101 | Read on open; the main button then closes them first |
| 5 | error | delete-project-dialog.tsx:111 | InUse and PostgreSQL Unsupported get their own sentence |
| 6 | Force close and delete | delete-project-dialog.tsx:114 | Only after a refusal while Sandboxes remain |

With no Sandboxes the main button reads `Delete project`; while working, `Deleting...`.

## Notes

- Delete project has one opener: the sidebar's ProjectTree (`app-sidebar.tsx:494`), which is not
  rendered (`SHOW_PROJECT_TREE = false`, `app-sidebar.tsx:65`). So the dialog is unreachable today.
- `storeNeedsWord` (`project-table.tsx:19`) is exported but used only in its own file.
- Chats counts come from the chat list; the simulated `mac` host seeds no chats, so every row
  shows `--` until a chat runs (the `1 * 1 working` above is illustrative).
