# LayerFS Connect UI

How the desktop app's screens are laid out. One window: the sidebar on the
left, and on the right the screen it picks. Each screen has its own file here,
with an ASCII skeleton and the components that draw it.
Source: `src/renderer/src/App.tsx` (the shell), `src/renderer/src/components/`.

## The window

```text
+-[1] Sidebar ---------------------+-[2] Screen --------------------------------------------------+
| [o] LayerFS Connect              | Page header: title, facts       [ Play scenario v ] [ ... ] |
|  * Projects                    + |  History   Storage   Sandboxes | Sessions 3 |               |
| RESOURCES                        |  ====                                                        |
|    Storage                       | +----------------------------------------------------------+ |
|    Compute                       | |                                                          | |
| YOUR PROJECTS  3       All v  ↻  | |  The tab's content                                       | |
| > [] shop               *  + x   | |                                                          | |
|   | o Fix the checkout test      | |                                                          | |
|   | * Crew  crew_2 · 31/96       | +----------------------------------------------------------+ |
| LOCAL CHATS                    + |                                                              |
+----------------------------------+--------------------------------------------------------------+
```

1. **Sidebar** (`AppSidebar`, `app-sidebar.tsx`): the pages, every project
   with its chat conversations and scenario runs, and local chats. See
   [sidebar.md](sidebar.md).
2. **Screen** (`App`, `App.tsx`): Projects (the default), Storage, Compute,
   Chat, a project page or a run page. A change of screen cross-fades.

## The model

Three kinds, each with one home page, and two relationships drawn the same way everywhere:

```text
  WHERE DATA LIVES            WHAT YOU WORK ON             WHERE IT RUNS
  Store (Storage)  --holds-->  Project (Projects)  --runs in-->  Sandboxes on Machines
  one Store                    many projects                    sqlite: its Store's machine
                                                                PostgreSQL: any machines
```

- A project is **stored in** exactly one Store: its key is `<store>/<project>`, and every page shows
  it as a Store chip or as the crumbs `Storage / <store>` above the project's title.
- A project **runs on** the machines its Sandboxes are on (`RunsOnChips`, `projects/where-chips.tsx`):
  a list, never a parent. A PostgreSQL Store's projects run on any number of machines.
- A sqlite Store's file is on one machine ("file on native"): a fact of the Store, not of where its
  projects run. A machine's page keeps the two apart: **Stores** (sqlite Stores
  on its disk, PostgreSQL Stores it reaches) and **Sandboxes**.
- Detail pages carry crumbs (`tabs/crumbs.tsx`): `Storage / <store>` (a Store, and above a project's
  title), `Machines / <machine>`. A Back chevron beside them retraces the tab's history; the crumbs
  climb the model. Every cross-link opens in the same tab.

## The screens

| Group | Screen | File |
|---|---|---|
| Shell | Sidebar | [sidebar.md](sidebar.md) |
| Pages | Projects | [layerfs-projects.md](layerfs-projects.md) |
| | Storage | [layerfs-storage.md](layerfs-storage.md) |
| | Machines | [layerfs-compute.md](layerfs-compute.md) |
| Project page | Live (top of Sessions) | [project-live.md](project-live.md) |
| | History (and Files) | [project-history.md](project-history.md) |
| | Storage | [project-storage.md](project-storage.md) |
| | Sandboxes | [project-sandboxes.md](project-sandboxes.md) |
| | Sessions, Script and Play scenario | [project-sessions.md](project-sessions.md) |
| Run page | Conversation and Checks | [session-conversation.md](session-conversation.md) |
| | Trace | [session-trace.md](session-trace.md) |
| Dialogs | Models | [dialog-models.md](dialog-models.md) |
| | New project | [dialog-new-project.md](dialog-new-project.md) |

## How the screens connect

```text
Sidebar
 |- Projects / Storage / Compute --> those pages
 |- a project row -----------------> Project page
 |- a chat row, + on a project, + on Local chats --> Chat
 '- a run row ---------------------> Run page (under its project)

Project page:  History | Storage | Sandboxes  |  Sessions N (Live on top) | Script
   |- Play scenario (or /scenario in a chat on the project) --> the new run's page
   '- Sessions: a row --> Run page
Run page:  Conversation | Checks | Trace
                                    '- an auto-checkpoint link --> History, on that Commit
```

## Shared pieces

- **Page frame:** `PageHeader` (`size="sm"`: the compact one-row header of a project page),
  `Tab` / `TabBar` (glass buttons, or `variant="line"`: text tabs on a hairline with the chosen one
  underlined, on a project's and a chat's pages; `TabDivider` between groups), and `Segmented`
  switches (`components/motion/`). Detail pages (a project, a chat, a machine) keep their header to
  one thin row (Back, crumbs ending in the page's name at 15px, its facts, small actions) so the
  page below keeps the height.
- **States:** `Loading`, `Empty` and `LoadError` (`components/projects/states.tsx`).
- **Controls:** shadcn components (`components/ui/`): button, dialog,
  dropdown-menu, select, sheet, table, tooltip.
- **Icons:** LayerFS icons (`components/lfs-icons.tsx`, SVGs in `assets/icons/`).
- **Theme:** colours, radii and motion are tokens in `src/renderer/src/styles.css`,
  one light theme (no dark mode): soft matte from the app icon. Powder-blue
  canvas, cobalt primary, charcoal text, opaque grained surfaces (`--grain`), soft
  blue-grey shadows, no backdrop blur, tight corners (`--radius: 0.3rem`).

## Dev aids

Open a screen directly with `CONNECT_VIEW`:

- `projects` (the default) or `chat`
- `projects/<project>[/<tab>]` (tabs: history, storage, sandboxes, sessions, script; `live` opens Sessions)
- `runs/<run id>[/<agent>]`
- `storage`
- `compute`

Save a screenshot with `CONNECT_SHOT=<file.png>`. See the main
[README](../../README.md#develop).
