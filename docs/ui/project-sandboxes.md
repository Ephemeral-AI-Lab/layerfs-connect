# A project's Sandboxes (LayerFS 2.0)

> **Status:** Current, 2026-11-04 (#537 §7). Source: `src/renderer/src/components/projects/project-storage.tsx`
> (`ProjectSandboxesContent`, `NewSandbox`), `sandbox-tiles.tsx`, `host/projects.js`.

- The tab lists the project's Sandboxes (`sandbox.list(project)`, read again every 5 s) with each
  one's Workspaces (`sandbox.get(name)`). The header counts "N recorded · M mounted". Closed (`gone`)
  Sandboxes fold under **Closed**.
- **A Sandbox tile** shows its name, its machine (opens the machine's row on Machines), its state chip
  (an operation in flight shows its name and phase) and **Close**. An unresolved Sandbox shows "see
  `layerfs sandbox get <name>` · clear: `layerfs sandbox close <name>`"; a refused `sandbox.get` shows
  LayerFS's code and words. **Details** gives the name, image, backend and route.
- **Workspaces** on a tile: each one's name (when it has one), path and Branch, and **Browse files**
  (the Files tab on that Branch). A Workspace is carried as its handle `<sandbox>:<name or path>`.
- **Mount Workspace** (a running Sandbox): choose a side Branch, or **New Branch from main…** with its
  name (forked from main first), and an optional Workspace name. Only side Branches are mounted; main
  is the published line, and mounting it is refused.
- **New Sandbox:** a prefilled name, unique in the home, and an optional image (the machine's image
  when left out). A sqlite project's machine is shown, fixed: its Store's. A PostgreSQL project lists
  every machine; those whose `supports.postgresql_sandbox` is false are disabled with LayerFS's reason.
  While the Store is busy, LayerFS refuses new Sandboxes, and the refusal shows under the form.
- **Close** on each Sandbox; a refused close shows the refusal and offers **Force close**, which lists
  the Workspaces whose state LayerFS could not learn (`unknown`).
- **Chat Workspaces** are mounted with a name taken from the chat's Branch (`chat-<id>`), so they show
  by name here and on Machines.

The same Sandboxes, with every other project's, are on Machines' Sandboxes table. A chat's
Workspace cell on the Chats tab ([project-sessions.md](project-sessions.md)) names the machine and
Sandbox it runs in.
