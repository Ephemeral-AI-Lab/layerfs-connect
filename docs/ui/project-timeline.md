# Project: Timeline

The project's fork map over time: main's Layers along a spine, each Branch leaving its parent where it forked, replayable. Opens from: the Timeline tab of a project page (a project's name in the sidebar, or its card on the LayerFS page).
Source: `src/renderer/src/components/projects/history-tab.tsx` (`TimelineTab`; others named in Regions).

## Skeleton

```text
+-[1] Tab row -------------------------------------------------------------------------------------+
| Live   Timeline   History   Storage   Sandboxes                |  Sessions 28   [ > Replay | v ] |
|        ========                                                                                  |
+--------------------------------------------------------------------------------------------------+
+-[2] Toolbar -------------------------------------------------------------------------------------+
| [ Find a Branch or Commit ]  ( All 133 | Open 82 | Done 51 ) 133 Branches ... main at [9d16ac44] |
+--------------------------------------------------------------------------------------------------+
+-[3] ForkMap -------------------------------------------------------------------------------------+
| main @ [9d16ac44] - 182 Commits    Click a Branch to open its lineage [ > Replay ] [ - * 55% + ] |
|--------------------------------------------------------------------------------------------------|
| [4]                                                                                 now          |
|       .--o-------o [ crew_1.people.1 - merged ] *                                     :          |
|       |         .--o----o--o--------------o [ tour_2.feature-home ] *                 :          |
|       |         |       .--o [ crew_1.int-people-m1 ] *                               :          |
|       |         |       |       .--o [ shop_2.main ] *                                :          |
|    L1 | L2   L3 |  L4   |  L5   |                                                     :          |
|  ==#======#====#=====#======#===#== - - - - - - - - - - - - - - - - - - - - - - - - - :-[ main ] |
|             |        |             |                                                  :          |
|             |        |             '--o--o [ parallel_2.main ] *                      :          |
|             |        '--o--o--o [ checkpoints_1.r4 - merged ] *                       :          |
|             '--o [ crew_1.main.2 - merged ] *                                         :          |
| ...                                                                                              |
+--------------------------------------------------------------------------------------------------+
```

## Regions

1. **Tab row** (`ProjectPage`, `projects/project-view.tsx`): the project page's first row (the sidebar names the project): Live, Timeline, History, Storage, Sandboxes, then Sessions with its count, then `ReplayControl` (`runs/replay-control.tsx`), shown once the demo is read. Every tab reads the project's newest session (`RunPanel`, `runs/run-view.tsx`).
2. **Toolbar** (`Toolbar`, `projects/history-tab.tsx`): `SearchField` "Find a Branch or Commit" (`projects/history/parts.tsx`), the All / Open / Done filter with counts, and the counts line, in full "133 Branches · 82 open · forks 10 deep · 182 Commits · main at 9d16ac44" ("No Branches yet" before any fork). Search and filter narrow the Branches drawn.
3. **ForkMap** (`ForkMap`, `projects/history/fork-map.tsx`): the head row: "main @" with the head Layer's `HashChip`, the Commit count, "Click a Branch to open its lineage", [ Replay ], and the zoom group: -, the zoom % (a click fits the map to the view; a dot shows when fitted), +.
4. **ForkMap canvas** (`ForkMap`, `projects/history/fork-map.tsx`): main is the spine, solid through its newest Layer and dotted on to the dashed "now" line, where the "main" pill sits. Layer ticks are labelled L1 (oldest) to L10. Top-level Branches alternate above and below main, and their forks nest outward. Each lane has its Commit dots and a label pill (name, "· merged" when merged, the agent's dot); published Branches curve back into main. A label opens that Branch in History.

Hidden: the 2D / 3D / Game switch at the toolbar's start, with the 3D (`projects/history/citadel.tsx`) and Game (`projects/history/game/`) views, is behind `SHOW_VIEWS = false`.

## States

- **Loading**: "Reading <project>" ("Initializing <project>" while the session starts), then "Reading Branches and Commits"; a failed read shows `LoadError` with a retry.
- **Replaying**: the map rebuilds from the first Layer. The head row adds "· replay at <time>", a progress bar runs under it, and the button reads Pause, then Resume.
- **Live**: the map rereads as the session moves, at most every 1.5 s.
- **Filtered**: Branches outside the search or filter are not drawn.
