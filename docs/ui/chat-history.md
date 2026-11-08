# Desktop History: horizontal Git graph

Source: `desktop/src/renderer/src/components/history/` (`ProjectHistory.tsx`,
`HistoryGraph.tsx`, `model.ts`, `history.css`, `tokens.css`). Shared by chat and
Storage project History. Chat's wrapper adds Trace provenance and links.
Opens from: Chat > History, Storage project > History, Trace checkpoint badges,
`#/chat/<id>/history?branch=<name>&commit=<full-id>`, and equivalent child routes.
The older renderer's History is described in [project-history.md](project-history.md).

## Storage SDK comparison preview

Source: `HistoryPreview.tsx`, `preview-model.ts`, `history-comparison.css`, `HistoryGraph.tsx`;
shared viewers in `components/files/{FileDiff,FileAttributionDiff,FileBlame,CommitDetails}.tsx`.
Development simulation uses the same local saved trees as Files. The labeled exit opens host
history. Chats, other projects, real mode and production retain their existing History behavior.

### History page: `/storage/shop/api/history`

```text
[1] History preview - Sample data - read-only                   [Browse host history]
+-[2] History - main: project core -------------------------- [Branch v] [Now] -+
|                   o----(3 commits)----o feature-login                        |
|                  /                                                          |
| main ===[]---[From]--[To]                                                     |
|                  \---o fix-orders                                           |
| Source publish branches and review branch have their own lanes.              |
| Overview: saved topology and viewport                                        |
+-[3] Selected commit / Net changes across N commits --------------------------+
| Message and branch        [Use as base] [Details] [Open changes/comparison]   |
+------------------------------------------------------------------------------+
```

The graph owns the page. Selecting a commit changes only its selection and summary; it does
not open a file viewer. Use as base pins a saved ID; choose a destination and Open comparison.
Open changes compares parent/base, or an empty tree for Init. A collapsed group compares its
first parent's tree with its last grouped commit; Expand exposes intermediate commits.

### Comparison page: `/storage/shop/api/history/diff`

```text
[4] [Back to History] / Branch comparison                 [Attribution example]
+------------------------------------------------------------------------------+
| [5] From [branch @ saved-id v] [Swap] To [branch @ saved-id v] [Clear base]     |
| Commit message                          [Use as base] [Compare main] [Details]|
+-[6] Changed files --------+-[7] Selected file --------------------------------+
| [Find a path...]          | src/routes/login.js                              |
| M CHANGELOG.md       4<-> | |Content| Attribution  Code  Blame                |
| O src/routes/login.js 2<->|                                                  |
|                          | Shared content or line-ownership comparison      |
| Per page [5 v] [<] [>]    | from-id -> to-id                      Sample     |
+--------------------------+--------------------------------------------------+
```

| [n] | Region | Behavior |
|---|---|---|
| 1 | Preview notice | Explicit local samples; no proposed SDK calls or writes; exit to host history |
| 2 | Graph | Main publication chain, source publish edges and side branches; existing pan/zoom/overview; From/To marks |
| 3 | Selection | Commit/group summary, pin base, inspect metadata, explicit navigation to comparison page |
| 4 | Page navigation | Separate route and full comparison view at both desktop sizes; Back restores graph selection and position |
| 5 | Endpoints | Saved IDs stay pinned; Swap reverses versions; Clear base restores parent comparison |
| 6 | Changed paths | Added/Modified/Removed/Ownership-only; owner-change counts, search and page controls |
| 7 | File view | Content diff, Attribution, destination Code or Blame; arrow/Home/End keyboard tab navigation |

Attribution aligns the two saved blame results using content-diff line mappings. Before/after
owner IDs are clickable. Unchanged text with different Commit/Layer ownership is explicitly
highlighted; added/removed content is labeled separately. Unavailable attribution stays unknown.
Ownership-only files remain in the changed-file list even when their content and inode match.
The sample review branch reaches the same login text as main through a different history.
Publishing itself does not change ownership: main blame follows its source Commit. Attribution
means saved revision ownership; no human author or agent identity is inferred.

Origin details show parent, operation, time, source and paths. Show this change opens that
origin's parent comparison. Back to comparison restores the prior pair, path, view and scroll.
The graph is kept mounted for navigation state but is not displayed on the comparison page.
There is no split pane or graph behind the diff view at 1280x820 or 900x600.

Hash-route query params `commit`, `from`, `branch`, `path`, `view` make comparisons shareable.
Unknown saved IDs offer host history/reset. Empty diffs, filtered paths, absent destination files
and binary content/attribution/blame have distinct states. The parent graph never scrolls
horizontally with the page; file code and ownership tables may scroll inside their own pane.
SDK proposals remain in `docs/sdk-branch-file-proposal.md`.

## Graph canvas

```text
+-[1] History  main @ <id>  322 checkpoints loaded -------- [Branches 8 v] [Now] [R]-+
|                                                            [-] 100% [+] [Fit] |
|                 o--------o--------o---[search-tests]                          |
|                /                          \                                  |
|       o---[search]                          o---[combined]                     |
|      /                                    /                                  |
| ===[]---[main]........................................................ now   |
|      \                                  /                                   |
|       o------(40)-------o---[documentation]                                    |
|        \                                                                    |
|         o------(100)--------o---[indexing]                                     |
|                                                                              |
+-[3] Overview / now --[ histogram of loaded history + viewport window ]--------+
| [4] Layer on main   Checkpoint   Branch   Merge   Publish                     |
+------------------------------------------------------------------------------+
```

