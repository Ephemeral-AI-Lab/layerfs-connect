# New project (LayerFS 2.0)

> **Status:** Current, 2026-11-02. Source: `src/renderer/src/components/projects/new-project-dialog.tsx`,
> `host/projects.js` (`create`, `init`). Spec step 6.

- **Name** and **Start with** (an empty project or a copy of a folder).
- **Store:** a sqlite Store on native or a PostgreSQL Store (project.init goes nowhere else and
  never makes a Store), or **New SQLite Store…**, made first on native with `store.create`.
  Storage's **Add project** opens the dialog on its Store.
- **Init** runs on the host (`POST /api/projects`), which keeps its own job table fed by
  `on_progress`: scan, files, tree, publish, seal, with file and byte counts.
- When the project is there and the home has other machines, an optional **Move Store to…**
  step moves the Store; it warns that the whole Store moves, every project in it.

Delete (the project's menu) lists the project's Sandboxes and offers **Close N Sandboxes and
delete** (`project.remove` is refused `InUse` while any Sandbox record exists). After a refusal,
**Force close and delete** closes them with `force` and lists Workspaces of unknown state. A
PostgreSQL project cannot be removed by 2.0 (`Unsupported`): the dialog says so.
