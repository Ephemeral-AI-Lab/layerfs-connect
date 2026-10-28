# Project: Storage

The project's Store told as a story: what the history costs on disk, how it shrinks to that, how both grow, and what each Commit added. Opens from: the Storage tab of a project page (a project's name in the sidebar, or its card on the LayerFS page).
Source: `src/renderer/src/components/projects/project-storage.tsx` (`ProjectStorage`; others named in Regions).

## Skeleton

```text
+-[1] Tab row -------------------------------------------------------------------------------------+
| Live   Timeline   History   Storage   Sandboxes                |  Sessions 28   [ > Replay | v ] |
|                             =======                                                              |
+--------------------------------------------------------------------------------------------------+
     +-[2] StoreCard -------------------------------------------------------------------------+
     | [=] Local SQLite Store                                                                 |
     |     Every Commit, Branch and Layer of playground lives in one SQLite file in its       |
     |     Docker volume; each new session starts it again from the demo's fixture.           |
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
     | [7] CREATED             VOLUME                                                         |
     |     Oct 27, 08:01       <volume>                                                       |
     |     STORE FILE                                                                         |
     |     /var/lib/docker/volumes/<volume>/_data/global/store.sqlite                         |
     +----------------------------------------------------------------------------------------+
```

## Regions

1. **Tab row** (`ProjectPage`, `projects/project-view.tsx`): the project page's first row (the sidebar names the project): Live, Timeline, History, Storage, Sandboxes, then Sessions with its count, then `ReplayControl` (`runs/replay-control.tsx`), shown once the demo is read. Every tab reads the project's newest session (`RunPanel`, `runs/run-view.tsx`).
2. **StoreCard** (`StoreCard`, `projects/project-storage.tsx`): "Local SQLite Store" and a line on what it holds, then the story (`StoreStatsBody`), in a 1000 px column.
3. **StoreStatsBody headline** (`StoreStatsBody`, `projects/project-storage.tsx`; `CountBytes`, `SavedRing`, `projects/store-visuals.tsx`): "ON DISK" bytes counting up, "for 2.0 GB of history", "25x smaller" (shown from 1.1x), the Commit, Branch and Layer counts, and the ring "96% saved".
4. **DiskFlow** (`DiskFlow`, `projects/store-visuals.tsx`), section 1 "From history to disk": four stages (Every snapshot, Unique, Compressed, On disk) with bytes and share. A band whose thickness is the bytes is marked "8.1x dedupe", "3.6x compression" and "+ 7.4 MB metadata". Pills follow: "main, latest, raw", "from Init" (when known), "SQLite pages", and "free" (when any).
5. **GrowthChart** (`GrowthChart`, `projects/store-visuals.tsx`), section 2 "History against disk": cumulative raw history against compressed content, Commit by Commit, with totals in the legend and "Init -> newest Commit"; hovering shows a Commit.
6. **CommitBars, CommitKinds** (`CommitBars`, `CommitKinds`, `projects/store-visuals.tsx`), section 3 "Each Commit": the average and largest added. Bars show the newest 60 Commits coloured by kind; hovering a bar shows added, new unique and tree. A split bar and list give each kind (fs write, Workspace commit, merge) with bytes and Commit count.
7. **Fact list** (`Fact`, `projects/project-storage.tsx`): Created, Volume, Store file.

## States

- **Loading**: "Reading <project>"; a failed read shows `LoadError` with a retry.
- **Totals unreadable**: "The Store's totals are not readable right now. File size: <bytes>", then the facts.
- **No Commits**: "No Commits yet.", "The first Commit's bar shows here", and "only Init so far" on the chart.
- **Commit landing** (live): a glowing "+<bytes> <message>" pill rises beside the headline for about 2.6 s.
