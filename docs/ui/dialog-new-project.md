# New project (LayerFS 2.0)

> **Status:** Current, 2026-11-04 (#537 §7). Source: `src/renderer/src/components/projects/new-project-dialog.tsx`,
> `host/projects.js` (`create`, `init`).

- **Project name** and **Start with** (an empty project, or a copy of a folder on this Mac).
- **Store:** any Store in the home: a sqlite Store on any machine, or a PostgreSQL Store; each item
  shows its project count and size. Or **New SQLite Store…**, named here and made first on native with
  `store.create` (Init never makes a Store). The last Store used is chosen first. Storage's **Add
  project** opens the dialog on its Store.
- **Init into a Store on a machine** reads the folder on this Mac and writes through the Store's
  machine (a VM's worker). If that machine is stopped, the Store is down and Init is refused; the
  dialog says "<machine> is stopped, so this Store is down" and offers **Start <machine>**. Nothing
  starts it otherwise.
- **Init** runs on the host (`POST /api/projects`), which keeps its own job table fed by
  `on_progress`: scan, files, tree, publish, seal, with file and byte counts. A refusal (a busy Store,
  say) shows in the dialog.
- **Push Store** (optional): after Init into a sqlite Store on native, when the home has other
  machines, the dialog asks whether to push the Store to one of them (machines whose `supports.sqlite`
  is true). The whole Store goes, every project in it, and their Sandboxes then run there. **Push
  Store** starts the push; its progress shows on Storage. Leaving it keeps the Store on native.

Delete is described in [layerfs-projects.md](layerfs-projects.md).
