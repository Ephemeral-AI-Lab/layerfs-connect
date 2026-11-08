# Project page: History tab

Part of the project page (project.md).

Source: `src/renderer/src/components/projects/history-tab.tsx`, `.../projects/history/`
(`branch-tree.tsx`, `lineage-graph.tsx`, `commit-detail.tsx`, `fork-map.tsx`, `parts.tsx`,
`history.css`), `src/renderer/src/data/forks.ts`
Opens from: project page tab History (`project-view.tsx:185`); a Branch link elsewhere on the page
opens it focused on that Branch (`initialBranch`); the `map` tab id opens the Map view.

Paths in legends are relative to `src/renderer/src/components/projects/history/`; the tab file is
`../history-tab.tsx`.

## Lineage view (wide)

Sample: `shop/api`; main has one Layer; `feature-login` (3 Commits) and `fix-orders` (1 Commit)
both forked from it. Focus starts on the Branch with the newest Commit, its head selected.

```text
+-[1] Toolbar -----------------------------------------------------------------------------------+
| <s> Search branches or commits________  |All| Open branches  Finished branches   Map |Lineage| |
+-[2] MissingNote (never shown, see Notes) ------------------------------------------------------+
| <!> Commit (3f9a1c2e) is not available in this history.                                     x  |
+-[3] Branches ----------+-[4] Lineage graph ----------------------+-[5] Commit -----------------+
| Branches 3             | # main > (o) feature-login              | Commit                      |
|                        | 3 Commits                               |                             |
| v # main          1 L  |-----------------------------------------| (3f9a1c2e) (Head)           |
|   | o feature-login +3 |  (o) [3f9a1c2e] Test the logi   3 hours | Test the login route        |
|   | o fix-orders    +1 |   |                                     |                             |
|                        |   o  [b7d04e11] Check passwor yesterday | On    [feature-login]       |
|                        |   |                                     | When  3 hours ago           |
|                        |   o  [5c2e8a90] Add a login r yesterday |                             |
|                        |  /                                      | 1 path changed          +1  |
|                        | #'   [9e41d7c3] Publish - [> fix-orders]| [+] /test/login.test.js     |
+------------------------+-----------------------------------------+-----------------------------+
```

| [n] | Component | file:line | one line |
|---|---|---|---|
| [1] | toolbar | ../history-tab.tsx:161 | Search, Show Branches filter, View switch at right |
| [2] | MissingNote | ../history-tab.tsx:211 | Amber: linked Commit/Layer missing; x dismisses |
| [3] | Branches pane | ../history-tab.tsx:170 | PaneHead "Branches" + shown count, BranchTree |
| [4] | LineageGraph | lineage-graph.tsx:70 | Focused Branch + ancestors up to each fork point |
| [5] | detail pane | ../history-tab.tsx:194 | PaneHead "Commit"/"Layer"/"Detail", CommitDetail |

Filter options sort by label length: All, Open branches, Finished branches. View options likewise:
Map (Network icon), Lineage (GitCommitVertical icon). Escape or the field's x clears the search.

## Lineage view (narrow, container under 58rem)

```text
+-[1] Toolbar (wraps) -----------------------------------+
+-[3] Branches 11rem -+-[4] Lineage graph ---------------+
|                     |                                  |   row 1: at least 14rem
+---------------------+----------------------------------+
| [5] Commit detail, spans both columns, scrolls         |   row 2: 13rem
+--------------------------------------------------------+
```

| [n] | Component | file:line | one line |
|---|---|---|---|
| - | lineage grid | ../history-tab.tsx:169 | 11rem/1fr, 2 rows; from 58rem 12rem/1fr/16rem |

## Branch tree row

```text
[1] v [2] # [3] main ........................ [5] 1 L
          |   o feature-login ......... [4] *     +3
          |   o fix-orders ..................     +1
          |   o <merged Branch> (faint) ...   merged
```

| [n] | Component | file:line | one line |
|---|---|---|---|
| [1] | toggle | branch-tree.tsx:176 | Chevron "Expand/Collapse {name}"; off while narrowing |
| [2] | lane mark | branch-tree.tsx:197 | Square for main, dot for forks; colour per fork depth |
| [3] | row button | branch-tree.tsx:189 | Focuses; tooltip "forked from {parent} at {id}" |
| [4] | AgentDot | branch-tree.tsx:212 | Branch's main agent (needs a run trace: never) |
| [5] | count | branch-tree.tsx:213 | main "{n} L"; else "merged", "published", "+{n}" |

Children hang under a border in their parent's lane colour. Merged Branches with forks start
collapsed. Arrow keys move, Right/Left open, close or go to the parent (`branch-tree.tsx:89`).

