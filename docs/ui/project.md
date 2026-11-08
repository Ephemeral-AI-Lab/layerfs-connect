# Storage project page
Source: `desktop/src/renderer/src/pages/storage/project/ProjectPage.tsx`, `ProjectTabs.tsx`
Opens from: Storage project rows, chat Files, resource links.
Routes: `/storage/:store/:project/{files,history,sandboxes,storage}`; no tab redirects to Files. `/history/diff` opens a comparison with History active.

## Page frame

```text
+-[1] Project header -----------------------------------------------------------+
| Storage / shop / api                                             [Refresh]  |
| [2] |Files|    History    Sandboxes    Storage                                |
+-----------------------------------------------------------------------------+
| [3] Shared feature content                                                   |
|                                                                             |
+-----------------------------------------------------------------------------+
```

| [n] | Component | File | Behavior |
|---|---|---|---|
| 1 | ProjectPage | pages/storage/project/ProjectPage.tsx | Breadcrumbs open Storage or the Store; refresh rereads project |
| 2 | ProjectTabs | pages/storage/project/ProjectTabs.tsx | Same line tabs as chat; URL selects view |
| 3 | ProjectFiles | components/files/ProjectFiles.tsx | Same branch picker, folder tree and preview as chat; `?branch=` selects branch |
| 3 | ProjectHistory | components/history/ProjectHistory.tsx | Same graph, branch families, checkpoint groups and details as chat |
| 3 | ProjectSandboxes | components/sandbox/ProjectSandboxes.tsx | Shared map of project branches and mounted workspaces; chat detail navigation; resource controls inside details |
| 3 | ProjectStorageContent | components/storage/ProjectStorage.tsx | Existing disk flow, growth and per-commit diagrams |

## States

```text
Loading: Reading project...
Error:   <SDK refusal> [Retry]
Missing tab: This project page does not exist. [Open project files]
Files:   No branches to browse / folder empty / file unavailable
History: Reading history... / No history yet / <failure> [Try again]
Sandbox: No sandbox activity yet / workspace status unavailable / <refusal> [Retry]
Storage: partial-history notice / totals unavailable; shared Store disk usage labeled explicitly
```

## Sharing

Page wrappers own routes and chat context. Shared features never import page implementations.
History reads project metadata without a chat; the chat wrapper alone supplies trace lookup/links.
SandboxMap receives view data. Real projects use host resources; Example chat alone uses the
simulation adapter in `layerfs/simulation/ProjectSandboxPreview.tsx`. Missing activity and agent
ownership are described as unavailable, never filled with scenario data.
Store disk bytes include all projects sharing that Store; project commit charts retain their scope.

Storage `shop/api/history` in development simulation also previews saved-version comparisons.
Its graph opens a separate `/history/diff` page with Back to History, From/To selectors,
changed paths and shared Content/Attribution/Code/Blame views are specified in `chat-history.md` under Storage SDK comparison preview. It uses the same
local saved trees as Files; the labeled exit control restores host-backed History.

## Files SDK proposal preview (development simulation)

Source: `components/files/FilesTab.tsx`, `FileExplorerPreview.tsx`, `file-preview-data.ts`, `files.css`.
The development simulated `shop/api` Files view opens this local read-only preview by default.
Other projects and real/production mode retain the host-backed Files view. The frame, branch
picker, lazy directory tree, search and open file tabs are shared; no separate demo page exists.
SDK proposal copy: `docs/sdk-branch-file-proposal.md`. No proposed SDK calls are made.

