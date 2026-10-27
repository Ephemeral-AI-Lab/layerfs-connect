# LayerFS icons

Seventeen 24×24 icons, one per LayerFS concept, drawn in the logo's language:
round nodes, rounded caps and joins, a 1.8 stroke, two tones.

- Light tone, `--lfs-light` (#93B1E0): committed, immutable state (Layers, Commits, history).
- Dark tone, `--lfs-dark` (#2F5BB5): live, mutable work (Branches, Workspaces, calls).
- `--lfs-warn` (#E0A030) is used only by `conflict`; `--lfs-surface` (#fff) fills
  `fork`'s open end.

Each file carries those variables with the brand colours as fallbacks, so an
`<img>` shows the brand colours and inline SVG follows the page's variables
(for dark mode set `--lfs-dark: #6F93E6` and `--lfs-surface` to the card colour).

| File | Concept |
| --- | --- |
| project | a LayerFS project (the mark) |
| store | the SQLite Store |
| layer | a Layer on main (newest plate dark) |
| commit | a Commit |
| branch | a Branch: trunk and one curved arm |
| fork | making a Branch: a new dark arm leaving the main line |
| merge | two lines joining |
| publish | a Branch published onto main |
| workspace | a mounted, mutable filesystem |
| sandbox | a container holding Workspaces |
| exec | a command running in a Workspace |
| mount | attaching a Workspace (folder and link) |
| conflict | a merge conflict (amber node) |
| diff | added and removed |
| agent | an agent session (bubble with the node graph) |
| worker | the LayerFS box |
| init | a new project from a folder |