## Lineage graph rows

Header with a long ancestry (more than 3 Branches):

```text
+-[1] ---------------------------------------------------------------------+
| # main > [...] > (o) <parent> > (o) <branch>                             |
| 2 Commits - merged                                                [2]    |
+--------------------------------------------------------------------------+
  [...] opens [3]:  +-------------------+
                    | o <ancestor 1>    |
                    | o <ancestor 2>    |
                    +-------------------+
```

Row kinds (lane 0 = main at the left, one lane per ancestry step):

```text
  lane: 0 1 2
        | | o   [4] [3f9a1c2e] (<branch>) * Message text ............. 3 hours
        | | O   [5] [b7d04e11] Fork point (hollow dot) ........... yesterday [> <kid>] +2  [6]
        | |/
        | o     [4] [5c2e8a90] (<parent>) Parent's Commit ......... yesterday
        |/
        #       [7] [9e41d7c3] Publish ................................. -
        #       [7] [11aa22bb] Older Layer (dim) ....................... -
     ( 4 earlier Layers on main )                                            [8]
            : ( No Commits yet )                                             [9]
```

| [n] | Component | file:line | one line |
|---|---|---|---|
| [1] | breadcrumb | lineage-graph.tsx:132 | "Fork ancestry": ancestor buttons, focus bold |
| [2] | subline | lineage-graph.tsx:171 | "{n} Commit(s)" or main's "{n} entries", ". merged" |
| [3] | folded menu | lineage-graph.tsx:137 | Ellipsis "{n} more ancestors"; item focuses |
| [4] | commit row | lineage-graph.tsx:326 | HashChip, lane chip, agent dot, message, age |
| [5] | fork point | lineage-graph.tsx:264 | Hollow dot: the next path Branch forked here |
| [6] | fork links | lineage-graph.tsx:389 | First Branch forked here (opens it), "+{n}" |
| [7] | layer row | lineage-graph.tsx:250 | Square on lane 0; older than the fork: dim |
| [8] | earlier | lineage-graph.tsx:333 | Layers past 2 below the fork, folded |
| [9] | empty Branch | lineage-graph.tsx:278 | Dashed dot, "No Commits yet", dashed curve |

The lane chip `(<branch>)` labels the row where an ancestor's lane starts (never main or the
focused Branch). The agent dot needs a run trace (see Notes). Up/Down select, Left focuses the
parent, Right the first unmerged child (`lineage-graph.tsx:88`). main's line fades above the fork.

## Commit detail

A Commit (left) and main's Layer (right):

```text
+-[1] Commit ----------------------------+  +-[1] Layer -------------------------------------+
| (b7d04e11)                         [2] |  | (9e41d7c3) (Layer on main) (Head of main)  [2] |
| Check passwords against the store  [3] |  | Publish                                    [3] |
|                                        |  |                                                |
| On    [feature-login]              [4] |  | From  Init                                 [4] |
| When  yesterday                        |  | When  -                                        |
|                                        |  |                                                |
| 2 paths changed            ~1 +1   [7] |  | Forked here                            2   [6] |
| +------------------------------------+ |  | [feature-login +3] [fix-orders +1]             |
| | [~] /src/routes/login.js           | |  |                                                |
| | [+] /src/auth.js                   | |  | +- - - - - - - - - - - - - - - - - - - - - - + |
| +------------------------------------+ |  | : No file changes                        [7] : |
+----------------------------------------+  +------------------------------------------------+
```

Merge Commits add, under the facts:

```text
| Merged in                          [5] |
| [<branch> 1a2b3c4d]                    |
```

| [n] | Component | file:line | one line |
|---|---|---|---|
| [1] | CommitDetail | commit-detail.tsx:123 | The selected Commit or Layer |
| [2] | chips | commit-detail.tsx:148 | HashChip; Layer on main, Head of main, Head, Merge |
| [3] | title | commit-detail.tsx:155 | The message (a Layer without one: "Publish") |
| [4] | facts | commit-detail.tsx:158 | On / By (needs a trace) / From / When |
| [5] | Merged in | commit-detail.tsx:190 | Merged-in Commit's Branch link + short id |
| [6] | Forked here | commit-detail.tsx:200 | Branches forked here, "+{n}"; merged faint |
| [7] | Changes | commit-detail.tsx:38 | "{n} paths changed", tallies per kind, paths |

Branch links open that Branch's lineage. Change kinds: added `+`, deleted/removed `-`,
modified/changed `~`, renamed `->` (tally sign and icon colour); folder part of a path is faint.
From: the publishing Branch, "Init" for the oldest Layer, else "Published to main".

## Map view

