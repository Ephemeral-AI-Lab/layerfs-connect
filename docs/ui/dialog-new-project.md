# New project dialog

Makes a LayerFS project by Init, empty or as a copy of a folder, in a Store the user picks, then
opens it. Opens from: New project on the Projects page, the + beside Projects in the sidebar, and
the + in Chat's workspace picker.
Source: `src/renderer/src/components/projects/new-project-dialog.tsx` (every region is in this file).

## Skeleton

Drawn with "Import folder" and an existing Store chosen.

```text
+--------------------------------------------------------------+
| +-[1] DialogHeader ----------------------------------------+ |
| | [+] New project                                        x | |
| |     A LayerFS workspace with its own history.            | |
| +----------------------------------------------------------+ |
| +-[2] Project name ----------------------------------------+ |
| | [ my-project                                           ] | |
| | Lowercase letters, numbers, dots, hyphens and underscores.| |
| +----------------------------------------------------------+ |
| +-[3] Start with ------------------------------------------+ |
| | +- Empty project ------+  +- Import folder ------------+ | |
| | | A clean workspace    |  | Copy existing files        | | |
| | +----------------------+  +----------------------------+ | |
| +----------------------------------------------------------+ |
| +-[4] Source folder ---------------------------------------+ |
| | [ /Users/you/my-app                        ] [ Browse ]  | |
| +----------------------------------------------------------+ |
| +-[5] StoreField ------------------------------------------+ |
| | Store                                                    | |
| | [ [R2] team                                          v ] | |
| | It shares team's file and its link: pushes to r2-main /  | |
| | team carry every project in it.                          | |
| +----------------------------------------------------------+ |
| +-[6] Footer ----------------------------------------------+ |
| | (db) Store team                [ Cancel ] [ Create ]     | |
| +----------------------------------------------------------+ |
+--------------------------------------------------------------+
```

## Regions

1. **Header**: "New project" and "A LayerFS workspace with its own history."
2. **Project name**: lowercase letters, numbers, `.`, `-` and `_`, 1–63 long.
3. **Start with**: Empty project or Import folder.
4. **Source folder** (Import folder only): the path and Browse (the system folder picker).
5. **Store** (`StoreField`): a Select of the local SQLite Stores from `host.storage()`, each with
   its `StoreIcon`, its project count and size, and its `SyncPill`; then "New SQLite Store…". The
   first choice is the Store the last project went into (`connect.newProject.store`), else the
   first Store, else a new one. A new Store takes a name (filled from the project name until
   typed; 1–32 lowercase letters, numbers and hyphens, not taken) and a note that more projects
   can join it later. An existing Store's note says the project shares its file and its link.
6. **Footer**: where the project goes ("Store team", "New Store team", or "Local SQLite"), Cancel,
   and Create project.

Create makes the new Store first (`host.createStore`) when one is asked for, then calls
`host.createProject({ name, source?, store })` and follows `host.projectInit(id)` until it ends.
The created project opens by its key.

## States

- **No Stores in this LayerFS build** (`storage().stores.available` false, or no Storage view):
  the Store field is not shown and the footer reads "Local SQLite"; Create sends no `store`, so
  Init makes the project's own Store as before.
- **Reading Stores**: the Store field shows "Reading Stores…" and Create waits for it.
- **Creating**: a status row shows the Init step and, once counted, "N files · size"; controls
  are disabled and the dialog cannot close.
- **Failed**: the error shows in red; a Store made for this project stays, chosen, for a retry.
- **Status lost**: "Could not update creation status" with Check status.
