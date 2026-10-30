# Projects

Every LayerFS project in Connect's home, one card each. Opens from: Projects in the sidebar's
Workspace group. A card opens the project page.
Source: `src/renderer/src/components/projects/projects-home.tsx` (main file; others named in Regions).

A project goes by its **key** (`projectKey`, LayerFS #506): its name, or `store/name` for a project
in a Store that holds other projects. Selection, routing, every host call and the Chat project
choice use the key; the screens show it with `projectLabel` (`name · store`) or as the name with the
Store beside it.

## Skeleton

```text
+-[1] PageHeader -----------------------------------------------------------------------------+
| Projects                                [ Search projects      ] [ Refresh ] [ + New project ] |
| Your LayerFS workspaces.                                                                      |
+-----------------------------------------------------------------------------------------------+
  3 projects
+-[2] ProjectCard -----------------------+  +----------------------------------------+
| /\ shop                             -> |  | /\ api                              -> |
| [] /Users/you/shop                     |  | [] Empty workspace                     |
| +-[3] StoreLine ---------------------+ |  | +------------------------------------+ |
| | [R2] team                [In sync] | |  | | [db] api              [Local only] | |
| |      r2-main / team · 265 MB       | |  | |      Local only · 78.6 MB          | |
| +------------------------------------+ |  | +------------------------------------+ |
| -------------------------------------- |  | -------------------------------------- |
| (Ready)                 Created 2 h ago|  | (Ready)                 Created 3 h ago|
+----------------------------------------+  +----------------------------------------+
```

## Regions

1. **Page header** (`PageHeader` in `ProjectsHome`): "Projects", "Your LayerFS workspaces.", the
   search box, Refresh and New project ([dialog-new-project.md](dialog-new-project.md)). Search
   matches the name, the Store and the source folder; Esc clears it.
2. **Project cards** (`ProjectCard`, `projects/home/project-card.tsx`): a liquid-glass grid. Each
   card shows the project's name, its source folder (or "Empty workspace"), its Store line, and in
   the footer Ready / Not initialized and its age. The card opens the project page by key.
3. **Store line** (`StoreLine`, `projects/store-facts.tsx`): the Store's `StoreIcon` (the SQLite or
   PostgreSQL mark, or the linked provider's), its name, where it syncs (`remote / file`, "Local
   only", or "on <connection>" for PostgreSQL) and its size, then its `SyncPill`. The facts come from
   one cached `host.storage()` view shared by every card, reread on Storage events, ended sync jobs
   and project changes. A LayerFS build without Stores shows "Local SQLite" and no pill.

## Project page

`projects/project-view.tsx`. The title is the project's name; beside it a `StoreBadge` (Store mark,
name, sync state). The facts row keeps Last Commit, Branches, Commits and the Store's bytes on disk.
Actions: Refresh, Play scenario (see [project-sessions.md](project-sessions.md)) and New chat.
Tabs: History (with Files),
Storage, Sandboxes, then Sessions with its count and, on a project with a scenario of its
own, Script. Old `worktrees` / `work` tab hashes open Sandboxes, whose Workspace rows carry
"Browse files" (the Files view on that Workspace's Branch).

- **History** (`history-tab.tsx`): reads the project, then every Branch's Commits in one
  `host.branchCommits(key, branches)` call; a reread asks only for the Branches whose head moved.
- **Storage** (`project-storage.tsx`): the Store card's header is the Store's mark, "SQLite Store
  <name>" or "PostgreSQL Store <name>", its `SyncPill` and its link chip (`remote / file` or "local
  only"), a family-specific line, and "Shared with N other projects" for a shared Store. The facts
  show Volume (SQLite) or Connection (PostgreSQL).

## States

- **Loading**: three skeleton cards.
- **Error**: `LoadError` ("the projects") with Retry.
- **Empty**: "No projects yet" with Create project.
- **No match**: "No projects match" with Clear search; the count line reads "1 of 3 projects".
- **Storage view unread or missing**: the Store line shows what the project summary carries
  (`store`, `kind`, `storeSync`, `storeProviders`); size is left out until the view answers.

## Delete

The sidebar's x opens `DeleteProjectDialog` (`projects/delete-project-dialog.tsx`). It names the
project and, for a project in a Store, says it is deleted from that Store and shows the Store line.
When the Store holds other projects it says they and the Store stay, and that a linked copy keeps
the project until the Store's next push. Deleting calls `host.removeProject(key)`.
