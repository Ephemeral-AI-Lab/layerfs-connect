# New project dialog

Makes a LayerFS project by Init, empty or as a copy of a folder, then opens a new session on it.
Opens from: New project on the LayerFS Projects tab, or "New project..." in the sidebar's New session
menu.
Source: `src/renderer/src/components/projects/new-project-dialog.tsx` (every region is in this file).

## Skeleton

Drawn with "From a folder" chosen; the dialog opens on Empty, without the Folder field.

```text
+--------------------------------------------------------------------+
| +-[1] DialogHeader ----------------------------------------------+ |
| | New project                                                  x | |
| | A LayerFS project of its own: empty, or a copy of a folder.    | |
| | Changes in the folder later do not reach the project.          | |
| +----------------------------------------------------------------+ |
| +-[2] Start from ------------------------------------------------+ |
| | +----------------------------+  +----------------------------+ | |
| | | ( ) Empty                  |  | (*) From a folder          | | |
| | |     main with no files     |  |     Import its files       | | |
| | +----------------------------+  +----------------------------+ | |
| +----------------------------------------------------------------+ |
| +-[3] Folder ----------------------------------------------------+ |
| | Folder                                                         | |
| | [ /Users/you/my-app                            ] [ Choose... ] | |
| | Everything in it is imported, node_modules and .git included.  | |
| +----------------------------------------------------------------+ |
| +-[4] Name ------------------------------------------------------+ |
| | Name                                                           | |
| | [ my-app                                                     ] | |
| +----------------------------------------------------------------+ |
| +-[5] DialogFooter ----------------------------------------------+ |
| |                                 [ Cancel ]  [ Create project ] | |
| +----------------------------------------------------------------+ |
+--------------------------------------------------------------------+
```

## Regions

1. **Header** (`DialogHeader` in `NewProjectDialog`, `projects/new-project-dialog.tsx`): "New project", the description, and the close x.
2. **Start from** (`NewProjectDialog` radiogroup, `projects/new-project-dialog.tsx`): two cards, Empty ("main with no files") and From a folder ("Import its files"). From a folder opens the system folder picker when no folder is set yet.
3. **Folder** (`NewProjectDialog`, `projects/new-project-dialog.tsx`), only for From a folder: an absolute path field (placeholder "/Users/you/my-app") and "Choose..." when the app can pick folders. A note says everything is imported; it reads "An absolute path" in red for a relative one. Picking a folder fills Name from the folder's name until Name is typed.
4. **Name** (`NewProjectDialog`, `projects/new-project-dialog.tsx`): the project name, mono, placeholder "my-project". Under it in red: "Lowercase letters, digits, _ . and -, starting and ending with a letter or digit", or "A project has this name".
5. **Footer** (`DialogFooter`, `projects/new-project-dialog.tsx`): Cancel, and Create project, which is enabled once the name (and the folder) is valid.

## States

- **Creating**: a status row appears above the footer, showing a spinner, the Init step and, once counted, "N files - size". The steps are Counting the folder, Making the Store volume, Importing and Done. Every control is disabled, the button reads "Creating...", and the dialog cannot be closed. When it is done, the dialog closes and a draft session opens on the new project.
- **Failed**: the step reads "Failed", and the error shows with a warning icon above the footer.
