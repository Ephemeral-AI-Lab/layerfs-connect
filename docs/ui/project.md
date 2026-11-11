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
SandboxMap receives actual host observations. Missing activity, metrics and agent
ownership remain explicitly unavailable. Files and History have no local fixture path.


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

## Measured project Storage (2026-11-10)

```text
[Project saved tree · main ‹saved id› · Complete/Incomplete]
[Saved size by revision]                              [Branch ▼]
logical tree bytes across immutable saved revisions
[Recorded Save stored-byte bars, when Commit rows exist]
> Exact measurements                              [Load earlier]
[Project canonical reuse · ‹full key›] [Analyze saved revisions]
[Entire Store encoding / allocation / observed allocation]
```

Project tree counts and logical file bytes come from the same immutable main
pin. History is independently selectable by branch and pinned while paging.
Publication Layers have unknown Save additions and publication time; source
Commit time is not substituted. Save metadata bytes are included in stored
bytes. The Store charts below include all projects and retained history, with
their scope visible. Shared components live in `components/storage/`; see the
storage-analysis section of `storage.md` for accounting and observation rules.
Project Storage automatically calls `project.storage_report` for up to 20 selected
saved revisions. Store analysis is a separate action on the Store detail page;
it compares selected projects' current main snapshots with its own scope.

## Current storage layout (2026-11-10)

The chart-first storage story supersedes the earlier saved-tree/Store panel order.
Latest main raw file size and counts remain visible independently of selected branch.
Automatically loaded bounded selected-revision analysis leads with referenced → unique → encoded stages
and a canonical reuse ring; missing encoded accounting remains unknown. History and
its selected-revision inspector follow. Global Store allocation is linked from the
footer and appears on the Store page. See `storage.md` “Desktop storage analysis” for the current ASCII layout and accounting/animation rules.