```text
[1] File history preview - Sample data - read-only          [Browse host files]
+-[2] Files ----------------+-[3] Open files ---------------------------------+
| [main                  v] | login.js [x]                                    |
| Project core content      | src/routes/login.js               13 lines      |
| [Find in opened folders]  | [4] Code Compare Attribution Blame Revisions    |
| v src                     | [Latest v]                           [Commits] |
|   v routes                | [5] a81e30f2 Publish structured login responses  |
|       login.js            +-------------------------------+-[6] Commits ---+
|       orders.js           | [7] Selected file view         | commit rows    |
|   test                    |                               | [<] Page 1 [>] |
|   assets                  | Code: saved content            |                |
|   README.md               | Compare: source, swap, diff    | Selected commit|
|   package.json            | Blame: owner per line          | ancestry, time |
|                           | Attribution: compare owners   | changed paths  |
|                           | Revisions: filter, rows, pages |                |
|                           |                               | [Browse files] |
+---------------------------+-------------------------------+----------------+
| [8] Saved content - Project core                  Latest - a81e30f2 - 0644 |
+----------------------------------------------------------------------------+
```

| [n] | Region | Behavior |
|---|---|---|
| 1 | Preview notice | Labels every fixture as sample data; exit opens the original host files, with a return control |
| 2 | Shared Files sidebar | main is core content; side branches are based on main; switching branch resets to latest saved content |
| 3 | Shared open files | Open/close tabs and search loaded folders; saved commit changes reload the same tree at that revision |
| 4 | File views and saved commit | Arrow/Home/End keys move view tabs; saved selector includes inherited commits; Commits toggles inspector |
| 5 | Last change | Opens the actual sample commit that changed this file, even if a later branch commit touched another file |
| 6 | Commit inspector | Branch-own commit list with page/page-size controls; selected inherited details retain originating branch; Escape or close dismisses |
| 7 | File body | Compare with previous/main/other branch/any saved commit, swap sides, expand changed paths; attribution compares both owners, including identical text; blame owners open details; revisions filter and page, open old content or compare with parent |
| 8 | Status | Saved/historical content and pinned commit identity; no live Workspace overlay implied |

Revisions distinguish file changes from all branch commits and include inherited provenance.
Compare source/target IDs are pinned by local immutable fixtures. Diff +/- and status labels
accompany colors. Binary files show size and revisions instead of code/blame; absent historical
files explain absence and link to latest. Empty filters offer Clear filters. First/last page
controls disable appropriately. At compact desktop sizes, commit details overlay the file
body with a close control instead of squeezing the editor. No native desktop behavior is tested.

## Unified sandbox navigation

```text
Chat / Storage project -> shared SandboxMap -> SandboxDetail
                                                |
                 [Project activity] <-----------+
                 restores map selection and scroll

SandboxDetail: Overview | Workspaces | Scratch | Activity | Diagnostics
```

`components/sandbox/ProjectSandboxNavigation.tsx` owns this flow for both the chat example
and host-backed project views. The map stays mounted during inspection. Source adapters
supply data and playback; they do not implement separate navigation. Resource management
controls live inside host-backed details. Map headers retain New Sandbox and Refresh.
`HostSandboxDetail.tsx` reads the selected Sandbox and verifies its project/machine identity;
Refresh rereads that record. Unknown workspace reads and unreported files/activity stay
explicitly unavailable. Real observations do not carry simulation playback or labels.

## CLI saved Files (phase 2, 2026-11-09)

```text
[1 Branch ▼]          [2 opened file tabs]
Saved ‹id›           path · size · saved ‹id›
[Find in opened       [Code | Compare | Attribution | Blame | Revisions]
 folders]            [3 bounded saved query]
[folder tree]        [Previous] Page N [Next]
[Show more entries]  [Load next text/blame window when next_line exists]
```

1. Lightweight branch pages; no eager per-Branch history scan or file stat fan-out.
2. Every list/stat/read uses the same full saved pin. A refresh checks branch.get;
   a historical selection stays pinned and shows when a newer version exists.
3. Binary and absent paths are file states. Clipped/partial/omitted data stays visible.
   Revision continuation repeats pin, traversal and page size, omitting page.
   Comparison and attribution use server rows; unknown owners remain Unknown.
