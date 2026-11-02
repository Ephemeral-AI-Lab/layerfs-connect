# A project's Sandboxes (LayerFS 2.0)

> **Status:** Current, 2026-11-02. Source: `src/renderer/src/components/projects/project-storage.tsx`
> (`ProjectSandboxesContent`), `sandbox-tiles.tsx`, `host/projects.js`. Spec step 7.

- The tab lists the project's Sandbox records (`sandbox.list(project)`) with each one's
  Workspaces (`sandbox.get(name)`): its path, Branch and activity. A Workspace is carried as its
  2.0 handle `<sandbox>:<path>`.
- **New Sandbox:** a prefilled name, unique in the home, and an optional image (the machine's
  image when left out). A sqlite project's machine is shown, fixed: its Store's. A PostgreSQL
  project chooses native or docker.
- **Close** on each Sandbox; a refused close offers **Force close**, which lists the Workspaces
  whose state LayerFS could not learn (`unknown`).

Hidden behind one line (§9 Q5): a Sandbox's live state; the tab shows the recorded state.