| [n] | Component | Source | Behavior |
|---|---|---|---|
| 1 | Toolbar | ProjectHistory.tsx | Current main identity, loaded checkpoint count, branch finder, Now, Refresh |
| 2 | Full canvas | HistoryGraph.tsx | Horizontal event order; main centered vertically; distinct lanes above/below; plain commit dots and thin lines |
| 3 | Overview | HistoryGraph.tsx | Density of loaded history, current viewport, click/drag and keyboard navigation, return to now |
| 4 | Legend | ProjectHistory.tsx | Squares for Layers, dots for checkpoints, rings for merges, dashed publish edges |

No botanical theme, leaf markers, green trunk treatment, permanent branch column,
or empty detail column. Use Connect's standard surfaces, modest lane colors,
small branch-tip labels, and a neutral main line.

## Inspect a checkpoint

```text
+- Graph continues behind inspector -------------------------------------------+
|                                              +-[1] Checkpoint ---------- [x]-+|
|       o-----o-----o                           | message                      ||
|                                              | Branch  search               ||
| main ======================================  | ID      <full commit>        ||
|                                              | [View in Trace - #17]        ||
|       o----(40)---o                           | Changed paths                ||
|                                              | modified /src/filter.ts      ||
|                                              | [Load earlier checkpoints]   ||
|                                              +------------------------------+|
+------------------------------------------------------------------------------+
```

The inspector is contextual, dismissible, up to 310px wide, and scrolls internally.
Group selection shows net changed paths and Expand N checkpoints. Individual
selection shows that checkpoint's paths and exact Trace link when available.
Selecting a visible checkpoint preserves the viewport; an offscreen link pans to
reveal its target. Closing the inspector restores the full unobstructed canvas.

## Branches, groups and density

- Branch finder opens from the toolbar; search names, choose/reveal a branch,
  expand/collapse a family, or page more branches. Nested families start visible.
- Each branch has a distinct stable lane. Children remain on their parent's side
  and grow outward. Balance counts visible branch-family footprints rather than
  checkpoint counts: every branch uses one lane regardless of writes.
- Heads, fork points, merges, both merge parents, and selected commits remain
  individually addressable. Groups hold at most 100 consecutive writes from one
  producing tool call when provenance is known. Expansion changes presentation.
- Zoomed-out dense sequences reduce ordinary marker density. Topology and focus
  markers remain visible; zooming in reveals intermediate markers.
- Parent relationships determine horizontal order; timestamps are labels only.
  Unknown parents have a short dashed stub, never a fabricated edge to main.
- A merge connects both source histories to a checkpoint on its resulting branch.
  A publish edge is shown only when its provenance is known.
- Main's latest Layer and known earlier base Layer IDs are honest anchors. The
  SDK does not expose the full main Layer timeline; coverage is stated below.

## Map controls and states

Drag empty canvas to pan. Normal scrolling moves the view. Ctrl/Cmd + scroll
zooms at the pointer; +/- and 0 work with graph focus. Zoom controls offer out,
percentage/reset, in, and Fit. Glyphs and branch labels retain readable sizes as
geometry scales. Now restores the latest view centered on main. Overview supports
pointer navigation and Left/Right keys. Respect reduced motion; no replay animation.

Verify at 1280x820 and 900x600. The graph owns the whole available height at both
sizes. The surrounding page never scrolls horizontally; the graph pans internally.
The same shared component is used inside the subagent panel and Storage project.

Loading: Reading history. Empty: No history yet. Unlinked chat: No LayerFS project
linked. Read error keeps the graph and offers Try again. Branch search empty:
No branches match. Selected diff errors remain local to the inspector.

## Trace links and bounded reads

Full commit identity is scoped by project; checkpoint numbers are display labels.
A Trace call highlights its exact known checkpoint set, including sparse numbers.
History resolves old targets beyond the newest metadata page; Trace automatically
loads earlier pages to reveal the producing tool and highlights the exact write.
Root/child agent identity is preserved. Missing provenance reads No linked trace
in this chat or its agents. Fork/publish references do not overwrite a Commit's
original producer. Chat and Trace retain their existing routes and state.

`GET /api/projects/<encoded-key>/history` pages 100 branch metadata records.
`?branch=<name>&pos=<n>&head=<id>` pages 100 commit records without eager diffs.
`?branch=<name>&commit=<id>[&from=<group-parent>]&pos=<n>` reads up to 100 changed
paths on selection. HeadMoved refuses continuation; Refresh restarts it. Initial
metadata loads at most eight branches with four concurrent reads. Other branches
load on demand. A first checkpoint cannot be compared against a Layer by this SDK.

Reference: dsh-layerfs `packages/view/src/tree.js`, `treezoom.js`, `history.js` at
`b9bf3bc819b42007354f08c9444156188c4fbadb`; structural ideas only. The user explicitly
requested plain Git history styling on 2026-11-08.

Verification: `node --test desktop/tools/history-model.test.mjs host/test/history.test.js`,
`node desktop/tools/smoke-history.mjs`, desktop typecheck and build.
