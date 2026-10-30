# Project: History

The project's Branches, the focused Branch's lineage and the selected Commit or Layer; a switch shows the project's files instead. Opens from: the History tab of a project page, or an auto-checkpoint link in a session's Trace (opens on that Commit).
Source: `src/renderer/src/components/projects/history-tab.tsx` (`HistoryTab`; others named in Regions).

## Skeleton

History:

```text
+-[1] Tab row -------------------------------------------------------------------------------------+
| History   Storage   Sandboxes                                  |  Sessions 28   [ > Replay | v ] |
|                   =======                                                                        |
+--------------------------------------------------------------------------------------------------+
[2] ( History | Files )
      =======
+-[3] Toolbar -------------------------------------------------------------------------------------+
| [ Find a Branch or Commit ]  ( All 133 | Open 82 | Done 51 ) 133 Branches ... main at [9d16ac44] |
+--------------------------------------------------------------------------------------------------+
+-[4] BranchTree --------++-[5] LineageGraph --------------------------++-[6] CommitDetail --------+
| BRANCHES 134           || main > * merge_2.main > * merge_2.feature  || COMMIT                   |
|                        || Forked from me... [Fork] [Merge] [Publish] ||                          |
| v * main          10 L ||--------------------------------------------|| [0da9c977] (Head)        |
|   * add-html published ||   @ [0da9c977] (merge_2.feature) e...  3 h || edit /app/page.tsx       |
|   v * agents_1.main +1 ||   o [bba8428a] heading: Hello from...  3 h || +----------------------+ |
|     * agents_1.ui   +8 ||   o [90d1c9a2] edit /README.md         3 h || | On   merge_2.feature | |
|   > o tour_1.r1 merged || o-' [171cfbac] (merge_2.main) setup... 3 h || | By   no agent rec... | |
|   v * merge_2.main  +1 || #   [9d16ac44] land /shop_1 from s...  3 h || | When 3 h ago         | |
|     * crew_1.lead   +4 || #   [01e9665e] land /checkpoints_1...  3 h || | Id   120da9c97725... | |
|   ...                  || #   ( 7 earlier Layers on main )           || +----------------------+ |
|                        ||                                            || 1 PATH CHANGED        ~1 |
|                        ||                                            || ~ /merge_2/a... modified |
+------------------------++--------------------------------------------++--------------------------+
```

Files:

```text
[2] ( History | Files )
                =====
+-[7] Tree ------------------++-[8] FileBody ------------------------------------------------------+
| FILES 2 open               || [ TS page.tsx  x ]  [ i README.md ]                                |
| [ main - 9d16ac44      v ] ||--------------------------------------------------------------------|
| [ Find in opened folders ] || app / page.tsx                          12 lines - 342 B - at main |
|----------------------------||--------------------------------------------------------------------|
| v [] app                   ||  1  export default function Page() {                               |
|     TS page.tsx            ||  2    return <h1>Hello from the Workspace</h1>                     |
| > [] lib                   ||  3  }                                                              |
|   {} package.json          ||  ...                                                               |
|   i  README.md             ||                                                                    |
+----------------------------++--------------------------------------------------------------------+
```

## Regions

1. **Tab row** (`ProjectPage`, `projects/project-view.tsx`): the project page's first row (the sidebar names the project): History, Storage, Sandboxes, then Sessions with its count, then `ReplayControl` (`runs/replay-control.tsx`), shown once the demo is read. Every tab reads the project's newest session (`RunPanel`, `runs/run-view.tsx`).
2. **History / Files switch** (`RunHistoryTab`, `runs/run-project-tabs.tsx`): a `Segmented` switch between the history (region 3 on) and the project's files (regions 7-8).
3. **Toolbar** (`Toolbar`, `projects/history-tab.tsx`): "Find a Branch or Commit", All / Open / Done with counts, and the counts line ending "main at 9d16ac44".
4. **BranchTree** (`BranchTree`, `projects/history/branch-tree.tsx`): `PaneHead` "Branches" and the shown count (`projects/history/parts.tsx`), then the Branches by fork: lane-coloured dots, names, and main's Layers ("10 L"), "+N" Commits, "published" or "merged". Merged Branches with forks start folded. A click focuses a Branch; arrow keys move and fold.
5. **LineageGraph** (`LineageGraph`, `projects/history/lineage-graph.tsx`): the ancestor breadcrumb (past three, the middle folds into a "..." menu). Under it, the Branch's line ("Forked from merge_2.main at 171cfbac · 3 Commits · 0 forks"; for main, "10 Layers · the published line new mounts start from") and Fork, Merge, Publish (always disabled: "Connect's runs fork, merge and publish; doing it by hand is not available yet"). Then the ancestry, newest first: lanes, a `HashChip`, the Branch chip on a lane's first row, the agent dot, message, age, and the Branch forked there ("+9" more). The head glows; "7 earlier Layers on main" ends the list.
6. **CommitDetail** (`CommitDetail`, `projects/history/commit-detail.tsx`): `PaneHead` "Commit" ("Layer", or "Detail" with nothing picked), the `HashChip` and chips (Head, Merge, Layer on main, Head of main), and the message. A card shows On / By / When / Id (a Layer: From / When / Id). Then "Merged in" and "Forked here" when they apply, and "1 path changed" with a tally per kind and a row per path.
7. **Tree** (`FilesTab` aside, `Tree`, `FileBadge`, `projects/files-tab.tsx`): `PaneHead` "Files" with "2 open", the Branch select (Published: main; Branches with "+N" or their state), `SearchField` "Find in opened folders", and the folder tree with file-type badges.
8. **FileBody** (`FileBody`, `projects/files-tab.tsx`; `CodeView`, `projects/code-view.tsx`): the strip of open files, each closable; the path with "12 lines · 342 B · at main"; the file read-only in CodeMirror with line numbers.

## States

- **Loading**: "Reading <project>", then "Reading Branches and Commits"; a failed read shows `LoadError` with a retry.
- **Missing item**: a linked Commit or Layer that is not read yet gets an amber note under the toolbar: "Commit <hash> is not in this project's history. It may not be read yet (it opens when it is), or its Branch was removed." It opens once a later read has it.
- **No match**: "No Branch or Commit matches." with [ Show all Branches ].
- **Nothing picked**: "Pick a Commit or a Layer to see what it changed."
- **Empty Branch**: "No Commits yet: forked, nothing committed"; a Commit without paths: "LayerFS listed no changed paths with this entry."
- **Live**: the history rereads as the session moves; the head breathes while its agent is working.
- **Files**: "No files open" and "Open a file from the tree" until one opens; "Reading the file"; "A binary file" or "Too large to show" with its size; "No file in the opened folders matches."
