# Sidebar

The app's left column: the pages and every LayerFS project. Opens from: always shown, on the left
of the window.
Source: `src/renderer/src/components/app-sidebar.tsx` (every region is in this file).

## Skeleton

```text
+-[1] Brand ---------------------+
| [o] LayerFS Connect            |
+--------------------------------+
+-[2] Navigation ----------------+
| WORKSPACE                      |
|  * Chat                        |
|    Projects                  + |
| RESOURCES                      |
|    Storage                     |
|    Compute                     |
+--------------------------------+
+-[3] Your projects -------------+
| YOUR PROJECTS  3            ↻  |
|  [] shop  team               x |
|  [] api                      x |
|  [] web   team               x |
+--------------------------------+
+-[4] Footer --------------------+
| Language                       |
+--------------------------------+
```

## Regions

1. **Brand**: the Connect mark in a liquid-glass tile and "LayerFS Connect".
2. **Navigation**: Workspace (Chat, Projects) and Resources (Storage, Compute), with a sliding
   glass indicator. The + beside Projects opens the New project dialog
   ([dialog-new-project.md](dialog-new-project.md)).
3. **Your projects**: the project directory shared with the Projects page and Chat
   (`useProjects`), newest first, with its count and a refresh button. Each row opens the project
   by its key (`store/name` for a project in a shared Store); such a row shows the Store's name
   faint after the project's name, and its tooltip reads "<name> in Store <store>". The x opens
   the delete dialog, which names the project's Store. The list rereads when a project or Store
   is made or removed anywhere in the app.
4. **Footer**: the language switcher.

## States

- **Loading**: three skeleton rows.
- **Error**: "Could not load projects." with Retry.
- **Empty**: "No projects yet." with Create project.
- **Selected**: the open project's row is a glass pill with an open folder.
