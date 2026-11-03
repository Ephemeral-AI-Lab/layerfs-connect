# Projects

Every LayerFS project in Connect's home, one card each (LayerFS 2.0, #537 §7). Opens from: the
Projects heading in the sidebar. A card opens the project page.
Source: `src/renderer/src/components/projects/projects-home.tsx` (main file; others named in Regions).

A project goes by its **key**, `<store>/<project>`: its data lives in that Store. Selection, routing,
every host call and the Chat project choice use the key; the screens show the name with the Store
beside it.

## Skeleton

```text
+-[1] PageHeader -----------------------------------------------------------------------------+
| Projects                                [ Search projects      ] [ Refresh ] [ + New project ] |
| Your LayerFS workspaces.                                                                      |
+-----------------------------------------------------------------------------------------------+
  3 projects
+-[2] ProjectCard -----------------------+  +----------------------------------------+
| /\ web                              -> |  | /\ api                              -> |
| [] shop/web                            |  | [] pg/api                              |
| +-[3] StoreLine ---------------------+ |  | +------------------------------------+ |
| | [db] shop                          | |  | | [pg] pg                            | |
| |      on dev-lima · 265 MB · busy   | |  | |      in its database · in use      | |
| +------------------------------------+ |  | +------------------------------------+ |
| -------------------------------------- |  | -------------------------------------- |
| (store.push · send)     Created 2 h ago|  | (In use)                Created 3 h ago|
+----------------------------------------+  +----------------------------------------+
```

## Regions

1. **Page header** (`PageHeader` in `ProjectsHome`): "Projects", "Your LayerFS workspaces.", the
   search box, Refresh and New project ([dialog-new-project.md](dialog-new-project.md)). Search
   matches the name, the Store and the machine; Esc clears it.
2. **Project cards** (`ProjectCard`, `projects/home/project-card.tsx`): a liquid-glass grid. Each
   card shows the project's name, its key, its Store line, and in the footer the Store's state chip
   (an operation in flight shows its name and phase) and its age.
3. **Store line** (`StoreLine`, `projects/store-facts.tsx`): the Store's mark (SQLite or PostgreSQL),
   its name, then where it is ("on <machine>", or "in its database" for PostgreSQL), its size and its
   state. The facts come from one cached `host.storage()` view shared by every card, read again on
   Storage events, ended Storage jobs and project changes.

## Project page

`projects/project-view.tsx`. The title is the project's name; beside it a `StoreBadge` (the Store's
mark and name), which opens the Store's row on Storage. The facts line keeps the last Commit and the
Store's bytes on disk. Actions: Refresh and New chat. Tabs: Live, Files, Storage, History, Sessions
(with its count) and Sandboxes. Old `worktrees` / `work` tab hashes open Sandboxes.

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
  the machine's row on Compute.
- **Sandboxes** ([project-sandboxes.md](project-sandboxes.md)).

## Cross-links

- Store badge → the Store's row on Storage.
- Storage's machine heading, a Sandbox tile's machine, the project's Machine fact → the machine's row
  on Compute.
- Compute's Store rows → the Store's row on Storage and each project's page.
- Compute's Sandboxes table: the project → its Sandboxes tab; the machine → its row.

## States

- **Loading**: three skeleton cards.
- **Error**: `LoadError` ("the projects") with Retry.
- **Empty**: "No projects yet" with Create project.
- **No match**: "No projects match" with Clear search; the count line reads "1 of 3 projects".
- **Storage view unread or missing**: the Store line shows what the project summary carries (`store`,
  `kind`, `machine`, `storeState`, `storeOp`); size is left out until the view answers.

## Delete

`DeleteProjectDialog` (`projects/delete-project-dialog.tsx`) opens from the project tree's x, which
is off for now ([sidebar.md](sidebar.md)). It names the project and its Store, and when the Store
holds other projects it says they and the Store stay. It lists the project's Sandboxes and offers
**Close N Sandboxes and delete** (`project.remove` is refused `InUse` while any Sandbox record
exists; the refusal lists them). After a refusal, **Force close and delete** closes them with `force`
and lists Workspaces of unknown state. A PostgreSQL project cannot be removed by LayerFS 2.0
(`Unsupported`): the dialog says to disconnect the Store on Storage instead.
