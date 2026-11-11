# Desktop History: horizontal Git graph

Source: `desktop/src/renderer/src/components/history/` (`ProjectHistory.tsx`,
`HistoryGraph.tsx`, `model.ts`, `history.css`, `tokens.css`). Shared by chat and
Storage project History. Chat's wrapper adds Trace provenance and links.
Opens from: Chat > History, Storage project > History, Trace checkpoint badges,
`#/chat/<id>/history?branch=<name>&commit=<full-id>`, and equivalent child routes.
The older renderer's History is described in [project-history.md](project-history.md).

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

## Phase 2 CLI reads (2026-11-09)

Chat History shares the saved-history graph and inspector with Storage. Main
Layers and side Commits use branch.commits; immutable parent pins resume paging.
Changed paths use commit.diff cursors for every endpoint kind. Source Commit and
source save time remain distinct from Layer parent and nullable publication time.
Chat Files uses the same pinned saved-file browser as Storage.

## Linked operations (2026-11-10)

```text
+-- Checkpoint inspector ------------------+
| [connect-op:op-…] Bash root call_… (exit 0)
| Branch / ID / When                       |
| [6] Produced by                          |
|     ↗ workspace.commit created it        |
|       write one · root · chat-…          |
|     Referenced by 2 operations           |
|     ↗ workspace.commit saved it unchanged|
+------------------------------------------+
```

| Region | Behavior |
| --- | --- |
| 6 | From the local catalog of this home's conversations (`GET /api/agent/versions`): producers (`created`, `published`) apart from references (fork, unchanged save, merge/publish inputs). None reads `No linked trace`. Links open the conversation's Trace at `?op=` |

A link to a branch this view has not read yet (created while the conversation runs) reads
the project's branches again, once per linked branch, then selects the version.

`connect.session.<id>` branches are marked "conversation journal" in the branch finder and
inspector: application data, never mounted, merged or published as code. An imported
conversation saved under another Store name shows `saved as <origin>` through its binding.
