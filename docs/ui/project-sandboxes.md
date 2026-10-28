# Project: Sandboxes

The Docker Sandboxes open on the project, as tiles with their mounted Workspaces and Branches. Opens from: the Sandboxes tab of a project page (a project's name in the sidebar, or its card on the LayerFS page).
Source: `src/renderer/src/components/projects/project-storage.tsx` (`ProjectSandboxes`; others named in Regions).

## Skeleton

```text
+-[1] Tab row -------------------------------------------------------------------------------------+
| Live   Timeline   History   Storage   Sandboxes                |  Sessions 28   [ > Replay | v ] |
|                                       =========                                                  |
+--------------------------------------------------------------------------------------------------+
     +-[2] SandboxesCard ---------------------------------------------------------------------+
     | [S] Docker Sandboxes                                                  Open  Workspaces |
     |     Containers the agents mount Workspaces in. Each            2 +1 closed           3 |
     |     Workspace is a Branch of playground; what it                                       |
     |     writes reaches the Store when it commits.                                          |
     |----------------------------------------------------------------------------------------|
     | [3]                                                                                    |
     | +-[4] SandboxTile -----------------------+  +- SandboxTile --------------------------+ |
     | | [S]* layerfs-sandbox-1       (Running) |  | [S]  layerfs-sandbox-2        (Exited) | |
     | |      Sandbox 1                         |  |      Sandbox 2                         | |
     | |                                        |  |                                        | |
     | | ##.............. 2 / 16 Workspaces     |  | ................ 0 / 16 Workspaces     | |
     | | W /work ~ ~ ~ ~ ~ ~    [b crew_1.lead] |  | + - - - - - - - - - - - - - - - - - -+ | |
     | | W /docs ~ ~ ~ ~ ~ ~           [b main] |  | | W No Workspace mounted             | | |
     | |                                        |  | + - - - - - - - - - - - - - - - - - -+ | |
     | |----------------------------------------|  |----------------------------------------| |
     | | image  sha256:1a2b3c4d5e6f...          |  | image  sha256:1a2b3c4d5e6f...          | |
     | +----------------------------------------+  +----------------------------------------+ |
     |                                                                                        |
     | [5] Closed  [S layerfs-sandbox-3]  [S layerfs-sandbox-4]                               |
     +----------------------------------------------------------------------------------------+
```

## Regions

1. **Tab row** (`ProjectPage`, `projects/project-view.tsx`): the project page's first row (the sidebar names the project): Live, Timeline, History, Storage, Sandboxes, then Sessions with its count, then `ReplayControl` (`runs/replay-control.tsx`), shown once the demo is read. Every tab reads the project's newest session (`RunPanel`, `runs/run-view.tsx`).
2. **SandboxesCard** (`SandboxesCard`, `projects/project-storage.tsx`): "Docker Sandboxes" and a line on what they are; on the right, Open (with "+N closed") and Workspaces (brand-coloured when any).
3. **SandboxTiles** (`SandboxTiles`, `projects/sandbox-tiles.tsx`): the open Sandboxes, two tiles per row.
4. **SandboxTile** (`SandboxTile`, `Slots`, `projects/sandbox-tiles.tsx`): name, "Sandbox 1" and a state chip (Running, Starting, Restarting, Exited, Dead). Then 16 Workspace slots, one lit per mount, with "2 / 16 Workspaces"; a row per mounted Workspace (path, a wire, Branch chip, "unknown Branch" when none); and a footer with "image" and the short digest. A running tile glows: a lit border, a pulsing dot, and bytes travelling along the wires.
5. **Closed row** (`SandboxTiles`, `projects/sandbox-tiles.tsx`): Sandboxes that are gone, as name chips after "Closed".

## States

- **Empty** (the screenshot): `Empty` "No Sandboxes open" with "A Sandbox opens when an agent first mounts a Workspace." while a session plays, else "The session's Sandboxes have closed; its Workspaces were unmounted with them." Open and Workspaces read 0.
- **No Workspace**: a tile with none shows a dashed "No Workspace mounted".
- **Loading**: "Reading <project>"; a failed read shows `LoadError` with a retry.