```text
+-[1] Toolbar (same as Lineage; Map selected) ---------------------------------------------------+
+-[2] Map toolbar -------------------------------------------------------------------------------+
| Timeline  4 Commits                         <loc>  [> Replay]  [>|]  [ - | * 100% | + ]        |
|################################........ (replay progress, only while replaying)                |
+-[3] Fork timeline (scrolls both ways) ---------------------------------------------------------+
|                                                          now                                   |
|                                                           :                                    |
|                     ,-------o--------o--------o----( feature-login )  focused: filled          |
|                    /  L1                                  :                                    |
|        ===========#- - - - - - - - - - - - - - - - - - - - - -( main )                         |
|                    \                                      :                                    |
|                     `---o--( fix-orders )                 :                                    |
+------------------------------------------------------------------------------------------------+
```

| [n] | Component | file:line | one line |
|---|---|---|---|
| [1] | toolbar | ../history-tab.tsx:161 | Search/filter narrow the Map and recentre it |
| [2] | map toolbar | fork-map.tsx:220 | "Timeline", Commits so far, the controls below |
| - | Locate | fork-map.tsx:225 | "Locate selected branch": scrolls to the focused head |
| - | Play | fork-map.tsx:228 | Pause / Resume / Replay; an event per 140 ms |
| - | Return to latest | fork-map.tsx:231 | SkipForward, while replaying: back to the end |
| - | Zoom | fork-map.tsx:232 | Zoom out, fit (dot when fitted, "{n}%"), Zoom in |
| - | progress | fork-map.tsx:255 | 2px bar under the toolbar while replaying |
| [3] | ForkMap canvas | fork-map.tsx:264 | x = event order (Layers and Commits), not time |
| - | now | fork-map.tsx:268 | Dashed line after the last shown event |
| - | main spine | fork-map.tsx:325 | Solid to newest Layer, dotted to now; "L{n}" |
| - | Branch lanes | fork-map.tsx:286 | Leave the parent at the fork; top ones alternate |
| - | merges | fork-map.tsx:274 | Dashed curve, merged-in Commit to the merge |
| - | labels | fork-map.tsx:357 | Branch pills open Lineage; "main" pill at now |

Lit ancestry draws thicker, merged Branches at half opacity, a fork-point Commit hollow. Every dot
and Layer has a tooltip "id - message - when". A publish curve joins a Branch to its Layer when a
Layer names its Branch.

## States

```text
(spinner) Reading Branches and Commits                                 loading [1]

+-------------------------------------------+
|           <unplug>                        |
|  Could not read this project's history    |                         error [2]
|  <host message>                           |
|              [Try again]                  |
+-------------------------------------------+

+-------------------------------------------+
|           <commit>                        |
|           No history yet                  |                         empty [3]
|        No Commits or Layers yet.          |
+-------------------------------------------+

| Detail                      |
|        <commit>             |                                       no selection [4]
| Select a commit to view     |
| details                     |

| Branches 1          |
| v # main      1 L   |
| +- - - - - - - - -+ |                                               no match [5]
| : No Branch or    : |
| : Commit matches. : |
| : [Show all       : |
| :  Branches]      : |
| +- - - - - - - - -+ |
```

| [n] | Component | file:line | one line |
|---|---|---|---|
| [1] | Loading | ../history-tab.tsx:79 | Before the first read |
| [2] | LoadError | ../history-tab.tsx:78 | Or "The Connect host is not reachable" |
| [3] | Empty | ../history-tab.tsx:82 | No Branches, no Layers and no Commits |
| [4] | no detail | commit-detail.tsx:127 | Nothing selected and no head to fall back on |
| [5] | no match | branch-tree.tsx:129 | Search/filter matched nothing; button clears both |

An empty graph reads "No Commits or Layers yet." (`lineage-graph.tsx:187`).

## Notes

- `>` in `[> fix-orders]` is the CornerDownRight icon; an unknown time reads `-`. The 2.0 host lists only main's newest Layer, with
  no message or time (`host/projects.js:327`), so it reads "Publish" and "-".
- HistoryTab props never passed by `project-view.tsx:185`: `runId`, `tick`, `initialItem`. Without
  `runId` no run is read, so no Commit has an agent: no AgentDot in the tree, no "By" row, no agent
  dots on graph rows or Map labels, and the first focus never picks a busy Branch. Without
  `initialItem` the MissingNote never shows. `tick` would only matter without `state`.

## Current desktop renderer

The Storage project History tab uses `components/history/ProjectHistory.tsx`, shared with chat.
It shows centered main, branch families, expandable checkpoint groups and changed paths.
The Lineage/Map description above belongs to the older root renderer.
