# Project: Storage

The project's Store told as a story: which Store holds it and where, what the history costs on disk, how it shrinks to that, how both grow, and what each Commit added. Opens from: the Storage tab of a project page (a project's name in the sidebar, or its card on the Projects page).
Source: `src/renderer/src/components/projects/project-storage.tsx` (`ProjectStorageContent`, `StoreCard`; others named in Regions).

## Skeleton

```text
+-[1] Tab row -------------------------------------------------------------------------------------+
| Live   Files   Storage   History   Sessions 28   Sandboxes                                        |
|                =======                                                                           |
+--------------------------------------------------------------------------------------------------+
     +-[2] StoreCard -------------------------------------------------------------------------+
     | [=] SQLite Store shop   (on dev-lima)                                                  |
     |     Every Commit, Branch and Layer of web lives in this Store's one SQLite file, on    |
     |     dev-lima.                                                                          |
     |     Shared with 1 other project: ...                                                   |
     |                                                                                        |
     | [3] ON DISK                                                                  .-----.   |
     |     78.6 MB  for 2.0 GB of history  (25x smaller)                            ( 96% )   |
     |     182 Commits - 134 Branches - 10 Layers. LayerFS counts each as a full    (saved)   |
     |     snapshot, then keeps only what is new.                                   '-----'   |
     |----------------------------------------------------------------------------------------|
     | [4] (1) From history to disk                                                           |
     |         Every snapshot counted in full, then the same bytes once, then packed.         |
     |         The band's thickness is the bytes.                                             |
     |                                                                                        |
     |   * Every snapshot   * Unique             * Compressed        * On disk                |
     |     2.0 GB             248 MB               68.5 MB             78.6 MB                |
     |     raw history        after dedupe - 12%   pack bytes - 3.4%   the SQLite file - 3.9% |
     |     |~~~~~~~~~~~~~\                                                                    |
     |     |~~~~(8.1x dedupe)~~~~*~~~~(3.6x compression)~~~~*~~~~(+ 7.4 MB metadata)~~~~*     |
     |     |~~~~~~~~~~~~~/                                                                    |
     |     [ main, latest, raw 21.9 MB ] [ from Init 0 B - 0 files ] [ SQLite pages 75.1 MB ] |
     |----------------------------------------------------------------------------------------|
     | [5] (2) History against disk                [6] (3) Each Commit                        |
     |     Cumulative, Commit by Commit: every         376 KB average - 58.1 MB largest,      |
     |     snapshot in full, against the packed        added on disk.                         |
     |     bytes kept.                                                                        |
     |                                                            |                           |
     | -- raw history 2.0 GB                                      |                           |
     | -- compressed content 68.5 MB                              |                           |
     |                      Init -> newest Commit  _._.__,_.___,__|_.__,___._,___.__,_._      |
     | 2.0 GB                                  .*  Newest 60, oldest left - hover a bar       |
     |                                      .~~~'  [=============================|====|=]     |
     |                            ..~~~~~~~~'      # Workspace commit  57.9 MB    120 Commits |
     | _______________....~~~~~~~'__________       # fs write           6.1 MB     50 Commits |
     |                                             # merge              4.5 MB     12 Commits |
     |----------------------------------------------------------------------------------------|
     | [7] CREATED             MACHINE                                                        |
     |     Oct 27, 08:01       dev-lima                                                       |
     +----------------------------------------------------------------------------------------+
```

## Regions

1. **Tab row** (`ProjectView`, `projects/project-view.tsx`): Live, Files, Storage, History, Sessions (with its count) and Sandboxes, shortest label first. Above every tab sits the Store banner when the Store is busy, down or unresolved ([layerfs-projects.md](layerfs-projects.md)).
2. **StoreCard** (`StoreCard`, `projects/project-storage.tsx`): "SQLite Store <name>" with an "on <machine>" chip, or "PostgreSQL Store <name>"; a line on where its history lives (the Store's one SQLite file on its machine, or the PostgreSQL Store, where each Commit goes straight); for a shared Store, "Shared with N other projects" and that a push, pull or backup carries them too. Then the story (`StoreStatsBody`). No file path.
3. **StoreStatsBody headline** (`StoreStatsBody`, `projects/project-storage.tsx`; `CountBytes`, `SavedRing`, `projects/store-visuals.tsx`): "ON DISK" bytes counting up, "for 2.0 GB of history", "25x smaller" (shown from 1.1x), the Commit, Branch and Layer counts, and the ring "96% saved".
4. **DiskFlow** (`DiskFlow`, `projects/store-visuals.tsx`), section 1 "From history to disk": four stages (Every snapshot, Unique, Compressed, On disk) with bytes and share. A band whose thickness is the bytes is marked "8.1x dedupe", "3.6x compression" and "+ 7.4 MB metadata". Pills follow: "main, latest, raw", "from Init" (when known), "SQLite pages", and "free" (when any).
5. **GrowthChart** (`GrowthChart`, `projects/store-visuals.tsx`), section 2 "History against disk": cumulative raw history against compressed content, Commit by Commit, with totals in the legend and "Init -> newest Commit"; hovering shows a Commit.
6. **CommitBars, CommitKinds** (`CommitBars`, `CommitKinds`, `projects/store-visuals.tsx`), section 3 "Each Commit": the average and largest added. Bars show the newest 60 Commits coloured by kind; hovering a bar shows added, new unique and tree. A split bar and list give each kind (fs write, Workspace commit, merge) with bytes and Commit count.
7. **Fact list** (`Fact`, `projects/project-storage.tsx`): Created, then Machine (sqlite; opens the machine's row on Compute) or Store (PostgreSQL; opens its row on Storage).

## States

- **Loading**: "Reading <project>"; a failed read shows `LoadError` with a retry.
- **Totals unreadable** (today always: LayerFS 2.0 has no totals call): "Store file with its WAL: <bytes>" and the gap line, then the facts.
- **Store busy, down or unresolved**: the page answers from the home's records; the banner says why, and the story waits.
- **No Commits**: "No Commits yet.", "The first Commit's bar shows here", and "only Init so far" on the chart.
- **Commit landing** (live): a glowing "+<bytes> <message>" pill rises beside the headline for about 2.6 s.
